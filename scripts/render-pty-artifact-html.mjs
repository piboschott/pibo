#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";

const options = parseArgs(process.argv.slice(2));
if (!options.artifactDir) {
	console.error("Usage: node scripts/render-pty-artifact-html.mjs --artifact-dir <dir> [--out <file>]");
	process.exit(2);
}

const artifactDir = resolve(options.artifactDir);
const screenPath = resolve(artifactDir, "screen.txt");
const cleanPath = resolve(artifactDir, "clean.txt");
const rawPath = resolve(artifactDir, "raw.ansi.log");
const metadataPath = resolve(artifactDir, "metadata.json");
const sourcePath = existsSync(screenPath) ? screenPath : cleanPath;
if (!existsSync(sourcePath)) {
	console.error(`No screen.txt or clean.txt found in ${artifactDir}`);
	process.exit(1);
}

const outPath = resolve(options.out ?? resolve(artifactDir, "visual.html"));
mkdirSync(dirname(outPath), { recursive: true });
const sourceText = readFileSync(sourcePath, "utf8").replace(/\s+$/u, "");
const metadata = existsSync(metadataPath) ? readFileSync(metadataPath, "utf8") : "{}";
const rawAvailable = existsSync(rawPath);
const generatedAt = new Date().toISOString();
writeFileSync(outPath, renderHtml({ artifactDir, sourcePath, sourceText, metadata, rawAvailable, generatedAt }));
console.log(outPath);

function renderHtml({ artifactDir, sourcePath, sourceText, metadata, rawAvailable, generatedAt }) {
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>PTY visual artifact — ${escapeHtml(basename(artifactDir))}</title>
<style>
:root { color-scheme: dark; }
body { margin: 0; background: #050505; color: #d4d4d4; font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; }
main { padding: 16px; }
header { margin-bottom: 12px; color: #737373; }
h1 { margin: 0 0 4px; color: #d4d4d4; font-size: 14px; font-weight: 600; }
.terminal { overflow: auto; max-width: 100%; border: 1px solid #2a2a2a; background: #0b0b0b; box-shadow: 0 0 0 1px #111 inset; }
pre { margin: 0; padding: 12px; white-space: pre-wrap; word-break: break-word; tab-size: 2; }
.meta { margin-top: 12px; border: 1px solid #2a2a2a; background: #111; color: #737373; }
.meta pre { max-height: 220px; overflow: auto; }
a { color: #38bdf8; }
</style>
</head>
<body>
<main>
<header>
<h1>PTY visual artifact — ${escapeHtml(basename(artifactDir))}</h1>
<div>Generated ${escapeHtml(generatedAt)} from ${escapeHtml(sourcePath)}.</div>
<div>${rawAvailable ? "Raw ANSI is available as raw.ansi.log." : "Raw ANSI was not present; this view uses clean terminal text."}</div>
</header>
<section class="terminal" aria-label="Final terminal screen">
<pre>${escapeHtml(sourceText)}</pre>
</section>
<section class="meta" aria-label="PTY metadata">
<pre>${escapeHtml(metadata)}</pre>
</section>
</main>
</body>
</html>
`;
}

function escapeHtml(value) {
	return String(value)
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

function parseArgs(args) {
	const parsed = { artifactDir: undefined, out: undefined };
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === "--artifact-dir") parsed.artifactDir = requireValue(args, ++index, arg);
		else if (arg === "--out") parsed.out = requireValue(args, ++index, arg);
		else if (arg === "--help" || arg === "-h") {
			console.log("Usage: node scripts/render-pty-artifact-html.mjs --artifact-dir <dir> [--out <file>]\n\nWrites a terminal-styled HTML review artifact from screen.txt or clean.txt. Artifacts may contain transcript content; review before sharing.");
			process.exit(0);
		} else {
			throw new Error(`Unknown option ${arg}`);
		}
	}
	return parsed;
}

function requireValue(args, index, option) {
	const value = args[index];
	if (!value || value.startsWith("--")) throw new Error(`${option} requires a value`);
	return value;
}
