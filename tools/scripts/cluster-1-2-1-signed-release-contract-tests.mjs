// Release-pipeline contract: immutable GitHub releases must never be used as
// mutable signed update channels. Only the separate publisher-signed JSON branch
// can advance the official Server feed. This performs no network operations.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
const read=(p)=>readFileSync(path.join(process.cwd(),p),'utf8');
const metadata=JSON.parse(read('config/release-candidate.json'));
const toolchain=JSON.parse(read('config/toolchain-versions.json'));
const installer=read('apps/server-launcher-go/server_update_manifest.go');
const signer=read('tools/scripts/cluster-sign-server-release.mjs');
const publisher=read('.github/workflows/cluster-server-signed-main-publish.yml');
const manual=read('.github/workflows/publish-cluster-1-2-2-full.yml');
const goTests=read('apps/server-launcher-go/server_update_manifest_test.go');
const feed='https://github.com/NotAzureStudios/Cluster/raw/refs/heads/server-update-feed/cluster-server-main.json';
assert.equal(metadata.release,'1.2.2');
assert.equal(metadata.sequence,200002);
assert.equal(metadata.sourceVersion,toolchain.cluster);
assert.match(installer,/defaultOfficialMainServerUpdateFeedURL\s*=\s*"https:\/\/github\.com\/NotAzureStudios\/Cluster\/raw\/refs\/heads\/server-update-feed\/cluster-server-main\.json"/);
assert.ok(publisher.includes("'"+feed+"'"),'publisher must sign from the same exact public Server feed');
assert.ok(publisher.includes('server-v$($metadata.release)'),'versioned signed Server artifacts must be immutable');
assert.ok(!/gh release upload\s+server-main/.test(publisher),'immutable server-main release asset must never be clobbered');
assert.ok(publisher.includes("gh api -X PUT") && publisher.includes("contents/$feedFile"),'signed pointer must advance on the dedicated branch');
assert.ok(publisher.includes('$previous.sequence') && publisher.includes('-ge [int]$metadata.sequence'),'published signed pointer must never roll back');
assert.ok(publisher.includes('Published signed update pointer differs from signed release manifest'),'published pointer integrity must be rechecked');
assert.ok(publisher.indexOf('gh release create "$tag"')<publisher.indexOf('gh api -X PUT'),'publish immutable installer before updating signed pointer');
assert.ok(signer.includes('feedURL.origin===artifactURL.origin'),'declared signed installer must be same-origin as official GitHub feed');
assert.ok(installer.includes('raw.githubusercontent.com') && installer.includes('officialServerGitHubReleaseAssetPrefix'),'allow only pinned GitHub CDN redirects');
assert.ok(goTests.includes('TestOfficialImmutableGitHubReleaseUsesExactMutableSignedFeedRedirect'),'cross-origin raw redirect tests must be present');
assert.ok(manual.includes('gh release create v1.2.2') && manual.includes('--target "$SERVER_SHA"'),'manual release must reference exact verified build');
assert.ok(manual.includes("assert metadata['sequence']==200002"),'manual release must pin canonical signed version order');
assert.ok(manual.includes('Cluster-server-build-receipt.json'),'manual release must include artifact provenance');
assert.ok(manual.includes('Cluster-Desktop-1.2.2-windows-x64.zip') && manual.includes('Cluster-Desktop-Installer-1.2.2-windows-x64.exe'),'Desktop release must contain genuinely rebuilt 1.2.2 binaries');
assert.ok(!manual.includes('Cluster-Desktop-0.482.0-windows-x64.zip'),'Full release must never recycle legacy Qt Desktop binaries');
assert.ok(manual.includes('Match the reviewed Server build to this exact Desktop source commit'),'joined publisher must require matching Server and Qt builds');
console.log('PASS: Cluster 1.2.2 signed channel immutability, publisher order, mono-sequence, full joint Server and Qt Desktop installer contracts');
