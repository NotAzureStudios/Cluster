package main

import (
 "archive/zip"
 "bytes"
 "encoding/json"
 "strings"
 "testing"
)

func prebuiltFixture(t *testing.T, kind string, sequence int) []byte {
 t.Helper()
 var b bytes.Buffer
 z := zip.NewWriter(&b)
 f, err := z.Create("source/config/prebuilt-runtime.json")
 if err != nil { t.Fatal(err) }
 metadata := map[string]any{
  "schema": 1, "product": "cluster-server", "kind": kind,
  "release": "1.0.0-rc.50", "sequence": sequence, "sourceVersion": "0.546.0",
  "commit": strings.Repeat("a",40), "requiredArtifacts": map[string]string{},
 }
 digests := metadata["requiredArtifacts"].(map[string]string)
 for i:=0;i<13;i++ { digests[string(rune('a'+i))]=strings.Repeat("b",64) }
 if err := json.NewEncoder(f).Encode(metadata);err!=nil { t.Fatal(err) }
 if err := z.Close();err!=nil { t.Fatal(err) }
 return b.Bytes()
}

func TestPrebuiltIdentityAdmission(t *testing.T) {
 release := releaseIdentity{Schema:1,Release:"1.0.0-rc.50",Sequence:50,SourceVersion:"0.546.0",Channel:"rc"}
 if err:=embeddedPrebuiltInfo(prebuiltFixture(t,"prebuilt-windows-x64",50),release);err!=nil {
  t.Fatalf("matching precompiled runtime rejected: %v",err)
 }
 if err:=embeddedPrebuiltInfo(prebuiltFixture(t,"source-only",50),release);err==nil {
  t.Fatal("source archive must not impersonate a prebuilt Windows runtime")
 }
 if err:=embeddedPrebuiltInfo(prebuiltFixture(t,"prebuilt-windows-x64",49),release);err==nil {
  t.Fatal("wrong release sequence must be rejected")
 }
 var empty bytes.Buffer
 z:=zip.NewWriter(&empty)
 if err:=z.Close();err!=nil {t.Fatal(err)}
 if err:=embeddedPrebuiltInfo(empty.Bytes(),release);err==nil {
  t.Fatal("missing prebuilt metadata must be rejected")
 }
}
