import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { readFile } from "node:fs/promises";
import { extname, isAbsolute, resolve } from "node:path";
import { StringEnum, Type } from "@mariozechner/pi-ai";
import { defineTool, type ToolDefinition } from "@mariozechner/pi-coding-agent";

type ExecSession = {
	id: number;
	child: ChildProcessWithoutNullStreams;
	output: string;
	closed: boolean;
	exitCode: number | null;
	signal: NodeJS.Signals | null;
};

const DEFAULT_YIELD_MS = 1000;
const DEFAULT_MAX_OUTPUT_CHARS = 20000;
const WEB_SEARCH_TIMEOUT_MS = 12000;
const WEB_SEARCH_LIMITS = {
	short: 3,
	medium: 5,
	long: 8,
} as const;

function truncate(value: string, maxChars: number): string {
	if (value.length <= maxChars) return value;
	return `${value.slice(0, maxChars)}\n[truncated ${value.length - maxChars} chars]`;
}

function resolveCwd(baseCwd: string, workdir: string | undefined): string {
	if (!workdir || workdir.trim().length === 0) return baseCwd;
	return isAbsolute(workdir) ? workdir : resolve(baseCwd, workdir);
}

function outputSince(session: ExecSession, offset: number, maxChars: number): string {
	return truncate(session.output.slice(offset), maxChars);
}

function waitForProcess(session: ExecSession, timeoutMs: number): Promise<"closed" | "timeout"> {
	if (session.closed) return Promise.resolve("closed");
	return new Promise((resolveWait) => {
		const timeout = setTimeout(() => {
			cleanup();
			resolveWait("timeout");
		}, Math.max(0, timeoutMs));
		const onClose = () => {
			cleanup();
			resolveWait("closed");
		};
		const cleanup = () => {
			clearTimeout(timeout);
			session.child.off("close", onClose);
		};
		session.child.once("close", onClose);
	});
}

function mimeTypeForPath(path: string): string {
	switch (extname(path).toLowerCase()) {
		case ".jpg":
		case ".jpeg":
			return "image/jpeg";
		case ".webp":
			return "image/webp";
		case ".gif":
			return "image/gif";
		default:
			return "image/png";
	}
}

function decodeHtml(value: string): string {
	return value
		.replace(/&amp;/g, "&")
		.replace(/&quot;/g, "\"")
		.replace(/&#39;/g, "'")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/<[^>]+>/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

function stripDuckDuckGoRedirect(url: string): string {
	const normalized = url.startsWith("//") ? `https:${url}` : url;
	try {
		const parsed = new URL(normalized);
		const redirected = parsed.searchParams.get("uddg");
		return redirected ? decodeURIComponent(redirected) : normalized;
	} catch {
		return normalized;
	}
}

function withDomainFilters(query: string, domains: readonly string[] | undefined): string {
	if (!domains?.length) return query;
	const filters = domains.map((domain) => `site:${domain}`).join(" OR ");
	return `${query} ${filters}`;
}

function webSearchLimit(value: string | undefined): number {
	return value === "short" || value === "medium" || value === "long"
		? WEB_SEARCH_LIMITS[value]
		: WEB_SEARCH_LIMITS.medium;
}

function parseDuckDuckGoResults(html: string, limit: number): Array<{ title: string; url: string; snippet: string }> {
	const results: Array<{ title: string; url: string; snippet: string }> = [];
	const resultPattern =
		/<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;

	for (const match of html.matchAll(resultPattern)) {
		const url = stripDuckDuckGoRedirect(decodeHtml(match[1]));
		if (!/^https?:\/\//.test(url)) continue;
		results.push({
			title: decodeHtml(match[2]),
			url,
			snippet: decodeHtml(match[3]),
		});
		if (results.length >= limit) break;
	}

	return results;
}

async function fetchWebSearchResults(
	query: string,
	limit: number,
	signal: AbortSignal | undefined,
): Promise<Array<{ title: string; url: string; snippet: string }>> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), WEB_SEARCH_TIMEOUT_MS);
	const abort = () => controller.abort();
	signal?.addEventListener("abort", abort, { once: true });

	try {
		const url = `https://html.duckduckgo.com/html/?${new URLSearchParams({ q: query }).toString()}`;
		const response = await fetch(url, {
			headers: {
				"user-agent": "Pibo/0.1 web_search",
				accept: "text/html",
			},
			signal: controller.signal,
		});
		if (!response.ok) throw new Error(`Search request failed with HTTP ${response.status}`);
		return parseDuckDuckGoResults(await response.text(), limit);
	} finally {
		clearTimeout(timeout);
		signal?.removeEventListener("abort", abort);
	}
}

