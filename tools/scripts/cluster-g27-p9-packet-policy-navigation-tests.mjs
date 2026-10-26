import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const ts = (() => { try { return require('typescript'); } catch { return require(path.join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(), 'typescript/lib/typescript.js')); } })();
const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const name = 'packages/renderer/src/features/workflow/authorized-packet-navigation.ts';
const mod = { exports: {} };
vm.runInNewContext(ts.transpileModule(read(name), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { module: mod, exports: mod.exports }, { filename: name });
const { resolveAuthorizedPacketNavigation: resolve, requiresAuthorizedPacketNavigation: requires } = mod.exports;
let checks = 0;
const check = async (title, fn) => { await fn(); checks++; console.log(`PASS G27 P9 ${title}`); };
const packet = { screen: 'packets', packetId: 'p-1', projectId: 'old' };
const policy = { screen: 'packets', policyId: 'policy-1', projectId: 'old' };
await check('Packet is verified against fresh filtered Packet catalog', async () => {
  const result = await resolve(packet, { isCurrent: () => true, read: async path => {
    assert.equal(path, '/api/packets'); return { packets: [{ id: 'p-1' }] };
  }});
  assert.equal(result.packetId, 'p-1'); assert.equal(result.projectId, null);
});
await check('Policy is verified against required per-user policy feed', async () => {
  const result = await resolve(policy, { isCurrent: () => true, read: async path => {
    assert.equal(path, '/api/studio-policies/required'); return { policies: [{ policy: { id: 'policy-1' } }] };
  }});
  assert.equal(result.policyId, 'policy-1'); assert.equal(result.projectId, null);
});
await check('revoked, missing, and wrong-identity targets do not navigate', async () => {
  for (const [target, rows] of [[packet, { packets: [{ id: 'not-requested' }] }], [policy, { policies: [{ policy: { id: 'unrelated' } }] }]]) {
    for (const value of [null, undefined, {}, { packets: [], policies: [] }, rows, { packets: 'not-array', policies: 'not-array' }]) {
      assert.equal(await resolve(target, { isCurrent: () => true, read: async () => value }), null);
    }
    assert.equal(await resolve(target, { isCurrent: () => true, read: async () => { throw new Error('denied'); } }), null);
  }
});
await check('stale promises and cancelled UI do not navigate', async () => {
  for (const target of [packet, policy]) {
    let active = true;
    assert.equal(await resolve(target, { isCurrent: () => active, read: async () => { active = false; return { packets: [{id:'p-1'}], policies: [{policy:{id:'policy-1'}}] }; } }), null);
    assert.equal(await resolve(target, { isCurrent: () => false, read: () => { throw new Error('called while stale'); } }), null);
  }
});
await check('index-only routes do not generate an admission fetch', async () => {
  for (const target of [{ screen: 'packets' }, { screen: 'inbox', packetId: 'p-1' }, { screen: 'project', packetId: 'p-1' }]) {
    assert.equal(requires(target), false);
    assert.equal(await resolve(target, { isCurrent: () => true, read: () => { throw new Error('called for index'); } }), null);
  }
});
await check('ambiguous, malformed and oversized links fail closed', async () => {
  const opts = { isCurrent: () => true, read: async () => ({ packets: [{id:'p-1'}], policies: [{ policy: {id:'policy-1'} }] }) };
  for (const target of [{...packet,policyId:'policy-1'}, {...packet,packetId:' '}, {...policy,policyId:' '}, {...packet,packetId:'x'.repeat(201)}, {...policy,policyId:'x'.repeat(201)}]) assert.equal(await resolve(target,opts),null);
});
await check('central application admits Packet/Policy before mutating navigation', async () => {
  const app = read('packages/renderer/src/features/application/ClusterApplication.tsx');
  assert.match(app, /if \(requiresAuthorizedPacketNavigation\(incoming\)\) \{/);
  assert.match(app, /resolveAuthorizedPacketNavigation\(incoming, \{/);
  assert.match(app, /queryApi<PacketNavigationCatalogRead>\(path, \{\s*force: true, persist: false, staleWhileRevalidate: false/);
  assert.match(app, /Packet or policy link unavailable/);
  assert.match(app, /target\.screen === "packets" && \(target\.packetId \|\| target\.policyId\)/);
});
await check('mounted Packets page consumes only admitted navigation, not the raw intent', async () => {
  const page = read('packages/renderer/src/features/packets/PacketsPage.tsx');
  const app = read('packages/renderer/src/features/application/ClusterApplication.tsx');
  const guard = read('packages/renderer/src/features/workflow/authorized-packet-navigation.ts');
  assert.match(guard, /CLUSTER_AUTHORIZED_PACKET_NAVIGATION_EVENT = "cluster:authorized-packet-navigation"/);
  assert.match(page, /addEventListener\(CLUSTER_AUTHORIZED_PACKET_NAVIGATION_EVENT, openKnowledgeTarget\)/);
  assert.match(page, /removeEventListener\(CLUSTER_AUTHORIZED_PACKET_NAVIGATION_EVENT, openKnowledgeTarget\)/);
  assert.doesNotMatch(page, /CLUSTER_OPEN_WORK_SOURCE_EVENT/);
  assert.match(app, /acceptedSequence === navigationSequence/);
  assert.match(app, /dispatchEvent\(new CustomEvent\(CLUSTER_AUTHORIZED_PACKET_NAVIGATION_EVENT/);
});
await check('Copy Link keeps Card-only Desktop deep links resolvable', async () => {
  const actions = read('packages/renderer/src/features/workflow/work-actions.ts');
  const bridge = read('packages/renderer/src/features/workflow/desktop-deep-link-navigation.ts');
  assert.match(actions, /const deepLink = desktop \? clusterWorkDeepLink\(context\) : null;/);
  assert.doesNotMatch(actions, /context\.source\.kind === "card" && !\(context\.boardId/);
  assert.match(bridge, /desktopDeepLinkNavigation/);
});
await check('Packets UI refuses explicit revoked links without substituting first available record', async () => {
  const page = read('packages/renderer/src/features/packets/PacketsPage.tsx');
  assert.match(page, /if \(selectId && !exists\) \{\s*setActivePacketId\(""\);\s*setLoadError\(new Error\("The linked Packet is not available to you\."\)\)/);
  assert.match(page, /if \(selectId && !exists\) \{\s*if \(keepSelection\) return false;\s*setActivePolicyId\(""\);\s*setPolicyError\("The linked Studio Policy is not available to you\."\)/);
  assert.match(page, /const activePolicy = policyFeed\.policies\.find\(\(entry\) => entry\.policy\.id === activePolicyId\) \|\| null;/);
});
await check('catalog server authority filters by visibility, audience and recipient', async () => {
  const routes = read('apps/server/src/domains/library/packet-routes.ts');
  assert.match(routes,/app\.get\("\/api\/packets"[\s\S]*?requirePacketsAccess\(request, reply\)/);
  assert.match(routes,/if \(!visibleFor\(context, item\)\) continue/);
  assert.match(routes,/loadStudioAudienceUserContext\(prisma, context\.user, \{ strict: true \}\)/);
  assert.match(routes,/studioAudienceMatchesContext\(item\.packetDefinition\?\.audienceJson, context\.user\.id, audienceContext\)/);
  const policies = read('apps/server/src/domains/studio-systems/studio-systems-routes.ts');
  assert.match(policies, /"\/api\/studio-policies\/required"/);
});
console.log(`${checks}/${checks} G27 Pass 9 packet/policy admission checks passed`);
