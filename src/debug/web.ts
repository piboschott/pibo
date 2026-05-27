import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getPiboHome } from "../core/pibo-home.js";
import { listBrowserUseCdpTargets, selectBestChatTarget, formatBrowserUseTargets, type BrowserUseCdpTarget } from "../tools/browser-use-cdp.js";
import { CdpClient } from "../tools/cdp-client.js";
import { diffSnapshots, formatSnapshot, formatSnapshotDiff, formatWatch, inferWatchFlickers, type SnapshotNode, type WebSnapshot, type WatchEvent, type WebWatch } from "./web-render-analysis.js";
import type {
	NumberStats,
	StreamingBenchmark,
	StreamingBenchmarkAssertion,
	StreamingBenchmarkCadence,
	StreamingBenchmarkComparison,
	StreamingBenchmarkEventSourceProbe,
	StreamingBenchmarkEventSourceStreamProbe,
	StreamingBenchmarkGroup,
	StreamingBenchmarkLivePipeline,
	StreamingBenchmarkProviderPreservation,
	StreamingBenchmarkProviderTelemetry,
	StreamingBenchmarkSseProbe,
	StreamingBenchmarkSummary,
	StreamingBenchmarkTraceProbe,
	StreamingBenchmarkUrlComparison,
	StreamingDebugCounters,
	StreamingNegativeProfile,
	StreamingSmoothnessScore,
} from "./web-streaming-types.js";
export type {
	NumberStats,
	StreamingBenchmark,
	StreamingBenchmarkAssertion,
	StreamingBenchmarkCadence,
	StreamingBenchmarkComparison,
	StreamingBenchmarkEventSourceProbe,
	StreamingBenchmarkEventSourceStreamProbe,
	StreamingBenchmarkGroup,
	StreamingBenchmarkLivePipeline,
	StreamingBenchmarkProviderPreservation,
	StreamingBenchmarkProviderTelemetry,
	StreamingBenchmarkSseProbe,
	StreamingBenchmarkSummary,
	StreamingBenchmarkTraceProbe,
	StreamingBenchmarkUrlComparison,
	StreamingDebugCounters,
	StreamingNegativeProfile,
	StreamingSmoothnessScore,
} from "./web-streaming-types.js";
import {
	formatStreamingBenchmarkAssertionError,
	formatStreamingBenchmarkCompactReport,
	formatStreamingBenchmarkResult,
	streamingBenchmarkReportRows,
	summarizeStreamingSelectedLiveEventSource,
} from "./web-streaming-report.js";
import {
	collectStreamingProviderTelemetry,
	collectStreamingProviderTelemetryFromSelectedBrowserSession,
	collectStreamingProviderTelemetryFromSession,
	collectStreamingProviderTelemetryFromTurn,
} from "./web-streaming-provider-telemetry.js";
import { buildStreamingBenchmarkExpression, streamingBenchmarkEventSourceProbeScript, streamingBenchmarkFixtureHtml, type StreamingFixtureMix, type StreamingFixtureProfile } from "./web-streaming-browser-scripts.js";
export { formatStreamingBenchmarkAssertionSummary, formatStreamingBenchmarkUrlComparison, summarizeStreamingSelectedLiveEventSource } from "./web-streaming-report.js";
export { collectStreamingProviderTelemetryFromSelectedBrowserSession, collectStreamingProviderTelemetryFromSession, collectStreamingProviderTelemetryFromTurn, summarizeStreamingProviderTelemetry } from "./web-streaming-provider-telemetry.js";
export { formatWatch, inferWatchFlickers } from "./web-render-analysis.js";

const DEFAULT_WATCH_DURATION_MS = 5_000;
const MAX_WATCH_DURATION_MS = 30_000;
const DEFAULT_NODE_LIMIT = 250;
const DEFAULT_DEPTH_LIMIT = 8;
const DEFAULT_EVENT_LIMIT = 500;
const DEFAULT_TEXT_LIMIT = 80;
const STDOUT_BUDGET = 12_000;
const BATCH_NEGATIVE_EXPECTED_REGRESSIONS = ["positive DOM updates", "DOM max jump", "SSE text events per chunk", "live pipeline flush/enqueue", "live pipeline overlay updates/flushed"] as const;
const OVERLAY_DROP_NEGATIVE_EXPECTED_REGRESSIONS = ["positive DOM updates", "live pipeline flushed events/overlay expected", "live pipeline overlay events/input expected", "live pipeline current text/expected", "live pipeline flush/enqueue", "live pipeline overlay updates/flushed"] as const;
const LIVE_PIPELINE_MIN_PRESERVATION_RATIO = 0.95;
const LIVE_PIPELINE_MIN_FLUSH_RATIO = 0.75;
const URL_COMPARISON_MAX_SMOOTHNESS_DROP = 15;
const URL_COMPARISON_MAX_DOM_LAG_DELTA_MS = 150;
const URL_COMPARISON_MAX_SSE_LAG_DELTA_MS = 100;
const URL_COMPARISON_MAX_SSE_CHUNK_GAP_DELTA_MS = 100;
const URL_COMPARISON_MAX_FIRST_TRANSPORT_LATENCY_DELTA_MS = 250;
const URL_COMPARISON_MAX_FIRST_LIVE_LATENCY_DELTA_MS = 250;
const URL_COMPARISON_MAX_FIRST_VISIBLE_LATENCY_DELTA_MS = 300;
const PROVIDER_MIN_TEXT_PRESERVATION_RATIO = 0.95;
const PROVIDER_MIN_REASONING_PRESERVATION_RATIO = 0.95;

type WebOptions = {
	positionals: string[];
	cdpUrl?: string;
	target?: string;
	scope?: string;
	preset?: string;
	duration?: string;
	runs?: string;
	fixtureProfile?: string;
	fixtureMix?: string;
	fixturePreludeMessages?: string;
	negativeProfile?: string;
	compareUrl?: string;
	providerRequestId?: string;
	providerSessionId?: string;
	providerTurnId?: string;
	providerSelectedSession: boolean;
	compareHosted: boolean;
	compareHostedIfConfigured: boolean;
	json: boolean;
	artifact: boolean;
	fixture: boolean;
	backendFixture: boolean;
	simulateReconnect: boolean;
	simulateTraceCatchup: boolean;
	simulateOverlayDrop: boolean;
	assertHealthy: boolean;
	expectedRegressionPatterns: string[];
	from?: string;
	act: boolean;
	manual: boolean;
	includeText: boolean;
	includeLayout: boolean;
	compact: boolean;
	output?: string;
	jsonOutput?: string;
};

export async function runDebugWeb(args: string[]): Promise<void> {
	if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
		printWebDiscovery();
		return;
	}

	const command = args[0];
	const options = parseOptions(args.slice(1));
	if (command === "targets") {
		await runTargets(options);
		return;
	}
	if (command === "attach-chat") {
		await runAttachChat(options);
		return;
	}
	if (command === "snapshot") {
		await runSnapshot(options);
		return;
	}
	if (command === "diff") {
		await runDiff(options);
		return;
	}
	if (command === "watch") {
		await runWatch(options);
		return;
	}
	if (command === "scenario") {
		await runScenario(options);
		return;
	}
	if (command === "report") {
		await runReport(options);
		return;
	}
	throw new Error(`Unknown pibo debug web command "${command}". Run pibo debug web --help.`);
}

function printWebDiscovery(): void {
	console.log(`pibo debug web - inspect browser render state via CDP

Commands:
  targets      List Chrome CDP targets with Chat auth hints
  attach-chat  Show the best authenticated Chat Web target
  snapshot     Capture a scoped compact DOM snapshot
  diff         Compare current scoped snapshot against previous or artifact
  watch        Record a bounded scoped DOM/focus/route timeline
  scenario     Run guided Chat Web debug workflows
  report       Render saved debug artifacts as reviewer-friendly Markdown

Next:
  pibo debug web targets
  pibo debug web snapshot --preset session-list
  pibo debug web watch --preset chat-shell --duration 5000
  pibo debug web report streaming-benchmark --from artifact.json
`);
}

function printSnapshotHelp(): void {
	console.log(`pibo debug web snapshot - capture a scoped compact DOM snapshot

Usage:
  pibo debug web snapshot --scope <selector> [--target id|ws] [--json] [--artifact]
  pibo debug web snapshot --preset session-list

Presets:
  app | route-shell | sidebar | session-list | chat-shell | composer

Next:
  pibo debug web diff --preset session-list
  pibo debug web watch --preset chat-shell --duration 5000
`);
}

function printWatchHelp(): void {
	console.log(`pibo debug web watch - record compact render-state changes

Usage:
  pibo debug web watch --scope <selector> [--duration ms] [--target id|ws] [--json] [--artifact]
  pibo debug web watch --preset chat-shell --duration 5000

Defaults:
  duration=5000ms, max=30000ms, event budget=500

Next:
  pibo debug web diff --preset chat-shell
  pibo debug web scenario new-session --manual
`);
}

function printScenarioHelp(): void {
	console.log(`pibo debug web scenario - guided Chat Web debug workflows

Usage:
  pibo debug web scenario new-session [--manual|--act] [--duration ms] [--json] [--artifact]
  pibo debug web scenario streaming-benchmark [--fixture|--backend-fixture] [--fixture-profile steady|jitter|burst|batch] [--fixture-mix text|reasoning-text|markdown|gfm-markdown|gfm-task-markdown|gfm-full-markdown] [--fixture-prelude-messages n] [--simulate-reconnect|--simulate-trace-catchup] [--duration ms] [--runs n] [--from artifact.json] [--provider-request-id pr_...|--provider-session-id ps_...|--provider-turn-id turn_...|--provider-selected-session] [--compare-url url|--compare-hosted|--compare-hosted-if-configured] [--assert] [--expect-regression text] [--negative-profile batch|overlay-drop] [--json] [--artifact]

Defaults:
  new-session --manual waits while you click New Session yourself.
  new-session --act clicks the discovered New Session button after the watcher starts.
  streaming-benchmark enables debugStreaming for future events, observes assistant DOM increments, and snapshots window.__piboStreamingDebug.
  streaming-benchmark --fixture navigates the target to a deterministic in-browser stream fixture before measuring.
  streaming-benchmark --backend-fixture posts to /api/chat/debug/streaming-fixture and records EventSource metrics while the real app consumes deterministic /api/chat/events frames.
  streaming-benchmark --fixture-profile selects steady cadence, deterministic jitter, bursty timing, or intentional batch stress.
  streaming-benchmark --fixture-mix includes text-only, mixed reasoning/text, CommonMark Markdown, simple GFM Markdown, or full-parser GFM Markdown assistant deltas.
  streaming-benchmark --fixture-prelude-messages seeds completed live assistant messages before counters reset so large live overlays can be measured without changing fixture preservation denominators.
  streaming-benchmark --simulate-reconnect reloads the app with an EventSource probe, forces one live stream close, and verifies reconnect/transient ids.
  streaming-benchmark --simulate-trace-catchup suppresses backend live text deltas and verifies trace snapshot recovery.
  streaming-benchmark --runs repeats the same scenario and reports medians; --from compares against a prior benchmark artifact.
  streaming-benchmark --compare-url runs the same backend fixture at another Chat URL, for direct-vs-hosted SSE comparison.
  streaming-benchmark --compare-hosted uses PIBO_DEV_PUBLIC_URL or PIBO_DEV_BASE_URL from the environment or .env.developer-host as the compare URL.
  streaming-benchmark --compare-hosted-if-configured runs the hosted comparison when a dev URL is configured; otherwise it records a warning and keeps the primary benchmark.
  streaming-benchmark --provider-request-id attaches provider/Pi telemetry delta counts, byte stats, gap stats, parse errors, first-text latency, and provider-to-transport preservation ratios from pibo debug telemetry.
  streaming-benchmark --provider-session-id, --provider-turn-id, or --provider-selected-session discovers the latest provider request from telemetry session/turn metadata after the benchmark window before attaching provider metrics.
  streaming-benchmark --assert exits non-zero when fixture/debug/DOM/provider preservation gates fail.
  streaming-benchmark --expect-regression marks a required regression substring for controlled negative benchmarks; unexpected or missing expected regressions still fail with --assert.
  streaming-benchmark --negative-profile batch expands to the backend batch reasoning/text fixture with required controlled regression assertions.
  streaming-benchmark --negative-profile overlay-drop preserves SSE/EventSource input but drops live-overlay text/reasoning enqueue for a controlled pipeline-preservation failure.
`);
}

function printReportHelp(): void {
	console.log(`pibo debug web report - render saved debug artifacts

Usage:
  pibo debug web report streaming-benchmark --from artifact.json [--compact] [--output report.md] [--json-output report.json] [--json] [--artifact]

Reports:
  streaming-benchmark  Summarize saved pibo debug web scenario streaming-benchmark JSON as Markdown.
  --compact            Render reviewer-friendly Markdown tables instead of the detailed line report.
  --output             Write the Markdown report to a specific file path.
  --json-output        Write the normalized JSON report payload and compact rows to a specific file path.

Next:
  pibo debug web scenario streaming-benchmark --backend-fixture --assert --artifact
`);
}

async function runTargets(options: WebOptions): Promise<void> {
	const targets = await listBrowserUseCdpTargets({ cdpUrl: options.cdpUrl, probe: true });
	if (options.json) {
		console.log(JSON.stringify({ targets }, null, 2));
		return;
	}
	console.log(formatBrowserUseTargets(targets));
	if (targets.length === 0) {
		console.log("\nNext: eval \"$(pibo tools env browser-use)\" or pass --cdp-url http://127.0.0.1:<port>");
	}
}

async function runAttachChat(options: WebOptions): Promise<void> {
	const targets = await listBrowserUseCdpTargets({ cdpUrl: options.cdpUrl, probe: true });
	const target = resolveTargetFromList(targets, options.target) ?? selectBestChatTarget(targets);
	if (!target) {
		throw new Error("No authenticated Chat Web target with a composer textarea was found. Next: pibo tools browser-use targets or acquire a Browser Use lease.");
	}
	if (options.json) {
		console.log(JSON.stringify({ target }, null, 2));
		return;
	}
	console.log(`target\t${target.id}`);
	console.log(`url\t${target.url}`);
	console.log(`auth\t${target.auth}`);
	console.log(`composer\t${target.composer ? "yes" : "no"}`);
	console.log(`ws\t${target.webSocketDebuggerUrl ?? ""}`);
	console.log("\nNext:");
	console.log(`  pibo debug web snapshot --target ${shellQuote(target.id)} --preset session-list`);
	console.log(`  pibo debug web watch --target ${shellQuote(target.id)} --preset chat-shell --duration 5000`);
}

