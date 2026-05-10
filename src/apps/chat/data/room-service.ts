import { randomUUID } from "node:crypto";
import { roomWorkspaceFromMetadata, type CreatePiboRoomInput, type PiboRoom, type PiboRoomMember, type PiboRoomNode, type PiboRoomRole, type UpdatePiboRoomInput } from "../types/rooms.js";
import type { PiboDataStore } from "../../../data/pibo-store.js";
import { roomFromRow, type MemberRow, type RoomRow } from "./chat-data-mappers.js";

export class ChatRoomService {
	constructor(private readonly store: PiboDataStore) {}

	createRoom(input: CreatePiboRoomInput): PiboRoom {
		const now = new Date().toISOString();
		const room: PiboRoom = { id: input.id ?? `room_${randomUUID()}`, ownerScope: input.ownerScope, name: input.name, topic: input.topic, workspace: roomWorkspaceFromMetadata(input.metadata), type: input.type ?? "chat", parentRoomId: input.parentRoomId, createdAt: now, updatedAt: now, retentionPolicyId: input.retentionPolicyId, metadata: input.metadata ?? {} };
		this.store.db.prepare(`INSERT INTO rooms (id, owner_scope, name, topic, type, parent_room_id, workspace, retention_policy_id, metadata_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(room.id, room.ownerScope, room.name, room.topic ?? null, room.type, room.parentRoomId ?? null, room.workspace ?? null, room.retentionPolicyId ?? null, JSON.stringify(room.metadata), room.createdAt, room.updatedAt);
		return room;
	}

	updateRoom(id: string, input: UpdatePiboRoomInput): PiboRoom | undefined {
		const existing = this.getRoom(id); if (!existing) return undefined;
		const metadata = input.metadata ?? existing.metadata;
		const updated = { ...existing, name: input.name ?? existing.name, topic: input.topic === null ? undefined : input.topic ?? existing.topic, parentRoomId: input.parentRoomId === null ? undefined : input.parentRoomId ?? existing.parentRoomId, retentionPolicyId: input.retentionPolicyId === null ? undefined : input.retentionPolicyId ?? existing.retentionPolicyId, metadata, workspace: roomWorkspaceFromMetadata(metadata), updatedAt: new Date().toISOString() };
		this.store.db.prepare("UPDATE rooms SET name = ?, topic = ?, parent_room_id = ?, workspace = ?, retention_policy_id = ?, metadata_json = ?, updated_at = ? WHERE id = ?").run(updated.name, updated.topic ?? null, updated.parentRoomId ?? null, updated.workspace ?? null, updated.retentionPolicyId ?? null, JSON.stringify(updated.metadata), updated.updatedAt, id);
		return this.getRoom(id);
	}

	deleteRooms(ids: string[]): number {
		if (!ids.length) return 0;
		const placeholders = ids.map(() => "?").join(", ");
		this.store.db.prepare(`DELETE FROM room_members WHERE room_id IN (${placeholders})`).run(...ids);
		const result = this.store.db.prepare(`DELETE FROM rooms WHERE id IN (${placeholders})`).run(...ids);
		return Number(result.changes ?? 0);
	}

	getRoom(id: string): PiboRoom | undefined { const row = this.store.db.prepare("SELECT * FROM rooms WHERE id = ?").get(id) as RoomRow | undefined; return row ? roomFromRow(row) : undefined; }
	listRooms(ownerScope: string): PiboRoom[] { return (this.store.db.prepare("SELECT * FROM rooms WHERE owner_scope = ? ORDER BY updated_at DESC, id ASC").all(ownerScope) as RoomRow[]).map(roomFromRow); }
	listRoomTree(ownerScope: string): PiboRoomNode[] { const byId = new Map(this.listRooms(ownerScope).map((room) => [room.id, { ...room, children: [] as PiboRoomNode[] }])); const roots: PiboRoomNode[] = []; for (const node of byId.values()) { const parent = node.parentRoomId ? byId.get(node.parentRoomId) : undefined; if (parent) parent.children.push(node); else roots.push(node); } return roots; }
	listRoomSubtree(roomId: string): PiboRoom[] { const root = this.getRoom(roomId); if (!root) return []; const rooms = this.listRooms(root.ownerScope); const byParent = new Map<string, PiboRoom[]>(); for (const room of rooms) if (room.parentRoomId) byParent.set(room.parentRoomId, [...(byParent.get(room.parentRoomId) ?? []), room]); const result: PiboRoom[] = []; const visit = (room: PiboRoom): void => { result.push(room); for (const child of byParent.get(room.id) ?? []) visit(child); }; visit(root); return result; }
	ensureDefaultRoom(input: { ownerScope: string; principalId: string; name?: string }): PiboRoom { const existing = this.listRooms(input.ownerScope).find((room) => room.metadata.default === true); if (existing) { this.ensureMember({ roomId: existing.id, principalId: input.principalId, role: "owner" }); return existing; } const room = this.createRoom({ ownerScope: input.ownerScope, name: input.name ?? "Personal Chat", type: "chat", metadata: { default: true } }); this.ensureMember({ roomId: room.id, principalId: input.principalId, role: "owner" }); return room; }
	ensureMember(input: { roomId: string; principalId: string; role: PiboRoomRole }): PiboRoomMember { const now = new Date().toISOString(); this.store.db.prepare("INSERT INTO room_members (room_id, principal_id, role, joined_at) VALUES (?, ?, ?, ?) ON CONFLICT(room_id, principal_id) DO UPDATE SET role = CASE WHEN room_members.role = 'owner' THEN room_members.role ELSE excluded.role END").run(input.roomId, input.principalId, input.role, now); const member = this.getMember(input.roomId, input.principalId); if (!member) throw new Error(`Failed to create room member for \"${input.roomId}\"`); return member; }
	getMember(roomId: string, principalId: string): PiboRoomMember | undefined { const row = this.store.db.prepare("SELECT * FROM room_members WHERE room_id = ? AND principal_id = ?").get(roomId, principalId) as MemberRow | undefined; return row ? { roomId: row.room_id, principalId: row.principal_id, role: row.role, joinedAt: row.joined_at, lastReadStreamId: row.last_read_stream_id ?? undefined } : undefined; }
	updateReadCursor(roomId: string, principalId: string, lastReadStreamId: number): PiboRoomMember | undefined { this.store.db.prepare("INSERT INTO principal_room_stats (room_id, principal_id, last_read_stream_id, last_read_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(room_id, principal_id) DO UPDATE SET last_read_stream_id = MAX(principal_room_stats.last_read_stream_id, excluded.last_read_stream_id), last_read_at = excluded.last_read_at, updated_at = excluded.updated_at").run(roomId, principalId, lastReadStreamId, new Date().toISOString(), new Date().toISOString()); return this.getMember(roomId, principalId); }
	requireRoomAccess(roomId: string, principalId: string, action: "read" | "write" | "admin" = "read"): PiboRoom { const room = this.getRoom(roomId); const member = room ? this.getMember(roomId, principalId) : undefined; if (!room || !member) throw new Error("Room is not available for this user"); if (action === "write" && member.role === "viewer") throw new Error("Room write access is required"); if (action === "admin" && member.role !== "owner" && member.role !== "admin") throw new Error("Room admin access is required"); return room; }
	close(): void {}
}
