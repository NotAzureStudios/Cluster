import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ts = require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js');
const source = fs.readFileSync(new URL('../../apps/server/src/domains/domains/domain-management-routes.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const chain = new Proxy(function() {}, { get(_target, field) {
  if (field === 'safeParse') return input => ({ success: true, data: input });
  if (field === 'extend' || field === 'strict' || field === 'regex' || field === 'trim' || field === 'max' || field === 'min' || field === 'optional' || field === 'nullable' || field === 'int' || field === 'positive') return () => chain;
  return chain;
}, apply: () => chain });
const z = new Proxy({}, { get: () => chain });
const exports = {};
const mods = {
  'node:crypto': require('node:crypto'), 'node:url': require('node:url'),
  'node:dns/promises': require('node:dns/promises'), 'node:net': require('node:net'),
  zod: { z },
};
vm.runInNewContext(code, { exports, require: id => { if (!(id in mods)) throw Error(`Unexpected dependency ${id}`); return mods[id]; }, Buffer, Date, Error });
const { registerDomainManagementRoutes, matchDnsRecord } = exports;
let count = 0;
function check(value, expected, label) { assert.equal(value, expected, label); count++; }
check(matchDnsRecord('CNAME', 'server.example.net', ['server.example.net.']), true, 'DNS CNAME trailing dot');
check(matchDnsRecord('A', '192.0.2.5', ['192.0.2.7']), false, 'IPv4 mismatch');
check(matchDnsRecord('AAAA', '2001:db8::1', ['2001:DB8::1']), true, 'IPv6 comparison');
const records = new Map();
const routes = new Map();
let failAudit = false, adminAllowed = true, serverId = '9bce235d-38df-4dfa-b156-a6d4a1b79f90';
let dnsProof = null;
const clone = () => new Map([...records].map(([key, value]) => [key, structuredClone(value)]));
function orm(store) { return {
  studioManagedDomain: {
    async create({data}) { if ([...store.values()].some(row => row.domain === data.domain)) { const err = new Error('Unique'); err.code = 'P2002'; throw err; }
      const item = { ...data, note: data.note || null, registrar: null, expiresOn: null, verificationState: 'pending', verifiedAt: null, bindingHostname: null, bindingServerLabel: null, bindingServerInstanceId: null, bindingDnsType: null, bindingDnsTarget: null, bindingNote: null, revision: 1 };
      store.set(data.id, item); return item;
    },
    async findUnique({where}) { return store.get(where.id) || null; },
    async findMany({ where = {}, take = 51 }) { let all = [...store.values()].sort((a,b) => a.domain.localeCompare(b.domain));
      if (where.domain?.gt) all = all.filter(row => row.domain > where.domain.gt);
      if (where.AND?.[0]?.domain?.contains) all = all.filter(row => row.domain.includes(where.AND[0].domain.contains));
      return all.slice(0,take);
    },
    async updateMany({where, data}) {
      const item = store.get(where.id);
      if (!item || Object.entries(where).some(([field,value]) => field !== 'id' && item[field] !== value)) return { count: 0 };
      const next = { ...item, ...data, revision: typeof data.revision === 'object' ? item.revision + data.revision.increment : (data.revision ?? item.revision) };
      if (next.bindingHostname && [...store.values()].some(row => row.id !== item.id && row.bindingHostname === next.bindingHostname)) { const err=new Error('Unique'); err.code='P2002'; throw err; }
      store.set(item.id,next); return { count: 1 };
    }
  }
}; }
const prisma = {
  ...orm(records),
  async $transaction(fn) {
    const temp = clone(); const result = await fn(orm(temp));
    records.clear(); for (const [id, row] of temp) records.set(id,row);
    return result;
  }
};
const auditService = { async recordSecurityInTransaction() { if (failAudit) throw new Error('audit store down'); return {ok:true}; } };
registerDomainManagementRoutes({
  app: { get(path,handler) { routes.set(`GET ${path}`,handler); }, post(path,handler) { routes.set(`POST ${path}`,handler); }, patch(path,handler) { routes.set(`PATCH ${path}`,handler); } },
  prisma, authorization: { async requireAdmin() { return adminAllowed; } }, getCurrentUser: async () => ({id:'admin'}), auditService,
  readSettings: async () => ({serverInstanceId:serverId,serverDisplayName:'Studio Primary'}),
  dnsLookup: async () => dnsProof ? [[`cluster-domain-verification=${dnsProof}`]] : [],
  dnsCNAME: async () => ['target.studio.example.'], dnsA: async () => ['198.51.100.4'], dnsAAAA: async () => ['2001:db8::1'],
});
async function invoke(method, path, body = {}, params = {}, query = {}) {
  const handler = routes.get(`${method} ${path}`); assert.ok(handler, `${method} ${path}`);
  const reply = { statusCode: 200, code(status){ this.statusCode=status; return this; }, header(){return this;}, send(data){this.payload=data;return data;} };
  const result = await handler({ body, params, query, id:'req', method, url:path }, reply);
  return { status:reply.statusCode, data: result ?? reply.payload };
}
const root='/api/admin/domains';
let result=await invoke('POST',root,{domain:'Example.COM',note:'Owned by studio'});
check(result.status,201,'registered');
const id = result.data.domain.id;
const token = result.data.dnsChallenge.value.split('=')[1]; dnsProof=token;
let row=records.get(id);
check(row.domain,'example.com','domain canonical');
result=await invoke('POST', `${root}/:id/verify`,{expectedRevision:row.revision},{id});
check(result.data.domain.verificationState,'verified','verified');
row=records.get(id);
result=await invoke('POST',`${root}/:id/bind`,{expectedRevision:row.revision,hostname:'cluster.example.com',dnsType:'CNAME',dnsTarget:'target.studio.example'},{id});
check(result.data.domain.bindingServerInstanceId,serverId,'binding authoritative server identity');
check(result.data.domain.bindingServerLabel,'Studio Primary','label only derived from server');
check(result.data.provisioning,'manual_dns_tls_required','binding not deployed');
result=await invoke('GET',`${root}/:id/dns-status`,{}, {id});
check(result.data.ownership,'present','DNS ownership');
check(result.data.routing,'matching','CNAME routing match');
check(result.data.tls,'not_checked','no fake TLS');
check(result.data.connectivity,'not_checked','no fake connectivity');
row=records.get(id);
result=await invoke('PATCH',`${root}/:id`,{expectedRevision:row.revision,registrar:'Example Registrar',expiresOn:'2028-12-31',note:'Renew manually'},{id});
check(result.data.domain.registrar,'Example Registrar','metadata update');
check(result.data.domain.expiresOn.toISOString().slice(0,10),'2028-12-31','expiry stored UTC');
row=records.get(id);
result=await invoke('PATCH',`${root}/:id`,{expectedRevision:row.revision,expiresOn:'2028-02-31'},{id});
check(result.data.code,'INVALID_EXPIRATION_DATE','invalid calendar date blocked');
row=records.get(id);
result=await invoke('POST',`${root}/:id/bind`,{expectedRevision:row.revision,hostname:'steal.other.com',dnsType:'A',dnsTarget:'192.0.2.1'},{id});
check(result.data.code,'DOMAIN_BINDING_REJECTED','out-of-zone name blocked');
result=await invoke('POST',`${root}/:id/bind`,{expectedRevision:row.revision,hostname:'cluster.example.com',dnsType:'A',dnsTarget:'not-an-ip'},{id});
check(result.data.code,'INVALID_DNS_TARGET','invalid A blocked');
const previousRevision = records.get(id).revision;
failAudit=true;
result=await invoke('POST',`${root}/:id/unbind`,{expectedRevision:previousRevision},{id});
check(result.data.code,'DOMAIN_UNBIND_REJECTED','audit failure rejects mutation');
check(records.get(id).revision,previousRevision,'audit failure rolls back');
failAudit=false;
serverId='';
result=await invoke('POST',`${root}/:id/bind`,{expectedRevision:previousRevision,hostname:'cluster.example.com',dnsType:'CNAME',dnsTarget:'target.studio.example'},{id});
check(result.data.code,'SERVER_INSTANCE_IDENTITY_UNAVAILABLE','missing server identity blocked');
serverId='9bce235d-38df-4dfa-b156-a6d4a1b79f90';
result=await invoke('POST',`${root}/:id/rotate-challenge`,{expectedRevision:previousRevision},{id});
check(result.data.domain.bindingServerInstanceId,null,'challenge rotation clears server identity');
check(result.data.domain.bindingHostname,null,'challenge rotation unbinds');
check(result.data.domain.verificationState,'pending','new verification required');
const newProof = result.data.dnsChallenge.value.split('=')[1];
assert.notEqual(newProof,token); count++;
result=await invoke('POST',`${root}/:id/verify`,{expectedRevision:records.get(id).revision},{id});
check(result.data.code,'DNS_CHALLENGE_MISSING','old challenge not accepted');
dnsProof=newProof;
result=await invoke('POST',`${root}/:id/verify`,{expectedRevision:records.get(id).revision},{id});
check(result.data.domain.verificationState,'verified','new proof accepted');
for(let index=0;index<101;index++) records.set(`extra-${index}`, { id:`extra-${index}`,domain:`asset-${String(index).padStart(3,'0')}.org`,revision:1 });
result=await invoke('GET',root,{}, {}, {});
check(result.data.domains.length,50,'bounded first page');
assert.ok(result.data.nextCursor); count++;
const next=await invoke('GET',root,{}, {}, {after:result.data.nextCursor});
check(next.data.domains.length,50,'bounded second page');
const last=await invoke('GET',root,{}, {}, {after:next.data.nextCursor});
check(last.data.domains.length,2,'last page');
adminAllowed=false;
result=await invoke('GET',root,{}, {}, {});
check(result.data,undefined,'non-admin receives no registry');
console.log(`Domain lifecycle runtime checks: ${count} passed`);
