const ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript');
const postcss=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/postcss');
const fs=require('fs'),path=require('path');
const root=path.resolve(__dirname,'../..');
const read=p=>fs.readFileSync(p,'utf8');
function collect(dir,predicate){let out=[];for(const entry of fs.readdirSync(dir,{withFileTypes:true})){if(entry.name==='node_modules'||entry.name.startsWith('.'))continue;const full=path.join(dir,entry.name);if(entry.isDirectory())out.push(...collect(full,predicate));else if(entry.isFile()&&predicate(full))out.push(full);}return out;}
const tsfiles=collect(root,p=>/\.(ts|tsx)$/.test(p));
const cssfiles=collect(root,p=>p.endsWith('.css'));
let syntaxErrors=[],missingImports=[],importsChecked=0,cssErrors=[];
for(const filename of tsfiles){
 const source=ts.createSourceFile(filename,read(filename),ts.ScriptTarget.Latest,true,filename.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
 for(const diagnostic of source.parseDiagnostics){const pos=source.getLineAndCharacterOfPosition(diagnostic.start||0);syntaxErrors.push({file:path.relative(root,filename),line:pos.line+1,message:ts.flattenDiagnosticMessageText(diagnostic.messageText,' ')})}
 if(!filename.includes(path.sep+'renderer'+path.sep))continue;
 const moduleNames=[];
 function visit(n){if((ts.isImportDeclaration(n)||ts.isExportDeclaration(n))&&n.moduleSpecifier&&ts.isStringLiteral(n.moduleSpecifier))moduleNames.push(n.moduleSpecifier.text);else if(ts.isCallExpression(n)&&n.arguments.length===1&&(n.expression.kind===ts.SyntaxKind.ImportKeyword||n.expression.getText(source)==='require')&&ts.isStringLiteral(n.arguments[0]))moduleNames.push(n.arguments[0].text);ts.forEachChild(n,visit)}
 visit(source);
 for(const spec of moduleNames){if(!spec.startsWith('.'))continue;importsChecked++;const base=path.resolve(path.dirname(filename),spec.split('?')[0]);const candidates=[base,...['.ts','.tsx','.js','.mjs','.json','.css','.jsx','.d.ts'].map(e=>base+e),...['index.ts','index.tsx','index.js','index.mjs','index.css'].map(e=>path.join(base,e))];if(!candidates.some(fs.existsSync))missingImports.push({file:path.relative(root,filename),import:spec})}
}
for(const filename of cssfiles){try{postcss.parse(read(filename),{from:filename})}catch(e){cssErrors.push({file:path.relative(root,filename),error:e.message})}}
const result={typescriptFiles:tsfiles.length,syntaxErrors,rendererImports:importsChecked,missingImports,cssFiles:cssfiles.length,cssErrors};
fs.writeFileSync(path.join(root,'TD3_RETURN_SOURCE_SCAN.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({...result,syntaxErrors:syntaxErrors.slice(0,4),missingImports:missingImports.slice(0,4),cssErrors:cssErrors.slice(0,4)},null,2));
if(syntaxErrors.length||missingImports.length||cssErrors.length)process.exitCode=1;
