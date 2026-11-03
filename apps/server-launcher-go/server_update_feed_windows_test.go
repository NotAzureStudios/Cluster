//go:build windows

package main

import (
 "os"
 "path/filepath"
 "testing"
)

func TestServerMainFeedAutomaticallyConfiguredButCanBeOverridden(t *testing.T) {
 root:=t.TempDir()
 for _,name:=range []string{"CLUSTER_UPDATE_MANIFEST_URL","CLUSTER_SERVER_MAIN_MANIFEST_URL","CLUSTER_SERVER_DEVELOPMENT_MANIFEST_URL"}{
  t.Setenv(name,"")
 }
 if got:=configuredUpdateManifestURL(root);got!=defaultOfficialMainServerUpdateFeedURL{
  t.Fatalf("expected signed official main feed by default, got %q",got)
 }
 prefs:=loadNativePanelPreferences(root)
 prefs.UpdateChannel="main"
 prefs.UpdateManifestURL="https://custom.example.test/server/main.json"
 if err:=saveNativePanelPreferences(root,prefs);err!=nil{t.Fatal(err)}
 if got:=configuredUpdateManifestURL(root);got!=prefs.UpdateManifestURL{t.Fatalf("saved override ignored: %s",got)}
 t.Setenv("CLUSTER_SERVER_MAIN_MANIFEST_URL","https://env.example.test/server/main.json")
 if got:=configuredUpdateManifestURL(root);got!="https://env.example.test/server/main.json"{t.Fatalf("operator override ignored: %s",got)}
 t.Setenv("CLUSTER_SERVER_MAIN_MANIFEST_URL","")
 prefs.UpdateChannel="development"
 prefs.DevelopmentUpdateManifestURL=""
 if err:=saveNativePanelPreferences(root,prefs);err!=nil{t.Fatal(err)}
 if got:=configuredUpdateManifestURL(root);got!=""{t.Fatalf("development channel unexpectedly accessed main: %s",got)}
 t.Setenv("CLUSTER_SERVER_DEVELOPMENT_MANIFEST_URL","https://dev.example.test/channel.json")
 if got:=configuredUpdateManifestURL(root);got!="https://dev.example.test/channel.json"{t.Fatalf("development environment override ignored: %s",got)}
 // A valid source must remain inside the saved Server root, not relative to
 // the current process's working directory.
 if _,err:=os.Stat(filepath.Dir(nativePanelPreferencesPath(root)));err!=nil{t.Fatal(err)}
}
