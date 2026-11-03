import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const root=path.resolve(new URL('../..',import.meta.url).pathname);
const read=(rel)=>fs.readFileSync(path.join(root,rel),'utf8');
const require=createRequire(import.meta.url);
const ts=(()=>{try{return require('typescript')}catch{return require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript')}})();
const migration=read('apps/server/prisma/migrations/20261114000000_rc45_discord_role_index_name/migration.sql');
const original=read('apps/server/prisma/migrations/20261113000000_rc43_discord_role_projection/migration.sql');
const schema=read('apps/server/prisma/schema.prisma');
const source=read('apps/server/src/core/storage-migrations.ts');
const release=JSON.parse(read('config/release-candidate.json'));
const beforeName='DiscordRoleProjection_connectionId_guildId_discordUserId_roleId_key';
const truncatedName=beforeName.slice(0,63);
const fixedName='DiscordRoleProjection_owner_key';
const newMigration='20261114000000_rc45_discord_role_index_name';
let checks=0;
async function test(label,fn){await fn(); console.log(`PASS ${++checks}: ${label}`);}
await test('RC45 schema fix remains part of a compatible newer release',()=>{assert(release.sequence>=45);assert.equal(release.channel,'stable');assert.match(release.release,/^1\.0\.[1-9][0-9]*$/);assert.equal(release.release,release.sourceVersion);});
await test('root cause: original unique index exceeded PostgreSQL 63-byte identifier limit',()=>{assert.equal(Buffer.byteLength(beforeName),67);assert.equal(Buffer.byteLength(truncatedName),63);assert(original.includes(beforeName));});
await test('RC45 renames actual truncated index without rebuild or data loss',()=>{
 assert(migration.includes(`ALTER INDEX "${truncatedName}"`));
 assert(migration.includes(`RENAME TO "${fixedName}"`));
 assert(!/\b(DROP|CREATE|DELETE|TRUNCATE|UPDATE|INSERT)\b\s+(TABLE|INDEX|FROM|INTO)/i.test(migration));
});
await test('Prisma physical unique index name is explicit and under the limit',()=>{
 assert(Buffer.byteLength(fixedName)<=63);
 assert(schema.includes(`@@unique([connectionId, guildId, discordUserId, roleId], map: "${fixedName}")`));
});
await test('startup checks require the new name and migration, not the impossible 67-byte name',()=>{
 assert(source.includes(`const REQUIRED_LATEST_MIGRATION = "${newMigration}"`));
 assert(source.includes(`"${fixedName}"`));
 assert(!source.includes(`"${beforeName}"`));
});
await test('no required index names exceed the PostgreSQL identifier limit',()=>{
 const body=source.slice(source.indexOf('const REQUIRED_INDEXES'),source.indexOf('] as const;',source.indexOf('const REQUIRED_INDEXES')));
 const names=[...body.matchAll(/"([\w]+)"/g)].map(x=>x[1]);
 assert(names.length>100);
 for(const name of names)assert(Buffer.byteLength(name,'utf8')<=63,`${name}: ${Buffer.byteLength(name)}`);
});
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}});
const exports={};vm.runInNewContext(js.outputText,{exports,Date,Set,Promise,Error,console},{filename:'storage-migrations.ts'});
const {inspectStorageSchema}=exports;
assert.equal(typeof inspectStorageSchema,'function');
const requiredTables=[...source.slice(source.indexOf('const REQUIRED_TABLES'),source.indexOf('] as const;',source.indexOf('const REQUIRED_TABLES'))).matchAll(/"([\w]+)"/g)].map(m=>m[1]);
const requiredIndexes=[...source.slice(source.indexOf('const REQUIRED_INDEXES'),source.indexOf('] as const;',source.indexOf('const REQUIRED_INDEXES'))).matchAll(/"([\w]+)"/g)].map(m=>m[1]);
const mock=(indexList,migrations=[newMigration])=>({$queryRawUnsafe:async(sql)=>{
 if(sql.includes('information_schema.tables'))return requiredTables.map(table_name=>({table_name}));
 if(sql.includes('pg_indexes'))return indexList.map(indexname=>({indexname}));
 if(sql.includes('_prisma_migrations'))return migrations.map((migration_name,i)=>({migration_name,started_at:new Date(Date.now()+i),finished_at:new Date(),rolled_back_at:null,logs:null}));
 throw new Error(`unexpected query: ${sql}`);
}});
await test('startup accepts repaired RC44 database with real catalog index',async()=>{
 const result=await inspectStorageSchema(mock(requiredIndexes));
 assert.equal(result.ok,true);assert.equal(result.missingIndexes.length,0);
});
await test('startup refuses pre-repair truncated schema (never fakes a clean database)',async()=>{
 const indexes=requiredIndexes.map(n=>n===fixedName?truncatedName:n);
 const result=await inspectStorageSchema(mock(indexes,['20261113000000_rc43_discord_role_projection']));
 assert.equal(result.ok,false);assert(result.missingIndexes.includes(fixedName));assert.equal(result.migrationState.requiredLatestApplied,false);
});
await test('startup still fails when unique index is missing after migration',async()=>{
 const result=await inspectStorageSchema(mock(requiredIndexes.filter(n=>n!==fixedName)));
 assert.equal(result.ok,false);assert(result.missingIndexes.includes(fixedName));
});
console.log(`RC45 PostgreSQL index regression checks: ${checks}/${checks} passed.`);