async function runSnapshot(options: WebOptions): Promise<void> {
	if (options.positionals[0] === "--help" || options.positionals[0] === "-h") {
		printSnapshotHelp();
		return;
	}
	const scope = resolveScope(options);
	const { client, target } = await connectTarget(options);
	try {
		const snapshot = await captureSnapshot(client, scope, options);
		if (options.json) {
			console.log(JSON.stringify({ target: compactTarget(target), snapshot }, null, 2));
		} else {
			console.log(limitStdout(formatSnapshot(snapshot, target)));
		}
		await writeLastSnapshot(snapshot);
		if (options.artifact) {
			const artifact = await writeArtifact("snapshot", snapshot);
			if (!options.json) console.log(`Artifact: ${artifact}`);
		}
	} finally {
		client.close();
	}
}

async function runDiff(options: WebOptions): Promise<void> {
	if (options.positionals[0] === "--help" || options.positionals[0] === "-h") {
		console.log(`pibo debug web diff - compare scoped render snapshots

Usage:
  pibo debug web diff --scope <selector> [--from artifact.json]
  pibo debug web diff --preset session-list

Default --from is the last snapshot captured by pibo debug web snapshot.
`);
		return;
	}
	const scope = resolveScope(options);
	const baseline = await readBaselineSnapshot(options.from);
	const { client, target } = await connectTarget(options);
	try {
		const current = await captureSnapshot(client, scope, options);
		if (baseline.scope !== current.scope) {
			if (options.json) console.log(JSON.stringify({ target: compactTarget(target), baseline, current, error: "scope_mismatch" }, null, 2));
			else console.log(`Scope mismatch: baseline=${baseline.scope} current=${current.scope}\nTake a new baseline with: pibo debug web snapshot --scope ${shellQuote(current.scope)}`);
			await writeLastSnapshot(current);
			return;
		}
		const diff = diffSnapshots(baseline, current);
		if (options.json) console.log(JSON.stringify({ target: compactTarget(target), baseline, current, diff }, null, 2));
		else console.log(limitStdout(formatSnapshotDiff(diff, baseline, current, target)));
		await writeLastSnapshot(current);
		if (options.artifact) {
			const artifact = await writeArtifact("diff", { baseline, current, diff });
			if (!options.json) console.log(`Artifact: ${artifact}`);
		}
	} finally {
		client.close();
	}
}

async function runWatch(options: WebOptions): Promise<void> {
	if (options.positionals[0] === "--help" || options.positionals[0] === "-h") {
		printWatchHelp();
		return;
	}
	if (options.act || options.manual) {
		throw new Error("Action flags are only supported by scenarios. Next: pibo debug web scenario new-session --act");
	}
	if (options.positionals.length) {
		throw new Error(`Unexpected pibo debug web watch argument "${options.positionals[0]}". Run pibo debug web watch --help.`);
	}
	const scope = resolveScope(options);
	const durationMs = parseDuration(options.duration);
	const { client, target } = await connectTarget(options);
	try {
		const watch = await runBrowserWatch(client, scope, durationMs, options);
		if (options.json) console.log(JSON.stringify({ target: compactTarget(target), watch }, null, 2));
		else console.log(limitStdout(formatWatch(watch, target)));
		await writeLastSnapshot(watch.after ?? watch.before);
		const artifact = await writeArtifact("watch", watch);
		if (options.artifact && !options.json) console.log(`Artifact: ${artifact}`);
	} finally {
		client.close();
	}
}

async function runScenario(options: WebOptions): Promise<void> {
	const scenario = options.positionals[0];
	if (!scenario || scenario === "--help" || scenario === "-h") {
		printScenarioHelp();
		return;
	}
	if (options.positionals.length > 1) {
		throw new Error(`Unexpected pibo debug web scenario argument "${options.positionals[1]}". Run pibo debug web scenario --help.`);
	}
	if (options.act && options.manual) throw new Error("Use either --manual or --act, not both.");
	if (scenario !== "new-session" && scenario !== "streaming-benchmark") throw new Error(`Unknown pibo debug web scenario "${scenario}". Run pibo debug web scenario --help.`);
	if (scenario === "streaming-benchmark" && (options.act || options.manual)) throw new Error("streaming-benchmark does not support --act or --manual. Start or observe the stream separately, then run the scenario.");
	const negativeProfile = scenario === "streaming-benchmark" ? parseNegativeProfile(options.negativeProfile) : undefined;
	const streamingOptions = negativeProfile ? applyNegativeStreamingProfile(options, negativeProfile) : options;
	if (scenario === "streaming-benchmark" && streamingOptions.fixture && streamingOptions.backendFixture) throw new Error("Use either --fixture or --backend-fixture, not both.");
	if (scenario === "streaming-benchmark" && streamingOptions.fixtureProfile && !streamingOptions.fixture && !streamingOptions.backendFixture) throw new Error("--fixture-profile requires --fixture or --backend-fixture.");
	if (scenario === "streaming-benchmark" && streamingOptions.fixtureMix && !streamingOptions.fixture && !streamingOptions.backendFixture) throw new Error("--fixture-mix requires --fixture or --backend-fixture.");
	if (scenario === "streaming-benchmark" && streamingOptions.fixturePreludeMessages && !streamingOptions.backendFixture) throw new Error("--fixture-prelude-messages requires --backend-fixture.");
	if (scenario === "streaming-benchmark" && streamingOptions.simulateReconnect && !streamingOptions.backendFixture) throw new Error("--simulate-reconnect requires --backend-fixture.");
	if (scenario === "streaming-benchmark" && streamingOptions.simulateTraceCatchup && !streamingOptions.backendFixture) throw new Error("--simulate-trace-catchup requires --backend-fixture.");
	if (scenario === "streaming-benchmark" && streamingOptions.simulateOverlayDrop && !streamingOptions.backendFixture) throw new Error("overlay-drop simulation requires --backend-fixture.");
	if (scenario === "streaming-benchmark" && streamingOptions.simulateReconnect && streamingOptions.simulateTraceCatchup) throw new Error("Use either --simulate-reconnect or --simulate-trace-catchup, not both.");
	if (scenario === "streaming-benchmark" && [streamingOptions.simulateReconnect, streamingOptions.simulateTraceCatchup, streamingOptions.simulateOverlayDrop].filter(Boolean).length > 1) throw new Error("Use only one streaming simulation mode.");
	const providerTelemetryModes = [streamingOptions.providerRequestId ? "--provider-request-id" : undefined, streamingOptions.providerSessionId ? "--provider-session-id" : undefined, streamingOptions.providerTurnId ? "--provider-turn-id" : undefined, streamingOptions.providerSelectedSession ? "--provider-selected-session" : undefined].filter(Boolean);
	if (scenario === "streaming-benchmark" && providerTelemetryModes.length > 1) throw new Error(`Use only one provider telemetry source flag: ${providerTelemetryModes.join(", ")}.`);
	const hostedCompareModes = [streamingOptions.compareUrl ? "--compare-url" : undefined, streamingOptions.compareHosted ? "--compare-hosted" : undefined, streamingOptions.compareHostedIfConfigured ? "--compare-hosted-if-configured" : undefined].filter(Boolean);
	if (scenario === "streaming-benchmark" && hostedCompareModes.length > 1) throw new Error(`Use only one compare target flag: ${hostedCompareModes.join(", ")}.`);
	if (scenario === "streaming-benchmark" && streamingOptions.compareUrl && !streamingOptions.backendFixture) throw new Error("--compare-url requires --backend-fixture so the benchmark can replay a deterministic stream at both URLs.");
	if (scenario === "streaming-benchmark" && streamingOptions.compareHosted && !streamingOptions.backendFixture) throw new Error("--compare-hosted requires --backend-fixture so the benchmark can replay a deterministic stream at both URLs.");
	if (scenario === "streaming-benchmark" && streamingOptions.compareHostedIfConfigured && !streamingOptions.backendFixture) throw new Error("--compare-hosted-if-configured requires --backend-fixture so the benchmark can replay a deterministic stream at both URLs.");
	const hostedCompareUrl = scenario === "streaming-benchmark" && (streamingOptions.compareHosted || streamingOptions.compareHostedIfConfigured) ? await resolveStreamingBenchmarkHostedCompareUrl({ optional: streamingOptions.compareHostedIfConfigured }) : undefined;
	const hostedCompareWarning = scenario === "streaming-benchmark" && streamingOptions.compareHostedIfConfigured && !hostedCompareUrl ? "--compare-hosted-if-configured skipped: PIBO_DEV_PUBLIC_URL or PIBO_DEV_BASE_URL is not configured" : undefined;
	const fixtureProfile = parseFixtureProfile(streamingOptions.fixtureProfile);
	const fixtureMix = parseFixtureMix(streamingOptions.fixtureMix);
	const fixturePreludeMessages = parseFixturePreludeMessages(streamingOptions.fixturePreludeMessages);
	const durationMs = parseDuration(streamingOptions.duration);
	const runs = parseRuns(streamingOptions.runs);
	const { client, target } = await connectTarget({ ...options, preset: "app" });
	try {
		if (scenario === "streaming-benchmark") {
			const baseline = streamingOptions.from ? await readStreamingBenchmarkRuns(streamingOptions.from) : undefined;
			const providerTelemetryRequested = providerTelemetryModes.length > 0;
			const runOptions = { startFixture: streamingOptions.fixture, startBackendFixture: streamingOptions.backendFixture, fixtureProfile, fixtureMix, fixturePreludeMessages, simulateReconnect: streamingOptions.simulateReconnect, simulateTraceCatchup: streamingOptions.simulateTraceCatchup, simulateOverlayDrop: streamingOptions.simulateOverlayDrop, negativeProfile };
			const primaryUrl = await currentBrowserUrl(client);
			const rawBenchmarks = await runStreamingBenchmarkSeries(client, runs, durationMs, runOptions);
			const primaryProviderTelemetry = providerTelemetryRequested ? await collectStreamingProviderTelemetryForOptions(streamingOptions, client) : undefined;
			const benchmarks = attachStreamingProviderTelemetryToBenchmarks(rawBenchmarks, primaryProviderTelemetry);
			let benchmark: StreamingBenchmark | StreamingBenchmarkGroup | StreamingBenchmarkUrlComparison = runs === 1
				? benchmarks[0]
				: summarizeStreamingBenchmarkGroup(benchmarks, baseline);
			const rawCompareUrl = streamingOptions.compareUrl ?? hostedCompareUrl;
			if (!rawCompareUrl && hostedCompareWarning) benchmark.warnings.push(hostedCompareWarning);
			if (rawCompareUrl) {
				const compareUrl = resolveStreamingBenchmarkCompareUrl(rawCompareUrl, primaryUrl);
				await navigateStreamingBenchmarkTarget(client, compareUrl);
				const rawCompareRuns = await runStreamingBenchmarkSeries(client, runs, durationMs, runOptions);
				const compareProviderTelemetry = providerTelemetryRequested ? await collectStreamingProviderTelemetryForOptions(streamingOptions, client) : undefined;
				const compareRuns = attachStreamingProviderTelemetryToBenchmarks(rawCompareRuns, compareProviderTelemetry);
				const primaryGroup = summarizeStreamingBenchmarkGroup(benchmarks, baseline);
				const compareGroup = summarizeStreamingBenchmarkGroup(compareRuns, benchmarks);
				benchmark = summarizeStreamingBenchmarkUrlComparison(primaryUrl, compareUrl, primaryGroup, compareGroup);
			}
			const assertion = applyExpectedStreamingRegressions(benchmark, streamingOptions.expectedRegressionPatterns);
			if (streamingOptions.json) console.log(JSON.stringify({ target: compactTarget(target), scenario, benchmark }, null, 2));
			else console.log(limitStdout(formatStreamingBenchmarkResult(benchmark, target)));
			const artifact = await writeArtifact(`scenario-${scenario}`, benchmark);
			if (!streamingOptions.json) console.log(`Artifact: ${artifact}`);
			if (streamingOptions.assertHealthy && !assertion.passed) throw new Error(formatStreamingBenchmarkAssertionError(assertion));
			return;
		}

		const watch = await runBrowserWatch(client, presetScope("app"), durationMs, {
			...options,
			act: options.act,
			manual: !options.act,
		}, options.act ? "new-session" : undefined);
		if (options.json) console.log(JSON.stringify({ target: compactTarget(target), scenario, watch }, null, 2));
		else console.log(limitStdout(formatWatch(watch, target, `scenario ${scenario}`)));
		const artifact = await writeArtifact(`scenario-${scenario}`, watch);
		if (!options.json) console.log(`Artifact: ${artifact}`);
	} finally {
		client.close();
	}
}

async function runReport(options: WebOptions): Promise<void> {
	const report = options.positionals[0];
	if (!report || report === "--help" || report === "-h") {
		printReportHelp();
		return;
	}
	if (options.positionals.length > 1) {
		throw new Error(`Unexpected pibo debug web report argument "${options.positionals[1]}". Run pibo debug web report --help.`);
	}
	if (report !== "streaming-benchmark") {
		throw new Error(`Unknown pibo debug web report "${report}". Run pibo debug web report --help.`);
	}
	if (!options.from) throw new Error("pibo debug web report streaming-benchmark requires --from artifact.json");
	const benchmark = await readStreamingBenchmarkArtifact(options.from);
	const target = streamingBenchmarkReportTarget(benchmark);
	const markdown = options.compact ? formatStreamingBenchmarkCompactReport(benchmark, target) : formatStreamingBenchmarkResult(benchmark, target);
	const format = options.compact ? "compact" : "detailed";
	const output = options.output ? await writeReportOutput(options.output, markdown) : undefined;
	const artifact = options.artifact ? await writeTextArtifact(options.compact ? "report-streaming-benchmark-compact" : "report-streaming-benchmark", "md", markdown) : undefined;
	const jsonOutput = options.jsonOutput ? path.resolve(options.jsonOutput) : undefined;
	const rows = streamingBenchmarkReportRows(benchmark, options.compact);
	const jsonPayload = { report, source: options.from, format, target, output, artifact, jsonOutput, markdown, rows, benchmark };
	if (options.jsonOutput) await writeReportOutput(options.jsonOutput, JSON.stringify(jsonPayload, null, 2));
	if (options.json) console.log(JSON.stringify(jsonPayload, null, 2));
	else {
		if (output) console.log(`Wrote report: ${output}`);
		else console.log(markdown);
		if (artifact) console.log(`Artifact: ${artifact}`);
		if (jsonOutput) console.log(`Wrote report JSON: ${jsonOutput}`);
	}
}

async function connectTarget(options: WebOptions): Promise<{ client: CdpClient; target: BrowserUseCdpTarget | { id: string; url: string; title: string; webSocketDebuggerUrl: string } }> {
	const envWs = process.env.PIBO_CDP_TARGET_WS;
	if (isWebSocketUrl(options.target)) {
		const client = new CdpClient(options.target!);
		await client.connect();
		return { client, target: { id: "direct", url: "", title: "direct", webSocketDebuggerUrl: options.target! } };
	}
	if (!options.target && envWs) {
		const client = new CdpClient(envWs);
		await client.connect();
		return { client, target: { id: process.env.PIBO_CDP_TARGET_ID ?? "env", url: process.env.PIBO_CHAT_URL ?? "", title: "env", webSocketDebuggerUrl: envWs } };
	}

	const cdpUrl = options.cdpUrl ?? process.env.PIBO_CDP_URL;
	const targets = await listBrowserUseCdpTargets({ cdpUrl, probe: !options.target });
	const target = resolveTargetFromList(targets, options.target) ?? selectBestChatTarget(targets) ?? targets.find((item) => item.webSocketDebuggerUrl);
	if (!target?.webSocketDebuggerUrl) {
		throw new Error("No attachable CDP target found. Next: pibo debug web targets or pass --cdp-url/--target.");
	}
	const client = new CdpClient(target.webSocketDebuggerUrl);
	await client.connect();
	return { client, target };
}

