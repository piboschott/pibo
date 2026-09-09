import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createServer } from "node:http";
import { NativePrefixBridge } from "../dist/sessions/native-prefix-bridge.js";
import { SessionPrefixController } from "../dist/sessions/prefix-session.js";
import { PrefixCapsuleStore } from "../dist/sessions/prefix-capsule.js";
import { SqlitePiboSessionStore } from "../dist/sessions/sqlite-store.js";
import { createAgentRuntimeBindingPersistence } from "../dist/sessions/runtime-binding-persistence.js";
import { NativePrefixStartupGate } from "../dist/sessions/native-prefix-startup.js";
import { PrefixSessionOwnership } from "../dist/sessions/prefix-ownership.js";
import { createOmpPrefixBootstrapSource } from "../dist/agent-runtimes/omp/prefix-bootstrap.js";

async function fixture(t, brokenStore = false, startup) {
	const root = await mkdtemp(join(tmpdir(), "native-prefix-bridge-"));
	const sessions = new SqlitePiboSessionStore(join(root, "sessions.sqlite"));
	const session = sessions.create({ channel: "test", kind: "chat", profile: "base" });
	let binding = sessions.updateRuntimeBinding(session.id, { ...session.runtimeBinding, state: "bound" }, { expectedRevision: 1 });
	const path = join(root, "prefixes");
	if (brokenStore) await writeFile(path, "unavailable directory");
	const controller = new SessionPrefixController({ store: new PrefixCapsuleStore(path), getBinding: () => binding,
		readCurrentBinding: () => sessions.get(session.id).runtimeBinding,
		persistence: createAgentRuntimeBindingPersistence(sessions, { piboSessionId: session.id, onPersisted: next => { binding = next; } }) });
	const bridge = new NativePrefixBridge(controller, "native-fixture/v1", startup);
	const connection = await bridge.start();
	t.after(async () => { await bridge.dispose(); sessions.close(); await rm(root, { recursive: true, force: true }); });
	const headers = { authorization: `Bearer ${connection.token}`, "x-native-session-id": session.piSessionId, "x-native-has-history": "false" };
	return { root, sessions, session, connection, headers, controller, bridge };
}

test("private native derivation requires an authenticated endpoint and exact pending receipt", async t => {
	const f = await fixture(t);
	await f.controller.seal({ codec: "native-fixture/v1", payload: "frozen", nativeSessionId: f.session.piSessionId,
		evidence: "adapter-inputs", hasHistoricalModelInput: false });
	await assert.rejects(f.bridge.derive(), /unavailable/);
	assert.equal((await fetch(f.connection.endpoint + "/control", { method: "POST", body: '{}' })).status, 403);
	assert.equal((await fetch(f.connection.endpoint + "/control", { method: "POST", headers: f.headers,
		body: JSON.stringify({ endpoint: "https://example.invalid/derive" }) })).status, 409);
	let rejectedReceipt;
	const control = createServer(async (request, response) => {
		try {
			assert.equal(request.headers.authorization, f.headers.authorization);
			const chunks = []; for await (const chunk of request) chunks.push(chunk);
			const { nonce } = JSON.parse(Buffer.concat(chunks).toString());
			const pending = await (await fetch(f.connection.endpoint + "/derive", { headers: f.headers })).json();
			assert.equal(pending.nonce, nonce);
			const receipt = { nonce, sourceNativeSessionId: f.session.piSessionId, nativeSessionId: 'derived-native', nativeSessionFile: join(f.root, 'derived.jsonl') };
			rejectedReceipt = (await fetch(f.connection.endpoint + "/derive", { method: 'POST', headers: f.headers, body: JSON.stringify({ ...receipt, nonce: 'wrong' }) })).status;
			assert.equal((await fetch(f.connection.endpoint + "/derive", { method: 'POST', headers: f.headers, body: JSON.stringify(receipt) })).status, 200);
			response.writeHead(200).end();
		} catch { response.writeHead(500).end(); }
	});
	await new Promise(resolve => control.listen(0, '127.0.0.1', resolve));
	t.after(async () => { control.closeAllConnections(); await new Promise(resolve => control.close(resolve)); });
	assert.equal((await fetch(f.connection.endpoint + "/control", { method: 'POST', headers: f.headers,
		body: JSON.stringify({ endpoint: `http://127.0.0.1:${control.address().port}/derive` }) })).status, 200);
	assert.equal((await f.bridge.derive()).nativeSessionId, 'derived-native');
	assert.equal(rejectedReceipt, 409);
	assert.equal(f.controller.binding.nativeSessionId, f.session.piSessionId, 'native copying alone must not publish a new binding');
});

