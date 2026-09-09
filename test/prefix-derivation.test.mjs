import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deriveSessionPrefixMetadata, restoreDerivedOmpPrefix } from '../dist/sessions/prefix-derivation.js';
const original={piboSessionPrefix:{format:1,epoch:3,status:'sealed',capsule:{format:1,digest:'a'.repeat(64),bytes:100,adapterId:'orp',codec:'fixture/v1'},reason:'compaction',nativeSessionId:'native-source',evidence:'adapter-inputs'},piboSessionPrefixResources:{format:1,digest:'b'.repeat(64),bytes:100,adapterId:'orp',codec:'pibo-resources/v1'}};
test('nested native derivation shares original artifacts and never inherits a pending transition',()=>{
 const first=deriveSessionPrefixMetadata(original,'native-source','native-child');
 const second=deriveSessionPrefixMetadata(first,'native-child','native-grandchild');
 assert.deepEqual(second.piboSessionPrefix.capsule,original.piboSessionPrefix.capsule);
 assert.deepEqual(second.piboSessionPrefixResources,original.piboSessionPrefixResources);
 assert.equal(second.piboSessionPrefix.capsuleNativeSessionId,'native-source');
 assert.equal(second.piboSessionPrefix.epoch,5);
 assert.equal(original.piboSessionPrefix.nativeSessionId,'native-source');
 assert.throws(()=>deriveSessionPrefixMetadata({...original,piboSessionPrefixTransition:{format:1,id:'12345678-1234-1234-1234-123456789012',reason:'compaction',fromEpoch:3,nativeSessionId:'native-source',sourceHead:null,state:'pending'}},'native-source','native-child'),/unfinished/);
 assert.throws(()=>deriveSessionPrefixMetadata(original,'different-source','native-child'),/identity/);
});
test('derived cold restore changes only native identity and known affinity, rejecting unknown schemes',()=>{
 const prefix=deriveSessionPrefixMetadata(original,'native-source','native-child').piboSessionPrefix;
 const snapshot={format:1,nativeSessionId:'native-source',providerStatic:{prompt_cache_key:'native-source',reasoning:{effort:'high'}},instructions:'original instructions',tools:'original tools',inputPrefix:[{role:'developer',text:'original'}]};
 const restored=JSON.parse(restoreDerivedOmpPrefix(JSON.stringify(snapshot),prefix));
 assert.deepEqual(restored,{...snapshot,nativeSessionId:'native-child',providerStatic:{...snapshot.providerStatic,prompt_cache_key:'native-child'}});
 assert.throws(()=>restoreDerivedOmpPrefix(JSON.stringify({...snapshot,nativeSessionId:'someone-else'}),prefix),/unexpected native source/);
 assert.throws(()=>restoreDerivedOmpPrefix(JSON.stringify({...snapshot,providerStatic:{prompt_cache_key:'unknown:source'}}),prefix),/affinity format/);
});