function resolveTargetFromList(targets: readonly BrowserUseCdpTarget[], target?: string): BrowserUseCdpTarget | undefined {
	if (!target) return undefined;
	return targets.find((item) => item.id === target || item.url === target || item.title === target || item.webSocketDebuggerUrl === target);
}

async function captureSnapshot(client: CdpClient, scope: string, options: WebOptions): Promise<WebSnapshot> {
	const expression = buildSnapshotExpression({
		scope,
		maxNodes: DEFAULT_NODE_LIMIT,
		maxDepth: DEFAULT_DEPTH_LIMIT,
		textLimit: DEFAULT_TEXT_LIMIT,
		includeText: options.includeText,
		includeLayout: options.includeLayout,
	});
	return client.evaluate<WebSnapshot>(expression, 10_000);
}

async function runBrowserWatch(client: CdpClient, scope: string, durationMs: number, options: WebOptions, action?: "new-session"): Promise<WebWatch> {
	const expression = buildWatchExpression({
		scope,
		durationMs,
		maxNodes: DEFAULT_NODE_LIMIT,
		maxDepth: DEFAULT_DEPTH_LIMIT,
		maxEvents: DEFAULT_EVENT_LIMIT,
		textLimit: DEFAULT_TEXT_LIMIT,
		includeText: options.includeText,
		includeLayout: options.includeLayout,
		action,
	});
	return client.evaluate<WebWatch>(expression, durationMs + 10_000);
}

type RunStreamingBenchmarkOptions = { startFixture?: boolean; startBackendFixture?: boolean; fixtureProfile?: StreamingFixtureProfile; fixtureMix?: StreamingFixtureMix; fixturePreludeMessages?: number; simulateReconnect?: boolean; simulateTraceCatchup?: boolean; simulateOverlayDrop?: boolean; negativeProfile?: StreamingNegativeProfile; providerTelemetry?: StreamingBenchmarkProviderTelemetry };

async function runStreamingBenchmarkSeries(client: CdpClient, runs: number, durationMs: number, options: RunStreamingBenchmarkOptions): Promise<StreamingBenchmark[]> {
	if (options.startFixture) await navigateStreamingBenchmarkFixture(client, options.fixtureProfile ?? "steady", options.fixtureMix ?? "text");
	if (options.startBackendFixture) await prepareStreamingBenchmarkEventSourceProbe(client);
	const benchmarks: StreamingBenchmark[] = [];
	for (let run = 0; run < runs; run++) benchmarks.push(await runStreamingBenchmark(client, durationMs, options));
	return benchmarks;
}

async function runStreamingBenchmark(client: CdpClient, durationMs: number, options: RunStreamingBenchmarkOptions = {}): Promise<StreamingBenchmark> {
	await client.send("Page.bringToFront").catch(() => undefined);
	const benchmarkTimeoutMs = durationMs + (options.startBackendFixture ? 20_000 : 10_000);
	const benchmark = await client.evaluate<Omit<StreamingBenchmark, "score">>(buildStreamingBenchmarkExpression(durationMs, options), benchmarkTimeoutMs);
	const withProvider = { ...benchmark, provider: options.providerTelemetry };
	const scored = { ...withProvider, score: scoreStreamingBenchmark(withProvider), providerPreservation: summarizeStreamingProviderPreservation(withProvider) };
	const withLivePipeline = { ...scored, livePipeline: summarizeStreamingLivePipeline(scored) };
	const withCadence = { ...withLivePipeline, cadence: summarizeStreamingCadence(withLivePipeline), negativeProfile: options.negativeProfile };
	return { ...withCadence, regressions: [...withCadence.regressions, ...evaluateStreamingLivePipelineRegressions(withCadence), ...evaluateStreamingProviderRegressions(withCadence)] };
}

export function attachStreamingProviderTelemetryToBenchmark(benchmark: StreamingBenchmark, providerTelemetry: StreamingBenchmarkProviderTelemetry | undefined): StreamingBenchmark {
	if (!providerTelemetry) return benchmark;
	const baseRegressions = benchmark.regressions.filter((regression) => !regression.startsWith("provider ") && !regression.startsWith("live pipeline "));
	const withProvider = { ...benchmark, provider: providerTelemetry };
	const providerPreservation = summarizeStreamingProviderPreservation(withProvider);
	const withProviderMetrics = { ...withProvider, providerPreservation, livePipeline: summarizeStreamingLivePipeline(withProvider) };
	return {
		...withProviderMetrics,
		regressions: [...baseRegressions, ...evaluateStreamingLivePipelineRegressions(withProviderMetrics), ...evaluateStreamingProviderRegressions(withProviderMetrics)],
	};
}

function attachStreamingProviderTelemetryToBenchmarks(benchmarks: StreamingBenchmark[], providerTelemetry: StreamingBenchmarkProviderTelemetry | undefined): StreamingBenchmark[] {
	return providerTelemetry ? benchmarks.map((benchmark) => attachStreamingProviderTelemetryToBenchmark(benchmark, providerTelemetry)) : benchmarks;
}

async function currentBrowserUrl(client: CdpClient): Promise<string> {
	const state = await client.evaluate<{ href: string }>(`(() => ({ href: location.href }))()`, 5_000);
	return state.href;
}

async function collectStreamingProviderTelemetryForOptions(options: WebOptions, client: Pick<CdpClient, "evaluate">): Promise<StreamingBenchmarkProviderTelemetry | undefined> {
	if (options.providerRequestId) return collectStreamingProviderTelemetry(options.providerRequestId);
	if (options.providerSessionId) return collectStreamingProviderTelemetryFromSession(options.providerSessionId);
	if (options.providerTurnId) return collectStreamingProviderTelemetryFromTurn(options.providerTurnId);
	if (options.providerSelectedSession) return collectStreamingProviderTelemetryFromSelectedBrowserSession(client);
	return undefined;
}

async function prepareStreamingBenchmarkEventSourceProbe(client: CdpClient, targetUrl?: string): Promise<void> {
	await client.send("Page.enable").catch(() => undefined);
	await client.send("Page.addScriptToEvaluateOnNewDocument", { source: streamingBenchmarkEventSourceProbeScript() }, 5_000);
	if (targetUrl) await navigateStreamingBenchmarkTarget(client, targetUrl);
	const state = await client.evaluate<{ href: string }>(`(() => {
  try { localStorage.setItem('pibo.chat.debugStreaming', '1'); } catch {}
  return { href: location.href };
})()`, 5_000);
	const url = new URL(state.href);
	if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("stream simulation requires an HTTP Chat Web target");
	url.searchParams.set("debugStreaming", "1");
	await navigateStreamingBenchmarkTarget(client, url.toString());
	await client.send("Page.bringToFront").catch(() => undefined);
	await client.evaluate("new Promise((resolve) => { if (document.readyState === 'complete') resolve(true); else addEventListener('load', () => resolve(true), { once: true }); })", 5_000);
	await client.evaluate("new Promise((resolve) => setTimeout(resolve, 800))", 2_000);
}

async function navigateStreamingBenchmarkTarget(client: CdpClient, url: string): Promise<void> {
	try {
		await client.send("Page.navigate", { url }, 5_000);
		return;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (!message.includes("Timed out waiting for CDP method Page.navigate")) throw error;
	}
	await client.evaluate(`(() => { if (location.href !== ${JSON.stringify(url)}) location.assign(${JSON.stringify(url)}); return true; })()`, 5_000).catch(() => undefined);
}

async function navigateStreamingBenchmarkFixture(client: CdpClient, fixtureProfile: StreamingFixtureProfile, fixtureMix: StreamingFixtureMix): Promise<void> {
	const url = `data:text/html;charset=utf-8,${encodeURIComponent(streamingBenchmarkFixtureHtml(fixtureProfile, fixtureMix))}`;
	await client.send("Page.enable").catch(() => undefined);
	await client.send("Page.navigate", { url }, 5_000);
	await client.send("Page.bringToFront").catch(() => undefined);
	await client.evaluate("new Promise((resolve) => { if (document.readyState === 'complete') resolve(true); else addEventListener('load', () => resolve(true), { once: true }); })", 5_000);
}

async function enableStreamingDebugForCurrentApp(client: CdpClient): Promise<void> {
	const state = await client.evaluate<{ href: string; hasReset: boolean }>(`(() => {
  try { localStorage.setItem('pibo.chat.debugStreaming', '1'); } catch {}
  return { href: location.href, hasReset: typeof window.__piboStreamingDebugReset === 'function' };
})()`, 5_000);
	if (state.hasReset) return;
	const url = new URL(state.href);
	if (url.protocol !== "http:" && url.protocol !== "https:") return;
	url.searchParams.set("debugStreaming", "1");
	await client.send("Page.enable").catch(() => undefined);
	await client.send("Page.navigate", { url: url.toString() }, 5_000);
	await client.send("Page.bringToFront").catch(() => undefined);
	await client.evaluate("new Promise((resolve) => { if (document.readyState === 'complete') resolve(true); else addEventListener('load', () => resolve(true), { once: true }); })", 5_000);
	await client.evaluate("new Promise((resolve) => setTimeout(resolve, 500))", 2_000);
}


function buildSnapshotExpression(options: { scope: string; maxNodes: number; maxDepth: number; textLimit: number; includeText: boolean; includeLayout: boolean }): string {
	return `(() => {
  const options = ${JSON.stringify(options)};
  ${browserSnapshotLibrary()}
  return captureSnapshot(options);
})()`;
}

function buildWatchExpression(options: { scope: string; durationMs: number; maxNodes: number; maxDepth: number; maxEvents: number; textLimit: number; includeText: boolean; includeLayout: boolean; action?: "new-session" }): string {
	return `(async () => {
  const options = ${JSON.stringify(options)};
  ${browserSnapshotLibrary()}
  return await runWatch(options);
})()`;
}


