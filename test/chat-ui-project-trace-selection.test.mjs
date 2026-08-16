import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

async function runProjectTraceSelectionScenarios() {
	const script = `
		import assert from "node:assert/strict";
		const { resolveProjectsTraceSelection } = await import("./src/apps/chat-ui/src/projects/ProjectsAreaModel.ts");

		const project = (id, name) => ({
			id,
			name,
			projectFolder: "/workspace/" + id,
			configurationStatus: "configured",
			metadata: {},
			createdAt: "2026-08-24T00:00:00.000Z",
			updatedAt: "2026-08-24T00:00:00.000Z",
		});
		const alpha = project("project-alpha", "Alpha");
		const beta = project("project-beta", "Beta");
		const data = {
			project: alpha,
			projects: [alpha, beta],
			selectedProjectId: alpha.id,
			selectedPiboSessionId: "ps-alpha",
		};

		assert.deepEqual(resolveProjectsTraceSelection(data, alpha.id, "ps-alpha"), {
			project: alpha,
			selectedPiboSessionId: "ps-alpha",
			navigationPending: false,
		});
		assert.deepEqual(resolveProjectsTraceSelection(data, alpha.id, "ps-beta"), {
			project: alpha,
			selectedPiboSessionId: "ps-beta",
			navigationPending: true,
		});
		assert.deepEqual(resolveProjectsTraceSelection(data, beta.id), {
			project: beta,
			selectedPiboSessionId: null,
			navigationPending: true,
		});
		assert.deepEqual(resolveProjectsTraceSelection(data, beta.id, "ps-beta"), {
			project: beta,
			selectedPiboSessionId: "ps-beta",
			navigationPending: true,
		});
	`;
	await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd() });
}

test("Project trace selection follows the requested route without reusing the previous header or trace", async () => {
	await assert.doesNotReject(runProjectTraceSelectionScenarios());
});
