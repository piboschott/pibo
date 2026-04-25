import { runGatewayClient } from "./gateway/client.js";
import { runGatewayServer } from "./gateway/server.js";
import {
	createDefaultPiboProfile,
	createGatewayProducerPiboProfile,
	type InitialSessionContext,
} from "./profiles.js";
import { inspectPiboProfile, runPiboTui } from "./runtime.js";
import { PiboSessionRouter } from "./session-router.js";

export {
	createDefaultPiboProfile,
	createGatewayProducerPiboProfile,
	InitialSessionContext,
	InitialSessionContextBuilder,
} from "./profiles.js";
export type { BuiltinToolsMode, ContextFileProfile, InitialSessionContextOptions, SkillProfile, ToolProfile } from "./profiles.js";
export { createPiboGatewayToolProfiles } from "./gateway/tool.js";
export { createPiboTestToolProfiles } from "./tools.js";
export { createPiboRuntime, inspectPiboProfile, runPiboTui } from "./runtime.js";
export type { PiboProfileInspection, PiboRuntimeOptions } from "./runtime.js";
export { PiboSessionRouter } from "./session-router.js";
export { PiboGatewayServer, runGatewayServer } from "./gateway/server.js";
export { runGatewayClient } from "./gateway/client.js";
export { sendGatewayEvent, sendGatewayMessageAndWaitForReply } from "./gateway/request.js";
export type {
	PiboEventListener,
	PiboEventSource,
	PiboExecutionAction,
	PiboExecutionEvent,
	PiboInputEvent,
	PiboMessageEvent,
	PiboOutputEvent,
	PiboSessionStatus,
} from "./events.js";
export type { PiboSessionRouterOptions } from "./session-router.js";

function createCliProfile(profileName?: string): InitialSessionContext {
	if (!profileName || profileName === "minimal" || profileName === "pibo-minimal") {
		return createDefaultPiboProfile();
	}
	if (profileName === "gateway-producer" || profileName === "pibo-gateway-producer") {
		return createGatewayProducerPiboProfile();
	}

	throw new Error(`Unknown profile "${profileName}". Available profiles: minimal, gateway-producer`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const command = process.argv[2] ?? "profile";

	if (command === "tui") {
		await runPiboTui({ profile: createCliProfile(process.argv[3]) });
	} else if (command === "profile") {
		const inspection = await inspectPiboProfile({ profile: createCliProfile(process.argv[3]) });
		console.log(JSON.stringify(inspection, null, 2));
	} else if (command === "router") {
		const router = new PiboSessionRouter({ persistSession: false });
		const event = await router.emit({
			type: "execution",
			sessionKey: process.argv[3] ?? "demo",
			action: "status",
		});
		console.log(JSON.stringify(event, null, 2));
		await router.disposeAll();
	} else if (command === "gateway") {
		await runGatewayServer();
	} else if (command === "client") {
		await runGatewayClient({ sessionKey: process.argv[3] ?? "default" });
	} else {
		console.error(`Unknown command: ${command}`);
		process.exitCode = 1;
	}
}
