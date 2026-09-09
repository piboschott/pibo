import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { PrefixRecoveryRequiredError } from "../../sessions/prefix-capsule.js";
import type { SessionPrefixController } from "../../sessions/prefix-session.js";

/** Cold recovery only, while the native child holds both session locks. */
export async function recoverCodexPrefixCompaction(controller: SessionPrefixController): Promise<void> {
	const transition = controller.transition;
	if (transition?.state !== "pending") return;
	const binding = controller.getRuntimeBinding();
	const path = binding.metadata?.nativeSessionFile;
	const fail = () => new PrefixRecoveryRequiredError("Codex compaction checkpoint requires recovery");
	if (binding.nativeSessionId !== transition.nativeSessionId || typeof path !== "string" || !isAbsolute(path)
		|| !transition.sourceHead || !/^offset:\d+$/.test(transition.sourceHead)) throw fail();
	const offset = Number(transition.sourceHead.slice(7));
	if (!Number.isSafeInteger(offset) || offset < 0) throw fail();
	const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
	try {
		const stat = await file.stat();
		const length = stat.size - offset;
		if (!stat.isFile() || length < 0 || length > 8 * 1024 * 1024) throw fail();
		if (length === 0) { await controller.finishCompaction(transition.id, false); return; }
		const bytes = Buffer.alloc(length);
		let read = 0;
		while (read < length) {
			const result = await file.read(bytes, read, length - read, offset + read);
			if (!result.bytesRead) throw fail();
			read += result.bytesRead;
		}
		if (bytes.at(-1) !== 10) throw fail();
		const lines = new TextDecoder("utf8", { fatal: true }).decode(bytes).trimEnd().split("\n");
		let checkpoint = false;
		for (const line of lines) {
			const item = JSON.parse(line);
			if (item?.type === "compacted" && Array.isArray(item.payload?.replacement_history)) checkpoint = true;
		}
		if (!checkpoint) throw fail();
		// The checkpoint becomes durable before publishing the completed epoch.
		await file.sync();
		await controller.finishCompaction(transition.id, true);
	} finally { await file.close(); }
}
