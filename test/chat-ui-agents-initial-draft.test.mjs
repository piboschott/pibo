import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

test("Agent Designer exposes a uniquely named unsaved draft on initial load", async () => {
	const source = readFileSync("src/apps/chat-ui/src/agents/AgentsView.tsx", "utf8");
	assert.match(source, /createBlankAgentDraft\(initialCatalog, uniqueDraftAgentName\(agentNamesInUse\(agents, initialCustomAgents\)\)\)/);
	assert.match(source, /agents\.flatMap\(\(agent\) => \[agent\.name, \.\.\.agent\.aliases\]\)/);
	assert.match(source, /customAgents\.flatMap\(\(agent\) => \[agent\.profileName, \.\.\.\(agent\.profileAliases \?\? \[\]\), agent\.displayName\]\)/);
	assert.match(source, /const \[showUnsavedAgentDraft, setShowUnsavedAgentDraft\] = useState\(true\)/);

	const script = `
		import assert from "node:assert/strict";
		const { saveCustomAgentDraft } = await import("./src/apps/chat-ui/src/api-agent-designer.ts");
		const { uniqueDraftAgentName } = await import("./src/apps/chat-ui/src/agents/agent-designer-model.ts");
		assert.equal(uniqueDraftAgentName(["new-agent", "other-agent"]), "new-agent-1");
		assert.equal(uniqueDraftAgentName(["renamed-agent", "new-agent"]), "new-agent-1");

		const calls = [];
		globalThis.fetch = async (url, init = {}) => {
			calls.push({ url, method: init.method });
			return new Response(JSON.stringify({ agent: { id: "agent-1" } }), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		};
		const input = {
			displayName: "new-agent",
			nativeTools: [],
			skills: [],
			contextFiles: [],
			subagents: [],
			mcpServers: [],
			piPackages: [],
			builtinTools: "default",
			builtinToolNames: [],
			autoContextFiles: true,
			runControl: false,
		};
		await saveCustomAgentDraft(undefined, input);
		await saveCustomAgentDraft("agent/existing", input);
		assert.deepEqual(calls, [
			{ url: "/api/chat/agents", method: "POST" },
			{ url: "/api/chat/agents/agent%2Fexisting", method: "PATCH" },
		]);
	`;
	await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd() });
});
