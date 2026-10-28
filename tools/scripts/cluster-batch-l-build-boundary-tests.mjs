// Small semantic check for the two TypeScript errors exposed by the first
// dependency-backed Windows build. Not a substitute for `npm run build`.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '../..');
const ts = (() => {
  try { return require('typescript'); }
  catch { return require(path.join(execFileSync('npm', ['root', '-g'], {encoding: 'utf8'}).trim(), 'typescript')); }
})();
const setup = fs.readFileSync(path.join(root, 'apps/server/src/app/server-routes-setup.ts'), 'utf8');
const layout = fs.readFileSync(path.join(root, 'apps/server/src/core/data-layout.ts'), 'utf8');
const ownerDeclaration = setup.match(/const ownerMembershipIds[^\n]*;/)?.[0];
assert.ok(ownerDeclaration, 'Owner membership list declaration must exist');
const domainDeclaration = layout.match(/const domains: ClusterStorageDomain\[\] = \[[\s\S]*?await layout\.storage\.ensure\(domains\);/)?.[0];
assert.ok(domainDeclaration, 'Storage domain construction must be passed directly to ensure()');
// Compile the exact production expressions inside a minimal typed boundary;
// the full application still requires its generated Prisma and npm packages.
const fixture = `
type ClusterStorageDomain = 'root' | 'system' | 'projects' | 'library' | 'users' | 'logs' | 'runtime' | 'exports' | 'uploads' | 'branding' | 'cache' | 'gitWorktrees' | 'thumbnails' | 'transcodes' | 'uploadStaging' | 'temp' | 'repositoryMirrors' | 'postgresData' | 'redisData' | 'backups';
declare const memberships: Array<{ userId: string; role: string }>;
declare const ownerSecurityReadiness: (ids: readonly string[]) => boolean;
declare const layout: { storage: { ensure: (domains: ClusterStorageDomain[]) => Promise<void> } };
async function check(options: { includeBackups?: boolean }) {
  ${ownerDeclaration}
  ownerSecurityReadiness(ownerMembershipIds);
  ${domainDeclaration}
}
`;
const fileName = '/cluster-batch-l-type-boundary.ts';
const compilerOptions = {strict: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, noEmit: true, skipLibCheck: true};
const host = ts.createCompilerHost(compilerOptions);
const originalGetSourceFile = host.getSourceFile.bind(host);
host.getSourceFile = (name, languageVersion, onError, shouldCreateNewSourceFile) =>
  name === fileName ? ts.createSourceFile(name, fixture, languageVersion, true) : originalGetSourceFile(name, languageVersion, onError, shouldCreateNewSourceFile);
const program = ts.createProgram([fileName], compilerOptions, host);
const diagnostics = ts.getPreEmitDiagnostics(program);
assert.deepEqual(diagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')), [], 'TypeScript boundary fixture must compile in strict mode');
console.log('PASS setup Owner IDs: readonly string[] consumer');
console.log('PASS storage domains: ClusterStorageDomain[] and backups include branch');
console.log('2/2 TypeScript build-boundary regressions passed (not full application compilation)');
