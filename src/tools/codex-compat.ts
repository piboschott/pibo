import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { readFile } from "node:fs/promises";
import { extname, isAbsolute, resolve } from "node:path";
import { StringEnum, Type } from "@mariozechner/pi-ai";
import { defineTool, type ToolDefinition } from "@mariozechner/pi-coding-agent";
import type { SubagentProfile } from "../core/profiles.js";
import type { PiboSubagentRunner } from "../subagents/tool.js";

type ExecSession = {
	id: number;
	child: ChildProcessWithoutNullStreams;
	output: string;
	closed: boolean;
	exitCode: number | null;
	signal: NodeJS.Signals | null;
};

type AgentHandle = {
	id: string;
	role: string;
	threadKey: string;
	status: "running" | "completed" | "failed" | "closed";
	message: string;
	result?: unknown;
	text?: string;
	error?: string;
	promise: Promise<void>;
};

const DEFAULT_YIELD_MS = 1000;
const DEFAULT_MAX_OUTPUT_CHARS = 20000;
const MAX_WAIT_MS = 300000;

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

function textFromItems(items: unknown): string {
	if (!Array.isArray(items)) return "";
	return items
		.map((item) => {
			if (!item || typeof item !== "object") return "";
			const value = item as { text?: unknown; name?: unknown; type?: unknown };
			if (typeof value.text === "string") return value.text;
			if (typeof value.name === "string") return value.name;
			return typeof value.type === "string" ? `[${value.type}]` : "";
		})
		.filter(Boolean)
		.join("\n");
}

function summarizeHandle(handle: AgentHandle): Record<string, unknown> {
	return {
		agent_id: handle.id,
		agent_type: handle.role,
		status: handle.status,
		message: handle.status === "completed" ? handle.text : handle.error,
		result: handle.result,
	};
}

function findSubagent(subagents: readonly SubagentProfile[], role: string): SubagentProfile {
	const subagent = subagents.find((candidate) => candidate.name === role);
	if (!subagent) {
		throw new Error(`Unknown codex-compatible subagent role "${role}"`);
	}
	return subagent;
}

function startAgentRun(
	handles: Map<string, AgentHandle>,
	runner: PiboSubagentRunner,
	subagents: readonly SubagentProfile[],
	role: string,
	message: string,
): AgentHandle {
	const id = `agent_${handles.size + 1}`;
	const threadKey = id;
	const subagent = findSubagent(subagents, role);
	const handle: AgentHandle = {
		id,
		role,
		threadKey,
		status: "running",
		message,
		promise: Promise.resolve(),
	};
	handle.promise = runner.runSubagent({ subagent, message, threadKey }).then(
		(result) => {
			handle.status = "completed";
			handle.result = result;
			handle.text = result.reply.text;
		},
		(error) => {
			handle.status = "failed";
			handle.error = error instanceof Error ? error.message : String(error);
		},
	);
	handles.set(id, handle);
	return handle;
}

async function continueAgentRun(
	handle: AgentHandle,
	runner: PiboSubagentRunner,
	subagents: readonly SubagentProfile[],
	message: string,
): Promise<void> {
	if (handle.status === "closed") throw new Error(`Agent "${handle.id}" is closed`);
	handle.status = "running";
	handle.message = message;
	const subagent = findSubagent(subagents, handle.role);
	handle.promise = runner.runSubagent({ subagent, message, threadKey: handle.threadKey }).then(
		(result) => {
			handle.status = "completed";
			handle.result = result;
			handle.text = result.reply.text;
			handle.error = undefined;
		},
		(error) => {
			handle.status = "failed";
			handle.error = error instanceof Error ? error.message : String(error);
		},
	);
	await handle.promise;
}

