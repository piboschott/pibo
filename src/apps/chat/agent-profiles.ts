import { InitialSessionContextBuilder } from "../../core/profiles.js";
import type { PiboProfileDefinition } from "../../plugins/types.js";
import type { CustomAgentDefinition } from "./agent-store.js";

export function createCustomAgentProfileDefinition(agent: CustomAgentDefinition): PiboProfileDefinition {
	return {
		name: agent.profileName,
		aliases: [agent.id, `custom-agent:${agent.id}`],
		description: agent.description || agent.displayName,
		create(context) {
			const builder = new InitialSessionContextBuilder(agent.profileName)
				.withBuiltinTools(agent.builtinTools)
				.withBuiltinToolNames(agent.builtinToolNames)
				.withAutoContextFiles(agent.autoContextFiles)
				.withMcpServers(agent.mcpServers)
				.withPiPackages(agent.piPackages.map((id) => ({ id })))
				.withToolPackages({ runControl: agent.runControl });
			if (agent.mainModel) builder.withMainModel(agent.mainModel);
			if (agent.subagentModel) builder.withSubagentModel(agent.subagentModel);

			for (const skillName of agent.skills) builder.addSkill(context.getSkill(skillName));
			for (const contextFileKey of agent.contextFiles) {
				try {
					builder.addContextFile(context.getContextFile(contextFileKey));
				} catch (error) {
					if (!isUnknownContextFileError(error, contextFileKey)) throw error;
					console.warn(`Skipping unknown context file "${contextFileKey}" for custom agent "${agent.profileName}"`);
				}
			}
			for (const toolName of agent.nativeTools) builder.addTool(context.getTool(toolName));
			for (const subagent of agent.subagents) builder.addSubagent(subagent);

			return builder.createSession();
		},
	};
}

function isUnknownContextFileError(error: unknown, contextFileKey: string): boolean {
	return error instanceof Error && error.message === `Unknown context file "${contextFileKey}"`;
}
