import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm, mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { PrefixCapsuleStore } from '../dist/sessions/prefix-capsule.js';
import { PrefixMaintenanceLease, withPrefixPublication } from '../dist/sessions/prefix-maintenance.js';
import { collectUnreferencedPrefixes } from '../dist/sessions/prefix-gc.js';

async function fixture(t) {
 const home=await mkdtemp(join(tmpdir(),'prefix-gc-'));t.after(()=>rm(home,{recursive:true,force:true}));
 const root=join(home,'prefixes'),store=new PrefixCapsuleStore(root),path=join(home,'sessions.sqlite'),db=new DatabaseSync(path);
 db.exec('CREATE TABLE session_runtime_bindings(metadata_json TEXT)');t.after(()=>db.close());
 const add=metadata=>db.prepare('INSERT INTO session_runtime_bindings VALUES(?)').run(JSON.stringify(metadata));
 return {root,store,path,db,add};
}
const prefix=ref=>({format:1,epoch:1,status:'sealed',capsule:ref,reason:'initial',nativeSessionId:'native',evidence:'adapter-inputs'});
test('collection preserves live and historical references across stores and never removes ownership or delivery directories',async t=>{
 const f=await fixture(t);
 const live=await f.store.put('pi','fixture/v1','live'),historical=await f.store.put('pi','pibo-resources/v1','historic'),orphan=await f.store.put('pi','fixture/v1','orphan');
 f.add({piboSessionPrefixResourceDependencies:[historical]});
 const other=join(f.root,'other.sqlite'),db=new DatabaseSync(other);t.after(()=>db.close());
 db.exec('CREATE TABLE pibo_session_runtime_bindings(metadata_json TEXT)');
 db.prepare('INSERT INTO pibo_session_runtime_bindings VALUES(?)').run(JSON.stringify({piboSessionPrefix:prefix(live)}));
 await mkdir(join(f.root,'resources',orphan.digest),{recursive:true});
 const input={root:f.root,databases:[f.path,other]};
 assert.deepEqual(await collectUnreferencedPrefixes(input),{candidates:1,bytes:6,deleted:0,referenced:2});
 const inode=(await stat(join(f.root,'ownership','maintenance.sqlite'))).ino;
 assert.equal((await collectUnreferencedPrefixes({...input,apply:true})).deleted,1);
 await assert.rejects(f.store.read(orphan,orphan),/recovery required/);
 assert.equal(await f.store.read(live,live),'live');assert.equal(await f.store.read(historical,historical),'historic');
 assert.equal((await stat(join(f.root,'ownership','maintenance.sqlite'))).ino,inode);
 assert.ok((await stat(join(f.root,'resources',orphan.digest))).isDirectory());
});
test('collector cannot enter the artifact-write to binding-publication gap',async t=>{
 const f=await fixture(t);
 let continuePublication,ready;
 const readyPromise=new Promise(resolve=>ready=resolve),pause=new Promise(resolve=>continuePublication=resolve);
 const publication=withPrefixPublication(f.root,async()=>{
  const capsule=await f.store.put('pi','fixture/v1','in-flight');ready();await pause;f.add({piboSessionPrefix:prefix(capsule)});return capsule;
 });
 await readyPromise;
 try {await assert.rejects(collectUnreferencedPrefixes({root:f.root,databases:[f.path],apply:true}),/maintenance is busy/);}
 finally {continuePublication();}
 const capsule=await publication;
 assert.equal((await collectUnreferencedPrefixes({root:f.root,databases:[f.path],apply:true})).deleted,0);
 assert.equal(await f.store.read(capsule,capsule),'in-flight');
 const exclusive=await PrefixMaintenanceLease.acquire(f.root,true);
 try {await assert.rejects(withPrefixPublication(f.root,async()=>assert.fail('must not publish')),/maintenance is busy/);}
 finally {exclusive.release();}
});
test('malformed or incomplete inventory fails before deleting any orphan',async t=>{
 const f=await fixture(t),orphan=await f.store.put('pi','fixture/v1','orphan');
 f.add({piboSessionPrefixResourceDependencies:[{digest:'invalid'}]});
 await assert.rejects(collectUnreferencedPrefixes({root:f.root,databases:[f.path],apply:true}),/recovery required/);
 assert.equal(await f.store.read(orphan,orphan),'orphan');
 await assert.rejects(collectUnreferencedPrefixes({root:f.root,databases:[],apply:true}),/complete bounded database inventory/);
});
