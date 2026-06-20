import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

interface LmStudioCredentials {
	hostUrl: string;
	apiKey?: string;
}

interface LmStudioV1LoadedInstance {
	id: string;
	config?: {
		context_length?: number;
		parallel?: number;
		[key: string]: unknown;
	};
	remaining_ttl_seconds?: number;
}

interface LmStudioV1Model {
	type?: string;
	publisher?: string;
	key?: string;
	display_name?: string;
	quantization?: { name?: string } | string | null;
	size_bytes?: number;
	params_string?: string | null;
	loaded_instances?: LmStudioV1LoadedInstance[];
	max_context_length?: number;
	format?: string;
	capabilities?: Record<string, unknown>;
	description?: string | null;
	variants?: string[];
	selected_variant?: string;
}

interface LmStudioV1ModelsResponse {
	models?: LmStudioV1Model[];
}

interface LmStudioV0Model {
	id: string;
	type?: string;
	publisher?: string;
	state?: string;
	quantization?: string | null;
	max_context_length?: number;
	loaded_context_length?: number;
	capabilities?: unknown;
	compatibility_type?: string;
}

interface LmStudioV0ModelsResponse {
	data?: LmStudioV0Model[];
}

interface NormalizedLoadedInstance {
	id: string;
	contextLength?: number;
	parallel?: number;
	remainingTtlSeconds?: number;
	raw: IDataObject;
}

interface NormalizedModel {
	id: string;
	displayName: string;
	type: string;
	publisher?: string;
	quantization?: string;
	format?: string;
	maxContextLength?: number;
	loadedContextLength?: number;
	loaded: boolean;
	state: 'loaded' | 'not-loaded';
	loadedInstances: NormalizedLoadedInstance[];
	variants?: string[];
	selectedVariant?: string;
	description?: string | null;
	capabilities?: Record<string, unknown>;
	raw: IDataObject;
}

interface LmStudioOpenAiChoice {
	message?: { content?: string | null };
	finish_reason?: string | null;
}

interface LmStudioOpenAiResponse {
	choices?: LmStudioOpenAiChoice[];
	model?: string;
	usage?: Record<string, unknown>;
	created?: number;
	id?: string;
}

interface LmStudioNativeOutputItem {
	type: string;
	content?: string;
	text?: string;
	output_text?: string;
	tool?: string;
	arguments?: Record<string, unknown>;
	output?: string;
	provider_info?: Record<string, unknown>;
	reason?: string;
	metadata?: Record<string, unknown>;
}

interface LmStudioNativeChatResponse {
	model_instance_id?: string;
	output?: LmStudioNativeOutputItem[];
	stats?: Record<string, unknown>;
	response_id?: string;
}

type RequestContext = {
	helpers: {
		httpRequest: (options: IHttpRequestOptions) => Promise<unknown>;
	};
};

type ChatApiMode = 'openaiCompatible' | 'nativeV1';

const JSON_SCHEMA_SAMPLE = `
{
	"type": "object",
	"properties": {
		"colors": {
			"type": "array",
			"items": { "type": "string" }
		}
	}
}
`;

function normalizeHostUrl(hostUrl: string): string {
	const trimmed = hostUrl.trim();
	const withProtocol =
		trimmed.startsWith('http://') || trimmed.startsWith('https://')
			? trimmed
			: `http://${trimmed}`;

	try {
		const url = new URL(withProtocol);
		url.pathname = url.pathname.replace(/\/+(api\/v[01]|v[01])\/?$/i, '').replace(/\/+$/, '');
		return url.toString().replace(/\/+$/, '');
	} catch {
		if (withProtocol.startsWith('http://') || withProtocol.startsWith('https://')) {
			return withProtocol.replace(/\/+$/, '').replace(/\/+(api\/v[01]|v[01])$/i, '');
		}
		return withProtocol.replace(/\/+$/, '').replace(/\/+(api\/v[01]|v[01])$/i, '');
	}
}

function buildUrl(hostUrl: string, path: string): string {
	return `${normalizeHostUrl(hostUrl)}${path}`;
}

function buildHeaders(apiKey?: string): Record<string, string> {
	const headers: Record<string, string> = {
		'Content-Type': 'application/json',
	};
	if (apiKey?.trim()) {
		headers.Authorization = `Bearer ${apiKey.trim()}`;
	}
	return headers;
}

function toDataObject(value: unknown): IDataObject {
	return (value ?? {}) as IDataObject;
}

function parseOptionalJson(
	node: IExecuteFunctions,
	value: unknown,
	fieldName: string,
	itemIndex: number,
): IDataObject {
	if (value === undefined || value === null || value === '') {
		return {};
	}

	if (typeof value === 'object' && !Array.isArray(value)) {
		return value as IDataObject;
	}

	if (typeof value !== 'string') {
		throw new NodeOperationError(node.getNode(), `${fieldName} must be valid JSON`, {
			itemIndex,
		});
	}

	try {
		const parsed = JSON.parse(value) as unknown;
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
			throw new NodeOperationError(node.getNode(), `${fieldName} must be a JSON object`, {
				itemIndex,
			});
		}
		return parsed as IDataObject;
	} catch (error) {
		if (error instanceof NodeOperationError) {
			throw error;
		}

		throw new NodeOperationError(
			node.getNode(),
			`Invalid ${fieldName}: ${(error as Error).message}`,
			{ itemIndex },
		);
	}
}

