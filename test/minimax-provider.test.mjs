import assert from "node:assert/strict";
import test from "node:test";
import {
	MINIMAX_API_KEY_ENV,
	MINIMAX_API_TYPE,
	MINIMAX_CN_PROVIDER_ID,
	MINIMAX_DEFAULT_BASE_URL,
	MINIMAX_PROVIDER_ID,
	buildMiniMaxProviderConfig,
	findMiniMaxModel,
	getDefaultMiniMaxModels,
	isMiniMaxProvider,
	registerMiniMaxProvider,
	resetMiniMaxProviderRegistration,
	unregisterMiniMaxProvider,
} from "../dist/providers/minimax.js";

function makeFakeRegistry() {
	const registrations = [];
	const unregistrations = [];
	const models = new Map();
	const api = {
		registerProvider(name, config) {
			registrations.push({ name, config });
			for (const model of config.models ?? []) {
				models.set(`${name}/${model.id}`, { provider: name, ...model });
			}
		},
		unregisterProvider(name) {
			unregistrations.push(name);
			for (const key of [...models.keys()]) {
				if (key.startsWith(`${name}/`)) models.delete(key);
			}
		},
		find(provider, modelId) {
			return models.get(`${provider}/${modelId}`);
		},
	};
	return { api, registrations, unregistrations, models };
}

test.beforeEach(() => {
	resetMiniMaxProviderRegistration();
});

test("buildMiniMaxProviderConfig returns OpenAI-completions config with MiniMax-M3", () => {
	const config = buildMiniMaxProviderConfig();

	assert.equal(config.api, MINIMAX_API_TYPE);
	assert.equal(config.baseUrl, MINIMAX_DEFAULT_BASE_URL);
	assert.equal(config.apiKey, MINIMAX_API_KEY_ENV);
	assert.equal(config.models.length, 1);
	assert.equal(config.models[0].id, "MiniMax-M3");
	assert.equal(config.models[0].api, MINIMAX_API_TYPE);
	assert.equal(config.models[0].baseUrl, MINIMAX_DEFAULT_BASE_URL);
});

test("buildMiniMaxProviderConfig selects CN base URL for minimax-cn", () => {
	const config = buildMiniMaxProviderConfig(MINIMAX_CN_PROVIDER_ID);

	assert.equal(config.baseUrl, "https://api.minimax.cn/v1");
	assert.equal(config.models[0].baseUrl, "https://api.minimax.cn/v1");
});

test("buildMiniMaxProviderConfig honors PIBO_MINIMAX_BASE_URL env override", () => {
	const previous = process.env.PIBO_MINIMAX_BASE_URL;
	process.env.PIBO_MINIMAX_BASE_URL = "https://example.test/v1";
	try {
		const config = buildMiniMaxProviderConfig();
		assert.equal(config.baseUrl, "https://example.test/v1");
		assert.equal(config.models[0].baseUrl, "https://example.test/v1");
	} finally {
		if (previous === undefined) delete process.env.PIBO_MINIMAX_BASE_URL;
		else process.env.PIBO_MINIMAX_BASE_URL = previous;
	}
});

test("registerMiniMaxProvider calls registerProvider with the built config", () => {
	const fake = makeFakeRegistry();

	registerMiniMaxProvider(fake.api);

	assert.equal(fake.registrations.length, 1);
	assert.equal(fake.registrations[0].name, MINIMAX_PROVIDER_ID);
	assert.equal(fake.registrations[0].config.models[0].id, "MiniMax-M3");
	assert.ok(fake.models.has(`${MINIMAX_PROVIDER_ID}/MiniMax-M3`));
});

test("registerMiniMaxProvider is idempotent within a process", () => {
	const fake = makeFakeRegistry();

	registerMiniMaxProvider(fake.api);
	registerMiniMaxProvider(fake.api);

	assert.equal(fake.registrations.length, 1);
});

test("unregisterMiniMaxProvider clears the registration slot", () => {
	const fake = makeFakeRegistry();

	registerMiniMaxProvider(fake.api);
	unregisterMiniMaxProvider(fake.api);
	registerMiniMaxProvider(fake.api);

	assert.equal(fake.registrations.length, 2);
	assert.deepEqual(fake.unregistrations, [MINIMAX_PROVIDER_ID]);
});

test("isMiniMaxProvider recognizes minimax and minimax-cn", () => {
	assert.equal(isMiniMaxProvider("minimax"), true);
	assert.equal(isMiniMaxProvider("minimax-cn"), true);
	assert.equal(isMiniMaxProvider("openai"), false);
	assert.equal(isMiniMaxProvider(undefined), false);
	assert.equal(isMiniMaxProvider(null), false);
});

test("findMiniMaxModel returns registered model for matching input", () => {
	const fake = makeFakeRegistry();
	registerMiniMaxProvider(fake.api);

	const model = findMiniMaxModel(fake.api, { provider: "minimax", id: "MiniMax-M3" });

	assert.ok(model);
	assert.equal(model.provider, "minimax");
	assert.equal(model.id, "MiniMax-M3");
});

test("findMiniMaxModel returns undefined for non-minimax input", () => {
	const fake = makeFakeRegistry();
	registerMiniMaxProvider(fake.api);

	assert.equal(findMiniMaxModel(fake.api, { provider: "openai", id: "gpt-5" }), undefined);
	assert.equal(findMiniMaxModel(fake.api, { provider: "minimax" }), undefined);
	assert.equal(findMiniMaxModel(fake.api, undefined), undefined);
});

test("getDefaultMiniMaxModels includes MiniMax-M3", () => {
	const models = getDefaultMiniMaxModels();
	assert.equal(models.length, 1);
	assert.equal(models[0].id, "MiniMax-M3");
});
