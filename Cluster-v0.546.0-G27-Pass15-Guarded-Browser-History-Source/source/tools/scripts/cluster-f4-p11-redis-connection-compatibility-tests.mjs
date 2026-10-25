import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../..');
const source=fs.readFileSync(path.join(root,'apps/server/src/core/acceleration/cluster-acceleration-runtime.ts'),'utf8');
let n=0; const eq=(a,b,m)=>{assert.equal(a,b,m);n++}; const yes=(b,m)=>{assert.ok(b,m);n++};
const connection=source.slice(source.indexOf('private async connectRedis()'),source.indexOf('private scheduleRedisReconnect()'));
for(const snippet of [
 'await command.ping()','await subscriber.subscribe(this.busChannel()',
 'this.redisConnected = false;','await runRedisProtocolCompatibility({ command, prefix: this.keyPrefix })',
 'if (protocol.status !== "passed")','throw new Error(`Configured Redis acceleration lacks required commands:',
 'this.refreshRedisConnected();','this.compatibilityCached = { at: Date.now(), result: protocol }',
 'this.logger.info?.({ backend: "redis"'
])yes(connection.includes(snippet),'connect-time protocol gate '+snippet);
const probeStart=connection.indexOf('this.redisConnected = false;', connection.indexOf('await subscriber.subscribe'));
const probe=connection.indexOf('await runRedisProtocolCompatibility');
const decision=connection.indexOf('if (protocol.status !== "passed")');
const refresh=connection.indexOf('this.refreshRedisConnected();',probe);
const cache=connection.indexOf('this.compatibilityCached = { at: Date.now(), result: protocol }');
const info=connection.indexOf('this.logger.info?.({ backend: "redis"');
yes(probeStart>=0 && probe>probeStart,'distributed flag cleared during validation');
yes(decision>probe && refresh>decision && cache>refresh && info>cache,'backend usable only after verified protocol');
const start=source.slice(source.indexOf('async start()'),source.indexOf('async close()'));
yes(start.includes('await this.connectRedis()'),'startup invokes compatibility-gated connection');
yes(start.includes('if (this.mode === "redis-required") throw new Error'),'required mode rejects incompatible backend');
yes(start.includes('this.scheduleRedisReconnect()'),'auto mode schedules memory fallback retry');
yes(start.includes('backend: "memory"'),'auto mode continues with bounded memory');
const reconnect=source.slice(source.indexOf('private scheduleRedisReconnect()'),source.indexOf('private async onRedisMessage('));
yes(reconnect.includes('void this.connectRedis().catch'),'reconnect is also compatibility gated');
const route=fs.readFileSync(path.join(root,'apps/server/src/app/server-routes-health-operations.ts'),'utf8');
yes(route.includes('compatibility-check'),'operator-initiated check still available');
eq(source.includes('this.compatibilityCached = {at:Date.now(), result};'),true,'on-demand operator result still cached');
console.log(`${n}/${n} F4 P11 connection protocol gate contract assertions passed`);
