import type { BootstrapData, CreateSessionData, PiboSessionTraceView } from "./types";

export async function getBootstrap(sessionKey?: string): Promise<BootstrapData> {
	const suffix = sessionKey ? `?sessionKey=${encodeURIComponent(sessionKey)}` : "";
	return requestJson<BootstrapData>(`/api/chat/bootstrap${suffix}`);
}

export async function getTrace(sessionKey: string): Promise<PiboSessionTraceView> {
	return requestJson<PiboSessionTraceView>(`/api/chat/trace?sessionKey=${encodeURIComponent(sessionKey)}`);
}

export async function postSession(): Promise<CreateSessionData> {
	return requestJson<CreateSessionData>("/api/chat/sessions", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: "{}",
	});
}

export async function postMessage(sessionKey: string, text: string): Promise<unknown> {
	return requestJson("/api/chat/message", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ sessionKey, text }),
	});
}

export async function postAction(sessionKey: string, action: string, params?: unknown): Promise<unknown> {
	return requestJson("/api/chat/action", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ sessionKey, action, params }),
	});
}

export async function signOut(): Promise<void> {
	await fetch("/api/auth/sign-out", {
		method: "POST",
		credentials: "same-origin",
		headers: { "content-type": "application/json" },
		body: "{}",
	});
}

export async function signInWithGoogle(): Promise<void> {
	const response = await fetch("/api/auth/sign-in/social", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ provider: "google", callbackURL: "/apps/chat", disableRedirect: true }),
	});
	const data = (await response.json()) as { url?: string; error?: string; message?: string };
	if (!response.ok || !data.url) throw new Error(data.message || data.error || "Could not start Google sign in.");
	location.href = data.url;
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
	const response = await fetch(path, init);
	const payload = await response.json().catch(() => undefined);
	if (!response.ok) {
		const message =
			payload && typeof payload === "object" && "error" in payload ? String(payload.error) : "Request failed";
		throw new Error(message);
	}
	return payload as T;
}