test("native startup gate authenticates, bounds activation and releases a cancelled preparation", { timeout: 10000 }, async t => {
	const gate = new NativePrefixStartupGate(5000);
	const f = await fixture(t, false, gate);
	assert.throws(() => gate.activate([]), /not awaiting/);
	assert.equal((await fetch(f.connection.endpoint + "/activate")).status, 403);
	const pending = fetch(f.connection.endpoint + "/activate", { headers: f.headers });
	await gate.waitForOwnership();
	assert.equal((await fetch(f.connection.endpoint + "/activate", { headers: f.headers })).status, 409);
	assert.throws(() => gate.activate(["x".repeat(65536)]), /Invalid/);
	assert.throws(() => gate.activate(["bad\0argument"]), /Invalid/);
	gate.dispose();
	assert.equal((await pending).status, 409);
	assert.throws(() => gate.activate([]), /not awaiting/);
	await assert.rejects(gate.waitForOwnership(), /failed/);
});

test("native startup preparation has a bounded deadline even without a child", async () => {
	const gate = new NativePrefixStartupGate(10);
	await assert.rejects(gate.waitForOwnership(), /failed/);
	gate.dispose();
});

test("native completion waits for the audited compaction receipt and bounds a missing acknowledgement", async t => {
	const f = await fixture(t);
	await f.controller.seal({ codec: "native-fixture/v1", payload: "frozen", nativeSessionId: f.session.piSessionId,
		evidence: "adapter-inputs", hasHistoricalModelInput: false });
	const first = await f.controller.beginCompaction("offset:100");
	let completed = false;
	const waiting = f.controller.waitForCompactionCompletion().then(() => { completed = true; });
	await new Promise(resolve => setImmediate(resolve));
	assert.equal(completed, false);
	await f.controller.finishCompaction(first.id, true);
	await waiting;
	assert.equal(completed, true);
	await f.controller.beginCompaction("offset:200");
	await assert.rejects(f.controller.waitForCompactionCompletion(10), /not persisted/);
	assert.equal(f.controller.transition.state, "pending");
});

test("native compaction reconciles an ordinary router publication without dropping its metadata", async t => {
	const f = await fixture(t);
	await f.controller.seal({ codec: "native-fixture/v1", payload: "frozen", nativeSessionId: f.session.piSessionId,
		evidence: "adapter-inputs", hasHistoricalModelInput: false });
	const current = f.sessions.get(f.session.id).runtimeBinding;
	f.sessions.updateRuntimeBinding(f.session.id, { ...current, metadata: { ...current.metadata, nativeSessionFile: "/native/current.jsonl" } },
		{ expectedRevision: current.revision });
	const begun = await f.controller.beginCompaction("offset:100");
	assert.equal(f.controller.getRuntimeBinding().metadata.nativeSessionFile, "/native/current.jsonl");
	await f.controller.finishCompaction(begun.id, true);
	assert.equal(f.sessions.get(f.session.id).runtimeBinding.metadata.piboSessionPrefix.epoch, 2);
});

test("native activation delivers the prepared environment only after ownership", async t => {
	const gate = new NativePrefixStartupGate(5000);
	const f = await fixture(t, false, gate);
	const pending = fetch(f.connection.endpoint + "/activate", { headers: f.headers });
	await gate.waitForOwnership();
	assert.throws(() => gate.activate(["app-server"], { "bad=key": "value" }), /Invalid/);
	assert.throws(() => gate.activate(["app-server"], { GOOD_KEY: "bad\0value" }), /Invalid/);
	gate.activate(["app-server"], { FROZEN_RESOURCE: "/private/resource" });
	assert.deepEqual(await (await pending).json(), { args: ["app-server"], environment: { FROZEN_RESOURCE: "/private/resource" } });
});

