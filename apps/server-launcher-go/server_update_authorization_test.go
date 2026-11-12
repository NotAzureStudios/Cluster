package main

import (
 "crypto/sha256"
 "encoding/hex"
 "encoding/json"
 "os"
 "path/filepath"
 "strings"
 "testing"
 "time"
)

func signedAuthorizedServerUpdateFixture(t *testing.T)(stagedFixture,authorizedServerUpdateRequest){
 t.Helper()
 fixture:=makeStagedFixture(t)
 configPath:=filepath.Join(fixture.root,"data","system","config","cluster.config.json")
 if err:=os.MkdirAll(filepath.Dir(configPath),0700);err!=nil{t.Fatal(err)}
 config:=[]byte("{\"schema\":1,\"settings\":{}}")
 if err:=os.WriteFile(configPath,config,0600);err!=nil{t.Fatal(err)}
 digest:=sha256.Sum256(config)
 candidate,err:=inspectStagedServerUpdateWithKey(fixture.root,"main",fixture.publisher)
 if err!=nil{t.Fatal(err)}
 req:=authorizedServerUpdateRequest{
  Schema:1,Action:"install-signed-server-update",
  TransactionID:"77148eb8-8092-4ee6-b9ec-5c409b5a1214",
  CreatedAt:time.Now().UTC().Format(time.RFC3339Nano),
  Channel:"main",Release:candidate.Release,Sequence:candidate.Sequence,
  InstallerSHA256:candidate.SHA256,ConfigSHA256:hex.EncodeToString(digest[:]),
 }
 return fixture,req
}
func saveAuthorizationFixture(t *testing.T,root string,req authorizedServerUpdateRequest){
 t.Helper()
 file:=nativeServerUpdateRequestPath(root)
 if err:=os.MkdirAll(filepath.Dir(file),0700);err!=nil{t.Fatal(err)}
 raw,err:=json.Marshal(req)
 if err!=nil{t.Fatal(err)}
 if err:=os.WriteFile(file,raw,0600);err!=nil{t.Fatal(err)}
}
func signerFromFixture(f stagedFixture)func(string,string)(inspectedStagedServerUpdate,error){
 return func(root,channel string)(inspectedStagedServerUpdate,error){
  return inspectStagedServerUpdateWithKey(root,channel,f.publisher)
 }
}
func TestNativeSignedUpdateAuthorizationClaimsOnce(t *testing.T){
 fixture,req:=signedAuthorizedServerUpdateFixture(t)
 saveAuthorizationFixture(t,fixture.root,req)
 got,err:=claimAuthorizedServerUpdate(fixture.root,time.Now().UTC(),signerFromFixture(fixture))
 if err!=nil{t.Fatal(err)}
 if got.Request.TransactionID!=req.TransactionID || got.Candidate.Release!="1.0.3"{
  t.Fatalf("wrong claim: %+v",got)
 }
 if _,err:=os.Stat(got.ClaimPath);err!=nil{t.Fatal(err)}
 if _,err:=claimAuthorizedServerUpdate(fixture.root,time.Now().UTC(),signerFromFixture(fixture));err==nil{
  t.Fatal("update authorization replay accepted")
 }
}
func TestNativeSignedUpdateAuthorizationFailsClosed(t *testing.T){
 cases:=[]struct{name string;modify func(*testing.T,stagedFixture,*authorizedServerUpdateRequest)}{
  {"expired",func(_ *testing.T,_ stagedFixture,r *authorizedServerUpdateRequest){r.CreatedAt=time.Now().Add(-10*time.Minute).UTC().Format(time.RFC3339Nano)}},
  {"wrong installer digest",func(_ *testing.T,_ stagedFixture,r *authorizedServerUpdateRequest){r.InstallerSHA256=strings.Repeat("f",64)}},
  {"wrong release sequence",func(_ *testing.T,_ stagedFixture,r *authorizedServerUpdateRequest){r.Sequence=54}},
  {"unrecognized action",func(_ *testing.T,_ stagedFixture,r *authorizedServerUpdateRequest){r.Action="run-shell-command"}},
  {"changed configuration",func(t *testing.T,f stagedFixture,_ *authorizedServerUpdateRequest){
   p:=filepath.Join(f.root,"data","system","config","cluster.config.json")
   if err:=os.WriteFile(p,[]byte("{}"),0600);err!=nil{t.Fatal(err)}
  }},
  {"pending restart",func(t *testing.T,f stagedFixture,_ *authorizedServerUpdateRequest){
   p:=filepath.Join(f.root,"data","system","runtime","cluster-restart-request.json")
   if err:=os.MkdirAll(filepath.Dir(p),0700);err!=nil{t.Fatal(err)}
   if err:=os.WriteFile(p,[]byte("pending"),0600);err!=nil{t.Fatal(err)}
  }},
  {"existing update hold",func(t *testing.T,f stagedFixture,_ *authorizedServerUpdateRequest){
   p:=nativeServerUpdateHoldPath(f.root)
   if err:=os.MkdirAll(filepath.Dir(p),0700);err!=nil{t.Fatal(err)}
   if err:=os.WriteFile(p,[]byte("held"),0600);err!=nil{t.Fatal(err)}
  }},
 }
 for _,test:=range cases{
  t.Run(test.name,func(t *testing.T){
   fixture,req:=signedAuthorizedServerUpdateFixture(t)
   test.modify(t,fixture,&req)
   saveAuthorizationFixture(t,fixture.root,req)
   if _,err:=claimAuthorizedServerUpdate(fixture.root,time.Now().UTC(),signerFromFixture(fixture));err==nil{
    t.Fatal("unsafe update authorization accepted")
   }
  })
 }
}

