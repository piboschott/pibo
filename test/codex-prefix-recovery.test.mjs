import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { recoverCodexPrefixCompaction } from "../dist/agent-runtimes/codex-native/prefix-recovery.js";

for (const [name, tail, expected] of [
	["unchanged native history aborts the receipt", "", false],
	["native checkpoint completes the receipt", JSON.stringify({ type: "compacted", payload: { replacement_history: [] } }) + "\n", true],
	["partial checkpoint stays closed", '{"type":"compacted"', undefined],
	["assistant output without checkpoint stays closed", JSON.stringify({ type: "response_item", payload: { role: "assistant" } }) + "\n", undefined],
	["invalid replacement history stays closed", JSON.stringify({ type: "compacted", payload: {} }) + "\n", undefined],
]) test(`Codex cold compaction recovery: ${name}`, async t => {
	const root = await mkdtemp(join(tmpdir(), "codex-prefix-recovery-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const path = join(root, "native.jsonl");
	const prefix = "native-owned-history\n";
	await writeFile(path, prefix + tail);
	const completed = [];
	const controller = {
		transition: { state: "pending", id: "receipt", nativeSessionId: "native", sourceHead: `offset:${Buffer.byteLength(prefix)}` },
		getRuntimeBinding: () => ({ nativeSessionId: "native", metadata: { nativeSessionFile: path } }),
		finishCompaction: async (...args) => { completed.push(args); },
	};
	if (expected === undefined) await assert.rejects(recoverCodexPrefixCompaction(controller));
	else await recoverCodexPrefixCompaction(controller);
	assert.deepEqual(completed, expected === undefined ? [] : [["receipt", expected]]);
	await rm(path);
	await writeFile(join(root, "other.jsonl"), prefix + tail);
	await symlink(join(root, "other.jsonl"), path);
	await assert.rejects(recoverCodexPrefixCompaction(controller));
});
