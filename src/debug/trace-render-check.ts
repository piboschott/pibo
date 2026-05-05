#!/usr/bin/env node
/**
 * Trace Render Consistency Check
 *
 * Loads frontend snapshots, calls the backend replay API, applies the
 * frontend transformations, and compares the visible row ids.
 *
 * Usage:
 *   npx tsx src/debug/trace-render-check.ts --snapshots snapshots.json --api http://localhost:3000/api/chat/debug/trace-at-sequence
 */

import { readFileSync } from "node:fs";
import type { PiboSessionTraceView } from "../shared/trace-types.js";
import { adaptTrace } from "../apps/chat-ui/src/tracing/adapt.js";
import { processSpanTree } from "../apps/chat-ui/src/tracing/traceTree.js";
import type { Span, Trace } from "../apps/chat-ui/src/types.js";

type SpanExpansionDepth = number | "all";

type TraceSnapshot = {
	timestamp: number;
	piboSessionId: string;
	trigger: string;
	layers: Array<
		| { kind: "backendNodes"; ids: string[]; digest: string }
		| { kind: "visibleRows"; ids: string[]; digest: string }
	>;
	traceVersion?: string;
	latestStreamId?: number;
};

type CheckOptions = {
	snapshotsPath: string;
	apiBaseUrl: string;
	piboSessionId?: string;
};

function parseArgs(): CheckOptions {
	const args = process.argv.slice(2);
	let snapshotsPath = "trace-snapshots.json";
	let apiBaseUrl = "http://localhost:3000/api/chat/debug/trace-at-sequence";
	let piboSessionId: string | undefined;
	for (let i = 0; i < args.length; i++) {
		if (args[i] === "--snapshots" && args[i + 1]) snapshotsPath = args[i + 1];
		if (args[i] === "--api" && args[i + 1]) apiBaseUrl = args[i + 1];
		if (args[i] === "--session" && args[i + 1]) piboSessionId = args[i + 1];
	}
	return { snapshotsPath, apiBaseUrl, piboSessionId };
}

function loadSnapshots(path: string): Record<string, TraceSnapshot[]> {
	const raw = readFileSync(path, "utf8");
	const parsed = JSON.parse(raw) as Record<string, unknown>;
	if (typeof parsed.piboSessionId === "string" && Array.isArray(parsed.snapshots)) {
		return { [parsed.piboSessionId]: parsed.snapshots as TraceSnapshot[] };
	}
	return parsed as Record<string, TraceSnapshot[]>;
}

async function replayTraceAtSequence(
	apiBaseUrl: string,
	piboSessionId: string,
	eventSequence: number,
): Promise<PiboSessionTraceView> {
	const response = await fetch(apiBaseUrl, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ piboSessionId, eventSequence }),
	});
	if (!response.ok) {
		throw new Error(`Replay API error: ${response.status} ${await response.text()}`);
	}
	return response.json() as Promise<PiboSessionTraceView>;
}

function filterThinking(spans: Span[], showThinking: boolean): Span[] {
	if (showThinking) return spans;
	return spans.filter((span) => span.spanType !== "model.reasoning");
}

function isExpandedAtDepth(depth: number, expansionDepth: SpanExpansionDepth): boolean {
	if (expansionDepth === "all") return true;
	return depth < expansionDepth;
}

function flattenVisibleSpans(
	spans: readonly Span[],
	expansionDepth: SpanExpansionDepth,
	expandThinking: boolean,
	expansionOverrides: Record<string, { contentExpanded: boolean; childrenExpanded: boolean }>,
	depth = 0,
): Array<{ id: string; span: Span; depth: number }> {
	const rows: Array<{ id: string; span: Span; depth: number }> = [];
	for (const span of spans) {
		const defaultExpanded = isExpandedAtDepth(depth, expansionDepth);
		const override = expansionOverrides[span.id];
		const contentExpanded = override?.contentExpanded ?? (span.spanType === "model.reasoning" ? expandThinking : defaultExpanded);
		const childrenExpanded = override?.childrenExpanded ?? defaultExpanded;
		rows.push({ id: span.id, span, depth });
		if (span.children?.length && contentExpanded && childrenExpanded) {
			rows.push(...flattenVisibleSpans(span.children, expansionDepth, expandThinking, expansionOverrides, depth + 1));
		}
	}
	return rows;
}

