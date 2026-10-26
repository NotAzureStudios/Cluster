import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import ts from 'typescript';

let passed=0;
function test(condition, title) { assert.ok(condition,title); passed++; console.log(`PASS ${title}`); }
function loadTs(file, mockRequire=(name)=>require(name)) {
  const text=fs.readFileSync(file,'utf8');
  const compiled=ts.transpileModule(text,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const ctx={ module: { exports:{} }, exports: {}, require:mockRequire, process, Buffer, Date, URL, console };
  ctx.exports=ctx.module.exports;
  vm.runInNewContext(compiled,ctx,{filename:file});
  return ctx.module.exports;
}
const forms=loadTs('apps/server/src/domains/studio-systems/studio-form-runtime.ts',(name)=> name==='@cluster/shared'?{studioAudienceSchema:{parse:v=>v},visibleStudioFormFieldIds:(fields)=>new Set(fields.map(f=>f.id))}:name.endsWith('studio-audience.js')?{parseStudioJson:(v,f)=>{try{return JSON.parse(v);}catch{return f;}}}:null);
const f={fields:[{id:'agree',type:'acknowledgement',required:true,label:'Terms'},{id:'date',type:'date',required:false,label:'Date'},{id:'role',type:'select',required:false,label:'Role',options:['Engineer','Artist']},{id:'tags',type:'multi_select',required:false,label:'Tags',options:['a','b']} ]};
const valid=x=>forms.validateStudioFormAnswers(f,x);
test(valid({agree:true}).ok,'required acknowledgement accepts true');
test(!valid({agree:false}).ok,'required acknowledgement rejects false');
test(!valid({agree:'true'}).ok,'required acknowledgement rejects coerced string');
test(!valid({agree:true,date:'2026-02-30'}).ok,'invalid calendar date fails');
test(!valid({agree:true,role:'Owner'}).ok,'unknown select value fails');
test(!valid({agree:true,tags:['a','a']}).ok,'duplicate multi-select fails');
test(!valid({agree:true,tags:[1]}).ok,'non-text multi-select fails');
test(!valid({agree:true,unknown:'secret'}).ok,'unknown field fails closed');
test(!valid({agree:true,role:' '.repeat(2100)}).ok,'oversized value fails');
const packets=loadTs('apps/server/src/domains/library/packet-publication.ts',name=>name==='node:crypto'?crypto:null);
const def={id:'d1',versionLabel:'2.0',kind:'onboarding',audienceJson:'{}',completionMode:'read'};
const folder={id:'packet1'};
const source=[{id:'b',parentId:'packet1',title:'Read me',type:'note',revision:4,status:'active'}, {id:'a',parentId:'packet1',title:'asset',type:'file',fileName:'x.png',revision:3,status:'active',checksumSha256:'a'.repeat(64),sizeBytes:100}];
const release=packets.buildPacketReleaseManifest(folder,def,source);
test(release.sourceCount===2,'packet snapshots include all selected sources');
test(release.manifestSha256===crypto.createHash('sha256').update(release.manifestJson).digest('hex'),'packet manifest digest matches exact snapshot');
test(release.manifestJson===packets.buildPacketReleaseManifest(folder,def,[...source].reverse()).manifestJson,'packet manifests deterministic regardless of source enumeration order');
test(JSON.parse(release.manifestJson).distributionPolicy==='derived_only','publication records derivative-only policy');
assert.throws(()=>packets.buildPacketReleaseManifest(folder,def,[{...source[1],checksumSha256:null}]),/PACKET_SOURCE_UNVERIFIED/);passed++;console.log('PASS unverified file cannot enter release');
assert.throws(()=>packets.buildPacketReleaseManifest(folder,def,[{...source[0],status:'archived'}]),/PACKET_SOURCE_INACTIVE/);passed++;console.log('PASS archived file cannot enter release');
const inventoryText=fs.readFileSync('apps/server/src/domains/inventory/studio-inventory-vault-routes.ts','utf8');
const match=inventoryText.match(/export function assertInventoryCapacity\([\s\S]*?\n}/);
assert.ok(match);
const capacityModule=ts.transpileModule(`${match[0]}\nmodule.exports={assertInventoryCapacity};`,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const ctx={module:{exports:{}},exports:{}, Number};ctx.exports=ctx.module.exports;vm.runInNewContext(capacityModule,ctx);
const enough=ctx.module.exports.assertInventoryCapacity;
test(enough(10,8,2),'capacity allows final two seats');
test(!enough(10,8,3),'capacity blocks over-allocation');
test(!enough(10,-1,1),'capacity rejects negative occupancy');
test(!enough(10,9,1.5),'capacity rejects fractional allocations');
const repoFiles={
  inv:inventoryText,
  security:fs.readFileSync('apps/server/src/core/security-verification.ts','utf8'),
  reauth:fs.readFileSync('apps/server/src/core/session-security.ts','utf8'),
  routes:fs.readFileSync('apps/server/src/domains/library/packet-routes.ts','utf8'),
  forms:fs.readFileSync('apps/server/src/domains/studio-systems/studio-systems-routes.ts','utf8'),
  schema:fs.readFileSync('apps/server/prisma/schema.prisma','utf8'),
  sql:fs.readFileSync('apps/server/prisma/migrations/20261008190000_inventory_vault_foundations/migration.sql','utf8')
};
test(repoFiles.inv.includes('FOR UPDATE')&&repoFiles.inv.includes('tx.studioInventoryAllocation.aggregate'),'seat assignment serializes around owning asset');
test(repoFiles.inv.includes('select: vaultPublicSelect')&&!repoFiles.inv.includes('return { ok: true, secrets: rows.map'),'vault list uses no ciphertext projection');
test(repoFiles.inv.includes('await audit(request, actor, "vault.secret_revealed", id);')&&repoFiles.inv.includes('decryptSecuritySecret(vaultEncryptionPurpose(id)'),'reveal is audited before decrypting');
test(repoFiles.security.includes('vault_secret_reveal: {')&&repoFiles.security.includes('singleUse: true')&&repoFiles.security.includes('minimumStrength: "mfa"'),'Vault reveal requires single-use MFA proof');
test(repoFiles.reauth.includes('"vault_secret_reveal"')&&repoFiles.reauth.includes('/reveal$'),'Vault reveal bound to fresh auth middleware');
test(repoFiles.routes.includes('isolationLevel: "RepeatableRead"')&&repoFiles.routes.includes('PACKET_SOURCE_ACCESS_REQUIRED'),'release snapshot is transactional and access checked');
test((()=>{const start=repoFiles.routes.indexOf('app.get("/api/packets/:packetId/releases"');const end=repoFiles.routes.indexOf('  // Revocation suppresses',start);const chunk=repoFiles.routes.slice(start,end);return start>=0 && end>start && /select:\s*\{\s*id:\s*true,\s*versionLabel:\s*true,\s*manifestSha256:\s*true,\s*publishedById:\s*true,\s*publishedAt:\s*true/.test(chunk) && !/select:\s*\{[^}]*manifestJson:\s*true/.test(chunk);})(),'Packet releases list excludes internal source manifest even with revocation metadata');
test(repoFiles.forms.includes('settings.acceptingResponses === false')&&repoFiles.forms.includes('currentVersion?.id !== version.id'),'authenticated Forms enforce live closure and latest published version');
for (const model of ['StudioInventoryAsset','StudioInventoryAllocation','StudioVaultSecret','PacketRelease']) test(repoFiles.schema.includes(`model ${model} {`)&&repoFiles.sql.includes(`CREATE TABLE "${model}"`),`${model} has schema and migration`);
test(repoFiles.sql.includes('StudioInventoryAllocation_active_unique'),'active seat assignment uniqueness enforced in PostgreSQL');
console.log(`${passed}/${passed} v0.508 Forms, Packets, Inventory and Vault assertions passed`);
