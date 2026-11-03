package main

// Server update metadata is deliberately separate from Cluster Desktop's updater.
// A channel changes the eligible server installer, not the source checkout or database.
import (
	"bytes"
	"crypto/ed25519"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

const serverUpdatePublicKeyPEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA62Eyij8r2Cg/ulPG7qlQdUX2Lm+YgEnVRfcjoNjikWk=
-----END PUBLIC KEY-----`

var serverReleasePattern = regexp.MustCompile(`^1\.0\.0-rc\.([1-9][0-9]*)$`)
var serverStableReleasePattern = regexp.MustCompile(`^1\.0\.([1-9][0-9]*)$`)

 
// Server-only rolling signed release pointer. It does NOT depend on GitHub's
// product-agnostic "latest" release (which Desktop can also publish).
const defaultOfficialMainServerUpdateFeedURL = "https://github.com/NotAzureStudios/Cluster/releases/download/server-main/cluster-server-main.json"
const officialServerGitHubReleaseAssetPrefix = "/github-production-release-asset/1431753697/"

// Stable patch releases follow the sequence established for 1.0.x.
// Development RC updates remain isolated from the main channel.
func serverUpdateSequence(release, channel string) (int, bool) {
	if channel == "main" {
		match := serverStableReleasePattern.FindStringSubmatch(release)
		if match == nil { return 0, false }
		patch, err := strconv.Atoi(match[1])
		if err != nil || patch > 10000 { return 0, false }
		return 50 + patch, true
	}
	if channel == "development" {
		match := serverReleasePattern.FindStringSubmatch(release)
		if match == nil { return 0, false }
		sequence, err := strconv.Atoi(match[1])
		return sequence, err == nil
	}
	return 0, false
}
var serverArtifactHashPattern = regexp.MustCompile(`^[a-fA-F0-9]{64}$`)

type serverUpdateArtifact struct {
	Kind string `json:"kind"`
	Filename string `json:"filename"`
	URL string `json:"url"`
	SHA256 string `json:"sha256"`
	Size int64 `json:"size"`
}

type serverUpdateManifest struct {
	SchemaVersion int `json:"schemaVersion"`
	Product string `json:"product"`
	Target string `json:"target"`
	Channel string `json:"channel"`
	Release string `json:"release"`
	Sequence int `json:"sequence"`
	Artifact serverUpdateArtifact `json:"artifact"`
	Signature string `json:"signature"`
}

func canonicalServerJSON(v any) (string,error) {
	switch item := v.(type) {
	case nil:
		return "null",nil
	case bool:
		if item { return "true",nil }
		return "false",nil
	case string:
		bytes,_:=json.Marshal(item)
		return string(bytes),nil
	case json.Number:
		if _,err:=strconv.ParseFloat(string(item),64);err!=nil{return "",err}
		return string(item),nil
	case []any:
		parts:=make([]string,0,len(item))
		for _,value:=range item { encoded,err:=canonicalServerJSON(value);if err!=nil{return "",err};parts=append(parts,encoded) }
		return "["+strings.Join(parts,",")+"]",nil
	case map[string]any:
		keys:=make([]string,0,len(item))
		for key:=range item { keys=append(keys,key) }
		sort.Strings(keys)
		parts:=make([]string,0,len(keys))
		for _,key:=range keys {
			k,_:=json.Marshal(key)
			value,err:=canonicalServerJSON(item[key])
			if err!=nil{return "",err}
			parts=append(parts,string(k)+":"+value)
		}
		return "{"+strings.Join(parts,",")+"}",nil
	default:
		return "",fmt.Errorf("unsupported manifest value %T",v)
	}
}

// serverUpdateFeedLinkHint explains common operator copy/paste mistakes
// without relaxing the signed-manifest trust boundary. A valid feed may use
// any HTTPS path; this only rejects URLs that are unambiguously not a feed.
func serverUpdateFeedLinkHint(uri *url.URL) string {
	if uri == nil {
		return ""
	}
	path := strings.ToLower(uri.EscapedPath())
	for _, extension := range []string{".exe", ".msi", ".zip"} {
		if strings.HasSuffix(path, extension) {
			return "That URL downloads an installer/archive, not a signed JSON Server update manifest. Use a signed manifest feed URL here. To upgrade manually, use the official GitHub release installer after backing up and stopping Cluster."
		}
	}
	if strings.Contains(path, "/releases/tag/") || strings.HasSuffix(path, "/releases/latest") {
		return "That URL opens a GitHub release page, not a signed Server update manifest. Use a signed manifest feed URL here or upgrade manually using the official installer."
	}
	return ""
}

func allowedServerUpdateURL(uri *url.URL) bool {
	if uri==nil || uri.Hostname()=="" || uri.User!=nil || uri.Fragment!="" || uri.Opaque!="" {return false}
	if uri.Scheme=="https" {return true}
	if uri.Scheme!="http" {return false}
	switch strings.ToLower(uri.Hostname()) {
	case "localhost","127.0.0.1","::1":return true
	}
	return false
}

func sameServerUpdateOrigin(a,b *url.URL) bool {
	if !allowedServerUpdateURL(a) || !allowedServerUpdateURL(b) {return false}
	port:=func(u *url.URL)string {
		if u.Port()!="" {return u.Port()}
		if u.Scheme=="https" {return "443"}
		return "80"
	}
	return strings.EqualFold(a.Scheme,b.Scheme)&&strings.EqualFold(a.Hostname(),b.Hostname())&&port(a)==port(b)
}

// GitHub's release CDN redirects away from github.com. Only the exact
// product-specific official signed feed may use the GitHub release asset CDN;
// custom operator feeds must remain same-origin.
func serverUpdateRedirectAllowed(feed, destination *url.URL) bool {
 if sameServerUpdateOrigin(feed,destination) { return true }
 if feed==nil || feed.String()!=defaultOfficialMainServerUpdateFeedURL || destination==nil { return false }
 if destination.Scheme!="https" || destination.User!=nil || destination.Fragment!="" ||
  destination.Hostname()!="release-assets.githubusercontent.com" ||
  (destination.Port()!="" && destination.Port()!="443") { return false }
 return strings.HasPrefix(destination.EscapedPath(),officialServerGitHubReleaseAssetPrefix)
}

func verifyServerUpdateManifest(data []byte, feed *url.URL, expectedChannel string) (serverUpdateManifest,error) {
	block,rest:=pem.Decode([]byte(serverUpdatePublicKeyPEM))
	if block==nil||len(strings.TrimSpace(string(rest)))!=0{return serverUpdateManifest{},errors.New("invalid embedded trusted key")}
	rawKey,err:=x509.ParsePKIXPublicKey(block.Bytes)
	if err!=nil{return serverUpdateManifest{},err}
	key,ok:=rawKey.(ed25519.PublicKey)
	if !ok{return serverUpdateManifest{},errors.New("trusted release key is not Ed25519")}
	return verifyServerUpdateManifestWithKey(data,feed,expectedChannel,key)
}

func verifyServerUpdateManifestWithKey(data []byte, feed *url.URL, expectedChannel string, key ed25519.PublicKey) (serverUpdateManifest,error) {
	var m serverUpdateManifest
	if len(data)==0||len(data)>256*1024{return m,errors.New("release manifest exceeds safety limit")}
	if expectedChannel!="main"&&expectedChannel!="development"{return m,errors.New("invalid server update channel")}
	if !allowedServerUpdateURL(feed){return m,errors.New("unsafe update feed URL")}
	decoder:=json.NewDecoder(bytes.NewReader(data))
	decoder.UseNumber()
	var object map[string]any
	if err:=decoder.Decode(&object);err!=nil{return m,fmt.Errorf("invalid manifest JSON: %w",err)}
	var extra any
	if err:=decoder.Decode(&extra);!errors.Is(err,io.EOF){return m,errors.New("trailing update manifest content")}
	rawSignature,ok:=object["signature"].(string)
	if !ok||rawSignature==""{return m,errors.New("release manifest is not signed")}
	signature,err:=base64.StdEncoding.DecodeString(rawSignature)
	if err!=nil||len(signature)!=ed25519.SignatureSize{return m,errors.New("invalid release signature encoding")}
	delete(object,"signature")
	canonical,err:=canonicalServerJSON(object)
	if err!=nil{return m,err}
	if len(key)!=ed25519.PublicKeySize||!ed25519.Verify(key,[]byte(canonical),signature){return m,errors.New("release signature does not match the trusted publisher key")}
	clean,err:=json.Marshal(object)
	if err!=nil{return m,err}
	if err=json.Unmarshal(clean,&m);err!=nil{return m,err}
	if m.SchemaVersion!=1||m.Product!="cluster-server"||m.Target!="server-windows-x64"||m.Channel!=expectedChannel {
		return m,errors.New("release targets a different product, platform or channel")
	}
	sequence, valid := serverUpdateSequence(m.Release, expectedChannel)
	if !valid || m.Sequence != sequence { return m, errors.New("invalid release identity or release sequence mismatch") }
	art:=m.Artifact
	if art.Kind!="installer"||art.Filename==""||strings.ContainsAny(art.Filename,"/\\:")||!strings.HasSuffix(strings.ToLower(art.Filename),".exe") {
		return m,errors.New("release has no Windows Server installer")
	}
	if !serverArtifactHashPattern.MatchString(art.SHA256)||art.Size<=0||art.Size>2*1024*1024*1024{return m,errors.New("invalid release artifact integrity metadata")}
	if _,err:=hex.DecodeString(art.SHA256);err!=nil{return m,errors.New("invalid SHA-256")}
	artifactURL,err:=url.Parse(art.URL)
	if err!=nil||!sameServerUpdateOrigin(feed,artifactURL){return m,errors.New("installer URL is not on the signed feed origin")}
	return m,nil
}

func installedServerReleaseSequence(root string) int {
	raw,err:=os.ReadFile(filepath.Join(root,"CLUSTER_RELEASE.json"))
	if err!=nil{return 0}
	var marker struct{
		Schema int `json:"schema"`
		ManagedInstaller bool `json:"managedInstaller"`
		ReleaseChannel string `json:"releaseChannel"`
		ReleaseCandidate string `json:"releaseCandidate"`
		ReleaseSequence int `json:"releaseSequence"`
	}
	if json.Unmarshal(raw,&marker)!=nil||marker.Schema!=1||!marker.ManagedInstaller {return 0}
	channel := ""
	switch marker.ReleaseChannel {
	case "stable": channel = "main"
	case "rc": channel = "development"
	default: return 0
	}
	sequence, ok := serverUpdateSequence(marker.ReleaseCandidate, channel)
	if !ok || sequence != marker.ReleaseSequence { return 0 }
	return sequence
}
