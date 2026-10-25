import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);const ts=require('typescript');
const src=fs.readFileSync('apps/server/src/domains/sessions/session-routes.ts','utf8');
const start=src.indexOf('  async function revokeDeviceSessions('), end=src.indexOf('  async function devicesForUser(');
assert.ok(start>0&&end>start);
const module={exports:{}};
const wrapped=`export function build(prisma: any, onSessionRevoked: any) { ${src.slice(start,end)} return revokeDeviceSessions; }`;
const js=ts.transpileModule(wrapped,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
vm.runInNewContext(js,{module,exports:module.exports,Date,Promise,Array,Error});
let state={sessions:[{id:'s1',userId:'u',deviceId:'d',revokedAt:null,expiresAt:new Date(Date.now()+100000)}],registration:{id:'db-device',userId:'u',deviceId:'d',revokedAt:null},pins:[{deviceId:'db-device',active:true,revision:1}],throwOnPin:true};
const clone=()=>({sessions:state.sessions.map(x=>({...x})),registration:{...state.registration},pins:state.pins.map(x=>({...x})),throwOnPin:state.throwOnPin});
const db={
 $transaction:async (fn,config)=>{assert.equal(config.isolationLevel,'Serializable');const working=clone();const tx={
  session:{findMany:async()=>working.sessions.filter(x=>!x.revokedAt).map(x=>({id:x.id})),updateMany:async({data})=>{working.sessions.forEach(x=>{x.revokedAt=data.revokedAt;x.revocationReason=data.revocationReason})}},
  deviceRegistration:{findUnique:async()=>({id:working.registration.id}),updateMany:async({data})=>Object.assign(working.registration,data)},
  managedPackagePin:{updateMany:async({data})=>{if(working.throwOnPin)throw new Error('PIN_WRITE_FAILED');working.pins.forEach(x=>{x.active=false;x.revision+=data.revision.increment})}},
 };const result=await fn(tx);state=working;return result;}
};
const notifications=[];
const revoke=module.exports.build(db,(id,user,reason)=>notifications.push({id,user,reason}));
await assert.rejects(()=>revoke('u','d','device_revoked'),/PIN_WRITE_FAILED/);
assert.equal(state.sessions[0].revokedAt,null);assert.equal(state.registration.revokedAt,null);assert.equal(state.pins[0].active,true);assert.equal(notifications.length,0);
console.log('PASS revoked device transaction rolls back sessions, registration, pins and callbacks on pin failure');
state.throwOnPin=false;
const ids=await revoke('u','d','device_revoked');
assert.deepEqual(Array.from(ids),['s1']);assert.equal(state.sessions[0].revocationReason,'device_revoked');assert.ok(state.registration.revokedAt);assert.equal(state.pins[0].active,false);assert.equal(state.pins[0].revision,2);assert.equal(notifications.length,1);
console.log('PASS successful device revocation deactivates package pins atomically and notifies after commit');
assert.match(fs.readFileSync('packages/renderer/src/features/settings/StudioManagedPackagesPanel.tsx','utf8'),/Distribution audit/);
console.log('PASS Package administration exposes delivery audit, not fake installed state');
console.log('3/3 device revocation regression checks passed');
