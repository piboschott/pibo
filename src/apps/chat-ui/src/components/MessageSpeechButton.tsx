import { useEffect, useRef, useState, type MouseEvent } from "react";
import { LoaderCircle, Mic } from "lucide-react";
import { speakChatSpeech, startChatSpeechSession, stopChatSpeechSession } from "../api-speech";

type SpeechButtonState = "idle" | "loading" | "playing" | "error";
type SpeechTriggerAudio = {
	context: AudioContext;
	destination: MediaStreamAudioDestinationNode;
	outputSource?: MediaStreamAudioSourceNode;
	outputAnalyser?: AnalyserNode;
	monitor?: ReturnType<typeof setInterval>;
	timer?: ReturnType<typeof setTimeout>;
	triggered: boolean;
};

const ICE_GATHERING_TIMEOUT_MS = 2_000;
const CONTEXT_APPEND_DEBOUNCE_MS = 150;
const SPEECH_TRIGGER_DURATION_SECONDS = 1.2;
const OUTPUT_MONITOR_INTERVAL_MS = 50;
const OUTPUT_SILENCE_MS = 900;
const OUTPUT_ACTIVITY_RMS = 0.005;

async function waitForIceGathering(peer: RTCPeerConnection): Promise<void> {
	if (peer.iceGatheringState === "complete") return;
	await new Promise<void>((resolve) => {
		const finish = () => {
			clearTimeout(timer);
			peer.removeEventListener("icegatheringstatechange", handleStateChange);
			resolve();
		};
		const handleStateChange = () => {
			if (peer.iceGatheringState === "complete") finish();
		};
		const timer = setTimeout(finish, ICE_GATHERING_TIMEOUT_MS);
		peer.addEventListener("icegatheringstatechange", handleStateChange);
	});
}

function controlMessageType(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	try {
		const parsed = JSON.parse(value);
		return parsed && typeof parsed === "object" && typeof parsed.type === "string" ? parsed.type : undefined;
	} catch {
		return undefined;
	}
}

function playSpeechTrigger(trigger: SpeechTriggerAudio): void {
	const sampleRate = trigger.context.sampleRate;
	const frameCount = Math.ceil(sampleRate * SPEECH_TRIGGER_DURATION_SECONDS);
	const fadeFrames = Math.max(1, Math.floor(sampleRate * 0.05));
	const buffer = trigger.context.createBuffer(1, frameCount, sampleRate);
	const samples = buffer.getChannelData(0);
	for (let index = 0; index < samples.length; index += 1) {
		const envelope = Math.min(1, index / fadeFrames, (samples.length - index - 1) / fadeFrames);
		samples[index] = (Math.random() * 2 - 1) * 0.14 * Math.max(0, envelope);
	}
	const source = trigger.context.createBufferSource();
	source.buffer = buffer;
	source.connect(trigger.destination);
	source.start();
}