function simulateFrontend(view: PiboSessionTraceView, expandThinking = true): string[] {
	const trace: Trace = adaptTrace(view.piboSessionId, view.title, view.nodes);
	const tree = processSpanTree(filterThinking(trace.spans, expandThinking));
	const rows = flattenVisibleSpans(tree, "all", expandThinking, {});
	return rows.map((r) => r.id);
}

function findFirstMismatch(actual: string[], expected: string[]): { index: number; actual: string; expected: string } | null {
	const len = Math.max(actual.length, expected.length);
	for (let i = 0; i < len; i++) {
		if (actual[i] !== expected[i]) {
			return { index: i, actual: actual[i] ?? "<missing>", expected: expected[i] ?? "<missing>" };
		}
	}
	return null;
}

async function checkSession(
	apiBaseUrl: string,
	piboSessionId: string,
	snapshots: TraceSnapshot[],
): Promise<{ checked: number; mismatches: number; errors: number }> {
	let checked = 0;
	let mismatches = 0;
	let errors = 0;

	for (const snapshot of snapshots) {
		const visibleLayer = snapshot.layers.find((l) => l.kind === "visibleRows") as { kind: "visibleRows"; ids: string[] } | undefined;
		if (!visibleLayer) continue;

		const backendLayer = snapshot.layers.find((l) => l.kind === "backendNodes") as { kind: "backendNodes"; ids: string[] } | undefined;
		const frontendIds = visibleLayer.ids;

		// Use the available snapshot size as a coarse replay point. This keeps
		// the checker useful even when a snapshot trigger has no explicit
		// event sequence.
		try {
			const lastEventSequence = backendLayer ? backendLayer.ids.length : frontendIds.length;
			const replayed = await replayTraceAtSequence(apiBaseUrl, piboSessionId, lastEventSequence);
			const simulatedIds = simulateFrontend(replayed);

			const mismatch = findFirstMismatch(frontendIds, simulatedIds);
			if (mismatch) {
				mismatches++;
				console.error(`\n[MISMATCH] ${piboSessionId} @ ${new Date(snapshot.timestamp).toISOString()}`);
				console.error(`  Trigger: ${snapshot.trigger}`);
				console.error(`  First diff at index ${mismatch.index}:`);
				console.error(`    Frontend: ${mismatch.actual}`);
				console.error(`    Backend+Sim: ${mismatch.expected}`);
			} else {
				checked++;
			}
		} catch (caught) {
			errors++;
			console.error(`\n[ERROR] ${piboSessionId} @ ${new Date(snapshot.timestamp).toISOString()}: ${caught}`);
		}
	}

	return { checked, mismatches, errors };
}

async function main(): Promise<void> {
	const options = parseArgs();
	const allSnapshots = loadSnapshots(options.snapshotsPath);
	const sessions = options.piboSessionId ? { [options.piboSessionId]: allSnapshots[options.piboSessionId] ?? [] } : allSnapshots;

	console.log(`Trace Render Consistency Check`);
	console.log(`Snapshots: ${options.snapshotsPath}`);
	console.log(`API: ${options.apiBaseUrl}`);
	console.log(`Sessions: ${Object.keys(sessions).length}\n`);

	let totalChecked = 0;
	let totalMismatches = 0;
	let totalErrors = 0;

	for (const [piboSessionId, snapshots] of Object.entries(sessions)) {
		if (!snapshots.length) continue;
		console.log(`Checking session ${piboSessionId} (${snapshots.length} snapshots)...`);
		const result = await checkSession(options.apiBaseUrl, piboSessionId, snapshots);
		totalChecked += result.checked;
		totalMismatches += result.mismatches;
		totalErrors += result.errors;
		console.log(`  OK: ${result.checked}, Mismatch: ${result.mismatches}, Error: ${result.errors}`);
	}

	console.log(`\nTotal: ${totalChecked} OK, ${totalMismatches} mismatches, ${totalErrors} errors`);
	process.exit(totalMismatches > 0 || totalErrors > 0 ? 1 : 0);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
