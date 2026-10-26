import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {generateKeyPairSync,verify,createPrivateKey,createPublicKey,createHash,randomBytes,sign} from 'node:crypto';
const ts=createRequire(import.meta.url)('typescript');
const read=path=>fs.readFileSync(new URL('../../'+path,import.meta.url),'utf8');
const source=read('apps/server/src/domains/inventory/managed-package-grants.ts');
const ast=ts.createSourceFile('grant.ts',source,ts.ScriptTarget.ES2022,true,ts.ScriptKind.TS);
let declaration;
const visit=node=>{if(ts.isFunctionDeclaration(node)&&node.name?.text==='mintPackageDeploymentGrant')declaration=node;ts.forEachChild(node,visit)};visit(ast);
assert(declaration);let checks=1;
const compiled=ts.transpileModule(declaration.getText(ast),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText.replace(/^export\s+/gm,'');
const mint=Function('exports','createPrivateKey','createPublicKey','createHash','randomBytes','sign','PACKAGE_GRANT_CONTEXT','PACKAGE_GRANT_TTL_SECONDS',
 `'use strict';${compiled};return mintPackageDeploymentGrant`)({},createPrivateKey,createPublicKey,createHash,randomBytes,sign,'CLUSTER_MANAGED_DEPLOYMENT_GRANT_V1\n',60);
const {privateKey}=generateKeyPairSync('ed25519');
const pem=privateKey.export({type:'pkcs8',format:'pem'}).toString();const h=x=>x.repeat(64);
const grant={operation:'msi-rollback',packageKey:'studio-core',version:'1.5.0',platform:'windows-x64',artifactSha256:h('a'),signingKeySha256:h('b'),releaseId:'release-1',registrationId:'device-1',userId:'user-1',
 priorReceiptSha256:h('c'),priorMsiSha256:h('d'),upgradeJournalSha256:h('e'),successorMsiSha256:h('f')};
const envelope=mint(grant,pem,Date.UTC(2026,9,24,17,0));
const decoded=JSON.parse(Buffer.from(envelope.payloadBase64url,'base64url').toString());
for(const field of ['operation','priorReceiptSha256','priorMsiSha256','upgradeJournalSha256','successorMsiSha256']){assert.equal(decoded[field],grant[field]);checks++}
assert.equal(decoded.expiresAt-decoded.issuedAt,60);checks++;
assert.equal(verify(null,Buffer.concat([Buffer.from('CLUSTER_MANAGED_DEPLOYMENT_GRANT_V1\n'),Buffer.from(envelope.payloadBase64url,'base64url')]),envelope.publicKeyPem,Buffer.from(envelope.signatureBase64url,'base64url')),true);checks++;
for(const field of ['priorReceiptSha256','priorMsiSha256','upgradeJournalSha256','successorMsiSha256']) {
 for(const bad of [undefined,'broken',h('Z'),'']) {
  assert.throws(()=>mint({...grant,[field]:bad},pem),/INVALID/,`${field} -> ${bad}`);checks++;
 }
}
for(const operation of ['install','repair','uninstall','upgrade','deploy','rollback']) {
 assert.throws(()=>mint({...grant,operation},pem),/INVALID/,`${operation} consumed rollback fields`);checks++;
}
for(const [operation,extras] of [
 ['install',{}],['deploy',{}],['rollback',{}],['repair',{priorReceiptSha256:h('c')}],
 ['uninstall',{priorReceiptSha256:h('c')}],['upgrade',{priorReceiptSha256:h('c'),priorMsiSha256:h('d')}]
]) {
 const ordinary={...grant,operation,priorReceiptSha256:undefined,priorMsiSha256:undefined,upgradeJournalSha256:undefined,successorMsiSha256:undefined,...extras};
 const token=mint(ordinary,pem);
 const content=JSON.parse(Buffer.from(token.payloadBase64url,'base64url').toString());
 assert.notEqual(content.operation,'msi-rollback');checks++;
 assert.equal(content.upgradeJournalSha256,undefined);checks++;
 assert.equal(content.successorMsiSha256,undefined);checks++;
}
const native=read('tools/native/package-stager-go/managed_deploy.go');
for(const token of ['operation == "msi-rollback"','claim.UpgradeJournalSha256','claim.SuccessorMSISha256','claim.Operation != operation']){assert(native.includes(token),token);checks++}
const server=read('apps/server/src/domains/inventory/managed-package-routes.ts');
assert(server.includes('CLUSTER_ALLOW_SUPERVISED_MSI_ROLLBACK_GRANTS') && server.includes('CLUSTER_ALLOW_SUPERVISED_MSI_ROLLBACK_EXECUTION') && server.includes('supervised_user_msi_rollback'), 'rollback grant must require separate signed and runtime opt-in');checks++;
const cli=read('tools/native/package-stager-go/main.go');
assert(cli.includes('case "rollback-msi":') && read('tools/native/package-stager-go/msi_rollback_execution.go').includes('writeFirstMSIRepairReceipt(journalPath, out)'), 'native rollback must be guarded by a durable non-replayable journal');checks++;
console.log(`${checks}/${checks} Pass43 signed MSI rollback grant isolation and disabled execution assertions passed`);
