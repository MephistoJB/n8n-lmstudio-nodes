import type { IExecuteFunctions, ILoadOptionsFunctions } from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';
import { LmStudioSimpleMessage } from 'nodes/LmStudioSimpleMessage/LmStudioSimpleMessage.node';

const mockNode = {
	id: 'test-id',
	name: 'LM Studio Test',
	type: 'n8n-nodes-lmstudio.lmStudioSimpleMessage',
	typeVersion: 1,
	position: [0, 0] as [number, number],
	parameters: {},
};

const defaultCredentials = { hostUrl: 'http://localhost:1234', apiKey: '' };

const openAiChatResponse = (
	content: string,
	extra?: Partial<{ model: string; finish_reason: string }>,
) => ({
	choices: [{ message: { content }, finish_reason: extra?.finish_reason ?? 'stop' }],
	model: extra?.model ?? 'test-model',
	usage: { prompt_tokens: 5, completion_tokens: 10 },
	created: 1700000000,
	id: 'chatcmpl-abc',
});

const nativeChatResponse = (content: string) => ({
	model_instance_id: 'google/gemma-4-26b-a4b-qat',
	output: [
		{ type: 'reasoning', content: 'Thinking...' },
		{ type: 'message', content },
	],
	stats: { input_tokens: 10, total_output_tokens: 20 },
	response_id: 'resp_123',
});

function createExecuteMock(
	paramOverrides: Record<string, unknown> = {},
	credentialOverrides: Record<string, unknown> = {},
) {
	const defaults: Record<string, unknown> = {
		operation: 'sendMessage',
		modelName: 'test-model',
		loadModelName: 'test-model',
		instanceId: 'test-model',
		message: 'Hello',
		jsonSchema: '{}',
		messageAdvancedOptions: {},
		loadAdvancedOptions: {},
	};
	const params = { ...defaults, ...paramOverrides };
	const creds = { ...defaultCredentials, ...credentialOverrides };

	return {
		getInputData: jest.fn().mockReturnValue([{ json: {} }]),
		getNodeParameter: jest
			.fn()
			.mockImplementation((name: string, _i: number, fallback?: unknown) => params[name] ?? fallback),
		getNode: jest.fn().mockReturnValue(mockNode),
		getCredentials: jest.fn().mockResolvedValue(creds),
		getExecutionId: jest.fn().mockReturnValue('exec-123'),
		getExecutionCancelSignal: jest.fn().mockReturnValue(undefined),
		continueOnFail: jest.fn().mockReturnValue(false),
		logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
		helpers: { httpRequest: jest.fn() },
	} as unknown as IExecuteFunctions;
}

function createLoadOptionsMock(credentialOverrides: Record<string, unknown> = {}) {
	const creds = { ...defaultCredentials, ...credentialOverrides };
	return {
		getNodeParameter: jest.fn(),
		getCredentials: jest.fn().mockResolvedValue(creds),
		helpers: { httpRequest: jest.fn() },
	} as unknown as ILoadOptionsFunctions;
}

