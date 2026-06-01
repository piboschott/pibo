import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { renderAttachedWebAnnotations, WEB_ANNOTATION_LIMITS, WebAnnotationStore } from "../dist/web-annotations/index.js";

function tableColumns(db, tableName) {
	return db.prepare(`PRAGMA table_info(${tableName})`).all().map((column) => column.name);
}

function legacySharedValue() {
	return ["shared", "app"].join(":");
}

function createAnnotationInput(overrides = {}) {
	return {
		piboSessionId: "ps_a",
		piboRoomId: "room_a",
		bindingId: "binding-a",
		note: "Make this wider",
		url: "http://localhost:3000/settings",
		title: "Settings",
		targetId: "target-a",
		targetKind: "element",
		viewport: { width: 1440, height: 900, devicePixelRatio: 1 },
		target: {
			kind: "element",
			label: "button Save",
			selector: "[data-testid=\"save\"]",
			domPath: "body > button",
			boundingBox: { x: 10, y: 20, width: 100, height: 40 },
			sourceHints: [{ kind: "test-id", confidence: "high", id: "save" }],
		},
		...overrides,
	};
}

test("web annotation bindings persist by shared app and session without deleting annotations", () => {
	const store = new WebAnnotationStore({ path: ":memory:" });
	try {
		const binding = store.createBinding({
			id: "binding-a",
			piboSessionId: "ps_a",
			piboRoomId: "room_a",
			url: "http://localhost:3000/settings",
			targetId: "target-a",
		}, new Date("2026-05-16T10:00:00.000Z"));
		assert.equal(Object.hasOwn(binding, ["owner", "Scope"].join("")), false);
		assert.equal(binding.state, "active");

		const injected = store.patchBinding("ps_a", binding.id, {
			state: "injected",
			lastInjectedAt: "2026-05-16T10:01:00.000Z",
		});
		assert.equal(injected?.state, "injected");
		assert.equal(injected?.lastInjectedAt, "2026-05-16T10:01:00.000Z");

		store.createAnnotation(createAnnotationInput(), new Date("2026-05-16T10:02:00.000Z"));
		assert.equal(store.removeBinding("ps_a", binding.id), true);
		assert.equal(store.listBindings({ piboSessionId: "ps_a" }).length, 0);
		assert.equal(store.listAnnotations({ piboSessionId: "ps_a" }).length, 1);
	} finally {
		store.close();
	}
});

test("web annotations list newest first with status and bounded limits", () => {
	const store = new WebAnnotationStore({ path: ":memory:" });
	try {
		const older = store.createAnnotation(createAnnotationInput({ id: "ann-old", note: "older" }), new Date("2026-05-16T10:00:00.000Z"));
		const newer = store.createAnnotation(createAnnotationInput({ id: "ann-new", note: "newer", status: "acknowledged" }), new Date("2026-05-16T10:05:00.000Z"));
		assert.deepEqual(store.listAnnotations({ piboSessionId: "ps_a" }).map((annotation) => annotation.id), [newer.id, older.id]);
		assert.deepEqual(store.listAnnotations({ piboSessionId: "ps_a", status: "open" }).map((annotation) => annotation.id), [older.id]);
		assert.deepEqual(store.listAnnotations({ piboSessionId: "ps_a", limit: 1 }).map((annotation) => annotation.id), [newer.id]);
	} finally {
		store.close();
	}
});

