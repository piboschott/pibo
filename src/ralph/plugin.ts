import { definePiboPlugin } from '../plugins/registry.js';
import { createPiboRalphChannel, type PiboRalphChannelOptions } from './channel.js';
import { createBuiltInRalphStopConditions } from './stopping.js';

export function createPiboRalphPlugin(options: PiboRalphChannelOptions = {}) {
	return definePiboPlugin({
		id: 'pibo.ralph',
		name: 'Pibo Ralph',
		register(api) {
			for (const condition of createBuiltInRalphStopConditions()) api.registerRalphStopCondition(condition);
			api.registerChannel(createPiboRalphChannel(options));
		},
	});
}
