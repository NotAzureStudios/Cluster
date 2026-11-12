package main

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestBrokerRequestRejectsUnknownCommandsAndReplays(t *testing.T) {
	now := time.Date(2026,11,11,20,0,0,0,time.UTC)
	valid := authorizedServerUpdateRequest{
		Schema:1,Action:"install-signed-server-update",
		TransactionID:"8e424935-68c6-4856-ac7c-21e60ad7dc36",
		CreatedAt:now.Add(-time.Second).Format(time.RFC3339Nano),
		Channel:"main",Release:"1.2.1",Sequence:200001,
		InstallerSHA256:strings.Repeat("a",64),
		ConfigSHA256:strings.Repeat("b",64),
	}
	encode := func(v authorizedServerUpdateRequest) []byte {
		t.Helper()
		data, err := json.Marshal(v)
		if err != nil {t.Fatal(err)}
		return data
	}
	if _,err:=parseNativeBrokerRequest(encode(valid),now);err!=nil{
		t.Fatalf("valid signed request rejected: %v",err)
	}
	cases:=[]struct{name string;change func(*authorizedServerUpdateRequest)}{
		{"unsigned action",func(v *authorizedServerUpdateRequest){v.Action="run-powershell"}},
		{"development channel",func(v *authorizedServerUpdateRequest){v.Channel="development"}},
		{"negative sequence",func(v *authorizedServerUpdateRequest){v.Sequence=0}},
		{"bad uuid",func(v *authorizedServerUpdateRequest){v.TransactionID="..\\evil"}},
		{"empty release",func(v *authorizedServerUpdateRequest){v.Release=""}},
		{"future date",func(v *authorizedServerUpdateRequest){v.CreatedAt=now.Add(time.Minute).Format(time.RFC3339Nano)}},
		{"expired date",func(v *authorizedServerUpdateRequest){v.CreatedAt=now.Add(-time.Hour).Format(time.RFC3339Nano)}},
		{"invalid digest",func(v *authorizedServerUpdateRequest){v.InstallerSHA256="bad"}},
		{"wrong schema",func(v *authorizedServerUpdateRequest){v.Schema=2}},
	}
	for _,tc:=range cases {
		t.Run(tc.name,func(t *testing.T){
			value:=valid
			tc.change(&value)
			if _,err:=parseNativeBrokerRequest(encode(value),now);err==nil{
				t.Fatal("unsafe broker intent accepted")
			}
		})
	}
	original:=encode(valid)
	for name,raw:=range map[string][]byte{
		"extra executable path":append(append([]byte{},original[:len(original)-1]...),[]byte(",\"executable\":\"C:\\\\Windows\\\\System32\\\\cmd.exe\"}")...),
		"second JSON object":append(append([]byte{},original...),[]byte("{}")...),
		"too many bytes":[]byte(strings.Repeat("x",4097)),
		"missing payload":nil,
	}{
		t.Run(name,func(t *testing.T){
			if _,err:=parseNativeBrokerRequest(raw,now);err==nil{t.Fatal("untrusted broker input accepted")}
		})
	}
}
