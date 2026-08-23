import { requestJson } from "./api-http";

export type SessionLivePreview = {
	id: string;
	piboSessionId: string;
	projectId?: string;
	label: string;
	targetHost: "127.0.0.1" | "::1";
	targetPort: number;
	managementMode: "external" | "managed";
	managed: boolean;
	serverState?: "stopped" | "starting" | "running" | "error";
	serverStartedAt?: string;
	serverStopAt?: string;
	serverStoppedAt?: string;
	createdAt: string;
	expiresAt: string;
	closedAt?: string;
	state: "active" | "expired" | "closed";
	health: "online" | "offline" | "starting" | "stopped" | "error" | "expired" | "closed";
	publicUrl: string;
	openUrl: string;
};

export async function getSessionLivePreviews(piboSessionId: string): Promise<{ configured: boolean; previews: SessionLivePreview[] }> {
	return requestJson(`/api/previews?piboSessionId=${encodeURIComponent(piboSessionId)}`);
}

export async function startSessionLivePreview(previewId: string): Promise<SessionLivePreview> {
	return (await requestJson<{ preview: SessionLivePreview }>(`/api/previews/${encodeURIComponent(previewId)}/start`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: "{}",
	})).preview;
}

export async function stopSessionLivePreview(previewId: string): Promise<SessionLivePreview> {
	return (await requestJson<{ preview: SessionLivePreview }>(`/api/previews/${encodeURIComponent(previewId)}/stop`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: "{}",
	})).preview;
}

export async function removeSessionLivePreview(previewId: string): Promise<{ removed: true; preview: SessionLivePreview }> {
	return requestJson(`/api/previews/${encodeURIComponent(previewId)}`, {
		method: "DELETE",
		headers: { "content-type": "application/json" },
	});
}