function getNumberOption(options: IDataObject, key: string): number | undefined {
	const value = options[key];
	return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function getStringOption(options: IDataObject, key: string): string | undefined {
	const value = options[key];
	return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function extractNativeOutputText(item: LmStudioNativeOutputItem): string | undefined {
	const candidates = [item.content, item.text, item.output_text, item.output];

	for (const candidate of candidates) {
		if (typeof candidate === 'string' && candidate.trim()) {
			return candidate;
		}
	}

	return undefined;
}

function getBooleanOption(options: IDataObject, key: string): boolean | undefined {
	return typeof options[key] === 'boolean' ? (options[key] as boolean) : undefined;
}

function inferImageMimeType(fileExtension?: string): string | undefined {
	switch (fileExtension?.toLowerCase()) {
		case 'jpg':
		case 'jpeg':
			return 'image/jpeg';
		case 'png':
			return 'image/png';
		case 'webp':
			return 'image/webp';
		case 'gif':
			return 'image/gif';
		case 'bmp':
			return 'image/bmp';
		default:
			return undefined;
	}
}

async function buildNativeInput(
	node: IExecuteFunctions,
	item: INodeExecutionData,
	itemIndex: number,
	message: string,
	imageBinaryProperty?: string,
	textInputType: 'message' | 'text' = 'text',
): Promise<string | IDataObject[]> {
	if (!imageBinaryProperty) {
		return message;
	}

	const binaryFile = item.binary?.[imageBinaryProperty];
	if (!binaryFile) {
		throw new NodeOperationError(
			node.getNode(),
			`Binary property "${imageBinaryProperty}" was not found on the input item.`,
			{ itemIndex },
		);
	}

	const mimeType =
		(typeof binaryFile.mimeType === 'string' && binaryFile.mimeType) ||
		inferImageMimeType(binaryFile.fileExtension);

	if (!mimeType?.startsWith('image/')) {
		throw new NodeOperationError(
			node.getNode(),
			`Binary property "${imageBinaryProperty}" must contain an image file.`,
			{ itemIndex },
		);
	}

	const buffer = await node.helpers.getBinaryDataBuffer(itemIndex, imageBinaryProperty);
	const dataUrl = `data:${mimeType};base64,${buffer.toString('base64')}`;

	return [
		textInputType === 'text'
			? { type: 'text', content: message }
			: { type: 'message', content: message },
		{ type: 'image', data_url: dataUrl },
	];
}

function cloneNativeRequestBody(body: IDataObject): IDataObject {
	return {
		...body,
		...(Array.isArray(body.input)
			? {
					input: body.input.map((entry) =>
						entry && typeof entry === 'object' ? { ...(entry as IDataObject) } : entry,
					),
				}
			: {}),
	};
}

function normalizeQuantization(quantization: unknown): string | undefined {
	if (!quantization) {
		return undefined;
	}
	if (typeof quantization === 'string') {
		return quantization;
	}
	if (typeof quantization === 'object' && 'name' in (quantization as Record<string, unknown>)) {
		const name = (quantization as { name?: unknown }).name;
		return typeof name === 'string' ? name : undefined;
	}
	return undefined;
}

function normalizeModelsResponse(response: unknown): NormalizedModel[] {
	if (
		response &&
		typeof response === 'object' &&
		Array.isArray((response as LmStudioV1ModelsResponse).models)
	) {
		return ((response as LmStudioV1ModelsResponse).models ?? []).map((model) => {
			const id = model.key ?? model.display_name ?? 'unknown-model';
			const loadedInstances = (model.loaded_instances ?? []).map((instance) => ({
				id: instance.id,
				contextLength: instance.config?.context_length,
				parallel: instance.config?.parallel,
				remainingTtlSeconds: instance.remaining_ttl_seconds,
				raw: toDataObject(instance),
			}));

			return {
				id,
				displayName: model.display_name ?? id,
				type: model.type ?? 'unknown',
				publisher: model.publisher,
				quantization: normalizeQuantization(model.quantization),
				format: model.format,
				maxContextLength: model.max_context_length,
				loadedContextLength: loadedInstances[0]?.contextLength,
				loaded: loadedInstances.length > 0,
				state: loadedInstances.length > 0 ? 'loaded' : 'not-loaded',
				loadedInstances,
				variants: model.variants,
				selectedVariant: model.selected_variant,
				description: model.description,
				capabilities: model.capabilities,
				raw: toDataObject(model),
			};
		});
	}

	if (
		response &&
		typeof response === 'object' &&
		Array.isArray((response as LmStudioV0ModelsResponse).data)
	) {
		return ((response as LmStudioV0ModelsResponse).data ?? []).map((model) => {
			const loaded = model.state === 'loaded';
			return {
				id: model.id,
				displayName: model.id,
				type: model.type ?? 'unknown',
				publisher: model.publisher,
				quantization: normalizeQuantization(model.quantization),
				format: model.compatibility_type,
				maxContextLength: model.max_context_length,
				loadedContextLength: model.loaded_context_length,
				loaded,
				state: loaded ? 'loaded' : 'not-loaded',
				loadedInstances: loaded
					? [
							{
								id: model.id,
								contextLength: model.loaded_context_length,
								raw: toDataObject(model),
							},
						]
					: [],
				capabilities: Array.isArray(model.capabilities)
					? { values: model.capabilities }
					: undefined,
				raw: toDataObject(model),
			};
		});
	}

	return [];
}

async function lmStudioRequest<T>(
	context: RequestContext,
	credentials: LmStudioCredentials,
	options: {
		method: 'GET' | 'POST';
		path: string;
		body?: IDataObject;
		timeoutMs?: number;
		abortSignal?: AbortSignal;
	},
): Promise<T> {
	const requestOptions: IHttpRequestOptions = {
		method: options.method,
		url: buildUrl(credentials.hostUrl, options.path),
		headers: buildHeaders(credentials.apiKey),
		json: true,
		abortSignal: options.abortSignal,
	};

	if (options.body) {
		requestOptions.body = options.body;
	}

	if (options.timeoutMs && options.timeoutMs > 0) {
		requestOptions.timeout = options.timeoutMs;
	}

	return (await context.helpers.httpRequest(requestOptions)) as T;
}

async function fetchModels(
	context: RequestContext,
	credentials: LmStudioCredentials,
): Promise<NormalizedModel[]> {
	try {
		const response = await lmStudioRequest<unknown>(context, credentials, {
			method: 'GET',
			path: '/api/v1/models',
		});
		const models = normalizeModelsResponse(response);
		if (models.length > 0) {
			return models;
		}
	} catch (error) {
		void error;
	}

	const fallback = await lmStudioRequest<unknown>(context, credentials, {
		method: 'GET',
		path: '/api/v0/models',
	});
	return normalizeModelsResponse(fallback);
}

function toModelOption(model: NormalizedModel): INodePropertyOptions {
	const detailParts = [
		model.type,
		model.quantization ? `Quantization: ${model.quantization}` : undefined,
		model.maxContextLength ? `Max Context: ${model.maxContextLength}` : undefined,
		model.loaded ? 'Loaded' : 'Not loaded',
	]
		.filter(Boolean)
		.join(' | ');

	return {
		name: `${model.displayName}${model.loaded ? ' (loaded)' : ''}`,
		value: model.id,
		description: detailParts || undefined,
	};
}

function getErrorText(error: unknown): string {
	if (error instanceof Error) {
		const details = [error.message];
		const candidate = error as { description?: string; context?: { body?: unknown } };
		if (candidate.description) {
			details.push(candidate.description);
		}
		if (candidate.context?.body) {
			details.push(JSON.stringify(candidate.context.body));
		}
		return details.join(' | ');
	}

	return String(error);
}

function isUnsupportedLoadTtlError(error: unknown): boolean {
	return getErrorText(error).includes("Unrecognized key(s) in object: 'ttl'");
}

function buildLoadModelErrorMessage(
	modelName: string,
	requestBody: IDataObject,
	error: unknown,
): string {
	return [
		`LM Studio model load failed for "${modelName}" via /api/v1/models/load.`,
		`Request body: ${JSON.stringify(requestBody)}.`,
		`LM Studio error: ${getErrorText(error)}`,
	].join(' ');
}

function buildLoadModelErrorDetails(
	modelName: string,
	requestBody: IDataObject,
	error: unknown,
): IDataObject {
	return {
		endpoint: '/api/v1/models/load',
		modelName,
		requestBody,
		error: getErrorText(error),
	};
}

function toContinueOnFailJson(error: unknown): IDataObject {
	if (error instanceof NodeOperationError) {
		let errorDetails: IDataObject | string | undefined;
		if (typeof error.description === 'string' && error.description.length > 0) {
			try {
				errorDetails = JSON.parse(error.description) as IDataObject;
			} catch {
				errorDetails = error.description;
			}
		}

		return {
			error: error.message,
			errorType: error.type,
			errorDescription: error.description,
			errorDetails,
		};
	}

	if (error instanceof NodeApiError) {
		return {
			error: error.message,
			errorDescription: error.description,
		};
	}

	return {
		error: error instanceof Error ? error.message : String(error),
	};
}

export class LmStudio implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'LM Studio',
		name: 'lmStudio',
		icon: { light: 'file:lmstudio.svg', dark: 'file:lmstudio.dark.svg' },
		group: ['output'],
		version: 1,
		description: 'Chat with LM Studio and manage local models from n8n',
		defaults: {
			name: 'LM Studio',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		credentials: [
			{
				name: 'lmStudioApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				default: 'sendMessage',
				options: [
					{
						name: 'List Loaded Models',
						value: 'listLoadedModels',
						description: 'List only currently loaded model instances',
						action: 'List loaded models',
					},
					{
						name: 'List Models',
						value: 'listModels',
						description: 'List all LM Studio models and their state',
						action: 'List models',
					},
					{
						name: 'Load Model',
						value: 'loadModel',
						description: 'Load a model into memory',
						action: 'Load a model',
					},
					{
						name: 'Send Message',
						value: 'sendMessage',
						description: 'Send a prompt to a model',
						action: 'Send a message to a model',
					},
					{
						name: 'Unload Model',
						value: 'unloadModel',
						description: 'Unload a running model instance',
						action: 'Unload a model',
					},
				],
			},
			{
				displayName: 'Model Name or ID',
				name: 'modelName',
				type: 'options',
				typeOptions: {
					loadOptionsMethod: 'getChatModels',
				},
				default: '',
				required: true,
				displayOptions: {
					show: {
						operation: ['sendMessage'],
					},
				},
				description:
					'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
			},
			{
				displayName: 'Message',
				name: 'message',
				type: 'string',
				typeOptions: {
					rows: 4,
				},
				default: '',
				required: true,
				displayOptions: {
					show: {
						operation: ['sendMessage'],
					},
				},
				description: 'The user message to send to the model',
			},
			{
				displayName: 'JSON Schema',
				name: 'jsonSchema',
				type: 'json',
				typeOptions: {
					rows: 10,
				},
				default: '{}',
				placeholder: JSON_SCHEMA_SAMPLE,
				displayOptions: {
					show: {
						operation: ['sendMessage'],
					},
				},
				description:
					'Optional structured-output schema. Currently supported when API Mode is OpenAI Compatible.',
			},
			{
				displayName: 'Advanced',
				name: 'messageAdvancedOptions',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				displayOptions: {
					show: {
						operation: ['sendMessage'],
					},
				},
				options: [
					{
						displayName: 'API Mode',
						name: 'apiMode',
						type: 'options',
						default: 'openaiCompatible',
						options: [
							{
								name: 'OpenAI Compatible',
								value: 'openaiCompatible',
							},
							{
								name: 'Native API V1',
								value: 'nativeV1',
							},
						],
						description:
							'OpenAI Compatible keeps structured JSON schema support. Native API v1 exposes LM Studio-specific chat options like context length.',
					},
					{
						displayName: 'Context Length',
						name: 'contextLength',
						type: 'number',
						typeOptions: {
							minValue: 1,
						},
						default: 0,
						description: 'Native API v1 only. Maximum context length for the request.',
					},
					{
						displayName: 'Image Binary Property',
						name: 'imageBinaryProperty',
						type: 'string',
						default: '',
						description:
							'Native API v1 only. Optional binary property containing an image to send for vision or OCR requests.',
					},
					{
						displayName: 'Max Output Tokens',
						name: 'maxOutputTokens',
						type: 'number',
						typeOptions: {
							minValue: 1,
						},
						default: 0,
						description: 'Maximum number of tokens to generate',
					},
					{
						displayName: 'Min P',
						name: 'minP',
						type: 'number',
						typeOptions: {
							minValue: 0,
							maxValue: 1,
							numberPrecision: 3,
						},
						default: 0,
						description: 'Minimum base probability for token selection',
					},
					{
						displayName: 'Previous Response ID',
						name: 'previousResponseId',
						type: 'string',
						default: '',
						description: 'Native API v1 only. Continue a stored chat response chain.',
					},
					{
						displayName: 'Raw Advanced JSON',
						name: 'rawOptionsJson',
						type: 'json',
						typeOptions: {
							rows: 6,
						},
						default: '{}',
						description:
							'Additional request fields merged into the LM Studio request body. Use this to access API options that are not exposed individually.',
					},
					{
						displayName: 'Reasoning',
						name: 'reasoning',
						type: 'options',
						default: 'off',
						options: [
							{ name: 'High', value: 'high' },
							{ name: 'Low', value: 'low' },
							{ name: 'Medium', value: 'medium' },
							{ name: 'Off', value: 'off' },
							{ name: 'On', value: 'on' },
						],
						description: 'Native API v1 only. Reasoning mode for supported models.',
					},
					{
						displayName: 'Repeat Penalty',
						name: 'repeatPenalty',
						type: 'number',
						typeOptions: {
							minValue: 0,
							numberPrecision: 2,
						},
						default: 0,
						description: 'Penalty for repeated token sequences',
					},
					{
						displayName: 'Seed',
						name: 'seed',
						type: 'number',
						default: 0,
						description: 'Random seed for deterministic output where supported',
					},
					{
						displayName: 'Store Chat',
						name: 'store',
						type: 'boolean',
						default: true,
						description: 'Whether LM Studio should store the chat thread',
					},
					{
						displayName: 'System Prompt',
						name: 'systemPrompt',
						type: 'string',
						default: '',
						typeOptions: {
							rows: 3,
						},
						description: 'Optional system prompt for the model',
					},
					{
						displayName: 'Temperature',
						name: 'temperature',
						type: 'number',
						typeOptions: {
							minValue: 0,
							maxValue: 2,
							numberPrecision: 2,
						},
						default: 0.3,
						description: 'Controls randomness in generation',
					},
					{
						displayName: 'Timeout (Seconds)',
						name: 'timeout',
						type: 'number',
						typeOptions: {
							minValue: 0,
						},
						default: 0,
						description: 'HTTP timeout. Set to 0 to disable.',
					},
					{
						displayName: 'Top K',
						name: 'topK',
						type: 'number',
						typeOptions: {
							minValue: 1,
						},
						default: 0,
						description: 'Limit next-token selection to the top-k tokens',
					},
					{
						displayName: 'Top P',
						name: 'topP',
						type: 'number',
						typeOptions: {
							minValue: 0,
							maxValue: 1,
							numberPrecision: 2,
						},
						default: 0,
						description: 'Nucleus sampling threshold',
					},
				],
			},
			{
				displayName: 'Model Name or ID',
				name: 'loadModelName',
				type: 'options',
				typeOptions: {
					loadOptionsMethod: 'getAllModels',
				},
				default: '',
				required: true,
				displayOptions: {
					show: {
						operation: ['loadModel'],
					},
				},
				description:
					'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
			},
			{
				displayName: 'Advanced',
				name: 'loadAdvancedOptions',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				displayOptions: {
					show: {
						operation: ['loadModel'],
					},
				},
				options: [
					{
						displayName: 'Context Length',
						name: 'contextLength',
						type: 'number',
						typeOptions: {
							minValue: 1,
						},
						default: 0,
						description: 'Maximum number of tokens the model will consider',
					},
					{
						displayName: 'Eval Batch Size',
						name: 'evalBatchSize',
						type: 'number',
						typeOptions: {
							minValue: 1,
						},
						default: 0,
						description: 'Llama.cpp engines only. Number of input tokens evaluated together.',
					},
					{
						displayName: 'Flash Attention',
						name: 'flashAttention',
						type: 'boolean',
						default: false,
						description: 'Whether to enable flash attention where supported',
					},
					{
						displayName: 'Number of Experts',
						name: 'numExperts',
						type: 'number',
						typeOptions: {
							minValue: 1,
						},
						default: 0,
						description: 'Mixture-of-experts models only',
					},
					{
						displayName: 'Offload KV Cache to GPU',
						name: 'offloadKvCacheToGpu',
						type: 'boolean',
						default: false,
						description: 'Whether to move the KV cache to the GPU where supported',
					},
					{
						displayName: 'Raw Advanced JSON',
						name: 'rawOptionsJson',
						type: 'json',
						typeOptions: {
							rows: 6,
						},
						default: '{}',
						description:
							'Additional load request fields merged into the request body for unsupported LM Studio options',
					},
					{
						displayName: 'TTL Seconds',
						name: 'ttlSeconds',
						type: 'number',
						typeOptions: {
							minValue: 1,
						},
						default: 0,
						description: 'Automatically unload the model after the given idle time',
					},
				],
			},
			{
				displayName: 'Instance Name or ID',
				name: 'instanceId',
				type: 'options',
				typeOptions: {
					loadOptionsMethod: 'getLoadedInstances',
				},
				default: '',
				required: true,
				displayOptions: {
					show: {
						operation: ['unloadModel'],
					},
				},
				description:
					'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
			},
		],
	};

	methods = {
		loadOptions: {
			async getChatModels(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				try {
					const credentials = (await this.getCredentials('lmStudioApi')) as LmStudioCredentials;
					const models = await fetchModels(this as unknown as RequestContext, credentials);
					const options = models
						.filter((model) => ['llm', 'vlm'].includes(model.type))
						.map(toModelOption)
						.sort((a, b) => a.name.localeCompare(b.name));

					return options.length > 0 ? options : [{ name: 'No Chat Models Found', value: '' }];
				} catch {
					return [{ name: 'Could Not Connect to LM Studio', value: '' }];
				}
			},
			async getAllModels(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				try {
					const credentials = (await this.getCredentials('lmStudioApi')) as LmStudioCredentials;
					const models = await fetchModels(this as unknown as RequestContext, credentials);
					const options = models.map(toModelOption).sort((a, b) => a.name.localeCompare(b.name));
					return options.length > 0 ? options : [{ name: 'No Models Found', value: '' }];
				} catch {
					return [{ name: 'Could Not Connect to LM Studio', value: '' }];
				}
			},
			async getLoadedInstances(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				try {
					const credentials = (await this.getCredentials('lmStudioApi')) as LmStudioCredentials;
					const models = await fetchModels(this as unknown as RequestContext, credentials);
					const instances = models
						.flatMap((model) =>
							model.loadedInstances.map((instance) => {
								const suffix = instance.contextLength
									? ` | Context: ${instance.contextLength}`
									: '';
								return {
									name: `${instance.id}${suffix}`,
									value: instance.id,
									description: `${model.displayName} | ${model.type}`,
								};
							}),
						)
						.sort((a, b) => a.name.localeCompare(b.name));

					return instances.length > 0
						? instances
						: [{ name: 'No Loaded Model Instances Found', value: '' }];
				} catch {
					return [{ name: 'Could Not Connect to LM Studio', value: '' }];
				}
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		const logger = this.logger;
		const executionId = this.getExecutionId?.() ?? 'unknown';
		const credentials = (await this.getCredentials('lmStudioApi')) as LmStudioCredentials;

		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			try {
				const operation = this.getNodeParameter('operation', itemIndex) as string;

				logger.info(`[${executionId}] Starting LM Studio operation`, {
					itemIndex,
					operation,
				});

				if (operation === 'listLoadedModels') {
					const models = await fetchModels(this as unknown as RequestContext, credentials);
					const loadedModels = models.filter((model) => model.loaded);

					for (const model of loadedModels) {
						for (const instance of model.loadedInstances) {
							returnData.push({
								json: {
									id: model.id,
									displayName: model.displayName,
									type: model.type,
									publisher: model.publisher,
									quantization: model.quantization,
									format: model.format,
									maxContextLength: model.maxContextLength,
									loadedContextLength: model.loadedContextLength,
									loaded: model.loaded,
									state: model.state,
									instanceId: instance.id,
									instanceContextLength: instance.contextLength,
									instanceParallel: instance.parallel,
									instanceRemainingTtlSeconds: instance.remainingTtlSeconds,
									instanceRaw: instance.raw,
									loadedInstances: model.loadedInstances,
									variants: model.variants,
									selectedVariant: model.selectedVariant,
									description: model.description,
									capabilities: model.capabilities,
									raw: model.raw,
								},
								pairedItem: { item: itemIndex },
							});
						}
					}
					continue;
				}

				if (operation === 'listModels') {
					const models = await fetchModels(this as unknown as RequestContext, credentials);
					for (const model of models) {
						returnData.push({
							json: {
								id: model.id,
								displayName: model.displayName,
								type: model.type,
								publisher: model.publisher,
								quantization: model.quantization,
								format: model.format,
								maxContextLength: model.maxContextLength,
								loadedContextLength: model.loadedContextLength,
								loaded: model.loaded,
								state: model.state,
								loadedInstances: model.loadedInstances,
								variants: model.variants,
								selectedVariant: model.selectedVariant,
								description: model.description,
								capabilities: model.capabilities,
								raw: model.raw,
							},
							pairedItem: { item: itemIndex },
						});
					}
					continue;
				}

				if (operation === 'loadModel') {
					const modelName = this.getNodeParameter('loadModelName', itemIndex) as string;
					const advanced = this.getNodeParameter(
						'loadAdvancedOptions',
						itemIndex,
						{},
					) as IDataObject;
					const rawOptions = parseOptionalJson(
						this,
						advanced.rawOptionsJson,
						'Raw Advanced JSON',
						itemIndex,
					);

					const requestBody: IDataObject = {
						model: modelName,
						echo_load_config: true,
						...rawOptions,
					};

					const contextLength = getNumberOption(advanced, 'contextLength');
					if (contextLength && contextLength > 0) {
						requestBody.context_length = contextLength;
					}

					const evalBatchSize = getNumberOption(advanced, 'evalBatchSize');
					if (evalBatchSize && evalBatchSize > 0) {
						requestBody.eval_batch_size = evalBatchSize;
					}

					const flashAttention = getBooleanOption(advanced, 'flashAttention');
					if (flashAttention !== undefined) {
						requestBody.flash_attention = flashAttention;
					}

					const offloadKvCacheToGpu = getBooleanOption(advanced, 'offloadKvCacheToGpu');
					if (offloadKvCacheToGpu !== undefined) {
						requestBody.offload_kv_cache_to_gpu = offloadKvCacheToGpu;
					}

					const numExperts = getNumberOption(advanced, 'numExperts');
					if (numExperts && numExperts > 0) {
						requestBody.num_experts = numExperts;
					}

					const ttlSeconds = getNumberOption(advanced, 'ttlSeconds');
					if (ttlSeconds && ttlSeconds > 0) {
						requestBody.ttl = ttlSeconds;
					}

					let response: IDataObject;
					const initialRequestBody: IDataObject = { ...requestBody };
					try {
						response = await lmStudioRequest<IDataObject>(
							this as unknown as RequestContext,
							credentials,
							{
								method: 'POST',
								path: '/api/v1/models/load',
								body: initialRequestBody,
							},
						);
					} catch (error) {
						if ('ttl' in initialRequestBody && isUnsupportedLoadTtlError(error)) {
							const retryRequestBody: IDataObject = { ...initialRequestBody };
							delete retryRequestBody.ttl;
							try {
								response = await lmStudioRequest<IDataObject>(
									this as unknown as RequestContext,
									credentials,
									{
										method: 'POST',
										path: '/api/v1/models/load',
										body: retryRequestBody,
									},
								);
							} catch (retryError) {
								throw new NodeOperationError(
									this.getNode(),
									buildLoadModelErrorMessage(modelName, retryRequestBody, retryError),
									{
										itemIndex,
										type: 'model_load_failed',
										description: JSON.stringify(
											buildLoadModelErrorDetails(modelName, retryRequestBody, retryError),
										),
									},
								);
							}
						} else {
							throw new NodeOperationError(
								this.getNode(),
								buildLoadModelErrorMessage(modelName, initialRequestBody, error),
								{
									itemIndex,
									type: 'model_load_failed',
									description: JSON.stringify(
										buildLoadModelErrorDetails(modelName, initialRequestBody, error),
									),
								},
							);
						}
					}

					returnData.push({
						json: {
							operation,
							model: modelName,
							response,
						},
						pairedItem: { item: itemIndex },
					});
					continue;
				}

				if (operation === 'unloadModel') {
					const instanceId = this.getNodeParameter('instanceId', itemIndex) as string;
					const response = await lmStudioRequest<IDataObject>(
						this as unknown as RequestContext,
						credentials,
						{
							method: 'POST',
							path: '/api/v1/models/unload',
							body: { instance_id: instanceId },
						},
					);

					returnData.push({
						json: {
							operation,
							instanceId,
							response,
						},
						pairedItem: { item: itemIndex },
					});
					continue;
				}

				const modelName = this.getNodeParameter('modelName', itemIndex) as string;
				const message = this.getNodeParameter('message', itemIndex) as string;
				const jsonSchemaStr = this.getNodeParameter('jsonSchema', itemIndex, '{}') as string;
				const advanced = this.getNodeParameter(
					'messageAdvancedOptions',
					itemIndex,
					{},
				) as IDataObject;
				const rawOptions = parseOptionalJson(
					this,
					advanced.rawOptionsJson,
					'Raw Advanced JSON',
					itemIndex,
				);
				const apiMode = (advanced.apiMode as ChatApiMode) || 'openaiCompatible';
				const timeout = getNumberOption(advanced, 'timeout') ?? 0;
				const abortSignal = this.getExecutionCancelSignal?.();

				logger.info(`[${executionId}] Sending LM Studio message`, {
					itemIndex,
					model: modelName,
					apiMode,
					messageLength: message.length,
				});

				if (apiMode === 'nativeV1') {
					if (jsonSchemaStr && jsonSchemaStr.trim() && jsonSchemaStr.trim() !== '{}') {
						throw new NodeOperationError(
							this.getNode(),
							'JSON Schema is currently only supported in OpenAI Compatible mode.',
							{ itemIndex },
						);
					}

					const imageBinaryProperty =
						getStringOption(advanced, 'imageBinaryProperty') ??
						(this.getNodeParameter('imageBinaryProperty', itemIndex, '') as string);
					const input = await buildNativeInput(
						this,
						items[itemIndex] as INodeExecutionData,
						itemIndex,
						message,
						imageBinaryProperty,
					);

					const requestBody: IDataObject = {
						model: modelName,
						input,
						...rawOptions,
					};

					const systemPrompt = getStringOption(advanced, 'systemPrompt');
					if (systemPrompt) {
						requestBody.system_prompt = systemPrompt;
					}

					const contextLength = getNumberOption(advanced, 'contextLength');
					if (contextLength && contextLength > 0) {
						requestBody.context_length = contextLength;
					}

					const temperature = getNumberOption(advanced, 'temperature');
					if (temperature !== undefined) {
						requestBody.temperature = temperature;
					}

					const topP = getNumberOption(advanced, 'topP');
					if (topP !== undefined) {
						requestBody.top_p = topP;
					}

					const topK = getNumberOption(advanced, 'topK');
					if (topK !== undefined) {
						requestBody.top_k = topK;
					}

					const minP = getNumberOption(advanced, 'minP');
					if (minP !== undefined) {
						requestBody.min_p = minP;
					}

					const repeatPenalty = getNumberOption(advanced, 'repeatPenalty');
					if (repeatPenalty !== undefined) {
						requestBody.repeat_penalty = repeatPenalty;
					}

					const maxOutputTokens = getNumberOption(advanced, 'maxOutputTokens');
					if (maxOutputTokens && maxOutputTokens > 0) {
						requestBody.max_output_tokens = maxOutputTokens;
					}

					const reasoning = getStringOption(advanced, 'reasoning');
					if (reasoning) {
						requestBody.reasoning = reasoning;
					}

					const seed = getNumberOption(advanced, 'seed');
					if (seed !== undefined) {
						requestBody.seed = seed;
					}

					const store = getBooleanOption(advanced, 'store');
					if (store !== undefined) {
						requestBody.store = store;
					}

					const previousResponseId = getStringOption(advanced, 'previousResponseId');
					if (previousResponseId) {
						requestBody.previous_response_id = previousResponseId;
					}

					const requestVariants: IDataObject[] = [cloneNativeRequestBody(requestBody)];
					if (reasoning) {
						requestVariants.push(
							...requestVariants.map((variant) => {
								const withoutReasoning = cloneNativeRequestBody(variant);
								delete withoutReasoning.reasoning;
								return withoutReasoning;
							}),
						);
					}
					if (imageBinaryProperty) {
						requestVariants.push(
							...requestVariants.map((variant) => ({
								...cloneNativeRequestBody(variant),
								input: buildNativeInput(
									this,
									items[itemIndex] as INodeExecutionData,
									itemIndex,
									message,
									imageBinaryProperty,
									'message',
								),
							})),
						);
					}

					for (const variant of requestVariants) {
						if (variant.input instanceof Promise) {
							variant.input = await variant.input;
						}
					}

					const seenVariantKeys = new Set<string>();
					const dedupedVariants = requestVariants.filter((variant) => {
						const key = JSON.stringify(variant);
						if (seenVariantKeys.has(key)) {
							return false;
						}
						seenVariantKeys.add(key);
						return true;
					});

					let response: LmStudioNativeChatResponse | undefined;
					let lastError: unknown;
					for (const variant of dedupedVariants) {
						try {
							response = await lmStudioRequest<LmStudioNativeChatResponse>(
								this as unknown as RequestContext,
								credentials,
								{
									method: 'POST',
									path: '/api/v1/chat',
									body: variant,
									timeoutMs: timeout > 0 ? timeout * 1000 : undefined,
									abortSignal,
								},
							);
							break;
						} catch (error) {
							lastError = error;
						}
					}

					if (!response) {
						throw lastError;
					}

					const output = Array.isArray(response.output) ? response.output : [];
					const messages = output
						.map((item) => ({
							type: item.type,
							text: extractNativeOutputText(item),
						}))
						.filter(
							(item) =>
								Boolean(item.text) &&
								(item.type === 'message' ||
									item.type === 'text' ||
									item.type === 'output_text' ||
									item.type === 'assistant'),
						)
						.map((item) => item.text as string);
					const reasoningItems = output
						.map((item) => ({
							type: item.type,
							text: extractNativeOutputText(item),
						}))
						.filter(
							(item) =>
								Boolean(item.text) &&
								(item.type === 'reasoning' || item.type === 'reasoning_text'),
						)
						.map((item) => item.text as string);
					const toolCalls = output.filter((item) => item.type === 'tool_call');

					if (messages.length === 0) {
						throw new NodeOperationError(
							this.getNode(),
							'No message content in response from LM Studio',
							{ itemIndex },
						);
					}

					returnData.push({
						json: {
							response: messages.join('\n\n'),
							reasoning: reasoningItems,
							toolCalls,
							output,
							_metadata: {
								apiMode,
								modelInstanceId: response.model_instance_id,
								stats: response.stats,
								responseId: response.response_id,
							},
						},
						pairedItem: { item: itemIndex },
					});
					continue;
				}

				const requestBody: IDataObject = {
					model: modelName,
					messages: [{ role: 'user', content: message }],
					...rawOptions,
				};

				const systemPrompt = getStringOption(advanced, 'systemPrompt');
				if (systemPrompt) {
					requestBody.messages = [
						{ role: 'system', content: systemPrompt },
						{ role: 'user', content: message },
					];
				}

				const temperature = getNumberOption(advanced, 'temperature');
				if (temperature !== undefined) {
					requestBody.temperature = temperature;
				}

				const topP = getNumberOption(advanced, 'topP');
				if (topP !== undefined) {
					requestBody.top_p = topP;
				}

				const topK = getNumberOption(advanced, 'topK');
				if (topK !== undefined) {
					requestBody.top_k = topK;
				}

				const minP = getNumberOption(advanced, 'minP');
				if (minP !== undefined) {
					requestBody.min_p = minP;
				}

				const repeatPenalty = getNumberOption(advanced, 'repeatPenalty');
				if (repeatPenalty !== undefined) {
					requestBody.repeat_penalty = repeatPenalty;
				}

				const maxOutputTokens = getNumberOption(advanced, 'maxOutputTokens');
				if (maxOutputTokens && maxOutputTokens > 0) {
					requestBody.max_tokens = maxOutputTokens;
				}

				const seed = getNumberOption(advanced, 'seed');
				if (seed !== undefined) {
					requestBody.seed = seed;
				}

				let hasJsonSchema = false;
				if (jsonSchemaStr && jsonSchemaStr.trim() && jsonSchemaStr.trim() !== '{}') {
					const parsedSchema = parseOptionalJson(
						this,
						jsonSchemaStr,
						'JSON Schema',
						itemIndex,
					);
					requestBody.response_format = {
						type: 'json_schema',
						json_schema: {
							name: 'outputSchema',
							strict: true,
							schema: parsedSchema,
						},
					};
					hasJsonSchema = true;
				}

				let response: LmStudioOpenAiResponse;
				try {
					response = await lmStudioRequest<LmStudioOpenAiResponse>(
						this as unknown as RequestContext,
						credentials,
						{
							method: 'POST',
							path: '/v1/chat/completions',
							body: requestBody,
							timeoutMs: timeout > 0 ? timeout * 1000 : undefined,
							abortSignal,
						},
					);
				} catch (error) {
					const err = error as NodeApiError & {
						code?: string;
						cause?: { code?: string };
					};
					const errorCode = err.code ?? err.cause?.code;
					const isTimeout =
						errorCode === 'ETIMEDOUT' ||
						errorCode === 'ESOCKETTIMEDOUT' ||
						errorCode === 'ECONNABORTED';

					if (isTimeout) {
						const timeoutMessage =
							timeout > 0
								? `Request timed out after ${timeout} seconds. Consider increasing the timeout for larger models.`
								: 'Request timed out. This may indicate a network issue or an unresponsive LM Studio server.';
						throw new NodeOperationError(this.getNode(), timeoutMessage, {
							itemIndex,
						});
					}

					throw new NodeApiError(this.getNode(), error as JsonObject, {
						itemIndex,
						message: `LM Studio request failed: ${err.message}`,
					});
				}

				const content = response.choices?.[0]?.message?.content;
				if (!content) {
					throw new NodeOperationError(
						this.getNode(),
						'No content in response from LM Studio',
						{ itemIndex },
					);
				}

				const metadata = {
					apiMode,
					model: response.model,
					usage: response.usage,
					created: response.created,
					id: response.id,
					finish_reason: response.choices?.[0]?.finish_reason,
				};

				let responseData: IDataObject;
				if (hasJsonSchema) {
					try {
						const parsedContent = JSON.parse(content) as IDataObject;
						responseData = {
							response: parsedContent,
							_metadata: metadata,
						};
					} catch (parseError) {
						throw new NodeOperationError(
							this.getNode(),
							`Failed to parse response as JSON: ${(parseError as Error).message}. Content: ${content}`,
							{ itemIndex },
						);
					}
				} else {
					responseData = {
						response: content,
						_metadata: metadata,
					};
				}

				returnData.push({
					json: responseData,
					pairedItem: { item: itemIndex },
				});
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: toContinueOnFailJson(error),
						pairedItem: { item: itemIndex },
					});
					continue;
				}

				if (error instanceof NodeApiError || error instanceof NodeOperationError) {
					throw error;
				}

				throw new NodeOperationError(this.getNode(), error as Error, { itemIndex });
			}
		}

		return [returnData];
	}
}
