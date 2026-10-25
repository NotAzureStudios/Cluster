// Optional media-tool smoke test: actual FFmpeg process and GPU-failure -> CPU retry.
// Does not require a GPU, database, or Cluster server.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { renderVideoThumbnail } from '../../apps/server/src/core/media-gpu-thumbnail.ts';
const exec = promisify(execFile);
try { await exec('ffmpeg',['-version'],{timeout:5000}); }
catch { console.log('GPU thumbnail FFmpeg smoke: SKIP (ffmpeg missing)'); process.exit(0); }
const directory = await mkdtemp(path.join(tmpdir(),'cluster-gpu-smoke-'));
try {
  const input = path.join(directory,'input.mp4');
  const output = path.join(directory,'poster.jpg');
  await exec('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','lavfi','-i','testsrc=size=1920x1080:rate=1','-t','2','-c:v','mpeg4',input],{timeout:25000});
  let attempts=0; let failures=0;
  const result = await renderVideoThumbnail({
    sourcePath:input,outputPath:output,seekSeconds:0.5,mode:'cuda',
    cancelled:async()=>false,removePartial:()=>rm(output,{force:true}),
    onFallback:()=>{failures++;},
    run:async(args)=>{attempts++;await exec('ffmpeg',['-hide_banner','-loglevel','error',...args],{timeout:25000});}
  });
  assert.equal(result.acceleration,'software');
  assert.equal(result.fellBack,true);
  assert.equal(attempts,2);
  assert.equal(failures,1);
  assert.ok((await stat(output)).size>1000);
  const probe=await exec('ffprobe',['-v','error','-select_streams','v:0','-show_entries','stream=width,height','-of','csv=p=0',output],{timeout:5000});
  const [width,height]=probe.stdout.trim().split(',').map(Number);
  assert.ok(width<=1280 && width>0 && height>0,`poster dimensions: ${width}x${height}`);
  console.log(`GPU thumbnail FFmpeg smoke: PASS (CUDA attempted, CPU fallback created ${width}x${height} JPEG)`);
} finally { await rm(directory,{force:true,recursive:true}); }
