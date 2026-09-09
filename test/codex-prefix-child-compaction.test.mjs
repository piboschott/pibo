import assert from "node:assert/strict";
import { PrefixSessionOwnership } from "../dist/sessions/prefix-ownership.js";
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
for (const transport of ["http"]) for (const lite of [false]) for (const inherit of [false]) test(`Codex native child compaction advances only its own epoch across cold revival; transport=${transport}; lite=${lite}; inherit=${inherit}`, { skip: !binary, timeout: 120000 }, async t => {
	const tokenBudget = false;
	const root = await mkdtemp(join(tmpdir(), "pibo-codex-protected-router-"));
	const previousHome = process.env.PIBO_HOME;
	process.env.PIBO_HOME = join(root, "pibo-home");
	const sessions = new SqlitePiboSessionStore(join(root, "sessions.sqlite"));
	const reliability = new PiboReliabilityStore(join(root, "reliability.sqlite"));
	let router;
	const requests = [];
	const transports = [];
 const compactions = new Set();
 let childDispatched = false;
	const observed = [];
	let rootNativeId;
	let command;
	const respond = (request, via) => {
		requests.push(request); transports.push(via);
		rootNativeId ??= request.client_metadata?.thread_id;
		const child = sessions.get(session.id)?.runtimeBinding.metadata?.piboSessionPrefixNativeChildren?.find(child=>child.nativeSessionId===request.client_metadata?.thread_id);
  if(child?.transition?.state==="pending")compactions.add(request);
  const firstChild = request.client_metadata?.thread_id !== rootNativeId && !childDispatched && !compactions.has(request);
  if(firstChild)childDispatched=true;
  const id = `response-${requests.length}`;
		let item = {type:"message",role:"assistant",id:`msg-${requests.length}`,content:[{type:"output_text",text:"ok",annotations:[]}],status:"completed"};
  if (request.client_metadata?.thread_id === rootNativeId && command) {
   const tools=request.tools ?? request.input.find(item=>item.type==="additional_tools")?.tools ?? requests.filter(previous=>previous.client_metadata?.thread_id === rootNativeId).flatMap(previous=>previous.input?.filter(item=>item.type==="additional_tools").flatMap(item=>item.tools ?? []) ?? []);
   const namespace=tools.find(tool=>tool.type==="namespace" && tool.tools?.some(child=>child.name===command.name))?.name;
   item={type:"function_call",name:command.name,...(namespace?{namespace}:{}),call_id:command.id,arguments:JSON.stringify(command.args),status:"completed"};command=undefined;
  }
		return [
			{ type: "response.created", response: { id } },
			{ type: "response.output_item.done", output_index: 0, item },
			{ type: "response.completed", response: { id, status: "completed", output: [item], usage: { input_tokens: firstChild ? 270000 : 100, output_tokens: 1, total_tokens: firstChild ? 270001 : 101 } } },
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
			.withAgentRuntime("codex-native").withNativeSubagents(true).withAutoContextFiles(false).withToolPackages({ goalControl: false })
			.withModel({ provider: "openai-codex", id: "gpt-5.5" }).addContextFile({ path: context }).createSession() });
	} })] });
	registry.registerAgentRuntimeDriver(CODEX_NATIVE_AGENT_RUNTIME_DRIVER);
	for (const action of ["compact", "session.clone", "session.fork", "session.prefix.refresh"]) registry.registerGatewayAction(PiboPluginRegistry.create({ plugins: [piboCorePlugin] }).getGatewayAction(action));
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
 await prompt("Initialize parent prefix", "initial");
 const rootPrefix = sessions.get(session.id).runtimeBinding.metadata.piboSessionPrefix;
 const issue = async (name,args,id) => {command={name,args,id};await prompt("Execute the requested native agent operation",id);};
 const childRequests = () => requests.filter(request=>request.client_metadata?.thread_id !== rootNativeId && !compactions.has(request));
 const until = async condition => {const end=Date.now()+15000;while(!condition()){if(Date.now()>end) throw new Error(JSON.stringify({error:"child model dispatch missing",requests:requests.map(r=>({keys:Object.keys(r),key:r.prompt_cache_key,inputs:r.input?.length})),children:sessions.get(session.id).runtimeBinding.metadata?.piboSessionPrefixNativeChildren?.map(c=>({id:c.nativeSessionId})),tools:(requests[0].tools??[]).map(tool=>({type:tool.type,name:tool.name,tools:tool.tools?.map(child=>child.name)})),outputs:requests.filter(r=>r.client_metadata?.thread_id===rootNativeId).at(-1)?.input.filter(item=>item.type==="function_call_output")}));await new Promise(resolve=>setTimeout(resolve,25));}};
 await issue("spawn_agent",{task_name:"prefix_child",message:"Reply briefly: child prefix probe",fork_turns:inherit?"all":"none"},"spawn");
 await until(()=>childRequests().length>=1);
 await issue("wait_agent",{timeout_ms:1000},"wait-first");
 const child = sessions.get(session.id).runtimeBinding.metadata.piboSessionPrefixNativeChildren?.[0];
 assert.ok(child?.prefix.capsule.digest);assert.equal(child.nativeSessionId,childRequests()[0].client_metadata.thread_id);
 assert.notEqual(child.nativeSessionId,rootNativeId);
 assert.equal(child.sourceNativeSessionId,rootNativeId);
 await assert.rejects(PrefixSessionOwnership.acquire(join(process.env.PIBO_HOME,"session-prefixes"),[JSON.stringify(["native","codex-native",child.nativeSessionId])]),/ownership/);
 const first = childRequests()[0];
 await router.disposeAll();router=undefined;
 await rm(context);
 catalog.models[0].base_instructions="Changed current child catalog base";
 await writeFile(catalogPath,JSON.stringify(catalog));
 open(false);
 await issue("followup_task",{target:child.nativeSessionId,message:"Continue the existing child conversation"},"revive");
 await until(()=>childRequests().length>=2);
 await issue("wait_agent",{timeout_ms:1000},"wait-second");
 const second = childRequests()[1];
 const envelope=value=>Object.fromEntries(Object.entries(value).filter(([key])=>!["input","client_metadata","previous_response_id"].includes(key)));
 assert.deepEqual(envelope(second),envelope(first));
 assert.equal(compactions.size,1,"native summary uses its separate compaction envelope");
 // Native compaction owns the new history. The capsule and provider envelope stay frozen.
 assert.notDeepEqual(second.input,first.input);
 assert.deepEqual(sessions.get(session.id).runtimeBinding.metadata.piboSessionPrefix,rootPrefix);
 assert.deepEqual(sessions.get(session.id).runtimeBinding.metadata.piboSessionPrefixNativeChildren[0].prefix,{...child.prefix,epoch:child.prefix.epoch+1,reason:"compaction"});
 await router.disposeAll();router=undefined;
 open(false);
 await issue("followup_task",{target:child.nativeSessionId,message:"Continue after the completed compaction"},"after-compaction");
 await until(()=>childRequests().length>=3);
 await issue("wait_agent",{timeout_ms:1000},"wait-third");
 assert.deepEqual(childRequests()[2].input.slice(0,second.input.length),second.input,"the new native history epoch remains append-only after another restart");
 assert.deepEqual(envelope(childRequests()[2]),envelope(second));
 await router.disposeAll();router=undefined;
 await rm(join(process.env.PIBO_HOME,"session-prefixes",child.prefix.capsule.digest+".capsule"));
 open(false);
 await issue("followup_task",{target:child.nativeSessionId,message:"Must not rebuild the missing child prefix"},"missing-child");
 assert.equal(childRequests().length,3);
 const outputs=requests.filter(request=>request.client_metadata?.thread_id===rootNativeId).at(-1).input.filter(item=>item.type==="function_call_output" && item.call_id==="missing-child");
 assert.ok(outputs.length);assert.match(JSON.stringify(outputs),/prefix|recovery|load/i);
});
