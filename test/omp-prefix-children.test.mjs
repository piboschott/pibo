import { PrefixSessionOwnership } from "../dist/sessions/prefix-ownership.js";
import { piboCorePlugin } from "../dist/plugins/builtin.js";
import { runPrefixAction } from "./helpers/prefix-action.mjs";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { test } from "node:test";
import { WebSocketServer } from "ws";
import { DatabaseSync } from "node:sqlite";
import { gunzipSync, brotliDecompressSync, inflateSync, zstdDecompressSync } from "node:zlib";
import { OMP_AGENT_RUNTIME_DRIVER } from "../dist/agent-runtimes/omp/adapter.js";
import { OMP_LEGACY_PREFIX_CODEC } from "../dist/agent-runtimes/omp/prefix-guard.js";
import { SessionPrefixController } from "../dist/sessions/prefix-session.js";
import { PrefixCapsuleStore } from "../dist/sessions/prefix-capsule.js";
import { SqlitePiboSessionStore } from "../dist/sessions/sqlite-store.js";
import { createAgentRuntimeBindingPersistence } from "../dist/sessions/runtime-binding-persistence.js";

import { PiboSessionRouter } from "../dist/core/session-router.js";
import { PiboPluginRegistry, definePiboPlugin } from "../dist/plugins/registry.js";
import { PiboReliabilityStore } from "../dist/reliability/store.js";
import { InitialSessionContextBuilder } from "../dist/core/profiles.js";

