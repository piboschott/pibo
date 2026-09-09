import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { PrefixCapsuleStore } from '../dist/sessions/prefix-capsule.js';
import { PrefixResourceBundleStore } from '../dist/sessions/prefix-resources.js';
import { PrefixSessionOwnership } from '../dist/sessions/prefix-ownership.js';
import { createStorageBackup, verifyStorageBackup, restoreStorageBackup } from '../dist/data/storage-backup.js';
import { preparePrefixRuntimeTransition } from '../dist/sessions/prefix-rebaseline.js';

for (const adapter of ['pi','codex-native','orp']) for (const pending of [false,true]) test(`backup restores ${adapter} capsules, resources and native history at the original paths; pending=${pending}`, async t => {
 const root=await mkdtemp(join(tmpdir(),'pibo-prefix-backup-')),home=join(root,'home'),destination=join(root,'archive');
 await mkdir(home);t.after(()=>rm(root,{recursive:true,force:true}));
 const source=join(home,'sessions.sqlite'),native=join(home,adapter==='orp'?'native-session.jsonl':'native-session'),capsules=new PrefixCapsuleStore(join(home,'session-prefixes'));
 const capsule=await capsules.put(adapter,'fixture/v1','original model prefix');
 const resources=await new PrefixResourceBundleStore(capsules).put(adapter,{format:1,context:[{id:'context',label:'Context',required:true,order:0,content:'original selected context'}],skills:[],files:[]});
 const historical=await new PrefixResourceBundleStore(capsules).put(adapter,{format:1,context:[{id:'older',label:'Earlier context',required:true,order:0,content:'context referenced by old messages'}],skills:[],files:[]});
 const artifactRoot=join(home,'native-session'),oldArtifactRoot=join(home,'old-session');
 if(adapter==='orp') {
  await mkdir(join(artifactRoot,'nested'),{recursive:true});await mkdir(oldArtifactRoot);
  await writeFile(join(artifactRoot,'nested','tool-output.bin'),Buffer.from([0,255,10]));
  await writeFile(join(oldArtifactRoot,'previous-output.txt'),'attachment referenced by inherited history');
 }
 const childFile=join(home,'child-native.jsonl');
 await writeFile(childFile,'{"child":"native history"}\n');
 const childCapsule=await capsules.put(adapter,'fixture/v1','native child original prefix');
 const childState={nativeSessionId:'native-child',nativeSessionFile:childFile,prefix:{format:1,epoch:1,status:'sealed',capsule:childCapsule,reason:'initial',nativeSessionId:'native-child',evidence:'provider-request'}};
 let nativeDb;
 if(adapter==='orp'){nativeDb=new DatabaseSync(native);nativeDb.exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE history(value TEXT); INSERT INTO history VALUES('original native history');");}
 else await writeFile(native,'{"native":"original history"}\n');
 const db=new DatabaseSync(source);
 db.exec('CREATE TABLE session_runtime_bindings(pibo_session_id TEXT,runtime_adapter_id TEXT,native_session_id TEXT,locator_json TEXT,metadata_json TEXT,revision INTEGER)');
 const metadata={piboSessionPrefix:{format:1,epoch:1,status:'sealed',capsule,reason:'initial',nativeSessionId:'native-1',evidence:'adapter-inputs'},piboSessionPrefixNativeChildren:[childState],piboSessionPrefixResources:resources.reference,piboSessionPrefixResourceDependencies:[historical.reference],...(adapter==='orp'?{piboSessionPrefixArtifactDependencies:[oldArtifactRoot]}:{}),nativeSessionFile:native};
 const originalBinding={piboSessionId:'ps_fixture',runtimeInstanceId:adapter,adapterId:adapter,nativeSessionId:'native-1',state:'bound',revision:1,metadata};
 const binding=pending?preparePrefixRuntimeTransition(originalBinding,{piboSessionId:'ps_fixture',runtimeInstanceId:'target',adapterId:'pi',state:'unbound',revision:2,metadata:{}}):originalBinding;
 db.prepare('INSERT INTO session_runtime_bindings VALUES(?,?,?,?,?,?)').run('ps_fixture',binding.adapterId,binding.nativeSessionId??null,null,JSON.stringify(binding.metadata),binding.revision);
 await writeFile(join(home,'auth.json'),'fixture credential must not enter archive');
 if(adapter==='orp') {
  await symlink(join(home,'auth.json'),join(artifactRoot,'escape'));
  await assert.rejects(createStorageBackup({source,payloadRoot:join(home,'payloads'),destination:join(root,'bad-archive'),maxBytes:16*1024*1024}),/symlink/);
  await rm(join(artifactRoot,'escape'));
 }
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
 assert.equal(await capsules.read(childCapsule,childCapsule),'native child original prefix');
 assert.equal(await readFile(childFile,'utf8'),'{"child":"native history"}\n');
 assert.equal((await new PrefixResourceBundleStore(capsules).restore(resources.reference)).context[0].content,'original selected context');
 assert.equal((await new PrefixResourceBundleStore(capsules).restore(historical.reference)).context[0].content,'context referenced by old messages');
 if(adapter==='orp'){const reopened=new DatabaseSync(native);try{assert.equal(reopened.prepare('SELECT value FROM history').get().value,'original native history');}finally{reopened.close();}}
 else assert.equal(await readFile(native,'utf8'),'{"native":"original history"}\n');
 if(adapter==='orp') {
  assert.deepEqual(await readFile(join(artifactRoot,'nested','tool-output.bin')),Buffer.from([0,255,10]));
  assert.equal(await readFile(join(oldArtifactRoot,'previous-output.txt'),'utf8'),'attachment referenced by inherited history');
 }
 await writeFile(join(destination,'runtime',adapter==='orp'?'native-session.jsonl':'native-session'),'corrupt');
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
