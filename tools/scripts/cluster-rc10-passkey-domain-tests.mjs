import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
if (!process.argv.includes('--transform-child')) {
  const result = spawnSync(process.execPath, ['--experimental-transform-types', fileURLToPath(import.meta.url), '--transform-child'], { stdio: 'inherit', timeout: 30000 });
  if (result.error || result.status !== 0) process.exit(1);
  process.exit(0);
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { webAuthnRpFromOrigin } = await import(pathToFileURL(path.join(root, 'apps/server/src/domains/auth/webauthn.ts')).href);
const { requireWebAuthnBrowserOrigin } = await import(pathToFileURL(path.join(root, 'packages/renderer/src/core/webauthn-client.ts')).href);

const good = webAuthnRpFromOrigin('http://localhost:3000');
assert.deepEqual(good, { origin: 'http://localhost:3000', rpId: 'localhost', rpName: 'Cluster' });
assert.deepEqual(webAuthnRpFromOrigin('https://cluster.example.com:3000'), { origin: 'https://cluster.example.com:3000', rpId: 'cluster.example.com', rpName: 'Cluster' });
for (const url of ['http://127.0.0.1:3000', 'http://192.168.1.10:3000', 'https://[::1]:3000']) {
  assert.throws(() => webAuthnRpFromOrigin(url), /WEBAUTHN_DOMAIN_REQUIRED/);
}
assert.throws(() => webAuthnRpFromOrigin('http://cluster.example.com:3000'), /WEBAUTHN_SECURE_ORIGIN_REQUIRED/);
for (const item of [
  { hostname: '127.0.0.1', protocol: 'http:', port: '3000', problem: /http:\/\/localhost:3000/ },
  { hostname: '192.168.1.10', protocol: 'http:', port: '3000', problem: /IP-address URL/ },
  { hostname: 'cluster.example.com', protocol: 'http:', port: '3000', problem: /HTTPS domain/ },
  { hostname: 'localhost', protocol: 'http:', port: '3000', problem: null },
  { hostname: 'cluster.example.com', protocol: 'https:', port: '', problem: null },
]) {
  globalThis.window = { location: item };
  if (item.problem) assert.throws(() => requireWebAuthnBrowserOrigin(), item.problem);
  else assert.doesNotThrow(() => requireWebAuthnBrowserOrigin());
}
delete globalThis.window;
const host = fs.readFileSync(path.join(root,'apps/host-go/gateway.go'),'utf8');
const runtime = fs.readFileSync(path.join(root,'apps/host-go/runtime_config.go'),'utf8');
const auth = fs.readFileSync(path.join(root,'packages/renderer/src/features/auth/AuthScreens.tsx'),'utf8');
const settings = fs.readFileSync(path.join(root,'packages/renderer/src/features/settings/AccountSettingsPage.tsx'),'utf8');
assert.match(runtime,/host := "localhost"/);
assert.match(host,/http.StatusTemporaryRedirect/);
assert.match(host,/http.StatusMisdirectedRequest/);
assert.match(host,/!sameOriginRequest\(request\)/);
assert.match(auth, /requireWebAuthnBrowserOrigin\(\);\s*const start = await api/);
assert.match(settings, /requireWebAuthnBrowserOrigin\(\);\s*const start = await api/);
console.log('RC10 WebAuthn/loopback-origin regression checks passed (RP selection, invalid origins, client preflight, safe redirect)');
