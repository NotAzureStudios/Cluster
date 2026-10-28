import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const ts=(()=>{try{return require('typescript');}catch{return require(path.join(require('node:child_process').execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim(),'typescript/lib/typescript.js'));}})();
const root=path.resolve(new URL('../..',import.meta.url).pathname);
const appFolders=['apps','packages','integrations','tools'];
const all=[];
function walk(dir){for(const dirent of fs.readdirSync(dir,{withFileTypes:true})){
  if(['node_modules','dist','build','generated','.git'].includes(dirent.name))continue;
  const name=path.join(dir,dirent.name);
  if(dirent.isDirectory())walk(name); else if(/\.(tsx?|css)$/.test(name))all.push(name);
}}
for(const folder of appFolders)walk(path.join(root,folder));
const diagnostics=[], missing=[];
let typescriptCount=0,stylesheets=0,checkedImports=0;
for(const name of all){
  const content=fs.readFileSync(name,'utf8');
  if(name.endsWith('.css')) { stylesheets++; continue; }
  typescriptCount++;
  const source=ts.createSourceFile(name,content,ts.ScriptTarget.Latest,true,name.endsWith('tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
  for(const error of source.parseDiagnostics)diagnostics.push(`${path.relative(root,name)}:${source.getLineAndCharacterOfPosition(error.start||0).line+1} ${ts.flattenDiagnosticMessageText(error.messageText,' ')}`);
  function check(spec){
    if(!spec.startsWith('.'))return;
    checkedImports++;
    const bare=spec.replace(/[?#].*$/,'');
    const abs=path.resolve(path.dirname(name),bare);
    const ext=path.extname(abs);
    const stem=ext?abs.slice(0,-ext.length):abs;
    const candidates=[abs,abs+'.ts',abs+'.tsx',abs+'.js',abs+'.mjs',abs+'.json',abs+'/index.ts',abs+'/index.tsx',abs+'/index.js',stem+'.ts',stem+'.tsx',stem+'.d.ts',stem+'.js',stem+'.mjs'];
    if(!candidates.some(fs.existsSync))missing.push(`${path.relative(root,name)} -> ${spec}`);
  }
  function visit(node){
    if((ts.isImportDeclaration(node)||ts.isExportDeclaration(node))&&node.moduleSpecifier&&ts.isStringLiteral(node.moduleSpecifier))check(node.moduleSpecifier.text);
    if(ts.isCallExpression(node)&&node.expression.kind===ts.SyntaxKind.ImportKeyword&&node.arguments.length&&ts.isStringLiteral(node.arguments[0]))check(node.arguments[0].text);
    ts.forEachChild(node,visit);
  }
  visit(source);
}
const allowedGenerated=missing.filter(s=>/generated\/prisma/.test(s));
const realMissing=missing.filter(s=>!/generated\/prisma/.test(s));
const result={tsTsxFiles:typescriptCount,cssFiles:stylesheets,relativeImports:checkedImports,syntaxErrors:diagnostics.length,missingAuthoredImports:realMissing.length,knownGeneratedReferences:allowedGenerated.length};
console.log(JSON.stringify(result,null,2));
for(const diagnostic of [...diagnostics,...realMissing].slice(0,30))console.error(diagnostic);
if(diagnostics.length||realMissing.length)process.exitCode=1;