test("web annotation lifecycle and thread operations validate payloads", () => {
	const store = new WebAnnotationStore({ path: ":memory:" });
	try {
		store.createAnnotation(createAnnotationInput({ id: "ann-life" }), new Date("2026-05-16T10:00:00.000Z"));
		const acknowledged = store.acknowledgeAnnotation("ps_a", "ann-life", "starting", new Date("2026-05-16T10:01:00.000Z"));
		assert.equal(acknowledged?.status, "acknowledged");
		assert.equal(acknowledged?.summary, "starting");

		const threaded = store.addThreadMessage({ annotationId: "ann-life", piboSessionId: "ps_a", role: "agent", content: "I found it." }, new Date("2026-05-16T10:02:00.000Z"));
		assert.equal(threaded?.thread?.length, 1);
		assert.equal(threaded?.thread?.[0].role, "agent");

		const resolved = store.resolveAnnotation("ps_a", "ann-life", "fixed", "agent", new Date("2026-05-16T10:03:00.000Z"));
		assert.equal(resolved?.status, "resolved");
		assert.equal(resolved?.resolvedAt, "2026-05-16T10:03:00.000Z");
		assert.equal(resolved?.resolvedBy, "agent");

		assert.throws(() => store.patchAnnotation("ps_a", "ann-life", { status: "not-a-status" }), /Invalid annotation status/);
		assert.throws(() => store.addThreadMessage({ annotationId: "ann-life", piboSessionId: "ps_a", role: "agent", content: "" }), /content is required/);
	} finally {
		store.close();
	}
});

test("web annotations normalize oversized and secret-like payloads", () => {
	const store = new WebAnnotationStore({ path: ":memory:" });
	try {
		const rawSecret = "sk-abcdefghijklmnopqrstuvwxyz123456";
		const annotation = store.createAnnotation(createAnnotationInput({
			id: "ann-limits",
			note: `Please check token=${rawSecret}`,
			url: `http://localhost:3000/${"x".repeat(3_000)}`,
			target: {
				kind: "element",
				label: "Save button",
				selector: `[data-secret="${rawSecret}"]`,
				text: `visible ${rawSecret} ${"t".repeat(2_000)}`,
				htmlHint: `<button data-token="${rawSecret}">${"H".repeat(3_000)}</button>`,
				classSummary: "c".repeat(2_000),
				sourceHints: Array.from({ length: 20 }, (_, index) => ({
					kind: "test-id",
					confidence: "high",
					id: `hint-${index}`,
					raw: { token: rawSecret, long: "r".repeat(2_000), nested: { value: rawSecret } },
				})),
			},
			screenshotRef: { path: `/tmp/${"screen".repeat(200)}.png`, artifactId: "artifact-1", mimeType: "image/png", width: 100, height: 100 },
		}), new Date("2026-05-16T10:00:00.000Z"));

		assert.equal(annotation.url.length, WEB_ANNOTATION_LIMITS.url);
		assert.equal(annotation.target.text.length, WEB_ANNOTATION_LIMITS.text);
		assert.equal(annotation.target.htmlHint.length, WEB_ANNOTATION_LIMITS.htmlHint);
		assert.equal(annotation.target.classSummary.length, WEB_ANNOTATION_LIMITS.classSummary);
		assert.equal(annotation.target.sourceHints.length, WEB_ANNOTATION_LIMITS.sourceHints);
		assert.equal(annotation.screenshotRef.path.length, WEB_ANNOTATION_LIMITS.screenshotRefText);
		assert.doesNotMatch(annotation.note, /sk-abcdefghijklmnopqrstuvwxyz/);
		assert.match(annotation.note, /\[REDACTED_SECRET\]/);
		assert.doesNotMatch(annotation.target.text, /sk-abcdefghijklmnopqrstuvwxyz/);
		assert.match(annotation.target.sourceHints[0].raw.token, /\[REDACTED_SECRET\]/);

		const threaded = store.addThreadMessage({ annotationId: "ann-limits", piboSessionId: "ps_a", role: "human", content: `${rawSecret} ${"m".repeat(3_000)}` });
		assert.equal(threaded.thread[0].content.length, WEB_ANNOTATION_LIMITS.threadMessage);
		assert.doesNotMatch(threaded.thread[0].content, /sk-abcdefghijklmnopqrstuvwxyz/);

		const promptBlock = renderAttachedWebAnnotations([annotation]);
		assert.doesNotMatch(promptBlock, /sk-abcdefghijklmnopqrstuvwxyz/);
		assert.doesNotMatch(promptBlock, /screen/);
	} finally {
		store.close();
	}
});