const bun = process.env.PIBO_OMP_PREFIX_BUN;
const entry = process.env.PIBO_OMP_PREFIX_ENTRY;
for (const api of ["openai-responses", "openai-codex-responses", "openai-codex-responses-lite", "openai-codex-responses-websocket", "openai-codex-responses-lite-websocket"]) for (const mode of ["router"]) test(`OMP ${mode} native task seals an independent prefix; api=${api}`, { skip: !bun || !entry, timeout: 60000 }, async t => {
	const root = await mkdtemp(join(tmpdir(), "pibo-omp-protected-adapter-"));
	const sessions = new SqlitePiboSessionStore(join(root, "sessions.sqlite"));
	const session = sessions.create({ channel: "test", kind: "chat", profile: "base",
		runtimeBinding: { runtimeInstanceId: "omp-native", adapterId: "orp", state: "unbound" } });
	let binding = session.runtimeBinding;
	let native, release, router;
	const observed = [];
	const previousHome = process.env.PIBO_HOME;
	const previousLite = process.env.PI_CODEX_RESPONSES_LITE;
	const previousWebsocket = process.env.PI_CODEX_WEBSOCKET;
	const websocket = api.endsWith("-websocket");
	process.env.PI_CODEX_RESPONSES_LITE = api.includes("-lite") ? "1" : "0";
	process.env.PI_CODEX_WEBSOCKET = websocket ? "1" : "0";
	process.env.PIBO_HOME = join(root, "pibo-home");
	const reliability = new PiboReliabilityStore(join(root, "reliability.sqlite"));
	const requests = [];
	const transports = [];
 const requestTools=request=>request.tools??request.input.find(item=>item.type==="additional_tools")?.tools??[];
 let dispatchTask=false, dispatchHub;
	const respond = (request, transport) => {
		requests.push(request); transports.push(transport);
		const id = `response-${requests.length}`;
		let item = { type: "message", role: "assistant", id: `msg-${requests.length}`, content: [{ type: "output_text", text: "ok", annotations: [] }], status: "completed" };
  if(requestTools(request).some(tool=>tool.name==="yield")){item={type:"function_call",name:"yield",call_id:"child-yield",arguments:JSON.stringify({data:"ok"}),status:"completed"};}
  if(dispatchTask){dispatchTask=false;item={type:"function_call",name:"task",call_id:"spawn-prefix-child",arguments:JSON.stringify({context:"Prefix conformance fixture",tasks:[{name:"prefix_child",agent:"task",task:"Reply briefly with ok",isolated:false}]}),status:"completed"};}
  if(dispatchHub){item={type:"function_call",name:"hub",call_id:"revive-prefix-child",arguments:JSON.stringify(dispatchHub),status:"completed"};dispatchHub=undefined;}
		return [
			{ type: "response.created", response: { id } },
			{ type: "response.output_item.added", output_index: 0, item: { ...item, content: [], status: "in_progress" } },
			{ type: "response.content_part.added", part: { type: "output_text", text: "", annotations: [] } },
			{ type: "response.output_text.delta", delta: "ok" },
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
	t.after(async () => { await router?.disposeAll(); await native?.dispose(); await release?.(); sessions.close(); reliability.close();
		if (previousHome === undefined) delete process.env.PIBO_HOME; else process.env.PIBO_HOME = previousHome;
		if (previousLite === undefined) delete process.env.PI_CODEX_RESPONSES_LITE; else process.env.PI_CODEX_RESPONSES_LITE = previousLite;
		if (previousWebsocket === undefined) delete process.env.PI_CODEX_WEBSOCKET; else process.env.PI_CODEX_WEBSOCKET = previousWebsocket;
		for (const socket of sockets.clients) socket.terminate();
		await new Promise(resolve => sockets.close(resolve));
		server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }); });
	const config = { ...OMP_AGENT_RUNTIME_DRIVER.defaultConfig(), bunExecutable: bun, ompEntry: entry,
		homeRoot: join(root, "omp"), defaultProvider: "fixture", defaultModel: "prefix-fixture", startupTimeoutMs: 20000 };
	config.environmentAllowlist = [...config.environmentAllowlist, "PI_CODEX_RESPONSES_LITE", "PI_CODEX_WEBSOCKET"];
	const home = join(config.homeRoot, "omp-native", "sessions", session.id, "agent");
	await mkdir(home, { recursive: true });
	await writeFile(join(home, "models.yml"), JSON.stringify({ providers: { fixture: {
		baseUrl: `http://127.0.0.1:${server.address().port}/v1`, api: api === "openai-responses" ? api : "openai-codex-responses",
		...(api === "openai-responses" ? { auth: "none" } : { apiKey: `${Buffer.from('{"alg":"none"}').toString("base64url")}.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "fixture-account" } })).toString("base64url")}.fixture` }),
		models: ["prefix-fixture", "prefix-second"].map(id => ({ id, name: id, reasoning: false, input: ["text"], contextWindow: 500000, maxTokens: 1024,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } })),
	} } }));
	const registry = PiboPluginRegistry.create({ plugins: [definePiboPlugin({ id: "prefix.omp.fixture", register(api) {
		api.registerProfile({ name: "prefix-omp-fixture", create: () => new InitialSessionContextBuilder("prefix-omp-fixture")
			.withAgentRuntime("omp-native").withNativeSubagents(true).withAutoContextFiles(false).withToolPackages({ goalControl: false })
			.withModel({ provider: "fixture", id: "prefix-fixture" }).createSession() });
	} })] });
	registry.registerGatewayAction(PiboPluginRegistry.create({ plugins: [piboCorePlugin] }).getGatewayAction("session.fork"));
	registry.registerGatewayAction(PiboPluginRegistry.create({ plugins: [piboCorePlugin] }).getGatewayAction("session.prefix.refresh"));
	registry.registerAgentRuntimeDriver(OMP_AGENT_RUNTIME_DRIVER);
	registry.registerAgentRuntimeInstance({ id: "omp-native", adapterId: "orp", enabled: true, config });
	sessions.update(session.id, { profile: "prefix-omp-fixture", workspace: root });
	const open = async () => {
		if (mode === "router") {
			router = new PiboSessionRouter({ cwd: root, sessionStore: sessions, reliabilityStore: reliability, pluginRegistry: registry,
				persistSession: true, sessionPrefixProtection: !binding.metadata?.piboSessionPrefix, modelDefaults: {} });
			router.subscribe(event => observed.push(event));
			return;
		}
		const adapter = OMP_AGENT_RUNTIME_DRIVER.create({ instanceId: "omp-native", enabled: true, config });
		const persistence = createAgentRuntimeBindingPersistence(sessions, { piboSessionId: session.id, onPersisted: next => { binding = next; } });
		const controller = new SessionPrefixController({ store: new PrefixCapsuleStore(join(root, "prefixes")), getBinding: () => binding, persistence });
		release = await adapter.preparePrefixOwnership({ binding, workspace: root, controller });
		native = await adapter.openSession({ piboSession: session, binding, workspace: root, profile: { nativeSubagents: false }, services: { prefixController: controller } });
		binding = sessions.updateRuntimeBinding(session.id, { ...binding, ...native.getBinding(), metadata: { ...binding.metadata, ...native.getBinding().metadata } }, { expectedRevision: binding.revision });
	};
	const prompt = async (text, id) => {
		if (router) {
			try { await router.emitMessageAndWaitForReply({ type: "message", piboSessionId: session.id, id, source: "user", text }, 20000); }
			catch (error) { throw new Error(JSON.stringify({ error: error.message, requests: requests.length, events: observed.map(event => ({type:event.type, text:event.text, message:event.message, error:event.error})) })); }
			binding = sessions.get(session.id).runtimeBinding;
		} else await native.prompt({ text });
	};
	await open();

 await prompt("Initialize parent", "initial");
 const parent=sessions.get(session.id).runtimeBinding.metadata.piboSessionPrefix;
 dispatchTask=true;
 await prompt("Execute the requested native task", "task");
 const children=sessions.get(session.id).runtimeBinding.metadata.piboSessionPrefixNativeChildren;
 assert.ok(children?.length,JSON.stringify({requests:requests.length,tools:requests[0].tools?.map(tool=>tool.name),outputs:requests.flatMap(request=>request.input.filter(item=>item.type==="function_call_output"))}));
 assert.equal(children.length,1);
 assert.notEqual(children[0].nativeSessionId,parent.nativeSessionId);
 assert.deepEqual(sessions.get(session.id).runtimeBinding.metadata.piboSessionPrefix,parent);
 const child=children[0], rosterId=basename(child.nativeSessionFile,".jsonl");
 const childRequests=()=>requests.filter(request=>requestTools(request).some(tool=>tool.name==="yield"));
 const first=childRequests()[0];assert.ok(first);
 await assert.rejects(PrefixSessionOwnership.acquire(join(process.env.PIBO_HOME,"session-prefixes"),[JSON.stringify(["native","orp",child.nativeSessionId])]),/ownership/);
 await router.disposeAll();router=undefined;
 binding=sessions.get(session.id).runtimeBinding;
 const modelConfig=JSON.parse(await readFile(join(home,"models.yml"),"utf8"));
 for(const model of modelConfig.providers.fixture.models)model.contextWindow=200000;
 await writeFile(join(home,"models.yml"),JSON.stringify(modelConfig));
 await open();
 dispatchHub={op:"send",to:rosterId,message:"Continue with another brief result"};
 await prompt("Continue the existing child", "revive-child");
 const end=Date.now()+10000;
 while(childRequests().length<2&&Date.now()<end)await new Promise(resolve=>setTimeout(resolve,25));
 assert.equal(childRequests().length,2,JSON.stringify(requests.flatMap(request=>request.input.filter(item=>item.type==="function_call_output"))));
 const second=childRequests()[1];
 const envelope=request=>Object.fromEntries(Object.entries(request).filter(([key])=>!["input","client_metadata","previous_response_id"].includes(key)));
 assert.deepEqual(envelope(second),envelope(first));
 assert.deepEqual(second.input.slice(0,first.input.length),first.input);
 assert.deepEqual(sessions.get(session.id).runtimeBinding.metadata.piboSessionPrefixNativeChildren,children);
 await router.disposeAll();router=undefined;
 binding=sessions.get(session.id).runtimeBinding;
 await rm(join(process.env.PIBO_HOME,"session-prefixes",child.prefix.capsule.digest+".capsule"));
 await open();
 dispatchHub={op:"send",to:rosterId,message:"Do not rebuild missing original child state"};
 await assert.rejects(prompt("Continue the existing child", "missing-child"),/OMP native|process exited/);
 assert.equal(childRequests().length,2,"missing child capsule must block before child provider dispatch");
});
