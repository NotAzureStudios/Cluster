import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require=createRequire(import.meta.url), ts=require('typescript');
const original=Buffer.from('not decoded by mock; input boundaries still checked');
const hash=x=>createHash('sha256').update(x).digest('hex');
const webp=Buffer.alloc(20);webp.write('RIFF',0,'ascii');webp.writeUInt32LE(12,4);webp.write('WEBP',8,'ascii');
let calls=0;
const fakeSharp=(bytes,opts)=>{
 assert.ok(opts.limitInputPixels<=20_000_000);
 const stub={metadata: async()=>({format:'png',width:120,height:80,pages:1}),rotate:()=>stub,resize:()=>stub,webp:()=>stub,toBuffer:async()=>{calls++;return webp;}};
 return stub;
};
function load(path, injected={}) {
 const transpiled=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true},reportDiagnostics:true});
 assert.equal(transpiled.diagnostics?.length,0);
 const module={exports:{}};
 vm.runInNewContext(transpiled.outputText,{module,exports:module.exports,require:(name)=>name==='sharp'?{default:fakeSharp,__esModule:true}:injected[name]||require(name),Buffer,Date,Set,Map,JSON,Error},{filename:path});
 return module.exports;
}
const shared=load('apps/server/src/domains/library/packet-verified-file.ts');
const {buildPacketFileImageDerivatives}=load('apps/server/src/domains/library/packet-file-image-derivative.ts',{'./packet-verified-file.js':shared});
const root=mkdtempSync(join(tmpdir(),'cluster-image-delivery-'));
const folder=join(root,'library');mkdirSync(folder);writeFileSync(join(folder,'art.png'),original);
const valid={id:'img',fileName:'art.png',type:'file',extension:'png',mimeType:'image/png',classification:'internal',sizeBytes:original.length,checksumSha256:hash(original),revision:2};
const manifest=JSON.stringify({schema:1,sourceItems:[{sourceId:'img',revision:2,checksumSha256:hash(original)}]});
try {
 const [built]=await buildPacketFileImageDerivatives(manifest,[valid],folder);
 assert.ok(built && built.format==='webp' && built.position===1 && built.sizeBytes===webp.length);
 assert.equal(built.sha256,hash(webp)); assert.equal(calls,1);
 assert.equal((await buildPacketFileImageDerivatives(manifest,[{...valid,classification:'restricted'}],folder)).length,0);
 assert.equal((await buildPacketFileImageDerivatives(manifest,[{...valid,mimeType:'image/svg+xml'}],folder)).length,0);
 assert.equal((await buildPacketFileImageDerivatives(manifest,[{...valid,extension:'svg'}],folder)).length,0);
 await assert.rejects(buildPacketFileImageDerivatives(manifest,[{...valid,checksumSha256:'0'.repeat(64)}],folder),/SOURCE_CHANGED/);
 await assert.rejects(buildPacketFileImageDerivatives(manifest,[{...valid,fileName:'../private.png'}],folder),/PATH_UNSAFE/);
 const outside=join(root,'hidden.png');writeFileSync(outside,original);symlinkSync(outside,join(folder,'link.png'));
 await assert.rejects(buildPacketFileImageDerivatives(manifest,[{...valid,fileName:'link.png'}],folder),/PATH_UNSAFE/);
 writeFileSync(join(folder,'art.png'),Buffer.from('modified'));
 await assert.rejects(buildPacketFileImageDerivatives(manifest,[valid],folder),/SOURCE_CHANGED/);
 const route=readFileSync('apps/server/src/domains/library/packet-routes.ts','utf8');
 const bundle=readFileSync('apps/server/src/domains/library/packet-bundle.ts','utf8');
 const verify=readFileSync('apps/server/src/domains/library/packet-publication.ts','utf8');
 const ui=readFileSync('packages/renderer/src/features/packets/PacketsPage.tsx','utf8');
 const deps=JSON.parse(readFileSync('apps/server/package.json','utf8')).dependencies;
 for(const word of ['imageDerivatives','buildPacketFileImageDerivatives','image/webp','eligibleImages'])assert.ok(route.includes(word),`route missing ${word}`);
 for(const word of ['webp','PACKET_DERIVATIVE_FORMAT_INVALID'])assert.ok(bundle.includes(word)&&verify.includes(word),`delivery missing ${word}`);
 assert.ok(ui.includes('Publish + text &amp; images') && ui.includes('eligibleImages') && ui.includes('entry.format === "webp"'));
 assert.ok(deps.sharp);
 console.log('PASS Packet image delivery: source classification, checksum/revision, path isolation, detached WebP, bundle/recipient metadata and explicit author opt-in; image decoder mocked');
} finally {rmSync(root,{recursive:true,force:true});}
