import { useState } from "react";
import type { PiboRoom } from "../../../chat/types/rooms.js";
import type { PiboWebSessionNode } from "../../../chat-ui/src/types.js";

export type SessionSelectorMode =
	| { kind: "sessions"; roomId: string; sessions: readonly PiboWebSessionNode[]; selectedPiboSessionId: string | null }
	| { kind: "rooms"; candidates: readonly PiboRoom[]; workspace: string };

export type SessionSelectorProps = {
	mode: SessionSelectorMode;
	onSelectSession: (piboSessionId: string) => void;
	onNewSession: (profile: string) => Promise<void>;
	onDeleteSession: (piboSessionId: string) => Promise<void>;
	onRenameSession: (piboSessionId: string, title: string) => Promise<void>;
	onSelectRoom: (roomId: string) => void;
};

export function SessionSelector({ mode, onSelectSession, onNewSession, onDeleteSession, onRenameSession, onSelectRoom }: SessionSelectorProps) {
	if (mode.kind === "rooms") {
		return <RoomPickerView candidates={mode.candidates} workspace={mode.workspace} onSelectRoom={onSelectRoom} />;
	}
	return <SessionListView sessions={mode.sessions} selectedPiboSessionId={mode.selectedPiboSessionId} onSelectSession={onSelectSession} onNewSession={onNewSession} onDeleteSession={onDeleteSession} onRenameSession={onRenameSession} />;
}

type StatusColor = "running" | "idle" | "error" | "completed";
function statusColor(status: string | undefined): StatusColor {
	if (status === "running") return "running";
	if (status === "error") return "error";
	if (status === "completed") return "completed";
	return "idle";
}

const STATUS_DOT: Record<StatusColor, string> = {
	running: "bg-cyan-400",
	idle: "bg-slate-500",
	error: "bg-rose-500",
	completed: "bg-emerald-500",
};

const STATUS_LABEL: Record<StatusColor, string> = {
	running: "running",
	idle: "idle",
	error: "error",
	completed: "completed",
};

function StatusPill({ status }: { status: string | undefined }) {
	const color = statusColor(status);
	return (
		<span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-slate-400">
			<span className={`inline-block w-1.5 h-1.5 rounded-full ${STATUS_DOT[color]}`} aria-hidden="true" />
			{STATUS_LABEL[color]}
		</span>
	);
}

function SessionListView({ sessions, selectedPiboSessionId, onSelectSession, onNewSession, onDeleteSession, onRenameSession }: {
	sessions: readonly PiboWebSessionNode[];
	selectedPiboSessionId: string | null;
	onSelectSession: (piboSessionId: string) => void;
	onNewSession: (profile: string) => Promise<void>;
	onDeleteSession: (piboSessionId: string) => Promise<void>;
	onRenameSession: (piboSessionId: string, title: string) => Promise<void>;
}) {
	const sorted = [...sessions].sort((a, b) => {
		const aT = a.lastActivityAt ?? "";
		const bT = b.lastActivityAt ?? "";
		return bT.localeCompare(aT);
	});
	return (
		<div className="flex items-center gap-2 border-b border-slate-800 px-3 py-2 bg-[#0c1820]" data-testid="session-list">
			<button
				type="button"
				className="shrink-0 w-7 h-7 inline-flex items-center justify-center rounded border border-slate-700 text-slate-300 hover:border-[#11a4d4] hover:text-[#11a4d4]"
				title="New session"
				onClick={() => void onNewSession("default")}
			>
				+
			</button>
			<ul className="flex gap-1 overflow-x-auto min-w-0">
				{sorted.map((session) => {
					const isActive = session.piboSessionId === selectedPiboSessionId;
					return (
						<li key={session.piboSessionId} className="shrink-0">
							<SessionRow
								session={session}
								isActive={isActive}
								onSelect={() => onSelectSession(session.piboSessionId)}
								onDelete={() => void onDeleteSession(session.piboSessionId)}
								onRename={(title) => void onRenameSession(session.piboSessionId, title)}
							/>
						</li>
					);
				})}
				{sorted.length === 0 && (
					<li className="text-xs text-slate-500 px-2 py-1">No sessions yet — click + to start one.</li>
				)}
			</ul>
		</div>
	);
}

function SessionRow({ session, isActive, onSelect, onDelete, onRename }: {
	session: PiboWebSessionNode;
	isActive: boolean;
	onSelect: () => void;
	onDelete: () => void;
	onRename: (title: string) => void;
}) {
	const [menuOpen, setMenuOpen] = useState(false);
	return (
		<div className={`group inline-flex items-center gap-2 rounded px-2 py-1 border ${isActive ? "border-[#11a4d4] bg-[#102834]" : "border-slate-700 bg-[#0a1418] hover:border-slate-500"}`}>
			<button type="button" onClick={onSelect} className="inline-flex items-center gap-2 text-left">
				<StatusPill status={session.status} />
				<span className="text-xs text-slate-200 max-w-[180px] truncate">{session.title || "Untitled"}</span>
			</button>
			<button
				type="button"
				className="text-slate-500 hover:text-slate-200 text-xs px-1"
				title="Session actions"
				aria-label="Session actions"
				onClick={(e) => {
					e.stopPropagation();
					setMenuOpen((v) => !v);
				}}
			>
				…
			</button>
			{menuOpen && (
				<div className="absolute z-10 mt-12 -ml-20 bg-[#0a1418] border border-slate-700 rounded shadow-lg text-xs">
					<button
						type="button"
						className="block w-full text-left px-3 py-1.5 hover:bg-[#102834]"
						onClick={(e) => {
							e.stopPropagation();
							setMenuOpen(false);
							const next = window.prompt("Rename session", session.title ?? "");
							if (next && next !== session.title) onRename(next);
						}}
					>
						Rename
					</button>
					<button
						type="button"
						className="block w-full text-left px-3 py-1.5 hover:bg-rose-900/30 text-rose-300"
						onClick={(e) => {
							e.stopPropagation();
							setMenuOpen(false);
							const confirm = window.confirm(`Delete session "${session.title ?? "Untitled"}"?`);
							if (confirm) onDelete();
						}}
					>
						Delete
					</button>
				</div>
			)}
		</div>
	);
}

function RoomPickerView({ candidates, workspace, onSelectRoom }: {
	candidates: readonly PiboRoom[];
	workspace: string;
	onSelectRoom: (roomId: string) => void;
}) {
	return (
		<div className="border-b border-slate-800 px-3 py-3 bg-[#0c1820]" data-testid="room-picker">
			<div className="text-[10px] uppercase tracking-wider text-slate-400 mb-2">
				Multiple rooms found for <span className="font-mono text-slate-300">{workspace}</span>
			</div>
			<ul className="flex flex-col gap-1">
				{candidates.map((room) => (
					<li key={room.id}>
						<button
							type="button"
							className="w-full text-left px-3 py-2 border border-slate-700 rounded hover:border-[#11a4d4] bg-[#0a1418]"
							onClick={() => onSelectRoom(room.id)}
						>
							<div className="font-semibold text-slate-200 text-sm">{room.name}</div>
							{room.topic && <div className="text-xs text-slate-400 mt-0.5">{room.topic}</div>}
							<div className="text-[10px] text-slate-500 mt-1">
								Created {formatDate(room.createdAt)} · Updated {formatDate(room.updatedAt)}
							</div>
						</button>
					</li>
				))}
			</ul>
		</div>
	);
}

function formatDate(iso: string): string {
	try {
		return new Date(iso).toLocaleString();
	} catch {
		return iso;
	}
}
