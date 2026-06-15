/**
 * Integration tests -- require a running LM Studio server.
 *
 * Run with: LM_STUDIO_URL=http://localhost:1234 npm run test:integration
 *
 * These are skipped automatically when LM_STUDIO_URL is not set.
 */
import * as http from 'http';
import * as https from 'https';
import type { IExecuteFunctions, ILoadOptionsFunctions } from 'n8n-workflow';
import { LmStudio } from 'nodes/LmStudio/LmStudio.node';

const LM_STUDIO_URL = process.env.LM_STUDIO_URL;
const LM_STUDIO_MODEL = process.env.LM_STUDIO_MODEL;
const describeIf = LM_STUDIO_URL ? describe : describe.skip;

type ResolvedChatModel = {
	key: string;
	contextLength?: number;
};

type HttpRequestOptions = {
	method?: string;
	url: string;
	headers?: Record<string, string>;
	body?: unknown;
	json?: boolean;
	timeout?: number;
};

type ModelsResponse = {
	models?: Array<{
		type?: string;
		key?: string;
		display_name?: string;
		loaded_instances?: Array<{ id: string; config?: { context_length?: number } }>;
	}>;
};

function realHttpRequest(options: HttpRequestOptions): Promise<unknown> {
	return new Promise((resolve, reject) => {
		const url = new URL(options.url);
		const transport = url.protocol === 'https:' ? https : http;
		const bodyStr = options.body ? JSON.stringify(options.body) : undefined;

		const req = transport.request(
			{
				hostname: url.hostname,
				port: url.port,
				path: url.pathname + url.search,
				method: options.method ?? 'GET',
				headers: {
					...options.headers,
					...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr).toString() } : {}),
				},
				timeout: options.timeout,
			},
			(res) => {
				let data = '';
				res.on('data', (chunk: Buffer) => (data += chunk.toString()));
				res.on('end', () => {
					if (res.statusCode && res.statusCode >= 400) {
						reject(Object.assign(new Error(data), { statusCode: res.statusCode }));
						return;
					}
					try {
						resolve(options.json ? JSON.parse(data) : data);
					} catch {
						resolve(data);
					}
				});
			},
		);
		req.on('error', reject);
		if (bodyStr) req.write(bodyStr);
		req.end();
	});
}

async function resolveChatModel(): Promise<ResolvedChatModel> {
	if (!LM_STUDIO_URL) {
		throw new Error('LM_STUDIO_URL must be set');
	}

	if (LM_STUDIO_MODEL) {
		return { key: LM_STUDIO_MODEL };
	}

	const response = (await realHttpRequest({
		url: `${LM_STUDIO_URL}/api/v1/models`,
		method: 'GET',
		json: true,
	})) as ModelsResponse;

	const loadedModel = response.models?.find(
		(candidate) =>
			['llm', 'vlm'].includes(candidate.type ?? '') &&
			Array.isArray(candidate.loaded_instances) &&
			candidate.loaded_instances.length > 0,
	);
	if (loadedModel?.key) {
		return {
			key: loadedModel.key,
			contextLength: loadedModel.loaded_instances?.[0]?.config?.context_length,
		};
	}

	const model = response.models?.find((candidate) => ['llm', 'vlm'].includes(candidate.type ?? ''));
	if (!model?.key) {
		throw new Error('No chat-capable model found in LM Studio');
	}

	return { key: model.key };
}

function createRealExecuteMock(params: Record<string, unknown> = {}) {
	const defaults: Record<string, unknown> = {
		operation: 'sendMessage',
		modelName: '',
		loadModelName: '',
		instanceId: '',
		message: 'Say hi in one word.',
		jsonSchema: '{}',
		messageAdvancedOptions: {
			apiMode: 'openaiCompatible',
			temperature: 0.1,
			timeout: 60,
		},
		loadAdvancedOptions: {},
	};
	const merged = { ...defaults, ...params };

	return {
		getInputData: jest.fn().mockReturnValue([{ json: {} }]),
		getNodeParameter: jest
			.fn()
			.mockImplementation((name: string, _i: number, fallback?: unknown) => merged[name] ?? fallback),
		getNode: jest.fn().mockReturnValue({
			id: 'int-test',
			name: 'Integration Test',
			type: 'test',
			typeVersion: 1,
			position: [0, 0],
			parameters: {},
		}),
		getCredentials: jest.fn().mockResolvedValue({ hostUrl: LM_STUDIO_URL, apiKey: '' }),
		getExecutionId: jest.fn().mockReturnValue('int-exec-1'),
		getExecutionCancelSignal: jest.fn().mockReturnValue(undefined),
		continueOnFail: jest.fn().mockReturnValue(false),
		logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
		helpers: { httpRequest: jest.fn().mockImplementation(realHttpRequest) },
	} as unknown as IExecuteFunctions;
}

