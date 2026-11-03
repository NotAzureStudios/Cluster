import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";

const security = stripTypeScriptTypes(readFileSync("apps/server/src/core/security.ts","utf8"),{mode:"strip"});
const securityUrl = "data:text/javascript;base64,"+Buffer.from(security).toString("base64");
let auth = readFileSync("apps/server/src/core/auth.ts","utf8");
assert.ok(auth.includes('from "./security.js"'),"auth validator must depend on canonical loopback policy");
auth = auth.replace('from "./security.js"', `from "${securityUrl}"`);
auth = auth.replace('import { hashCredential, verifyCredential } from "./credential-security.js";',
  'const hashCredential = () => {throw Error("not used in this test")}; const verifyCredential = hashCredential;');
const moduleUrl = "data:text/javascript;base64,"+Buffer.from(stripTypeScriptTypes(auth,{mode:"strip"})).toString("base64");
const { validateProductionAuthConfiguration } = await import(moduleUrl);
const baseline = () => ({
 nodeEnv:"production", runtimeProfile:"managed-host", listenHost:"127.0.0.1",
 sessionSecret:"session-1234567890-abcdefghijklmnopqrstuvwxyz",
 authSecret:"auth-1234567890-abcdefghijklmnopqrstuvwxyz",
 authRequired:true,devLoginEnabled:false,sessionSecure:true,
 rateLimitEnabled:true,securityHeadersEnabled:true,requireMutationOrigin:true,
 requireDiscordLink:false,webOrigin:"https://cluster.azurestudios.dev",
});
let tested=0;
function accepted(override,label){
 assert.doesNotThrow(()=>validateProductionAuthConfiguration({...baseline(),...override}),label);
 tested++;
}
function rejected(override,pattern,label){
 assert.throws(()=>validateProductionAuthConfiguration({...baseline(),...override}),pattern,label);
 tested++;
}
accepted({},"Cloudflare HTTPS public origin must not block managed Host startup");
accepted({webOrigin:"https://my-server.example.ts.net"},"Tailscale Serve HTTPS origin");
accepted({webOrigin:"https://192.168.1.18:3443"},"native TLS LAN HTTPS origin");
accepted({webOrigin:"http://127.0.0.1:3000",sessionSecure:false},"original local HTTP remains supported");
accepted({webOrigin:"http://localhost:3000",sessionSecure:false},"localhost backward compatibility");
accepted({webOrigin:"http://192.168.1.17:3000",sessionSecure:false,allowInsecureManagedHostHttp:true},"explicit trusted LAN HTTP");
rejected({webOrigin:"http://192.168.1.17:3000",sessionSecure:false},/requires HTTPS/,"LAN HTTP must require explicit opt-in");
rejected({webOrigin:"http://cluster.azurestudios.dev",sessionSecure:false},/requires HTTPS/,"public cleartext forbidden by default");
rejected({webOrigin:"https://cluster.azurestudios.dev",sessionSecure:false},/Secure session cookies/,"public HTTPS cannot disable secure cookies");
rejected({webOrigin:"https://bad.example/?redirect=https://good.example"},/clean HTTP\(S\) URL/,"no URL queries");
rejected({webOrigin:"https://user:secret@cluster.azurestudios.dev"},/clean HTTP\(S\) URL/,"no userinfo");
rejected({webOrigin:"https://cluster.azurestudios.dev/admin"},/clean HTTP\(S\) URL/,"no path");
rejected({webOrigin:"file:///C:/Cluster/Server"},/clean HTTP\(S\) URL/,"no invalid schemes");
rejected({listenHost:"0.0.0.0"},/private API to bind to loopback/,"Node must remain private");
rejected({discordRedirectUri:"http://some-host.example/oauth"},/requires HTTPS/,"Discord remote OAuth must still use HTTPS");
accepted({discordRedirectUri:"https://cluster.azurestudios.dev/api/oauth/discord/callback"},"public HTTPS Discord redirect accepted");
rejected({runtimeProfile:"direct-production",webOrigin:"http://127.0.0.1:3000"},/requires HTTPS/,"direct-production policy stays strict");
const runtime = readFileSync("apps/server/src/core/runtime-config.ts","utf8");
const go = readFileSync("apps/host-go/api_process.go","utf8");
const native = readFileSync("apps/host-go/main.go","utf8");
assert.match(runtime,/allowInsecureManagedHostHttp: runtimeProfile === "managed-host" && env\.CLUSTER_MANAGED_HOST_ALLOW_INSECURE_LAN_HTTP === "true"/);
assert.match(go,/WEB_ORIGIN":\s+h\.origin/);
assert.match(go,/SESSION_SECURE":\s+strconv\.FormatBool\(h\.scheme == "https"\)/);
assert.match(go,/CLUSTER_MANAGED_HOST_ALLOW_INSECURE_LAN_HTTP": strconv\.FormatBool\(h\.remoteAccess && h\.allowInsecureHTTP && h\.scheme == "http"\)/);
assert.match(native,/allowInsecureHTTP: \*allowInsecureHTTP/);
console.log(`PASS: ${tested} managed-host public-origin startup, cookie, proxy and LAN security cases`);