function browserSnapshotLibrary(): string {
	return String.raw`
function nowIso() { return new Date().toISOString(); }
function safeString(value) { return typeof value === 'string' ? value : ''; }
function short(value, limit) {
  const text = safeString(value).replace(/\s+/g, ' ').trim();
  return text.length > limit ? text.slice(0, Math.max(0, limit - 1)) + '…' : text;
}
function redactText(element, options) {
  const tag = element.tagName.toLowerCase();
  const debug = element.getAttribute('data-pibo-debug') || '';
  if (tag === 'textarea' || tag === 'input' || debug === 'composer') {
    const value = 'value' in element ? String(element.value || '') : '';
    return value ? '[redacted:' + value.length + ' chars]' : '';
  }
  const text = element.innerText || element.textContent || '';
  if (!options.includeText && /message|trace|terminal|composer/i.test(debug)) return text ? '[redacted]' : '';
  return short(text, options.textLimit);
}
function classSummary(element) {
  const value = safeString(element.getAttribute('class'));
  if (!value) return undefined;
  const parts = value.split(/\s+/).filter(Boolean);
  const useful = parts.filter((part) => /selected|active|hidden|opacity|translate|animate|border|bg-|text-|ring|disabled|pointer|sr-only/.test(part));
  return (useful.length ? useful : parts.slice(0, 6)).slice(0, 10).join(' ');
}
function attrMap(element) {
  const attrs = {};
  const allow = /^(id|role|aria-|data-pibo-|data-testid$|disabled$|checked$|selected$|hidden$|tabindex$|title$)/;
  for (const attr of Array.from(element.attributes || [])) {
    if (!allow.test(attr.name)) continue;
    if (/token|cookie|authorization|secret|password/i.test(attr.name)) {
      attrs[attr.name] = '[redacted]';
    } else {
      attrs[attr.name] = short(attr.value, 120);
    }
  }
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    attrs.value = element.value ? '[redacted:' + element.value.length + ' chars]' : '';
    attrs.disabled = Boolean(element.disabled);
  }
  return attrs;
}
function roleOf(element) {
  const explicit = element.getAttribute('role');
  if (explicit) return explicit;
  const tag = element.tagName.toLowerCase();
  if (tag === 'button') return 'button';
  if (tag === 'a') return 'link';
  if (tag === 'textarea') return 'textbox';
  if (tag === 'input') return 'input';
  if (tag === 'select') return 'combobox';
  if (tag === 'main') return 'main';
  if (tag === 'aside') return 'complementary';
  if (tag === 'nav') return 'navigation';
  return undefined;
}
function nameOf(element, options) {
  const aria = element.getAttribute('aria-label');
  if (aria) return short(aria, options.textLimit);
  const title = element.getAttribute('title');
  if (title) return short(title, options.textLimit);
  const tag = element.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea') return short(element.getAttribute('placeholder') || '', options.textLimit);
  const debug = element.getAttribute('data-pibo-debug');
  if (debug === 'session-row') return short(element.getAttribute('data-pibo-title') || element.innerText || '', options.textLimit);
  return undefined;
}
function elementPath(element) {
  const parts = [];
  let current = element;
  while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.documentElement) {
    const tag = current.tagName.toLowerCase();
    const parent = current.parentElement;
    if (!parent) {
      parts.unshift(tag);
      break;
    }
    const index = Array.from(parent.children).filter((child) => child.tagName === current.tagName).indexOf(current) + 1;
    parts.unshift(tag + ':nth-of-type(' + index + ')');
    current = parent;
  }
  return parts.join('>');
}
function identityOf(element) {
  const debug = element.getAttribute('data-pibo-debug');
  const session = element.getAttribute('data-pibo-session-id');
  const room = element.getAttribute('data-pibo-room-id');
  const view = element.getAttribute('data-pibo-view-id');
  const testId = element.getAttribute('data-testid');
  const id = element.id;
  if (debug && session) return { identity: debug + ':' + session, kind: 'pibo-session' };
  if (debug && room) return { identity: debug + ':' + room, kind: 'pibo-room' };
  if (debug && view) return { identity: debug + ':' + view, kind: 'pibo-view' };
  if (debug) return { identity: debug, kind: 'pibo-debug' };
  if (testId) return { identity: 'testid:' + testId, kind: 'testid' };
  if (id) return { identity: 'id:' + id, kind: 'id' };
  const role = roleOf(element);
  const name = nameOf(element, { textLimit: 40 }) || '';
  if (role && name) return { identity: role + ':' + name, kind: 'role-name' };
  return { identity: 'path:' + elementPath(element), kind: 'path' };
}
function boxOf(element) {
  const rect = element.getBoundingClientRect();
  return { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) };
}
function isImportantElement(element, depth) {
  if (!(element instanceof Element)) return false;
  const tag = element.tagName.toLowerCase();
  if (depth === 0) return true;
  if (['script', 'style', 'svg', 'path', 'rect', 'circle', 'line', 'polyline', 'polygon'].includes(tag)) return false;
  if (element.hasAttribute('data-pibo-debug') || element.hasAttribute('data-pibo-session-id') || element.hasAttribute('data-testid')) return true;
  if (element.hasAttribute('aria-label') || element.hasAttribute('title') || element.hasAttribute('role')) return true;
  if (['button', 'a', 'input', 'textarea', 'select', 'option', 'main', 'aside', 'nav'].includes(tag)) return true;
  if (element === document.activeElement) return true;
  if (element.getAttribute('aria-selected') === 'true' || element.getAttribute('data-pibo-selected') === 'true' || element.hasAttribute('hidden')) return true;
  const text = (element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim();
  if (text && element.children.length === 0 && depth <= 4) return true;
  return false;
}
function summarizeElement(element, depth, ref, options) {
  const ident = identityOf(element);
  const node = {
    ref,
    identity: ident.identity,
    identityKind: ident.kind,
    depth,
    tag: element.tagName.toLowerCase(),
    attributes: attrMap(element),
    path: elementPath(element),
  };
  const role = roleOf(element); if (role) node.role = role;
  const name = nameOf(element, options); if (name) node.name = name;
  const text = redactText(element, options); if (text) node.text = text;
  const classes = classSummary(element); if (classes) node.classSummary = classes;
  if (document.activeElement === element) node.focused = true;
  if (options.includeLayout) node.box = boxOf(element);
  return node;
}
function captureSnapshot(options) {
  const root = document.querySelector(options.scope);
  const nodes = [];
  const omitted = { nodes: 0, depth: 0, budget: false };
  let refSeq = 0;
  function walk(element, depth) {
    if (!(element instanceof Element)) return;
    if (depth > options.maxDepth) { omitted.depth += 1; return; }
    if (isImportantElement(element, depth)) {
      if (nodes.length >= options.maxNodes) { omitted.nodes += 1; omitted.budget = true; return; }
      const node = summarizeElement(element, depth, '@n' + (++refSeq), options);
      nodes.push(node);
    }
    for (const child of Array.from(element.children)) walk(child, depth + 1);
  }
  if (root) walk(root, 0);
  const active = document.activeElement instanceof Element ? summarizeElement(document.activeElement, 0, '@focus', options) : undefined;
  return {
    kind: 'snapshot',
    createdAt: nowIso(),
    url: location.href,
    title: document.title || '',
    scope: options.scope,
    rootFound: Boolean(root),
    root: nodes[0],
    activeElement: active ? { identity: active.identity, tag: active.tag, name: active.name, path: active.path } : undefined,
    nodes,
    omitted,
  };
}
function mutationTarget(mutation, options) {
  const target = mutation.target instanceof Element ? mutation.target : mutation.target.parentElement;
  return target ? summarizeElement(target, 0, '@target', options) : undefined;
}
function pushEvent(events, omitted, maxEvents, event) {
  if (events.length >= maxEvents) { omitted.events += 1; return; }
  events.push(event);
}
function findNewSessionButton() {
  const candidates = Array.from(document.querySelectorAll('button'));
  return candidates.find((button) => {
    const label = [button.getAttribute('aria-label'), button.getAttribute('title'), button.textContent].filter(Boolean).join(' ');
    return /New Session/i.test(label);
  });
}
async function runWatch(options) {
  const root = document.querySelector(options.scope);
  const events = [];
  const omitted = { events: 0, nodes: 0, depth: 0, budget: false };
  const start = performance.now();
  const at = () => Math.max(0, Math.round(performance.now() - start));
  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;
  let action = undefined;
  const routeEvent = (kind, beforeUrl, afterUrl) => {
    if (beforeUrl !== afterUrl) pushEvent(events, omitted, options.maxEvents, { t: at(), source: 'route', kind, before: beforeUrl, after: afterUrl });
  };
  history.pushState = function(...args) {
    const beforeUrl = location.href;
    const result = originalPushState.apply(this, args);
    routeEvent('pushState', beforeUrl, location.href);
    return result;
  };
  history.replaceState = function(...args) {
    const beforeUrl = location.href;
    const result = originalReplaceState.apply(this, args);
    routeEvent('replaceState', beforeUrl, location.href);
    return result;
  };
  const onPopState = () => pushEvent(events, omitted, options.maxEvents, { t: at(), source: 'route', kind: 'popstate', after: location.href });
  const onFocusIn = (event) => {
    if (!(event.target instanceof Element)) return;
    if (root && !root.contains(event.target)) return;
    const node = summarizeElement(event.target, 0, '@focus', options);
    pushEvent(events, omitted, options.maxEvents, { t: at(), source: 'focus', kind: 'focusin', target: node.identity, node });
  };
  const observer = root ? new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'childList') {
        for (const added of Array.from(mutation.addedNodes)) {
          if (!(added instanceof Element)) continue;
          const node = summarizeElement(added, 0, '@added', options);
          pushEvent(events, omitted, options.maxEvents, { t: at(), source: 'dom', kind: 'added', target: node.identity, node });
        }
        for (const removed of Array.from(mutation.removedNodes)) {
          if (!(removed instanceof Element)) continue;
          const node = summarizeElement(removed, 0, '@removed', options);
          pushEvent(events, omitted, options.maxEvents, { t: at(), source: 'dom', kind: 'removed', target: node.identity, node });
        }
      } else if (mutation.type === 'attributes') {
        const node = mutationTarget(mutation, options);
        if (!node) continue;
        const name = mutation.attributeName || 'attribute';
        const after = mutation.target instanceof Element ? mutation.target.getAttribute(name) : undefined;
        pushEvent(events, omitted, options.maxEvents, { t: at(), source: 'dom', kind: 'attr', target: node.identity, detail: name, before: mutation.oldValue || '', after: after || '', node });
      } else if (mutation.type === 'characterData') {
        const node = mutationTarget(mutation, options);
        pushEvent(events, omitted, options.maxEvents, { t: at(), source: 'dom', kind: 'text', target: node ? node.identity : undefined, before: short(mutation.oldValue || '', options.textLimit), after: short(mutation.target.textContent || '', options.textLimit), node });
      }
    }
  }) : undefined;
  if (observer && root) observer.observe(root, { childList: true, subtree: true, attributes: true, attributeOldValue: true, characterData: true, characterDataOldValue: true, attributeFilter: ['class', 'style', 'hidden', 'aria-selected', 'aria-expanded', 'data-pibo-selected', 'data-pibo-session-id', 'data-pibo-selected-session-id', 'data-pibo-state', 'data-pibo-debug'] });
  document.addEventListener('focusin', onFocusIn, true);
  window.addEventListener('popstate', onPopState, true);
  const before = captureSnapshot(options);
  omitted.nodes += before.omitted.nodes;
  omitted.depth += before.omitted.depth;
  omitted.budget = omitted.budget || before.omitted.budget;
  if (options.action === 'new-session') {
    try {
      const button = findNewSessionButton();
      action = { requested: 'new-session', performed: Boolean(button) };
      if (button) {
        const node = summarizeElement(button, 0, '@action', options);
        pushEvent(events, omitted, options.maxEvents, { t: at(), source: 'action', kind: 'click', target: node.identity, detail: 'New Session', node });
        button.click();
      } else {
        action.error = 'New Session button not found';
      }
    } catch (error) {
      action = { requested: 'new-session', performed: false, error: String(error && error.message ? error.message : error) };
    }
  }
  await new Promise((resolve) => setTimeout(resolve, options.durationMs));
  observer?.disconnect();
  document.removeEventListener('focusin', onFocusIn, true);
  window.removeEventListener('popstate', onPopState, true);
  history.pushState = originalPushState;
  history.replaceState = originalReplaceState;
  const after = captureSnapshot(options);
  omitted.nodes += after.omitted.nodes;
  omitted.depth += after.omitted.depth;
  omitted.budget = omitted.budget || after.omitted.budget || omitted.events > 0;
  return {
    kind: 'watch',
    createdAt: nowIso(),
    url: location.href,
    title: document.title || '',
    scope: options.scope,
    durationMs: options.durationMs,
    rootFound: Boolean(before.rootFound || after.rootFound),
    events,
    before,
    after,
    omitted,
    action,
  };
}
`;
}

function parseOptions(args: string[]): WebOptions {
	const options: WebOptions = {
		positionals: [],
		json: false,
		artifact: false,
		fixture: false,
		backendFixture: false,
		simulateReconnect: false,
		simulateTraceCatchup: false,
		simulateOverlayDrop: false,
		assertHealthy: false,
		expectedRegressionPatterns: [],
		providerSelectedSession: false,
		compareHosted: false,
		compareHostedIfConfigured: false,
		act: false,
		manual: false,
		includeText: false,
		includeLayout: false,
		compact: false,
	};
	for (let index = 0; index < args.length; index++) {
		const arg = args[index];
		if (arg === "--json") options.json = true;
		else if (arg === "--artifact") options.artifact = true;
		else if (arg === "--fixture") options.fixture = true;
		else if (arg === "--backend-fixture") options.backendFixture = true;
		else if (arg === "--simulate-reconnect") options.simulateReconnect = true;
		else if (arg === "--simulate-trace-catchup") options.simulateTraceCatchup = true;
		else if (arg === "--assert") options.assertHealthy = true;
		else if (arg === "--expect-regression") options.expectedRegressionPatterns.push(requireValue(args, ++index, arg));
		else if (arg.startsWith("--expect-regression=")) options.expectedRegressionPatterns.push(arg.slice("--expect-regression=".length));
		else if (arg === "--act") options.act = true;
		else if (arg === "--manual") options.manual = true;
		else if (arg === "--include-text") options.includeText = true;
		else if (arg === "--include-layout") options.includeLayout = true;
		else if (arg === "--compact") options.compact = true;
		else if (arg === "--output") options.output = requireValue(args, ++index, arg);
		else if (arg.startsWith("--output=")) options.output = arg.slice("--output=".length);
		else if (arg === "--json-output") options.jsonOutput = requireValue(args, ++index, arg);
		else if (arg.startsWith("--json-output=")) options.jsonOutput = arg.slice("--json-output=".length);
		else if (arg === "--cdp-url") options.cdpUrl = requireValue(args, ++index, arg);
		else if (arg.startsWith("--cdp-url=")) options.cdpUrl = arg.slice("--cdp-url=".length);
		else if (arg === "--target") options.target = requireValue(args, ++index, arg);
		else if (arg.startsWith("--target=")) options.target = arg.slice("--target=".length);
		else if (arg === "--scope") options.scope = requireValue(args, ++index, arg);
		else if (arg.startsWith("--scope=")) options.scope = arg.slice("--scope=".length);
		else if (arg === "--preset") options.preset = requireValue(args, ++index, arg);
		else if (arg.startsWith("--preset=")) options.preset = arg.slice("--preset=".length);
		else if (arg === "--duration") options.duration = requireValue(args, ++index, arg);
		else if (arg.startsWith("--duration=")) options.duration = arg.slice("--duration=".length);
		else if (arg === "--runs") options.runs = requireValue(args, ++index, arg);
		else if (arg.startsWith("--runs=")) options.runs = arg.slice("--runs=".length);
		else if (arg === "--fixture-profile") options.fixtureProfile = requireValue(args, ++index, arg);
		else if (arg.startsWith("--fixture-profile=")) options.fixtureProfile = arg.slice("--fixture-profile=".length);
		else if (arg === "--fixture-mix") options.fixtureMix = requireValue(args, ++index, arg);
		else if (arg.startsWith("--fixture-mix=")) options.fixtureMix = arg.slice("--fixture-mix=".length);
		else if (arg === "--fixture-prelude-messages") options.fixturePreludeMessages = requireValue(args, ++index, arg);
		else if (arg.startsWith("--fixture-prelude-messages=")) options.fixturePreludeMessages = arg.slice("--fixture-prelude-messages=".length);
		else if (arg === "--negative-profile") options.negativeProfile = requireValue(args, ++index, arg);
		else if (arg.startsWith("--negative-profile=")) options.negativeProfile = arg.slice("--negative-profile=".length);
		else if (arg === "--compare-url") options.compareUrl = requireValue(args, ++index, arg);
		else if (arg.startsWith("--compare-url=")) options.compareUrl = arg.slice("--compare-url=".length);
		else if (arg === "--provider-request-id") options.providerRequestId = requireValue(args, ++index, arg);
		else if (arg.startsWith("--provider-request-id=")) options.providerRequestId = arg.slice("--provider-request-id=".length);
		else if (arg === "--provider-session-id") options.providerSessionId = requireValue(args, ++index, arg);
		else if (arg.startsWith("--provider-session-id=")) options.providerSessionId = arg.slice("--provider-session-id=".length);
		else if (arg === "--provider-turn-id") options.providerTurnId = requireValue(args, ++index, arg);
		else if (arg.startsWith("--provider-turn-id=")) options.providerTurnId = arg.slice("--provider-turn-id=".length);
		else if (arg === "--provider-selected-session") options.providerSelectedSession = true;
		else if (arg === "--compare-hosted") options.compareHosted = true;
		else if (arg === "--compare-hosted-if-configured") options.compareHostedIfConfigured = true;
		else if (arg === "--from") options.from = requireValue(args, ++index, arg);
		else if (arg.startsWith("--from=")) options.from = arg.slice("--from=".length);
		else options.positionals.push(arg);
	}
	return options;
}

function requireValue(args: string[], index: number, flag: string): string {
	const value = args[index];
	if (!value) throw new Error(`${flag} requires a value`);
	return value;
}

function resolveScope(options: WebOptions): string {
	if (options.scope) return options.scope;
	if (options.preset) return presetScope(options.preset);
	throw new Error("Missing --scope or --preset. Try --preset session-list, chat-shell, composer, or app.");
}

function presetScope(preset: string): string {
	switch (preset) {
		case "app": return "[data-pibo-debug=\"chat-app\"]";
		case "route-shell": return "[data-pibo-debug=\"route-shell\"]";
		case "sidebar": return "[data-pibo-debug=\"sidebar-shell\"]";
		case "session-list": return "[data-pibo-debug=\"session-list\"]";
		case "chat-shell": return "[data-pibo-debug=\"chat-shell\"]";
		case "composer": return "[data-pibo-debug=\"composer\"]";
		default: throw new Error(`Unknown web render preset "${preset}". Use app, route-shell, sidebar, session-list, chat-shell, or composer.`);
	}
}

function parseDuration(value?: string): number {
	if (!value) return DEFAULT_WATCH_DURATION_MS;
	const duration = Number(value);
	if (!Number.isFinite(duration) || duration <= 0) throw new Error("--duration must be a positive number of milliseconds");
	if (duration > MAX_WATCH_DURATION_MS) throw new Error(`--duration must be <= ${MAX_WATCH_DURATION_MS}ms`);
	return Math.round(duration);
}

