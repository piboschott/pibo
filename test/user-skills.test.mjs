import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
	createUserSkill,
	findUserSkill,
	listUserSkills,
	loadUserSkillStore,
	parseSkillMd,
	updateUserSkill,
} from "../dist/user-skills/store.js";

function tempWorkspace() {
	return mkdtempSync(join(tmpdir(), "pibo-user-skills-"));
}

test("user skill descriptions are stored in SKILL.md frontmatter", () => {
	const cwd = tempWorkspace();
	const created = createUserSkill(
		{
			name: "review-helper",
			description: "Review code changes.",
			markdown: "Use a concise review format.",
		},
		cwd,
	);

	const store = loadUserSkillStore(cwd);
	assert.equal(store.skills.length, 1);
	assert.equal(store.skills[0].description, "");
	assert.match(readFileSync(created.path, "utf-8"), /description: Review code changes\./);

	assert.equal(listUserSkills(cwd)[0].description, "Review code changes.");
	assert.equal(findUserSkill("review-helper", cwd)?.description, "Review code changes.");
});

test("create and update skill metadata can read frontmatter from markdown input", () => {
	const cwd = tempWorkspace();
	const created = createUserSkill(
		{
			name: "frontend-helper",
			description: "",
			markdown: "---\nname: frontend-helper\ndescription: Frontend review helper.\n---\n\nCheck layout regressions.",
		},
		cwd,
	);

	assert.equal(created.description, "Frontend review helper.");
	assert.equal(listUserSkills(cwd)[0].description, "Frontend review helper.");

	const updated = updateUserSkill(
		created.id,
		{
			markdown: "---\nname: frontend-helper\ndescription: Updated helper.\n---\n\nCheck spacing.",
		},
		cwd,
	);

	assert.equal(updated.description, "Updated helper.");
	assert.equal(findUserSkill(created.id, cwd)?.description, "Updated helper.");
	assert.doesNotMatch(readFileSync(updated.path, "utf-8"), /---[\s\S]*---[\s\S]*---[\s\S]*---/);
});

test("parseSkillMd handles plain, colon, broken, and body delimiter cases", () => {
	assert.deepEqual(parseSkillMd("plain body"), {
		name: "",
		description: "",
		body: "plain body",
	});

	assert.deepEqual(parseSkillMd("---\nname: colon-helper\ndescription: Text: with colon\n---\n\nUse it."), {
		name: "colon-helper",
		description: "Text: with colon",
		body: "Use it.",
	});

	assert.deepEqual(parseSkillMd("---\nname: broken\ndescription: Missing end"), {
		name: "",
		description: "",
		body: "---\nname: broken\ndescription: Missing end",
	});

	assert.deepEqual(parseSkillMd("---\nname: body-helper\ndescription: Body delimiter\n---\n\nKeep --- in body."), {
		name: "body-helper",
		description: "Body delimiter",
		body: "Keep --- in body.",
	});
});
