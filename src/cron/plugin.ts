import { definePiboPlugin } from "../plugins/registry.js";
import { createPiboCronChannel, type PiboCronChannelOptions } from "./channel.js";

export function createPiboCronPlugin(options: PiboCronChannelOptions = {}) {
	return definePiboPlugin({
		id: "pibo.cron",
		name: "Pibo Cron",
		register(api) {
			api.registerChannel(createPiboCronChannel(options));
		},
	});
}
