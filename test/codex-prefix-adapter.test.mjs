import assert from "node:assert/strict";
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
for (const transport of ["http", "websocket"]) for (const lite of [false, true]) for (const tokenBudget of [false, true]) test(`normal Codex router preserves native prefix, restart and compaction; transport=${transport}; lite=${lite}; tokenBudget=${tokenBudget}`, { skip: !binary, timeout: 120000 }, async t => {
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
	for (const action of ["compact", "session.clone", "session.fork"]) registry.registerGatewayAction(PiboPluginRegistry.create({ plugins: [piboCorePlugin] }).getGatewayAction(action));
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
	assert.equal(requests.length, 1);
	const binding = sessions.get(session.id).runtimeBinding;
	const prefix = binding.metadata.piboSessionPrefix;
	assert.ok(prefix?.capsule.digest);
	const nativePath = binding.metadata.nativeSessionFile;
	assert.ok(nativePath);
	const transcript = await readFile(nativePath, "utf8");
	let competitorBinding = sessions.get(session.id).runtimeBinding;
	const competitorController = new SessionPrefixController({ getBinding: () => competitorBinding,
		persistence: createAgentRuntimeBindingPersistence(sessions, { piboSessionId: session.id,
			onPersisted: next => { competitorBinding = next; } }) });
	const competitor = new CodexPrefixOpen(config, competitorController, root, false);
	try { await assert.rejects(competitor.prepare(), /prefix|native|start/i); }
	finally { await competitor.dispose(); }
	assert.equal(requests.length, 1, "a competing native child must not dispatch");
	await router.disposeAll(); router = undefined;
	await rm(context);
	await writeFile(join(root, "AGENTS.md"), "Changed native project context");
	catalog.models[0].base_instructions = "Changed current catalog instructions";
	await writeFile(catalogPath, JSON.stringify(catalog));
	open(false);
	await prompt("follow-up input", "second");
	assert.equal(requests.length, 2);
	assert.deepEqual(transports, [transport, transport]);
	assert.deepEqual(sessions.get(session.id).runtimeBinding.metadata.piboSessionPrefix, prefix);
	const envelope = value => Object.fromEntries(Object.entries(value).filter(([key]) => !["input", "client_metadata", "previous_response_id"].includes(key)));
	assert.deepEqual(envelope(requests[1]), envelope(requests[0]));
	assert.deepEqual(requests[1].input.slice(0, requests[0].input.length), requests[0].input);
	assert.ok((await readFile(nativePath, "utf8")).startsWith(transcript));
	requestNativeTool = true;
	const beforeTool = requests.length;
	await prompt("Run the requested native tool and report its result", "native-tool");
	assert.equal(requests.length, beforeTool + 2, "native tool execution must cause a second protected model dispatch");
	const toolOutput = requests.at(-1).input.find(item => item.type === "function_call_output" && item.call_id === "native-prefix-tool");
	assert.ok(toolOutput, "native tool result must return through the model protocol");
	assert.doesNotMatch(JSON.stringify(toolOutput.output), /unsupported call|error|failed/i);
	assert.equal(JSON.parse(toolOutput.output).goal, null, "the native goal reader must report the empty fixture state");
	assert.deepEqual(envelope(requests.at(-1)), envelope(requests[0]));
	const compact = (id, action = "compact", params = {}) => new Promise((resolve, reject) => {
		const timer = setTimeout(() => { unsubscribe(); reject(new Error("Native compaction did not complete")); }, 30000);
		const unsubscribe = router.subscribe(event => {
			if (event.eventId !== id || event.type !== "execution_result" && event.type !== "session_error") return;
			if (event.result?.queued) return;
			clearTimeout(timer); unsubscribe(); resolve(event);
		});
		void router.emit({ type: "execution", piboSessionId: session.id, id, action, params })
			.catch(error => { clearTimeout(timer); unsubscribe(); reject(error); });
	});
	{
		const cloned = await compact("clone", "session.clone");
		assert.notEqual(cloned.type, "session_error", JSON.stringify(cloned));
		const childId = cloned.result.piboSessionId;
		assert.notEqual(childId, session.id);
		const child = sessions.get(childId);
		assert.equal(child.runtimeBinding.metadata.piboSessionPrefix.capsule.digest, prefix.capsule.digest);
		assert.notEqual(child.runtimeBinding.nativeSessionId, binding.nativeSessionId);
		await prompt("Continue the derived conversation", "child-first", childId);
		assert.equal(requests.at(-1).instructions, requests[0].instructions);
		assert.deepEqual(requests.at(-1).tools, requests[0].tools);
		assert.ok(JSON.stringify(requests.at(-1).input).includes(childId));
	}
	if (transport === "http" && !lite && !tokenBudget) {
		const candidates = await router.getSessionForkCandidates(session.id);
		assert.ok(candidates.length > 0);
		const forked = await compact("first-turn-fork", "session.fork", { entryId: candidates[0].entryId });
		assert.notEqual(forked.type, "session_error", JSON.stringify(forked));
		const childId = forked.result.piboSessionId;
		assert.equal(sessions.get(childId).runtimeBinding.metadata.piboSessionPrefix.capsule.digest, prefix.capsule.digest);
		await prompt("Begin the derived conversation before its first original turn", "first-turn-child", childId);
		assert.equal(requests.at(-1).instructions, requests[0].instructions);
		assert.ok(!JSON.stringify(requests.at(-1).input).includes("original input original input"));
		assert.ok(JSON.stringify(requests.at(-1).input).includes(childId));
	}
	const compacted = await compact("compact");
	assert.notEqual(compacted.type, "session_error", JSON.stringify(compacted));
	const afterCompact = sessions.get(session.id).runtimeBinding.metadata;
	assert.equal(afterCompact.piboSessionPrefix.epoch, prefix.epoch + 1,
		JSON.stringify({ compacted, transition: afterCompact.piboSessionPrefixTransition, requests: requests.length }));
	assert.equal(afterCompact.piboSessionPrefix.capsule.digest, prefix.capsule.digest);
	assert.equal(afterCompact.piboSessionPrefixTransition.state, "completed");
	await prompt("after native compaction", "third");
	assert.deepEqual(envelope(requests.at(-1)), envelope(requests[0]));
	if (transport === "http" && !lite && !tokenBudget) {
		// Native checkpoint reaches disk, but the parent cannot publish its receipt.
		const fault = new DatabaseSync(join(root, "sessions.sqlite"));
		fault.exec(`CREATE TRIGGER fail_prefix_finish BEFORE UPDATE ON pibo_session_runtime_bindings
WHEN json_extract(OLD.metadata_json, '$.piboSessionPrefixTransition.state') = 'pending'
AND json_extract(NEW.metadata_json, '$.piboSessionPrefixTransition.state') = 'completed'
BEGIN SELECT RAISE(ABORT, 'Fixture final receipt unavailable'); END;`);
		let failed;
		try { failed = await compact("checkpoint-before-receipt"); }
		finally { fault.exec("DROP TRIGGER fail_prefix_finish"); fault.close(); }
		assert.equal(failed.type, "session_error");
		assert.equal(sessions.get(session.id).runtimeBinding.metadata.piboSessionPrefixTransition.state, "pending");
		await router.disposeAll(); router = undefined;
		open(false);
		await prompt("after recovering the native checkpoint", "recovered");
		const recovered = sessions.get(session.id).runtimeBinding.metadata;
		assert.equal(recovered.piboSessionPrefix.epoch, prefix.epoch + 2);
		assert.equal(recovered.piboSessionPrefix.capsule.digest, prefix.capsule.digest);
		assert.equal(recovered.piboSessionPrefixTransition.state, "completed");
		assert.deepEqual(envelope(requests.at(-1)), envelope(requests[0]));
	}
	const beforeFailure = requests.length;
	const fault = new DatabaseSync(join(root, "sessions.sqlite"));
	fault.exec(`CREATE TRIGGER fail_prefix_transition BEFORE UPDATE ON pibo_session_runtime_bindings
WHEN json_extract(NEW.metadata_json, '$.piboSessionPrefixTransition.state') = 'pending'
BEGIN SELECT RAISE(ABORT, 'Fixture transition storage unavailable'); END;`);
	let failed;
	try { failed = await compact("failed-compaction"); }
	finally { fault.exec("DROP TRIGGER fail_prefix_transition"); fault.close(); }
	assert.equal(failed.type, "session_error", JSON.stringify({ failed, requests: requests.length, beforeFailure,
		transition: sessions.get(session.id).runtimeBinding.metadata.piboSessionPrefixTransition }));
	assert.equal(requests.length, beforeFailure);
	await assert.rejects(prompt("must stay closed after receipt failure", "closed"), /recovery|prefix|checkpoint/i);
	assert.equal(requests.length, beforeFailure);
	await router.disposeAll(); router = undefined;
	await rm(join(process.env.PIBO_HOME, "session-prefixes", `${prefix.capsule.digest}.capsule`));
	open(false);
	const dispatched = requests.length;
	await assert.rejects(prompt("must not dispatch", "missing"), /recovery|capsule|missing/i);
	assert.equal(requests.length, dispatched);
});
