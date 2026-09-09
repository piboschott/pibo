import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { PrefixCapsuleStore } from '../dist/sessions/prefix-capsule.js';
import { PrefixResourceBundleStore } from '../dist/sessions/prefix-resources.js';
import { PrefixSessionOwnership } from '../dist/sessions/prefix-ownership.js';
import { createStorageBackup, verifyStorageBackup, restoreStorageBackup } from '../dist/data/storage-backup.js';

for (const adapter of ['pi','codex-native','orp']) test(`backup restores ${adapter} capsules, resources and native history at the original paths`, async t => {
 const root=await mkdtemp(join(tmpdir(),'pibo-prefix-backup-')),home=join(root,'home'),destination=join(root,'archive');
 await mkdir(home);t.after(()=>rm(root,{recursive:true,force:true}));
 const source=join(home,'sessions.sqlite'),native=join(home,'native-session'),capsules=new PrefixCapsuleStore(join(home,'session-prefixes'));
 const capsule=await capsules.put(adapter,'fixture/v1','original model prefix');
 const resources=await new PrefixResourceBundleStore(capsules).put(adapter,{format:1,context:[{id:'context',label:'Context',required:true,order:0,content:'original selected context'}],skills:[],files:[]});
 let nativeDb;
 if(adapter==='orp'){nativeDb=new DatabaseSync(native);nativeDb.exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE history(value TEXT); INSERT INTO history VALUES('original native history');");}
 else await writeFile(native,'{"native":"original history"}\n');
 const db=new DatabaseSync(source);
 db.exec('CREATE TABLE session_runtime_bindings(pibo_session_id TEXT,runtime_adapter_id TEXT,native_session_id TEXT,locator_json TEXT,metadata_json TEXT,revision INTEGER)');
 const metadata={piboSessionPrefix:{format:1,epoch:1,status:'sealed',capsule,reason:'initial',nativeSessionId:'native-1',evidence:'adapter-inputs'},piboSessionPrefixResources:resources.reference,nativeSessionFile:native};
 db.prepare('INSERT INTO session_runtime_bindings VALUES(?,?,?,?,?,?)').run('ps_fixture',adapter,'native-1',null,JSON.stringify(metadata),1);
 await writeFile(join(home,'auth.json'),'fixture credential must not enter archive');
 let manifest;
 try{manifest=await createStorageBackup({source,payloadRoot:join(home,'payloads'),destination,maxBytes:16*1024*1024});}
 finally{db.close();nativeDb?.close();}
 assert.ok(manifest.runtimeCatalogSha256);await verifyStorageBackup(destination);
 assert.equal((await readdir(join(destination,'runtime'))).includes('auth.json'),false);
 await assert.rejects(restoreStorageBackup(destination,join(root,'relocated')),/original home path/);
 await rm(home,{recursive:true});
 const restored=await restoreStorageBackup(destination,home);
 assert.equal(restored.database,source);
 assert.equal(await capsules.read(capsule,capsule),'original model prefix');
 assert.equal((await new PrefixResourceBundleStore(capsules).restore(resources.reference)).context[0].content,'original selected context');
 if(adapter==='orp'){const reopened=new DatabaseSync(native);try{assert.equal(reopened.prepare('SELECT value FROM history').get().value,'original native history');}finally{reopened.close();}}
 else assert.equal(await readFile(native,'utf8'),'{"native":"original history"}\n');
 await writeFile(join(destination,'runtime','native-session'),'corrupt');
 await assert.rejects(verifyStorageBackup(destination),/hash mismatch/);
});

test('backup refuses a live protected owner before creating a misleading database-only archive',async t=>{
 const root=await mkdtemp(join(tmpdir(),'pibo-prefix-backup-owner-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const source=join(root,'source.sqlite'),db=new DatabaseSync(source),store=new PrefixCapsuleStore(join(root,'session-prefixes'));
 const capsule=await store.put('pi','fixture/v1','original');
 db.exec('CREATE TABLE session_runtime_bindings(pibo_session_id TEXT,runtime_adapter_id TEXT,native_session_id TEXT,locator_json TEXT,metadata_json TEXT,revision INTEGER)');
 db.prepare('INSERT INTO session_runtime_bindings VALUES(?,?,?,?,?,?)').run('ps_fixture','pi','native',null,JSON.stringify({piboSessionPrefix:{format:1,epoch:1,status:'sealed',capsule,reason:'initial',nativeSessionId:'native',evidence:'adapter-inputs'}}),1);
 const owner=await PrefixSessionOwnership.acquire(store.root,[JSON.stringify(['pibo','ps_fixture']),JSON.stringify(['native','pi','native'])]);
 try{await assert.rejects(createStorageBackup({source,payloadRoot:join(root,'payloads'),destination:join(root,'archive')}),/ownership/);}
 finally{owner.release();db.close();}
});