test("web annotations migrate historical owner columns to app-global session-scoped rows", () => {
	const dir = mkdtempSync(join(tmpdir(), "pibo-web-annotations-ownerless-"));
	const dbPath = join(dir, "web-annotations.sqlite");
	const legacyDb = new DatabaseSync(dbPath);
	try {
		legacyDb.exec(`
			CREATE TABLE web_annotation_bindings (
				id TEXT PRIMARY KEY, owner_scope TEXT NOT NULL, pibo_session_id TEXT NOT NULL, pibo_room_id TEXT,
				state TEXT NOT NULL, url TEXT NOT NULL, title TEXT, target_id TEXT, created_at TEXT NOT NULL,
				updated_at TEXT, last_injected_at TEXT, closed_at TEXT, error TEXT, metadata_json TEXT
			);
			CREATE INDEX idx_legacy_bindings_owner ON web_annotation_bindings(owner_scope, pibo_session_id);
			CREATE TABLE web_annotations (
				id TEXT PRIMARY KEY, owner_scope TEXT NOT NULL, pibo_session_id TEXT NOT NULL, pibo_room_id TEXT,
				binding_id TEXT, status TEXT NOT NULL, note TEXT NOT NULL, url TEXT NOT NULL, title TEXT, target_id TEXT,
				target_kind TEXT NOT NULL, viewport_json TEXT NOT NULL, target_json TEXT, screenshot_ref_json TEXT,
				thread_json TEXT, created_at TEXT NOT NULL, updated_at TEXT, resolved_at TEXT, resolved_by TEXT,
				summary TEXT, metadata_json TEXT
			);
			CREATE INDEX idx_legacy_annotations_owner ON web_annotations(owner_scope, pibo_session_id);
		`);
		legacyDb.prepare("INSERT INTO web_annotation_bindings (id, owner_scope, pibo_session_id, pibo_room_id, state, url, target_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
			.run("binding_legacy", "user:legacy", "ps_a", "room_a", "active", "http://localhost:3000/settings", "target-a", "2026-05-16T09:59:00.000Z", "2026-05-16T09:59:00.000Z");
		legacyDb.prepare("INSERT INTO web_annotations (id, owner_scope, pibo_session_id, pibo_room_id, binding_id, status, note, url, target_kind, viewport_json, target_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
			.run("ann_legacy_user", "user:legacy", "ps_a", "room_a", "binding_legacy", "open", "Legacy user row", "http://localhost:3000/settings", "element", JSON.stringify({ width: 100, height: 100 }), JSON.stringify({ kind: "element", label: "Legacy" }), "2026-05-16T10:00:00.000Z", "2026-05-16T10:00:00.000Z");
		legacyDb.prepare("INSERT INTO web_annotations (id, owner_scope, pibo_session_id, status, note, url, target_kind, viewport_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
			.run("ann_legacy_shared", legacySharedValue(), "ps_a", "acknowledged", "Legacy shared row", "http://localhost:3000/shared", "pin", JSON.stringify({ width: 200, height: 100 }), "2026-05-16T10:01:00.000Z", "2026-05-16T10:01:00.000Z");
	} finally {
		legacyDb.close();
	}

	const store = new WebAnnotationStore({ path: dbPath });
	try {
		assert.deepEqual(tableColumns(store.db, "web_annotation_bindings").includes("owner_scope"), false);
		assert.deepEqual(tableColumns(store.db, "web_annotations").includes("owner_scope"), false);
		const indexes = store.db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE '%owner%'").all();
		assert.deepEqual(indexes, []);
		assert.equal(Object.hasOwn(store.getBinding("ps_a", "binding_legacy"), ["owner", "Scope"].join("")), false);
		assert.deepEqual(store.listAnnotations({ piboSessionId: "ps_a" }).map((annotation) => annotation.id), ["ann_legacy_shared", "ann_legacy_user"]);
		assert.equal(store.getAnnotation("ps_a", "ann_legacy_user")?.target?.label, "Legacy");
		assert.equal(store.patchAnnotation("ps_a", "ann_legacy_user", { status: "resolved" })?.status, "resolved");
	} finally {
		store.close();
		rmSync(dir, { recursive: true, force: true });
	}
});
