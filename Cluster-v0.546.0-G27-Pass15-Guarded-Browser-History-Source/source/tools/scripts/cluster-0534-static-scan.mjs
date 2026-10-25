import { createRequire } from 'node:module';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname, extname, relative } from 'node:path';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const root=resolve(import.meta.dirname,'../..');
function walk(path){return readdirSync(path).flatMap(name=>{const p=resolve(path,name);return statSync(p).isDirectory()?walk(p):[p]});}
const files=walk(root).filter(p=>!p.includes('/node_modules/'));
const scripts=files.filter(p=>/\.(ts|tsx)$/.test(p));
let errors=0;
for(const file of scripts){
  const source=ts.createSourceFile(file,readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true,file.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
  for(const d of source.parseDiagnostics){errors++; console.error('Syntax:',relative(root,file),ts.flattenDiagnosticMessageText(d.messageText,' '));}
}
const styleFiles=files.filter(p=>p.endsWith('.css'));
let cssErrors=0;
for(const file of styleFiles){
  const css=readFileSync(file,'utf8').replace(/\/\*[\s\S]*?\*\//g,'').replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g,'""');
  let nesting=0;for(const c of css){if(c==='{')nesting++;if(c==='}')nesting--;if(nesting<0){cssErrors++;break;}}
  if(nesting!==0){cssErrors++;console.error('Unbalanced CSS:',relative(root,file));}
}
const renderer=resolve(root,'packages/renderer');
const candidates=['','.ts','.tsx','.mts','.cts','.js','.jsx','.json','/index.ts','/index.tsx','/index.js'];
let relImports=0, missing=0;
for(const file of scripts.filter(p=>p.startsWith(renderer))){
  const ast=ts.createSourceFile(file,readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true,file.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
  function traverse(node){if((ts.isImportDeclaration(node)||ts.isExportDeclaration(node))&&node.moduleSpecifier&&ts.isStringLiteral(node.moduleSpecifier)){
    const name=node.moduleSpecifier.text;
    if(name.startsWith('.')){relImports++;const target=resolve(dirname(file),name);if(!candidates.some(ext=>existsSync(target+ext))){missing++;console.error('Missing:',relative(root,file),name);}}
  }ts.forEachChild(node,traverse);}traverse(ast);
}
console.log(JSON.stringify({tsFiles:scripts.length,syntaxErrors:errors,cssFiles:styleFiles.length,cssErrors,rendererRelativeImports:relImports,missingRelativeImports:missing}));
if(errors||cssErrors||missing)process.exitCode=1;
