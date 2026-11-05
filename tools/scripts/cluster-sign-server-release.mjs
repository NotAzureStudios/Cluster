// Publish only an already-built, reviewed Windows Server installer into a signed channel.
// Key material MUST be supplied by a protected release environment; never checked into Git.
import fs from "node:fs";
import path from "node:path";
import { createHash, createPrivateKey, createPublicKey, sign } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../..");
const args=process.argv.slice(2);
function option(name, fallback=""){
 const i=args.indexOf(name);
 if(i<0)return fallback;
 if(i+1>=args.length||args[i+1].startsWith("--"))throw Error("Missing "+name);
 return args[i+1];
}
function assert(condition,message){if(!condition)throw Error(message)}
function canonical(value){
 if(Array.isArray(value))return "["+value.map(canonical).join(",")+"]";
 if(value!==null&&typeof value==="object"){
  return "{"+Object.keys(value).sort().map(key=>JSON.stringify(key)+":"+canonical(value[key])).join(",")+"}";
 }
 return JSON.stringify(value);
}
const channel=option("--channel");
assert(["main","development"].includes(channel),"Server release channel must be main or development");
const artifact=path.resolve(option("--artifact"));
const feed=option("--feed-url"), download=option("--artifact-url"), output=path.resolve(option("--output"));
const privateKeyFile=process.env.CLUSTER_SERVER_SIGNING_KEY_FILE;
assert(privateKeyFile && fs.existsSync(privateKeyFile),"Set CLUSTER_SERVER_SIGNING_KEY_FILE to a protected Ed25519 private key path");
const trustedPem=fs.readFileSync(path.join(root,"apps/server-launcher-go/assets/server-update-public-key.pem"),"utf8").trim();
const key=createPrivateKey(fs.readFileSync(privateKeyFile));
assert(key.asymmetricKeyType==="ed25519","Release signing requires Ed25519");
const publicPem=createPublicKey(key).export({format:"pem",type:"spki"}).toString().trim();
assert(publicPem===trustedPem,"Signing key does not match the trusted Cluster Server update publisher key");
const feedURL=new URL(feed), artifactURL=new URL(download);
function allowed(u) {
 return !u.username&&!u.password&&!u.hash&&(u.protocol==="https:"||(u.protocol==="http:"&&["localhost","127.0.0.1","[::1]"].includes(u.hostname)));
}
assert(allowed(feedURL)&&allowed(artifactURL),"Update feed and artifact require credential-free HTTPS (localhost HTTP only)");
assert(feedURL.origin===artifactURL.origin,"Installer must be hosted at the signed manifest's origin");
assert(fs.existsSync(artifact)&&fs.statSync(artifact).isFile(),"Installer artifact is missing");
assert(artifact.toLowerCase().endsWith(".exe"),"Server installer artifact must be .exe");
const filename=path.basename(artifact);
assert(!filename.includes("/")&&!filename.includes("\\"),"Invalid artifact filename");
const file=fs.openSync(artifact,"r"),hash=createHash("sha256"),buf=Buffer.alloc(1024*1024);
try{
 const mz=Buffer.alloc(2);fs.readSync(file,mz,0,2,0);assert(mz.toString()==="MZ","Not a Windows PE installer");
 let pos=0;for(;;){const n=fs.readSync(file,buf,0,buf.length,pos);if(!n)break;hash.update(buf.subarray(0,n));pos+=n}
}finally{fs.closeSync(file)}
assert(fs.existsSync(path.join(root,"package-lock.json")),"Refusing to sign: the repository lacks a reproducible npm lockfile");
const receiptPath=path.join(root,"artifacts","release-profiles","server-windows-x64","build-receipt.json");
assert(fs.existsSync(receiptPath),"Refusing to sign: build this exact server target with cluster-platform-release.mjs --build first");
const receipt=JSON.parse(fs.readFileSync(receiptPath,"utf8"));
assert(receipt.built===true && receipt.certified===false && receipt.product==="cluster-server"
  && receipt.profile==="server-windows-x64" && receipt.channel===channel,
  "Server distribution receipt product/channel mismatch");
const release=JSON.parse(fs.readFileSync(path.join(root,"config/release-candidate.json"),"utf8"));
const stablePatch = /^1\.0\.([1-9][0-9]*)$/.exec(release.release);
const rcSequence = /^1\.0\.0-rc\.([1-9][0-9]*)$/.exec(release.release);
const validStable = channel === "main" && stablePatch && Number(stablePatch[1]) + 50 === release.sequence;
const validRC = channel === "development" && rcSequence && Number(rcSequence[1]) === release.sequence;
assert(Boolean(validStable || validRC), "Signed Server update identity must match main stable or development RC release sequence");
const branch=spawnSync("git",["branch","--show-current"],{cwd:root,encoding:"utf8"});
assert(branch.status===0&&branch.stdout.trim()===(channel==="main"?"main":"development"),"Publisher must sign from the matching reviewed main/development branch");
for(const command of [["diff","--quiet"],["diff","--cached","--quiet"]]){
 const result=spawnSync("git",command,{cwd:root,encoding:"utf8"});
 assert(result.status===0,"Tracked source is modified; refuse signing unreviewed build");
}
const commit=spawnSync("git",["rev-parse","HEAD"],{cwd:root,encoding:"utf8"});
assert(commit.status===0&&/^[a-f0-9]{40}$/.test(commit.stdout.trim()),"No traceable source commit");
const digest=hash.digest("hex");
assert(receipt.commit===commit.stdout.trim(),"Signed release source commit does not match the built server artifact");
const matchingArtifacts=(receipt.artifacts||[]).filter(a=>path.resolve(root,a.path)===artifact);
assert(matchingArtifacts.length===1 && matchingArtifacts[0].sha256===digest
 && matchingArtifacts[0].bytes===fs.statSync(artifact).size,
 "Server installer differs from verified platform build receipt");
const bytes=fs.statSync(artifact).size;
assert(bytes>0&&bytes<=2*1024*1024*1024,"Installer exceeds release limits");
const metadata={
 schemaVersion:1,product:"cluster-server",target:"server-windows-x64",channel,
 release:release.release,sequence:release.sequence,sourceVersion:release.sourceVersion,
 commit:commit.stdout.trim(),
 artifact:{kind:"installer",filename,url:artifactURL.href,sha256:digest,size:bytes}
};
const signature=sign(null,Buffer.from(canonical(metadata)),key).toString("base64");
const manifest={...metadata,signature};
assert(output.endsWith(".json"),"Signed server release output must be JSON");
fs.mkdirSync(path.dirname(output),{recursive:true});
fs.writeFileSync(output,JSON.stringify(manifest,null,2)+"\n",{mode:0o600});
console.log(JSON.stringify({output,product:metadata.product,target:metadata.target,channel,release:metadata.release,commit:metadata.commit,sha256:metadata.artifact.sha256,signed:true},null,2));
