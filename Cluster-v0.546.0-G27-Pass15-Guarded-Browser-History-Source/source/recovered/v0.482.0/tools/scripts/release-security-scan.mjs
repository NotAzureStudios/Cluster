import { readFile, readdir, stat, writeFile, mkdir, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
const root=process.cwd();
const out=path.join(root,'.cluster','release-security-scan.json');
const findings=[];
const forbidden=/\.(?:pfx|p12|key|jks|pem)$/i;
async function walk(dir){ for(const e of await readdir(dir,{withFileTypes:true})){ if(['node_modules','.git','release','.cluster'].includes(e.name)) continue; const p=path.join(dir,e.name); if(e.isDirectory()) await walk(p); else if(forbidden.test(e.name) && !/public[-_]?key/i.test(e.name)) findings.push({severity:'critical',kind:'secret-file',path:path.relative(root,p)}); }}
await walk(root);
let npmAudit={available:false,ok:false};
try{await access(path.join(root,'package-lock.json')); const r=spawnSync('npm',['audit','--omit=dev','--json'],{cwd:root,encoding:'utf8'}); let parsed={}; try{parsed=JSON.parse(r.stdout||'{}')}catch{} npmAudit={available:true,ok:r.status===0,exitCode:r.status,vulnerabilities:parsed.metadata?.vulnerabilities||null}; if(r.status!==0) findings.push({severity:'high',kind:'npm-audit',detail:'npm audit reported production dependency findings'});}catch{}
for(const mod of ['apps/host-go','apps/server-launcher-go','apps/update-helper-go']){ const r=spawnSync('go',['list','-m','all'],{cwd:path.join(root,mod),encoding:'utf8'}); if(r.status!==0) findings.push({severity:'medium',kind:'go-module-resolution',path:mod}); }
const report={schema:1,clusterVersion:JSON.parse(await readFile('package.json','utf8')).version,generatedAt:new Date().toISOString(),npmAudit,findings,passed:findings.every(f=>!['critical','high'].includes(f.severity))};
await mkdir(path.dirname(out),{recursive:true}); await writeFile(out,JSON.stringify(report,null,2)+'\n');
if(!report.passed) throw new Error('Release security scan found blocking findings.');
console.log(`Release security scan passed (${findings.length} non-blocking findings).`);
