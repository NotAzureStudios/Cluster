// RC8: verify startup admission tracks the current database schema, not stale
// indexes that PostgreSQL removed with their owning columns.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {inspectStorageSchema,verifyStorageSchema} from '../../apps/server/src/core/storage-migrations.ts';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const schema=fs.readFileSync(path.join(root,'apps/server/prisma/schema.prisma'),'utf8');
const verification=fs.readFileSync(path.join(root,'apps/server/src/core/storage-migrations.ts'),'utf8');
const migrationRoot=path.join(root,'apps/server/prisma/migrations');
const migrations=fs.readdirSync(migrationRoot,{withFileTypes:true}).filter(x=>x.isDirectory()&&/^\d{14}_/.test(x.name)).map(x=>x.name).sort();
const created=fs.readFileSync(path.join(migrationRoot,'20260830011000_people_teams_profiles_v2/migration.sql'),'utf8');
const removed=fs.readFileSync(path.join(migrationRoot,'20261004180000_phase10_rc17_wip43_workforce_authority/migration.sql'),'utf8');
let checks=0;
function check(name,result){assert.ok(result,name);console.log('PASS',name);checks++;}
const userSchema=schema.match(/model User \{([\s\S]*?)\n\}/)?.[1] || '';
const deprecated='User_managerUserId_archived_idx';
check('former User manager index genuinely created in historical migration',created.includes(`CREATE INDEX IF NOT EXISTS "${deprecated}"`));
check('workforce migration removes owning User.managerUserId column',/ALTER TABLE "User"[\s\S]*?DROP COLUMN "managerUserId"/.test(removed));
check('current User model no longer contains managerUserId',!/^\s*managerUserId\s/m.test(userSchema));
const parseNames=(name)=>{
 const part=verification.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\] as const;`))?.[1];
 assert.ok(part,`missing ${name}`);
 return [...part.matchAll(/"([^"]+)"/g)].map(x=>x[1]);
};
const requiredTables=parseNames('REQUIRED_TABLES');
const requiredIndexes=parseNames('REQUIRED_INDEXES');
check('deprecated index not required by startup verifier',!requiredIndexes.includes(deprecated));
const latest=migrations.at(-1);
check('schema verifier requires the actual latest bundled migration',verification.includes(`const REQUIRED_LATEST_MIGRATION = "${latest}"`));
check('RC retains its migration baseline with RC45 index correction',migrations.length>=157 && migrations.includes('20261114000000_rc45_discord_role_index_name'));
const baselineHistory=migrations.map((migration_name)=>({migration_name,started_at:new Date('2026-10-26'),finished_at:new Date('2026-10-26'),rolled_back_at:null,logs:null}));
function mock({tables=requiredTables,indexes=requiredIndexes,history=baselineHistory}={}){
 return {$queryRawUnsafe:async(query)=>{
  if(query.includes('information_schema.tables'))return tables.map(table_name=>({table_name}));
  if(query.includes('pg_indexes'))return indexes.map(indexname=>({indexname}));
  if(query.includes('_prisma_migrations'))return history;
  throw new Error(`Unexpected query: ${query}`);
 }};
}
const status=await inspectStorageSchema(mock());
check('healthy fresh RC7 schema passes startup verification',status.ok&&status.missingIndexes.length===0&&status.missingTables.length===0&&status.migrationState.requiredLatestApplied);
const certified=await verifyStorageSchema(mock());
check('healthy schema passes actual admission function',certified.ok===true);
const missingReal=requiredIndexes[0];
const broken=await inspectStorageSchema(mock({indexes:requiredIndexes.filter(x=>x!==missingReal)}));
check('real missing required index still blocks startup',!broken.ok&&broken.missingIndexes.includes(missingReal));
await assert.rejects(()=>verifyStorageSchema(mock({indexes:requiredIndexes.filter(x=>x!==missingReal)})), /Missing tables: none; missing indexes:/);
check('verifier retains fail-closed semantics for real drift',true);
const older=await inspectStorageSchema(mock({history:baselineHistory.slice(0,-1)}));
check('partial migration history still blocks startup',!older.ok&&!older.migrationState.requiredLatestApplied);
const failed=[...baselineHistory.slice(0,-1),{...baselineHistory.at(-1),finished_at:null}];
const pending=await inspectStorageSchema(mock({history:failed}));
check('incomplete latest migration still blocks startup',!pending.ok&&pending.migrationState.incomplete.length===1);
console.log(`${checks}/${checks} RC8 schema lineage/admission checks passed`);
