import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

async function runLatestRequestScenarios() {
	const script = `
		import assert from "node:assert/strict";
		const {
			LatestProjectsRequestGate,
			projectsBootstrapRequestKey,
		} = await import("./src/apps/chat-ui/src/projects/projects-request-gate.ts");

		const deferred = () => {
			let resolve;
			const promise = new Promise((next) => { resolve = next; });
			return { promise, resolve };
		};
		const gate = new LatestProjectsRequestGate();
		let currentRequestKey = projectsBootstrapRequestKey("project-alpha", "ps-alpha", false);
		let data = "initial";
		let loading = false;

		const begin = (requestKey, response) => {
			const token = gate.begin(requestKey);
			loading = true;
			return response.promise.then((next) => {
				if (!gate.isCurrent(token, currentRequestKey)) return;
				data = next;
				loading = false;
			});
		};

		const alphaResponse = deferred();
		const alphaRun = begin(currentRequestKey, alphaResponse);
		const betaRequestKey = projectsBootstrapRequestKey("project-beta", "ps-beta", false);
		currentRequestKey = betaRequestKey;
		const betaResponse = deferred();
		const betaRun = begin(betaRequestKey, betaResponse);

		alphaResponse.resolve("stale-alpha");
		await alphaRun;
		assert.equal(data, "initial", "an out-of-order response must not replace current data");
		assert.equal(loading, true, "an out-of-order response must not clear the current loading state");

		betaResponse.resolve("current-beta");
		await betaRun;
		assert.equal(data, "current-beta");
		assert.equal(loading, false);

		const betaRefresh = deferred();
		const betaRefreshRun = begin(betaRequestKey, betaRefresh);
		const gammaRequestKey = projectsBootstrapRequestKey("project-gamma", "ps-gamma", true);
		currentRequestKey = gammaRequestKey;
		betaRefresh.resolve("stale-beta-refresh");
		await betaRefreshRun;
		assert.equal(data, "current-beta", "a response for a superseded route must not replace data");
		assert.equal(loading, true, "the newly requested route must remain loading after a stale response");

		const gammaResponse = deferred();
		const gammaRun = begin(gammaRequestKey, gammaResponse);
		gammaResponse.resolve("current-gamma");
		await gammaRun;
		assert.equal(data, "current-gamma");
		assert.equal(loading, false);

		gate.abort();
		assert.equal(gate.isCurrent(gate.begin(gammaRequestKey), gammaRequestKey), true);
	`;
	await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd() });
}

test("Projects bootstrap is last-request-wins for both data and loading state", async () => {
	await assert.doesNotReject(runLatestRequestScenarios());
});
