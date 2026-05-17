import type { PiboChannel } from '../channels/types.js';
import { PiboRalphService, type PiboRalphServiceOptions } from './service.js';
import { createDefaultPiboRalphStore } from './store.js';

export type PiboRalphChannelOptions = Omit<PiboRalphServiceOptions, 'context' | 'store'> & { ralphStorePath?: string };
let currentRalphService: PiboRalphService | undefined;
export function getPiboRalphService(): PiboRalphService | undefined { return currentRalphService; }
export function createPiboRalphChannel(options: PiboRalphChannelOptions = {}): PiboChannel {
	return { name: 'pibo.ralph', kind: 'custom', description: 'Runs continuous Ralph Pibo agent jobs.', auth: { mode: 'trusted-local' }, start(context) { if (currentRalphService) return; currentRalphService = new PiboRalphService({ ...options, context, store: createDefaultPiboRalphStore({ path: options.ralphStorePath }) }); currentRalphService.start(); }, stop() { currentRalphService?.stop(); currentRalphService = undefined; } };
}
