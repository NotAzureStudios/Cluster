// Deployment admission for Windows builds AFTER application staging is moved.
// npm Windows workspace junctions embed absolute targets. Checking the staging
// tree alone is insufficient; the deployed root must still resolve packages.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const packageJson=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
const expected=packageJson.workspaces || [];
const errors=[];
for(const workspace of expected){
  const folder=path.join(root,workspace);
  const manifest=path.join(folder,'package.json');
  if(!fs.existsSync(manifest)){errors.push(`Missing workspace: ${workspace}`);continue;}
  const name=JSON.parse(fs.readFileSync(manifest,'utf8')).name;
  if(typeof name!=='string'||!name.startsWith('@cluster/')){errors.push(`Unexpected workspace package: ${workspace}`);continue;}
  const link=path.join(root,'node_modules',...name.split('/'));
  try{
    const actual=fs.realpathSync(link);
    const intended=fs.realpathSync(folder);
    if(path.normalize(actual).toLowerCase()!==path.normalize(intended).toLowerCase()){
      errors.push(`${name} points outside installed root: ${actual}`);
    }
    if(!fs.existsSync(path.join(link,'package.json')))errors.push(`${name} package.json missing at installed link`);
  }catch(error){errors.push(`${name} unresolved after installation: ${error.message}`);}
}
for(const file of ['packages/shared/dist/index.js','apps/server/dist/index.js','apps/server/dist/generated/prisma/client.js','apps/web/dist/index.html','bin/ClusterServer.exe','bin/cluster-host.exe','bin/cluster-update-helper.exe','bin/cluster-workstation-service.exe','node_modules/@prisma/client/package.json']){
  if(!fs.existsSync(path.join(root,file)))errors.push(`Missing deploy artifact: ${file}`);
}
try{
 const target=import.meta.resolve('@cluster/shared');
 if(!target.startsWith('file:')) errors.push('Node ESM package resolution did not return a file URL');
 else if(!fs.existsSync(fileURLToPath(target))) errors.push(`Node ESM package resolution points to missing file: ${target}`);
}catch(error){errors.push(`Node ESM cannot resolve @cluster/shared: ${error.message}`);}
// Resolve from the real compiled API entry, not just from this diagnostic
// script. This catches links or nested dependencies that only work in staging.
try {
  const requireFromServer=createRequire(path.join(root,'apps/server/dist/index.js'));
  for(const pkg of ['@cluster/shared','@prisma/client','fastify']) {
    const resolved=requireFromServer.resolve(pkg);
    const full=fs.realpathSync(resolved);
    if(!path.relative(root,full).startsWith('..') && !path.isAbsolute(path.relative(root,full))) {
      // Path stays inside deployed release.
    } else {
      errors.push(`${pkg} resolves outside installed application: ${full}`);
    }
  }
} catch(error){errors.push(`Compiled API dependency resolution failed: ${error.message}`);}
// A public web bundle must contain actual deployable assets, not an empty
// index.html from a source archive or a prior interrupted build.
try {
 const assets=path.join(root,'apps/web/dist/assets');
 if(!fs.readdirSync(assets).some(name=>name.endsWith('.js')))errors.push('Built web bundle contains no JavaScript assets');
}catch(error){errors.push(`Built web assets unavailable: ${error.message}`);}
if(errors.length){for(const error of errors)console.error(`DEPLOYMENT BLOCKED: ${error}`);process.exitCode=1;}
else console.log(`RC deployment admission passed: ${expected.length} workspace links, API artifacts, and Node ESM resolution.`);
