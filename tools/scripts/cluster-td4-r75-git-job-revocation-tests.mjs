import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ts = (() => { try { return require('typescript'); } catch { return require(require('node:path').join(require('node:child_process').execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(), 'typescript')); } })();
const source = fs.readFileSync('apps/server/src/domains/source-control/source-control-service.ts','utf8');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const module={exports:{}};
vm.runInNewContext(js,{module,exports:module.exports,require:(id)=>id==='../../core/http-errors.js'?{createHttpError:(code,message,status)=>Object.assign(new Error(message),{code,statusCode:status})}:require(id),Buffer,Date,Set,Map,JSON,Math,String,Number,console,URL},{filename:'source-control-service.ts'});
let checks=0;
const test=async(name,fn)=>{await fn();checks++;console.log('PASS',name)};
function fixture(options={}) {
  const calls={db:[],transaction:0,git:0};
  const state={repository:{id:'repo-1',workspaceId:'studio-1',connectionId:'connection-1',hostingMode:'remote',archived:false,connection:{id:'connection-1',workspaceId:'studio-1',status:'active',archived:false}},
    operation:{id:'operation-1',repositoryId:'repo-1',workingCopyId:'copy-1',operationType:'commit',inputMetadata:'{}',attempts:0},
    workingCopy:{id:'copy-1',projectId:'project-1',repositoryId:'repo-1',archived:false,branchName:'main'},
    binding:{id:'binding-1'},...options};
  const prisma={
    sourceOperation:{findFirst:async()=>state.operation,update:async()=>({})},
    sourceWorkingCopy:{findFirst:async()=>state.workingCopy},
    sourceRepository:{findFirst:async()=>state.repository,update:async()=>({})},
    projectSourceBinding:{findFirst:async({where})=>{calls.db.push(where);return state.binding}},
    $transaction:async()=>{calls.transaction++;throw new Error('PRECHECK_PASSED')},
  };
  const service=module.exports.createSourceControlService({prisma,providerService:{},resolveManagedRepositoryPath:async()=>null});
  return {state,calls,service};
}
const expectCode=async (fn,code)=>assert.rejects(fn,e=>e.code===code,code);
await test('Workflow job rejects disabled provider connection',async()=>{const f=fixture();f.state.repository.connection.status='disabled';await expectCode(()=>f.service.executeWorkflowJob({repositoryId:'repo-1',operationId:'operation-1'},1),'SOURCE_PROVIDER_REVOKED');assert.equal(f.calls.transaction,0)});
await test('Workflow job rejects archived provider connection',async()=>{const f=fixture();f.state.repository.connection.archived=true;await expectCode(()=>f.service.executeWorkflowJob({repositoryId:'repo-1',operationId:'operation-1'},1),'SOURCE_PROVIDER_REVOKED')});
await test('Workflow job rejects deleted provider connection',async()=>{const f=fixture();f.state.repository.connection=null;await expectCode(()=>f.service.executeWorkflowJob({repositoryId:'repo-1',operationId:'operation-1'},1),'SOURCE_PROVIDER_REVOKED')});
await test('Workflow job rejects provider moved to other Studio',async()=>{const f=fixture();f.state.repository.connection.workspaceId='studio-2';await expectCode(()=>f.service.executeWorkflowJob({repositoryId:'repo-1',operationId:'operation-1'},1),'SOURCE_PROVIDER_REVOKED')});
await test('Workflow job rejects removed Project binding',async()=>{const f=fixture({binding:null});await expectCode(()=>f.service.executeWorkflowJob({repositoryId:'repo-1',operationId:'operation-1'},1),'SOURCE_PROJECT_BINDING_REVOKED');assert.equal(f.calls.transaction,0)});
await test('Workflow gate constrains repository, Project, archive and Studio scope',async()=>{const f=fixture();await expectCode(()=>f.service.executeWorkflowJob({repositoryId:'repo-1',operationId:'operation-1'},1),'SOURCE_GIT_UNAVAILABLE');assert.equal(f.calls.db[0].repositoryId,'repo-1');assert.equal(f.calls.db[0].projectId,'project-1');assert.equal(f.calls.db[0].archived,false);assert.equal(f.calls.db[0].project.workspaceId,'studio-1');assert.equal(f.calls.db[0].project.archived,false)});
await test('Workflow precheck does not alter SourceOperation on revoked binding',async()=>{const f=fixture({binding:null});await expectCode(()=>f.service.executeWorkflowJob({repositoryId:'repo-1',operationId:'operation-1'},1),'SOURCE_PROJECT_BINDING_REVOKED');assert.equal(f.calls.transaction,0)});
await test('Repository sync rejects disabled provider before status changes',async()=>{const f=fixture();f.state.repository.connection.status='disabled';await expectCode(()=>f.service.executeSyncJob({repositoryId:'repo-1',operationId:'operation-1'},1),'SOURCE_PROVIDER_REVOKED');assert.equal(f.calls.transaction,0)});
await test('Repository sync rejects archived provider before status changes',async()=>{const f=fixture();f.state.repository.connection.archived=true;await expectCode(()=>f.service.executeSyncJob({repositoryId:'repo-1',operationId:'operation-1'},1),'SOURCE_PROVIDER_REVOKED');assert.equal(f.calls.transaction,0)});
await test('Repository sync rejects cross-Studio provider before status changes',async()=>{const f=fixture();f.state.repository.connection.workspaceId='studio-2';await expectCode(()=>f.service.executeSyncJob({repositoryId:'repo-1',operationId:'operation-1'},1),'SOURCE_PROVIDER_REVOKED');assert.equal(f.calls.transaction,0)});
await test('Repository sync with active provider passes preflight',async()=>{const f=fixture();await assert.rejects(()=>f.service.executeSyncJob({repositoryId:'repo-1',operationId:'operation-1'},1),/PRECHECK_PASSED/);assert.equal(f.calls.transaction,1)});
await test('Local studio-hosted repository without external connection passes provider precheck',async()=>{const f=fixture();f.state.repository.connectionId=null;f.state.repository.connection=null;await expectCode(()=>f.service.executeWorkflowJob({repositoryId:'repo-1',operationId:'operation-1'},1),'SOURCE_GIT_UNAVAILABLE')});
await test('Source tree remains without unsafe filesystem deletion',()=>{assert.match(source,/requireRunnableRepository\(repositoryId, workingCopy.projectId\)/);assert.match(source,/requireRunnableRepository\(repositoryId\)/);assert(!source.includes('rmSync(repositoryPath'))});
console.log(`TD4 R75 Git job revocation: ${checks}/${checks} passed`);
