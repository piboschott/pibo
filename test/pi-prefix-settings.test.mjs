import { piboCorePlugin } from "../dist/plugins/builtin.js";
import { runPrefixAction } from "./helpers/prefix-action.mjs";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { mkdir, mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { gunzipSync, brotliDecompressSync, inflateSync, zstdDecompressSync } from "node:zlib";
import { streamSimple as streamNativeCodex } from "@earendil-works/pi-ai/api/openai-codex-responses";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { InitialSessionContextBuilder } from "../dist/core/profiles.js";
import { createPiboRuntime } from "../dist/agent-runtimes/pi/runtime.js";
import { PiboRuntimeResourceService } from "../dist/agent-runtime/resource-service.js";
import { PI_AGENT_RUNTIME_CAPABILITIES } from "../dist/agent-runtimes/pi/adapter.js";
import { savePiboCustomBasePrompt } from "../dist/core/base-prompt.js";
import { SqlitePiboSessionStore } from "../dist/sessions/sqlite-store.js";
import { PrefixCapsuleStore } from "../dist/sessions/prefix-capsule.js";
import { SessionPrefixController } from "../dist/sessions/prefix-session.js";
import { createAgentRuntimeBindingPersistence } from "../dist/sessions/runtime-binding-persistence.js";
import { PiboSessionRouter } from "../dist/core/session-router.js";
import { PiboPluginRegistry, definePiboPlugin } from "../dist/plugins/registry.js";
import { PiboReliabilityStore } from "../dist/reliability/store.js";

async function fakeProvider(t) {
	const requests = [];
	const server = createServer(async (req, res) => {
		const chunks = [];
		for await (const chunk of req) chunks.push(chunk);
		const decompress = { gzip: gunzipSync, br: brotliDecompressSync, deflate: inflateSync, zstd: zstdDecompressSync }[req.headers["content-encoding"]] ?? (value => value);
		requests.push(JSON.parse(decompress(Buffer.concat(chunks)).toString()));
		const id = `answer-${requests.length}`;
		const item = { type: "message", id, role: "assistant", content: [{ type: "output_text", text: "ok", annotations: [] }], status: "completed" };
		res.writeHead(200, { "content-type": "text/event-stream", connection: "close" });
		const tool = { type: "function_call", id: "fc_prefix", call_id: "call_prefix", name: "prefix_probe", arguments: "{}", status: "completed" };
		let events = requests.length === 1 ? [
			{ type: "response.output_item.added", output_index: 0, item: { ...tool, arguments: "", status: "in_progress" } },
			{ type: "response.function_call_arguments.delta", delta: "{}" },
			{ type: "response.output_item.done", output_index: 0, item: tool },
			{ type: "response.completed", response: { id: `response-${id}`, status: "completed", output: [tool], usage: { input_tokens: 10, output_tokens: 1, total_tokens: 11, input_tokens_details: { cached_tokens: 0 } } } },
		] : [
			{ type: "response.output_item.added", output_index: 0, item: { ...item, content: [], status: "in_progress" } },
			{ type: "response.content_part.added", part: { type: "output_text", text: "", annotations: [] } },
			{ type: "response.output_text.delta", delta: "ok" },
			{ type: "response.output_item.done", output_index: 0, item },
			{ type: "response.completed", response: { id: `response-${id}`, status: "completed", output: [item], usage: { input_tokens: 10, output_tokens: 1, total_tokens: 11, input_tokens_details: { cached_tokens: 0 } } } },
		 ];
		if (requests.length === 1) {
			const reasoning = { type: "reasoning", id: "rs_prefix", summary: [{ type: "summary_text", text: "Fixture reasoning summary." }], encrypted_content: "opaque-fixture-reasoning" };
			events = [
				{ type: "response.output_item.added", output_index: 0, item: { ...reasoning, summary: [], encrypted_content: undefined } },
				{ type: "response.reasoning_summary_part.added", item_id: reasoning.id, output_index: 0, summary_index: 0, part: { type: "summary_text", text: "" } },
				{ type: "response.reasoning_summary_text.delta", item_id: reasoning.id, output_index: 0, summary_index: 0, delta: "Fixture reasoning summary." },
				{ type: "response.output_item.done", output_index: 0, item: reasoning },
				...events.map(event => typeof event.output_index === "number" ? { ...event, output_index: event.output_index + 1 } : event),
			];
			events.at(-1).response.output.unshift(reasoning);
		}
		res.end(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(""));
	});
	await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
	t.after(() => new Promise(resolve => server.close(resolve)));
	return { requests, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

test("Pi router protects explicit thinking changes and restores controls after restart", { timeout: 60000 }, async t => {
	const root = await mkdtemp(join(tmpdir(), "pibo-prefix-router-"));
	const previousHome = process.env.PIBO_HOME;
	process.env.PIBO_HOME = join(root, "pibo-home");
	const sessions = new SqlitePiboSessionStore(join(root, "sessions.sqlite"));
	const reliability = new PiboReliabilityStore(join(root, "reliability.sqlite"));
	let router;
	let nativePath;
	t.after(async () => {
		await router?.disposeAll(); reliability.close(); sessions.close();
		if (nativePath) await rm(nativePath, { force: true });
		if (previousHome === undefined) delete process.env.PIBO_HOME; else process.env.PIBO_HOME = previousHome;
		await rm(root, { recursive: true, force: true });
	});
	const api = await fakeProvider(t);
	const originalFetch = globalThis.fetch;
	globalThis.fetch = (input, init) => {
		const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
		if (url.origin !== new URL(api.baseUrl).origin) throw new Error("Fixture blocked non-loopback provider access");
		return originalFetch(input, init);
	};
	t.after(() => { globalThis.fetch = originalFetch; });
	const contextPath = join(root, "selected-context.md");
	await writeFile(contextPath, "Original router context");
	await savePiboCustomBasePrompt("Original router base", root);
	const credentials = new InMemoryCredentialStore();
	const claim = Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "test-only" } })).toString("base64url");
	await credentials.modify("openai-codex", async () => ({ type: "oauth", access: `test.${claim}.test`, refresh: "test-only", expires: Date.now() + 3600000 }));
	const modelRuntime = await ModelRuntime.create({ credentials, allowModelNetwork: false });
	modelRuntime.registerProvider("openai-codex", { api: "openai-codex-responses", baseUrl: api.baseUrl,
		streamSimple: (model, context, options) => streamNativeCodex({ ...model, baseUrl: api.baseUrl }, context, { ...options, transport: "sse" }),
		models: ["gpt-5.5", "gpt-5.4"].map(id => ({ id, name: "Fixture", reasoning: true, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 500000, maxTokens: 1024 })) });
	const profileName = "prefix-router-fixture";
	const registry = PiboPluginRegistry.create({ plugins: [definePiboPlugin({ id: "prefix.router.fixture", register(registration) {
		registration.registerProfile({ name: profileName, create: () => new InitialSessionContextBuilder(profileName)
			.withBuiltinTools("disabled").withAutoContextFiles(false).withToolPackages({ goalControl: false })
			.withModel({ provider: "openai-codex", id: "gpt-5.5" }).addContextFile({ path: contextPath }).createSession() });
	} })] });
	registry.registerGatewayAction(PiboPluginRegistry.create({ plugins: [piboCorePlugin] }).getGatewayAction("thinking"));
	registry.registerGatewayAction(PiboPluginRegistry.create({ plugins: [piboCorePlugin] }).getGatewayAction("session.prefix.refresh"));
	const session = sessions.create({ channel: "test", kind: "chat", profile: profileName, workspace: root });
	const open = enabled => new PiboSessionRouter({ cwd: root, sessionStore: sessions, reliabilityStore: reliability, pluginRegistry: registry,
		persistSession: true, sessionPrefixProtection: enabled, modelRuntime, thinkingLevel: "high", modelDefaults: {},
		extensionFactories: [pi => { pi.registerTool({ name: "prefix_probe", label: "Probe", description: "Fixture", parameters: { type: "object", properties: {} },
			execute: async () => ({ content: [{ type: "text", text: "persistent tool result" }], details: {} }) }); }],
	});
	const usage = [];
	router = open(true);
	router.subscribe(event => { if (event.type === "assistant_usage") usage.push(event); });
	await router.emitMessageAndWaitForReply({ type: "message", piboSessionId: session.id, id: "first", source: "user", text: "first routed input" }, 20000);

 const original=sessions.get(session.id).runtimeBinding.metadata.piboSessionPrefix;
 const setThinking=level=>new Promise((resolve,reject)=>{
   const id="thinking-"+level;
   const timer=setTimeout(()=>{unsubscribe();reject(new Error("thinking timed out"));},10000);
   const unsubscribe=router.subscribe(event=>{if(event.eventId!==id || !["execution_result","session_error"].includes(event.type) || event.result?.queued)return;clearTimeout(timer);unsubscribe();if(event.type==="session_error")reject(new Error(event.error));else resolve(event.result);});
   void router.emit({type:"execution",piboSessionId:session.id,id,action:"thinking",params:{level}}).catch(reject);
 });
 await setThinking("low");
 assert.equal(sessions.get(session.id).runtimeBinding.metadata.piboSessionPrefixRebaseline.reason,"settings-change");
 await router.emitMessageAndWaitForReply({type:"message",piboSessionId:session.id,id:"changed",source:"user",text:"changed"},20000);
 assert.equal(api.requests.at(-1).reasoning.effort,"low");
 assert.equal(sessions.get(session.id).runtimeBinding.metadata.piboSessionPrefix.epoch,original.epoch+1);
 const changed=structuredClone(api.requests.at(-1));
 await router.disposeAll();router=open(false);
 await router.emitMessageAndWaitForReply({type:"message",piboSessionId:session.id,id:"cold",source:"user",text:"cold"},20000);
 assert.equal(api.requests.at(-1).reasoning.effort,"low");
 assert.deepEqual(api.requests.at(-1).tools,changed.tools);
 assert.equal(api.requests.at(-1).instructions,changed.instructions);
 await setThinking("off");
 await router.emitMessageAndWaitForReply({type:"message",piboSessionId:session.id,id:"off",source:"user",text:"off"},20000);
 assert.ok([undefined,"none"].includes(api.requests.at(-1).reasoning?.effort));
});