describe('LmStudioSimpleMessage', () => {
	let node: LmStudioSimpleMessage;

	beforeEach(() => {
		node = new LmStudioSimpleMessage();
	});

	describe('execute', () => {
		it('returns text response with metadata in OpenAI-compatible mode', async () => {
			const mock = createExecuteMock({
				messageAdvancedOptions: { apiMode: 'openaiCompatible', temperature: 0.7 },
			});
			(mock.helpers.httpRequest as jest.Mock).mockResolvedValue(openAiChatResponse('Hello world'));

			const result = await node.execute.call(mock);

			expect(result[0][0].json.response).toBe('Hello world');
			expect(result[0][0].json._metadata).toMatchObject({
				apiMode: 'openaiCompatible',
				model: 'test-model',
				finish_reason: 'stop',
			});
		});

		it('parses JSON response when schema is provided', async () => {
			const mock = createExecuteMock({
				jsonSchema: JSON.stringify({
					type: 'object',
					properties: { name: { type: 'string' } },
				}),
				messageAdvancedOptions: { apiMode: 'openaiCompatible' },
			});
			(mock.helpers.httpRequest as jest.Mock).mockResolvedValue(openAiChatResponse('{"name":"Alice"}'));

			const result = await node.execute.call(mock);

			expect(result[0][0].json.response).toEqual({ name: 'Alice' });
		});

		it('returns native v1 response data with reasoning', async () => {
			const mock = createExecuteMock({
				messageAdvancedOptions: {
					apiMode: 'nativeV1',
					contextLength: 8192,
					temperature: 0.1,
				},
			});
			(mock.helpers.httpRequest as jest.Mock).mockResolvedValue(nativeChatResponse('Hello from native'));

			const result = await node.execute.call(mock);

			expect(result[0][0].json.response).toBe('Hello from native');
			expect(result[0][0].json.reasoning).toEqual(['Thinking...']);
			expect(result[0][0].json._metadata).toMatchObject({
				apiMode: 'nativeV1',
				modelInstanceId: 'google/gemma-4-26b-a4b-qat',
			});
		});

		it('throws when JSON schema is used with native v1 mode', async () => {
			const mock = createExecuteMock({
				jsonSchema: '{"type":"object"}',
				messageAdvancedOptions: { apiMode: 'nativeV1' },
			});

			await expect(node.execute.call(mock)).rejects.toThrow(
				/JSON Schema is currently only supported in OpenAI Compatible mode/,
			);
		});

		it('throws NodeOperationError on invalid JSON schema string', async () => {
			const mock = createExecuteMock({
				jsonSchema: '{not json',
				messageAdvancedOptions: { apiMode: 'openaiCompatible' },
			});

			await expect(node.execute.call(mock)).rejects.toThrow(NodeOperationError);
		});

		it('throws timeout error when request times out', async () => {
			const mock = createExecuteMock({
				messageAdvancedOptions: { apiMode: 'openaiCompatible', timeout: 30 },
			});
			const err = new Error('timeout') as Error & { cause: { code: string } };
			err.cause = { code: 'ETIMEDOUT' };
			(mock.helpers.httpRequest as jest.Mock).mockRejectedValue(err);

			await expect(node.execute.call(mock)).rejects.toThrow(/timed out after 30 seconds/);
		});

		it('throws NodeApiError on generic HTTP failure', async () => {
			const mock = createExecuteMock({
				messageAdvancedOptions: { apiMode: 'openaiCompatible' },
			});
			(mock.helpers.httpRequest as jest.Mock).mockRejectedValue(new Error('Connection refused'));

			await expect(node.execute.call(mock)).rejects.toThrow(NodeApiError);
		});

		it('returns error item when continueOnFail is true', async () => {
			const mock = createExecuteMock({
				messageAdvancedOptions: { apiMode: 'openaiCompatible' },
			});
			(mock.continueOnFail as jest.Mock).mockReturnValue(true);
			(mock.helpers.httpRequest as jest.Mock).mockRejectedValue(new Error('Server down'));

			const result = await node.execute.call(mock);

			expect(result[0][0].json.error).toContain('Server down');
		});

		it('sends Authorization header when apiKey is set', async () => {
			const mock = createExecuteMock(
				{ messageAdvancedOptions: { apiMode: 'openaiCompatible' } },
				{ apiKey: 'sk-test-123' },
			);
			(mock.helpers.httpRequest as jest.Mock).mockResolvedValue(openAiChatResponse('ok'));

			await node.execute.call(mock);

			expect(mock.helpers.httpRequest).toHaveBeenCalledWith(
				expect.objectContaining({
					headers: expect.objectContaining({ Authorization: 'Bearer sk-test-123' }),
				}),
			);
		});

		it('lists models using the native v1 endpoint shape', async () => {
			const mock = createExecuteMock({ operation: 'listModels' });
			(mock.helpers.httpRequest as jest.Mock).mockResolvedValue({
				models: [
					{
						type: 'llm',
						key: 'google/gemma-4-26b-a4b-qat',
						display_name: 'Gemma 4 26B',
						loaded_instances: [
							{
								id: 'google/gemma-4-26b-a4b-qat',
								config: { context_length: 64000, parallel: 4 },
								remaining_ttl_seconds: 3600,
							},
						],
						max_context_length: 262144,
						quantization: { name: '4bit' },
					},
				],
			});

			const result = await node.execute.call(mock);

			expect(result[0]).toHaveLength(1);
			expect(result[0][0].json.id).toBe('google/gemma-4-26b-a4b-qat');
			expect(result[0][0].json.loaded).toBe(true);
			expect(result[0][0].json.loadedInstances).toHaveLength(1);
		});

		it('loads a model with advanced options', async () => {
			const mock = createExecuteMock({
				operation: 'loadModel',
				loadModelName: 'google/gemma-4-26b-a4b-qat',
				loadAdvancedOptions: {
					contextLength: 64000,
					evalBatchSize: 512,
					flashAttention: true,
				},
			});
			(mock.helpers.httpRequest as jest.Mock).mockResolvedValue({
				instance_id: 'google/gemma-4-26b-a4b-qat',
				status: 'loaded',
			});

			const result = await node.execute.call(mock);
			const request = (mock.helpers.httpRequest as jest.Mock).mock.calls[0][0];

			expect(request.url).toContain('/api/v1/models/load');
			expect(request.body).toMatchObject({
				model: 'google/gemma-4-26b-a4b-qat',
				context_length: 64000,
				eval_batch_size: 512,
				flash_attention: true,
				echo_load_config: true,
			});
			expect(result[0][0].json.response).toMatchObject({ status: 'loaded' });
		});

		it('unloads a model instance', async () => {
			const mock = createExecuteMock({
				operation: 'unloadModel',
				instanceId: 'google/gemma-4-26b-a4b-qat',
			});
			(mock.helpers.httpRequest as jest.Mock).mockResolvedValue({
				instance_id: 'google/gemma-4-26b-a4b-qat',
			});

			await node.execute.call(mock);

			expect(mock.helpers.httpRequest).toHaveBeenCalledWith(
				expect.objectContaining({
					url: 'http://localhost:1234/api/v1/models/unload',
					body: { instance_id: 'google/gemma-4-26b-a4b-qat' },
				}),
			);
		});
	});

	describe('loadOptions', () => {
		it('returns sorted model list and marks loaded models for v1 responses', async () => {
			const mock = createLoadOptionsMock();
			(mock.helpers.httpRequest as jest.Mock).mockResolvedValue({
				models: [
					{ type: 'llm', key: 'zephyr-7b', display_name: 'Zephyr 7B', loaded_instances: [] },
					{
						type: 'llm',
						key: 'llama-3',
						display_name: 'Llama 3',
						loaded_instances: [{ id: 'llama-3', config: { context_length: 8192 } }],
					},
					{ type: 'embedding', key: 'nomic-embed', display_name: 'Nomic Embed', loaded_instances: [] },
				],
			});

			const result = await node.methods.loadOptions.getChatModels.call(mock);

			expect(result).toHaveLength(2);
			expect(result[0].name).toBe('Llama 3 (loaded)');
			expect(result[1].name).toBe('Zephyr 7B');
		});

		it('includes auth header for load options requests', async () => {
			const mock = createLoadOptionsMock({ apiKey: 'sk-test-123' });
			(mock.helpers.httpRequest as jest.Mock).mockResolvedValue({ models: [] });

			await node.methods.loadOptions.getAllModels.call(mock);

			expect(mock.helpers.httpRequest).toHaveBeenCalledWith(
				expect.objectContaining({
					headers: expect.objectContaining({ Authorization: 'Bearer sk-test-123' }),
				}),
			);
		});

		it('returns loaded instances as unload candidates', async () => {
			const mock = createLoadOptionsMock();
			(mock.helpers.httpRequest as jest.Mock).mockResolvedValue({
				models: [
					{
						type: 'llm',
						key: 'gemma-4',
						display_name: 'Gemma 4',
						loaded_instances: [{ id: 'gemma-4', config: { context_length: 64000 } }],
					},
				],
			});

			const result = await node.methods.loadOptions.getLoadedInstances.call(mock);

			expect(result).toHaveLength(1);
			expect(result[0].value).toBe('gemma-4');
			expect(result[0].name).toContain('Context: 64000');
		});
	});
});
