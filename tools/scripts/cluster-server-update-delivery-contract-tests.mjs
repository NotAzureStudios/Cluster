import assert from "node:assert/strict";
import fs from "node:fs";
import { createPublicKey } from "node:crypto";
import {stableServerSequence, validStableServerRelease} from "./cluster-server-release-sequence.mjs";

const read = p => fs.readFileSync(p,"utf8");
const manifest = read("apps/server-launcher-go/server_update_manifest.go");
const settings = read("apps/server-launcher-go/server_config_windows.go");
const stage = read("apps/server-launcher-go/server_update_stage.go");
const ui = read("apps/server-launcher-go/launcher_ui_windows.go");
const signer = read("tools/scripts/cluster-sign-server-release.mjs");
const publish = read(".github/workflows/cluster-server-signed-main-publish.yml");
const build = read(".github/workflows/cluster-server-windows-build.yml");
const networkCI = read(".github/workflows/network-configuration-regressions.yml");
const serverPublisherKey = read("apps/server-launcher-go/assets/server-update-public-key.pem").replace(/\r\n/g,"\n").trim();
const desktopPublisherKey = read("apps/desktop-qt/assets/update-public-key.pem").trim();

let checks = 0;
function ok(test, why){assert.ok(test,why);checks++;}

// One main channel pointer, never GitHub's product-agnostic latest release.
ok(manifest.includes("/raw/refs/heads/server-update-feed/cluster-server-main.json"),"dedicated signed Server feed branch; immutable GitHub release assets are not mutable pointers");
ok(!manifest.includes("/releases/latest/download/cluster-server-main.json"),"cannot depend on GitHub latest release shared with Desktop");
ok(settings.includes("return defaultOfficialMainServerUpdateFeedURL"),"no manual feed URL required for installed updated Server");
ok(settings.includes("CLUSTER_SERVER_MAIN_MANIFEST_URL"),"manual server-specific override preserved");
ok(settings.includes("CLUSTER_SERVER_DEVELOPMENT_MANIFEST_URL"),"development does not silently use main feed");

// Redirect allowlist must not become a generic cross-origin exception.
ok(manifest.includes('destination.Hostname()=="release-assets.githubusercontent.com"'),"specific GitHub asset CDN host");
ok(manifest.includes("officialServerGitHubReleaseAssetPrefix"),"repo-specific GitHub release asset path");
ok(manifest.includes("feed.String()!=defaultOfficialMainServerUpdateFeedURL"),"custom feed cannot use GitHub CDN exception");
ok(stage.includes("serverUpdateRedirectAllowed(feed, req.URL)"),"signed downloads and manifests apply redirect policy");
ok(settings.includes("serverUpdateRedirectAllowed(parsed, req.URL)"),"check-only HTTP client applies same redirect policy");
ok(settings.includes("checkUpdateManifestWithTransport"), "update discovery supports offline Windows regression tests");
ok(settings.includes("result.Available = false") && settings.includes('result.DownloadURL = ""'), "unsigned GitHub fallback cannot authorize an installer");
ok(settings.includes("checkOfficialServerReleaseWithClient"), "official release metadata is read-only and testable");
ok(settings.includes("ManualReleaseURL: latest.HTMLURL"), "only verified newer official releases produce a manual link");
ok(settings.includes("hasInstaller") && settings.includes("hasReceipt"), "manual release discovery requires both installer and integrity receipt");
ok(settings.includes("response.ContentLength > maxServerManifestBytes"), "oversized update bodies are rejected before download");
ok(settings.includes("Server update rejected:"), "signed JSON verification failures must still fail closed");
ok(ui.includes("manualReleaseURL != \"\"") && ui.includes("url.dll,FileProtocolHandler"), "manual GitHub releases open only after user confirmation");
ok(ui.includes("ui.controller.StageServerUpdate()"), "signed download path is unchanged and separate from manual releases");

