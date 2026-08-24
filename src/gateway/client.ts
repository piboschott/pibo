import { randomUUID } from "node:crypto";
import { connect, type Socket } from "node:net";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import {
	DEFAULT_GATEWAY_HOST,
	DEFAULT_GATEWAY_PORT,
	encodeFrame,
	type GatewayFrame,
	type GatewayRequestFrame,
	type GatewayResponseFrame,
	type GatewaySubscribeFrame,
} from "./protocol.js";
import type {
	PiboInputEvent,
	PiboMessageDelivery,
	PiboMessageQueuedEvent,
	PiboMessageStartedEvent,
	PiboOutputEvent,
	PiboSessionStatus,
} from "../core/events.js";
import { parsePiboThinkingLevel } from "../core/thinking.js";

export type GatewayClientOptions = {
	host?: string;
	port?: number;
	piboSessionId?: string;
};

export type GatewayClientMessageParseResult =
	| { ok: true; text: string; delivery?: PiboMessageDelivery }
	| { ok: false; error: string };

type GatewayClientRenderState = {
	visibleIncomingEventIds: Set<string>;
	sawAssistantDelta: boolean;
	showThinking: boolean;
	sawThinkingDelta: boolean;
};

export function parseGatewayClientMessage(value: string): GatewayClientMessageParseResult {
	const text = value.trim();
	if (!text) return { ok: false, error: "Message text is required" };
	const command = /^\/(queue|steer)(?:\s+|$)/.exec(text);
	if (!command) return { ok: true, text };
	const delivery = command[1] as PiboMessageDelivery;
	const message = text.slice(command[0].length).trim();
	return message
		? { ok: true, text: message, delivery }
		: { ok: false, error: `Usage: /${delivery} <message>` };
}

export function createGatewayClientRequestFrame(event: PiboInputEvent): GatewayRequestFrame {
	const id = randomUUID();
	return { type: "req", id, event: { ...event, id: event.id ?? id } };
}

export function createGatewayClientSubscriptionFrame(piboSessionId: string): GatewaySubscribeFrame {
	return {
		type: "subscribe",
		id: randomUUID(),
		subscription: { type: "session", piboSessionId },
	};
}

function parseJsonLine(line: string): GatewayFrame | undefined {
	try {
		return JSON.parse(line) as GatewayFrame;
	} catch {
		return undefined;
	}
}

function writeFrame(socket: Socket, frame: GatewayFrame): void {
	socket.write(encodeFrame(frame));
}

function printResponse(frame: GatewayResponseFrame): void {
	if (!frame.ok) {
		console.error(`\nerror: ${frame.error?.message ?? "request failed"}`);
		return;
	}
	if (!frame.payload || typeof frame.payload !== "object") return;
	const payload = frame.payload as { type?: unknown; activeEventId?: unknown };
	if (payload.type !== "message_steered") return;
	const target = typeof payload.activeEventId === "string" && payload.activeEventId.length > 0
		? ` active turn ${payload.activeEventId}`
		: " the active turn";
	console.error(`steer: delivered to${target}`);
}

function printGatewayClientHelp(): void {
	console.error("messages queue by default; /queue <message> queues explicitly; /steer <message> steers the active turn");
	console.error("commands: /status, /clear, /abort, /thinking [level], /thinking-show, /goal [command], /help, /quit");
}

function isSessionStatus(value: unknown): value is PiboSessionStatus {
	if (!value || typeof value !== "object") return false;
	const candidate = value as { piboSessionId?: unknown; queuedMessages?: unknown; processing?: unknown };
	return (
		typeof candidate.piboSessionId === "string" &&
		typeof candidate.queuedMessages === "number" &&
		typeof candidate.processing === "boolean"
	);
}

function printExecutionResult(event: Extract<PiboOutputEvent, { type: "execution_result" }>): void {
	if (event.action === "status" && isSessionStatus(event.result)) {
		console.error(
			`status: session=${event.result.piboSessionId} queued=${event.result.queuedMessages} processing=${event.result.processing} streaming=${event.result.streaming}`,
		);
		return;
	}

	if (event.action === "clear_queue" && event.result && typeof event.result === "object") {
		const cleared = (event.result as { cleared?: unknown }).cleared;
		console.error(`clear: removed ${typeof cleared === "number" ? cleared : 0} queued message(s)`);
		return;
	}

	console.error(`${event.action}: ${JSON.stringify(event.result)}`);
}

function printIncomingMessage(
	event: PiboMessageQueuedEvent | PiboMessageStartedEvent,
	state: GatewayClientRenderState,
): void {
	if (event.source === "user") return;
	if (event.eventId && state.visibleIncomingEventIds.has(event.eventId)) return;
	if (event.eventId) state.visibleIncomingEventIds.add(event.eventId);

	const source = event.source ?? "external";
	console.error(`\nincoming ${source}> ${event.text}`);
}

