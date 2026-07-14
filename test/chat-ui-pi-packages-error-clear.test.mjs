import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("clearing the Pi package source clears its invalid-source error", async () => {
	const source = await readFile("src/apps/chat-ui/src/settings/SettingsView.tsx", "utf8");
	const piPackages = source.slice(source.indexOf("function PiPackagesSettings"), source.indexOf("function UserSkillsSettings"));

	assert.match(piPackages, /const nextSource = event\.target\.value;\s*setSource\(nextSource\);\s*if \(!nextSource\.trim\(\)\) setError\(null\);/);
});
