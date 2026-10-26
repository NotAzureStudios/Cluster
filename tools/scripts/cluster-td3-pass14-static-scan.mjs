/** Source-only TD3 P14 checks. Does not replace a dependency-backed build. */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const ts = (()=>{try{return require('typescript')}catch{return require(path.join(execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim(),'typescript'))}})();
const root = path.resolve(import.meta.dirname, '../..');
const valid = ['.ts','.tsx','.js','.jsx','.mjs','.json'];
const candidates = ['.ts','.tsx','.js','.jsx','.mjs','.json','/index.ts','/index.tsx','/index.js','/index.mjs'];
const files=[];
function walk(dir){for(const name of fs.readdirSync(dir)){const full=path.join(dir,name);const stat=fs.statSync(full);if(stat.isDirectory()){if(!['node_modules','.git','.td3-pass14-preview-output'].includes(name))walk(full)} else files.push(full)}}
for(const d of ['packages','apps','integrations','tools'])walk(path.join(root,d));
const tsFiles=files.filter(f=>/\.(ts|tsx)$/.test(f));const cssFiles=files.filter(f=>f.endsWith('.css'));
const errors=[];let imports=0;
for(const file of tsFiles){
 const content=fs.readFileSync(file,'utf8');
 const sf=ts.createSourceFile(file,content,ts.ScriptTarget.Latest,true,file.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
 for(const diagnostic of sf.parseDiagnostics){const loc=sf.getLineAndCharacterOfPosition(diagnostic.start||0);errors.push(`${path.relative(root,file)}:${loc.line+1}:${loc.character+1} ${ts.flattenDiagnosticMessageText(diagnostic.messageText,' ')}`)}
 if(!file.includes(`${path.sep}renderer${path.sep}`))continue;
 for(const item of ts.preProcessFile(content,true,true).importedFiles){const target=item.fileName;if(!target.startsWith('.'))continue;
  imports++;
  const base=path.resolve(path.dirname(file),target);
  if(![base,...candidates.map(x=>base+x)].some(p=>fs.existsSync(p)))errors.push(`${path.relative(root,file)} unresolved import ${target}`);
 }
}
// Lexical brace balance rather than claiming full CSS compilation.
let cssUnbalanced=0;
for(const file of cssFiles){let s=fs.readFileSync(file,'utf8').replace(/\/\*[\s\S]*?\*\//g,'').replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g,'');let depth=0;
 for(const c of s){if(c==='{')depth++;if(c==='}')depth--;if(depth<0)break;}
 if(depth!==0){cssUnbalanced++;errors.push(`${path.relative(root,file)} CSS delimiter imbalance`)}
}
const report={tsTsxFiles:tsFiles.length,cssFiles:cssFiles.length,rendererRelativeImports:imports,cssUnbalanced,errors};
fs.writeFileSync(path.join(root,'TD3_PASS14_STATIC_SCAN.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({...report,errors:errors.slice(0,12)},null,2));
if(errors.length)process.exitCode=1;
