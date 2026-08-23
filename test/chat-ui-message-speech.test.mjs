import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("assistant message views expose text-to-speech beside message timing", async () => {
	const [button, terminal, trace] = await Promise.all([
		readFile("src/apps/chat-ui/src/components/MessageSpeechButton.tsx", "utf8"),
		readFile("src/apps/chat-ui/src/session-views/compact-terminal/CompactTerminalSessionView.tsx", "utf8"),
		readFile("src/apps/chat-ui/src/tracing/SpanNode.tsx", "utf8"),
	]);

	assert.match(button, /data-pibo-component="MessageSpeechButton"/);
	assert.match(button, /LoaderCircle[\s\S]*animate-spin/);
	assert.match(button, /<Mic size=\{12\}/);
	assert.match(button, /aria-label=\{label\}/);
	assert.match(button, /new RTCPeerConnection\(\)/);
	assert.match(button, /new AudioContext\(\)/);
	assert.match(button, /addTransceiver\(triggerTrack, \{ direction: "sendrecv"/);
	assert.match(button, /session\.context\.appended/);
	assert.match(button, /output_transcript\.added/);
	assert.match(button, /playSpeechTrigger/);
	assert.match(button, /createMediaStreamSource/);
	assert.match(button, /getFloatTimeDomainData/);
	assert.match(button, /OUTPUT_SILENCE_MS/);
	assert.match(button, /icegatheringstatechange/);
	assert.match(button, /peer\.localDescription\?\.sdp/);
	assert.match(button, /startChatSpeechSession/);
	assert.match(button, /speakChatSpeech/);
	assert.match(button, /role="alert"/);
	assert.match(terminal, /row\.kind === "message\.assistant"[\s\S]*speechText=/);
	assert.match(terminal, /TerminalMessageMetadata[\s\S]*MessageSpeechButton/);
	assert.match(trace, /span\.spanType === "model\.response"[\s\S]*speechText/);
	assert.match(trace, /SpanHeaderTiming[\s\S]*MessageSpeechButton/);
});

test("speech provider selection is available in Web UI settings", async () => {
	const [view, sidebar, routes] = await Promise.all([
		readFile("src/apps/chat-ui/src/settings/SettingsView.tsx", "utf8"),
		readFile("src/apps/chat-ui/src/settings/SettingsSidebar.tsx", "utf8"),
		readFile("src/apps/chat-ui/src/app-routes.ts", "utf8"),
	]);

	assert.match(sidebar, /onSelect\("speech"\)/);
	assert.match(view, /activePanel === "speech"/);
	assert.match(view, /SpeechProviderSettings/);
	assert.match(view, /getSpeechProviders/);
	assert.match(view, /patchUserSettings\(\{ speech: \{ providerId \} \}\)/);
	assert.match(routes, /part === "speech"/);
	assert.match(routes, /panel === "speech"/);
});
