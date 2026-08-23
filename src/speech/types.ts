export type PiboSpeechSessionStartRequest = {
	offerSdp: string;
	text: string;
};

export type PiboSpeechSessionStartResult = {
	providerId: string;
	sessionId: string;
	answerSdp: string;
};

export type PiboSpeechRequest = {
	text: string;
};

export type PiboSpeechProviderInfo = {
	id: string;
	name: string;
	description?: string;
	configured: boolean;
	pluginId?: string;
	pluginName?: string;
};

export type PiboSpeechProvider = {
	id: string;
	name: string;
	description?: string;
	pluginId?: string;
	isConfigured?(): boolean | Promise<boolean>;
	startSession(input: PiboSpeechSessionStartRequest): Promise<Omit<PiboSpeechSessionStartResult, "providerId">>;
	speak(sessionId: string, input: PiboSpeechRequest): Promise<void>;
	stopSession(sessionId: string): Promise<void>;
	dispose?(): Promise<void> | void;
};

export type PiboSpeechErrorCode = "not_configured" | "invalid_offer" | "invalid_text" | "session_not_found" | "provider_error";

export class PiboSpeechError extends Error {
	constructor(
		message: string,
		readonly code: PiboSpeechErrorCode,
		options?: ErrorOptions,
	) {
		super(message, options);
		this.name = "PiboSpeechError";
	}
}
