import { piboCorePlugin } from "../dist/plugins/builtin.js";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
for (const api of ["openai-responses", "openai-codex-responses", "openai-codex-responses-lite", "openai-codex-responses-websocket", "openai-codex-responses-lite-websocket"]) for (const mode of ["adapter", "router"]) test(`normal OMP ${mode} seals and resumes the protected native request; api=${api}`, { skip: !bun || !entry, timeout: 60000 }, async t => {
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
	const respond = (request, transport) => {
		requests.push(request); transports.push(transport);
		const id = `response-${requests.length}`;
		const item = { type: "message", role: "assistant", id: `msg-${requests.length}`, content: [{ type: "output_text", text: "ok", annotations: [] }], status: "completed" };
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
			.withAgentRuntime("omp-native").withAutoContextFiles(false).withToolPackages({ goalControl: false })
			.withModel({ provider: "fixture", id: "prefix-fixture" }).createSession() });
	} })] });
	registry.registerGatewayAction(PiboPluginRegistry.create({ plugins: [piboCorePlugin] }).getGatewayAction("session.fork"));
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
	await prompt("original input ".repeat(20000), "first");
	assert.equal(requests.length, 1);
	let prefix = binding.metadata.piboSessionPrefix;
	assert.ok(prefix?.capsule.digest);
	const competingAdapter = OMP_AGENT_RUNTIME_DRIVER.create({ instanceId: "omp-native", enabled: true, config });
	const competingController = new SessionPrefixController({
		store: new PrefixCapsuleStore(mode === "router" ? join(process.env.PIBO_HOME, "session-prefixes") : join(root, "prefixes")),
		getBinding: () => binding,
		persistence: createAgentRuntimeBindingPersistence(sessions, { piboSessionId: session.id }),
	});
	await assert.rejects(competingAdapter.preparePrefixOwnership({ binding, workspace: root, controller: competingController }));
	assert.equal(requests.length, 1, "a competing child cannot dispatch");
	const transcript = await readFile(binding.metadata.nativeSessionFile, "utf8");
	await router?.disposeAll(); router = undefined; await native?.dispose(); native = undefined; await release?.(); release = undefined;
	if (mode === "adapter" && api === "openai-responses") {
		// Encode the already captured request as the previous writer's fixture.
		const capsules = new PrefixCapsuleStore(join(root, "prefixes"));
		const snapshot = JSON.parse(await capsules.read(prefix.capsule, { adapterId: "orp", codec: prefix.capsule.codec }));
		snapshot.format = 1; delete snapshot.api;
		const capsule = await capsules.put("orp", OMP_LEGACY_PREFIX_CODEC, JSON.stringify(snapshot));
		prefix = { ...prefix, capsule };
		binding = { ...binding, metadata: { ...binding.metadata, piboSessionPrefix: prefix } };
		const fixture = new DatabaseSync(join(root, "sessions.sqlite"));
		try { fixture.prepare("UPDATE pibo_session_runtime_bindings SET metadata_json=? WHERE pibo_session_id=?")
			.run(JSON.stringify(binding.metadata), session.id); }
		finally { fixture.close(); }
	}
	await writeFile(join(root, "AGENTS.md"), "Changed native project instructions after restart");
	await open();
	await prompt("follow-up input ".repeat(4000), "second");
	assert.equal(requests.length, 2);
	assert.deepEqual(transports, Array(2).fill(websocket ? "websocket" : "http"));
	assert.deepEqual(binding.metadata.piboSessionPrefix, prefix);
	const envelope = value => Object.fromEntries(Object.entries(value).filter(([key]) => !["input", "client_metadata", "previous_response_id"].includes(key)));
	assert.deepEqual(envelope(requests[1]), envelope(requests[0]));
	assert.deepEqual(requests[1].input.slice(0, requests[0].input.length), requests[0].input);
	assert.ok((await readFile(binding.metadata.nativeSessionFile, "utf8")).startsWith(transcript));
	if (mode === "router") {
		const candidates = await router.getSessionForkCandidates(session.id);
		assert.ok(candidates.length >= 2);
		const forked = await new Promise((resolve, reject) => {
			const timer = setTimeout(() => { unsubscribe(); reject(new Error("OMP fork did not complete")); }, 20000);
			const unsubscribe = router.subscribe(event => {
				if (event.eventId !== "fork" || !["execution_result", "session_error"].includes(event.type) || event.result?.queued) return;
				clearTimeout(timer); unsubscribe(); resolve(event);
			});
			void router.emit({ type: "execution", piboSessionId: session.id, id: "fork", action: "session.fork", params: { entryId: candidates.at(-1).entryId } }).catch(error => { clearTimeout(timer); unsubscribe(); reject(error); });
		});
		assert.notEqual(forked.type, "session_error", JSON.stringify(forked));
		const childId = forked.result.piboSessionId;
		const child = sessions.get(childId);
		assert.notEqual(child.runtimeBinding.nativeSessionId, binding.nativeSessionId);
		assert.equal(child.runtimeBinding.metadata.piboSessionPrefix.capsule.digest, prefix.capsule.digest);
		const childHome = join(config.homeRoot, "omp-native", "sessions", childId, "agent");
		await mkdir(childHome, { recursive: true });
		await writeFile(join(childHome, "models.yml"), await readFile(join(home, "models.yml")));
		await router.emitMessageAndWaitForReply({ type: "message", piboSessionId: childId, id: "child-first", source: "user", text: "Continue the derived conversation" }, 20000);
		assert.deepEqual(requests.at(-1).tools, requests[0].tools);
		assert.deepEqual(requests.at(-1).input.slice(0, 1), requests[0].input.slice(0, 1));
		assert.ok(JSON.stringify(requests.at(-1).input).includes(childId));
		const originalPrefix = sessions.get(childId).runtimeBinding.metadata.piboSessionPrefix;
		const select = async id => {
			const selected = { provider: "fixture", id };
			await router.setLiveSessionActiveModel(childId, selected);
			sessions.update(childId, { activeModel: selected });
		};
		await router.disposeAll(); router = undefined; await open();
		await select("prefix-second");
		assert.ok(sessions.get(childId).runtimeBinding.metadata.piboSessionPrefixRebaseline);
		await router.disposeAll(); router = undefined; await open();
		await router.emitMessageAndWaitForReply({ type: "message", piboSessionId: childId, id: "changed-model", source: "user", text: "Use the selected model" }, 20000);
		const changedPrefix = sessions.get(childId).runtimeBinding.metadata.piboSessionPrefix;
		assert.equal(changedPrefix.epoch, originalPrefix.epoch + 1);
		assert.equal(requests.at(-1).model, "prefix-second");
		assert.equal(sessions.get(childId).runtimeBinding.metadata.piboSessionPrefixRebaseline, undefined);
		await select("prefix-fixture");
		await select("prefix-second");
		assert.equal(sessions.get(childId).runtimeBinding.metadata.piboSessionPrefixRebaseline, undefined);
		assert.deepEqual(sessions.get(childId).runtimeBinding.metadata.piboSessionPrefix, changedPrefix);
		const previousRuntime = sessions.get(childId).runtimeBinding;
		let fresh = await router.rebindSessionRuntime(childId, { runtimeInstanceId: previousRuntime.runtimeInstanceId, expectedRevision: previousRuntime.revision, startFresh: true });
		const originalHistory = await readFile(previousRuntime.metadata.nativeSessionFile);
		const cancelled = await router.rebindSessionRuntime(childId, { runtimeInstanceId: previousRuntime.runtimeInstanceId, expectedRevision: fresh.revision });
		assert.deepEqual(cancelled.metadata.piboSessionPrefix, previousRuntime.metadata.piboSessionPrefix);
		fresh = await router.rebindSessionRuntime(childId, { runtimeInstanceId: previousRuntime.runtimeInstanceId, expectedRevision: cancelled.revision, startFresh: true });
		await router.disposeAll(); router = undefined; await open();
		await router.emitMessageAndWaitForReply({ type: "message", piboSessionId: childId, id: "fresh-runtime", source: "user", text: "Start the explicitly selected fresh session" }, 20000);
		const replacement = sessions.get(childId).runtimeBinding;
		assert.notEqual(replacement.nativeSessionId, previousRuntime.nativeSessionId);
		assert.equal(replacement.metadata.piboSessionPrefix.epoch, changedPrefix.epoch + 1);
		assert.equal(replacement.metadata.piboSessionPrefix.reason, "runtime-change");
		assert.equal(replacement.metadata.piboSessionPrefixRebaseline, undefined);
		assert.deepEqual(await readFile(previousRuntime.metadata.nativeSessionFile), originalHistory);
	}
	if (mode === "adapter") {
		await prompt("third native turn before compaction ".repeat(5000), "precompact");
		await native.controls.compact();
		assert.equal(binding.metadata.piboSessionPrefix.epoch, prefix.epoch + 1);
		assert.equal(binding.metadata.piboSessionPrefix.capsule.digest, prefix.capsule.digest);
		assert.equal(binding.metadata.piboSessionPrefixTransition.state, "completed");
		await prompt("after compaction", "third");
		assert.deepEqual(envelope(requests.at(-1)), envelope(requests[0]));
	}
	await router?.disposeAll(); router = undefined; await native?.dispose(); native = undefined; await release?.(); release = undefined;
	const prefixRoot = mode === "router" ? join(process.env.PIBO_HOME, "session-prefixes") : join(root, "prefixes");
	await rm(join(prefixRoot, `${prefix.capsule.digest}.capsule`));
	const dispatched = requests.length;
	await assert.rejects(async () => { await open(); await prompt("must not dispatch", "missing"); }, /recovery|capsule|missing/i);
	assert.equal(requests.length, dispatched);
});
