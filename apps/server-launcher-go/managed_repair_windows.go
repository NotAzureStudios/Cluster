//go:build windows

package main

import (
	"archive/zip"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"strings"
	utf16enc "unicode/utf16"
)

const trustedNodeArchiveSHA256 = "6cac9ffbca8f6a47091e4b5c772e0606049c3871cb67d900c0cedde630e545ba"

func admitManagedRepairOffline(root string) error {
	if err := validateManagedRepairRoot(root); err != nil { return err }
	service, err := queryClusterService()
	if err != nil { return fmt.Errorf("cannot establish Windows Service state: %w", err) }
	if service.Installed && service.State != serviceStopped {
		return fmt.Errorf("Windows Service must be fully stopped before self-repair")
	}
	for _, name := range []string{"windows-service.control", "windows-server.control"} {
		marker := filepath.Join(root, "data", "system", "runtime", name)
		if _, err := os.Lstat(marker); err == nil {
			return fmt.Errorf("Host control marker %s exists; verify the Host has stopped", name)
		} else if !os.IsNotExist(err) { return err }
	}
	return nil
}

type managedWorkspaceLink struct { Name, Target string }
var managedWorkspaceLinks = []managedWorkspaceLink{
	{"server", filepath.Join("apps","server")},
	{"web", filepath.Join("apps","web")},
	{"shared", filepath.Join("packages","shared")},
	{"api-client", filepath.Join("packages","api-client")},
	{"renderer", filepath.Join("packages","renderer")},
	{"discord-bot", filepath.Join("integrations","discord-bot")},
}

func ordinaryRepairDir(p string) error {
	info, err := os.Lstat(p)
	if err != nil { return err }
	if !info.IsDir() || info.Mode() & os.ModeSymlink != 0 {
		return fmt.Errorf("unsafe or linked directory %s", p)
	}
	return nil
}

func canonicalRepairLink(p string) string {
	// Windows can expose junction targets using either Win32 or NT
	// native path prefixes; normalize only those known prefixes.
	p = strings.TrimPrefix(p, string([]byte{92,92,63,92}))
	p = strings.TrimPrefix(p, string([]byte{92,63,63,92}))
	return filepath.Clean(p)
}

func repairJunctionMatches(link, expected string) bool {
	actual, err := os.Readlink(link)
	if err != nil { return false }
	a, ae := os.Stat(canonicalRepairLink(actual))
	b, be := os.Stat(expected)
	return ae == nil && be == nil && os.SameFile(a,b)
}

func prepareManagedWorkspaceLinks(root string) ([]managedWorkspaceLink, error) {
	for _, ancestor := range []string{"apps", "packages", "integrations", "node_modules"} {
		if err := ordinaryRepairDir(filepath.Join(root,ancestor)); err != nil {
			return nil,fmt.Errorf("workspace ancestor %s is missing or linked: %w",ancestor,err)
		}
	}
	scope := filepath.Join(root,"node_modules","@cluster")
	if err := os.Mkdir(scope,0755); err != nil && !os.IsExist(err) { return nil,err }
	if err := ordinaryRepairDir(scope); err != nil { return nil,err }
	missing := []managedWorkspaceLink{}
	for _, item := range managedWorkspaceLinks {
		destination := filepath.Join(root,item.Target)
		if err := ordinaryRepairDir(destination); err != nil {
			return nil, fmt.Errorf("workspace %s is unsafe: %w", item.Name,err)
		}
		contents,err := os.ReadFile(filepath.Join(destination,"package.json"))
		if err != nil { return nil,fmt.Errorf("workspace %s package manifest missing: %w",item.Name,err) }
		var identity struct { Name string `json:"name"` }
		if err := json.Unmarshal(contents,&identity); err != nil || identity.Name != "@cluster/"+item.Name {
			return nil, fmt.Errorf("workspace %s has a missing or mismatched package identity",item.Name)
		}
		link := filepath.Join(scope,item.Name)
		if _,err := os.Lstat(link); os.IsNotExist(err) {
			missing = append(missing,item)
		} else if err != nil { return nil,err
		} else {
			if !repairJunctionMatches(link,destination) {
				return nil,fmt.Errorf("workspace %s has an unexpected link; no replacement attempted",item.Name)
			}
		}
	}
	return missing,nil
}

func createManagedWorkspaceJunction(link,target string) error {
	// Paths enter PowerShell through environment variables, not a shell-built
	// string, so arbitrary installation folder names cannot inject commands.
	script := "$ErrorActionPreference='Stop'; New-Item -ItemType Junction -Path $env:CLUSTER_REPAIR_LINK -Target $env:CLUSTER_REPAIR_TARGET | Out-Null"
	units := utf16enc.Encode([]rune(script))
	encoded := make([]byte,len(units)*2)
	for i,u := range units { encoded[2*i]=byte(u); encoded[2*i+1]=byte(u>>8) }
	cmd := exec.Command("powershell.exe","-NoProfile","-NonInteractive","-EncodedCommand",base64.StdEncoding.EncodeToString(encoded))
	configureChildProcess(cmd)
	cmd.Env = append(os.Environ(),"CLUSTER_REPAIR_LINK="+link,"CLUSTER_REPAIR_TARGET="+target)
	out,err := cmd.CombinedOutput()
	if err != nil { return fmt.Errorf("junction creation failed: %w: %s",err,strings.TrimSpace(string(out))) }
	if !repairJunctionMatches(link,target) {
		return fmt.Errorf("created junction target is not the expected directory")
	}
	return nil
}