export function createCodexCompatToolDefinitions(options: {
	subagents: readonly SubagentProfile[];
	subagentRunner?: PiboSubagentRunner;
}): ToolDefinition[] {
	const execSessions = new Map<number, ExecSession>();
	const agentHandles = new Map<string, AgentHandle>();
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

	const spawnAgent = defineTool({
		name: "spawn_agent",
		label: "Spawn Agent",
		description: "Starts a delegated child agent with a Codex-compatible role.",
		promptSnippet: "Use spawn_agent for bounded parallel delegation to default, explorer, or worker roles.",
		executionMode: "parallel",
		parameters: Type.Object({
			agent_type: Type.Optional(StringEnum(["default", "explorer", "worker"], { description: "Subagent role." })),
			message: Type.Optional(Type.String({ description: "Initial task for the child agent." })),
			fork_context: Type.Optional(Type.Boolean({ description: "Accepted for compatibility; Pibo creates a routed child session." })),
			items: Type.Optional(Type.Array(Type.Any({ description: "Structured input items." }))),
		}),
		async execute(_toolCallId, params) {
			if (!options.subagentRunner) throw new Error("spawn_agent requires a routed Pibo runtime");
			const role = params.agent_type ?? "default";
			const message = params.message ?? textFromItems(params.items);
			if (!message.trim()) throw new Error("spawn_agent requires a message or text items");
			const handle = startAgentRun(agentHandles, options.subagentRunner, options.subagents, role, message);
			return {
				content: [{ type: "text", text: JSON.stringify({ agent_id: handle.id, status: handle.status }, null, 2) }],
				details: summarizeHandle(handle),
			};
		},
	});

	const sendInput = defineTool({
		name: "send_input",
		label: "Send Input",
		description: "Sends a follow-up message to an existing delegated child agent.",
		promptSnippet: "Use send_input to continue a delegated agent thread by target agent id.",
		executionMode: "parallel",
		parameters: Type.Object({
			target: Type.String({ description: "Agent id returned by spawn_agent." }),
			message: Type.Optional(Type.String({ description: "Follow-up task or clarification." })),
			interrupt: Type.Optional(Type.Boolean({ description: "Accepted for compatibility; the message is queued as a new child turn." })),
			items: Type.Optional(Type.Array(Type.Any({ description: "Structured input items." }))),
		}),
		async execute(_toolCallId, params) {
			if (!options.subagentRunner) throw new Error("send_input requires a routed Pibo runtime");
			const handle = agentHandles.get(params.target);
			if (!handle) throw new Error(`Unknown agent "${params.target}"`);
			const message = params.message ?? textFromItems(params.items);
			if (!message.trim()) throw new Error("send_input requires a message or text items");
			void continueAgentRun(handle, options.subagentRunner, options.subagents, message).catch(() => undefined);
			return {
				content: [{ type: "text", text: JSON.stringify({ agent_id: handle.id, status: handle.status }, null, 2) }],
				details: summarizeHandle(handle),
			};
		},
	});

	const resumeAgent = defineTool({
		name: "resume_agent",
		label: "Resume Agent",
		description: "Returns the current handle state for a delegated child agent.",
		promptSnippet: "Use resume_agent to inspect an existing delegated agent handle.",
		executionMode: "parallel",
		parameters: Type.Object({
			id: Type.String({ description: "Agent id returned by spawn_agent." }),
		}),
		async execute(_toolCallId, params) {
			const handle = agentHandles.get(params.id);
			if (!handle) throw new Error(`Unknown agent "${params.id}"`);
			return {
				content: [{ type: "text", text: JSON.stringify(summarizeHandle(handle), null, 2) }],
				details: summarizeHandle(handle),
			};
		},
	});

	const waitAgent = defineTool({
		name: "wait_agent",
		label: "Wait Agent",
		description: "Waits for one or more delegated child agents to reach a terminal status.",
		promptSnippet: "Use wait_agent only when blocked on delegated agent results.",
		executionMode: "parallel",
		parameters: Type.Object({
			targets: Type.Array(Type.String({ description: "Agent ids to wait on." })),
			timeout_ms: Type.Optional(Type.Number({ description: "Maximum wait in milliseconds." })),
		}),
		async execute(_toolCallId, params) {
			const timeoutMs = Math.min(Math.max(0, params.timeout_ms ?? 30000), MAX_WAIT_MS);
			const handles = params.targets.map((target) => {
				const handle = agentHandles.get(target);
				if (!handle) throw new Error(`Unknown agent "${target}"`);
				return handle;
			});
			await Promise.race([
				Promise.all(handles.map((handle) => handle.promise)),
				new Promise((resolveWait) => setTimeout(resolveWait, timeoutMs)),
			]);
			const details = handles.map(summarizeHandle);
			return {
				content: [{ type: "text", text: JSON.stringify({ agents: details }, null, 2) }],
				details: { agents: details },
			};
		},
	});

	const closeAgent = defineTool({
		name: "close_agent",
		label: "Close Agent",
		description: "Closes a delegated child agent handle so it will not receive more input.",
		promptSnippet: "Use close_agent when a delegated agent handle is no longer needed.",
		executionMode: "parallel",
		parameters: Type.Object({
			target: Type.String({ description: "Agent id returned by spawn_agent." }),
		}),
		async execute(_toolCallId, params) {
			const handle = agentHandles.get(params.target);
			if (!handle) throw new Error(`Unknown agent "${params.target}"`);
			const previous = summarizeHandle(handle);
			handle.status = "closed";
			return {
				content: [{ type: "text", text: JSON.stringify({ previous }, null, 2) }],
				details: { previous },
			};
		},
	});

	return [
		execCommand,
		writeStdin,
		applyPatch,
		viewImage,
		spawnAgent,
		sendInput,
		resumeAgent,
		waitAgent,
		closeAgent,
	];
}
