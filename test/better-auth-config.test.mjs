import assert from "node:assert/strict";
import test from "node:test";
import { createBetterAuthService } from "../dist/auth/better-auth.js";

const validOptions = {
	baseURL: "http://localhost:4788",
	secret: "x".repeat(32),
	googleClientId: "google-client-id",
	googleClientSecret: "google-client-secret",
	allowedEmails: ["you@example.com"],
};

test("better auth requires an allowed email allowlist", () => {
	assert.throws(
		() =>
			createBetterAuthService({
				...validOptions,
				allowedEmails: [],
			}),
			/auth.allowedEmails must contain at least one email/,
	);
});

test("better auth requires a strong secret", () => {
	assert.throws(
		() =>
			createBetterAuthService({
				...validOptions,
				secret: "too-short",
			}),
		/auth.secret must be at least 32 characters/,
	);
});
