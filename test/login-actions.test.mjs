import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { completeLogin, getLoginStatus, startLogin } from "../dist/auth/login-actions.js";

function makeJwt(payload) {
	const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
	return `${encode({ alg: "none" })}.${encode(payload)}.sig`;
}

test("OpenAI Codex login uses device code flow and stores OAuth credentials", async () => {
	const agentDir = join(tmpdir(), `pibo-login-actions-${Date.now()}-${Math.random().toString(16).slice(2)}`);
	mkdirSync(agentDir, { recursive: true });
	const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
	const previousFetch = globalThis.fetch;
	const requests = [];
	const accessToken = makeJwt({
		"https://api.openai.com/auth": { chatgpt_account_id: "acct-test" },
	});

	process.env.PI_CODING_AGENT_DIR = agentDir;
	globalThis.fetch = async (url, init) => {
		requests.push({ url: String(url), body: init?.body ? String(init.body) : "" });
		if (String(url).endsWith("/api/accounts/deviceauth/usercode")) {
			return Response.json({ device_auth_id: "device-1", user_code: "ABCD-1234", interval: "1" });
		}
		if (String(url).endsWith("/api/accounts/deviceauth/token")) {
			return Response.json({
				authorization_code: "auth-code",
				code_challenge: "challenge",
				code_verifier: "verifier",
			});
		}
		if (String(url).endsWith("/oauth/token")) {
			return Response.json({ access_token: accessToken, refresh_token: "refresh-token", expires_in: 3600 });
		}
		throw new Error(`Unexpected fetch URL: ${url}`);
	};

	try {
		const started = await startLogin("openai-codex");
		assert.equal(started.url, "https://auth.openai.com/codex/device");
		assert.equal(started.userCode, "ABCD-1234");
		assert.equal(started.provider, "openai-codex");
		assert.equal(typeof started.state, "string");

		const completed = await completeLogin("openai-codex", undefined, started.state);
		assert.deepEqual(completed, { success: true, provider: "openai-codex", accountId: "acct-test" });

		assert.equal(requests.length, 3);
		assert.equal(requests[0].body, JSON.stringify({ client_id: "app_EMoamEEZ73f0CkXaXp7hrann" }));
		assert.equal(requests[1].body, JSON.stringify({ device_auth_id: "device-1", user_code: "ABCD-1234" }));
		assert.match(requests[2].body, /redirect_uri=https%3A%2F%2Fauth\.openai\.com%2Fdeviceauth%2Fcallback/);
		assert.match(requests[2].body, /code=auth-code/);
		assert.match(requests[2].body, /code_verifier=verifier/);

		const authJson = JSON.parse(readFileSync(join(agentDir, "auth.json"), "utf8"));
		assert.equal(authJson["openai-codex"].type, "oauth");
		assert.equal(authJson["openai-codex"].access, accessToken);
		assert.equal(authJson["openai-codex"].refresh, "refresh-token");
		assert.equal(authJson["openai-codex"].accountId, "acct-test");

		assert.deepEqual(getLoginStatus("openai-codex"), [
			{
				id: "openai-codex",
				provider: "openai-codex",
				configured: true,
				source: "stored",
			},
		]);
	} finally {
		globalThis.fetch = previousFetch;
		if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
		rmSync(agentDir, { recursive: true, force: true });
	}
});