func repairManagedWorkspaceLinks(root string) (int,error) {
	missing,err := prepareManagedWorkspaceLinks(root)
	if err != nil { return 0,err }
	for i,item := range missing {
		if err := createManagedWorkspaceJunction(filepath.Join(root,"node_modules","@cluster",item.Name),filepath.Join(root,item.Target)); err != nil {
			return i,err
		}
	}
	return len(missing),nil
}

func pinnedNodeHealthy(root string) bool {
	node := filepath.Join(root,"node.exe")
	npm := filepath.Join(root,"node_modules","npm","bin","npm-cli.js")
	if !fileExists(node) || !fileExists(npm) { return false }
	cmd := exec.Command(node,"--version")
	configureChildProcess(cmd)
	out,err := cmd.Output()
	return err == nil && strings.TrimSpace(string(out)) == "v"+privateNodeVersion
}

// This extractor is independent from the developer-only ZIP helper. The
// official archive must be pinned by SHA-256 AND every destination bounded.
func extractPinnedNode(archive,destination string) error {
	zr,err := zip.OpenReader(archive)
	if err != nil { return err }
	defer zr.Close()
	const maxBytes uint64 = 512 * 1024 * 1024
	prefix := "node-v"+privateNodeVersion+"-win-x64/"
	var total uint64
	for _,f := range zr.File {
		if !strings.HasPrefix(f.Name,prefix) || strings.Contains(f.Name,"\\") || strings.Contains(f.Name,":") {
			return fmt.Errorf("unexpected path in Node archive")
		}
		relative := strings.TrimPrefix(f.Name,prefix)
		if relative == "" { continue }
		clean := path.Clean(relative)
		if clean == ".." || strings.HasPrefix(clean,"../") || strings.HasPrefix(clean,"/") || clean=="." {
			return fmt.Errorf("unsafe Node archive path")
		}
		if f.Mode()&os.ModeSymlink != 0 || f.Mode()&os.ModeType != 0 && !f.FileInfo().IsDir() {
			return fmt.Errorf("special file in private Node archive")
		}
		if f.UncompressedSize64 > maxBytes-total { return fmt.Errorf("Node extraction limit exceeded") }
		total += f.UncompressedSize64
		target := filepath.Join(destination,filepath.FromSlash(clean))
		if f.FileInfo().IsDir() {
			if err := os.MkdirAll(target,0755); err != nil { return err }
			continue
		}
		if err := os.MkdirAll(filepath.Dir(target),0755); err != nil { return err }
		in,err := f.Open(); if err != nil { return err }
		out,err := os.OpenFile(target,os.O_CREATE|os.O_EXCL|os.O_WRONLY,0600)
		if err != nil { _=in.Close(); return err }
		n,copyErr := io.CopyN(out,in,int64(f.UncompressedSize64))
		closeIn,closeOut := in.Close(),out.Close()
		if copyErr!=nil || closeIn!=nil || closeOut!=nil || uint64(n)!=f.UncompressedSize64 {
			return fmt.Errorf("private Node archive extraction incomplete")
		}
	}
	return nil
}

func ensureRepairDirectory(p string) error {
	if err := os.Mkdir(p,0755); err != nil && !os.IsExist(err) { return err }
	return ordinaryRepairDir(p)
}