function parseRuns(value?: string): number {
	if (!value) return 1;
	const runs = Number(value);
	if (!Number.isInteger(runs) || runs <= 0) throw new Error("--runs must be a positive integer");
	if (runs > 10) throw new Error("--runs must be <= 10");
	return runs;
}

function parseFixtureProfile(value?: string): StreamingFixtureProfile {
	if (!value) return "steady";
	if (value === "steady" || value === "jitter" || value === "burst" || value === "batch") return value;
	throw new Error("--fixture-profile must be steady, jitter, burst, or batch");
}

function parseFixtureMix(value?: string): StreamingFixtureMix {
	if (!value) return "text";
	if (value === "text" || value === "reasoning-text" || value === "markdown" || value === "gfm-markdown" || value === "gfm-task-markdown" || value === "gfm-full-markdown") return value;
	throw new Error("--fixture-mix must be text, reasoning-text, markdown, gfm-markdown, gfm-task-markdown, or gfm-full-markdown");
}

function parseFixturePreludeMessages(value?: string): number {
	if (!value) return 0;
	const count = Number(value);
	if (!Number.isInteger(count) || count < 0) throw new Error("--fixture-prelude-messages must be a non-negative integer");
	if (count > 2000) throw new Error("--fixture-prelude-messages must be <= 2000");
	return count;
}

function parseNegativeProfile(value?: string): StreamingNegativeProfile | undefined {
	if (!value) return undefined;
	if (value === "batch" || value === "overlay-drop") return value;
	throw new Error("--negative-profile must be batch or overlay-drop");
}

function applyNegativeStreamingProfile(options: WebOptions, profile: StreamingNegativeProfile): WebOptions {
	const conflictingFlags: string[] = [];
	if (options.fixture) conflictingFlags.push("--fixture");
	if (options.backendFixture) conflictingFlags.push("--backend-fixture");
	if (options.fixtureProfile) conflictingFlags.push("--fixture-profile");
	if (options.fixtureMix) conflictingFlags.push("--fixture-mix");
	if (options.fixturePreludeMessages) conflictingFlags.push("--fixture-prelude-messages");
	if (options.simulateReconnect) conflictingFlags.push("--simulate-reconnect");
	if (options.simulateTraceCatchup) conflictingFlags.push("--simulate-trace-catchup");
	if (options.simulateOverlayDrop) conflictingFlags.push("--simulate-overlay-drop");
	if (options.expectedRegressionPatterns.length > 0) conflictingFlags.push("--expect-regression");
	if (conflictingFlags.length > 0) throw new Error(`--negative-profile ${profile} already selects fixture settings and expected regressions; remove ${conflictingFlags.join(", ")}`);
	return {
		...options,
		backendFixture: true,
		fixtureProfile: profile === "batch" ? "batch" : "steady",
		fixtureMix: "reasoning-text",
		simulateOverlayDrop: profile === "overlay-drop",
		assertHealthy: true,
		expectedRegressionPatterns: profile === "batch" ? [...BATCH_NEGATIVE_EXPECTED_REGRESSIONS] : [...OVERLAY_DROP_NEGATIVE_EXPECTED_REGRESSIONS],
	};
}

function scoreStreamingBenchmark(benchmark: Omit<StreamingBenchmark, "score">): StreamingSmoothnessScore {
	const debugDelta = benchmark.debug.delta ?? {};
	const textDeltaCount = numberField(debugDelta, "textDeltaCount");
	const domGapP50Ms = finiteNumber(benchmark.dom.gapsMs.p50);
	const domGapP90Ms = finiteNumber(benchmark.dom.gapsMs.p90);
	const domJumpP90Chars = finiteNumber(benchmark.dom.positiveCharJumps.p90);
	const firstVisibleMs = finiteNumber(benchmark.dom.firstPositiveUpdateMs);
	const providerToDomRatio = textDeltaCount > 0 ? Math.min(1, benchmark.dom.positiveUpdateCount / textDeltaCount) : 0;
	const smoothness =
		0.30 * clampScore(100 - (domGapP50Ms ?? 100))
		+ 0.25 * clampScore(((300 - (domGapP90Ms ?? 300)) / 3))
		+ 0.20 * clampScore(((120 - (domJumpP90Chars ?? 120)) / 1.2))
		+ 0.15 * clampScore(providerToDomRatio * 100)
		+ 0.10 * clampScore(100 - ((firstVisibleMs ?? 500) / 5));
	return {
		smoothness: round3(smoothness),
		domGapP50Ms,
		domGapP90Ms,
		domJumpP90Chars,
		textDeltaCount,
		domPositiveUpdateCount: benchmark.dom.positiveUpdateCount,
		firstVisibleMs,
	};
}

function summarizeStreamingCadence(benchmark: Pick<StreamingBenchmark, "fixture" | "dom" | "sse">): StreamingBenchmarkCadence | undefined {
	const fixtureScheduleGapP90Ms = finiteNumber(benchmark.fixture?.scheduleGapsMs?.p90);
	if (fixtureScheduleGapP90Ms === undefined) return undefined;
	const domGapP90Ms = finiteNumber(benchmark.dom.gapsMs.p90);
	const sseTextGapP90Ms = finiteNumber(benchmark.sse?.textEventGapsMs.p90);
	return {
		fixtureScheduleGapP90Ms,
		domGapP90Ms,
		sseTextGapP90Ms,
		domLagOverScheduleP90Ms: domGapP90Ms === undefined ? undefined : round3(domGapP90Ms - fixtureScheduleGapP90Ms),
		sseTextLagOverScheduleP90Ms: sseTextGapP90Ms === undefined ? undefined : round3(sseTextGapP90Ms - fixtureScheduleGapP90Ms),
		domToScheduleP90Ratio: domGapP90Ms === undefined || fixtureScheduleGapP90Ms <= 0 ? undefined : round3(domGapP90Ms / fixtureScheduleGapP90Ms),
		sseTextToScheduleP90Ratio: sseTextGapP90Ms === undefined || fixtureScheduleGapP90Ms <= 0 ? undefined : round3(sseTextGapP90Ms / fixtureScheduleGapP90Ms),
	};
}

export function summarizeStreamingProviderPreservation(benchmark: { provider?: StreamingBenchmarkProviderTelemetry; sse?: StreamingBenchmarkSseProbe; eventSource?: Pick<StreamingBenchmarkEventSourceProbe, "streams">; dom?: Pick<StreamingBenchmark["dom"], "positiveUpdateCount"> }): StreamingBenchmarkProviderPreservation | undefined {
	const provider = benchmark.provider;
	if (!provider?.available) return undefined;
	const selectedLive = summarizeStreamingSelectedLiveEventSource(benchmark);
	return {
		providerTextDeltaCount: provider.textDeltaCount,
		providerReasoningDeltaCount: provider.reasoningDeltaCount,
		sseTextEventCount: benchmark.sse?.textEventCount,
		sseReasoningEventCount: benchmark.sse?.reasoningEventCount,
		selectedLiveTextEventCountAfterStart: selectedLive?.textEventCountAfterStart,
		selectedLiveReasoningEventCountAfterStart: selectedLive?.reasoningEventCountAfterStart,
		domPositiveUpdateCount: benchmark.dom?.positiveUpdateCount,
		sseTextToProviderRatio: ratioToProvider(benchmark.sse?.textEventCount, provider.textDeltaCount),
		sseReasoningToProviderRatio: ratioToProvider(benchmark.sse?.reasoningEventCount, provider.reasoningDeltaCount),
		selectedLiveTextToProviderRatio: ratioToProvider(selectedLive?.textEventCountAfterStart, provider.textDeltaCount),
		selectedLiveReasoningToProviderRatio: ratioToProvider(selectedLive?.reasoningEventCountAfterStart, provider.reasoningDeltaCount),
		domPositiveToProviderTextRatio: ratioToProvider(benchmark.dom?.positiveUpdateCount, provider.textDeltaCount),
	};
}

export function summarizeStreamingLivePipeline(benchmark: { debug?: Pick<StreamingBenchmark["debug"], "delta" | "stateBeforeReset" | "after">; fixture?: StreamingBenchmark["fixture"]; provider?: StreamingBenchmarkProviderTelemetry }): StreamingBenchmarkLivePipeline | undefined {
	const debugDelta = benchmark.debug?.delta ?? {};
	const debugStateBeforeReset = benchmark.debug?.stateBeforeReset ?? {};
	const debugAfter = benchmark.debug?.after ?? {};
	const fixtureTextCount = finiteNumber(benchmark.fixture?.deltaCount);
	const fixtureReasoningCount = finiteNumber(benchmark.fixture?.reasoningDeltaCount);
	const provider = benchmark.provider?.available ? benchmark.provider : undefined;
	const debugTextCount = finiteNumber(debugDelta.textDeltaCount);
	const debugReasoningCount = finiteNumber(debugDelta.reasoningDeltaCount);
	const expectedSource = fixtureTextCount !== undefined || fixtureReasoningCount !== undefined ? "fixture" : provider ? "provider" : "debug";
	const expectedTextDeltaCount = expectedSource === "fixture" ? (fixtureTextCount ?? 0) : expectedSource === "provider" ? provider?.textDeltaCount ?? 0 : debugTextCount ?? 0;
	const expectedReasoningDeltaCount = expectedSource === "fixture" ? (fixtureReasoningCount ?? 0) : expectedSource === "provider" ? provider?.reasoningDeltaCount ?? 0 : debugReasoningCount ?? 0;
	const expectedInputEventCount = expectedTextDeltaCount + expectedReasoningDeltaCount;
	if (expectedInputEventCount <= 0) return undefined;
	const expectedPipelineEventCount = expectedStreamingPipelineEventCount(benchmark, expectedInputEventCount);
	const enqueueCount = finiteNumber(debugDelta.enqueueCount);
	const flushCount = finiteNumber(debugDelta.flushCount);
	const flushedEventCount = finiteNumber(debugDelta.flushedEventCount);
	const overlayUpdateCount = finiteNumber(debugDelta.overlayUpdateCount);
	const overlayEventCount = stateWindowNumber(debugAfter.overlayEventCount, debugStateBeforeReset.overlayEventCount);
	const currentOutputLength = stateWindowNumber(debugAfter.currentOutputLength, debugStateBeforeReset.currentOutputLength);
	const expectedTextBytes = finiteNumber(benchmark.fixture?.textBytes);
	const debugStartedAt = typeof debugAfter.startedAt === "string" ? debugAfter.startedAt : undefined;
	return {
		expectedSource,
		expectedTextDeltaCount,
		expectedReasoningDeltaCount,
		expectedInputEventCount,
		expectedPipelineEventCount,
		enqueueCount,
		flushCount,
		flushedEventCount,
		overlayUpdateCount,
		overlayEventCount,
		currentOutputLength,
		expectedTextBytes,
		enqueueToExpectedRatio: ratioToProvider(enqueueCount, expectedPipelineEventCount),
		flushedEventsToExpectedRatio: ratioToProvider(flushedEventCount, expectedPipelineEventCount),
		overlayEventsToExpectedRatio: ratioToProvider(overlayEventCount, expectedInputEventCount),
		currentOutputToExpectedTextBytesRatio: ratioToProvider(currentOutputLength, expectedTextBytes),
		flushToEnqueueRatio: ratioToProvider(flushCount, enqueueCount),
		overlayUpdatesToFlushedEventsRatio: ratioToProvider(overlayUpdateCount, flushedEventCount),
		firstEventMs: elapsedIsoMs(debugStartedAt, debugAfter.firstEventAt),
		firstTextDeltaMs: elapsedIsoMs(debugStartedAt, debugAfter.firstTextDeltaAt),
		firstReasoningDeltaMs: elapsedIsoMs(debugStartedAt, debugAfter.firstReasoningDeltaAt),
		firstEnqueueMs: elapsedIsoMs(debugStartedAt, debugAfter.firstEnqueueAt),
		firstFlushMs: elapsedIsoMs(debugStartedAt, debugAfter.firstFlushAt),
		firstOverlayUpdateMs: elapsedIsoMs(debugStartedAt, debugAfter.firstOverlayUpdateAt),
	};
}

function expectedStreamingPipelineEventCount(_benchmark: { debug?: Pick<StreamingBenchmark["debug"], "delta">; fixture?: StreamingBenchmark["fixture"] }, fallbackInputEventCount: number): number {
	return fallbackInputEventCount;
}

export function evaluateStreamingLivePipelineRegressions(benchmark: { livePipeline?: StreamingBenchmarkLivePipeline; fixture?: StreamingBenchmark["fixture"] }): string[] {
	const pipeline = benchmark.livePipeline;
	if (!pipeline || pipeline.expectedSource === "debug" || pipeline.expectedInputEventCount <= 0 || benchmark.fixture?.simulation === "trace-catchup") return [];
	const hasLiveCounters = [pipeline.enqueueCount, pipeline.flushCount, pipeline.flushedEventCount, pipeline.overlayUpdateCount, pipeline.overlayEventCount].some((value) => value !== undefined);
	if (!hasLiveCounters) return [];
	const regressions: string[] = [];
	pushMinimumRatioRegression(regressions, pipeline.flushedEventsToExpectedRatio, LIVE_PIPELINE_MIN_PRESERVATION_RATIO, "live pipeline flushed events/overlay expected ratio");
	pushMinimumRatioRegression(regressions, pipeline.overlayEventsToExpectedRatio, LIVE_PIPELINE_MIN_PRESERVATION_RATIO, "live pipeline overlay events/input expected ratio");
	if (pipeline.expectedTextDeltaCount > 0 && pipeline.expectedTextBytes !== undefined) {
		pushMinimumRatioRegression(regressions, pipeline.currentOutputToExpectedTextBytesRatio, LIVE_PIPELINE_MIN_PRESERVATION_RATIO, "live pipeline current text/expected bytes ratio");
	}
	pushMinimumRatioRegression(regressions, pipeline.flushToEnqueueRatio, LIVE_PIPELINE_MIN_FLUSH_RATIO, "live pipeline flush/enqueue ratio");
	pushMinimumRatioRegression(regressions, pipeline.overlayUpdatesToFlushedEventsRatio, LIVE_PIPELINE_MIN_FLUSH_RATIO, "live pipeline overlay updates/flushed ratio");
	return regressions;
}

