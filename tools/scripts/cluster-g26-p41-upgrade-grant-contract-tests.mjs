import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { generateKeyPairSync, verify, createPublicKey } from 'node:crypto';
const ts = createRequire(import.meta.url)('typescript');
const read = file => fs.readFileSync(new URL('../../'+file,import.meta.url),'utf8');
const grants = read('apps/server/src/domains/inventory/managed-package-grants.ts');
const routes = read('apps/server/src/domains/inventory/managed-package-routes.ts');
const native = read('tools/native/package-stager-go/managed_deploy.go');
const cli = read('tools/native/package-stager-go/main.go');
const ast=ts.createSourceFile('managed-package-grants.ts',grants,ts.ScriptTarget.ES2022,true,ts.ScriptKind.TS);
const find = name => {let node; const visit=n=>{if(ts.isFunctionDeclaration(n)&&n.name?.text===name)node=n;ts.forEachChild(n,visit)};visit(ast);assert(node,`Production ${name} missing`);return node.getText(ast)};
const fn=ts.transpileModule(find('mintPackageDeploymentGrant'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText.replace(/^export\s+/gm,'');
const {privateKey,publicKey}=generateKeyPairSync('ed25519');
const pem=privateKey.export({format:'pem',type:'pkcs8'}).toString();
const mint=Function('exports','createPrivateKey','createPublicKey','createHash','randomBytes','sign','PACKAGE_GRANT_CONTEXT','PACKAGE_GRANT_TTL_SECONDS',
`'use strict';${fn};return mintPackageDeploymentGrant`)(...(()=>{const c=requireCrypto();return [{},c.createPrivateKey,c.createPublicKey,c.createHash,c.randomBytes,c.sign,'CLUSTER_MANAGED_DEPLOYMENT_GRANT_V1\n',60]})());
function requireCrypto(){return createRequire(import.meta.url)('node:crypto')}
let checks=0;
const h=c=>c.repeat(64);
const params={operation:'upgrade',packageKey:'studio-core',version:'1.5.0',platform:'windows-x64',artifactSha256:h('a'),signingKeySha256:h('b'),releaseId:'release-1',registrationId:'device-1',userId:'user-1',priorReceiptSha256:h('c'),priorMsiSha256:h('d')};
const envelope=mint(params,pem,Date.UTC(2026,9,24,15,0));
const decoded=JSON.parse(Buffer.from(envelope.payloadBase64url,'base64url').toString());
assert.equal(decoded.operation,'upgrade');checks++;
assert.equal(decoded.priorReceiptSha256,h('c'));checks++;
assert.equal(decoded.priorMsiSha256,h('d'));checks++;
assert.equal(decoded.expiresAt-decoded.issuedAt,60);checks++;
assert.equal(verify(null,Buffer.concat([Buffer.from('CLUSTER_MANAGED_DEPLOYMENT_GRANT_V1\n'),Buffer.from(envelope.payloadBase64url,'base64url')]),envelope.publicKeyPem,Buffer.from(envelope.signatureBase64url,'base64url')),true);checks++;
for(const [name,patch] of [
['no receipt',{priorReceiptSha256:undefined}],['bad receipt',{priorReceiptSha256:'not-sha'}],
['no source',{priorMsiSha256:undefined}],['bad source',{priorMsiSha256:'not-sha'}],
['upper receipt',{priorReceiptSha256:h('C')}],['upper source',{priorMsiSha256:h('D')}],
['invalid op',{operation:'upgrade-and-run'}]
]) {assert.throws(()=>mint({...params,...patch},pem),/INVALID/ ,name);checks++}
for(const operation of ['install','repair','uninstall','deploy','rollback']) {
 assert.throws(()=>mint({...params,operation},pem),/INVALID/,`upgrade fields smuggled into ${operation}`);checks++;
}
for(const [operation,priorReceiptSha256] of [['repair',h('c')],['uninstall',h('c')],['install',undefined],['deploy',undefined],['rollback',undefined]]){
 const token=mint({...params,operation,priorReceiptSha256,priorMsiSha256:undefined},pem);
 const payload=JSON.parse(Buffer.from(token.payloadBase64url,'base64url').toString());
 assert.notEqual(payload.operation,'upgrade');checks++;
 assert.equal(payload.priorMsiSha256,undefined);checks++;
}
for(const clause of ['CLUSTER_ALLOW_SUPERVISED_MSI_UPGRADE_GRANTS','PACKAGE_MSI_PRIOR_SOURCE_SHA_REQUIRED','supervised_user_msi_upgrade','body.operation === "upgrade" || body.operation === "msi-rollback" ? { priorMsiSha256','executableInstallationAllowed: body.operation === "install" || body.operation === "repair" || body.operation === "uninstall" || body.operation === "upgrade"']) {
 assert(routes.includes(clause),`server upgrade contract missing ${clause}`);checks++;
}
for(const clause of ['PriorMSISha256','(operation == "upgrade" || operation == "msi-rollback") && !validDigest(claim.PriorMSISha256)','claim.Operation != operation']){
 assert(native.includes(clause)|| (clause==='claim.Operation != operation' && native.includes('claim.Operation != operation')),`native signing scope missing ${clause}`);checks++;
}
assert(cli.includes('case "upgrade-msi"'), 'signed upgrade executor CLI must be present');checks++;
console.log(`${checks}/${checks} executed Pass41 server-signer, signature, operation isolation and upgrade grant boundary checks passed`);