function printEvent(frame: GatewayFrame, piboSessionId: string, state: GatewayClientRenderState): void {
	if (frame.type !== "event" || frame.event !== "router") return;

	const event = frame.payload;
	if (event.piboSessionId !== piboSessionId) return;

	if (event.type === "message_queued") {
		printIncomingMessage(event, state);
		return;
	}
	if (event.type === "assistant_delta") {
		state.sawAssistantDelta = true;
		output.write(event.text);
		return;
	}
	if (event.type === "thinking_started") {
		state.sawThinkingDelta = false;
		if (state.showThinking) output.write("\nthinking> ");
		return;
	}
	if (event.type === "thinking_delta") {
		if (!state.showThinking) return;
		state.sawThinkingDelta = true;
		output.write(event.text);
		return;
	}
	if (event.type === "thinking_finished") {
		if (!state.showThinking) return;
		if (!state.sawThinkingDelta && event.text) output.write(event.text);
		state.sawThinkingDelta = false;
		output.write("\n");
		return;
	}
	if (event.type === "assistant_message") {
		if (!state.sawAssistantDelta) {
			output.write(event.text);
		}
		state.sawAssistantDelta = false;
		output.write("\n");
		return;
	}
	if (event.type === "session_error") {
		console.error(`\nsession error: ${event.error}`);
		return;
	}
	if (event.type === "execution_result") {
		printExecutionResult(event);
		return;
	}
	if (event.type === "message_started") {
		state.sawAssistantDelta = false;
		printIncomingMessage(event, state);
		output.write("assistant> ");
	}
}

function isExpectedSubscriptionResponse(frame: GatewayResponseFrame, piboSessionId: string): boolean {
	if (!frame.payload || typeof frame.payload !== "object") return false;
	const payload = frame.payload as { subscription?: { type?: unknown; piboSessionId?: unknown } };
	return payload.subscription?.type === "session" && payload.subscription.piboSessionId === piboSessionId;
}

function handleGatewayClientLine(
	value: string,
	sendRequest: (event: PiboInputEvent) => void,
	piboSessionId: string,
	renderState: GatewayClientRenderState,
): "continue" | "quit" | "error" {
	const text = value.trim();
	if (!text) return "continue";
	if (text === "/quit" || text === "/exit") return "quit";
	if (text === "/help") {
		printGatewayClientHelp();
		return "continue";
	}
	if (text === "/thinking-show") {
		renderState.showThinking = !renderState.showThinking;
		console.error(`thinking display: ${renderState.showThinking ? "on" : "off"}`);
		return "continue";
	}

	if (text === "/thinking" || text.startsWith("/thinking ")) {
		const level = text.slice("/thinking".length).trim();
		let params: { level: ReturnType<typeof parsePiboThinkingLevel> } | undefined;
		try {
			params = level ? { level: parsePiboThinkingLevel(level) } : undefined;
		} catch (error) {
			console.error(error instanceof Error ? error.message : String(error));
			return "error";
		}
		sendRequest(
			params === undefined
				? { type: "execution", piboSessionId, action: "thinking" }
				: { type: "execution", piboSessionId, action: "thinking", params },
		);
		return "continue";
	}

	if (text === "/status" || text === "/clear" || text === "/abort") {
		const action = text === "/status" ? "status" : text === "/clear" ? "clear_queue" : "abort";
		sendRequest({ type: "execution", piboSessionId, action });
		return "continue";
	}

	if (text === "/goal" || text.startsWith("/goal ")) {
		sendRequest({
			type: "execution",
			piboSessionId,
			action: "goal",
			params: { command: text.slice("/goal".length).trim() },
		});
		return "continue";
	}

	const message = parseGatewayClientMessage(text);
	if (!message.ok) {
		console.error(message.error);
		return "error";
	}
	sendRequest({
		type: "message",
		piboSessionId,
		text: message.text,
		source: "user",
		...(message.delivery ? { delivery: message.delivery } : {}),
	});
	return "continue";
}

