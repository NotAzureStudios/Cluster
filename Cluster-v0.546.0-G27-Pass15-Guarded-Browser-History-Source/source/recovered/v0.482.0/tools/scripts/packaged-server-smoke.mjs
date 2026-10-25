import fs from "node:fs/promises";
import path from "node:path";
import { spawnPortable } from "./command-invocation.mjs";

function argsMap(argv){const out=new Map();for(let i=0;i<argv.length;i+=1){const t=argv[i];if(!t.startsWith("--"))continue;const [k,v]=t.slice(2).split("=",2);if(v!==undefined)out.set(k,v);else if(argv[i+1]&&!argv[i+1].startsWith("--"))out.set(k,argv[++i]);else out.set(k,true);}return out;}
const args=argsMap(process.argv.slice(2));
const stage=path.resolve(String(args.get("stage")||""));
if(!stage) throw new Error("--stage is required.");
const required=["package.json","apps/server/dist/index.js","apps/server/prisma/schema.prisma","apps/server/prisma/migrations","bin", "tools/scripts/database-command.mjs"];
for(const relative of required){try{await fs.access(path.join(stage,relative));}catch{throw new Error(`Packaged server is missing ${relative}.`);}}
const manifest=JSON.parse(await fs.readFile(path.join(stage,"package.json"),"utf8"));
if(JSON.stringify(manifest).toLowerCase().includes("sqlite")) throw new Error("Packaged server manifest still contains SQLite support.");
if(await fs.stat(path.join(stage,"apps/desktop")).then(()=>true).catch(()=>false)) throw new Error("Packaged server contains the removed Electron application.");
const postgresUrl=String(args.get("postgres-url")||process.env.CLUSTER_CERTIFY_POSTGRES_URL||"").trim();
if(postgresUrl){
  const direct=String(args.get("direct-postgres-url")||process.env.CLUSTER_CERTIFY_DIRECT_POSTGRES_URL||postgresUrl);
  const result=await new Promise((resolve)=>{const child=spawnPortable(process.execPath,["tools/scripts/database-command.mjs","status"],{cwd:stage,env:{...process.env,DATABASE_URL:postgresUrl,DIRECT_DATABASE_URL:direct},stdio:"inherit"});child.once("error",e=>resolve({ok:false,error:e.message}));child.once("close",code=>resolve({ok:code===0,code}));});
  if(!result.ok) throw new Error("Packaged PostgreSQL migration status failed.");
  console.log("Packaged server PostgreSQL smoke passed.");
}else console.log("Packaged server static smoke passed. Supply --postgres-url for a live migration-status check.");
