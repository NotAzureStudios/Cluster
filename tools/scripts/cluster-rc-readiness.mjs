// Read-only 1.0 RC certification ledger. No inferred completion.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const registry=JSON.parse(fs.readFileSync(path.join(root,'CLUSTER_1_0_FINAL_WORK_REGISTER.json'),'utf8'));
const release=JSON.parse(fs.readFileSync(path.join(root,'config/release-candidate.json'),'utf8'));
const items=registry.work_items;
const open=items.filter(x=>!['certified','deferred-explicit','removed'].includes(x.release_decision));
const report={
 release:release.release,channel:release.channel,sourceVersion:release.sourceVersion,
 status:'NOT_CERTIFIED',conclusion:'Development release candidate for Windows acceptance, NOT Cluster 1.0 Stable',
 requirementsTotal:items.length,
 open:open.length,
 openByPriority:Object.fromEntries(['P0','P1','P2','P3'].map(k=>[k,open.filter(i=>i.priority===k).length])),
 criticalGates:{
  dependencyBackedBuild:'UNVERIFIED',
  reproducibleDependencies:fs.existsSync(path.join(root,'package-lock.json'))?'LOCKFILE_PRESENT_NOT_VERIFIED':'BLOCKED_MISSING_LOCKFILE',
  windowsBootAndService:'UNVERIFIED',
  postgresql18Integration:'UNVERIFIED',
  storageAndBackupRestore:'UNVERIFIED',
  multiuserAndPrivacy:'UNVERIFIED',
  signedArtifact:'UNVERIFIED',
  disasterRecovery:'UNVERIFIED',
  realServerAcceptance:'UNVERIFIED'
 },
 dispositionRule:'No full stable release until P0/P1 gates are certified or explicitly and safely dispositioned with user approval.'
};
if(process.argv.includes('--json'))console.log(JSON.stringify(report,null,2));
else {
 console.log(`Cluster ${report.release} RC READINESS: ${report.status}`);
 console.log(`${report.open}/${report.requirementsTotal} ledger entries still require disposition: ${JSON.stringify(report.openByPriority)}`);
 for(const [gate,result] of Object.entries(report.criticalGates))console.log(`${gate}: ${result}`);
}