export async function runGatewayClient(options: GatewayClientOptions = {}): Promise<void> {
	const interactive = input.isTTY === true && output.isTTY === true;
	const host = options.host ?? DEFAULT_GATEWAY_HOST;
	const port = options.port ?? DEFAULT_GATEWAY_PORT;
	const piboSessionId = (options.piboSessionId ?? "default").trim();
	if (!piboSessionId) throw new Error("Pibo Session ID must not be empty");
	const socket = connect({ host, port });
	socket.setEncoding("utf-8");

	await new Promise<void>((resolve, reject) => {
		const onError = (error: Error) => reject(error);
		socket.once("error", onError);
		socket.once("connect", () => {
			socket.off("error", onError);
			resolve();
		});
	});

	let buffer = "";
	let closing = false;
	let connectionFailure: Error | undefined;
	let rl: ReturnType<typeof readline.createInterface> | undefined;
	const renderState: GatewayClientRenderState = {
		visibleIncomingEventIds: new Set<string>(),
		sawAssistantDelta: false,
		showThinking: false,
		sawThinkingDelta: false,
	};
	const pendingRequestIds = new Set<string>();
	let pipedInputFailed = false;
	let settlePendingResponses: ((error?: Error) => void) | undefined;
	let pendingResponseTimeout: ReturnType<typeof setTimeout> | undefined;
	const finishPendingResponses = (error?: Error): void => {
		const settle = settlePendingResponses;
		if (!settle) return;
		settlePendingResponses = undefined;
		if (pendingResponseTimeout) clearTimeout(pendingResponseTimeout);
		settle(error);
	};
	const waitForPendingResponses = async (): Promise<void> => {
		if (connectionFailure) throw connectionFailure;
		if (pendingRequestIds.size === 0) return;
		await new Promise<void>((resolve, reject) => {
			settlePendingResponses = (error) => error ? reject(error) : resolve();
			pendingResponseTimeout = setTimeout(() => {
				finishPendingResponses(new Error(`Timed out waiting for ${pendingRequestIds.size} gateway response(s)`));
			}, 5_000);
		});
	};
	const sendRequest = (event: PiboInputEvent): void => {
		const frame = createGatewayClientRequestFrame(event);
		pendingRequestIds.add(frame.id);
		writeFrame(socket, frame);
	};
	const subscriptionFrame = createGatewayClientSubscriptionFrame(piboSessionId);
	let subscribed = false;
	let settleSubscription: ((error?: Error) => void) | undefined;
	let subscriptionTimeout: ReturnType<typeof setTimeout> | undefined;
	const subscription = new Promise<void>((resolve, reject) => {
		settleSubscription = (error) => error ? reject(error) : resolve();
	});
	const finishSubscription = (error?: Error): void => {
		const settle = settleSubscription;
		if (!settle) return;
		settleSubscription = undefined;
		if (subscriptionTimeout) clearTimeout(subscriptionTimeout);
		settle(error);
	};
	subscriptionTimeout = setTimeout(() => {
		finishSubscription(new Error(`Timed out subscribing to Pibo Session "${piboSessionId}"`));
	}, 5_000);

	const failConnection = (error: Error): void => {
		if (!subscribed) {
			finishSubscription(error);
			return;
		}
		if (closing || connectionFailure) return;
		connectionFailure = error;
		finishPendingResponses(error);
		rl?.close();
	};

	socket.on("error", (error) => failConnection(error));
	socket.on("close", () => failConnection(new Error("Gateway connection closed")));
	socket.on("data", (chunk) => {
		buffer += chunk;
		let newlineIndex = buffer.indexOf("\n");
		while (newlineIndex !== -1) {
			const line = buffer.slice(0, newlineIndex).trim();
			buffer = buffer.slice(newlineIndex + 1);
			const frame = line ? parseJsonLine(line) : undefined;
			if (frame?.type === "res" && frame.id === subscriptionFrame.id) {
				if (!frame.ok) {
					finishSubscription(new Error(frame.error?.message ?? "Gateway rejected the session subscription"));
				} else if (!isExpectedSubscriptionResponse(frame, piboSessionId)) {
					finishSubscription(new Error("Gateway returned a mismatched session subscription"));
				} else {
					subscribed = true;
					finishSubscription();
				}
			} else if (subscribed && frame?.type === "res") {
				printResponse(frame);
				if (pendingRequestIds.delete(frame.id)) {
					if (!frame.ok && !interactive) pipedInputFailed = true;
					if (pendingRequestIds.size === 0) finishPendingResponses();
				}
			} else if (subscribed && frame?.type === "event") {
				printEvent(frame, piboSessionId, renderState);
			}
			newlineIndex = buffer.indexOf("\n");
		}
	});

	writeFrame(socket, subscriptionFrame);
	try {
		await subscription;
	} catch (error) {
		closing = true;
		socket.destroy();
		throw error;
	}
	if (connectionFailure || socket.destroyed) {
		closing = true;
		socket.destroy();
		throw connectionFailure ?? new Error("Gateway connection closed");
	}

	console.error(`connected to pibo gateway at ${host}:${port}`);
	console.error(`session: ${piboSessionId}`);
	printGatewayClientHelp();

	rl = readline.createInterface({ input, output, terminal: interactive });
	if (interactive) {
		rl.setPrompt("you> ");
		rl.prompt();
	}
	try {
		for await (const line of rl) {
			const result = handleGatewayClientLine(line, sendRequest, piboSessionId, renderState);
			if (result === "error" && !interactive) pipedInputFailed = true;
			if (result === "quit") break;
			if (interactive && !socket.destroyed) rl.prompt();
		}
		if (!interactive) await waitForPendingResponses();
	} finally {
		closing = true;
		rl.close();
		socket.end();
	}
	if (connectionFailure) throw connectionFailure;
	if (!interactive && pipedInputFailed) process.exitCode = 1;
}
