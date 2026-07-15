import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("canceling Install Skill clears its transient validation error", async () => {
	const source = await readFile("src/apps/chat-ui/src/settings/SettingsView.tsx", "utf8");
	const installModal = source.slice(source.indexOf("{installOpen ? ("), source.indexOf("{editSkill ? ("));

	assert.match(installModal, /onInstall=\{handleInstall\}/);
	assert.match(installModal, /onClose=\{\(\) => \{\s*setInstallOpen\(false\);\s*setError\(null\);\s*\}\}/);
});
