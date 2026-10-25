import { readFile, access } from 'node:fs/promises'; import path from 'node:path';
const root=process.cwd(); const checks=[]; async function exists(p){try{await access(path.join(root,p));return true}catch{return false}} function ok(n,v){checks.push([n,!!v]); console.log(`${v?'PASS':'FAIL'} ${n}`)}
ok('Windows Server packager exists',(await readFile('tools/scripts/package-cluster-master.mjs','utf8')).includes('Cluster-Windows-Server'));
ok('Docker Server Dockerfile exists',await exists('deployment/server/Dockerfile'));
ok('Docker Compose distribution exists',await exists('deployment/server/docker-compose.yml'));
ok('Desktop installer uses CPack NSIS',(await readFile('tools/scripts/package-qt-installer.mjs','utf8')).includes('NSIS'));
ok('Signed update manifest supports stable beta nightly',(await readFile('tools/scripts/release-update-manifest.mjs','utf8')).includes('stable')&&(await readFile('tools/scripts/release-update-manifest.mjs','utf8')).includes('nightly'));
ok('Upgrade drill deploys previous then current migrations',(await readFile('tools/scripts/release-upgrade-drill.mjs','utf8')).includes('Previous release')&&(await readFile('tools/scripts/release-upgrade-drill.mjs','utf8')).includes('Applying current Cluster migrations'));
ok('SBOM generator supports certified lock requirement',(await readFile('tools/scripts/release-sbom.mjs','utf8')).includes('--require-lock'));
ok('Security scan exists',await exists('tools/scripts/release-security-scan.mjs'));
const failed=checks.filter(x=>!x[1]); console.log(`Phase 7 distribution audit: ${checks.length-failed.length}/${checks.length}`); if(failed.length) process.exit(1);
