import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';import {execFileSync} from 'node:child_process';
const require=createRequire(import.meta.url);const ts=(()=>{try{return require('typescript')}catch{return require(path.join(execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim(),'typescript','lib','typescript.js'))}})();
const base=path.resolve(import.meta.dirname,'../../packages/renderer/src');
const walk=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(x=>x.isDirectory()?walk(path.join(d,x.name)):/\.tsx?$/.test(x.name)?[path.join(d,x.name)]:[]);
const files=walk(base);let errors=0,imports=0,missing=0;
for(const f of files){let content=fs.readFileSync(f,'utf8'),parsed=ts.createSourceFile(f,content,ts.ScriptTarget.Latest,true,f.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);if(parsed.parseDiagnostics.length){console.error(f,parsed.parseDiagnostics.map(x=>x.messageText));errors+=parsed.parseDiagnostics.length}
for(const m of content.matchAll(/\b(?:import|export)\s+(?:[^'";]*?\s+from\s+)?["'](\.[^"']+)["']/g)){
  imports++;let ref=path.resolve(path.dirname(f),m[1]);if(![ref,ref+'.ts',ref+'.tsx',ref+'.js',ref+'.jsx',ref+'.json',path.join(ref,'index.ts'),path.join(ref,'index.tsx')].some(x=>fs.existsSync(x))){missing++;console.error('Missing',f,m[1]);}
}}
console.log(JSON.stringify({rendererFiles:files.length,syntaxDiagnostics:errors,relativeImports:imports,missing},null,2));if(errors||missing)process.exit(1);
