import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { PiboPluginRegistry, definePiboPlugin } from "../dist/plugins/registry.js";
import { startOpenAiCodexRealtimeCallProxy } from "../dist/speech/openai-codex-realtime-call-proxy.js";
import { createOpenAiCodexSpeechProvider } from "../dist/speech/openai-codex.js";
import { PiboSpeechError } from "../dist/speech/types.js";

const OFFER_SDP = "v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\n";
const ANSWER_SDP = "v=0\r\no=- 2 2 IN IP4 127.0.0.1\r\n";

function fakeSpeechProcess({ accountType = "chatgpt", realtimeError } = {}) {
	const listeners = new Set();
	const requests = [];
	let closed = 0;
	const notify = (method, params) => {
		for (const listener of listeners) listener({ method, params });
	};
	const client = {
		subscribeNotifications(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		async request(method, params) {
			requests.push({ method, params });
			if (method === "account/read") {
				return accountType === "chatgpt"
					? { account: { type: "chatgpt", email: null, planType: "pro" }, requiresOpenaiAuth: true }
					: { account: { type: "apiKey" }, requiresOpenaiAuth: true };
			}
			if (method === "thread/start") return { thread: { id: "thread-speech" } };
			if (method === "thread/realtime/start") {
				queueMicrotask(() => {
					notify("thread/realtime/started", { threadId: "thread-speech", realtimeSessionId: "rt-1", version: "v1" });
					notify("thread/realtime/sdp", { threadId: "thread-speech", sdp: ANSWER_SDP });
				});
				return {};
			}
			if (method === "thread/realtime/appendSpeech") {
				queueMicrotask(() => {
					if (realtimeError) {
						notify("thread/realtime/error", { threadId: "thread-speech", message: realtimeError });
						return;
					}
					notify("thread/realtime/transcript/done", {
						threadId: "thread-speech",
						role: "assistant",
						text: params.text,
					});
				});
				return {};
			}
			if (method === "thread/realtime/stop") return {};
			throw new Error(`Unexpected request ${method}`);
		},
	};
	return {
		process: { client, async close() { closed += 1; } },
		requests,
		closed: () => closed,
	};
}

async function listen(server) {
	await new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			server.off("error", reject);
			resolve();
		});
	});
	const address = server.address();
	assert.ok(address && typeof address !== "string");
	return address.port;
}

async function closeServer(server) {
	if (!server.listening) return;
	await new Promise((resolve) => server.close(resolve));
}

test("plugins register discoverable speech providers and route sessions", async () => {
	const calls = [];
	const provider = {
		id: "fixture-speech",
		name: "Fixture Speech",
		description: "Fixture provider",
		isConfigured: () => true,
		async startSession(input) {
			calls.push({ type: "start", input });
			return { sessionId: "session-fixture", answerSdp: ANSWER_SDP };
		},
		async speak(sessionId, input) { calls.push({ type: "speak", sessionId, input }); },
		async stopSession(sessionId) { calls.push({ type: "stop", sessionId }); },
	};
	const plugin = definePiboPlugin({
		id: "test.speech",
		name: "Test Speech Plugin",
		register(api) { api.registerSpeechProvider(provider); },
	});
	const registry = PiboPluginRegistry.create({ plugins: [plugin] });

	assert.deepEqual(await registry.getSpeechProviderInfos(), [{
		id: "fixture-speech",
		name: "Fixture Speech",
		description: "Fixture provider",
		configured: true,
		pluginId: "test.speech",
		pluginName: "Test Speech Plugin",
	}]);
	assert.deepEqual(await registry.startSpeechSession("fixture-speech", { offerSdp: OFFER_SDP, text: "hello" }), {
		providerId: "fixture-speech",
		sessionId: "session-fixture",
		answerSdp: ANSWER_SDP,
	});
	await registry.speakSpeechSession("session-fixture", { text: "hello" });
	assert.deepEqual(calls, [
		{ type: "start", input: { offerSdp: OFFER_SDP, text: "hello" } },
		{ type: "speak", sessionId: "session-fixture", input: { text: "hello" } },
		{ type: "stop", sessionId: "session-fixture" },
	]);
	assert.throws(() => PiboPluginRegistry.create({ plugins: [plugin, definePiboPlugin({
		id: "test.speech.duplicate",
		register(api) { api.registerSpeechProvider(provider); },
	})] }), /Duplicate speech provider/);
});

