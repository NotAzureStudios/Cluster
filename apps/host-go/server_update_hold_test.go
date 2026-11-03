package main

import (
 "encoding/json"
 "net/http"
 "net/http/httptest"
 "net/url"
 "os"
 "path/filepath"
 "testing"
 "time"
)

func testHostUpdateRequest(t *testing.T,h *host,method,path string)*httptest.ResponseRecorder{
 t.Helper()
 target,_:=url.Parse("http://127.0.0.1:65001")
 request:=httptest.NewRequest(method,"http://localhost:3000"+path,nil)
 request.Host="localhost:3000"
 response:=httptest.NewRecorder()
 h.handler(target).ServeHTTP(response,request)
 return response
}

func TestManagedUpdateHoldBlocksAllGatewayRoutesExceptHealth(t *testing.T) {
 root:=t.TempDir()
 h:=&host{root:root,origin:"http://localhost:3000",apiOrigin:"http://127.0.0.1:4000",
  bindAddress:"127.0.0.1",startedAt:time.Now(),scheme:"http"}
 if hostServerUpdateHold(root){t.Fatal("nonexistent update hold shown active")}
 health:=testHostUpdateRequest(t,h,http.MethodGet,"/host/health")
 if health.Code!=http.StatusOK{t.Fatalf("health blocked: %v",health.Body.String())}
 var first map[string]any
 if err:=json.Unmarshal(health.Body.Bytes(),&first);err!=nil{t.Fatal(err)}
 if first["updateHold"]!=false{t.Fatal("health incorrectly reports update hold")}
 dir:=filepath.Join(root,"data","system","runtime")
 if err:=os.MkdirAll(dir,0700);err!=nil{t.Fatal(err)}
 if err:=os.WriteFile(filepath.Join(dir,"cluster-update-hold.json"),[]byte(`{"transaction":"test"}`),0600);err!=nil{t.Fatal(err)}
 for _,tc:=range []struct{method,path string}{
  {http.MethodPost,"/api/projects"},
  {http.MethodGet,"/api/projects"},
  {http.MethodGet,"/"},
  {http.MethodGet,"/index.html"},
 }{
  response:=testHostUpdateRequest(t,h,tc.method,tc.path)
  if response.Code!=http.StatusServiceUnavailable{t.Fatalf("%s %s bypassed maintenance hold: %d %s",tc.method,tc.path,response.Code,response.Body.String())}
  if response.Header().Get("Cache-Control")!="no-store"{t.Fatal("maintenance hold response was cacheable")}
  var body map[string]any
  if err:=json.Unmarshal(response.Body.Bytes(),&body);err!=nil{t.Fatal(err)}
  if body["code"]!="SERVER_UPDATE_HOLD"{t.Fatalf("incorrect hold error: %v",body)}
 }
 health=testHostUpdateRequest(t,h,http.MethodGet,"/host/health")
 if health.Code!=http.StatusOK{t.Fatalf("health not available for native probe: %d",health.Code)}
 var held map[string]any
 if err:=json.Unmarshal(health.Body.Bytes(),&held);err!=nil{t.Fatal(err)}
 if held["updateHold"]!=true{t.Fatal("health did not acknowledge maintenance hold")}
 if err:=os.Remove(filepath.Join(dir,"cluster-update-hold.json"));err!=nil{t.Fatal(err)}
 if hostServerUpdateHold(root){t.Fatal("hold did not clear")}
}
