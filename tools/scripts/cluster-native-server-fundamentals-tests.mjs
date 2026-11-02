import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const source = path => readFileSync(path,"utf8");
const main = source("apps/server-launcher-go/main.go");
const runtime = source("apps/server-launcher-go/runtime_windows.go");
const admission = source("apps/server-launcher-go/managed_release_admission.go");
const panel = source("apps/server-launcher-go/launcher_ui_windows.go");
const service = source("apps/server-launcher-go/windows_service.go");
const logging = source("apps/server-launcher-go/native_logging.go");

const managedStart = main.split("if managedInstall {")[1]?.split("\n\tneedsBuild :=")[0];
assert.ok(managedStart, "managed release requires an early return before development build path");
assert.match(managedStart, /installedDependencyGraphHealthy\(root\)/);
assert.match(managedStart, /verifyManagedStartup\(root, force, prebuiltReady, dependenciesReady\)/);
assert.match(managedStart, /runManagedDatabaseCommandContext\(ctx, root, node, env, "deploy"\)/);
assert.match(managedStart, /return nil/);
assert.doesNotMatch(managedStart, /runNpm|db:generate|build:server|build:web/);

const deploy = main.split("func runManagedDatabaseCommandContext(")[1]?.split("\nfunc runNpm(")[0];
assert.ok(deploy, "managed Prisma runner must be distinct from npm");
assert.match(deploy, /exec\.CommandContext\(ctx, node, script, action\)/);
assert.match(deploy, /database-command\.mjs/);
assert.match(deploy, /prisma.*build.*index\.js/);
assert.match(deploy, /ctx\.Err\(\)/);
assert.doesNotMatch(deploy, /npm|install|build:server|build:web/);

assert.match(admission, /ManagedBy != "cluster-installer"/);
assert.match(admission, /if explicitRepair \{/);
assert.match(admission, /cannot be source-repaired in place/);
assert.match(main, /if options\.repair && fileExists/);
assert.match(panel, /if forceRepair && fileExists/);
assert.match(runtime, /installerNodeRoot := filepath\.Join\(filepath\.Dir\(root\), "Toolchains"/);
assert.match(runtime, /managed Cluster Node\.js runtime is missing/);
assert.match(runtime, /normal startup will not download runtimes/);
assert.match(panel, /runManagedDatabaseCommandContext\(context\.Background\(\), c\.options\.root, node, env, "doctor"\)/);

assert.match(logging, /func rotateNativeSessionLog/);
assert.match(logging, /func redactNativeLogLine/);
assert.match(panel, /redactNativeLogLine\(scanner\.Text\(\)\)/);
assert.match(panel, /rotateNativeSessionLog\(logPath, 32\*1024\*1024, 4\)/);
assert.match(service, /rotateNativeSessionLog\(logPath, 32\*1024\*1024, 4\)/);

console.log("PASS: managed release startup avoids npm and compiler, reuses installer Node, and protects native diagnostic logs");
