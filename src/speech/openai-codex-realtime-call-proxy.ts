import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

const CHATGPT_CODEX_BASE_URL = "https://chatgpt.com/backend-api/codex/";
const CODEX_REALTIME_MODEL = "gpt-live-1-codex";
const MAX_REQUEST_BYTES = 512 * 1024;
const FORWARD_TIMEOUT_MS = 30_000;
const OMITTED_RESPONSE_HEADERS = new Set([
	"connection",
	"content-encoding",
	"content-length",
	"keep-alive",
	"proxy-authenticate",
	"proxy-authorization",
	"te",
	"trailer",
	"transfer-encoding",
	"upgrade",
]);

export type OpenAiCodexRealtimeCallProxy = {
	baseUrl: string;
	close(): Promise<void>;
};

export type OpenAiCodexRealtimeCallProxyOptions = {
	targetBaseUrl?: string;
};

class ProxyRequestError extends Error {
	constructor(readonly status: number, message: string) {
		super(message);
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function readRequestBody(request: IncomingMessage): Promise<Buffer> {
	const chunks: Buffer[] = [];
	let bytes = 0;
	for await (const chunk of request) {
		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		bytes += buffer.length;
		if (bytes > MAX_REQUEST_BYTES) throw new ProxyRequestError(413, "Realtime call request is too large");
		chunks.push(buffer);
	}
	return Buffer.concat(chunks);
}

function requestHeaders(request: IncomingMessage): Headers {
	const authorization = request.headers.authorization;
	if (typeof authorization !== "string" || !authorization) {
		throw new ProxyRequestError(401, "Codex subscription authentication is required");
	}
	const headers = new Headers({
		accept: "application/sdp",
		"accept-encoding": "identity",
		authorization,
		"content-type": "application/json",
		"openai-alpha": "quicksilver=v2",
		originator: "codex_cli_rs",
	});
	for (const name of ["chatgpt-account-id", "session-id", "thread-id", "user-agent", "x-openai-fedramp"]) {
		const value = request.headers[name];
		if (typeof value === "string" && value) headers.set(name, value);
	}
	return headers;
}

function realtimeCallBody(value: unknown): string {
	if (!isRecord(value) || typeof value.sdp !== "string" || !isRecord(value.session)) {
		throw new ProxyRequestError(400, "Codex returned an invalid realtime call request");
	}
	const session: Record<string, unknown> = { ...value.session, model: CODEX_REALTIME_MODEL };
	delete session.id;
	return JSON.stringify({ ...value, session });
}

function writeResponseHeaders(response: Response, outgoing: ServerResponse): void {
	for (const [name, value] of response.headers) {
		if (!OMITTED_RESPONSE_HEADERS.has(name)) outgoing.setHeader(name, value);
	}
}

async function forwardRealtimeCall(
	request: IncomingMessage,
	response: ServerResponse,
	targetUrl: URL,
): Promise<void> {
	const body = await readRequestBody(request);
	let payload: unknown;
	try {
		payload = JSON.parse(body.toString("utf8"));
	} catch {
		throw new ProxyRequestError(400, "Codex returned malformed realtime call JSON");
	}
	const upstream = await fetch(targetUrl, {
		method: "POST",
		headers: requestHeaders(request),
		body: realtimeCallBody(payload),
		redirect: "manual",
		signal: AbortSignal.timeout(FORWARD_TIMEOUT_MS),
	});
	response.statusCode = upstream.status;
	writeResponseHeaders(upstream, response);
	response.end(Buffer.from(await upstream.arrayBuffer()));
}

function sendProxyError(response: ServerResponse, error: unknown): void {
	if (response.headersSent) {
		response.destroy();
		return;
	}
	response.statusCode = error instanceof ProxyRequestError ? error.status : 502;
	response.setHeader("content-type", "application/json");
	response.end(JSON.stringify({ error: error instanceof ProxyRequestError ? error.message : "Realtime call forwarding failed" }));
}

export async function startOpenAiCodexRealtimeCallProxy(
	options: OpenAiCodexRealtimeCallProxyOptions = {},
): Promise<OpenAiCodexRealtimeCallProxy> {
	const targetBaseUrl = new URL(options.targetBaseUrl ?? CHATGPT_CODEX_BASE_URL);
	if (targetBaseUrl.protocol !== "https:" && targetBaseUrl.protocol !== "http:") {
		throw new Error("Codex realtime call target must use HTTP or HTTPS");
	}
	if (!targetBaseUrl.pathname.endsWith("/")) targetBaseUrl.pathname += "/";
	const routePrefix = `/speech-${randomUUID()}/backend-api/codex`;
	const server = createServer((request, response) => {
		void (async () => {
			if (request.method !== "POST") throw new ProxyRequestError(405, "Method not allowed");
			const incomingUrl = new URL(request.url ?? "/", "http://127.0.0.1");
			if (incomingUrl.pathname !== `${routePrefix}/realtime/calls`) {
				throw new ProxyRequestError(404, "Not found");
			}
			const targetUrl = new URL("realtime/calls", targetBaseUrl);
			targetUrl.search = incomingUrl.search;
			await forwardRealtimeCall(request, response, targetUrl);
		})().catch((error) => sendProxyError(response, error));
	});
	server.on("clientError", (_error, socket) => socket.destroy());
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			server.off("error", reject);
			resolve();
		});
	});
	const address = server.address();
	if (!address || typeof address === "string") {
		server.close();
		throw new Error("Codex realtime call proxy did not bind to a TCP port");
	}
	let closePromise: Promise<void> | undefined;
	return {
		baseUrl: `http://127.0.0.1:${address.port}${routePrefix}`,
		close() {
			if (!closePromise) {
				closePromise = new Promise<void>((resolve) => {
					if (!server.listening) {
						resolve();
						return;
					}
					server.close(() => resolve());
					server.closeIdleConnections();
				});
			}
			return closePromise;
		},
	};
}
