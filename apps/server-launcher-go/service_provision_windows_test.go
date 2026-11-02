//go:build windows

package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestServiceACLPlanRestrictsWritesToDataAndEnvironment(t *testing.T) {
	root:=t.TempDir()
	if err:=os.MkdirAll(filepath.Join(root,"data"),0700);err!=nil {t.Fatal(err)}
	envDir:=filepath.Join(root,"apps","server")
	if err:=os.MkdirAll(envDir,0700);err!=nil {t.Fatal(err)}
	if err:=os.WriteFile(filepath.Join(envDir,".env"),[]byte("CLUSTER_REQUIRE_AUTH=true\n"),0600);err!=nil {t.Fatal(err)}
	plan,err:=serviceACLPlan(root)
	if err!=nil {t.Fatal(err)}
	if len(plan)!=2 {t.Fatalf("service permissions should have two exact targets: %+v",plan)}
	if plan[0].Path!=filepath.Join(root,"data")||plan[1].Path!=filepath.Join(envDir,".env") {t.Fatalf("unsafe service permission scope: %+v",plan)}
	if strings.Contains(plan[0].Grant,"F") || strings.Contains(plan[1].Grant,"F") {t.Fatal("full-control ACL requested")}
	for _,target:=range plan {
		if !strings.HasPrefix(target.Grant,clusterLocalServiceSID+":") {t.Fatalf("non-LocalService grant: %+v",target)}
	}
	if err:=os.Remove(filepath.Join(envDir,".env"));err!=nil {t.Fatal(err)}
	if _,err:=serviceACLPlan(root);err==nil || !strings.Contains(err.Error(),"interactive Cluster setup") {t.Fatalf("missing env should fail closed: %v",err)}
}

func TestServiceACLPlanRejectsJunctionTarget(t *testing.T) {
	root:=t.TempDir()
	if err:=os.MkdirAll(filepath.Join(root,"elsewhere"),0700);err!=nil {t.Fatal(err)}
	if err:=os.Symlink(filepath.Join(root,"elsewhere"),filepath.Join(root,"data"));err!=nil {
		t.Skipf("Windows runner cannot create a symlink without developer privilege: %v",err)
	}
	if _,err:=serviceACLPlan(root);err==nil {t.Fatal("symlinked data root must not be provisioned")}
}
