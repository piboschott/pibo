import type { PiboDataStore } from "../../../data/pibo-store.js";

export class ChatNavigationQueryService {
	constructor(private readonly store: PiboDataStore) {}

	// Reserved for V2-native sidebar/navigation queries. Current Chat Web call sites
	// still compose navigation from session and room services.
	close(): void {
		void this.store;
	}
}