export function MessageSpeechButton({ text, className = "" }: { text: string; className?: string }) {
	const [state, setState] = useState<SpeechButtonState>("idle");
	const [error, setError] = useState<string | null>(null);
	const peerRef = useRef<RTCPeerConnection | null>(null);
	const triggerAudioRef = useRef<SpeechTriggerAudio | null>(null);
	const sessionIdRef = useRef<string | null>(null);
	const requestIdRef = useRef(0);

	const disposePlayback = () => {
		const peer = peerRef.current;
		if (peer) {
			peer.ontrack = null;
			peer.onconnectionstatechange = null;
			peer.close();
		}
		peerRef.current = null;
		const trigger = triggerAudioRef.current;
		if (trigger) {
			if (trigger.monitor) clearInterval(trigger.monitor);
			if (trigger.timer) clearTimeout(trigger.timer);
			trigger.outputSource?.disconnect();
			trigger.outputAnalyser?.disconnect();
			for (const track of trigger.destination.stream.getTracks()) track.stop();
			void trigger.context.close().catch(() => {});
		}
		triggerAudioRef.current = null;
	};

	const stopRemoteSession = () => {
		const sessionId = sessionIdRef.current;
		sessionIdRef.current = null;
		if (sessionId) void stopChatSpeechSession(sessionId).catch(() => {});
	};

	useEffect(() => () => {
		requestIdRef.current += 1;
		disposePlayback();
		stopRemoteSession();
	}, []);

	const fail = (requestId: number, caught: unknown) => {
		if (requestIdRef.current !== requestId) return;
		requestIdRef.current += 1;
		disposePlayback();
		stopRemoteSession();
		setError(caught instanceof Error ? caught.message : String(caught));
		setState("error");
	};

	const handleClick = async (event: MouseEvent<HTMLButtonElement>) => {
		event.stopPropagation();
		if (state === "loading") return;
		if (state === "playing") {
			requestIdRef.current += 1;
			disposePlayback();
			stopRemoteSession();
			setState("idle");
			return;
		}

		const requestId = requestIdRef.current + 1;
		requestIdRef.current = requestId;
		disposePlayback();
		stopRemoteSession();
		setError(null);
		setState("loading");
		try {
			if (typeof RTCPeerConnection === "undefined" || typeof AudioContext === "undefined") {
				throw new Error("This browser does not support speech playback");
			}
			const peer = new RTCPeerConnection();
			const triggerContext = new AudioContext();
			await triggerContext.resume();
			const triggerDestination = triggerContext.createMediaStreamDestination();
			const triggerAudio: SpeechTriggerAudio = {
				context: triggerContext,
				destination: triggerDestination,
				triggered: false,
			};
			peerRef.current = peer;
			triggerAudioRef.current = triggerAudio;
			peer.onconnectionstatechange = () => {
				if (peer.connectionState === "failed") fail(requestId, new Error("Speech connection failed"));
			};
			peer.ontrack = (trackEvent) => {
				if (requestIdRef.current !== requestId) return;
				const stream = trackEvent.streams[0] ?? new MediaStream([trackEvent.track]);
				const outputSource = triggerContext.createMediaStreamSource(stream);
				const outputAnalyser = triggerContext.createAnalyser();
				outputAnalyser.fftSize = 1024;
				outputSource.connect(outputAnalyser);
				outputAnalyser.connect(triggerContext.destination);
				triggerAudio.outputSource = outputSource;
				triggerAudio.outputAnalyser = outputAnalyser;
				const samples = new Float32Array(outputAnalyser.fftSize);
				let heardAudio = false;
				let lastAudioAt = 0;
				triggerAudio.monitor = setInterval(() => {
					if (requestIdRef.current !== requestId) return;
					outputAnalyser.getFloatTimeDomainData(samples);
					let sumOfSquares = 0;
					for (const sample of samples) sumOfSquares += sample * sample;
					const rms = Math.sqrt(sumOfSquares / samples.length);
					const now = performance.now();
					if (rms >= OUTPUT_ACTIVITY_RMS) {
						lastAudioAt = now;
						if (!heardAudio) {
							heardAudio = true;
							setState("playing");
						}
					} else if (heardAudio && now - lastAudioAt >= OUTPUT_SILENCE_MS) {
						requestIdRef.current += 1;
						stopRemoteSession();
						disposePlayback();
						setState("idle");
					}
				}, OUTPUT_MONITOR_INTERVAL_MS);
				trackEvent.track.addEventListener("ended", () => {
					if (requestIdRef.current !== requestId) return;
					requestIdRef.current += 1;
					disposePlayback();
					sessionIdRef.current = null;
					setState("idle");
				}, { once: true });
			};
			const triggerTrack = triggerDestination.stream.getAudioTracks()[0];
			if (!triggerTrack) throw new Error("Could not create a speech audio connection");
			peer.addTransceiver(triggerTrack, { direction: "sendrecv", streams: [triggerDestination.stream] });
			const controlChannel = peer.createDataChannel("oai-events");
			controlChannel.addEventListener("message", (controlEvent) => {
				if (requestIdRef.current !== requestId) return;
				const messageType = controlMessageType(controlEvent.data);
				if (messageType === "output_transcript.added") setState("playing");
				if (messageType !== "session.context.appended") return;
				const trigger = triggerAudioRef.current;
				if (!trigger || trigger.triggered) return;
				if (trigger.timer) clearTimeout(trigger.timer);
				trigger.timer = setTimeout(() => {
					if (requestIdRef.current !== requestId || trigger.triggered) return;
					trigger.triggered = true;
					try {
						playSpeechTrigger(trigger);
					} catch (caught) {
						fail(requestId, caught);
					}
				}, CONTEXT_APPEND_DEBOUNCE_MS);
			});
			const offer = await peer.createOffer();
			await peer.setLocalDescription(offer);
			await waitForIceGathering(peer);
			const offerSdp = peer.localDescription?.sdp;
			if (!offerSdp) throw new Error("Could not create a speech audio connection");
			const session = await startChatSpeechSession(offerSdp, text);
			if (requestIdRef.current !== requestId) {
				void stopChatSpeechSession(session.sessionId).catch(() => {});
				return;
			}
			sessionIdRef.current = session.sessionId;
			void speakChatSpeech(session.sessionId, text)
				.then(() => {
					if (requestIdRef.current !== requestId) return;
					requestIdRef.current += 1;
					sessionIdRef.current = null;
					disposePlayback();
					setState("idle");
				})
				.catch((caught) => fail(requestId, caught));
			await peer.setRemoteDescription({ type: "answer", sdp: session.answerSdp });
		} catch (caught) {
			fail(requestId, caught);
		}
	};

	const label = state === "loading"
		? "Generating message audio"
		: state === "playing"
			? "Stop message audio"
			: state === "error"
				? "Retry message audio"
				: "Read message aloud";

	return (
		<>
			<button
				type="button"
				onClick={(event) => void handleClick(event)}
				onDoubleClick={(event) => event.stopPropagation()}
				disabled={state === "loading"}
				aria-label={label}
				title={error ?? label}
				data-pibo-component="MessageSpeechButton"
				data-speech-state={state}
				className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-slate-500 transition-colors hover:bg-slate-700/60 hover:text-[#11a4d4] focus:outline-none focus:ring-1 focus:ring-[#11a4d4] disabled:cursor-wait ${state === "error" ? "text-red-400" : ""} ${className}`}
			>
				{state === "loading" ? <LoaderCircle size={12} className="animate-spin" /> : <Mic size={12} />}
			</button>
			{error ? <span className="sr-only" role="alert">{error}</span> : null}
		</>
	);
}
