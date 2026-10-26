const ts=require('typescript'),fs=require('fs'),path=require('path');
const bad=[],missing=[];let n=0,css=0,imports=0;
function walk(dir){
 for(const e of fs.readdirSync(dir,{withFileTypes:true})){
  const p=path.join(dir,e.name);
  if(e.isDirectory()) { if(!['node_modules','.git','.next'].includes(e.name)) walk(p); continue; }
  if(/\.(ts|tsx)$/.test(e.name)){
   n++;const contents=fs.readFileSync(p,'utf8');
   const sf=ts.createSourceFile(p,contents,ts.ScriptTarget.Latest,true,e.name.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
   for(const diagnostic of sf.parseDiagnostics)bad.push([p,String(diagnostic.messageText)]);
   for(const st of sf.statements){
    if(ts.isImportDeclaration(st)&&ts.isStringLiteral(st.moduleSpecifier)&&st.moduleSpecifier.text.startsWith('.')){
     imports++;const base=path.resolve(path.dirname(p),st.moduleSpecifier.text.replace(/\.js$/,''));
     if(!fs.existsSync(base) && !['.ts','.tsx','.js','.mjs','.css','.json','/index.ts','/index.tsx','/index.js'].some(ext=>fs.existsSync(base+ext)) && !base.includes('/apps/server/src/generated/prisma/client'))missing.push(p+':'+st.moduleSpecifier.text);
    }
   }
  } else if(e.name.endsWith('.css'))css++;
 }
}
for(const dir of ['apps','packages','integrations'])walk(dir);
console.log(JSON.stringify({ts_files:n,css_files:css,relative_imports:imports,parse_errors:bad.slice(0,15),missing_imports:missing.slice(0,15)}));
process.exitCode=bad.length||missing.length?1:0;