func TestBrokerAndInteractiveSignedUpdateIntentsAreDisjoint(t *testing.T){
 fixture,req:=signedAuthorizedServerUpdateFixture(t)
 broker:=nativeBrokerServerUpdateRequestPath(fixture.root)
 native:=nativeServerUpdateRequestPath(fixture.root)
 if strings.EqualFold(broker,native){t.Fatal("browser and native owners share an update request namespace")}
 content,err:=json.Marshal(req)
 if err!=nil{t.Fatal(err)}
 if err:=os.WriteFile(broker,content,0600);err!=nil{t.Fatal(err)}
 if _,err:=claimAuthorizedServerUpdate(fixture.root,time.Now().UTC(),signerFromFixture(fixture));err==nil{
  t.Fatal("native interactive worker attempted to claim a broker-only request")
 }
 claim,err:=claimAuthorizedServerUpdateAtPath(fixture.root,broker,time.Now().UTC(),signerFromFixture(fixture))
 if err!=nil{t.Fatalf("valid broker request rejected: %v",err)}
 if claim.ClaimPath!=broker+".claimed"{t.Fatalf("broker claim used unexpected path %s",claim.ClaimPath)}
 if _,err:=claimAuthorizedServerUpdateAtPath(fixture.root,broker,time.Now().UTC(),signerFromFixture(fixture));err==nil{
  t.Fatal("broker claim replay succeeded")
 }
 if err:=os.WriteFile(native,content,0600);err!=nil{t.Fatal(err)}
 if _,err:=claimAuthorizedServerUpdate(fixture.root,time.Now().UTC(),signerFromFixture(fixture));err==nil{
  t.Fatal("native interactive updater raced the broker's claimed intent")
 }
}
func TestBrokerCannotClaimNativeInteractiveRequest(t *testing.T){
 fixture,req:=signedAuthorizedServerUpdateFixture(t)
 saveAuthorizationFixture(t,fixture.root,req)
 if _,err:=claimAuthorizedServerUpdateAtPath(fixture.root,nativeBrokerServerUpdateRequestPath(fixture.root),time.Now().UTC(),signerFromFixture(fixture));err==nil{
  t.Fatal("privileged broker accepted an interactive-only update request")
 }
 if _,err:=os.Stat(nativeServerUpdateRequestPath(fixture.root));err!=nil{
  t.Fatalf("broker changed another owner's pending request: %v",err)
 }
}
