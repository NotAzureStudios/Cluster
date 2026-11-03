package main

// A staged installer is untrusted until verified again immediately before any
// native process is stopped. A receipt is NOT a substitute for the publisher's
// Ed25519 signature and the exact installer bytes it authenticates.
import (
 "crypto/ed25519"
 "crypto/sha256"
 "crypto/x509"
 "encoding/hex"
 "encoding/json"
 "encoding/pem"
 "errors"
 "fmt"
 "io"
 "net/url"
 "os"
 "path/filepath"
 "strings"
)

var errNoStagedServerUpdate = errors.New("no signed Cluster Server update has been staged for this channel")

type stagedServerUpdateReceipt struct {
 Product string `json:"product"`
 Channel string `json:"channel"`
 Release string `json:"release"`
 Sequence int `json:"sequence"`
 SHA256 string `json:"sha256"`
 Size int64 `json:"size"`
 ManifestSHA256 string `json:"manifestSha256"`
 FeedURL string `json:"feedUrl"`
 StagedAt string `json:"stagedAt"`
 Executed bool `json:"executed"`
}
type inspectedStagedServerUpdate struct {
 InstallerPath string
 ManifestPath string
 ReceiptPath string
 Release string
 Sequence int
 SHA256 string
 Size int64
 Channel string
}

func stagedServerUpdateDirectory(root,channel string) (string,error) {
 if channel!="main" && channel!="development" {return "",errors.New("invalid Server update channel")}
 if err:=validateManagedRepairRoot(root);err!=nil{return "",fmt.Errorf("managed update refused: %w",err)}
 data:=filepath.Join(root,"data")
 parts:=[]string{data,filepath.Join(data,"system"),filepath.Join(data,"system","updates"),filepath.Join(data,"system","updates",channel)}
 for _,part:=range parts {
  info,err:=os.Lstat(part)
  if err!=nil{return "",err}
  if !info.IsDir() || info.Mode()&os.ModeSymlink!=0 {return "",fmt.Errorf("staged update directory is linked or not a real folder: %s",part)}
 }
 return parts[len(parts)-1],nil
}

func inspectStagedServerUpdate(root,channel string) (inspectedStagedServerUpdate,error) {
 block,rest:=pem.Decode([]byte(serverUpdatePublicKeyPEM))
 if block==nil || len(strings.TrimSpace(string(rest)))!=0 {return inspectedStagedServerUpdate{},errors.New("invalid pinned Server update public key")}
 pub,err:=x509.ParsePKIXPublicKey(block.Bytes)
 if err!=nil{return inspectedStagedServerUpdate{},err}
 key,ok:=pub.(ed25519.PublicKey)
 if !ok{return inspectedStagedServerUpdate{},errors.New("Server update key is not Ed25519")}
 return inspectStagedServerUpdateWithKey(root,channel,key)
}

func inspectStagedServerUpdateWithKey(root,channel string,key ed25519.PublicKey) (inspectedStagedServerUpdate,error) {
 var result inspectedStagedServerUpdate
 dir,err:=stagedServerUpdateDirectory(root,channel)
 if errors.Is(err,os.ErrNotExist){return result,errNoStagedServerUpdate}
 if err!=nil{return result,err}
 entries,err:=os.ReadDir(dir)
 if err!=nil{return result,err}
 var receiptPath string
 for _,entry:=range entries {
  if !strings.HasSuffix(strings.ToLower(entry.Name()),".exe.receipt.json"){continue}
  if receiptPath!="" {return result,errors.New("multiple staged Server updates found; select a single release before installing")}
  receiptPath=filepath.Join(dir,entry.Name())
 }
 if receiptPath=="" {return result,errNoStagedServerUpdate}
 artifactPath:=strings.TrimSuffix(receiptPath,".receipt.json")
 manifestPath:=artifactPath+".manifest.json"
 readBounded:=func(path string,limit int64)([]byte,error){
  info,err:=os.Lstat(path)
  if err!=nil{return nil,err}
  if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink!=0 || info.Size()<1 || info.Size()>limit {
   return nil,fmt.Errorf("staged update evidence is not a bounded regular file: %s",filepath.Base(path))
  }
  return os.ReadFile(path)
 }
 receiptBytes,err:=readBounded(receiptPath,4096)
 if err!=nil{return result,err}
 var receipt stagedServerUpdateReceipt
 if err=json.Unmarshal(receiptBytes,&receipt);err!=nil{return result,fmt.Errorf("invalid staged update receipt: %w",err)}
 if receipt.Product!="cluster-server" || receipt.Channel!=channel || receipt.Executed || receipt.Size<=0 ||
  len(receipt.SHA256)!=64 || len(receipt.ManifestSHA256)!=64 || strings.TrimSpace(receipt.FeedURL)==""{
  return result,errors.New("staged update receipt has an invalid identity or is already consumed")
 }
 feed,err:=url.Parse(receipt.FeedURL)
 if err!=nil || !allowedServerUpdateURL(feed){return result,errors.New("staged update feed origin is not permitted")}
 manifestBytes,err:=readBounded(manifestPath,maxServerManifestBytes)
 if err!=nil{return result,err}
 manifestDigest:=sha256.Sum256(manifestBytes)
 if !strings.EqualFold(hex.EncodeToString(manifestDigest[:]),receipt.ManifestSHA256){
  return result,errors.New("saved signed manifest differs from staged receipt")
 }
 manifest,err:=verifyServerUpdateManifestWithKey(manifestBytes,feed,channel,key)
 if err!=nil{return result,fmt.Errorf("staged update signature rejected: %w",err)}
 if receipt.Release!=manifest.Release || receipt.Sequence!=manifest.Sequence || receipt.Size!=manifest.Artifact.Size ||
  !strings.EqualFold(receipt.SHA256,manifest.Artifact.SHA256) ||
  filepath.Base(artifactPath)!=manifest.Artifact.Filename {
  return result,errors.New("staged update receipt does not match publisher-signed manifest")
 }
 installed:=installedServerReleaseSequence(root)
 if installed==0 || manifest.Sequence<=installed {
  return result,fmt.Errorf("refusing unverified installed release or non-advancing update (%d to %d)",installed,manifest.Sequence)
 }
 info,err:=os.Lstat(artifactPath)
 if err!=nil{return result,err}
 if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink!=0 || info.Size()!=manifest.Artifact.Size{
  return result,errors.New("staged Server installer is not a regular file matching the signed size")
 }
 file,err:=os.Open(artifactPath)
 if err!=nil{return result,err}
 defer file.Close()
 digest:=sha256.New()
 n,err:=io.Copy(digest,io.LimitReader(file,manifest.Artifact.Size+1))
 if err!=nil{return result,err}
 if n!=manifest.Artifact.Size || !strings.EqualFold(hex.EncodeToString(digest.Sum(nil)),manifest.Artifact.SHA256){
  return result,errors.New("staged Server installer SHA-256 or size mismatch")
 }
 if _,err=file.Seek(0,io.SeekStart);err!=nil{return result,err}
 magic:=make([]byte,2)
 if _,err=io.ReadFull(file,magic);err!=nil || string(magic)!="MZ"{
  return result,errors.New("staged signed Server installer has no Windows PE header")
 }
 result=inspectedStagedServerUpdate{InstallerPath:artifactPath,ManifestPath:manifestPath,
  ReceiptPath:receiptPath,Release:manifest.Release,Sequence:manifest.Sequence,
  SHA256:manifest.Artifact.SHA256,Size:manifest.Artifact.Size,Channel:channel}
 return result,nil
}
