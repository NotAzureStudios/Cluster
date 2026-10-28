// Single source ZIP delivery: exactly one Windows installer at archive ROOT.
// Run after: npm run cluster:installer:build. Requires Node built-ins only.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {deflateRawSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const meta=JSON.parse(fs.readFileSync(path.join(root,'config/release-candidate.json'),'utf8'));
if(!/^1\.0\.0-rc\.[1-9][0-9]*$/.test(meta.release))throw Error('Not a release candidate');
const binary=path.join(root,'bin','Cluster-Installer.exe');
const serverEntry=path.join(root,'bin','Cluster Server.exe');
if(!fs.existsSync(binary)||fs.readFileSync(binary).subarray(0,2).toString()!=='MZ')throw Error('Build the Windows installer first.');
if(!fs.existsSync(serverEntry)||fs.readFileSync(serverEntry).subarray(0,2).toString()!=='MZ')throw Error('Build the Windows root Cluster Server launcher first.');
const output=process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(root,'..',`Cluster-${meta.release}-Complete-Source.zip`);
const excludedDirs=new Set(['node_modules','.git','.cache','dist','build','.next','coverage','__pycache__']);
const excludedFiles=new Set(['Cluster-Installer.exe','Cluster Server.exe','bin/Cluster-Installer.exe','bin/Cluster Server.exe','tools/installer/assets/bundled-source.zip','SOURCE_FILE_MANIFEST.sha256']);
const entries=[{name:'Cluster-Installer.exe',data:fs.readFileSync(binary)},{name:'Cluster Server.exe',data:fs.readFileSync(serverEntry)}];
function collect(directory){
 for(const item of fs.readdirSync(directory,{withFileTypes:true})){
  const full=path.join(directory,item.name);const rel=path.relative(root,full).split(path.sep).join('/');
  if(item.isSymbolicLink())throw Error(`Refusing symlink in release ZIP: ${rel}`);
  if(item.isDirectory()){if(!excludedDirs.has(item.name))collect(full);continue;}
  if(!item.isFile()||excludedFiles.has(rel)||rel.endsWith('.tsbuildinfo')||rel.endsWith('.pyc'))continue;
  if(rel.startsWith('tools/installer/assets/'))continue;
  if(/^RC\d+_RELEASE_NOTES\.md$/.test(rel)&&rel!==`RC${meta.sequence}_RELEASE_NOTES.md`)continue;
  entries.push({name:rel,data:fs.readFileSync(full)});
 }
}
collect(root);
entries.sort((a,b)=>a.name.localeCompare(b.name,'en'));
const filenames=new Set(entries.map(e=>e.name.toLowerCase()));
if(filenames.size!==entries.length)throw Error('Duplicate archive paths');
if(entries.filter(e=>e.name==='Cluster-Installer.exe').length!==1||entries.filter(e=>e.name==='Cluster Server.exe').length!==1)throw Error('Expected one installer and one server launcher at ZIP root');
const tab=Uint32Array.from({length:256},(_,n)=>{let c=n;for(let i=0;i<8;i++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
function crc32(buf){let c=0xffffffff;for(const b of buf)c=tab[(c^b)&255]^(c>>>8);return(c^0xffffffff)>>>0;}
function u16(v){const b=Buffer.alloc(2);b.writeUInt16LE(v);return b;}
function u32(v){const b=Buffer.alloc(4);b.writeUInt32LE(v);return b;}
const local=[],central=[];let offset=0;
for(const item of entries){
 const fname=Buffer.from(item.name,'utf8');const packed=deflateRawSync(item.data,{level:6});const crc=crc32(item.data);
 const header=Buffer.concat([u32(0x04034b50),u16(20),u16(0x800),u16(8),u16(0),u16(33),u32(crc),u32(packed.length),u32(item.data.length),u16(fname.length),u16(0),fname,packed]);
 const directory=Buffer.concat([u32(0x02014b50),u16(20),u16(20),u16(0x800),u16(8),u16(0),u16(33),u32(crc),u32(packed.length),u32(item.data.length),u16(fname.length),u16(0),u16(0),u16(0),u16(0),u32(0),u32(offset),fname]);
 offset+=header.length;local.push(header);central.push(directory);
}
if(entries.length>65535)throw Error('ZIP64 not supported');
const dir=Buffer.concat(central);
const end=Buffer.concat([u32(0x06054b50),u16(0),u16(0),u16(entries.length),u16(entries.length),u32(dir.length),u32(offset),u16(0)]);
const result=Buffer.concat([...local,dir,end]);
fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,result);
console.log(JSON.stringify({release:meta.release,output,files:entries.length,bytes:result.length,sha256:createHash('sha256').update(result).digest('hex'),installerAtRoot:true,serverEntryAtRoot:true},null,2));
