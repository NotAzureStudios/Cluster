import ts from 'typescript';
import fs from 'node:fs';
import path from 'node:path';

const files=[];
function walk(dir){
 for(const item of fs.readdirSync(dir,{withFileTypes:true})){
  if(['node_modules','.git','.turbo','dist','build'].includes(item.name)) continue;
  const full=path.join(dir,item.name);
  if(item.isDirectory()) walk(full);
  else if(item.isFile()) files.push(full);
 }
}
walk('.');
const source=files.filter(p=>/\.tsx?$/.test(p));
let syntaxErrors=0;
let rendererRelative=0;
let missingImports=0;
for(const file of source){
 const text=fs.readFileSync(file,'utf8');
 const sf=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,file.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
 if(sf.parseDiagnostics.length){syntaxErrors+=sf.parseDiagnostics.length;console.error('TS PARSE',file,sf.parseDiagnostics[0].messageText);}
 if(!file.includes('packages/renderer/src/'))continue;
 function checkRelative(spec){
  if(!spec.startsWith('.'))return;
  rendererRelative++;
  const p=path.resolve(path.dirname(file),spec);
  const variants=[p,p+'.ts',p+'.tsx',p+'.js',p+'.json',path.join(p,'index.ts'),path.join(p,'index.tsx')];
  if(p.endsWith('.js')) variants.push(p.slice(0,-3)+'.ts',p.slice(0,-3)+'.tsx');
  if(p.endsWith('.jsx')) variants.push(p.slice(0,-4)+'.tsx');
  if(!variants.some(fs.existsSync)){missingImports++;console.error('MISSING',file,spec);}
 }
 function visit(node){
  if((ts.isImportDeclaration(node)||ts.isExportDeclaration(node))&&node.moduleSpecifier&&ts.isStringLiteral(node.moduleSpecifier))checkRelative(node.moduleSpecifier.text);
  if(ts.isCallExpression(node)&&(node.expression.kind===ts.SyntaxKind.ImportKeyword||node.expression.getText(sf)==='require')&&node.arguments[0]&&ts.isStringLiteral(node.arguments[0]))checkRelative(node.arguments[0].text);
  ts.forEachChild(node,visit);
 }
 visit(sf);
}
function cssBalance(file){
 const text=fs.readFileSync(file,'utf8');
 const stack=[];let quote=null,comment=false;
 for(let i=0;i<text.length;i++){
  const c=text[i],n=text[i+1];
  if(comment){if(c==='*'&&n==='/'){comment=false;i++;}continue;}
  if(quote){if(c==='\\'){i++;continue;}if(c===quote)quote=null;continue;}
  if(c==='/'&&n==='*'){comment=true;i++;continue;}
  if(c==='"'||c==="'"){quote=c;continue;}
  if(c==='{'||c==='('||c==='[')stack.push(c);
  if(c==='}'||c===')'||c===']'){
   const expected={'}':'{',')':'(',']':'['}[c];if(stack.pop()!==expected)return false;
  }
 }
 return !stack.length&&!quote&&!comment;
}
const css=files.filter(f=>f.endsWith('.css'));
const badCss=css.filter(p=>!cssBalance(p));
for(const f of badCss)console.error('CSS DELIMITER',f);
console.log(`TS/TSX files: ${source.length}; syntax diagnostics: ${syntaxErrors}`);
console.log(`Renderer relative references: ${rendererRelative}; unresolved: ${missingImports}`);
console.log(`CSS files: ${css.length}; delimiter errors: ${badCss.length}`);
if(syntaxErrors||missingImports||badCss.length)process.exitCode=1;