describeIf('LmStudio (integration)', () => {
	let node: LmStudio;
	let chatModel: ResolvedChatModel;

	beforeAll(async () => {
		node = new LmStudio();
		chatModel = await resolveChatModel();
	});

	it('getChatModels returns real models from LM Studio', async () => {
		const mock = {
			getCredentials: jest.fn().mockResolvedValue({ hostUrl: LM_STUDIO_URL, apiKey: '' }),
			helpers: { httpRequest: jest.fn().mockImplementation(realHttpRequest) },
		} as unknown as ILoadOptionsFunctions;

		const models = await node.methods.loadOptions.getChatModels.call(mock);

		expect(models.length).toBeGreaterThan(0);
		expect(models[0]).toHaveProperty('name');
		expect(models[0]).toHaveProperty('value');
	});

	it('lists models via the execute path', async () => {
		const mock = createRealExecuteMock({ operation: 'listModels' });

		const result = await node.execute.call(mock);

		expect(result[0].length).toBeGreaterThan(0);
		expect(result[0][0].json).toHaveProperty('id');
		expect(result[0][0].json).toHaveProperty('loaded');
	});

	it('lists loaded model instances via the execute path', async () => {
		const mock = createRealExecuteMock({ operation: 'listLoadedModels' });

		const result = await node.execute.call(mock);

		expect(Array.isArray(result[0])).toBe(true);
		for (const item of result[0]) {
			expect(item.json.loaded).toBe(true);
			expect(item.json).toHaveProperty('instanceId');
		}
	});

	it('sends a message and gets a text response in OpenAI-compatible mode', async () => {
		const mock = createRealExecuteMock({ modelName: chatModel.key });

		const result = await node.execute.call(mock);

		expect(result[0]).toHaveLength(1);
		expect(typeof result[0][0].json.response).toBe('string');
		expect((result[0][0].json.response as string).length).toBeGreaterThan(0);
		expect(result[0][0].json._metadata).toHaveProperty('model');
		expect(result[0][0].json._metadata).toHaveProperty('usage');
	}, 120_000);

	it('returns structured JSON when schema is provided', async () => {
		const schema = JSON.stringify({
			type: 'object',
			properties: {
				greeting: { type: 'string' },
			},
			required: ['greeting'],
		});
		const mock = createRealExecuteMock({
			modelName: chatModel.key,
			message: 'Return a JSON object with one greeting string.',
			jsonSchema: schema,
		});

		const result = await node.execute.call(mock);

		expect(result[0][0].json.response).toHaveProperty('greeting');
		expect(typeof (result[0][0].json.response as Record<string, unknown>).greeting).toBe(
			'string',
		);
	}, 120_000);

	it('sends a message through the native v1 API with context length', async () => {
		const mock = createRealExecuteMock({
			modelName: chatModel.key,
			message: 'Answer with exactly one short greeting.',
			messageAdvancedOptions: {
				apiMode: 'nativeV1',
				...(chatModel.contextLength ? { contextLength: chatModel.contextLength } : {}),
				temperature: 0.1,
				timeout: 60,
				store: false,
			},
		});

		const result = await node.execute.call(mock);

		expect(typeof result[0][0].json.response).toBe('string');
		expect((result[0][0].json.response as string).length).toBeGreaterThan(0);
		expect(result[0][0].json._metadata).toHaveProperty('modelInstanceId');
	}, 120_000);
});
