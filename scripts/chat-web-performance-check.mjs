#!/usr/bin/env node
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
	const arg = process.argv[i];
	if (!arg.startsWith("--")) continue;
	args.set(arg.slice(2), process.argv[i + 1]?.startsWith("--") ? "true" : process.argv[++i] ?? "true");
}

const targetUrl = args.get("url");
const cdpUrl = args.get("cdp-url");
const outPath = resolve(args.get("out") ?? `docs/reports/chat-web-performance-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
const maxLongTaskMs = Number(args.get("max-long-task-ms") ?? 500);

if (!targetUrl || !cdpUrl) {
	console.error("Usage: node scripts/chat-web-performance-check.mjs --cdp-url ws://127.0.0.1:PORT/devtools/page/ID --url http://127.0.0.1:PORT/apps/chat");
	process.exit(2);
}

let nextId = 1;
const pending = new Map();
const socket = new WebSocket(cdpUrl);

function send(method, params = {}) {
	const id = nextId++;
	socket.send(JSON.stringify({ id, method, params }));
	return new Promise((resolvePromise, reject) => {
		pending.set(id, { resolve: resolvePromise, reject });
		setTimeout(() => {
			if (!pending.has(id)) return;
			pending.delete(id);
			reject(new Error(`CDP timeout: ${method}`));
		}, 15_000);
	});
}

socket.addEventListener("message", (event) => {
	const message = JSON.parse(event.data.toString());
	if (!message.id) return;
	const waiter = pending.get(message.id);
	if (!waiter) return;
	pending.delete(message.id);
	if (message.error) waiter.reject(new Error(message.error.message));
	else waiter.resolve(message.result);
});

await new Promise((resolvePromise, reject) => {
	socket.addEventListener("open", resolvePromise, { once: true });
	socket.addEventListener("error", reject, { once: true });
});

await send("Page.enable");
await send("Runtime.enable");
await send("Page.navigate", { url: targetUrl });
await wait(2500);

await evaluate(`(() => {
	window.__piboPerf = { longTasks: [], startedAt: performance.now(), actions: [] };
	new PerformanceObserver((list) => {
		for (const entry of list.getEntries()) {
			window.__piboPerf.longTasks.push({ name: entry.name, startTime: entry.startTime, duration: entry.duration });
		}
	}).observe({ entryTypes: ["longtask"] });
})()`);

const actions = [
	"Show Archived Sessions",
	"Load more active sessions",
	"Load older trace history",
	"Show Raw Events",
	"Load older raw events",
];
for (const label of actions) {
	await clickButtonByLabel(label);
	await wait(800);
}

const result = await evaluate(`(() => {
	const perf = window.__piboPerf || { longTasks: [], actions: [] };
	const longTasks = perf.longTasks || [];
	return {
		url: location.href,
		checkedAt: new Date().toISOString(),
		longTaskCount: longTasks.length,
		longTasksOver50ms: longTasks.filter((task) => task.duration > 50).length,
		maxLongTaskMs: longTasks.reduce((max, task) => Math.max(max, task.duration), 0),
		longTasks,
	};
})()`);

await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, `${JSON.stringify(result, null, 2)}\n`);
console.log(`Wrote ${outPath}`);
console.log(`maxLongTaskMs=${result.maxLongTaskMs.toFixed(1)} longTaskCount=${result.longTaskCount}`);
socket.close();
if (result.maxLongTaskMs > maxLongTaskMs) process.exit(1);

async function clickButtonByLabel(label) {
	await evaluate(`(() => {
		const label = ${JSON.stringify(label)};
		const buttons = [...document.querySelectorAll("button")];
		const button = buttons.find((candidate) => (candidate.getAttribute("aria-label") || candidate.title || candidate.textContent || "").includes(label));
		if (!button || button.disabled) return false;
		button.click();
		return true;
	})()`);
}

async function evaluate(expression) {
	const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
	if (result.exceptionDetails) throw new Error(result.exceptionDetails.text ?? "Runtime.evaluate failed");
	return result.result?.value;
}

function wait(ms) {
	return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}