// Source version must sign correctly. Avoid regex literal accidentally treating
// backslash-plus-dot as a release character sequence.
ok(signer.includes("stableServerSequence(release.release)"), "signer shares canonical 1.0/1.1 release sequencing");
ok(stableServerSequence("1.0.5") === 55, "legacy 1.0.5 remains sequence 55");
ok(stableServerSequence("1.0.10000") === 10050, "historic 1.0 patch limit remains ordered");
ok(stableServerSequence("1.1.0") === 100000, "Server 1.1.0 advances beyond 1.0.x");
ok(stableServerSequence("1.1.1") === 100001 && stableServerSequence("1.2.0") === 200000, "new minor versions have non-overlapping sequences");
ok(["1.0.0", "1.1.100000", "1.01.0", "2.0.0"].every(s=>stableServerSequence(s) === null), "invalid releases fail closed");
ok(validStableServerRelease({channel:"stable",release:"1.1.0",sourceVersion:"1.1.0",sequence:100000}), "installer admits valid 1.1.0 stable release identity");
ok(!validStableServerRelease({channel:"stable",release:"1.1.0",sourceVersion:"1.1.0",sequence:56}), "installer rejects reused 1.0.x sequence");
ok(signer.includes(String.raw`/^1\.0\.0-rc\.([1-9][0-9]*)$/`),"RC release version regex uses escaped dots");
ok(signer.includes("receipt.commit===commit.stdout.trim()"),"signer requires matching source revision");
ok(signer.includes("receipt.artifacts") && signer.includes("matchingArtifacts"),"signer requires a hashed build receipt");
ok(signer.includes("publicPem===trustedPem"),"signer pins publisher identity");
ok(createPublicKey(serverPublisherKey).asymmetricKeyType === "ed25519", "Server update publisher is a valid Ed25519 public key");
const approvedServerKey = ["-----BEGIN PUBLIC KEY-----", "MCowBQYDK2VwAyEAV+3AhLPapkCghOUR4oE+3fUHXYjXDFHUGsQPMcxtkz4=", "-----END PUBLIC KEY-----"].join("\n");
ok(serverPublisherKey === approvedServerKey, "1.1.2 Server update publisher public key matches reviewed key rotation");
ok(serverPublisherKey !== desktopPublisherKey, "Server publisher key is intentionally isolated from Desktop");
ok(manifest.includes("//go:embed assets/server-update-public-key.pem"), "Server verification embeds the dedicated publisher key");
ok(signer.includes('apps/server-launcher-go/assets/server-update-public-key.pem'), "Server signer checks the same key that the Server runtime embeds");
ok(!signer.includes('apps/desktop-qt/assets/update-public-key.pem'), "Server signer must not share Desktop publisher trust");

// Publication is a separate, privileged process. No publish before success.
ok(publish.includes("workflow_run.conclusion == 'success'"),"failed build cannot publish");
ok(publish.includes("head_branch == 'main'"),"non-main branch cannot publish");
ok(publish.includes("vars.CLUSTER_SERVER_AUTO_PUBLISH == 'true'"),"signed publishing is opt-in until certified");
ok(publish.includes("environment: server-release"),"protected release environment is used");
ok(publish.includes("CLUSTER_SERVER_SIGNING_KEY_PEM"),"publishing needs protected Ed25519 key");
ok(publish.includes('if ($head -ne $env:BUILT_SHA)'),"stale builds cannot publish");
ok(publish.includes("Required CI did not finish successfully"),"publisher waits for independent CI");
ok(publish.includes('$artifactName = "cluster-server-unsigned-windows-x64-$env:BUILT_SHA"'), "publisher pins the exact CI SHA-named artifact");
ok(publish.includes('--name "$artifactName" --dir "$staging"'), "publisher downloads one named artifact into isolated staging");
ok(!publish.includes("--pattern 'cluster-server-unsigned-windows-x64-*' --dir ."), "publisher cannot download globbed artifacts into source root");
ok(publish.includes("Join-Path $staging 'bin/Cluster-Installer.exe'") && publish.includes("Join-Path $staging 'Cluster-Installer.exe'"), "publisher handles only explicit preserved and flattened installer layouts");
ok(publish.includes('if ($valid.Count -ne 1)'), "publisher rejects missing or ambiguous artifact layouts");
ok(publish.includes("$buildReceipt.commit -ne $env:BUILT_SHA"), "publisher re-verifies downloaded build SHA against receipt");
ok(publish.includes("Get-FileHash -LiteralPath $source.installer -Algorithm SHA256"), "publisher checks downloaded installer SHA-256 before signing");
ok(publish.indexOf("Get-FileHash -LiteralPath $source.installer") < publish.indexOf("Copy-Item -LiteralPath $source.installer"), "release input checked before copying into signing paths");
ok(networkCI.replaceAll("\r\n","\n").includes("  push:\n    branches: [main]"), "required network release gate runs on the main commit as well as PRs");
ok(publish.includes("'Managed network access regressions'"), "publisher retains network security gate rather than bypassing it");
ok(publish.indexOf('gh release create "$tag"') < publish.indexOf("gh api -X PUT"),"immutable release exists before signed branch pointer updates");
ok(publish.includes("server-update-feed") && publish.includes("server-v"),"signed Server branch isolated from Desktop latest releases");
ok(!publish.includes("release upload \"$tag\" --clobber"),"immutable versioned installer cannot be overwritten");
ok(build.includes("branches: [main]") && !build.includes("  push:\n    branches: [main]\n    paths:"),"every main commit receives a build candidate");

// The native control panel staging action stays non-installing. The independent
// PIN-authorized web broker performs the privileged install separately.
ok(ui.includes("Download and verify the publisher-signed Server installer now?"),"an update can be staged from Check Updates");
ok(ui.includes("ui.controller.StageServerUpdate()"),"download confirmation leads to the signed staging path");
ok(ui.includes("This will NOT install, stop or restart Cluster."),"UI must not falsely promise installation");
console.log(`Cluster Server signed update delivery contracts: ${checks}/${checks} passed`);
