/**
 * Consolidated, opt-in TD1/TD2 certification gate. It checks actual Node 24,
 * workspace dependencies and EXPLICIT disposable PostgreSQL consent before
 * running both isolated-schema SQL harnesses and the dependency-backed build.
 * This is NOT a Windows service/Qt/runtime soak certification.
 *
 * node tools/scripts/cluster-td1-td2-certification-gate.mjs --preflight
 * TD1_CERT_DISPOSABLE=I_UNDERSTAND TD2_CERT_DISPOSABLE=I_UNDERSTAND \
 * TD1_CERT_DATABASE_URL=postgresql://... TD2_CERT_DATABASE_URL=postgresql://... \
 * node tools/scripts/cluster-td1-td2-certification-gate.mjs --run
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const require=createRequire(import.meta.url);
const mode=process.argv[2]||'--preflight';
if(!['--preflight','--run'].includes(mode)){
  console.error('Usage: node tools/scripts/cluster-td1-td2-certification-gate.mjs [--preflight|--run]');
  process.exit(2);
}
const has=(name)=>{try{require.resolve(name,{paths:[root]});return true;}catch{return false;}};
const major=Number(process.versions.node.split('.')[0]);
const checks={
  node24:major===24,
  typescript:has('typescript'),
  pg:has('pg'),
  prisma:has('prisma'),
  td1Disposable:process.env.TD1_CERT_DISPOSABLE==='I_UNDERSTAND',
  td2Disposable:process.env.TD2_CERT_DISPOSABLE==='I_UNDERSTAND',
  td1DatabaseUrl:/^postgres(?:ql)?:\/\//.test(process.env.TD1_CERT_DATABASE_URL||''),
  td2DatabaseUrl:/^postgres(?:ql)?:\/\//.test(process.env.TD2_CERT_DATABASE_URL||''),
};
const report={
  gate:'Cluster TD1/TD2 source+PostgreSQL validation',
  timestamp:new Date().toISOString(),
  node:process.version,
  os:process.platform,
  mode,
  prerequisites:checks,
  livePostgreSQL:false,
  fullNode24Build:false,
  windowsServiceLifecycle:'NOT_TESTED',
  enabledDisabledFullServerResourceMeasurement:'NOT_TESTED',
  steps:[],
};
const reportPath=path.resolve(process.env.TD1_TD2_CERT_REPORT_PATH||path.join(root,'TD1_TD2_LOCAL_CERT_REPORT.json'));
const secrets=[process.env.TD1_CERT_DATABASE_URL,process.env.TD2_CERT_DATABASE_URL].filter(Boolean);
const redact=(value)=>secrets.reduce((s,secret)=>s.replaceAll(secret,'[REDACTED DATABASE URL]'),String(value));
const write=()=>writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');
const missing=Object.entries(checks).filter(([,ok])=>!ok).map(([k])=>k);
if(mode==='--preflight'||missing.length){
  report.blockedReasons=missing;
  write();
  console.log(JSON.stringify({mode,ready:!missing.length,prerequisites:checks,report:reportPath},null,2));
  if(mode==='--run')console.error('BLOCKED: dependencies, Node 24, or explicit disposable database consent missing. No SQL was executed.');
  process.exitCode=missing.length?2:0;
}else{
  const steps=[
    {name:'TD1 isolated-schema PostgreSQL concurrency',command:process.execPath,args:['tools/scripts/cluster-td1-postgres-certification.mjs']},
    {name:'TD2 production queue SQL contention and recovery',command:process.execPath,args:['tools/scripts/cluster-td2-postgres-queue-certification.mjs']},
    {name:'Prisma schema validation',command:'npm',args:['run','db:validate']},
    {name:'Node 24 dependency-backed full build',command:'npm',args:['run','build']},
  ];
  for(const step of steps){
    const started=Date.now();
    const result=spawnSync(step.command,step.args,{cwd:root,encoding:'utf8',maxBuffer:4*1024*1024,timeout:240_000,env:process.env,shell:process.platform==='win32'&&step.command==='npm'});
    const ok=result.status===0&&!result.error;
    report.steps.push({name:step.name,passed:ok,exitCode:result.status,elapsedMs:Date.now()-started,output:redact((result.stdout||'')+'\n'+(result.stderr||'')).slice(-12_000),error:result.error?.code||null});
    console.log(`${ok?'PASS':'FAIL'} ${step.name}`);
    write();
    if(!ok)break; // a failed prerequisite invalidates downstream evidence
  }
  report.livePostgreSQL=report.steps.slice(0,2).length===2&&report.steps.slice(0,2).every(step=>step.passed);
  report.fullNode24Build=report.steps.some(step=>step.name==='Node 24 dependency-backed full build'&&step.passed);
  write();
  console.log('Report:',reportPath);
  if(!report.livePostgreSQL||!report.fullNode24Build)process.exitCode=1;
  // Windows service and full-server performance certification are separate
  // release gates and intentionally cannot be marked PASS by this script.
}
