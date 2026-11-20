package main

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

// These tests run real Git (and Git LFS where available) against repositories
// shaped like Unreal projects: binary assets under LFS, names with spaces and
// non-ASCII characters, thousands of files, a bare remote.

func gitT(t *testing.T, dir string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %v failed: %v: %s", args, err, out)
	}
	return string(out)
}

func writeT(t *testing.T, root, rel, content string) {
	t.Helper()
	path := filepath.Join(root, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func newTestService() *service {
	return &service{state: persistedState{Schema: stateSchema}, startedAt: time.Now(), candidates: map[string]candidate{}, operations: map[string]*operation{}}
}

func hasLFS() bool { return exec.Command("git", "lfs", "version").Run() == nil }

// unrealRepo makes a working repository with a bare "origin", an initial
// commit pushed, and (when available) LFS tracking for Unreal packages.
func unrealRepo(t *testing.T, lfs bool) (repository, string) {
	t.Helper()
	base := t.TempDir()
	remote := filepath.Join(base, "origin.git")
	root := filepath.Join(base, "Project")
	gitT(t, base, "init", "--bare", "-b", "main", remote)
	gitT(t, base, "init", "-b", "main", root)
	gitT(t, root, "config", "user.name", "Cluster Test")
	gitT(t, root, "config", "user.email", "cluster@example.invalid")
	gitT(t, root, "remote", "add", "origin", remote)
	writeT(t, root, ".gitignore", "Binaries/\nDerivedDataCache/\nIntermediate/\nSaved/\n")
	if lfs {
		gitT(t, root, "lfs", "install", "--local")
		gitT(t, root, "lfs", "track", "*.uasset", "*.umap")
	}
	writeT(t, root, "Project.uproject", "{}\n")
	writeT(t, root, "Content/Maps/Main.umap", "map-v1")
	gitT(t, root, "add", "-A")
	gitT(t, root, "commit", "-m", "initial")
	gitT(t, root, "push", "-u", "origin", "main")
	return repository{ID: "repo", Name: "Project", RootPath: root, Trust: "trusted"}, remote
}

func TestStatusKeepsExactPathsForSpacesAndNonASCII(t *testing.T) {
	repo, _ := unrealRepo(t, false)
	svc := newTestService()
	names := []string{"Content/Characters/Hero Mesh.uasset", "Content/Props/Café Table.uasset", "Content/UI/タイトル.uasset", `Content/Quote"d.uasset`}
	for _, name := range names {
		writeT(t, repo.RootPath, name, "asset")
	}
	result, code, err := svc.sourceFileStates(repo, names)
	if err != nil {
		t.Fatalf("states failed: %s %v", code, err)
	}
	got := map[string]string{}
	for _, state := range result.([]map[string]any) {
		got[state["path"].(string)] = state["state"].(string)
	}
	for _, name := range names {
		if got[name] != "untracked" {
			t.Fatalf("path %q came back as %q; all states: %#v", name, got[name], got)
		}
	}
	if _, err := svc.gitWith(repo, gitLocalTimeout, gitOptions{write: true, stdin: pathspecInput(names)}, "add", "--pathspec-from-file=-", "--pathspec-file-nul"); err != nil {
		t.Fatalf("add by exact path failed: %v", err)
	}
}

func TestStatusFailureIsAnErrorNotClean(t *testing.T) {
	svc := newTestService()
	notARepo := repository{ID: "x", RootPath: t.TempDir(), Trust: "trusted"}
	if _, code, err := svc.nativeStatus(notARepo); err == nil {
		t.Fatal("status of a non-repository reported success; it must not read as clean")
	} else if code != "GIT_STATUS_FAILED" && code != "GIT_UNAVAILABLE" {
		t.Fatalf("unexpected code %q", code)
	}
}

func TestCheckInCommitsOnlySelectedFiles(t *testing.T) {
	repo, _ := unrealRepo(t, false)
	svc := newTestService()
	writeT(t, repo.RootPath, "Content/A.uasset", "a")
	writeT(t, repo.RootPath, "Content/B.uasset", "b")
	writeT(t, repo.RootPath, "Config/Unrelated.ini", "x")
	gitT(t, repo.RootPath, "add", "Config/Unrelated.ini") // staged by someone else
	if err := os.Remove(filepath.Join(repo.RootPath, "Content/Maps/Main.umap")); err != nil {
		t.Fatal(err)
	}
	_, code, err := svc.commitAndPush(context.Background(), repo, "Check in A and the map deletion", []string{"Content/A.uasset", "Content/Maps/Main.umap"}, false, func(string, string, int) {})
	if err != nil {
		t.Fatalf("commit failed: %s %v", code, err)
	}
	files := strings.Fields(gitT(t, repo.RootPath, "show", "--name-only", "--format=", "HEAD"))
	if strings.Join(files, ",") != "Content/A.uasset,Content/Maps/Main.umap" {
		t.Fatalf("commit contained %v", files)
	}
	status := gitT(t, repo.RootPath, "status", "--porcelain")
	if !strings.Contains(status, "A  Config/Unrelated.ini") || !strings.Contains(status, "?? Content/B.uasset") {
		t.Fatalf("unselected files were touched:\n%s", status)
	}
}

func TestCheckInThousandsOfFiles(t *testing.T) {
	repo, _ := unrealRepo(t, false)
	svc := newTestService()
	paths := make([]string, 0, 3000)
	for i := 0; i < 3000; i++ {
		rel := fmt.Sprintf("Content/Environment/Foliage/Variations/SM_Fern_Variation_With_A_Long_Name_%04d.uasset", i)
		writeT(t, repo.RootPath, rel, "fern")
		paths = append(paths, rel)
	}
	if _, code, err := svc.commitAndPush(context.Background(), repo, "Add ferns", paths, false, func(string, string, int) {}); err != nil {
		t.Fatalf("large check-in failed: %s %v", code, err)
	}
	count := strings.TrimSpace(gitT(t, repo.RootPath, "show", "--name-only", "--format=", "HEAD"))
	if n := len(strings.Split(count, "\n")); n != 3000 {
		t.Fatalf("committed %d files, want 3000", n)
	}
}

func TestCheckInPushesLFSObjectsAndSetsUpstream(t *testing.T) {
	if !hasLFS() {
		t.Skip("git-lfs not installed")
	}
	repo, remote := unrealRepo(t, true)
	svc := newTestService()
	gitT(t, repo.RootPath, "switch", "-c", "feature/hero")
	writeT(t, repo.RootPath, "Content/Hero.uasset", strings.Repeat("binary-asset-", 4096))
	if _, code, err := svc.commitAndPush(context.Background(), repo, "Hero", []string{"Content/Hero.uasset"}, true, func(string, string, int) {}); err != nil {
		t.Fatalf("check-in with push failed: %s %v", code, err)
	}
	if upstream := strings.TrimSpace(gitT(t, repo.RootPath, "rev-parse", "--abbrev-ref", "@{u}")); upstream != "origin/feature/hero" {
		t.Fatalf("upstream = %q", upstream)
	}
	// The remote must have the object, not just the pointer.
	pointer := gitT(t, repo.RootPath, "cat-file", "-p", "HEAD:Content/Hero.uasset")
	oid := ""
	for _, line := range strings.Split(pointer, "\n") {
		if strings.HasPrefix(line, "oid sha256:") {
			oid = strings.TrimPrefix(line, "oid sha256:")
		}
	}
	if len(oid) != 64 {
		t.Fatalf("asset was not stored as an LFS pointer: %.120q", pointer)
	}
	object := filepath.Join(remote, "lfs", "objects", oid[0:2], oid[2:4], oid)
	if info, err := os.Stat(object); err != nil || info.Size() != int64(len("binary-asset-")*4096) {
		t.Fatalf("remote is missing the LFS object for the pushed asset (%v)", err)
	}
}

func TestCheckInAgainRetriesAFailedPush(t *testing.T) {
	repo, remote := unrealRepo(t, false)
	svc := newTestService()
	moved := remote + ".away"
	if err := os.Rename(remote, moved); err != nil {
		t.Fatal(err)
	}
	writeT(t, repo.RootPath, "Content/A.uasset", "a")
	if _, code, err := svc.commitAndPush(context.Background(), repo, "A", []string{"Content/A.uasset"}, true, func(string, string, int) {}); err == nil || code != "GIT_PUSH_FAILED" {
		t.Fatalf("expected push failure, got %s %v", code, err)
	}
	if err := os.Rename(moved, remote); err != nil {
		t.Fatal(err)
	}
	// Nothing new to commit; checking in again must publish the earlier commit.
	if _, code, err := svc.commitAndPush(context.Background(), repo, "A", []string{"Content/A.uasset"}, true, func(string, string, int) {}); err != nil {
		t.Fatalf("retry failed: %s %v", code, err)
	}
	if ahead := strings.TrimSpace(gitT(t, repo.RootPath, "rev-list", "--count", "@{u}..HEAD")); ahead != "0" {
		t.Fatalf("still %s commits unpublished", ahead)
	}
}

func TestRebaseSyncKeepsLocalCommitsAndDirtyFiles(t *testing.T) {
	repo, remote := unrealRepo(t, false)
	svc := newTestService()
	other := filepath.Join(t.TempDir(), "other")
	gitT(t, filepath.Dir(other), "clone", remote, other)
	gitT(t, other, "config", "user.name", "Other")
	gitT(t, other, "config", "user.email", "other@example.invalid")
	writeT(t, other, "Content/Theirs.uasset", "theirs")
	gitT(t, other, "add", "-A")
	gitT(t, other, "commit", "-m", "theirs")
	gitT(t, other, "push")

	writeT(t, repo.RootPath, "Content/Mine.uasset", "mine")
	gitT(t, repo.RootPath, "add", "-A")
	gitT(t, repo.RootPath, "commit", "-m", "mine")
	writeT(t, repo.RootPath, "Project.uproject", "{\"dirty\":true}\n") // open editor

	if _, code, err := svc.runSync(context.Background(), repo, "pull"); err == nil {
		t.Fatalf("fast-forward pull should refuse diverged history (code %s)", code)
	}
	if _, code, err := svc.runSync(context.Background(), repo, "rebase"); err != nil {
		t.Fatalf("rebase sync failed: %s %v", code, err)
	}
	log := gitT(t, repo.RootPath, "log", "--format=%s", "-3")
	if !strings.HasPrefix(log, "mine\ntheirs\n") {
		t.Fatalf("history after rebase:\n%s", log)
	}
	data, _ := os.ReadFile(filepath.Join(repo.RootPath, "Project.uproject"))
	if !strings.Contains(string(data), "dirty") {
		t.Fatal("uncommitted work was lost by the sync")
	}
}

func TestConcurrentWritesDoNotCollideOnIndexLock(t *testing.T) {
	repo, _ := unrealRepo(t, false)
	svc := newTestService()
	var wg sync.WaitGroup
	errs := make(chan error, 24)
	for i := 0; i < 24; i++ {
		rel := fmt.Sprintf("Content/Concurrent/Asset_%02d.uasset", i)
		writeT(t, repo.RootPath, rel, "x")
		wg.Add(1)
		go func(rel string) {
			defer wg.Done()
			_, err := svc.gitWith(repo, gitLocalTimeout, gitOptions{write: true, stdin: pathspecInput([]string{rel})}, "add", "--pathspec-from-file=-", "--pathspec-file-nul")
			errs <- err
		}(rel)
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatalf("concurrent add failed: %v", err)
		}
	}
}

func TestOnlyOurOwnIndexLockIsRemoved(t *testing.T) {
	repo, _ := unrealRepo(t, false)
	lock := filepath.Join(repo.RootPath, ".git", "index.lock")
	if err := os.WriteFile(lock, nil, 0o644); err != nil {
		t.Fatal(err)
	}
	old := time.Now().Add(-time.Hour)
	if err := os.Chtimes(lock, old, old); err != nil {
		t.Fatal(err)
	}
	removeOwnIndexLock(repo.RootPath, time.Now())
	if _, err := os.Stat(lock); err != nil {
		t.Fatal("a lock older than our command (someone else's) was removed")
	}
	started := time.Now()
	if err := os.Chtimes(lock, started, started); err != nil {
		t.Fatal(err)
	}
	removeOwnIndexLock(repo.RootPath, started)
	if _, err := os.Stat(lock); !os.IsNotExist(err) {
		t.Fatal("the lock left by our killed command was not removed")
	}
}

func TestCancelledWriteLeavesNoIndexLock(t *testing.T) {
	repo, _ := unrealRepo(t, false)
	svc := newTestService()
	// A pre-commit hook that hangs stands in for a slow LFS clean filter.
	hook := filepath.Join(repo.RootPath, ".git", "hooks", "pre-commit")
	if err := os.WriteFile(hook, []byte("#!/bin/sh\nsleep 30\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	writeT(t, repo.RootPath, "Content/Slow.uasset", "slow")
	gitT(t, repo.RootPath, "add", "-A")
	ctx, cancel := context.WithTimeout(context.Background(), 1500*time.Millisecond)
	defer cancel()
	started := time.Now()
	_, _, err := svc.gitCtx(ctx, repo, gitOptions{write: true}, "commit", "-m", "slow")
	if err == nil {
		t.Fatal("expected the hung commit to be cancelled")
	}
	if time.Since(started) > 15*time.Second {
		t.Fatal("cancel did not stop the process tree promptly")
	}
	if _, err := os.Stat(filepath.Join(repo.RootPath, ".git", "index.lock")); !os.IsNotExist(err) {
		t.Fatal("index.lock survived the cancelled commit")
	}
	// The repository is usable straight away.
	if _, err := svc.gitWrite(repo, gitQuickTimeout, "reset", "-q"); err != nil {
		t.Fatalf("repository stuck after cancel: %v", err)
	}
}

func TestParseLFSLocksBothShapesAndRejectsGarbage(t *testing.T) {
	verified := `{"ours":[{"id":"1","path":"Content/A.uasset","owner":{"name":"me"},"locked_at":"2026-01-01T00:00:00Z"}],"theirs":[{"id":"2","path":"Content/B.umap","owner":{"name":"sam"}}]}`
	locks, err := parseLFSLocks(verified)
	if err != nil || len(locks) != 2 || locks[0]["ownership"] != "ours" || locks[1]["ownership"] != "theirs" {
		t.Fatalf("verified shape: %v %#v", err, locks)
	}
	plain := `[{"id":"1","path":"Content/A.uasset","owner":{"name":"Me"}},{"id":"2","path":"Content/B.umap","owner":{"name":"sam"}}]`
	locks, err = parseLFSLocks(plain)
	// Without --verify the server does not say whose lock it is; never claim it.
	if err != nil || len(locks) != 2 || locks[0]["ownership"] != "unknown" || locks[1]["ownership"] != "unknown" {
		t.Fatalf("plain list shape: %v %#v", err, locks)
	}
	if _, err := parseLFSLocks("Warning: something went wrong"); err == nil {
		t.Fatal("an unreadable lock list must be an error, not 'no locks'")
	}
}