const bun = process.env.PIBO_OMP_PREFIX_BUN;
for (const activate of [true, false]) test(`native child holds ownership before parent resource preparation; activation=${activate}`, { skip: !bun, timeout: 15000 }, async t => {
	const gate = new NativePrefixStartupGate(10000);
	const f = await fixture(t, false, gate);
	const marker = join(f.root, "native-imported");
	const prepared = join(f.root, "resources-prepared");
	const entry = join(f.root, "entry.mjs");
	const bootstrap = join(f.root, "bootstrap.mjs");
	await writeFile(entry, `import { readFile, writeFile } from "node:fs/promises";
await readFile(${JSON.stringify(prepared)});
await writeFile(${JSON.stringify(marker)}, "imported");
export async function runCli(args) { process.stdout.write(JSON.stringify(args)); }
`);
	const identities = [JSON.stringify(["pibo", f.session.id])];
	await writeFile(bootstrap, createOmpPrefixBootstrapSource({ entryModuleUrl: pathToFileURL(entry).href,
		prefixRoot: f.root, identities, waitForActivation: true }));
	const child = spawn(bun, [bootstrap, "must-not-be-used"], { env: { ...process.env,
		PIBO_PREFIX_ENDPOINT: f.connection.endpoint, PIBO_PREFIX_TOKEN: f.connection.token }, stdio: ["ignore", "pipe", "pipe"] });
	t.after(() => child.kill("SIGKILL"));
	let stdout = "", stderr = "";
	child.stdout.on("data", data => { stdout += data; });
	child.stderr.on("data", data => { stderr += data; });
	const exited = once(child, "exit");
	await gate.waitForOwnership();
	await assert.rejects(readFile(marker), { code: "ENOENT" });
	await assert.rejects(PrefixSessionOwnership.acquire(f.root, identities), /already held/);
	if (activate) {
		await writeFile(prepared, "ready");
		gate.activate(["--mode", "rpc", "literal $() `text`"]);
		assert.throws(() => gate.activate([]), /not awaiting/);
		assert.equal((await exited)[0], 0);
		assert.deepEqual(JSON.parse(stdout), ["--mode", "rpc", "literal $() `text`"]);
		assert.equal(await readFile(marker, "utf8"), "imported");
	} else {
		await f.bridge.dispose();
		assert.equal((await exited)[0], 78);
		await assert.rejects(readFile(marker), { code: "ENOENT" });
		assert.equal(stderr.trim(), "Pibo native prefix recovery required: native-entry");
	}
	const owner = await PrefixSessionOwnership.acquire(f.root, identities);
	owner.release();
	assert.equal(stdout.includes(f.connection.token), false);
	assert.equal(stderr.includes(f.connection.token), false);
});

test("native capture IPC acknowledges only a durably bound original snapshot", async t => {
	const f = await fixture(t);
	const url = f.connection.endpoint;
	assert.equal((await fetch(`${url}/snapshot`)).status, 403);
	assert.equal((await fetch(`${url}/snapshot`, { headers: f.headers })).status, 404);
	assert.equal((await fetch(`${url}/seal`, { method: "POST", headers: { ...f.headers, "x-native-has-history": "true" }, body: "legacy" })).status, 409);
	assert.equal((await fetch(`${url}/seal`, { method: "POST", headers: { ...f.headers, "x-native-session-id": "wrong" }, body: "wrong identity" })).status, 409);
	assert.equal((await fetch(`${url}/seal`, { method: "POST", headers: f.headers, body: Buffer.from([0xff]) })).status, 409);
	assert.equal(f.controller.binding, undefined);
	const payload = JSON.stringify({ format: 1, instructions: "private native prefix", tools: [] });
	const response = await fetch(`${url}/seal`, { method: "POST", headers: f.headers, body: payload });
	assert.equal(response.status, 200);
	const ack = await response.json();
	assert.equal(ack.digest, f.sessions.get(f.session.id).runtimeBinding.metadata.piboSessionPrefix.capsule.digest);
	assert.equal(await (await fetch(`${url}/snapshot`, { headers: f.headers })).text(), payload);
	const rejected = await fetch(`${url}/seal`, { method: "POST", headers: f.headers, body: "replacement secret" });
	assert.equal(rejected.status, 409);
	assert.equal(await rejected.text(), "prefix-recovery-required");
	assert.equal(await f.controller.restore("native-fixture/v1"), payload);
});

test("native capture IPC never acknowledges failed snapshot persistence", async t => {
	const f = await fixture(t, true);
	const response = await fetch(`${f.connection.endpoint}/seal`, { method: "POST", headers: f.headers, body: "must not dispatch" });
	assert.equal(response.status, 409);
	assert.equal(f.controller.binding, undefined);
	assert.equal(f.sessions.get(f.session.id).runtimeBinding.metadata.piboSessionPrefix, undefined);
});

test("native transition IPC commits bounded receipts before acknowledging compaction", async t => {
	const f = await fixture(t);
	const send = (path, body) => fetch(f.connection.endpoint + path, { method: "POST", headers: f.headers, body: JSON.stringify(body) });
	assert.equal((await send("/compaction/begin", { sourceHead: "head" })).status, 409);
	assert.equal((await fetch(f.connection.endpoint + "/seal", { method: "POST", headers: f.headers, body: "original" })).status, 200);
	assert.equal((await send("/compaction/begin", { sourceHead: "head", unexpected: true })).status, 409);
	assert.equal((await send("/compaction/begin", { sourceHead: "x".repeat(5000) })).status, 413);
	const pending = await (await send("/compaction/begin", { sourceHead: "head" })).json();
	assert.equal(pending.state, "pending");
	assert.deepEqual(f.sessions.get(f.session.id).runtimeBinding.metadata.piboSessionPrefixTransition, pending);
	assert.equal((await send("/compaction/finish", { id: "wrong", changed: true })).status, 409);
	assert.equal((await send("/compaction/finish", { id: pending.id, changed: "true" })).status, 409);
	assert.equal((await send("/compaction/finish", { id: pending.id, changed: true })).status, 200);
	assert.equal(f.controller.binding.epoch, 2);
	assert.equal(await f.controller.restore("native-fixture/v1"), "original");
	assert.equal((await send("/compaction/finish", { id: pending.id, changed: true })).status, 409);
	const receipt = await (await fetch(f.connection.endpoint + "/transition", { headers: f.headers })).json();
	assert.equal(receipt.state, "completed");
});

