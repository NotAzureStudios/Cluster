#!/usr/bin/env node
// Offline authoring only. Never give your private key to Cluster's web UI/server.
import { createHash, createPrivateKey, createPublicKey, sign } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
function die(text){console.error(text);process.exit(2)}
const [pemPath, archivePath, key, version, platform, outputPath, dependenciesPath, installerPath] = process.argv.slice(2);
if (![pemPath,archivePath,key,version,platform,outputPath].every(Boolean))die('Usage: node tools/scripts/cluster-package-sign.mjs private-key.pem package.zip package-key 1.2.3 windows-x64 signed-release.json');
const CONTENT_MAX = 4*1024*1024, MSI_MAX = 32*1024*1024;
const bytes=fs.readFileSync(archivePath);
if(bytes.length===0 || bytes.length>MSI_MAX)die('Archive exceeds 32 MiB signed MSI bound or is empty');
const filename=path.basename(archivePath);
if(!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,149}\.zip$/.test(filename)||filename.includes('..'))die('Use a safe .zip filename');
if(!/^[a-z][a-z0-9-]{2,79}$/.test(key))die('Invalid Package key');
if(!/^[0-9]+\.[0-9]+\.[0-9]+(?:-[a-zA-Z0-9.-]+)?$/.test(version))die('Invalid version');
if(!['windows-x64','linux-x64','macos-arm64'].includes(platform))die('Invalid platform');
const privateKey=createPrivateKey(fs.readFileSync(pemPath,'utf8'));
if(privateKey.asymmetricKeyType!=='ed25519')die('Expected Ed25519 private key');
const publicKey=createPublicKey(privateKey);
const pubDer=publicKey.export({format:'der',type:'spki'});
const sha=(data)=>createHash('sha256').update(data).digest('hex');
const manifest={schema:1,packageKey:key,version,platform,artifactSha256:sha(bytes),artifactSize:bytes.length,filename};
if (dependenciesPath && dependenciesPath !== "-") {
  // Optional signed, explicit {packageKey, version, requirement} pins. Never sign arbitrary hooks.
  let deps;
  try { deps=JSON.parse(fs.readFileSync(dependenciesPath,'utf8')); }
  catch { die('Could not read dependency JSON'); }
  if (!Array.isArray(deps) || deps.length === 0 || deps.length > 12) die('Invalid dependencies');
  const names=new Set();
  for (const entry of deps) {
    if (!entry || typeof entry!=='object' || Array.isArray(entry) || Object.keys(entry).sort().join(',')!=='packageKey,requirement,version'
      || typeof entry.packageKey!=='string' || !/^[a-z][a-z0-9-]{2,79}$/.test(entry.packageKey)
      || typeof entry.version!=='string' || !/^[0-9]+\.[0-9]+\.[0-9]+(?:-[a-zA-Z0-9.-]+)?$/.test(entry.version)
      || !['content-selected','msi-installed'].includes(entry.requirement)
      || (entry.requirement==='msi-installed' && platform!=='windows-x64')
      || entry.packageKey===key || names.has(entry.packageKey)) die('Invalid or duplicate Package dependency');
    names.add(entry.packageKey);
  }
  if (deps.length) manifest.dependencies=deps;
}
if (installerPath) {
  let installer;
  try { installer=JSON.parse(fs.readFileSync(installerPath,'utf8')); }
  catch { die('Could not read installer declaration JSON'); }
  if (!installer || typeof installer!=='object' || Array.isArray(installer)
    || Object.keys(installer).sort().join(',')!=='kind,path,productCode,productVersion,scope,sha256'
    || platform!=='windows-x64' || installer.kind!=='windows-msi' || installer.scope!=='user'
    || typeof installer.path!=='string' || installer.path.length>220 || !/^[a-zA-Z0-9_./-]+\.msi$/i.test(installer.path)
    || installer.path.split('/').some(p=>!p || p==='.' || p==='..' || p.endsWith('.') || p.endsWith(' '))
    || typeof installer.productCode!=='string' || !/^\{[0-9A-F]{8}-(?:[0-9A-F]{4}-){3}[0-9A-F]{12}\}$/.test(installer.productCode)
    || typeof installer.productVersion!=='string' || !/^[0-9]{1,5}\.[0-9]{1,5}\.[0-9]{1,5}$/.test(installer.productVersion)
    || typeof installer.sha256!=='string' || !/^[a-f0-9]{64}$/.test(installer.sha256)) die('Invalid signed MSI declaration');
  manifest.installer=installer;
}
if (manifest.dependencies?.some(d=>d.requirement==='msi-installed') && !manifest.installer)die('MSI-installed dependencies require a signed Windows MSI parent');
if(bytes.length>CONTENT_MAX && !manifest.installer)die('Non-installer archives remain limited to 4 MiB');
const signature=sign(null,Buffer.from('CLUSTER_MANAGED_PACKAGE_V1\n'+JSON.stringify(manifest)),privateKey).toString('base64');
fs.writeFileSync(outputPath,JSON.stringify({manifest,artifactBase64:bytes.toString('base64'),signatureBase64:signature,signingKeyFingerprint:sha(pubDer)},null,2),{mode:0o600});
console.log('Envelope written:',outputPath,'public key fingerprint:',sha(pubDer));
console.log('Public key (enroll only this in Cluster):\n'+publicKey.export({format:'pem',type:'spki'}));
