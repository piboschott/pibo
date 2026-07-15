import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("manual telemetry cleanup rejects retention outside 1 to 365 days", async () => {
	const source = await readFile("src/apps/chat-ui/src/settings/SettingsView.tsx", "utf8");
	const retention = source.slice(source.indexOf("function TelemetryRetentionSettings"), source.indexOf("function clampRetentionDays"));

	assert.match(retention, /const manualDaysValid = Number\.isInteger\(manualDays\) && manualDays >= 1 && manualDays <= 365/);
	assert.match(retention, /if \(!manualDaysValid\) \{\s*setError\("Manual cleanup retention must be between 1 and 365 days\."\);\s*return;/);
	assert.match(retention, /disabled=\{pruning \|\| !manualDaysValid\}/);
});
