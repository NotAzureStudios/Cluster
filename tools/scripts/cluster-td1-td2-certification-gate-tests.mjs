/** Local safety/command-line certification-gate regressions, no PostgreSQL needed. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const script=path.join(root,'tools/scripts/cluster-td1-td2-certification-gate.mjs');
const tmp=mkdtempSync(path.join(os.tmpdir(),'cluster-td12-cert-'));
let count=0;
const check=(label,fn)=>{fn();count++;console.log('PASS',label)};
try{
  const fake='postgresql://operator:PRIVATE_PASSWORD@localhost:5432/disposable_test';
  const test=(mode,custom={})=>{
    const report=path.join(tmp,`${mode.replaceAll('-','')}-${count}.json`);
    const env={...process.env,
      TD1_CERT_REPORT_PATH:report,TD1_TD2_CERT_REPORT_PATH:report,
      TD1_CERT_DATABASE_URL:'',TD2_CERT_DATABASE_URL:'',
      TD1_CERT_DISPOSABLE:'',TD2_CERT_DISPOSABLE:'',...custom};
    const result=spawnSync(process.execPath,[script,mode],{cwd:root,env,encoding:'utf8',timeout:15000});
    return {result,report,body:JSON.parse(readFileSync(report,'utf8'))};
  };
  check('preflight returns nonzero and machine-readable prerequisites when unprovisioned',()=>{
    const {result,body}=test('--preflight');
    assert.equal(result.status,2);assert.equal(body.mode,'--preflight');
    assert.equal(body.prerequisites.td1Disposable,false);
    assert.equal(body.prerequisites.td2Disposable,false);
    assert.equal(body.livePostgreSQL,false);assert.equal(body.fullNode24Build,false);
  });
  check('run mode blocks without consent and cannot start SQL/build subprocesses',()=>{
    const {result,body}=test('--run');
    assert.equal(result.status,2);assert.deepEqual(body.steps,[]);
    assert.match(result.stderr,/BLOCKED/);
  });
  check('even provided database credentials are never serialized to preflight reports',()=>{
    const {result,report}=test('--preflight',{TD1_CERT_DATABASE_URL:fake,TD2_CERT_DATABASE_URL:fake});
    assert.equal(result.status,2);
    assert(!readFileSync(report,'utf8').includes('PRIVATE_PASSWORD'));
    assert(!result.stdout.includes('PRIVATE_PASSWORD'));
  });
  check('invalid CLI command is rejected before writing a report',()=>{
    const r=spawnSync(process.execPath,[script,'--unknown'],{cwd:root,encoding:'utf8',timeout:15000});
    assert.equal(r.status,2);assert.match(r.stderr,/Usage/);
  });
  check('explicit consent alone does not skip Node 24 and dependency requirements',()=>{
    const {result,body}=test('--run',{
      TD1_CERT_DISPOSABLE:'I_UNDERSTAND',TD2_CERT_DISPOSABLE:'I_UNDERSTAND',
      TD1_CERT_DATABASE_URL:fake,TD2_CERT_DATABASE_URL:fake,
    });
    if(Number(process.versions.node.split('.')[0])!==24)assert.equal(body.prerequisites.node24,false);
    assert.equal(result.status,2);
    assert.deepEqual(body.steps,[]);
  });
}finally{rmSync(tmp,{recursive:true,force:true});}
console.log(`${count}/${count} combined certification safety gate tests passed`);
