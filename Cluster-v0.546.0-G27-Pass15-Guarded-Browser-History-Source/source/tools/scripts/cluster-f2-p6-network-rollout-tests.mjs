import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js');
const root=path.resolve(import.meta.dirname,'../..');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'cluster-f2p6-'));
const compiled=path.join(temp,'modules');fs.mkdirSync(compiled);
for(const stem of ['server-config-publication-journal','server-network-deployment']){
 const content=fs.readFileSync(path.join(root,`apps/server/src/core/${stem}.ts`),'utf8');
 const result=ts.transpileModule(content,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true},reportDiagnostics:true});
 assert.equal(result.diagnostics?.filter(d=>d.category===ts.DiagnosticCategory.Error).length,0,'source syntax');
 fs.writeFileSync(path.join(compiled,stem+'.js'),result.outputText);
}
const {prepareConfigPublication,durableReplaceFile,recoverConfigPublication}=require(path.join(compiled,'server-config-publication-journal.js'));
const {stageNetworkDeployment,readNetworkDeploymentStatus,assertNetworkDeploymentWritable,networkDeploymentPath}=require(path.join(compiled,'server-network-deployment.js'));
let checks=0;
function ok(value,msg){assert.ok(value,msg);checks++}
function eq(a,b,msg){assert.deepEqual(a,b,msg);checks++}
async function reject(p,msg){await assert.rejects(p);checks++}
try{
 const file=path.join(temp,'config.json');
 const before=JSON.stringify({version:2,secretPolicy:'server-managed-only',settings:{webPort:3000}});
 const after=JSON.stringify({version:2,secretPolicy:'server-managed-only',settings:{webPort:3010}});
 await fsp.writeFile(file,before);
 eq((await readNetworkDeploymentStatus(file)).state,'none','no deployment');
 await reject(stageNetworkDeployment(file,before,after),'cannot stage without durable publication');
 const journal=await prepareConfigPublication(file,after);
 await stageNetworkDeployment(file,journal.before.bytes,after,journal.id);
 const plan=JSON.parse(await fsp.readFile(networkDeploymentPath(file),'utf8'));
 eq(plan.state,'staged','durable staged state');
 eq(plan.before.bytes,before,'previous snapshot exact');
 eq(plan.after.bytes,after,'new snapshot exact');
 eq(plan.id,journal.id,'bound to publication ID');
 const mode=await fsp.stat(networkDeploymentPath(file));ok((mode.mode&0o077)===0,'owner only on posix');
 eq((await readNetworkDeploymentStatus(file)).publicationPending,true,'cannot claim commit while journal pending');
 await durableReplaceFile(file,after);
 let status=await readNetworkDeploymentStatus(file);
 eq(status.state,'staged','staged before native ready');
 eq(status.requiresManagedRestart,true,'restart required');
 eq(status.configMatch,'candidate','candidate matches');
 await reject(assertNetworkDeploymentWritable(file),'staged config blocks further saves');
 const bad=await fsp.readFile(networkDeploymentPath(file),'utf8');
 ok(!JSON.stringify(status).includes(before),'redacted status excludes previous config bytes');
 ok(!JSON.stringify(status).includes(after),'redacted status excludes proposed config bytes');
 // Simulate PostgreSQL publication success; the supervisor may inspect only after clearing journal.
 await recoverConfigPublication(file,journal.id);
 status=await readNetworkDeploymentStatus(file);
 eq(status.publicationPending,false,'committed config journal cleared');
 await fsp.writeFile(networkDeploymentPath(file),bad.replace(/"state":"staged"/,'"state":"verified"'));
 await assertNetworkDeploymentWritable(file);checks++;
 eq((await readNetworkDeploymentStatus(file)).requiresManagedRestart,false,'verified status allowed');
 // Simulate the next transaction abort and canonical publication-journal rollback.
 const next='{"version":2,"settings":{"webPort":3040}}';
 const pending=await prepareConfigPublication(file,next);
 await stageNetworkDeployment(file,pending.before.bytes,next,pending.id);
 await durableReplaceFile(file,next);
 await recoverConfigPublication(file,'another-noncommitted-id');
 eq((await fsp.readFile(file,'utf8')),after,'failed transaction restored previous file');
 await assertNetworkDeploymentWritable(file);checks++;
 eq((await readNetworkDeploymentStatus(file)).configMatch,'previous','aborted deployment inert');
 // Changing a file out from under the recorded plan refuses to overwrite it.
 await fsp.writeFile(file,'operator modification');
 await reject(assertNetworkDeploymentWritable(file),'unexpected edits fail closed');
 // Malformed records fail closed, not misreported as clear/verified.
 await fsp.writeFile(networkDeploymentPath(file),'{bad json}');
 await reject(readNetworkDeploymentStatus(file),'damaged plan raises exception');
 // Cross-runtime contracts and access controls.
 const settings=fs.readFileSync(path.join(root,'apps/server/src/app/server-services-settings-integrations.ts'),'utf8');
 const routes=fs.readFileSync(path.join(root,'apps/server/src/app/server-routes-configuration-integrations.ts'),'utf8');
 const launcher=fs.readFileSync(path.join(root,'apps/server-launcher-go/windows_service.go'),'utf8');
 ok(settings.includes('stageNetworkDeployment(CONFIG_FILE_PATH, journal.before.bytes, afterBytes, journal.id)'),'publication-aligned stage');
 ok(settings.includes('assertNetworkDeploymentWritable(CONFIG_FILE_PATH)'),'settings checked under lock');
 ok(routes.includes('app.get("/api/server-config/network/deployment"'),'safe admin status route');
 ok(routes.includes('readNetworkDeploymentStatus(CONFIG_FILE_PATH)'),'no raw snapshot returned');
 ok(routes.includes('NETWORK_DEPLOYMENT_PENDING'),'pending settings conflict');
 ok(launcher.includes('rollbackNativeNetworkDeployment(root)'),'native rollback invoked');
 ok(launcher.includes('verifyNativeNetworkDeployment(root)'),'native startup verifies before SCM running');
 ok(launcher.includes('reachedReady || ctx.Err() != nil'),'never rollback after healthy service or intentional stop');
 console.log(`Cluster F2 P6 Network Deployment: ${checks}/${checks} assertions passed`);
}finally{await fsp.rm(temp,{recursive:true,force:true})}