export function evaluateStreamingProviderRegressions(benchmark: { provider?: StreamingBenchmarkProviderTelemetry; providerPreservation?: StreamingBenchmarkProviderPreservation; sse?: StreamingBenchmarkSseProbe; eventSource?: Pick<StreamingBenchmarkEventSourceProbe, "requested"> }): string[] {
	const provider = benchmark.provider;
	if (!provider?.available) return [];
	const regressions: string[] = [];
	if ((provider.parseErrorCount ?? 0) > 0) regressions.push(`provider parse errors ${provider.parseErrorCount} > 0`);
	if ((provider.unknownEventCount ?? 0) > 0) regressions.push(`provider unknown events ${provider.unknownEventCount} > 0`);
	if (provider.truncated) regressions.push("provider telemetry events were truncated");
	const preservation = benchmark.providerPreservation;
	if (provider.textDeltaCount > 0) {
		if (benchmark.sse?.requested) pushProviderRatioRegression(regressions, preservation?.sseTextToProviderRatio, PROVIDER_MIN_TEXT_PRESERVATION_RATIO, "provider SSE text preservation ratio");
		if (benchmark.eventSource?.requested) pushProviderRatioRegression(regressions, preservation?.selectedLiveTextToProviderRatio, PROVIDER_MIN_TEXT_PRESERVATION_RATIO, "provider selected-live text preservation ratio");
	}
	if (provider.reasoningDeltaCount > 0) {
		if (benchmark.sse?.requested) pushProviderRatioRegression(regressions, preservation?.sseReasoningToProviderRatio, PROVIDER_MIN_REASONING_PRESERVATION_RATIO, "provider SSE reasoning preservation ratio");
		if (benchmark.eventSource?.requested) pushProviderRatioRegression(regressions, preservation?.selectedLiveReasoningToProviderRatio, PROVIDER_MIN_REASONING_PRESERVATION_RATIO, "provider selected-live reasoning preservation ratio");
	}
	return regressions;
}

function pushProviderRatioRegression(regressions: string[], ratio: number | undefined, minimum: number, label: string): void {
	pushMinimumRatioRegression(regressions, ratio, minimum, label);
}

function pushMinimumRatioRegression(regressions: string[], ratio: number | undefined, minimum: number, label: string): void {
	if (ratio === undefined) regressions.push(`${label} unavailable`);
	else if (ratio < minimum) regressions.push(`${label} ${ratio} < ${minimum}`);
}

function ratioToProvider(numerator: number | undefined, denominator: number | undefined): number | undefined {
	if (numerator === undefined || denominator === undefined || denominator <= 0) return undefined;
	return round3(numerator / denominator);
}

function commonStreamingNegativeProfile(runs: readonly StreamingBenchmark[]): StreamingNegativeProfile | undefined {
	const profile = runs[0]?.negativeProfile;
	return profile && runs.every((run) => run.negativeProfile === profile) ? profile : undefined;
}

function summarizeStreamingBenchmarkGroup(runs: StreamingBenchmark[], baselineRuns?: StreamingBenchmark[]): StreamingBenchmarkGroup {
	const summary = summarizeStreamingBenchmarks(runs);
	return {
		kind: "streaming-benchmark-runs",
		createdAt: new Date().toISOString(),
		durationMs: runs[0]?.durationMs ?? 0,
		runs,
		negativeProfile: commonStreamingNegativeProfile(runs),
		summary,
		comparison: baselineRuns?.length ? compareStreamingBenchmarkSummaries(summarizeStreamingBenchmarks(baselineRuns), summary) : undefined,
		regressions: runs.flatMap((run, index) => run.regressions.map((regression) => `run ${index + 1}: ${regression}`)),
		warnings: runs.flatMap((run, index) => run.warnings.map((warning) => `run ${index + 1}: ${warning}`)),
	};
}

export function summarizeStreamingBenchmarkUrlComparison(primaryUrl: string, compareUrl: string, primary: StreamingBenchmarkGroup, compare: StreamingBenchmarkGroup): StreamingBenchmarkUrlComparison {
	const summaryComparison = compareStreamingBenchmarkSummaries(primary.summary, compare.summary);
	const negativeProfile = primary.negativeProfile && primary.negativeProfile === compare.negativeProfile ? primary.negativeProfile : undefined;
	return {
		kind: "streaming-benchmark-url-comparison",
		createdAt: new Date().toISOString(),
		durationMs: primary.durationMs,
		primaryUrl,
		compareUrl,
		primary,
		compare,
		negativeProfile,
		comparison: summaryComparison,
		regressions: [
			...primary.regressions.map((regression) => `primary: ${regression}`),
			...compare.regressions.map((regression) => `compare: ${regression}`),
			...evaluateStreamingBenchmarkUrlComparisonRegressions(summaryComparison).map((regression) => `comparison: ${regression}`),
		],
		warnings: [
			...primary.warnings.map((warning) => `primary: ${warning}`),
			...compare.warnings.map((warning) => `compare: ${warning}`),
		],
	};
}

export function evaluateStreamingBenchmarkUrlComparisonRegressions(comparison: StreamingBenchmarkComparison): string[] {
	const regressions: string[] = [];
	if (comparison.smoothnessDelta !== undefined && comparison.smoothnessDelta < -URL_COMPARISON_MAX_SMOOTHNESS_DROP) {
		regressions.push(`compare smoothness delta ${comparison.smoothnessDelta} below -${URL_COMPARISON_MAX_SMOOTHNESS_DROP}`);
	}
	if (comparison.domLagOverFixtureScheduleP90DeltaMs !== undefined && comparison.domLagOverFixtureScheduleP90DeltaMs > URL_COMPARISON_MAX_DOM_LAG_DELTA_MS) {
		regressions.push(`compare DOM lag over schedule delta ${comparison.domLagOverFixtureScheduleP90DeltaMs}ms exceeds ${URL_COMPARISON_MAX_DOM_LAG_DELTA_MS}ms`);
	}
	if (comparison.sseTextLagOverFixtureScheduleP90DeltaMs !== undefined && comparison.sseTextLagOverFixtureScheduleP90DeltaMs > URL_COMPARISON_MAX_SSE_LAG_DELTA_MS) {
		regressions.push(`compare SSE text lag over schedule delta ${comparison.sseTextLagOverFixtureScheduleP90DeltaMs}ms exceeds ${URL_COMPARISON_MAX_SSE_LAG_DELTA_MS}ms`);
	}
	if (comparison.sseChunkGapP90DeltaMs !== undefined && comparison.sseChunkGapP90DeltaMs > URL_COMPARISON_MAX_SSE_CHUNK_GAP_DELTA_MS) {
		regressions.push(`compare SSE chunk p90 gap delta ${comparison.sseChunkGapP90DeltaMs}ms exceeds ${URL_COMPARISON_MAX_SSE_CHUNK_GAP_DELTA_MS}ms`);
	}
	if (comparison.selectedLiveFirstTextEventDeltaMs !== undefined && comparison.selectedLiveFirstTextEventDeltaMs > URL_COMPARISON_MAX_FIRST_TRANSPORT_LATENCY_DELTA_MS) {
		regressions.push(`compare selected-live first text latency delta ${comparison.selectedLiveFirstTextEventDeltaMs}ms exceeds ${URL_COMPARISON_MAX_FIRST_TRANSPORT_LATENCY_DELTA_MS}ms`);
	}
	if (comparison.sseFirstTextEventDeltaMs !== undefined && comparison.sseFirstTextEventDeltaMs > URL_COMPARISON_MAX_FIRST_TRANSPORT_LATENCY_DELTA_MS) {
		regressions.push(`compare SSE first text latency delta ${comparison.sseFirstTextEventDeltaMs}ms exceeds ${URL_COMPARISON_MAX_FIRST_TRANSPORT_LATENCY_DELTA_MS}ms`);
	}
	if (comparison.liveFirstTextDeltaDeltaMs !== undefined && comparison.liveFirstTextDeltaDeltaMs > URL_COMPARISON_MAX_FIRST_LIVE_LATENCY_DELTA_MS) {
		regressions.push(`compare live first text latency delta ${comparison.liveFirstTextDeltaDeltaMs}ms exceeds ${URL_COMPARISON_MAX_FIRST_LIVE_LATENCY_DELTA_MS}ms`);
	}
	if (comparison.liveFirstEnqueueDeltaMs !== undefined && comparison.liveFirstEnqueueDeltaMs > URL_COMPARISON_MAX_FIRST_LIVE_LATENCY_DELTA_MS) {
		regressions.push(`compare live first enqueue latency delta ${comparison.liveFirstEnqueueDeltaMs}ms exceeds ${URL_COMPARISON_MAX_FIRST_LIVE_LATENCY_DELTA_MS}ms`);
	}
	if (comparison.liveFirstFlushDeltaMs !== undefined && comparison.liveFirstFlushDeltaMs > URL_COMPARISON_MAX_FIRST_LIVE_LATENCY_DELTA_MS) {
		regressions.push(`compare live first flush latency delta ${comparison.liveFirstFlushDeltaMs}ms exceeds ${URL_COMPARISON_MAX_FIRST_LIVE_LATENCY_DELTA_MS}ms`);
	}
	if (comparison.liveFirstOverlayUpdateDeltaMs !== undefined && comparison.liveFirstOverlayUpdateDeltaMs > URL_COMPARISON_MAX_FIRST_LIVE_LATENCY_DELTA_MS) {
		regressions.push(`compare live first overlay latency delta ${comparison.liveFirstOverlayUpdateDeltaMs}ms exceeds ${URL_COMPARISON_MAX_FIRST_LIVE_LATENCY_DELTA_MS}ms`);
	}
	if (comparison.firstVisibleDeltaMs !== undefined && comparison.firstVisibleDeltaMs > URL_COMPARISON_MAX_FIRST_VISIBLE_LATENCY_DELTA_MS) {
		regressions.push(`compare DOM first visible latency delta ${comparison.firstVisibleDeltaMs}ms exceeds ${URL_COMPARISON_MAX_FIRST_VISIBLE_LATENCY_DELTA_MS}ms`);
	}
	if (comparison.sseTextEventDelta !== undefined && comparison.sseTextEventDelta < 0) regressions.push(`compare SSE text events delta ${comparison.sseTextEventDelta} below 0`);
	if (comparison.selectedLiveTextEventDelta !== undefined && comparison.selectedLiveTextEventDelta < 0) regressions.push(`compare selected-live text events delta ${comparison.selectedLiveTextEventDelta} below 0`);
	if (comparison.selectedLiveReasoningEventDelta !== undefined && comparison.selectedLiveReasoningEventDelta < 0) regressions.push(`compare selected-live reasoning events delta ${comparison.selectedLiveReasoningEventDelta} below 0`);
	return regressions;
}

function resolveStreamingBenchmarkCompareUrl(rawCompareUrl: string, primaryUrl: string): string {
	const primary = new URL(primaryUrl);
	const compare = new URL(rawCompareUrl, primary);
	const comparePath = compare.pathname.replace(/\/+$/, "");
	const primaryPath = primary.pathname.replace(/\/+$/, "");
	if ((comparePath === "" || comparePath === "/apps/chat") && primaryPath.startsWith("/apps/chat/")) {
		compare.pathname = primary.pathname;
		compare.search = primary.search;
	}
	compare.searchParams.set("debugStreaming", "1");
	return compare.toString();
}

async function resolveStreamingBenchmarkHostedCompareUrl(options: { optional?: boolean } = {}): Promise<string | undefined> {
	const hostedUrl = resolveStreamingBenchmarkHostedCompareUrlFromValues(process.env, await readDeveloperHostEnvFile());
	if (hostedUrl || options.optional) return hostedUrl;
	throw new Error("--compare-hosted requires PIBO_DEV_PUBLIC_URL or PIBO_DEV_BASE_URL in the environment or .env.developer-host");
}

export function resolveStreamingBenchmarkHostedCompareUrlFromValues(env: Record<string, string | undefined>, envFile: Record<string, string | undefined>): string | undefined {
	const directUrl = env.PIBO_DEV_PUBLIC_URL?.trim();
	if (directUrl) return directUrl;
	const baseUrl = env.PIBO_DEV_BASE_URL?.trim();
	if (baseUrl) return `${baseUrl.replace(/\/+$/, "")}/apps/chat`;
	const fileDirectUrl = envFile.PIBO_DEV_PUBLIC_URL?.trim();
	if (fileDirectUrl) return fileDirectUrl;
	const fileBaseUrl = envFile.PIBO_DEV_BASE_URL?.trim();
	if (fileBaseUrl) return `${fileBaseUrl.replace(/\/+$/, "")}/apps/chat`;
	return undefined;
}

async function readDeveloperHostEnvFile(): Promise<Record<string, string>> {
	try {
		return parseSimpleEnvFile(await readFile(path.resolve(process.cwd(), ".env.developer-host"), "utf8"));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
		throw error;
	}
}

function parseSimpleEnvFile(text: string): Record<string, string> {
	const values: Record<string, string> = {};
	for (const rawLine of text.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line || line.startsWith("#")) continue;
		const assignment = line.startsWith("export ") ? line.slice("export ".length).trimStart() : line;
		const equals = assignment.indexOf("=");
		if (equals <= 0) continue;
		const key = assignment.slice(0, equals).trim();
		if (key !== "PIBO_DEV_PUBLIC_URL" && key !== "PIBO_DEV_BASE_URL") continue;
		values[key] = stripEnvQuotes(assignment.slice(equals + 1).trim());
	}
	return values;
}

function stripEnvQuotes(value: string): string {
	if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
		return value.slice(1, -1);
	}
	return value;
}

function applyExpectedStreamingRegressions(benchmark: StreamingBenchmark | StreamingBenchmarkGroup | StreamingBenchmarkUrlComparison, expectedPatterns: readonly string[]): StreamingBenchmarkAssertion {
	const assertion = evaluateStreamingBenchmarkAssertion(benchmark.regressions, expectedPatterns);
	if (expectedPatterns.length > 0) benchmark.assertion = assertion;
	return assertion;
}

export function evaluateStreamingBenchmarkAssertion(regressions: readonly string[], expectedPatterns: readonly string[]): StreamingBenchmarkAssertion {
	const expectedRegressionPatterns = expectedPatterns.filter((pattern) => pattern.length > 0);
	const expectedRegressions: string[] = [];
	const unexpectedRegressions: string[] = [];
	const matchedPatterns = new Set<string>();
	for (const regression of regressions) {
		const matches = expectedRegressionPatterns.filter((pattern) => regression.includes(pattern));
		if (matches.length > 0) {
			expectedRegressions.push(regression);
			for (const pattern of matches) matchedPatterns.add(pattern);
		} else {
			unexpectedRegressions.push(regression);
		}
	}
	const missingExpectedRegressionPatterns = expectedRegressionPatterns.filter((pattern) => !matchedPatterns.has(pattern));
	return {
		expectedRegressionPatterns,
		expectedRegressions,
		unexpectedRegressions,
		missingExpectedRegressionPatterns,
		passed: unexpectedRegressions.length === 0 && missingExpectedRegressionPatterns.length === 0,
	};
}

