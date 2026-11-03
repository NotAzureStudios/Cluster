// Regression: managed Windows Server creates its PostgreSQL credentials and
// DATABASE_URL itself; a database CLI must resolve those values from the actual
// managed source-layout location, without generating or guessing any credentials.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadDatabaseConfiguration } from "./database-config.mjs";

const root=await fs.mkdtemp(path.join(os.tmpdir(),"cluster-managed-db-env-"));
const keys=["DATABASE_URL","DIRECT_DATABASE_URL","CLUSTER_CONFIG_FILE","CLUSTER_DATA_DIR"];
const saved=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
const url="postgresql://cluster:fixture-secret@127.0.0.1:54321/cluster";
const direct="postgresql://cluster:fixture-secret@127.0.0.1:54321/cluster?connect_timeout=10";
async function write(name,value) {
  const location=path.join(root,name);
  await fs.mkdir(path.dirname(location),{recursive:true});
  await fs.writeFile(location,value,"utf8");
}
let count=0;
try{
  for (const key of keys) delete process.env[key];
  await write("package.json",'{"name":"cluster","version":"1.0.2"}');
  await write("apps/server/prisma/schema.prisma","datasource db { provider = \"postgresql\" }");
  await write("CLUSTER_RELEASE.json",'{"schema":1}');
  await write(".cluster-installer-managed.json",'{"managedBy":"cluster-installer"}');
  await write("apps/server/.env",`DATABASE_URL=${url}\nDIRECT_DATABASE_URL=${direct}\n`);
  let cfg=await loadDatabaseConfiguration(root);
  assert.equal(cfg.databaseUrl,url);
  assert.equal(cfg.directUrl,direct);
  assert.equal(cfg.envPath,path.join(root,"apps","server",".env"));
  assert.equal(cfg.portable,true);
  assert.ok(!JSON.stringify({redacted:cfg.redactedUrl}).includes("fixture-secret"));
  count++;
  await write("data/Runtime/server.env","DATABASE_URL=postgresql://portable:fixture@127.0.0.1:54321/portable\n");
  cfg=await loadDatabaseConfiguration(root);
  assert.match(cfg.databaseUrl,/\/portable$/);
  assert.equal(cfg.envPath,path.join(root,"data","Runtime","server.env"));
  count++;
  process.env.DATABASE_URL="postgresql://override:fixture@127.0.0.1:54321/override";
  cfg=await loadDatabaseConfiguration(root);
  assert.match(cfg.databaseUrl,/\/override$/);
  delete process.env.DATABASE_URL;
  count++;
  await fs.rm(path.join(root,"data","Runtime"),{recursive:true});
  await fs.rm(path.join(root,".cluster-installer-managed.json"));
  await assert.rejects(()=>loadDatabaseConfiguration(root),/Configure DATABASE_URL/);
  count++;
  await fs.rm(path.join(root,"CLUSTER_RELEASE.json"));
  cfg=await loadDatabaseConfiguration(root);
  assert.equal(cfg.databaseUrl,url);
  assert.equal(cfg.envPath,path.join(root,"apps","server",".env"));
  count++;
  const goSource=await fs.readFile(new URL("../apps/server-launcher-go/main.go",import.meta.url),"utf8").catch(async()=>fs.readFile(new URL("../../apps/server-launcher-go/main.go",import.meta.url),"utf8"));
  assert.match(goSource,/values\["DATABASE_URL"\] = database\.runtimeURL/);
  assert.match(goSource,/values\["DIRECT_DATABASE_URL"\] = database\.directURL/);
  assert.match(goSource,/cmd\.Env = prependPath\(mergeEnvironment\(os\.Environ\(\), env\)/);
  count++;
  console.log(`${count}/${count} managed PostgreSQL URL config regression checks passed`);
} finally {
  for(const k of keys){if(saved[k]===undefined)delete process.env[k];else process.env[k]=saved[k];}
  await fs.rm(root,{recursive:true,force:true});
}
