import { definePiboPlugin } from '../plugins/registry.js';
import { createPiboRalphChannel, type PiboRalphChannelOptions } from './channel.js';

export function createPiboRalphPlugin(options: PiboRalphChannelOptions = {}) {
	return definePiboPlugin({
		id: 'pibo.ralph',
		name: 'Pibo Ralph',
		register(api) {
			api.registerChannel(createPiboRalphChannel(options));
		},
	});
}
