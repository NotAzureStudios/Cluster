import fs from 'node:fs'; import path from 'node:path';import {createRequire} from 'node:module';import {execFileSync} from 'node:child_process';
const require=createRequire(import.meta.url);const ts=(()=>{try{return require('typescript');}catch{return require(path.join(execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim(),'typescript','lib','typescript.js'));}})();
const root=process.cwd(),fsroot=['apps','packages','integrations'],files=[];
function visit(d){if(!fs.existsSync(d))return;for(const e of fs.readdirSync(d,{withFileTypes:true})){const f=path.join(d,e.name);if(e.isDirectory()){if(!['node_modules','.git','dist','build','recovered'].includes(e.name))visit(f);}else if(/\.(?:ts|tsx)$/.test(e.name)&&!e.name.endsWith('.d.ts'))files.push(f);}}
fsroot.forEach(visit);let errs=0,imports=0,missing=[];
for(const f of files){const source=fs.readFileSync(f,'utf8');const ast=ts.createSourceFile(f,source,ts.ScriptTarget.Latest,true,f.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);errs+=ast.parseDiagnostics.length;
const re=/(?:from\s*|import\s*\(|require\s*\()\s*["'](\.{1,2}\/[^"']+)["']/g;for(const m of source.matchAll(re)){imports++;const spec=m[1];const target=path.resolve(path.dirname(f),spec);const candidates=[target,target+'.ts',target+'.tsx',target.replace(/\.js$/,'.ts'),target.replace(/\.js$/,'.tsx'),target+'.js',target+'.mjs',target+'.json',path.join(target,'index.ts'),path.join(target,'index.tsx')];if(!candidates.some(fs.existsSync))missing.push(`${f} : ${spec}`);}}
console.log(JSON.stringify({activeTypeScriptFiles:files.length,syntaxDiagnostics:errs,relativeImports:imports,unresolvedRelativeImports:missing},null,2));
if(errs || missing.some(s=>!s.includes('generated/prisma')))process.exitCode=1;
