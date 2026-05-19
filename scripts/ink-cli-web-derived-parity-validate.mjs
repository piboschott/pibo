#!/usr/bin/env node
import { spawn } from "node:child_process";

const checks = [
	{
		id: "matrix-shared-fixtures",
		areas: ["header", "preview-expansion", "slash-commands", "pickers", "room-session-names", "redaction"],
		command: ["node", "--test", "test/terminal-parity-fixtures.test.mjs", "test/session-ui-view-models.test.mjs"],
	},
	{
		id: "ink-renderer-controller",
		areas: ["row-grammar", "spacing", "details", "json", "markdown-code", "status", "no-color-narrow"],
		command: ["node", "--test", "test/cli-ui-ink-renderer.test.mjs", "test/cli-ui-session-app.test.mjs", "test/cli-session-source.test.mjs"],
	},
	{
		id: "web-semantic-hooks-final",
		areas: ["header", "details", "json", "status", "streaming", "redaction"],
		command: ["node", "--test", "test/ink-cli-terminal-rendering-parity-final.test.mjs"],
	},
	{
		id: "pty-scenario-catalog",
		areas: ["streaming", "slash-commands", "pickers", "room-session-names", "no-color-narrow"],
		command: ["node", "scripts/ink-cli-v2-pty-smoke.mjs", "--list"],
	},
	{
		id: "typecheck",
		areas: ["web-preservation", "renderer-boundary"],
		command: ["npm", "run", "typecheck"],
	},
];

const args = new Set(process.argv.slice(2));
const shouldRun = args.has("--run");
const asJson = args.has("--json");

if (asJson) {
	process.stdout.write(`${JSON.stringify({ checks }, null, 2)}\n`);
	process.exit(0);
}

if (!shouldRun) {
	for (const check of checks) {
		process.stdout.write(`${check.id}\t${check.areas.join(",")}\t${check.command.join(" ")}\n`);
	}
	process.stdout.write("\nRun with --run to execute these checks. PTY visual runs remain explicit commands recorded in the final report.\n");
	process.exit(0);
}

for (const check of checks) {
	process.stdout.write(`\n[${check.id}] areas=${check.areas.join(",")}\n$ ${check.command.join(" ")}\n`);
	const code = await run(check.command);
	if (code !== 0) {
		process.stderr.write(`\nFAILED ${check.id}: covers ${check.areas.join(",")}\n`);
		process.exit(code ?? 1);
	}
}

process.stdout.write("\nInk CLI Web-derived parity validation checks passed.\n");

function run(command) {
	return new Promise((resolve) => {
		const child = spawn(command[0], command.slice(1), { stdio: "inherit", shell: false });
		child.on("exit", (code) => resolve(code));
		child.on("error", (error) => {
			process.stderr.write(`${error.stack ?? error.message}\n`);
			resolve(1);
		});
	});
}
