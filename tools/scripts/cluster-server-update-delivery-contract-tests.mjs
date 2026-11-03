import assert from "node:assert/strict";
import fs from "node:fs";

const read = p => fs.readFileSync(p,"utf8");
const manifest = read("apps/server-launcher-go/server_update_manifest.go");
const settings = read("apps/server-launcher-go/server_config_windows.go");
const stage = read("apps/server-launcher-go/server_update_stage.go");
const ui = read("apps/server-launcher-go/launcher_ui_windows.go");
const signer = read("tools/scripts/cluster-sign-server-release.mjs");
const publish = read(".github/workflows/cluster-server-signed-main-publish.yml");
const build = read(".github/workflows/cluster-server-windows-build.yml");

let checks = 0;
function ok(test, why){assert.ok(test,why);checks++;}

// One main channel pointer, never GitHub's product-agnostic latest release.
ok(manifest.includes("/releases/download/server-main/cluster-server-main.json"),"product-specific rolling signed feed");
ok(!manifest.includes("/releases/latest/download/cluster-server-main.json"),"cannot depend on GitHub latest release shared with Desktop");
ok(settings.includes("return defaultOfficialMainServerUpdateFeedURL"),"no manual feed URL required for installed updated Server");
ok(settings.includes("CLUSTER_SERVER_MAIN_MANIFEST_URL"),"manual server-specific override preserved");
ok(settings.includes("CLUSTER_SERVER_DEVELOPMENT_MANIFEST_URL"),"development does not silently use main feed");

// Redirect allowlist must not become a generic cross-origin exception.
ok(manifest.includes('destination.Hostname()!="release-assets.githubusercontent.com"'),"specific GitHub asset CDN host");
ok(manifest.includes("officialServerGitHubReleaseAssetPrefix"),"repo-specific GitHub release asset path");
ok(manifest.includes("feed.String()!=defaultOfficialMainServerUpdateFeedURL"),"custom feed cannot use GitHub CDN exception");
ok(stage.includes("serverUpdateRedirectAllowed(feed, req.URL)"),"signed downloads and manifests apply redirect policy");
ok(settings.includes("serverUpdateRedirectAllowed(parsed, req.URL)"),"check-only HTTP client applies same redirect policy");

// Source version must sign correctly. Avoid regex literal accidentally treating
// backslash-plus-dot as a release character sequence.
ok(signer.includes(String.raw`/^1\.0\.([1-9][0-9]*)$/`),"stable release version regex uses escaped dots");
ok(signer.includes(String.raw`/^1\.0\.0-rc\.([1-9][0-9]*)$/`),"RC release version regex uses escaped dots");
ok(signer.includes("receipt.commit===commit.stdout.trim()"),"signer requires matching source revision");
ok(signer.includes("receipt.artifacts") && signer.includes("matchingArtifacts"),"signer requires a hashed build receipt");
ok(signer.includes("publicPem===trustedPem"),"signer pins publisher identity");

// Publication is a separate, privileged process. No publish before success.
ok(publish.includes("workflow_run.conclusion == 'success'"),"failed build cannot publish");
ok(publish.includes("head_branch == 'main'"),"non-main branch cannot publish");
ok(publish.includes("vars.CLUSTER_SERVER_AUTO_PUBLISH == 'true'"),"signed publishing is opt-in until certified");
ok(publish.includes("environment: server-release"),"protected release environment is used");
ok(publish.includes("CLUSTER_SERVER_SIGNING_KEY_PEM"),"publishing needs protected Ed25519 key");
ok(publish.includes('if ($head -ne $env:BUILT_SHA)'),"stale builds cannot publish");
ok(publish.includes("Required CI did not finish successfully"),"publisher waits for independent CI");
ok(publish.indexOf('gh release create "$tag"') < publish.indexOf("gh release upload server-main"),"immutable release exists before mutable manifest pointer updates");
ok(publish.includes("server-main") && publish.includes("server-v"),"server channel isolated from desktop latest releases");
ok(!publish.includes("release upload \"$tag\" --clobber"),"immutable versioned installer cannot be overwritten");
ok(build.includes("branches: [main]") && !build.includes("  push:\n    branches: [main]\n    paths:"),"every main commit receives a build candidate");

// The control panel must NOT claim unattended installation yet. Signed
// staging is deliberately separate from the still-unimplemented native worker.
ok(ui.includes("Download and verify the publisher-signed Server installer now?"),"an update can be staged from Check Updates");
ok(ui.includes("ui.controller.StageServerUpdate()"),"download confirmation leads to the signed staging path");
ok(ui.includes("This will NOT install, stop or restart Cluster."),"UI must not falsely promise installation");
console.log(`Cluster Server signed update delivery contracts: ${checks}/${checks} passed`);
