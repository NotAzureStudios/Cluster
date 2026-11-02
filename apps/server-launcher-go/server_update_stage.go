package main

// Download and verify a signed Windows Server installer into a private staging
// directory. This does NOT execute the installer or mutate the running server.
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
 "net/http"
 "net/url"
 "os"
 "path/filepath"
 "strings"
 "time"
)

const maxServerManifestBytes = 256 * 1024

func serverUpdateClient(feed *url.URL) *http.Client {
 return &http.Client{
  Timeout: 5 * time.Minute,
  CheckRedirect: func(req *http.Request, via []*http.Request) error {
   if len(via) > 4 || !sameServerUpdateOrigin(feed, req.URL) { return errors.New("server update redirected outside signed feed origin") }
   return nil
  },
 }
}

func stageServerUpdate(root, feedText, channel string) (string,error) {
 block,rest:=pem.Decode([]byte(serverUpdatePublicKeyPEM))
 if block==nil || len(strings.TrimSpace(string(rest)))>0 { return "",errors.New("invalid pinned server update trust root") }
 public,err:=x509.ParsePKIXPublicKey(block.Bytes)
 if err!=nil {return "",err}
 key,ok:=public.(ed25519.PublicKey)
 if !ok {return "",errors.New("update trust root is not Ed25519")}
 return stageServerUpdateWithKey(root,feedText,channel,key)
}

func stageServerUpdateWithKey(root,feedText,channel string,key ed25519.PublicKey) (string,error) {
 if channel!="main" && channel!="development" {return "",errors.New("invalid Windows Server update channel")}
 feed,err:=url.Parse(feedText)
 if err!=nil || !allowedServerUpdateURL(feed) {return "",errors.New("unsafe server update feed")}
 client:=serverUpdateClient(feed)
 manifestResponse,err:=client.Get(feed.String())
 if err!=nil {return "",fmt.Errorf("retrieve signed feed: %w",err)}
 defer manifestResponse.Body.Close()
 if manifestResponse.StatusCode!=http.StatusOK {return "",fmt.Errorf("server update feed returned HTTP %d",manifestResponse.StatusCode)}
 raw,err:=io.ReadAll(io.LimitReader(manifestResponse.Body,maxServerManifestBytes+1))
 if err!=nil{return "",err}
 if len(raw)>maxServerManifestBytes {return "",errors.New("server update feed too large")}
 manifest,err:=verifyServerUpdateManifestWithKey(raw,feed,channel,key)
 if err!=nil{return "",err}
 if manifest.Sequence<=installedServerReleaseSequence(root) {
  return "",errors.New("signed update does not advance the installed Server release sequence")
 }
 artifactURL,err:=url.Parse(manifest.Artifact.URL)
 if err!=nil||!sameServerUpdateOrigin(feed,artifactURL){return "",errors.New("update artifact origin is not trusted")}
 staging:=filepath.Join(root,"data","system","updates",channel)
 if err=os.MkdirAll(staging,0700);err!=nil{return "",err}
 // Fail closed on a substituted symlink/junction-like directory where it can
 // be detected by Lstat. Never accept a remote-provided directory component.
 if info,err:=os.Lstat(staging);err!=nil||!info.IsDir()||info.Mode()&os.ModeSymlink!=0 {
  return "",errors.New("unsafe server update staging directory")
 }
 target:=filepath.Join(staging,manifest.Artifact.Filename)
 partial,err:=os.CreateTemp(staging,".cluster-update-*.partial")
 if err!=nil{return "",err}
 tempName:=partial.Name()
 defer os.Remove(tempName)
 defer partial.Close()
 if err=partial.Chmod(0600);err!=nil{return "",err}

 response,err:=client.Get(artifactURL.String())
 if err!=nil{return "",fmt.Errorf("download signed Server installer: %w",err)}
 defer response.Body.Close()
 if response.StatusCode!=http.StatusOK {return "",fmt.Errorf("installer download returned HTTP %d",response.StatusCode)}
 if response.ContentLength>=0 && response.ContentLength!=manifest.Artifact.Size {return "",errors.New("installer Content-Length differs from signed size")}
 digest:=sha256.New()
 // Enforce signed exact byte limit even when the server streams indefinitely.
 written,err:=io.Copy(io.MultiWriter(partial,digest),io.LimitReader(response.Body,manifest.Artifact.Size+1))
 if err!=nil{return "",err}
 if written!=manifest.Artifact.Size {return "",fmt.Errorf("installer size mismatch: got %d, signed %d",written,manifest.Artifact.Size)}
 if !strings.EqualFold(hex.EncodeToString(digest.Sum(nil)),manifest.Artifact.SHA256) {return "",errors.New("installer SHA-256 differs from signed manifest")}
 if _,err=partial.Seek(0,io.SeekStart);err!=nil{return "",err}
 header:=make([]byte,2)
 if _,err=io.ReadFull(partial,header);err!=nil||string(header)!="MZ" {return "",errors.New("signed artifact is not a Windows PE installer")}
 if err=partial.Sync();err!=nil{return "",err}
 if err=partial.Close();err!=nil{return "",err}
 // Do not follow/overwrite an existing target. An operator can explicitly
 // remove stale files after inspection rather than replacing them silently.
 if _,err=os.Lstat(target);err==nil {return "",errors.New("Server update target already exists; refusing overwrite")}
 if !errors.Is(err,os.ErrNotExist){return "",err}
 if err=os.Rename(tempName,target);err!=nil{return "",err}
 receipt:=struct {
  Product string `json:"product"`
  Channel string `json:"channel"`
  Release string `json:"release"`
  Sequence int `json:"sequence"`
  SHA256 string `json:"sha256"`
  Size int64 `json:"size"`
  StagedAt string `json:"stagedAt"`
  Executed bool `json:"executed"`
 }{"cluster-server",channel,manifest.Release,manifest.Sequence,manifest.Artifact.SHA256,written,time.Now().UTC().Format(time.RFC3339),false}
 receiptBytes,err:=json.MarshalIndent(receipt,"","  ")
 if err!=nil{return target,err}
 receiptPath:=target+".receipt.json"
 if err=os.WriteFile(receiptPath,append(receiptBytes,'\n'),0600);err!=nil{return target,fmt.Errorf("staged installer verified but receipt failed: %w",err)}
 return target,nil
}
