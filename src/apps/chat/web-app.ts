import { randomUUID } from "node:crypto";
import type { PiboOutputEvent } from "../../core/events.js";
import { PiboWebHttpError, readJsonBody, responseHtml, responseJson } from "../../web/http.js";
import type { PiboWebApp, PiboWebAppContext, PiboWebSession } from "../../web/types.js";

export const CHAT_WEB_APP_NAME = "pibo.chat-web";
export const CHAT_WEB_CHANNEL = "chat-web";
export const CHAT_WEB_MOUNT_PATH = "/apps/chat";
export const CHAT_WEB_API_PREFIX = "/api/chat";

export type ChatWebAppOptions = {
	defaultProfile?: string;
};

function writeSse(controller: ReadableStreamDefaultController<Uint8Array>, event: string, payload: unknown): void {
	const encoder = new TextEncoder();
	controller.enqueue(encoder.encode(`event: ${event}\n`));
	controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
}

function requireSameOriginJsonRequest(request: Request): void {
	const contentType = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
	if (contentType !== "application/json") {
		throw new PiboWebHttpError("Content-Type must be application/json", 415);
	}

	const origin = request.headers.get("origin");
	if (!origin) {
		throw new PiboWebHttpError("Origin header is required", 403);
	}

	if (origin !== new URL(request.url).origin) {
		throw new PiboWebHttpError("Origin is not allowed", 403);
	}
}

function createEventStream(session: PiboWebSession, context: PiboWebAppContext): Response {
	let unsubscribe: (() => void) | undefined;
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			writeSse(controller, "ready", { sessionKey: session.binding.sessionKey });
			unsubscribe = context.channelContext.subscribe((event: PiboOutputEvent) => {
				if (event.sessionKey === session.binding.sessionKey) {
					writeSse(controller, "pibo", event);
				}
			});
		},
		cancel() {
			unsubscribe?.();
			unsubscribe = undefined;
		},
	});

	return new Response(stream, {
		headers: {
			"content-type": "text/event-stream; charset=utf-8",
			"cache-control": "no-cache, no-transform",
			connection: "keep-alive",
		},
	});
}