export function summarizeStreamingBenchmarks(runs: StreamingBenchmark[]): StreamingBenchmarkSummary {
	return {
		runs: runs.length,
		smoothness: numericStats(runs.map((run) => run.score.smoothness)),
		textDeltaCount: numericStats(runs.map((run) => run.score.textDeltaCount)),
		reasoningDeltaCount: numericStats(runs.map((run) => numberField(run.debug.delta ?? {}, "reasoningDeltaCount"))),
		domPositiveUpdateCount: numericStats(runs.map((run) => run.score.domPositiveUpdateCount)),
		domGapP50Ms: numericStats(runs.map((run) => run.dom.gapsMs.p50)),
		domGapP90Ms: numericStats(runs.map((run) => run.dom.gapsMs.p90)),
		domGapMaxMs: numericStats(runs.map((run) => run.dom.gapsMs.max)),
		domJumpP90Chars: numericStats(runs.map((run) => run.dom.positiveCharJumps.p90)),
		domJumpMaxChars: numericStats(runs.map((run) => run.dom.positiveCharJumps.max)),
		firstVisibleMs: numericStats(runs.map((run) => run.dom.firstPositiveUpdateMs)),
		longTaskMaxMs: numericStats(runs.map((run) => run.longTasks.maxMs)),
		regressionCount: numericStats(runs.map((run) => run.regressions.length)),
		debugEnqueueCount: numericStats(runs.map((run) => streamingDebugDeltaNumber(run, "enqueueCount"))),
		debugFlushCount: numericStats(runs.map((run) => streamingDebugDeltaNumber(run, "flushCount"))),
		debugFlushedEventCount: numericStats(runs.map((run) => streamingDebugDeltaNumber(run, "flushedEventCount"))),
		debugOverlayUpdateCount: numericStats(runs.map((run) => streamingDebugDeltaNumber(run, "overlayUpdateCount"))),
		debugOverlayEventCount: numericStats(runs.map((run) => streamingDebugStateWindowNumber(run, "overlayEventCount"))),
		debugLiveTraceComputeCount: numericStats(runs.map((run) => streamingDebugDeltaNumber(run, "liveTraceComputeCount"))),
		debugLiveTraceComputeDurationTotalMs: numericStats(runs.map((run) => streamingDebugDeltaNumber(run, "liveTraceComputeDurationMsTotal"))),
		debugLiveTraceComputeDurationMaxMs: numericStats(runs.map((run) => streamingDebugAfterNumber(run, "liveTraceComputeDurationMsMax"))),
		debugMarkdownRenderCount: numericStats(runs.map((run) => streamingDebugDeltaNumber(run, "markdownRenderCount"))),
		debugMarkdownRenderPlainCount: numericStats(runs.map((run) => streamingDebugDeltaNumber(run, "markdownRenderPlainCount"))),
		debugMarkdownRenderFullCount: numericStats(runs.map((run) => streamingDebugDeltaNumber(run, "markdownRenderFullCount"))),
		debugMarkdownRenderCommonMarkCount: numericStats(runs.map((run) => streamingDebugDeltaNumber(run, "markdownRenderCommonMarkCount"))),
		debugMarkdownRenderGfmCount: numericStats(runs.map((run) => streamingDebugDeltaNumber(run, "markdownRenderGfmCount"))),
		debugMarkdownRenderGfmFastCount: numericStats(runs.map((run) => streamingDebugDeltaNumber(run, "markdownRenderGfmFastCount"))),
		debugMarkdownRenderDurationTotalMs: numericStats(runs.map((run) => streamingDebugDeltaNumber(run, "markdownRenderDurationMsTotal"))),
		debugMarkdownRenderDurationMaxMs: numericStats(runs.map((run) => streamingDebugAfterNumber(run, "markdownRenderDurationMsMax"))),
		debugMarkdownRenderPlainDurationMaxMs: numericStats(runs.map((run) => streamingDebugAfterNumber(run, "markdownRenderPlainDurationMsMax"))),
		debugMarkdownRenderFullDurationMaxMs: numericStats(runs.map((run) => streamingDebugAfterNumber(run, "markdownRenderFullDurationMsMax"))),
		debugMarkdownRenderCommonMarkDurationMaxMs: numericStats(runs.map((run) => streamingDebugAfterNumber(run, "markdownRenderCommonMarkDurationMsMax"))),
		debugMarkdownRenderGfmDurationMaxMs: numericStats(runs.map((run) => streamingDebugAfterNumber(run, "markdownRenderGfmDurationMsMax"))),
		debugMarkdownRenderGfmFastDurationMaxMs: numericStats(runs.map((run) => streamingDebugAfterNumber(run, "markdownRenderGfmFastDurationMsMax"))),
		debugTraceRefreshScheduledCount: numericStats(runs.map((run) => streamingDebugDeltaNumber(run, "traceRefreshScheduledCount"))),
		debugTraceRefreshCompletedCount: numericStats(runs.map((run) => streamingDebugDeltaNumber(run, "traceRefreshCompletedCount"))),
		debugTraceRefreshFailedCount: numericStats(runs.map((run) => streamingDebugDeltaNumber(run, "traceRefreshFailedCount"))),
		debugTraceRefreshDurationMaxMs: numericStats(runs.map((run) => streamingDebugAfterNumber(run, "traceRefreshDurationMsMax"))),
		debugCurrentOutputLength: numericStats(runs.map((run) => streamingDebugStateWindowNumber(run, "currentOutputLength"))),
		debugTraceBaseOutputLength: numericStats(runs.map((run) => streamingDebugAfterNumber(run, "traceBaseOutputLength"))),
		liveExpectedInputEventCount: numericStats(runs.map((run) => streamingLivePipeline(run)?.expectedInputEventCount)),
		liveExpectedPipelineEventCount: numericStats(runs.map((run) => streamingLivePipeline(run)?.expectedPipelineEventCount)),
		liveEnqueueToExpectedRatio: numericStats(runs.map((run) => streamingLivePipeline(run)?.enqueueToExpectedRatio)),
		liveFlushedEventsToExpectedRatio: numericStats(runs.map((run) => streamingLivePipeline(run)?.flushedEventsToExpectedRatio)),
		liveOverlayEventsToExpectedRatio: numericStats(runs.map((run) => streamingLivePipeline(run)?.overlayEventsToExpectedRatio)),
		liveCurrentOutputToExpectedTextBytesRatio: numericStats(runs.map((run) => streamingLivePipeline(run)?.currentOutputToExpectedTextBytesRatio)),
		liveFlushToEnqueueRatio: numericStats(runs.map((run) => streamingLivePipeline(run)?.flushToEnqueueRatio)),
		liveOverlayUpdatesToFlushedEventsRatio: numericStats(runs.map((run) => streamingLivePipeline(run)?.overlayUpdatesToFlushedEventsRatio)),
		liveFirstEventMs: numericStats(runs.map((run) => streamingLivePipeline(run)?.firstEventMs)),
		liveFirstTextDeltaMs: numericStats(runs.map((run) => streamingLivePipeline(run)?.firstTextDeltaMs)),
		liveFirstReasoningDeltaMs: numericStats(runs.map((run) => streamingLivePipeline(run)?.firstReasoningDeltaMs)),
		liveFirstEnqueueMs: numericStats(runs.map((run) => streamingLivePipeline(run)?.firstEnqueueMs)),
		liveFirstFlushMs: numericStats(runs.map((run) => streamingLivePipeline(run)?.firstFlushMs)),
		liveFirstOverlayUpdateMs: numericStats(runs.map((run) => streamingLivePipeline(run)?.firstOverlayUpdateMs)),
		traceSampleCount: numericStats(runs.map((run) => run.trace?.sampleCount)),
		traceLiveVersionCount: numericStats(runs.map((run) => run.trace?.liveVersionCount)),
		traceFirstLiveVersionMs: numericStats(runs.map((run) => run.trace?.firstLiveVersionMs)),
		traceMaxAssistantOutputLength: numericStats(runs.map((run) => run.trace?.maxAssistantOutputLength)),
		traceFinalAssistantOutputLength: numericStats(runs.map((run) => run.trace?.finalAssistantOutputLength)),
		traceDurableEventDelta: numericStats(runs.map((run) => traceDurableEventDelta(run.trace))),
		fixtureScheduleGapP90Ms: numericStats(runs.map((run) => run.fixture?.scheduleGapsMs?.p90)),
		domLagOverFixtureScheduleP90Ms: numericStats(runs.map((run) => run.cadence?.domLagOverScheduleP90Ms)),
		sseTextLagOverFixtureScheduleP90Ms: numericStats(runs.map((run) => run.cadence?.sseTextLagOverScheduleP90Ms)),
		domToFixtureScheduleP90Ratio: numericStats(runs.map((run) => run.cadence?.domToScheduleP90Ratio)),
		sseTextToFixtureScheduleP90Ratio: numericStats(runs.map((run) => run.cadence?.sseTextToScheduleP90Ratio)),
		eventSourceTextEventCountAfterStart: numericStats(runs.map((run) => run.eventSource?.textEventCountAfterStart)),
		eventSourceReasoningEventCountAfterStart: numericStats(runs.map((run) => run.eventSource?.reasoningEventCountAfterStart)),
		eventSourceForcedCloseCountAfterStart: numericStats(runs.map((run) => run.eventSource?.forcedCloseCountAfterStart)),
		eventSourceReconnectOpenCountAfterStart: numericStats(runs.map((run) => run.eventSource?.openCountAfterStart)),
		eventSourceTransientIdCountAfterStart: numericStats(runs.map((run) => run.eventSource?.transientIdCountAfterStart)),
		sseTextEventCount: numericStats(runs.map((run) => run.sse?.textEventCount)),
		sseReasoningEventCount: numericStats(runs.map((run) => run.sse?.reasoningEventCount)),
		sseChunkBytesP50: numericStats(runs.map((run) => run.sse?.chunkBytes.p50)),
		sseChunkGapP90Ms: numericStats(runs.map((run) => run.sse?.chunkGapsMs.p90)),
		sseTextEventsPerChunkP90: numericStats(runs.map((run) => run.sse?.textEventsPerChunk.p90)),
		sseTextEventGapP90Ms: numericStats(runs.map((run) => run.sse?.textEventGapsMs.p90)),
		sseFirstTextEventMs: numericStats(runs.map((run) => run.sse?.firstTextEventMs)),
		selectedLiveTextEventCountAfterStart: numericStats(runs.map((run) => selectedLiveStream(run)?.textEventCountAfterStart)),
		selectedLiveReasoningEventCountAfterStart: numericStats(runs.map((run) => selectedLiveStream(run)?.reasoningEventCountAfterStart)),
		selectedLiveEventCountAfterStart: numericStats(runs.map((run) => selectedLiveStream(run)?.eventCountAfterStart)),
		selectedLiveForcedCloseCountAfterStart: numericStats(runs.map((run) => selectedLiveStream(run)?.forcedCloseCountAfterStart)),
		selectedLiveReconnectOpenCountAfterStart: numericStats(runs.map((run) => selectedLiveStream(run)?.openCountAfterStart)),
		selectedLiveTransientIdCountAfterStart: numericStats(runs.map((run) => selectedLiveStream(run)?.transientIdCountAfterStart)),
		selectedLiveLiveSinceCount: numericStats(runs.map((run) => selectedLiveStream(run)?.liveSinceValues?.length)),
		selectedLiveReplayEventCountAfterStart: numericStats(runs.map((run) => selectedLiveStream(run)?.liveReplayEventCountAfterStart)),
		selectedLiveReplayCursorLagMaxAfterStart: numericStats(runs.map((run) => selectedLiveStream(run)?.liveReplayCursorLagMaxAfterStart)),
		selectedLiveReplayDuplicateCountAfterStart: numericStats(runs.map((run) => selectedLiveStream(run)?.liveReplayDuplicateCountAfterStart)),
		selectedLiveReplayMissedCountAfterStart: numericStats(runs.map((run) => selectedLiveStream(run)?.liveReplayMissedCountAfterStart)),
		selectedLiveFirstTextEventMsAfterStart: numericStats(runs.map((run) => selectedLiveStream(run)?.firstTextEventMsAfterStart)),
		roomSummaryEventCountAfterStart: numericStats(runs.map((run) => roomSummaryStream(run)?.eventCountAfterStart)),
		roomSummaryTextEventCountAfterStart: numericStats(runs.map((run) => roomSummaryStream(run)?.textEventCountAfterStart)),
		roomSummaryReasoningEventCountAfterStart: numericStats(runs.map((run) => roomSummaryStream(run)?.reasoningEventCountAfterStart)),
		providerTextDeltaCount: numericStats(runs.map((run) => run.provider?.textDeltaCount)),
		providerReasoningDeltaCount: numericStats(runs.map((run) => run.provider?.reasoningDeltaCount)),
		providerTextDeltaBytesP50: numericStats(runs.map((run) => run.provider?.textDeltaBytes.p50)),
		providerTextDeltaGapP90Ms: numericStats(runs.map((run) => run.provider?.textDeltaGapsMs.p90)),
		providerFirstTextLatencyMs: numericStats(runs.map((run) => run.provider?.firstTextLatencyMs)),
		providerParseErrorCount: numericStats(runs.map((run) => run.provider?.parseErrorCount)),
		providerUnknownEventCount: numericStats(runs.map((run) => run.provider?.unknownEventCount)),
		providerSseTextRatio: numericStats(runs.map((run) => run.providerPreservation?.sseTextToProviderRatio)),
		providerSseReasoningRatio: numericStats(runs.map((run) => run.providerPreservation?.sseReasoningToProviderRatio)),
		providerSelectedLiveTextRatio: numericStats(runs.map((run) => run.providerPreservation?.selectedLiveTextToProviderRatio)),
		providerSelectedLiveReasoningRatio: numericStats(runs.map((run) => run.providerPreservation?.selectedLiveReasoningToProviderRatio)),
		providerDomPositiveTextRatio: numericStats(runs.map((run) => run.providerPreservation?.domPositiveToProviderTextRatio)),
	};
}

