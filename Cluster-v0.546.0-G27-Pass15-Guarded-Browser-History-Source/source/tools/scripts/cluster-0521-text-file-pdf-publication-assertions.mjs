import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import vm from 'node:vm';
const require=createRequire(import.meta.url),ts=require('typescript');
const hash=x=>createHash('sha256').update(x).digest('hex');
const strokes=[];
const fakePdfLib={StandardFonts:{Helvetica:'Helvetica'},rgb:()=>({}),PDFDocument:{create:async()=>({
 setProducer(){},setCreator(){},setTitle(){},setCreationDate(){},setModificationDate(){},
 embedFont:async()=>({widthOfTextAtSize:(str,size)=>str.length*size*0.45,encodeText:()=>{}}),
 addPage:()=>({drawText:(text)=>strokes.push(text)}),
 save:async()=>Buffer.from('%PDF-1.4\n'+strokes.join('\n')+'\n%%EOF'),
})}};
function moduleFrom(file,mocks={}) {
 const code=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;
 const module={exports:{}};vm.runInNewContext(code,{module,exports:module.exports,require:n=>mocks[n]??require(n),Buffer,Map,Set,JSON,Date,TextDecoder,Error},{filename:file});return module.exports;
}
const shared=moduleFrom('apps/server/src/domains/library/packet-verified-file.ts');
const {buildPacketFileTextDerivatives}=moduleFrom('apps/server/src/domains/library/packet-file-text-derivative.ts',{'./packet-verified-file.js':shared});
const pdf=moduleFrom('apps/server/src/domains/library/packet-pdf-derivative.ts',{'pdf-lib':fakePdfLib,'./packet-publication.js':{buildPacketTextDerivatives:()=>[]}});
const root=mkdtempSync(join(tmpdir(),'cluster-pdf-text-'));mkdirSync(join(root,'files'));
const original=Buffer.from('Checked uploaded file\r\nSecond line\n');writeFileSync(join(root,'files','approved.txt'),original);
const source={id:'file1',fileName:'approved.txt',extension:'txt',mimeType:'text/plain',type:'file',classification:'internal',sizeBytes:original.length,checksumSha256:hash(original),revision:3};
const manifest=JSON.stringify({schema:1,sourceItems:[{sourceId:'file1',checksumSha256:source.checksumSha256,revision:3}]});
try {
 const files=await buildPacketFileTextDerivatives(manifest,[source],join(root,'files'));
 assert.equal(files.length,1);
 const artifacts=await pdf.renderPacketTextPdfDerivatives(files,'APPROVED STUDIO COPY');
 assert.equal(artifacts.length,1);assert.equal(artifacts[0].position,1);assert.equal(artifacts[0].format,'pdf');
 assert.equal(artifacts[0].sha256,hash(artifacts[0].content));
 assert.ok(strokes.includes('Checked uploaded file'));
 assert.ok(strokes.includes('APPROVED STUDIO COPY'));
 assert.ok(!artifacts[0].content.includes('approved.txt'));
 const route=readFileSync('apps/server/src/domains/library/packet-routes.ts','utf8');
 assert.ok(route.includes('renderPacketTextPdfDerivatives([...notes, ...files], watermarkLabel)'));
 const outer=route.indexOf('const preparedSources = await listPacketPublicationSources(prisma');
 const transaction=route.indexOf('published = await prisma.$transaction',outer);
 const decoded=route.indexOf('const images = imageDerivatives ?',outer);
 const lastCheck=route.indexOf('if (snapshot.manifestSha256 !== preparedSnapshot.manifestSha256',transaction);
 assert.ok(outer>=0 && outer<decoded && decoded<transaction && lastCheck>transaction);
 console.log('PASS: uploaded text becomes detached PDF; watermark, source provenance, out-of-transaction decode and commit-time manifest validation (PDF engine mocked)');
} finally {rmSync(root,{recursive:true,force:true});}
