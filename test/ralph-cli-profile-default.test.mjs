import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

test("ralph add defaults new CLI jobs to the base profile", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "pibo-ralph-cli-profile-"));
	const storePath = join(cwd, "ralph.sqlite");
	const result = await execFileAsync("node", [
		"dist/bin/pibo.js",
		"ralph",
		"--store",
		storePath,
		"add",
		"--prompt",
		"hello",
		"--default-chat",
		"--json",
	], { cwd: process.cwd() });
	const job = JSON.parse(result.stdout);

	assert.equal(job.profile, "base");
});
