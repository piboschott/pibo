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

			for (const skillName of agent.skills) builder.addSkill(context.getSkill(skillName));
			for (const contextFileKey of agent.contextFiles) builder.addContextFile(context.getContextFile(contextFileKey));
			for (const toolName of agent.nativeTools) builder.addTool(context.getTool(toolName));
			for (const subagent of agent.subagents) builder.addSubagent(subagent);

			return builder.createSession();
		},
	};
}
