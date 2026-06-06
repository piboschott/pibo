import type { Model } from "@mariozechner/pi-ai";
import { ModelRegistry } from "@mariozechner/pi-coding-agent";

export const MINIMAX_PROVIDER_ID = "minimax";
export const MINIMAX_CN_PROVIDER_ID = "minimax-cn";
export const MINIMAX_DEFAULT_BASE_URL = "https://api.minimax.io/v1";
export const MINIMAX_CN_DEFAULT_BASE_URL = "https://api.minimax.cn/v1";
export const MINIMAX_API_TYPE = "openai-completions" as const;
export const MINIMAX_API_KEY_ENV = "MINIMAX_API_KEY";
export const MINIMAX_CN_API_KEY_ENV = "MINIMAX_API_KEY";

export type MiniMaxProviderId =
	| typeof MINIMAX_PROVIDER_ID
	| typeof MINIMAX_CN_PROVIDER_ID;

export type MiniMaxInputModality = "text" | "image";

export type MiniMaxModelDefinition = {
	id: string;
	name: string;
	reasoning?: boolean;
	contextWindow: number;
	maxTokens: number;
	cost: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
	};
	input: readonly MiniMaxInputModality[];
};

export type MiniMaxModelInput = {
	provider?: string;
	id?: string;
};

export type MiniMaxModelRegistryLike = Pick<ModelRegistry, "registerProvider" | "unregisterProvider" | "find">;

export type MiniMaxProviderConfig = {
	baseUrl: string;
	api: typeof MINIMAX_API_TYPE;
	apiKey: string;
	models: Array<{
		id: string;
		name: string;
		api: typeof MINIMAX_API_TYPE;
		baseUrl: string;
		reasoning: boolean;
		input: MiniMaxInputModality[];
		cost: {
			input: number;
			output: number;
			cacheRead: number;
			cacheWrite: number;
		};
		contextWindow: number;
		maxTokens: number;
	}>;
};

const DEFAULT_MINIMAX_M3: MiniMaxModelDefinition = {
	id: "MiniMax-M3",
	name: "MiniMax M3",
	reasoning: false,
	contextWindow: 128000,
	maxTokens: 8192,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	input: ["text"],
};

function resolveBaseUrl(providerId: MiniMaxProviderId, defaultBaseUrl: string): string {
	const envOverride = process.env[`PIBO_${providerId.toUpperCase().replace(/-/g, "_")}_BASE_URL`];
	return envOverride && envOverride.length > 0 ? envOverride : defaultBaseUrl;
}

function cloneModel(model: MiniMaxModelDefinition, baseUrl: string): MiniMaxProviderConfig["models"][number] {
	return {
		id: model.id,
		name: model.name,
		api: MINIMAX_API_TYPE,
		baseUrl,
		reasoning: model.reasoning ?? false,
		input: [...model.input],
		cost: { ...model.cost },
		contextWindow: model.contextWindow,
		maxTokens: model.maxTokens,
	};
}

export function buildMiniMaxProviderConfig(
	providerId: MiniMaxProviderId = MINIMAX_PROVIDER_ID,
	models: readonly MiniMaxModelDefinition[] = [DEFAULT_MINIMAX_M3],
): MiniMaxProviderConfig {
	const defaultBaseUrl =
		providerId === MINIMAX_CN_PROVIDER_ID
			? MINIMAX_CN_DEFAULT_BASE_URL
			: MINIMAX_DEFAULT_BASE_URL;
	const baseUrl = resolveBaseUrl(providerId, defaultBaseUrl);
	return {
		baseUrl,
		api: MINIMAX_API_TYPE,
		apiKey: MINIMAX_API_KEY_ENV,
		models: models.map((model) => cloneModel(model, baseUrl)),
	};
}

export function isMiniMaxProvider(provider: string | undefined | null): boolean {
	return provider === MINIMAX_PROVIDER_ID || provider === MINIMAX_CN_PROVIDER_ID;
}

export function findMiniMaxModel(
	modelRegistry: MiniMaxModelRegistryLike,
	model: MiniMaxModelInput,
): Model<any> | undefined {
	if (!model?.provider || !model.id) return undefined;
	if (!isMiniMaxProvider(model.provider)) return undefined;
	return modelRegistry.find(model.provider, model.id);
}

const registeredProviders = new Set<string>();

export function registerMiniMaxProvider(
	modelRegistry: MiniMaxModelRegistryLike,
	options: { providerId?: MiniMaxProviderId; models?: readonly MiniMaxModelDefinition[] } = {},
): void {
	const providerId = options.providerId ?? MINIMAX_PROVIDER_ID;
	if (registeredProviders.has(providerId)) return;
	const config = buildMiniMaxProviderConfig(providerId, options.models);
	modelRegistry.registerProvider(providerId, config);
	registeredProviders.add(providerId);
}

export function unregisterMiniMaxProvider(
	modelRegistry: MiniMaxModelRegistryLike,
	options: { providerId?: MiniMaxProviderId } = {},
): void {
	const providerId = options.providerId ?? MINIMAX_PROVIDER_ID;
	if (!registeredProviders.has(providerId)) return;
	modelRegistry.unregisterProvider(providerId);
	registeredProviders.delete(providerId);
}

export function resetMiniMaxProviderRegistration(): void {
	registeredProviders.clear();
}

export function getDefaultMiniMaxModels(): readonly MiniMaxModelDefinition[] {
	return [DEFAULT_MINIMAX_M3];
}
