import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { ChatReadStateService } from '../dist/apps/chat/data/read-state-service.js';
import { ChatRoomService } from '../dist/apps/chat/data/room-service.js';
import { PiboDataStore } from '../dist/data/pibo-store.js';
import { NavigationStore } from '../dist/data/navigation-store.js';
import { PiboDataSessionStore } from '../dist/sessions/pibo-data-store.js';

function tempDir() {
  return mkdtempSync(join(tmpdir(), 'pibo-shared-compat-'));
}

test('compat hotfix reads current user and shared app sessions rooms and navigation without normalizing rows', () => {
  const dir = tempDir();
  try {
    const path = join(dir, 'pibo.sqlite');
    const store = new PiboDataStore(path, { payloadRootDir: join(dir, 'payloads') });
    store.db.prepare("INSERT INTO rooms (id, owner_scope, name, type, metadata_json, created_at, updated_at) VALUES ('room_user', 'user:a', 'User room', 'chat', '{}', 'now', 'now')").run();
    store.db.prepare("INSERT INTO rooms (id, owner_scope, name, type, metadata_json, created_at, updated_at) VALUES ('room_shared', 'shared:app', 'Shared room', 'chat', '{}', 'now', 'now')").run();
    store.db.prepare("INSERT INTO room_members (room_id, principal_id, role, joined_at) VALUES ('room_shared', 'shared:app', 'owner', 'now')").run();
    store.db.prepare("INSERT INTO sessions (id, pi_session_id, owner_scope, room_id, channel, kind, profile, title, metadata_json, created_at, updated_at, last_activity_at) VALUES ('ps_user', 'pi_user', 'user:a', 'room_user', 'chat-web', 'chat', 'base', 'User', '{}', 'now', 'now', 'now')").run();
    store.db.prepare("INSERT INTO sessions (id, pi_session_id, owner_scope, room_id, channel, kind, profile, title, metadata_json, created_at, updated_at, last_activity_at) VALUES ('ps_shared', 'pi_shared', 'shared:app', 'room_shared', 'chat-web', 'chat', 'base', 'Shared', '{}', 'now', 'now', 'now')").run();
    store.db.prepare("INSERT INTO session_navigation (owner_scope, room_id, session_id, title, profile, status, last_activity_at, sort_key, updated_at) VALUES ('user:a', 'room_user', 'ps_user', 'User', 'base', 'idle', 'now', '2', 'now')").run();
    store.db.prepare("INSERT INTO session_navigation (owner_scope, room_id, session_id, title, profile, status, last_activity_at, sort_key, updated_at) VALUES ('shared:app', 'room_shared', 'ps_shared', 'Shared', 'base', 'idle', 'now', '1', 'now')").run();

    const sessions = new PiboDataSessionStore(store).find({ ownerScope: 'user:a' }).map((session) => session.id).sort();
    assert.deepEqual(sessions, ['ps_shared', 'ps_user']);

    const rooms = new ChatRoomService(store);
    assert.deepEqual(rooms.listRooms('user:a').map((room) => room.id).sort(), ['room_shared', 'room_user']);
    assert.equal(rooms.requireRoomAccess('room_shared', 'user:a', 'read').id, 'room_shared');

    const navigation = new NavigationStore(store.db).listSessions({ ownerScope: 'user:a', includeArchived: true }).map((session) => session.sessionId).sort();
    assert.deepEqual(navigation, ['ps_shared', 'ps_user']);

    assert.deepEqual(store.db.prepare('SELECT DISTINCT owner_scope FROM sessions ORDER BY owner_scope').all().map((row) => row.owner_scope), ['shared:app', 'user:a']);
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('compat hotfix unread counts consider shared app read cursors', () => {
  const dir = tempDir();
  try {
    const path = join(dir, 'pibo.sqlite');
    const store = new PiboDataStore(path, { payloadRootDir: join(dir, 'payloads') });
    store.db.prepare("INSERT INTO sessions (id, pi_session_id, owner_scope, channel, kind, profile, title, metadata_json, created_at, updated_at, last_activity_at) VALUES ('ps_shared', 'pi_shared', 'shared:app', 'chat-web', 'chat', 'base', 'Shared', '{}', 'now', 'now', 'now')").run();
    store.db.prepare("INSERT INTO principal_session_stats (session_id, principal_id, last_read_stream_id, updated_at) VALUES ('ps_shared', 'shared:app', 10, 'now')").run();
    store.db.prepare("INSERT INTO event_log (stream_id, session_id, topic, type, source, actor_type, actor_id, retention_class, created_at) VALUES (9, 'ps_shared', 'chat', 'assistant_message', 'test', 'assistant', 'assistant', 'chat_message', 'now')").run();
    store.db.prepare("INSERT INTO event_log (stream_id, session_id, topic, type, source, actor_type, actor_id, retention_class, created_at) VALUES (11, 'ps_shared', 'chat', 'assistant_message', 'test', 'assistant', 'assistant', 'chat_message', 'now')").run();

    const counts = new ChatReadStateService(store).countUnreadMessagesBySession({ piboSessionIds: ['ps_shared'], principalId: 'user:a' });
    assert.equal(counts.get('ps_shared'), 1);
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
