import assert from "node:assert/strict";
import { runPrefixAction } from "./helpers/prefix-action.mjs";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { WebSocketServer } from "ws";
import { gunzipSync, brotliDecompressSync, inflateSync, zstdDecompressSync } from "node:zlib";
import { CODEX_NATIVE_AGENT_RUNTIME_DRIVER } from "../dist/agent-runtimes/codex-native/adapter.js";
import { prepareCodexNativeInstancePaths } from "../dist/agent-runtimes/codex-native/process.js";
import { PiboSessionRouter } from "../dist/core/session-router.js";
import { InitialSessionContextBuilder } from "../dist/core/profiles.js";
import { PiboPluginRegistry, definePiboPlugin } from "../dist/plugins/registry.js";
import { piboCorePlugin } from "../dist/plugins/builtin.js";
import { SqlitePiboSessionStore } from "../dist/sessions/sqlite-store.js";
import { PiboReliabilityStore } from "../dist/reliability/store.js";
import { SessionPrefixController } from "../dist/sessions/prefix-session.js";
import { createAgentRuntimeBindingPersistence } from "../dist/sessions/runtime-binding-persistence.js";
import { CodexPrefixOpen } from "../dist/agent-runtimes/codex-native/prefix-open.js";

const binary = process.env.PIBO_CODEX_PROTECTED_BINARY;
for (const transport of ["http", "websocket"]) for (const lite of [false, true]) for (const tokenBudget of [false]) test(`Codex router protects explicit reasoning and fast controls; transport=${transport}; lite=${lite}; tokenBudget=${tokenBudget}`, { skip: !binary, timeout: 120000 }, async t => {
	const root = await mkdtemp(join(tmpdir(), "pibo-codex-protected-router-"));
	const previousHome = process.env.PIBO_HOME;
	process.env.PIBO_HOME = join(root, "pibo-home");
	const sessions = new SqlitePiboSessionStore(join(root, "sessions.sqlite"));
	const reliability = new PiboReliabilityStore(join(root, "reliability.sqlite"));
	let router;
	const requests = [];
	const transports = [];
	const observed = [];
	let requestNativeTool = false;
	const respond = (request, via) => {
		requests.push(request); transports.push(via);
		const id = `response-${requests.length}`;
		const item = requestNativeTool ? { type: "function_call", name: "get_goal", call_id: "native-prefix-tool", arguments: "{}", status: "completed" } : { type: "message", role: "assistant", id: `msg-${requests.length}`, content: [{ type: "output_text", text: "ok", annotations: [] }], status: "completed" };
		requestNativeTool = false;
		return [
			{ type: "response.created", response: { id } },
			{ type: "response.output_item.done", output_index: 0, item },
			{ type: "response.completed", response: { id, status: "completed", output: [item], usage: { input_tokens: 100, output_tokens: 1, total_tokens: 101 } } },
		];
	};
	const server = createServer(async (req, res) => {
		if (req.method !== "POST") { req.resume(); res.writeHead(404).end(); return; }
		const chunks = []; for await (const chunk of req) chunks.push(chunk);
		const decode = { gzip: gunzipSync, br: brotliDecompressSync, deflate: inflateSync, zstd: zstdDecompressSync }[req.headers["content-encoding"]] ?? (v => v);
		const events = respond(JSON.parse(decode(Buffer.concat(chunks)).toString()), "http");
		res.writeHead(200, { "content-type": "text/event-stream", connection: "close" });
		res.end(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""));
	});
	const sockets = new WebSocketServer({ server });
	sockets.on("connection", socket => socket.on("message", data => {
		for (const event of respond(JSON.parse(data.toString()), "websocket")) socket.send(JSON.stringify(event));
	}));
	await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
	t.after(async () => {
		await router?.disposeAll(); sessions.close(); reliability.close(); server.closeAllConnections();
		for (const socket of sockets.clients) socket.terminate();
		await new Promise(resolve => sockets.close(resolve));
		await new Promise(resolve => server.close(resolve));
		if (previousHome === undefined) delete process.env.PIBO_HOME; else process.env.PIBO_HOME = previousHome;
		await rm(root, { recursive: true, force: true });
	});
	const config = { ...CODEX_NATIVE_AGENT_RUNTIME_DRIVER.defaultConfig(), executable: binary,
		homeRoot: join(root, "codex"), startupTimeoutMs: 30000 };
	const { codexHome: home } = await prepareCodexNativeInstancePaths(config, "codex-native");
	const catalogPath = join(home, "model-catalog.json");
	const catalog = JSON.parse(await readFile(new URL("./fixtures/codex-prefix-model-catalog.json", import.meta.url), "utf8"));
	catalog.models[0].use_responses_lite = lite;
	catalog.models.push({ ...structuredClone(catalog.models[0]), slug: "gpt-5.4", display_name: "Second fixture model" });
	await writeFile(catalogPath, JSON.stringify(catalog));
	await writeFile(join(home, "config.toml"), `model = "gpt-5.5"
model_provider = "fixture"
model_catalog_json = ${JSON.stringify(catalogPath)}
approval_policy = "never"
sandbox_mode = "danger-full-access"
web_search = "disabled"
[model_providers.fixture]
name = "Fixture"
base_url = "http://127.0.0.1:${server.address().port}/v1"
wire_api = "responses"
requires_openai_auth = false
supports_websockets = ${transport === "websocket"}
request_max_retries = 0
stream_max_retries = 0
[features]
shell_snapshot = false
token_budget = ${tokenBudget}
[analytics]
enabled = false
`);
	const context = join(root, "selected.md");
	await writeFile(context, "Original selected context");
	const registry = PiboPluginRegistry.create({ plugins: [definePiboPlugin({ id: "prefix.codex.fixture", register(api) {
		api.registerProfile({ name: "prefix-codex-fixture", create: () => new InitialSessionContextBuilder("prefix-codex-fixture")
			.withAgentRuntime("codex-native").withNativeSubagents(false).withAutoContextFiles(false).withToolPackages({ goalControl: false })
			.withModel({ provider: "openai-codex", id: "gpt-5.5" }).addContextFile({ path: context }).createSession() });
	} })] });
	registry.registerAgentRuntimeDriver(CODEX_NATIVE_AGENT_RUNTIME_DRIVER);
	for (const action of ["thinking", "fast_mode"]) registry.registerGatewayAction(PiboPluginRegistry.create({ plugins: [piboCorePlugin] }).getGatewayAction(action));
	registry.registerAgentRuntimeInstance({ id: "codex-native", adapterId: "codex-native", enabled: true, config });
	const session = sessions.create({ channel: "test", kind: "chat", profile: "prefix-codex-fixture", workspace: root,
		runtimeBinding: { runtimeInstanceId: "codex-native", adapterId: "codex-native", state: "unbound" } });
	const open = enabled => {
		router = new PiboSessionRouter({ cwd: root, sessionStore: sessions, reliabilityStore: reliability, pluginRegistry: registry,
			persistSession: true, sessionPrefixProtection: enabled, modelDefaults: {} });
		router.subscribe(event => observed.push(event));
	};
	const prompt = async (text, id, piboSessionId = session.id) => {
		try { return await router.emitMessageAndWaitForReply({ type: "message", piboSessionId, id, source: "user", text }, 40000); }
		catch (error) { throw new Error(JSON.stringify({ error: error.message, requests: requests.length,
			events: observed.map(event => ({ type: event.type, message: event.message, error: event.error })) })); }
	};
	open(true);
	await prompt("original input ".repeat(35000), "first");

 const original=sessions.get(session.id).runtimeBinding.metadata.piboSessionPrefix;
 const action=(id,name,params)=>new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>{unsubscribe();reject(new Error("control timed out"));},10000);
   const unsubscribe=router.subscribe(event=>{if(event.eventId!==id || !["execution_result","session_error"].includes(event.type) || event.result?.queued)return;clearTimeout(timer);unsubscribe();if(event.type==="session_error")reject(new Error(event.error));else resolve(event.result);});
   void router.emit({type:"execution",piboSessionId:session.id,id,action:name,params}).catch(reject);
 });
 const initialEffort=requests.at(-1).reasoning.effort;
 const target=initialEffort==="low"?"high":"low";
 await action("think","thinking",{level:target});
 assert.equal(sessions.get(session.id).runtimeBinding.metadata.piboSessionPrefixRebaseline.reason,"settings-change");
 await router.disposeAll();open(false);
 await prompt("changed","changed");
 assert.equal(requests.at(-1).reasoning.effort,target);
 assert.equal(sessions.get(session.id).runtimeBinding.metadata.piboSessionPrefix.epoch,original.epoch+1);
 const changed=structuredClone(requests.at(-1));
 await router.disposeAll();open(false);
 await prompt("cold","cold");
 assert.equal(requests.at(-1).reasoning.effort,target);
 assert.deepEqual(requests.at(-1).tools,changed.tools);
 assert.equal(requests.at(-1).instructions,changed.instructions);
 await action("fast","fast_mode",{});
 await prompt("fast","fast");
 assert.equal(requests.at(-1).service_tier,"priority");
 await router.disposeAll();open(false);
 await prompt("fast-cold","fast-cold");
 assert.equal(requests.at(-1).service_tier,"priority");
});
