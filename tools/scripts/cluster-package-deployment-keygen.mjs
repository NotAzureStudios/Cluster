// One-time administrative provisioning. Never prints the private key.
// Use the public key fingerprint over an independently authenticated channel.
import { generateKeyPairSync, createHash } from 'node:crypto';
import { lstatSync, openSync, writeFileSync, closeSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
const target = process.argv[2];
if (!target || process.argv.length !== 3) {
  console.error('Usage: node tools/scripts/cluster-package-deployment-keygen.mjs <NEW_PRIVATE_PEM_PATH>');
  process.exit(2);
}
const destination=resolve(target);
if (!lstatSync(dirname(destination)).isDirectory()) throw new Error('Existing trusted output directory required');
const {privateKey,publicKey}=generateKeyPairSync('ed25519');
const privateBytes=privateKey.export({type:'pkcs8',format:'pem'});
const der=publicKey.export({type:'spki',format:'der'});
const fingerprint=createHash('sha256').update(der).digest('hex');
const fd=openSync(destination,'wx',0o600);
try {writeFileSync(fd,privateBytes);} finally {closeSync(fd);}
console.log('Deployment-control private key created:',destination);
console.log('Deployment-control public key DER/SPKI SHA-256:',fingerprint);
console.log('Server configuration: CLUSTER_PACKAGE_DEPLOYMENT_GRANT_PRIVATE_KEY_FILE=<absolute-private-PEM-path>');
console.log('Enroll the SHA-256 fingerprint in Desktop separately from the Package-signing pin, using an independent channel.');
console.log('Keep this private key outside public source/build archives. Never distribute the PEM.');
