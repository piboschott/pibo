import * as fs from "node:fs";
import * as path from "node:path";
import type { PiboRoom } from "../../../chat/types/rooms.js";

export type RoomResolution =
	| { kind: "single"; room: PiboRoom; workspace: string }
	| { kind: "multiple"; rooms: readonly PiboRoom[]; workspace: string };

export type ResolveOptions = {
	fetchImpl?: typeof fetch;
};

export async function canonicalizePath(input: string): Promise<string> {
	const absolute = path.resolve(input);
	try {
		return fs.realpathSync(absolute);
	} catch {
		return absolute;
	}
}

export async function resolveRoomForWorkspace(
	baseUrl: string,
	workspaceFolder: string,
	options: ResolveOptions = {},
): Promise<RoomResolution> {
	const fetchImpl = options.fetchImpl ?? fetch;
	const canonicalPath = await canonicalizePath(workspaceFolder);

	const listUrl = `${baseUrl.replace(/\/$/, "")}/api/chat/rooms?workspace=${encodeURIComponent(canonicalPath)}`;
	const listRes = await fetchImpl(listUrl);
	if (!listRes.ok) throw new Error(`rooms list failed: ${listRes.status} ${listRes.statusText}`);
	const listBody = (await listRes.json()) as { rooms: PiboRoom[] };
	const rooms = listBody.rooms ?? [];

	if (rooms.length === 1) {
		return { kind: "single", room: rooms[0], workspace: canonicalPath };
	}
	if (rooms.length > 1) {
		return { kind: "multiple", rooms, workspace: canonicalPath };
	}

	const folderName = path.basename(canonicalPath) || "VS Code Workspace";
	const createUrl = `${baseUrl.replace(/\/$/, "")}/api/chat/rooms`;
	const createRes = await fetchImpl(createUrl, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			name: folderName,
			workspace: canonicalPath,
			metadata: { workspace: canonicalPath },
			type: "chat",
		}),
	});
	if (!createRes.ok) throw new Error(`room create failed: ${createRes.status} ${createRes.statusText}`);
	const createBody = (await createRes.json()) as { room: PiboRoom };
	return { kind: "single", room: createBody.room, workspace: canonicalPath };
}

export async function pickRoom(
	baseUrl: string,
	roomId: string,
	options: ResolveOptions = {},
): Promise<PiboRoom> {
	const fetchImpl = options.fetchImpl ?? fetch;
	const url = `${baseUrl.replace(/\/$/, "")}/api/chat/rooms/${encodeURIComponent(roomId)}`;
	const res = await fetchImpl(url);
	if (!res.ok) throw new Error(`room fetch failed: ${res.status} ${res.statusText}`);
	const body = (await res.json()) as { room: PiboRoom };
	return body.room;
}