test("native capture IPC refuses dispatch when publication succeeds but the binding CAS loses", async t => {
	const f = await fixture(t);
	const current = f.sessions.get(f.session.id).runtimeBinding;
	f.sessions.updateRuntimeBinding(f.session.id, { ...current, metadata: { externalChange: true } }, { expectedRevision: current.revision });
	const response = await fetch(`${f.connection.endpoint}/seal`, { method: "POST", headers: f.headers, body: "published but unbound" });
	assert.equal(response.status, 409);
	assert.equal(f.sessions.get(f.session.id).runtimeBinding.metadata.piboSessionPrefix, undefined);
});

test("native child dispatches seal independently and concurrent cold requests retain both references", async t => {
 const f = await fixture(t);
 await f.controller.seal({codec:"native-fixture/v1",payload:"root",nativeSessionId:f.session.piSessionId,evidence:"adapter-inputs",hasHistoricalModelInput:false});
 const send=(id,body,historical="false")=>fetch(f.connection.endpoint+"/children/"+id+"/seal",{method:"POST",headers:{...f.headers,"x-native-has-history":historical,"x-native-session-file":Buffer.from(join(f.root,id+".jsonl")).toString("base64url")},body});
 const responses = await Promise.all([send("child-a","first child"),send("child-b","second child")]);
 assert.deepEqual(responses.map(response=>response.status),[200,200]);
 const metadata = f.sessions.get(f.session.id).runtimeBinding.metadata;
 assert.equal(metadata.piboSessionPrefixNativeChildren.length,2);
 assert.equal(metadata.piboSessionPrefix.epoch,1);
 const restored=await fetch(f.connection.endpoint+"/children/child-a/snapshot",{headers:f.headers});
 assert.equal(restored.status,200);assert.equal(await restored.text(),"first child");
 assert.equal((await send("child-a","changed child")).status,409);
 assert.equal((await send("unknown-old","unproven history","true")).status,409);
 const binding=f.sessions.get(f.session.id).runtimeBinding;
 assert.throws(()=>f.sessions.updateRuntimeBinding(f.session.id,{...binding,metadata:{...binding.metadata,piboSessionPrefixNativeChildren:[]}},{expectedRevision:binding.revision}),/cannot be discarded/);
 const fresh = new SessionPrefixController({store:new PrefixCapsuleStore(join(f.root,"prefixes")),getBinding:()=>f.sessions.get(f.session.id).runtimeBinding,persistence:createAgentRuntimeBindingPersistence(f.sessions,{piboSessionId:f.session.id})});
 assert.equal((await fresh.restoreNativeChild("child-b","native-fixture/v1")).payload,"second child");
 const compact=(action,body)=>fetch(f.connection.endpoint+"/children/child-a/compaction-"+action,{method:"POST",headers:f.headers,body:JSON.stringify(body)});
 const begun=await compact("begin",{sourceHead:"before"});assert.equal(begun.status,200);const transition=await begun.json();
 assert.equal((await fresh.restoreNativeChild("child-a","native-fixture/v1")).child.transition.state,"pending");
 assert.equal((await compact("finish",{id:"wrong",changed:true})).status,409);
 assert.equal((await compact("finish",{id:transition.id,changed:true})).status,200);
 assert.equal((await fresh.restoreNativeChild("child-a","native-fixture/v1")).child.prefix.epoch,2);
 assert.equal((await fresh.restoreNativeChild("child-b","native-fixture/v1")).child.prefix.epoch,1);
 assert.equal(f.controller.binding.epoch,1);
 const inherited=await fetch(f.connection.endpoint+"/children/native-fork/seal",{method:"POST",headers:{...f.headers,"x-native-has-history":"true","x-native-prefix-parent":f.session.piSessionId,"x-native-session-file":Buffer.from(join(f.root,"native-fork.jsonl")).toString("base64url")},body:"new native child with inherited context"});
 assert.equal(inherited.status,200);
 const inventory=await (await fetch(f.connection.endpoint+"/inventory",{headers:f.headers})).json();
 assert.equal(inventory.root.nativeSessionId,f.session.piSessionId);
 assert.equal(inventory.children.length,3);
 assert.equal(inventory.children.find(child=>child.nativeSessionId==="native-fork").nativeSessionFile,join(f.root,"native-fork.jsonl"));


});