function createChatHtml(): string {
	return `<!doctype html>
<html lang="en">
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<title>Pibo Chat</title>
	<style>
		:root {
			color-scheme: light;
			font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
			background: #f5f7fb;
			color: #17202c;
		}
		* { box-sizing: border-box; }
		body {
			margin: 0;
			min-height: 100vh;
			display: grid;
			grid-template-rows: auto 1fr;
		}
		header {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 16px;
			padding: 14px 20px;
			border-bottom: 1px solid #d9e1ec;
			background: #ffffff;
		}
		main {
			display: grid;
			grid-template-rows: auto 1fr auto;
			min-height: 0;
			max-width: 960px;
			width: 100%;
			margin: 0 auto;
			padding: 20px;
			gap: 14px;
		}
		h1 {
			margin: 0;
			font-size: 18px;
			font-weight: 650;
			letter-spacing: 0;
		}
		button {
			border: 1px solid #bac7d7;
			background: #ffffff;
			color: #17202c;
			border-radius: 6px;
			padding: 8px 12px;
			font: inherit;
			cursor: pointer;
		}
		button.primary {
			background: #1f6feb;
			border-color: #1f6feb;
			color: #ffffff;
		}
		#user {
			display: flex;
			align-items: center;
			gap: 10px;
			min-width: 0;
			font-size: 14px;
			color: #4d5d70;
		}
		#status {
			padding: 10px 12px;
			border: 1px solid #d9e1ec;
			border-radius: 6px;
			background: #ffffff;
			color: #4d5d70;
			font-size: 14px;
		}
		#messages {
			min-height: 360px;
			overflow: auto;
			padding: 12px;
			border: 1px solid #d9e1ec;
			border-radius: 6px;
			background: #ffffff;
		}
		.message {
			white-space: pre-wrap;
			line-height: 1.45;
			padding: 8px 0;
			border-bottom: 1px solid #eef2f6;
		}
		.message:last-child { border-bottom: 0; }
		.role {
			display: block;
			margin-bottom: 3px;
			font-size: 12px;
			font-weight: 650;
			color: #68798d;
			text-transform: uppercase;
		}
		form {
			display: grid;
			grid-template-columns: 1fr auto;
			gap: 10px;
		}
		textarea {
			width: 100%;
			min-height: 48px;
			max-height: 160px;
			resize: vertical;
			border: 1px solid #bac7d7;
			border-radius: 6px;
			padding: 10px 12px;
			font: inherit;
		}
		.hidden { display: none !important; }
		@media (max-width: 640px) {
			header {
				align-items: flex-start;
				flex-direction: column;
			}
			main { padding: 14px; }
			form { grid-template-columns: 1fr; }
		}
	</style>
</head>
<body>
	<header>
		<h1>Pibo Chat</h1>
		<div id="user"></div>
	</header>
	<main>
		<div id="status">Checking session...</div>
		<div id="messages" aria-live="polite"></div>
		<form id="composer" class="hidden">
			<textarea id="message" name="message" placeholder="Message pibo" required></textarea>
			<button class="primary" type="submit">Send</button>
		</form>
	</main>
	<script>
		const statusEl = document.querySelector("#status");
		const userEl = document.querySelector("#user");
		const messagesEl = document.querySelector("#messages");
		const composer = document.querySelector("#composer");
		const messageInput = document.querySelector("#message");
		let events;
		let activeAssistant;

		function setStatus(text) {
			statusEl.textContent = text;
		}

		function addMessage(role, text) {
			const item = document.createElement("div");
			item.className = "message";
			const label = document.createElement("span");
			label.className = "role";
			label.textContent = role;
			const body = document.createElement("span");
			body.textContent = text;
			item.append(label, body);
			messagesEl.append(item);
			messagesEl.scrollTop = messagesEl.scrollHeight;
			return body;
		}

		async function signIn() {
			const response = await fetch("/api/auth/sign-in/social", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ provider: "google", callbackURL: "/apps/chat", disableRedirect: true }),
			});
			const data = await response.json();
			if (!response.ok || !data.url) {
				setStatus(data.message || data.error || "Could not start Google sign in.");
				return;
			}
			location.href = data.url;
		}

			async function clearAuthSession() {
				await fetch("/api/auth/sign-out", {
					method: "POST",
					credentials: "same-origin",
					headers: { "content-type": "application/json" },
					body: "{}",
				});
			}

			async function signOut() {
				await clearAuthSession();
				location.reload();
			}

			function renderSignedOut(message) {
				userEl.replaceChildren();
				const button = document.createElement("button");
				button.className = "primary";
				button.textContent = "Sign in with Google";
				button.addEventListener("click", signIn);
				userEl.append(button);
				composer.classList.add("hidden");
				setStatus(message || "Sign in to start a pibo session.");
			}

			function renderSignedIn(session) {
				userEl.replaceChildren();
				const label = document.createElement("span");
				label.textContent = session.identity.email || session.identity.name || session.identity.userId;
				userEl.append(label);
				const button = document.createElement("button");
				button.textContent = "Sign out";
				button.addEventListener("click", signOut);
				userEl.append(button);
				composer.classList.remove("hidden");
				setStatus("Session " + session.binding.sessionKey);
			}

		function connectEvents() {
			if (events) events.close();
			events = new EventSource("/api/chat/events");
			events.addEventListener("pibo", (event) => {
				const payload = JSON.parse(event.data);
				if (payload.type === "message_started") {
					activeAssistant = addMessage("assistant", "");
					return;
				}
				if (payload.type === "assistant_delta") {
					if (!activeAssistant) activeAssistant = addMessage("assistant", "");
					activeAssistant.textContent += payload.text;
					messagesEl.scrollTop = messagesEl.scrollHeight;
					return;
				}
				if (payload.type === "assistant_message") {
					if (!activeAssistant || !activeAssistant.textContent) {
						activeAssistant = addMessage("assistant", payload.text);
					}
					activeAssistant = undefined;
					return;
				}
				if (payload.type === "session_error") {
					addMessage("error", payload.error);
					activeAssistant = undefined;
				}
			});
			events.onerror = () => setStatus("Event stream disconnected.");
		}

			async function loadSession() {
				const response = await fetch("/api/chat/session");
				if (response.status === 401) {
					renderSignedOut();
					return;
				}
				const session = await response.json();
				if (response.status === 403) {
					await clearAuthSession().catch(() => {});
					renderSignedOut("Not authorized. Sign in with an allowed Google account.");
					return;
				}
				if (!response.ok) {
					setStatus(session.error || "Could not load session.");
					return;
				}
				renderSignedIn(session);
				connectEvents();
		}

		composer.addEventListener("submit", async (event) => {
			event.preventDefault();
			const text = messageInput.value.trim();
			if (!text) return;
			messageInput.value = "";
			addMessage("you", text);
			activeAssistant = undefined;
			const response = await fetch("/api/chat/message", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ text }),
			});
			if (!response.ok) {
				const error = await response.json().catch(() => ({ error: "Request failed" }));
				addMessage("error", error.error || "Request failed");
			}
		});

		loadSession();
	</script>
</body>
</html>`;
}

