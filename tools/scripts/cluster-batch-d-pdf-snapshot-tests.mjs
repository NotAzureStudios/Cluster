#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readLibraryPdfSnapshot } from '../../apps/server/src/core/library-pdf-snapshot.ts';

const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cluster-pdf-snapshot-'));
let count=0;
const check=async(name,fn)=>{await fn();count++;console.log(`PASS ${name}`);};
try {
  const source=path.join(dir,'source.pdf');
  await fs.writeFile(source,Buffer.from('%PDF-1.7\nsmall fixture\n'));
  await check('regular indexed PDF reads complete expected descriptor bytes',async()=>{
    assert.equal(Buffer.from(await readLibraryPdfSnapshot(source)).toString(),'%PDF-1.7\nsmall fixture\n');
  });
  await check('file greater than explicit snapshot cap cannot be indexed',async()=>{
    await assert.rejects(readLibraryPdfSnapshot(source,10),/LIBRARY_PDF_SOURCE_LIMIT/);
  });
  await check('empty file cannot be treated as extracted PDF',async()=>{
    const empty=path.join(dir,'empty.pdf');await fs.writeFile(empty,'');
    await assert.rejects(readLibraryPdfSnapshot(empty),/LIBRARY_PDF_SOURCE_LIMIT/);
  });
  await check('symlink PDF cannot redirect preview indexing',async()=>{
    const symlink=path.join(dir,'linked.pdf'); await fs.symlink(source,symlink);
    await assert.rejects(readLibraryPdfSnapshot(symlink),/LIBRARY_PDF_SOURCE_UNSAFE/);
  });
  await check('hardlinked PDF cannot share mutating source bytes',async()=>{
    const linked=path.join(dir,'alias.pdf');await fs.link(source,linked);
    await assert.rejects(readLibraryPdfSnapshot(source),/LIBRARY_PDF_SOURCE_UNSAFE/);
    await fs.unlink(linked);
  });
  await check('multi-megabyte snapshot reads in bounded chunks without source substitution',async()=>{
    const large=path.join(dir,'large.pdf'); const bytes=Buffer.alloc(5*1024*1024+39,0x41); bytes.write('%PDF-1.7\n');
    await fs.writeFile(large,bytes);
    const result=await readLibraryPdfSnapshot(large,bytes.length);
    assert.equal(result.length,bytes.length);
    assert.equal(Buffer.compare(result,bytes),0);
  });
  await check('invalid indexing limits fail closed before reading',async()=>{
    await assert.rejects(readLibraryPdfSnapshot(source,0),/LIBRARY_PDF_SOURCE_LIMIT_INVALID/);
    await assert.rejects(readLibraryPdfSnapshot(source,100*1024*1024),/LIBRARY_PDF_SOURCE_LIMIT_INVALID/);
  });
  console.log(`Batch D PDF snapshot: ${count}/${count} passed`);
}finally { await fs.rm(dir,{recursive:true,force:true}); }