function compareStreamingBenchmarkSummaries(baseline: StreamingBenchmarkSummary, current: StreamingBenchmarkSummary): StreamingBenchmarkComparison {
	return {
		baselineRuns: baseline.runs,
		currentRuns: current.runs,
		smoothnessDelta: statDelta(current.smoothness, baseline.smoothness),
		domGapP90DeltaMs: statDelta(current.domGapP90Ms, baseline.domGapP90Ms),
		domPositiveUpdateDelta: statDelta(current.domPositiveUpdateCount, baseline.domPositiveUpdateCount),
		domJumpMaxDeltaChars: statDelta(current.domJumpMaxChars, baseline.domJumpMaxChars),
		longTaskMaxDeltaMs: statDelta(current.longTaskMaxMs, baseline.longTaskMaxMs),
		firstVisibleDeltaMs: statDelta(current.firstVisibleMs, baseline.firstVisibleMs),
		liveFirstTextDeltaDeltaMs: statDelta(current.liveFirstTextDeltaMs, baseline.liveFirstTextDeltaMs),
		liveFirstEnqueueDeltaMs: statDelta(current.liveFirstEnqueueMs, baseline.liveFirstEnqueueMs),
		liveFirstFlushDeltaMs: statDelta(current.liveFirstFlushMs, baseline.liveFirstFlushMs),
		liveFirstOverlayUpdateDeltaMs: statDelta(current.liveFirstOverlayUpdateMs, baseline.liveFirstOverlayUpdateMs),
		sseFirstTextEventDeltaMs: statDelta(current.sseFirstTextEventMs, baseline.sseFirstTextEventMs),
		selectedLiveFirstTextEventDeltaMs: statDelta(current.selectedLiveFirstTextEventMsAfterStart, baseline.selectedLiveFirstTextEventMsAfterStart),
		providerFirstTextLatencyDeltaMs: statDelta(current.providerFirstTextLatencyMs, baseline.providerFirstTextLatencyMs),
		debugEnqueueCountDelta: statDelta(current.debugEnqueueCount, baseline.debugEnqueueCount),
		debugFlushCountDelta: statDelta(current.debugFlushCount, baseline.debugFlushCount),
		debugOverlayUpdateCountDelta: statDelta(current.debugOverlayUpdateCount, baseline.debugOverlayUpdateCount),
		debugTraceRefreshCompletedCountDelta: statDelta(current.debugTraceRefreshCompletedCount, baseline.debugTraceRefreshCompletedCount),
		liveEnqueueToExpectedRatioDelta: statDelta(current.liveEnqueueToExpectedRatio, baseline.liveEnqueueToExpectedRatio),
		liveFlushedEventsToExpectedRatioDelta: statDelta(current.liveFlushedEventsToExpectedRatio, baseline.liveFlushedEventsToExpectedRatio),
		liveOverlayEventsToExpectedRatioDelta: statDelta(current.liveOverlayEventsToExpectedRatio, baseline.liveOverlayEventsToExpectedRatio),
		liveFlushToEnqueueRatioDelta: statDelta(current.liveFlushToEnqueueRatio, baseline.liveFlushToEnqueueRatio),
		liveOverlayUpdatesToFlushedEventsRatioDelta: statDelta(current.liveOverlayUpdatesToFlushedEventsRatio, baseline.liveOverlayUpdatesToFlushedEventsRatio),
		traceLiveVersionCountDelta: statDelta(current.traceLiveVersionCount, baseline.traceLiveVersionCount),
		traceMaxAssistantOutputDelta: statDelta(current.traceMaxAssistantOutputLength, baseline.traceMaxAssistantOutputLength),
		traceDurableEventDeltaDelta: statDelta(current.traceDurableEventDelta, baseline.traceDurableEventDelta),
		fixtureScheduleGapP90DeltaMs: statDelta(current.fixtureScheduleGapP90Ms, baseline.fixtureScheduleGapP90Ms),
		domLagOverFixtureScheduleP90DeltaMs: statDelta(current.domLagOverFixtureScheduleP90Ms, baseline.domLagOverFixtureScheduleP90Ms),
		sseTextLagOverFixtureScheduleP90DeltaMs: statDelta(current.sseTextLagOverFixtureScheduleP90Ms, baseline.sseTextLagOverFixtureScheduleP90Ms),
		eventSourceTextEventDelta: statDelta(current.eventSourceTextEventCountAfterStart, baseline.eventSourceTextEventCountAfterStart),
		eventSourceReasoningEventDelta: statDelta(current.eventSourceReasoningEventCountAfterStart, baseline.eventSourceReasoningEventCountAfterStart),
		sseTextEventDelta: statDelta(current.sseTextEventCount, baseline.sseTextEventCount),
		sseChunkGapP90DeltaMs: statDelta(current.sseChunkGapP90Ms, baseline.sseChunkGapP90Ms),
		selectedLiveTextEventDelta: statDelta(current.selectedLiveTextEventCountAfterStart, baseline.selectedLiveTextEventCountAfterStart),
		selectedLiveReasoningEventDelta: statDelta(current.selectedLiveReasoningEventCountAfterStart, baseline.selectedLiveReasoningEventCountAfterStart),
		selectedLiveEventDelta: statDelta(current.selectedLiveEventCountAfterStart, baseline.selectedLiveEventCountAfterStart),
		providerSseTextRatioDelta: statDelta(current.providerSseTextRatio, baseline.providerSseTextRatio),
		providerSelectedLiveTextRatioDelta: statDelta(current.providerSelectedLiveTextRatio, baseline.providerSelectedLiveTextRatio),
		providerSseReasoningRatioDelta: statDelta(current.providerSseReasoningRatio, baseline.providerSseReasoningRatio),
		providerSelectedLiveReasoningRatioDelta: statDelta(current.providerSelectedLiveReasoningRatio, baseline.providerSelectedLiveReasoningRatio),
		providerDomPositiveTextRatioDelta: statDelta(current.providerDomPositiveTextRatio, baseline.providerDomPositiveTextRatio),
	};
}

function streamingLivePipeline(run: StreamingBenchmark): StreamingBenchmarkLivePipeline | undefined {
	return run.livePipeline ?? summarizeStreamingLivePipeline(run);
}

function streamingDebugDeltaNumber(run: StreamingBenchmark, key: string): number | undefined {
	const value = run.debug.delta?.[key];
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function streamingDebugAfterNumber(run: StreamingBenchmark, key: keyof StreamingDebugCounters): number | undefined {
	const value = run.debug.after?.[key];
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function streamingDebugStateWindowNumber(run: StreamingBenchmark, key: keyof StreamingDebugCounters): number | undefined {
	return stateWindowNumber(run.debug.after?.[key], run.debug.stateBeforeReset?.[key]);
}

function selectedLiveStream(run: StreamingBenchmark): StreamingBenchmarkEventSourceStreamProbe | undefined {
	return summarizeStreamingSelectedLiveEventSource(run);
}

function roomSummaryStream(run: StreamingBenchmark): StreamingBenchmarkEventSourceStreamProbe | undefined {
	return run.eventSource?.streams.find((stream) => stream.role === "room-summary");
}

function traceDurableEventDelta(trace: StreamingBenchmarkTraceProbe | undefined): number | undefined {
	if (!trace || trace.durableEventCountStart === undefined || trace.durableEventCountEnd === undefined) return undefined;
	return trace.durableEventCountEnd - trace.durableEventCountStart;
}

async function readStreamingBenchmarkArtifact(file: string): Promise<StreamingBenchmark | StreamingBenchmarkGroup | StreamingBenchmarkUrlComparison> {
	const parsed = JSON.parse(await readFile(file, "utf8"));
	const value = parsed.benchmark ?? parsed;
	if (value?.kind === "streaming-benchmark") return normalizeStreamingBenchmarkRun(value as StreamingBenchmark);
	if (value?.kind === "streaming-benchmark-runs") {
		const runs = Array.isArray(value.runs) ? value.runs.map((run: StreamingBenchmark) => normalizeStreamingBenchmarkRun(run)) : [];
		return normalizeStreamingBenchmarkGroupArtifact(value as Partial<StreamingBenchmarkGroup>, runs);
	}
	if (value?.kind === "streaming-benchmark-url-comparison") {
		const primaryRuns = Array.isArray(value.primary?.runs) ? value.primary.runs.map((run: StreamingBenchmark) => normalizeStreamingBenchmarkRun(run)) : [];
		const compareRuns = Array.isArray(value.compare?.runs) ? value.compare.runs.map((run: StreamingBenchmark) => normalizeStreamingBenchmarkRun(run)) : [];
		const primary = normalizeStreamingBenchmarkGroupArtifact(value.primary as Partial<StreamingBenchmarkGroup> | undefined, primaryRuns);
		const compare = normalizeStreamingBenchmarkGroupArtifact(value.compare as Partial<StreamingBenchmarkGroup> | undefined, compareRuns);
		return {
			...(value as StreamingBenchmarkUrlComparison),
			primary,
			compare,
			comparison: compareStreamingBenchmarkSummaries(primary.summary, compare.summary),
			regressions: Array.isArray(value.regressions) ? value.regressions : [],
			warnings: Array.isArray(value.warnings) ? value.warnings : [],
		};
	}
	throw new Error(`File is not a streaming benchmark artifact: ${file}`);
}

function normalizeStreamingBenchmarkGroupArtifact(value: Partial<StreamingBenchmarkGroup> | undefined, runs: StreamingBenchmark[]): StreamingBenchmarkGroup {
	return {
		...(value as StreamingBenchmarkGroup | undefined),
		kind: "streaming-benchmark-runs",
		createdAt: value?.createdAt ?? new Date().toISOString(),
		durationMs: value?.durationMs ?? runs[0]?.durationMs ?? 0,
		runs,
		summary: summarizeStreamingBenchmarks(runs),
		regressions: Array.isArray(value?.regressions) ? value.regressions : [],
		warnings: Array.isArray(value?.warnings) ? value.warnings : [],
	};
}

function normalizeStreamingBenchmarkRun(run: StreamingBenchmark): StreamingBenchmark {
	const scored = { ...run, regressions: Array.isArray(run.regressions) ? run.regressions : [], warnings: Array.isArray(run.warnings) ? run.warnings : [], score: run.score ?? scoreStreamingBenchmark(run) };
	const withProviderPreservation = { ...scored, providerPreservation: run.providerPreservation ?? summarizeStreamingProviderPreservation(scored) };
	const withLivePipeline = { ...withProviderPreservation, livePipeline: run.livePipeline ?? summarizeStreamingLivePipeline(withProviderPreservation) };
	return { ...withLivePipeline, cadence: run.cadence ?? summarizeStreamingCadence(withLivePipeline) };
}

function streamingBenchmarkReportTarget(benchmark: StreamingBenchmark | StreamingBenchmarkGroup | StreamingBenchmarkUrlComparison): { id: string; url: string; title: string } {
	const url = benchmark.kind === "streaming-benchmark-url-comparison"
		? benchmark.primaryUrl
		: benchmark.kind === "streaming-benchmark-runs"
			? benchmark.runs[0]?.url ?? ""
			: benchmark.url;
	return { id: "artifact", url, title: "streaming benchmark artifact" };
}

async function readStreamingBenchmarkRuns(file: string): Promise<StreamingBenchmark[]> {
	const value = await readStreamingBenchmarkArtifact(file);
	const runs = value.kind === "streaming-benchmark-runs"
		? value.runs
		: value.kind === "streaming-benchmark-url-comparison"
			? [...value.primary.runs, ...value.compare.runs]
			: [value];
	return runs.filter((run): run is StreamingBenchmark => run.kind === "streaming-benchmark");
}

function numericStats(values: readonly unknown[]): NumberStats {
	const nums = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value)).slice().sort((a, b) => a - b);
	if (!nums.length) return { count: 0 };
	const pick = (q: number) => nums[Math.min(nums.length - 1, Math.max(0, Math.floor((nums.length - 1) * q)))];
	const avg = nums.reduce((sum, value) => sum + value, 0) / nums.length;
	return {
		count: nums.length,
		min: round3(nums[0]),
		p50: round3(pick(0.50)),
		p90: round3(pick(0.90)),
		p99: round3(pick(0.99)),
		max: round3(nums[nums.length - 1]),
		avg: round3(avg),
	};
}

function statDelta(current: NumberStats, baseline: NumberStats): number | undefined {
	if (current.p50 === undefined || baseline.p50 === undefined) return undefined;
	return round3(current.p50 - baseline.p50);
}

function clampScore(value: number): number {
	return Math.min(100, Math.max(0, value));
}

function finiteNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function numberField(record: Record<string, unknown>, key: string): number {
	const value = record[key];
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function stateWindowNumber(afterValue: unknown, beforeValue: unknown): number | undefined {
	const after = finiteNumber(afterValue);
	if (after === undefined) return undefined;
	const before = finiteNumber(beforeValue);
	if (before === undefined || before <= 0 || after < before) return after;
	return round3(after - before);
}

function elapsedIsoMs(startedAt: unknown, value: unknown): number | undefined {
	if (typeof startedAt !== "string" || typeof value !== "string") return undefined;
	const start = Date.parse(startedAt);
	const end = Date.parse(value);
	if (!Number.isFinite(start) || !Number.isFinite(end)) return undefined;
	return round3(end - start);
}

function round3(value: number): number {
	return Math.round(value * 1000) / 1000;
}

async function writeLastSnapshot(snapshot: WebSnapshot | undefined): Promise<void> {
	if (!snapshot) return;
	const file = lastSnapshotPath();
	await mkdir(path.dirname(file), { recursive: true });
	await writeFile(file, JSON.stringify(snapshot, null, 2), "utf-8");
}

async function readBaselineSnapshot(file?: string): Promise<WebSnapshot> {
	const target = file ?? lastSnapshotPath();
	let text: string;
	try {
		text = await readFile(target, "utf-8");
	} catch {
		throw new Error(`Baseline snapshot not found at ${target}. Run pibo debug web snapshot first or pass --from <artifact>.`);
	}
	const parsed = JSON.parse(text) as unknown;
	if (isSnapshot(parsed)) return parsed;
	if (isRecord(parsed) && isSnapshot(parsed.snapshot)) return parsed.snapshot;
	if (isRecord(parsed) && isSnapshot(parsed.current)) return parsed.current;
	throw new Error(`File is not a web render snapshot: ${target}`);
}

async function writeArtifact(kind: string, payload: unknown): Promise<string> {
	return writeTextArtifact(kind, "json", JSON.stringify(payload, null, 2));
}

async function writeTextArtifact(kind: string, extension: string, content: string): Promise<string> {
	const stamp = new Date().toISOString().replace(/[:.]/g, "-");
	const dir = path.join(getPiboHome(), "debug", "web-render", stamp);
	await mkdir(dir, { recursive: true });
	const file = path.join(dir, `${kind}.${extension}`);
	await writeFile(file, content, "utf-8");
	return file;
}

async function writeReportOutput(outputPath: string, content: string): Promise<string> {
	const file = path.resolve(outputPath);
	await mkdir(path.dirname(file), { recursive: true });
	await writeFile(file, content, "utf-8");
	return file;
}

function lastSnapshotPath(): string {
	return path.join(getPiboHome(), "debug", "web-render", "last-snapshot.json");
}

function compactTarget(target: BrowserUseCdpTarget | { id: string; url: string; title: string; webSocketDebuggerUrl?: string }): Record<string, unknown> {
	return { id: target.id, url: target.url, title: target.title, webSocketDebuggerUrl: target.webSocketDebuggerUrl };
}

function limitStdout(value: string): string {
	if (value.length <= STDOUT_BUDGET) return value;
	return `${value.slice(0, STDOUT_BUDGET)}\n... truncated ${value.length - STDOUT_BUDGET} chars by stdout budget ...`;
}

function isSnapshot(value: unknown): value is WebSnapshot {
	return isRecord(value) && value.kind === "snapshot" && typeof value.scope === "string" && Array.isArray(value.nodes);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isWebSocketUrl(value?: string): boolean {
	return Boolean(value && /^wss?:\/\//.test(value));
}

function jsonShort(value: unknown): string {
	if (value === undefined) return "undefined";
	const text = typeof value === "string" ? value : JSON.stringify(value);
	return text.length > 90 ? `${text.slice(0, 89)}…` : text;
}

function shellQuote(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}