func repairPinnedNode(root string) (bool,error) {
	toolRoot := filepath.Join(filepath.Dir(root),"Toolchains")
	if err := ensureRepairDirectory(toolRoot); err != nil { return false,err }
	nodeDir := filepath.Join(toolRoot,"node-v"+privateNodeVersion)
	if pinnedNodeHealthy(nodeDir) { return false,nil }
	if _,err := os.Lstat(nodeDir); err == nil {
		if err := ordinaryRepairDir(nodeDir); err != nil { return false,err }
	} else if !os.IsNotExist(err) { return false,err }
	stage := nodeDir+".repair-staging"
	backup := nodeDir+".repair-previous"
	for _,p := range []string{stage,backup} {
		if _,err := os.Lstat(p); err == nil {
			return false,fmt.Errorf("previous runtime repair evidence exists at %s; inspect before retrying",filepath.Base(p))
		} else if !os.IsNotExist(err) { return false,err }
	}
	cache := filepath.Join(toolRoot,"Downloads")
	if err := ensureRepairDirectory(cache); err != nil { return false,err }
	name := "node-v"+privateNodeVersion+"-win-x64.zip"
	archive := filepath.Join(cache,name)
	if err := verifySHA256(archive,trustedNodeArchiveSHA256); err != nil {
		if _,statErr := os.Lstat(archive); statErr == nil {
			return false,fmt.Errorf("cached Node archive is untrusted; remove the damaged cache file before retrying: %w",err)
		} else if !os.IsNotExist(statErr) { return false,statErr }
		fmt.Println("Self-repair downloading official pinned Node runtime...")
		url := "https://nodejs.org/dist/v"+privateNodeVersion+"/"+name
		if err := downloadFile(url,archive); err != nil { return false,err }
		if err := verifySHA256(archive,trustedNodeArchiveSHA256); err != nil {
			_ = os.Remove(archive)
			return false,fmt.Errorf("downloaded private Node failed pinned SHA-256: %w",err)
		}
	}
	if err := os.Mkdir(stage,0700); err != nil { return false,err }
	defer os.RemoveAll(stage)
	if err := extractPinnedNode(archive,stage); err != nil { return false,err }
	if !pinnedNodeHealthy(stage) { return false,fmt.Errorf("extracted Node failed version/npm integrity checks") }
	old := false
	if _,err := os.Lstat(nodeDir); err == nil {
		if err := os.Rename(nodeDir,backup); err != nil { return false,fmt.Errorf("could not preserve current private Node: %w",err) }
		old=true
	} else if !os.IsNotExist(err) { return false,err }
	if err := os.Rename(stage,nodeDir); err != nil {
		if old {
			if undo:=os.Rename(backup,nodeDir);undo!=nil { return false,fmt.Errorf("runtime replacement failed (%v) and rollback failed: %w",err,undo) }
		}
		return false,err
	}
	if !pinnedNodeHealthy(nodeDir) {
		_ = os.Rename(nodeDir,stage)
		if old { _ = os.Rename(backup,nodeDir) }
		return false,fmt.Errorf("Node failed post-install validation; prior runtime retained where possible")
	}
	return true,nil
}

func repairMissingPostgresBinaries(root string) (bool,error) {
	pgRoot := filepath.Join(root,"runtime","postgresql")
	if fileExists(filepath.Join(pgRoot,"bin","postgres.exe")) &&
		fileExists(filepath.Join(pgRoot,"bin","pg_ctl.exe")) { return false,nil }
	if _,err := os.Lstat(pgRoot); err == nil {
		return false,fmt.Errorf("partial PostgreSQL runtime exists; refusing destructive replacement; use verified in-place installer")
	} else if !os.IsNotExist(err) { return false,err }
	if err := installPostgresRuntime(root,pgRoot); err != nil { return false,err }
	return true,nil
}

func repairManagedInstallation(root string) (managedRepairReport,error) {
	report := managedRepairReport{Ready:true,Actions:[]managedRepairAction{}}
	if err := admitManagedRepairOffline(root); err != nil {
		report.add("admission","blocked",err.Error())
		return report,err
	}
	report.add("admission","verified","Managed ownership confirmed; Host stopped; PostgreSQL data untouched")
	if count,err := repairManagedWorkspaceLinks(root); err != nil {
		report.add("workspace links","blocked",err.Error())
	} else if count>0 {
		report.add("workspace links","repaired",fmt.Sprintf("Restored %d missing installed workspace junctions",count))
	} else { report.add("workspace links","healthy","All six installed links target the expected packages") }
	if repaired,err := repairPinnedNode(root); err != nil {
		report.add("private Node","blocked",err.Error())
	} else if repaired {
		report.add("private Node","repaired","Pinned SHA-256-verified Node restored, old runtime retained if present")
	} else { report.add("private Node","healthy","Pinned private runtime verified") }
	if repaired,err := repairMissingPostgresBinaries(root); err != nil {
		report.add("PostgreSQL binaries","blocked",err.Error())
	} else if repaired {
		report.add("PostgreSQL binaries","repaired","Verified portable PostgreSQL binaries restored; database untouched")
	} else { report.add("PostgreSQL binaries","healthy","Required portable binaries present") }
	prebuilt := releasePrebuiltReady(root) &&
		fileExists(filepath.Join(root,"apps","server","dist","index.js")) &&
		fileExists(filepath.Join(root,"apps","web","dist","index.html")) &&
		fileExists(filepath.Join(root,"packages","shared","dist","index.js"))
	if err := verifyManagedStartup(root,false,prebuilt,installedDependencyGraphHealthy(root)); err != nil {
		report.add("application payload","blocked","Missing compiled artifacts or dependencies; use verified in-place installer repair on this same data-preserving workspace")
	} else if err := checkManagedReleaseArtifactHashes(root); err != nil {
		report.add("application payload","blocked","Installed prebuilt file integrity check failed: "+err.Error()+". Reapply matching verified Cluster-Installer.exe --repair without deleting data")
	} else {
		report.add("application payload","healthy","Installed prebuilt artifacts pass SHA-256 validation and managed startup admission")
	}
	if !report.Ready { return report,fmt.Errorf("some self-repair steps remain blocked; preserve data and review report") }
	return report,nil
}
