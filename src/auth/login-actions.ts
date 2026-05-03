import { AuthStorage } from "@mariozechner/pi-coding-agent";
import { randomBytes } from "node:crypto";

const OPENAI_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const OPENAI_AUTHORIZE_URL = "https://auth.openai.com/oauth/authorize";
const OPENAI_TOKEN_URL = "https://auth.openai.com/oauth/token";
const OPENAI_REDIRECT_URI = "http://localhost:1455/auth/callback";
const OPENAI_SCOPE = "openid profile email offline_access";
const OPENAI_JWT_CLAIM_PATH = "https://api.openai.com/auth";

function base64urlEncode(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

async function generatePKCE(): Promise<{ verifier: string; challenge: string }> {
	const verifierBytes = new Uint8Array(32);
	crypto.getRandomValues(verifierBytes);
	const verifier = base64urlEncode(verifierBytes);

	const encoder = new TextEncoder();
	const data = encoder.encode(verifier);
	const hashBuffer = await crypto.subtle.digest("SHA-256", data);
	const challenge = base64urlEncode(new Uint8Array(hashBuffer));

	return { verifier, challenge };
}

export type PendingLogin = {
	verifier: string;
	state: string;
	provider: string;
	createdAt: number;
};

const pendingLogins = new Map<string, PendingLogin>();

function createAuthStorage(): AuthStorage {
	return AuthStorage.create();
}

function decodeJwt(token: string): Record<string, unknown> | null {
	try {
		const parts = token.split(".");
		if (parts.length !== 3) return null;
		const payload = parts[1] ?? "";
		const decoded = atob(payload);
		return JSON.parse(decoded) as Record<string, unknown>;
	} catch {
		return null;
	}
}

function getOpenAiAccountId(accessToken: string): string | null {
	const payload = decodeJwt(accessToken);
	const auth = payload?.[OPENAI_JWT_CLAIM_PATH] as Record<string, unknown> | undefined;
	const accountId = auth?.chatgpt_account_id;
	return typeof accountId === "string" && accountId.length > 0 ? accountId : null;
}

function requirePendingLogin(state: string, provider: string): PendingLogin {
	const pending = pendingLogins.get(state);
	if (!pending) {
		throw new Error("Invalid or expired login state. Start a new login flow with /login-start.");
	}
	if (pending.provider !== provider) {
		throw new Error(`Login state mismatch: expected provider "${pending.provider}", got "${provider}".`);
	}
	// Expire after 10 minutes
	if (Date.now() - pending.createdAt > 10 * 60 * 1000) {
		pendingLogins.delete(state);
		throw new Error("Login state expired. Start a new login flow with /login-start.");
	}
	return pending;
}

export async function startLogin(provider: string): Promise<{ url: string; state: string; provider: string; instructions: string }> {
	if (provider === "openai-codex") {
		const { verifier, challenge } = await generatePKCE();
		const state = randomBytes(16).toString("hex");

		const url = new URL(OPENAI_AUTHORIZE_URL);
		url.searchParams.set("response_type", "code");
		url.searchParams.set("client_id", OPENAI_CLIENT_ID);
		url.searchParams.set("redirect_uri", OPENAI_REDIRECT_URI);
		url.searchParams.set("scope", OPENAI_SCOPE);
		url.searchParams.set("code_challenge", challenge);
		url.searchParams.set("code_challenge_method", "S256");
		url.searchParams.set("state", state);
		url.searchParams.set("id_token_add_organizations", "true");
		url.searchParams.set("codex_cli_simplified_flow", "true");
		url.searchParams.set("originator", "pibo");

		pendingLogins.set(state, { verifier, state, provider, createdAt: Date.now() });

		return {
			url: url.toString(),
			state,
			provider,
			instructions:
				"Open the URL in your browser, complete login, then paste the authorization code (or full redirect URL) via /login-complete.",
		};
	}

	throw new Error(`OAuth login start not supported for provider "${provider}". Supported: openai-codex.`);
}

export async function completeLogin(provider: string, code: string, state: string): Promise<{ success: true; provider: string; accountId: string | null }> {
	if (provider === "openai-codex") {
		const pending = requirePendingLogin(state, provider);
		pendingLogins.delete(state);

		const response = await fetch(OPENAI_TOKEN_URL, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				grant_type: "authorization_code",
				client_id: OPENAI_CLIENT_ID,
				code,
				code_verifier: pending.verifier,
				redirect_uri: OPENAI_REDIRECT_URI,
			}),
		});

		if (!response.ok) {
			const text = await response.text().catch(() => "");
			throw new Error(`Token exchange failed: ${response.status} ${text}`);
		}

		const json = (await response.json()) as {
			access_token?: string;
			refresh_token?: string;
			expires_in?: number;
		};

		if (!json.access_token || !json.refresh_token || typeof json.expires_in !== "number") {
			throw new Error("Invalid token response from OpenAI");
		}

		const accountId = getOpenAiAccountId(json.access_token);

		const authStorage = createAuthStorage();
		authStorage.set(provider, {
			type: "oauth",
			access: json.access_token,
			refresh: json.refresh_token,
			expires: Date.now() + json.expires_in * 1000,
			accountId: accountId ?? undefined,
		});

		return { success: true, provider, accountId };
	}

	throw new Error(`OAuth login complete not supported for provider "${provider}". Supported: openai-codex.`);
}

export function setApiKey(provider: string, apiKey: string): { success: true; provider: string } {
	const authStorage = createAuthStorage();
	authStorage.set(provider, { type: "api_key", key: apiKey });
	return { success: true, provider };
}

export function getLoginStatus(provider?: string): { provider: string; configured: boolean; source?: string; label?: string }[] {
	const authStorage = createAuthStorage();
	if (provider) {
		return [{ provider, ...authStorage.getAuthStatus(provider) }];
	}
	return authStorage.list().map((p) => ({ provider: p, ...authStorage.getAuthStatus(p) }));
}

export function removeLogin(provider: string): { success: true; provider: string } {
	const authStorage = createAuthStorage();
	authStorage.logout(provider);
	return { success: true, provider };
}
