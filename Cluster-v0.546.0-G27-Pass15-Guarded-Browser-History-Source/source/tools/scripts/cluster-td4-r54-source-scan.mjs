/** TD4 R54 active-source development check. Not a dependency-backed compile. */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
function loadDevTool(name) {
  try { return require(name); }
  catch {
    const { execFileSync } = require('node:child_process');
    return require(path.join(execFileSync('npm', ['root','-g'], { encoding:'utf8' }).trim(), name));
  }
}
const ts = loadDevTool('typescript');
const postcss = loadDevTool('postcss');
const root = path.resolve(import.meta.dirname, '../..');
const result = { typeScriptFiles:0, cssFiles:0, relativeImports:0, syntaxAndCssErrors:[], missingImports:[], expectedGeneratedImports:[], scope:'Active apps/packages/integrations source, excludes recovered historical snapshots and build outputs' };
function walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir,{withFileTypes:true})) {
    if (entry.name.startsWith('.') || ['node_modules','dist','build','generated','coverage'].includes(entry.name)) continue;
    const file=path.join(dir,entry.name);
    if(entry.isDirectory()) {walk(file);continue;}
    if(!entry.isFile())continue;
    if (/\.tsx?$/.test(file)) {
      result.typeScriptFiles++;
      const source=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true,file.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
      for(const d of source.parseDiagnostics)result.syntaxAndCssErrors.push(`${path.relative(root,file)}: ${ts.flattenDiagnosticMessageText(d.messageText,' ')}`);
      const imports=[];
      function visit(n){if((ts.isImportDeclaration(n)||ts.isExportDeclaration(n))&&n.moduleSpecifier&&ts.isStringLiteral(n.moduleSpecifier))imports.push(n.moduleSpecifier.text);if(ts.isCallExpression(n)&&n.arguments.length===1&&(n.expression.kind===ts.SyntaxKind.ImportKeyword||n.expression.getText(source)==='require')&&ts.isStringLiteral(n.arguments[0])) imports.push(n.arguments[0].text);ts.forEachChild(n,visit);}
      visit(source);
      for(const spec of imports){if(!spec.startsWith('.'))continue;result.relativeImports++;const base=path.resolve(path.dirname(file),spec);const extensionless=base.replace(/\.(?:js|mjs|jsx)$/,'');const variants=[base,extensionless,...['.ts','.tsx','.js','.jsx','.mjs','.json','.css','.d.ts'].flatMap(ext=>[base+ext,extensionless+ext]),...['index.ts','index.tsx','index.js','index.css'].map(ext=>path.join(base,ext))];if(variants.some(fs.existsSync))continue;const label=`${path.relative(root,file)} -> ${spec}`;if(label==='apps/server/src/core/prisma-client.ts -> ../generated/prisma/client.js')result.expectedGeneratedImports.push(label);else result.missingImports.push(label);}
    } else if(file.endsWith('.css')){
      result.cssFiles++;
      try{postcss.parse(fs.readFileSync(file,'utf8'),{from:file})}catch(error){result.syntaxAndCssErrors.push(`${path.relative(root,file)}: ${error.message}`)}
    }
  }
}
for(const dir of ['apps','packages','integrations'])walk(path.join(root,dir));
fs.writeFileSync(path.join(root,'TD4_R54_SOURCE_SCAN.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({typeScriptFiles:result.typeScriptFiles,cssFiles:result.cssFiles,relativeImports:result.relativeImports,syntaxAndCssErrors:result.syntaxAndCssErrors.length,missingImports:result.missingImports,expectedGeneratedImports:result.expectedGeneratedImports}));
if(result.syntaxAndCssErrors.length||result.missingImports.length)process.exitCode=1;