export function createChatWebApp(options: ChatWebAppOptions = {}): PiboWebApp {
	const defaultProfile = options.defaultProfile ?? "pibo-minimal";

	const requireSession = (request: Request, context: PiboWebAppContext): Promise<PiboWebSession> =>
		context.requireSession({
			request,
			channel: CHAT_WEB_CHANNEL,
			defaultProfile,
		});

	return {
		name: CHAT_WEB_APP_NAME,
		mountPath: CHAT_WEB_MOUNT_PATH,
		apiPrefix: CHAT_WEB_API_PREFIX,
		async handleRequest(request, context) {
			const url = new URL(request.url);

			if (url.pathname === CHAT_WEB_MOUNT_PATH && request.method === "GET") {
				return responseHtml(createChatHtml());
			}

			if (url.pathname === `${CHAT_WEB_API_PREFIX}/session` && request.method === "GET") {
				const session = await requireSession(request, context);
				return responseJson({
					identity: session.authSession.identity,
					binding: session.binding,
					capabilities: {
						actions: context.channelContext.getGatewayActions(),
					},
				});
			}

				if (url.pathname === `${CHAT_WEB_API_PREFIX}/message` && request.method === "POST") {
					requireSameOriginJsonRequest(request);
					const session = await requireSession(request, context);
					const body = await readJsonBody<{ text?: unknown }>(request);
				if (typeof body.text !== "string" || body.text.trim().length === 0) {
					return responseJson({ error: "Message text is required" }, { status: 400 });
				}
				const output = await context.channelContext.emit({
					type: "message",
					sessionKey: session.binding.sessionKey,
					id: randomUUID(),
					text: body.text,
					source: "user",
				});
				return responseJson(output);
			}

				if (url.pathname === `${CHAT_WEB_API_PREFIX}/action` && request.method === "POST") {
					requireSameOriginJsonRequest(request);
					const session = await requireSession(request, context);
					const body = await readJsonBody<{ action?: unknown }>(request);
				if (typeof body.action !== "string" || body.action.length === 0) {
					return responseJson({ error: "Action is required" }, { status: 400 });
				}
				const output = await context.channelContext.emit({
					type: "execution",
					sessionKey: session.binding.sessionKey,
					id: randomUUID(),
					action: body.action,
				});
				return responseJson(output);
			}

			if (url.pathname === `${CHAT_WEB_API_PREFIX}/events` && request.method === "GET") {
				const session = await requireSession(request, context);
				return createEventStream(session, context);
			}

			return undefined;
		},
	};
}
