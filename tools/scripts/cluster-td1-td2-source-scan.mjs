import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const ts = (() => { try { return require('typescript'); } catch { return require(path.join(execFileSync('npm', ['root', '-g'], {encoding:'utf8'}).trim(), 'typescript', 'lib', 'typescript.js')); } })();
const root = process.cwd();
const bases = ['apps/server/src','apps/web/src','packages/renderer/src','packages/shared/src','packages/api-client/src','integrations/discord-bot/src'];
const files=[];
for (const base of bases) {
 const dir=path.join(root,base); if (!fs.existsSync(dir)) continue;
 const walk=d=>{ for(const entry of fs.readdirSync(d,{withFileTypes:true})) {const full=path.join(d,entry.name);if(entry.isDirectory())walk(full); else if(/\.(ts|tsx)$/.test(entry.name))files.push(full); }};walk(dir);
}
let parseErrors=0, importCount=0, missing=0;
for (const file of files) {
 const data=fs.readFileSync(file,'utf8');
 const parsed=ts.createSourceFile(file,data,ts.ScriptTarget.Latest,true,file.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
 parseErrors+=parsed.parseDiagnostics.length;
 if (file.includes(`${path.sep}packages${path.sep}renderer${path.sep}`)) {
  for (const match of data.matchAll(/(?:\bfrom\s*|\bimport\s*\(|\brequire\s*\()\s*["'](\.{1,2}\/[^"']+)["']/g)) {
   const base=path.resolve(path.dirname(file),match[1]);importCount++;
   const paths=[base, ...['.ts','.tsx','.js','.jsx','.mjs','.json','.css','.svg','.png','.webp','.woff2'].map(x=>base+x),...['index.ts','index.tsx','index.js'].map(x=>path.join(base,x))];
   if(!paths.some(x=>fs.existsSync(x))) missing++;
  }
 }
}
const result={typescriptTsxFiles:files.length,syntaxDiagnostics:parseErrors,rendererRelativeImportsChecked:importCount,missingRendererRelativeImports:missing};
console.log(JSON.stringify(result,null,2));if(parseErrors||missing)process.exitCode=1;
