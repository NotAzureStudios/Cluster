package main

import (
 "crypto/ed25519"
 "crypto/rand"
 "crypto/sha256"
 "encoding/base64"
 "encoding/hex"
 "encoding/json"
 "net/http"
 "net/http/httptest"
 "os"
 "path/filepath"
 "strconv"
 "strings"
 "testing"
)

func TestServerUpdateStagingVerifiesBytesAndKeepsInstallerInert(t *testing.T) {
 public,private,err:=ed25519.GenerateKey(rand.Reader)
 if err!=nil {t.Fatal(err)}
 source:=[]byte("MZ" + strings.Repeat("signed-server-test",128))
 hash:=sha256.Sum256(source)
 artifact:=source
 channel:="development"
 redirect:=false
 serverURL:=""
 server:=httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter,r *http.Request){
  if r.URL.Path=="/feed" {
   manifest:=map[string]any{
    "schemaVersion":json.Number("1"),"product":"cluster-server","target":"server-windows-x64",
    "channel":channel,"release":"1.0.0-rc.99","sequence":json.Number("99"),"sourceVersion":"0.546.0",
    "artifact":map[string]any{"kind":"installer","filename":"Cluster-Installer.exe","url":serverURL+"/installer","sha256":hex.EncodeToString(hash[:]),"size":json.Number(strconv.Itoa(len(source)))},
   }
   signed,signErr:=canonicalServerJSON(manifest)
   if signErr!=nil {http.Error(w,signErr.Error(),500);return}
   manifest["signature"]=base64.StdEncoding.EncodeToString(ed25519.Sign(private,[]byte(signed)))
   w.Header().Set("Content-Type","application/json")
   _=json.NewEncoder(w).Encode(manifest)
   return
  }
  if r.URL.Path=="/installer" {
   if redirect {http.Redirect(w,r,"https://example.org/rejected.exe",302);return}
   w.Header().Set("Content-Type","application/octet-stream")
   w.WriteHeader(200);_,_=w.Write(artifact);return
  }
  http.NotFound(w,r)
 }))
 defer server.Close()
 serverURL=server.URL
 root:=t.TempDir()
 target,err:=stageServerUpdateWithKey(root,serverURL+"/feed",channel,public)
 if err!=nil {t.Fatalf("valid signed artifact rejected: %v",err)}
 if filepath.Base(target)!="Cluster-Installer.exe" {t.Fatalf("unexpected staged filename %s",target)}
 bytes,err:=os.ReadFile(target)
 if err!=nil||string(bytes)!=string(source) {t.Fatal("staging changed signed payload")}
 receipt,err:=os.ReadFile(target+".receipt.json")
 if err!=nil {t.Fatal(err)}
 var evidence struct {Product string `json:"product"`; Channel string `json:"channel"`; Executed bool `json:"executed"`}
 if err=json.Unmarshal(receipt,&evidence);err!=nil||evidence.Product!="cluster-server"||evidence.Channel!=channel||evidence.Executed {t.Fatal("incorrect staged receipt")}
 if _,err=stageServerUpdateWithKey(root,serverURL+"/feed",channel,public);err==nil {t.Fatal("staging must not overwrite an existing installer")}
 if err=os.Remove(target);err!=nil {t.Fatal(err)}
 artifact=append([]byte(nil),source...)
 artifact[len(artifact)-1]^=0xff
 if _,err=stageServerUpdateWithKey(root,serverURL+"/feed",channel,public);err==nil||!strings.Contains(err.Error(),"SHA-256") {t.Fatalf("tampered file was not rejected: %v",err)}
 if _,err=os.Stat(target);!os.IsNotExist(err){t.Fatal("tampered file was committed")}
 artifact=source
 redirect=true
 if _,err=stageServerUpdateWithKey(root,serverURL+"/feed",channel,public);err==nil {t.Fatal("cross-origin redirect must fail")}
 redirect=false
 channel="main"
 if _,err=stageServerUpdateWithKey(root,serverURL+"/feed","development",public);err==nil {t.Fatal("wrong signed channel must fail")}
}