export function createCodexCompatToolDefinitions(): ToolDefinition[] {
	const execSessions = new Map<number, ExecSession>();
	let nextExecSessionId = 1;

	const execCommand = defineTool({
		name: "exec_command",
		label: "Exec Command",
		description:
			"Runs a shell command, returning output immediately or a session_id for ongoing interaction.",
		promptSnippet:
			"Use exec_command for shell commands. Long-running commands return a session_id; continue them with write_stdin.",
		executionMode: "parallel",
		parameters: Type.Object({
			cmd: Type.String({ description: "Shell command to execute." }),
			workdir: Type.Optional(Type.String({ description: "Working directory. Defaults to the runtime cwd." })),
			yield_time_ms: Type.Optional(Type.Number({ description: "Milliseconds to wait before yielding." })),
			max_output_tokens: Type.Optional(Type.Number({ description: "Approximate maximum output characters to return." })),
			shell: Type.Optional(Type.String({ description: "Shell binary. Defaults to bash." })),
			login: Type.Optional(Type.Boolean({ description: "Use login shell semantics when supported." })),
			tty: Type.Optional(Type.Boolean({ description: "Accepted for compatibility; execution is pipe-backed." })),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const cwd = resolveCwd(ctx.cwd, params.workdir);
			const shell = params.shell ?? "bash";
			const shellArgs = params.login === false ? ["-c", params.cmd] : ["-lc", params.cmd];
			const child = spawn(shell, shellArgs, { cwd, env: process.env, stdio: "pipe" });
			const session: ExecSession = {
				id: nextExecSessionId++,
				child,
				output: "",
				closed: false,
				exitCode: null,
				signal: null,
			};
			const startedOffset = session.output.length;
			const maxChars = Math.max(0, params.max_output_tokens ?? DEFAULT_MAX_OUTPUT_CHARS);
			const abort = () => child.kill("SIGTERM");

			signal?.addEventListener("abort", abort, { once: true });
			child.stdout.on("data", (chunk) => {
				session.output += String(chunk);
			});
			child.stderr.on("data", (chunk) => {
				session.output += String(chunk);
			});
			child.once("close", (exitCode, exitSignal) => {
				session.closed = true;
				session.exitCode = exitCode;
				session.signal = exitSignal;
				signal?.removeEventListener("abort", abort);
			});

			const state = await waitForProcess(session, params.yield_time_ms ?? DEFAULT_YIELD_MS);
			if (state === "timeout") {
				execSessions.set(session.id, session);
				return {
					content: [{ type: "text", text: outputSince(session, startedOffset, maxChars) }],
					details: { session_id: session.id, running: true, cwd },
				};
			}

			return {
				content: [{ type: "text", text: outputSince(session, startedOffset, maxChars) }],
				details: { exitCode: session.exitCode, signal: session.signal, cwd },
				isError: session.exitCode !== 0,
			};
		},
	});

	const writeStdin = defineTool({
		name: "write_stdin",
		label: "Write Stdin",
		description: "Writes characters to an existing exec_command session and returns recent output.",
		promptSnippet: "Use write_stdin to continue an exec_command session returned with session_id.",
		executionMode: "parallel",
		parameters: Type.Object({
			session_id: Type.Number({ description: "Identifier returned by exec_command." }),
			chars: Type.Optional(Type.String({ description: "Bytes to write to stdin." })),
			yield_time_ms: Type.Optional(Type.Number({ description: "Milliseconds to wait for output." })),
			max_output_tokens: Type.Optional(Type.Number({ description: "Approximate maximum output characters to return." })),
		}),
		async execute(_toolCallId, params) {
			const session = execSessions.get(params.session_id);
			if (!session) throw new Error(`Unknown exec_command session "${params.session_id}"`);
			const offset = session.output.length;
			if (params.chars !== undefined) session.child.stdin.write(params.chars);
			await waitForProcess(session, params.yield_time_ms ?? DEFAULT_YIELD_MS);
			return {
				content: [{ type: "text", text: outputSince(session, offset, params.max_output_tokens ?? DEFAULT_MAX_OUTPUT_CHARS) }],
				details: {
					session_id: session.id,
					running: !session.closed,
					exitCode: session.exitCode,
					signal: session.signal,
				},
				isError: session.closed && session.exitCode !== 0,
			};
		},
	});

	const applyPatch = defineTool({
		name: "apply_patch",
		label: "Apply Patch",
		description: "Applies a Codex-style patch to files in the workspace.",
		promptSnippet: "Use apply_patch for manual file edits by passing the complete patch text.",
		executionMode: "sequential",
		parameters: Type.Object({
			patch: Type.String({ description: "Patch text starting with *** Begin Patch and ending with *** End Patch." }),
			workdir: Type.Optional(Type.String({ description: "Working directory. Defaults to the runtime cwd." })),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const cwd = resolveCwd(ctx.cwd, params.workdir);
			const result = await new Promise<{ exitCode: number | null; output: string }>((resolveApply, reject) => {
				const child = spawn("apply_patch", [], { cwd, env: process.env, stdio: "pipe" });
				let output = "";
				const abort = () => child.kill("SIGTERM");
				signal?.addEventListener("abort", abort, { once: true });
				child.stdout.on("data", (chunk) => {
					output += String(chunk);
				});
				child.stderr.on("data", (chunk) => {
					output += String(chunk);
				});
				child.once("error", reject);
				child.once("close", (exitCode) => {
					signal?.removeEventListener("abort", abort);
					resolveApply({ exitCode, output });
				});
				child.stdin.end(params.patch);
			});

			return {
				content: [{ type: "text", text: result.output }],
				details: { exitCode: result.exitCode, cwd },
				isError: result.exitCode !== 0,
			};
		},
	});

	const viewImage = defineTool({
		name: "view_image",
		label: "View Image",
		description: "Reads a local image file and returns it as an inline image result.",
		promptSnippet: "Use view_image to inspect a local image path when visual details matter.",
		executionMode: "parallel",
		parameters: Type.Object({
			path: Type.String({ description: "Local filesystem path to an image file." }),
			detail: Type.Optional(StringEnum(["original"], { description: "Use original resolution when set." })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const path = resolveCwd(ctx.cwd, params.path);
			const data = await readFile(path);
			return {
				content: [{ type: "image", data: data.toString("base64"), mimeType: mimeTypeForPath(path) }],
				details: { path, detail: params.detail },
			};
		},
	});

	const webSearch = defineTool({
		name: "web_search",
		label: "Web Search",
		description: "Searches the web and returns compact result titles, URLs, and snippets.",
		promptSnippet: "Use web_search when current or externally sourced information is needed.",
		executionMode: "parallel",
		parameters: Type.Object({
			search_query: Type.Array(Type.Object({
				q: Type.String({ description: "Search query." }),
				recency: Type.Optional(Type.Number({ description: "Accepted for compatibility; currently not enforced." })),
				domains: Type.Optional(Type.Array(Type.String({ description: "Domains to prefer via site: filters." }))),
			})),
			response_length: Type.Optional(StringEnum(["short", "medium", "long"], { description: "Number of results to return per query." })),
		}),
		async execute(_toolCallId, params, signal) {
			const limit = webSearchLimit(params.response_length);
			const searches = await Promise.all(params.search_query.map(async (item) => {
				const query = withDomainFilters(item.q, item.domains);
				const results = await fetchWebSearchResults(query, limit, signal);
				return {
					query: item.q,
					recency: item.recency,
					domains: item.domains,
					results,
				};
			}));

			const text = searches
				.map((search) => {
					const lines = search.results.map((result, index) =>
						`${index + 1}. ${result.title}\n${result.url}\n${result.snippet}`,
					);
					return [`Query: ${search.query}`, ...lines].join("\n");
				})
				.join("\n\n");

			return {
				content: [{ type: "text", text: text || "No search results found." }],
				details: { searches },
			};
		},
	});

	return [
		execCommand,
		writeStdin,
		applyPatch,
		webSearch,
		viewImage,
	];
}
