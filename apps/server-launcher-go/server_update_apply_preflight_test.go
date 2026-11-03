package main

import (
 "crypto/ed25519"
 "crypto/rand"
 "crypto/sha256"
 "encoding/hex"
 "encoding/json"
 "strconv"
 "os"
 "path/filepath"
 "strings"
 "testing"
)

type stagedFixture struct {
 root string
 installer string
 manifest string
 receipt string
 publisher ed25519.PublicKey
 publisherPrivate ed25519.PrivateKey
}

func makeStagedFixture(t *testing.T) stagedFixture {
 t.Helper()
 root:=filepath.Join(t.TempDir(),"Cluster","Server")
 if err:=os.MkdirAll(filepath.Join(root,"data","system","updates","main"),0700);err!=nil{t.Fatal(err)}
 owner:=map[string]any{"managedBy":"cluster-installer","installRoot":filepath.Dir(root)}
 o,_:=json.Marshal(owner)
 if err:=os.WriteFile(filepath.Join(root,".cluster-installer-managed.json"),o,0600);err!=nil{t.Fatal(err)}
 installed:=[]byte(`{"schema":1,"managedInstaller":true,"releaseChannel":"stable","releaseCandidate":"1.0.2","releaseSequence":52}`)
 if err:=os.WriteFile(filepath.Join(root,"CLUSTER_RELEASE.json"),installed,0600);err!=nil{t.Fatal(err)}
 installer:=filepath.Join(root,"data","system","updates","main","Cluster-Installer.exe")
 binary:=[]byte("MZ"+strings.Repeat("signed test server update binary",128))
 if err:=os.WriteFile(installer,binary,0600);err!=nil{t.Fatal(err)}
 sum:=sha256.Sum256(binary)
 public,private,err:=ed25519.GenerateKey(rand.Reader)
 if err!=nil{t.Fatal(err)}
 artifactHash:=hex.EncodeToString(sum[:])
 raw:=fixtureSignedServerUpdate(t,func(m map[string]any){
  m["channel"]="main";m["release"]="1.0.3";m["sequence"]=json.Number("53")
  a:=m["artifact"].(map[string]any)
  a["filename"]="Cluster-Installer.exe"
  a["url"]="https://updates.example.test/main/Cluster-Installer.exe"
  a["sha256"]=artifactHash
  a["size"]=json.Number(strconv.Itoa(len(binary)))
 },private)
 digest:=sha256.Sum256(raw)
 manifestPath:=installer+".manifest.json"
 receiptPath:=installer+".receipt.json"
 if err:=os.WriteFile(manifestPath,raw,0600);err!=nil{t.Fatal(err)}
 receipt:=stagedServerUpdateReceipt{Product:"cluster-server",Channel:"main",Release:"1.0.3",
  Sequence:53,SHA256:artifactHash,Size:int64(len(binary)),ManifestSHA256:hex.EncodeToString(digest[:]),
  FeedURL:"https://updates.example.test/main/release.json",StagedAt:"2026-11-03T08:00:00Z"}
 data,_:=json.Marshal(receipt)
 if err:=os.WriteFile(receiptPath,data,0600);err!=nil{t.Fatal(err)}
 return stagedFixture{root,installer,manifestPath,receiptPath,public,private}
}
func TestStagedServerUpdateRevalidatedBeforeApply(t *testing.T){
 t.Run("valid signed stage",func(t *testing.T){
  f:=makeStagedFixture(t)
  candidate,err:=inspectStagedServerUpdateWithKey(f.root,"main",f.publisher)
  if err!=nil{t.Fatalf("valid stage rejected: %v",err)}
  if candidate.Sequence!=53||candidate.Release!="1.0.3"||candidate.InstallerPath!=f.installer{t.Fatal("wrong apply target")}
 })
 t.Run("binary tampering",func(t *testing.T){
  f:=makeStagedFixture(t)
  handle,err:=os.OpenFile(f.installer,os.O_WRONLY,0600);if err!=nil{t.Fatal(err)}
  if _,err=handle.WriteAt([]byte("XX"),2);err!=nil{t.Fatal(err)};handle.Close()
  if _,err=inspectStagedServerUpdateWithKey(f.root,"main",f.publisher);err==nil{t.Fatal("tampered binary accepted")}
 })
 t.Run("signed manifest tampering",func(t *testing.T){
  f:=makeStagedFixture(t)
  raw,_:=os.ReadFile(f.manifest)
  raw=append(raw,byte(' '))
  os.WriteFile(f.manifest,raw,0600)
  if _,err:=inspectStagedServerUpdateWithKey(f.root,"main",f.publisher);err==nil{t.Fatal("tampered manifest accepted")}
 })
 t.Run("forged receipt",func(t *testing.T){
  f:=makeStagedFixture(t)
  raw,_:=os.ReadFile(f.receipt)
  os.WriteFile(f.receipt,[]byte(strings.Replace(string(raw),"\"sequence\":53","\"sequence\":54",1)),0600)
  if _,err:=inspectStagedServerUpdateWithKey(f.root,"main",f.publisher);err==nil{t.Fatal("forged receipt accepted")}
 })
 t.Run("no downgrade",func(t *testing.T){
  f:=makeStagedFixture(t)
  installed:=[]byte(`{"schema":1,"managedInstaller":true,"releaseChannel":"stable","releaseCandidate":"1.0.4","releaseSequence":54}`)
  os.WriteFile(filepath.Join(f.root,"CLUSTER_RELEASE.json"),installed,0600)
  if _,err:=inspectStagedServerUpdateWithKey(f.root,"main",f.publisher);err==nil{t.Fatal("downgrade accepted")}
 })
 t.Run("unmanaged folder",func(t *testing.T){
  f:=makeStagedFixture(t)
  os.Remove(filepath.Join(f.root,".cluster-installer-managed.json"))
  if _,err:=inspectStagedServerUpdateWithKey(f.root,"main",f.publisher);err==nil{t.Fatal("unmanaged update accepted")}
 })
 t.Run("multiple staged installers",func(t *testing.T){
  f:=makeStagedFixture(t)
  os.WriteFile(filepath.Join(filepath.Dir(f.installer),"Another-Installer.exe.receipt.json"),[]byte("{}"),0600)
  if _,err:=inspectStagedServerUpdateWithKey(f.root,"main",f.publisher);err==nil{t.Fatal("ambiguous update accepted")}
 })
}
