package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func fixtureSignedServerUpdate(t *testing.T, patch func(map[string]any), key ed25519.PrivateKey) []byte {
	t.Helper()
	manifest:=map[string]any{
		"schemaVersion":json.Number("1"),"product":"cluster-server","target":"server-windows-x64",
		"channel":"development","release":"1.0.0-rc.51","sequence":json.Number("51"),
		"artifact":map[string]any{
			"kind":"installer","filename":"Cluster-Server-Installer.exe",
			"url":"https://updates.example.test/development/Cluster-Server-Installer.exe",
			"size":json.Number("4096"),"sha256":strings.Repeat("a",64),
		},
	}
	if patch!=nil{patch(manifest)}
	canonical,err:=canonicalServerJSON(manifest)
	if err!=nil{t.Fatal(err)}
	manifest["signature"]=base64.StdEncoding.EncodeToString(ed25519.Sign(key,[]byte(canonical)))
	data,err:=json.Marshal(manifest)
	if err!=nil{t.Fatal(err)}
	return data
}

func TestServerReleaseManifestProductAndChannelIsolation(t *testing.T) {
	pub,priv,err:=ed25519.GenerateKey(rand.Reader)
	if err!=nil{t.Fatal(err)}
	feed,_:=url.Parse("https://updates.example.test/development/release.json")
	cases:=[]struct{
		name string
		mutate func(map[string]any)
		channel string
		accept bool
	}{
		{"valid development server",nil,"development",true},
		{"wrong channel",nil,"main",false},
		{"desktop product",func(m map[string]any){m["product"]="cluster-desktop"},"development",false},
		{"desktop target",func(m map[string]any){m["target"]="desktop-windows-x64"},"development",false},
		{"wrong sequence",func(m map[string]any){m["sequence"]=json.Number("52")},"development",false},
		{"cross-origin artifact",func(m map[string]any){m["artifact"].(map[string]any)["url"]="https://other.example.test/file.exe"},"development",false},
		{"missing hash",func(m map[string]any){m["artifact"].(map[string]any)["sha256"]=""},"development",false},
		{"portable zip masquerading as installer",func(m map[string]any){m["artifact"].(map[string]any)["filename"]="installer.zip"},"development",false},
	}
	for _,tc:=range cases{
		t.Run(tc.name,func(t *testing.T){
			_,err:=verifyServerUpdateManifestWithKey(fixtureSignedServerUpdate(t,tc.mutate,priv),feed,tc.channel,pub)
			if (err==nil)!=tc.accept{t.Fatalf("accepted=%t, expected=%t, error=%v",err==nil,tc.accept,err)}
		})
	}
	raw:=fixtureSignedServerUpdate(t,nil,priv)
	var tampered map[string]any
	if err:=json.Unmarshal(raw,&tampered);err!=nil{t.Fatal(err)}
	tampered["release"]="1.0.0-rc.99"
	corrupted,_:=json.Marshal(tampered)
	if _,err:=verifyServerUpdateManifestWithKey(corrupted,feed,"development",pub);err==nil{t.Fatal("tampered signed release was accepted")}
	otherPub,_,_:=ed25519.GenerateKey(rand.Reader)
	if _,err:=verifyServerUpdateManifestWithKey(raw,feed,"development",otherPub);err==nil{t.Fatal("untrusted signing key was accepted")}
}

func TestServerUpdateURLPolicy(t *testing.T) {
	for _,input:=range []string{"http://evil.test/releases","https://user:secret@example.test/releases","https://example.test/releases#x","file:///tmp/release.json"}{
		urlValue,_:=url.Parse(input)
		if allowedServerUpdateURL(urlValue){t.Fatalf("unsafe feed accepted: %s",input)}
	}
	localhost,_:=url.Parse("http://127.0.0.1:8000/releases")
	if !allowedServerUpdateURL(localhost){t.Fatal("local dev feed rejected")}
	crossOrigin,_:=url.Parse("https://example.test:8443/releases")
	normal,_:=url.Parse("https://example.test/releases")
	if sameServerUpdateOrigin(normal,crossOrigin){t.Fatal("cross-port redirect accepted")}
}

func TestInstalledServerSequenceIgnoresUntrustedMarker(t *testing.T) {
	root:=t.TempDir()
	marker:=filepath.Join(root,"CLUSTER_RELEASE.json")
	if got:=installedServerReleaseSequence(root);got!=0{t.Fatalf("missing marker sequence=%d",got)}
	valid:=`{"schema":1,"managedInstaller":true,"releaseChannel":"rc","releaseCandidate":"1.0.0-rc.75","releaseSequence":75}`
	if err:=os.WriteFile(marker,[]byte(valid),0600);err!=nil{t.Fatal(err)}
	if got:=installedServerReleaseSequence(root);got!=75{t.Fatalf("valid marker sequence=%d",got)}
	if err:=os.WriteFile(marker,[]byte(strings.Replace(valid,`"releaseSequence":75`,`"releaseSequence":76`,1)),0600);err!=nil{t.Fatal(err)}
	if got:=installedServerReleaseSequence(root);got!=0{t.Fatalf("mismatched marker accepted: %d",got)}
}

func TestServerUpdateFeedLinkHintRejectsInstallerAndReleasePage(t *testing.T) {
	tests := []struct {
		name string
		raw  string
		want bool
	}{
		{"direct exe", "https://github.com/NotAzureStudios/Cluster/releases/latest/download/Cluster-Installer.exe", true},
		{"direct zip", "https://example.com/releases/server.zip", true},
		{"release page", "https://github.com/NotAzureStudios/Cluster/releases/tag/v1.0.2", true},
		{"latest release page", "https://github.com/NotAzureStudios/Cluster/releases/latest", true},
		{"signed json", "https://updates.example.test/main/manifest.json", false},
		{"extensionless signed feed", "https://updates.example.test/main/feed", false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			uri, err := url.Parse(test.raw)
			if err != nil {
				t.Fatal(err)
			}
			got := serverUpdateFeedLinkHint(uri)
			if (got != "") != test.want {
				t.Fatalf("hint for %q = %q; want flag %v", test.raw, got, test.want)
			}
		})
	}
}
