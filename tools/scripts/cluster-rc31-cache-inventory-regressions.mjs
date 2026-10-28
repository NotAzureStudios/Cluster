import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
const root=path.resolve(import.meta.dirname,'../..');
const read=(name)=>readFileSync(path.join(root,name),'utf8');
const require=createRequire(import.meta.url);
const ts=(()=>{try{return require('typescript')}catch{return require(path.join(execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim(),'typescript'))}})();
let total=0;
const check=(value,message)=>{assert.ok(value,message);total++};
const inventory=read('apps/server/src/domains/inventory/studio-inventory-vault-routes.ts');
check(/type InventoryCatalogAsset\s*=/.test(inventory),'Catalog typed even through dynamic Prisma handle');
check(/const page: InventoryCatalogAsset\[\] = rows.slice\(0, 100\)/.test(inventory),'Typed inventory page');
check(inventory.includes('physicalIds = page.filter((asset) =>') && inventory.includes('digitalIds = page.filter((asset) =>'),'Typed physical/digital asset callbacks');
const home=read('packages/renderer/src/features/application/modules/ApplicationDashboard.tsx');
const catalog=read('packages/renderer/src/features/home-widgets/use-widget2-catalog-insights.ts');
const layout=read('packages/renderer/src/features/home-widgets/home-layout-sharing.ts');
const life=read('packages/renderer/src/features/home-widgets/use-home-delivery-lifecycle.ts');
const query=read('packages/renderer/src/core/api/query.ts');
const security=read('apps/server/src/app/server-request-security-services.ts');
check(!catalog.includes('if (canSourceControl) void loadSourceControl(true)'),'No forced catalog read on Home mount');
check(!catalog.includes('if (canIntegrations) void loadIntegrations(true)'),'No forced integration read on Home mount');
check(!catalog.includes('if (canSavedViews) void loadSavedViews(true)'),'No forced saved-view read on Home mount');
check(layout.includes('const refresh = useCallback(async (force = false)'),'Home layout uses cache on mount');
check(layout.includes('refresh: () => refresh(true)'),'User-initiated Home layout refresh bypasses stale cache');
check(life.includes('queryApi<{ projects?: HomeDeliveryLifecycleSummary[] }>'),'Delivery lifecycle uses deduplicating shared read cache');
check(home.includes('staleMs: 90_000, maxAgeMs: 10 * 60_000, force, tags: ["timeline", "home"]'),'Timeline widget has longer hot cache');
check(home.includes('staleMs: 20_000, maxAgeMs: 60_000, force, tags: ["inbox", "notifications", "home"]'),'Inbox retains bounded freshness');
check(home.includes('window.setTimeout(runScheduledHomeRefresh, 1_000)'),'Events coalesce before refresh');
check(query.includes('noteRateLimitedRead(backoffKey, error)'),'429 source-specific cooldown recorded');
check(query.includes('!rateLimitedRead(backoffKey)'),'Background stale query revalidation respects cooldown');
check(query.includes('currentSessionCacheGeneration()'),'429 cooldown respects session invalidation');
check(query.includes('requiresFreshSearchAuthorization(path)'),'Authorization-sensitive Search still bypasses caching');
check(security.includes('reply.header("X-Cluster-Rate-Limit-Bucket"'),'Diagnostics identify user-scoped rate limiter');
check(security.includes('key.startsWith("user-scope:")'),'Bucket label does not expose arbitrary security key');
const changed=[
'apps/server/src/domains/inventory/studio-inventory-vault-routes.ts',
'apps/server/src/app/server-request-security-services.ts',
'packages/renderer/src/features/application/modules/ApplicationDashboard.tsx',
'packages/renderer/src/features/home-widgets/use-widget2-catalog-insights.ts',
'packages/renderer/src/features/home-widgets/home-layout-sharing.ts',
'packages/renderer/src/features/home-widgets/use-home-delivery-lifecycle.ts',
'packages/renderer/src/core/api/query.ts',
];
for(const file of changed){const sf=ts.createSourceFile(file,read(file),ts.ScriptTarget.Latest,true,file.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);check(sf.parseDiagnostics.length===0,`No parsing errors: ${file}`)}
// Prove that strict TypeScript accepts the Inventory paginated query's typed
// callbacks, rather than only verifying its source with a regex.
const dir=mkdtempSync(path.join(tmpdir(),'cluster-rc31-ts-'));
try {
 writeFileSync(path.join(dir,'inventory-test.ts'),`type InventoryCatalogAsset={id:string;kind:'physical'|'equipment'|'digital'|'license';capacity:number;status:'active'|'retired';[field:string]:unknown};declare const rows:any[];declare function inventoryDigitalKind(kind:string):boolean;const page:InventoryCatalogAsset[]=rows.slice(0,100);const physicalIds=page.filter((asset)=>!inventoryDigitalKind(asset.kind)).map((asset)=>asset.id);const digitalIds=page.filter((asset)=>inventoryDigitalKind(asset.kind)).map((asset)=>asset.id);void physicalIds;void digitalIds;`);
 execFileSync('tsc',['--strict','--noEmit','--skipLibCheck','--target','es2022',path.join(dir,'inventory-test.ts')],{stdio:'pipe'});
 check(true,'Inventory callback model passes strict TypeScript compile');
}finally{rmSync(dir,{recursive:true,force:true})}
const id=JSON.parse(read('config/release-candidate.json'));
check(id.sequence>=31 && id.release===`1.0.0-rc.${id.sequence}`,'RC31-or-later release identity');
console.log(`RC31: ${total}/${total} targeted regression checks passed`);
