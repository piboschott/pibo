import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { loadPiboModelDefaults, savePiboModelDefaults, selectRequestedModelProfile, selectRequestedThinkingLevel } from "../dist/core/model-defaults.js";
import { InitialSessionContextBuilder } from "../dist/core/profiles.js";

test("model defaults persist and roundtrip", () => {
	const cwd = mkdtempSync(join(tmpdir(), "pibo-model-defaults-"));
	const saved = savePiboModelDefaults({
		main: { provider: "openai", id: "gpt-5.4" },
		subagent: { provider: "kimi-coding", id: "kimi-for-coding" },
		thinking: "high",
	}, cwd, "model-defaults.json");

	assert.deepEqual(saved, {
		main: { provider: "openai", id: "gpt-5.4" },
		subagent: { provider: "kimi-coding", id: "kimi-for-coding" },
		thinking: "high",
	});
	assert.deepEqual(loadPiboModelDefaults(cwd, "model-defaults.json"), saved);
});

test("model selection prefers hard pin, then role override, then defaults", () => {
	const defaults = {
		main: { provider: "openai", id: "gpt-5.4" },
		subagent: { provider: "kimi-coding", id: "kimi-for-coding" },
	};
	const mainProfile = new InitialSessionContextBuilder("main-profile").createSession();
	const childProfile = new InitialSessionContextBuilder("child-profile")
		.withParentSessionId("parent")
		.createSession();
	const overriddenMain = new InitialSessionContextBuilder("overridden-main")
		.withMainModel({ provider: "openai", id: "gpt-5.5" })
		.createSession();
	const overriddenChild = new InitialSessionContextBuilder("overridden-child")
		.withParentSessionId("parent")
		.withSubagentModel({ provider: "openai", id: "gpt-5.5-mini" })
		.createSession();
	const pinned = new InitialSessionContextBuilder("pinned")
		.withParentSessionId("parent")
		.withModel({ provider: "moonshotai", id: "kimi-k2.6" })
		.withSubagentModel({ provider: "openai", id: "gpt-5.5-mini" })
		.createSession();

	assert.deepEqual(selectRequestedModelProfile(mainProfile, defaults), defaults.main);
	assert.deepEqual(selectRequestedModelProfile(childProfile, defaults), defaults.subagent);
	assert.deepEqual(selectRequestedModelProfile(overriddenMain, defaults), { provider: "openai", id: "gpt-5.5" });
	assert.deepEqual(selectRequestedModelProfile(overriddenChild, defaults), { provider: "openai", id: "gpt-5.5-mini" });
	assert.deepEqual(selectRequestedModelProfile(pinned, defaults), { provider: "moonshotai", id: "kimi-k2.6" });
});

test("thinking selection prefers profile override, then default", () => {
	const defaults = { thinking: "medium" };
	const defaultProfile = new InitialSessionContextBuilder("default-thinking").createSession();
	const overridden = new InitialSessionContextBuilder("overridden-thinking")
		.withThinkingLevel("xhigh")
		.createSession();

	assert.equal(selectRequestedThinkingLevel(defaultProfile, defaults), "medium");
	assert.equal(selectRequestedThinkingLevel(overridden, defaults), "xhigh");
});
