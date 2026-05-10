import type { PiboChannel } from "../channels/types.js";
import { PiboCronService, type PiboCronServiceOptions } from "./service.js";
import { createDefaultPiboCronStore } from "./store.js";

export type PiboCronChannelOptions = Omit<PiboCronServiceOptions, "context" | "store"> & {
	cronStorePath?: string;
};

let currentCronService: PiboCronService | undefined;

export function getPiboCronService(): PiboCronService | undefined {
	return currentCronService;
}

export function createPiboCronChannel(options: PiboCronChannelOptions = {}): PiboChannel {
	return {
		name: "pibo.cron",
		kind: "custom",
		description: "Runs scheduled Pibo agent jobs.",
		auth: { mode: "required" },
		start(context) {
			if (currentCronService) return;
			currentCronService = new PiboCronService({
				...options,
				context,
				store: createDefaultPiboCronStore({ path: options.cronStorePath }),
			});
			currentCronService.start();
		},
		stop() {
			currentCronService?.stop();
			currentCronService = undefined;
		},
	};
}