test("OpenAI Codex realtime call adapter preserves subscription auth and normalizes request metadata", async (t) => {
	let received;
	const target = createServer((request, response) => {
		void (async () => {
			const chunks = [];
			for await (const chunk of request) chunks.push(Buffer.from(chunk));
			received = {
				url: request.url,
				authorization: request.headers.authorization,
				accountId: request.headers["chatgpt-account-id"],
				accept: request.headers.accept,
				alpha: request.headers["openai-alpha"],
				originator: request.headers.originator,
				sessionId: request.headers["session-id"],
				threadId: request.headers["thread-id"],
				body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
			};
			response.statusCode = 201;
			response.setHeader("content-type", "application/sdp");
			response.setHeader("location", "/backend-api/codex/realtime/calls/rtc-test");
			response.end(ANSWER_SDP);
		})().catch(() => response.destroy());
	});
	const targetPort = await listen(target);
	t.after(() => closeServer(target));
	const proxy = await startOpenAiCodexRealtimeCallProxy({
		targetBaseUrl: `http://127.0.0.1:${targetPort}/backend-api/codex/`,
	});
	t.after(() => proxy.close());

	const response = await fetch(`${proxy.baseUrl}/realtime/calls?intent=quicksilver&architecture=avas`, {
		method: "POST",
		headers: {
			accept: "application/json",
			"content-type": "application/json",
			authorization: "Bearer subscription-token",
			"chatgpt-account-id": "account-1",
			"openai-alpha": "quicksilver=v1",
			originator: "pibo",
			"session-id": "session-1",
			"thread-id": "thread-1",
		},
		body: JSON.stringify({
			sdp: OFFER_SDP,
			session: {
				model: "gpt-live-1-boulder-alpha",
				instructions: "Speak this text",
				audio: { output: { voice: "cove" } },
			},
		}),
	});

	assert.equal(response.status, 201);
	assert.equal(await response.text(), ANSWER_SDP);
	assert.equal(response.headers.get("location"), "/backend-api/codex/realtime/calls/rtc-test");
	assert.deepEqual(received, {
		url: "/backend-api/codex/realtime/calls?intent=quicksilver&architecture=avas",
		authorization: "Bearer subscription-token",
		accountId: "account-1",
		accept: "application/sdp",
		alpha: "quicksilver=v2",
		originator: "codex_cli_rs",
		sessionId: "session-1",
		threadId: "thread-1",
		body: {
			sdp: OFFER_SDP,
			session: {
				model: "gpt-live-1-codex",
				instructions: "Speak this text",
				audio: { output: { voice: "cove" } },
			},
		},
	});
});

test("OpenAI Codex speech uses subscription auth and WebRTC", async () => {
	const fixture = fakeSpeechProcess();
	const starts = [];
	const provider = createOpenAiCodexSpeechProvider({
		startProcess: async (input) => {
			starts.push(input);
			return fixture.process;
		},
	});

	assert.equal(await provider.isConfigured(), true);
	const session = await provider.startSession({ offerSdp: OFFER_SDP, text: "Hello from Pibo" });
	assert.equal(session.answerSdp, ANSWER_SDP);
	assert.ok(session.sessionId);
	await provider.speak(session.sessionId, { text: "Hello from Pibo" });
	assert.deepEqual(starts.map((start) => ({ experimentalApi: start.experimentalApi, realtimeConversation: start.realtimeConversation })), [
		{ experimentalApi: false, realtimeConversation: false },
		{ experimentalApi: true, realtimeConversation: true },
	]);
	assert.ok(fixture.requests.some((request) => (
		request.method === "thread/realtime/start"
		&& request.params.outputModality === "audio"
		&& request.params.version === "v3"
		&& request.params.prompt.includes("literal text-to-speech renderer")
		&& request.params.prompt.includes(JSON.stringify("Hello from Pibo"))
		&& request.params.transport.type === "webrtc"
		&& request.params.transport.sdp === OFFER_SDP
	)));
	assert.ok(fixture.requests.some((request) => request.method === "thread/realtime/appendSpeech" && request.params.text === "Hello from Pibo"));
	assert.equal(fixture.closed(), 2);
});

test("OpenAI Codex speech reports realtime provider errors", async () => {
	const fixture = fakeSpeechProcess({ realtimeError: "realtime speech is unavailable" });
	const provider = createOpenAiCodexSpeechProvider({ startProcess: async () => fixture.process });
	const session = await provider.startSession({ offerSdp: OFFER_SDP, text: "Hello from Pibo" });
	await assert.rejects(
		provider.speak(session.sessionId, { text: "Hello from Pibo" }),
		(error) => error instanceof PiboSpeechError
			&& error.message === "OpenAI Codex speech generation failed: realtime speech is unavailable",
	);
	assert.equal(fixture.closed(), 1);
});

test("OpenAI Codex speech refuses API-key accounts", async () => {
	const fixture = fakeSpeechProcess({ accountType: "apiKey" });
	const provider = createOpenAiCodexSpeechProvider({ startProcess: async () => fixture.process });
	assert.equal(await provider.isConfigured(), false);
	await assert.rejects(
		provider.startSession({ offerSdp: OFFER_SDP, text: "Hello from Pibo" }),
		(error) => error instanceof PiboSpeechError && error.code === "not_configured",
	);
	assert.equal(fixture.requests.some((request) => request.method.startsWith("thread/")), false);
});
