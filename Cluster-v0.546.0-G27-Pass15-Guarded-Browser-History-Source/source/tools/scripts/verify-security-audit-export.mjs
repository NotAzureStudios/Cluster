#!/usr/bin/env node
// Offline integrity check of Cluster security-audit export/v2 envelopes.
// Confirms the export body was not changed relative to its embedded SHA-256.
// Does NOT prove database completeness, provenance, authenticity or live ACLs.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const canonicalValue = value => {
  if (value === null || ['string','number','boolean'].includes(typeof value)) return value;
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== 'object') return String(value);
  return Object.fromEntries(Object.entries(value)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, child]) => [key, canonicalValue(child)]));
};
export function verifyExport(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return {ok:false,code:'INVALID_PAYLOAD'};
  if (payload.format !== 'cluster-security-audit-export/v2') return {ok:false,code:'UNSUPPORTED_FORMAT'};
  if (payload.exportDigestScope !== 'stableAuditJson(payload without exportDigestSha256)') return {ok:false,code:'UNKNOWN_DIGEST_SCOPE'};
  if (!/^[a-f0-9]{64}$/.test(payload.exportDigestSha256 || '')) return {ok:false,code:'INVALID_DIGEST'};
  const {exportDigestSha256, ...unsigned} = payload;
  const actual = createHash('sha256').update(JSON.stringify(canonicalValue(unsigned)), 'utf8').digest('hex');
  return {ok:actual === exportDigestSha256,code:actual === exportDigestSha256?'DIGEST_MATCH':'DIGEST_MISMATCH',
    records:Array.isArray(payload.events)?payload.events.length:null,
    // Never display metadata or event contents in a verifier output.
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const filename = process.argv[2];
  if (!filename || filename.startsWith('-')) {
    process.stderr.write('Usage: node tools/scripts/verify-security-audit-export.mjs <export.json>\n');
    process.exitCode = 2;
  } else {
    try {
      const result = verifyExport(JSON.parse(readFileSync(filename,'utf8')));
      process.stdout.write(`${JSON.stringify(result)}\n`);
      if (!result.ok) process.exitCode = 1;
    } catch {
      process.stderr.write('Cannot read or parse audit export.\n');
      process.exitCode = 2;
    }
  }
}
