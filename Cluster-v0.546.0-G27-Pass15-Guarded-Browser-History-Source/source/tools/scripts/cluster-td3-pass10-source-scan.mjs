import ts from '/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const exts=['.ts','.tsx','.mts','.mjs','.js','.json','.css','.svg','.png','.jpeg','.jpg','.webp','.d.ts'];
function walk(dir){const out=[];for(const item of fs.readdirSync(dir,{withFileTypes:true})){if(item.name==='node_modules'||item.name==='dist'||item.name.startsWith('.td3-'))continue;const p=path.join(dir,item.name);if(item.isDirectory())out.push(...walk(p));else if(item.isFile())out.push(p)}return out}
const files=walk(root);let tsFiles=0,syntaxErrors=0,imports=0;const missing=[];
const rel=(file)=>path.relative(root,file).replaceAll('\\','/');
for(const file of files){if(!/\.(?:ts|tsx)$/.test(file))continue;tsFiles++;const src=fs.readFileSync(file,'utf8');const parsed=ts.createSourceFile(file,src,ts.ScriptTarget.Latest,true,file.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);syntaxErrors+=parsed.parseDiagnostics.length;
 if(!file.includes('/packages/renderer/src/'))continue;
 const pre=ts.preProcessFile(src,true,true);
 for(const entry of pre.importedFiles){const spec=entry.fileName;if(!spec.startsWith('.'))continue;imports++;const base=path.resolve(path.dirname(file),spec);const candidates=[base,...exts.map(x=>base+x),...exts.map(x=>path.join(base,'index'+x))];if(!candidates.some(fs.existsSync))missing.push(`${rel(file)} -> ${spec}`)}
}
const report={tsFiles,tsSyntaxErrors:syntaxErrors,rendererRelativeReferences:imports,missingRendererRelativeImports:missing};
fs.writeFileSync(path.join(root,'TD3_PASS10_TS_IMPORT_SCAN.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));if(syntaxErrors||missing.length)process.exitCode=1;
