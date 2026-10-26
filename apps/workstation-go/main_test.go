package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestSafeRelRejectsRepositoryEscape(t *testing.T) {
	for _, value := range []string{"../secret", "../../outside", filepath.Join("..", "outside")} {
		if _, err := safeRel(value); err == nil {
			t.Fatalf("safeRel(%q) accepted repository escape", value)
		}
	}
	if got, err := safeRel("Content/Characters/Hero.uasset"); err != nil || got == "" {
		t.Fatalf("safe path rejected: %q %v", got, err)
	}
}

func TestPathInsideHonorsDirectoryBoundary(t *testing.T) {
	root := filepath.Join(string(filepath.Separator), "cluster", "repo")
	if !pathInside(root, filepath.Join(root, "Content", "Map.umap")) {
		t.Fatal("child path was not recognized as inside repository")
	}
	sibling := filepath.Join(string(filepath.Separator), "cluster", "repo-other", "secret")
	if pathInside(root, sibling) {
		t.Fatal("sibling prefix was incorrectly recognized as inside repository")
	}
}

func TestWorkstationAuthRequiresBearerToken(t *testing.T) {
	service := &service{token: "test-token", startedAt: time.Now(), state: persistedState{Schema: stateSchema}, candidates: map[string]candidate{}, operations: map[string]*operation{}}
	handler := service.auth(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusNoContent) })

	denied := httptest.NewRecorder()
	handler(denied, httptest.NewRequest(http.MethodGet, "/v1/source-control/runtime", nil))
	if denied.Code != http.StatusUnauthorized {
		t.Fatalf("missing token returned %d, want 401", denied.Code)
	}

	allowedRequest := httptest.NewRequest(http.MethodGet, "/v1/source-control/runtime", nil)
	allowedRequest.Header.Set("Authorization", "Bearer test-token")
	allowed := httptest.NewRecorder()
	handler(allowed, allowedRequest)
	if allowed.Code != http.StatusNoContent {
		t.Fatalf("valid token returned %d, want 204", allowed.Code)
	}
}

func TestRuntimeDoesNotExposeRawPaths(t *testing.T) {
	service := &service{token: "test-token", startedAt: time.Now(), state: persistedState{Schema: stateSchema}, candidates: map[string]candidate{}, operations: map[string]*operation{}}
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/v1/source-control/runtime", nil)
	service.handleRuntime(recorder, request)
	body := recorder.Body.String()
	if recorder.Code != http.StatusOK || !strings.Contains(body, `"rawPathExposure":false`) {
		t.Fatalf("runtime posture missing rawPathExposure=false: %s", body)
	}
}

func TestBinaryAssetDetectionCoversUnrealPackages(t *testing.T) {
	for _, path := range []string{"Content/Hero.uasset", "Content/Maps/Main.umap"} {
		if !isBinaryAsset(path) {
			t.Fatalf("%s should require binary-asset treatment", path)
		}
	}
	if isBinaryAsset("Source/GameMode.cpp") {
		t.Fatal("text source should not be treated as a binary asset")
	}
}

func TestDefaultListenUsesEphemeralLoopbackPort(t *testing.T) {
	if defaultListen != "127.0.0.1:0" {
		t.Fatalf("default listen = %q, want dynamic loopback", defaultListen)
	}
	if runtime.GOOS == "windows" && strings.Contains(defaultListen, "0.0.0.0") {
		t.Fatal("workstation must never listen on all interfaces")
	}
}

func TestSecretScanBlocksStagedPrivateKeyWithoutEchoingSecret(t *testing.T) {
	root := t.TempDir()
	for _, args := range [][]string{{"init"}, {"config", "user.name", "Cluster Test"}, {"config", "user.email", "cluster@example.invalid"}} {
		cmd := exec.Command("git", args...)
		cmd.Dir = root
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v failed: %v: %s", args, err, out)
		}
	}
	secret := "-----BEGIN PRIVATE KEY-----"
	if err := os.WriteFile(filepath.Join(root, "config.txt"), []byte("token="+secret+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	add := exec.Command("git", "add", "config.txt")
	add.Dir = root
	if out, err := add.CombinedOutput(); err != nil {
		t.Fatalf("git add failed: %v: %s", err, out)
	}
	svc := &service{
		state:     persistedState{Schema: stateSchema, Workspaces: []workspace{{ID: "ws", RootPath: root, Repositories: []repository{{ID: "repo", Name: "repo", RootPath: root, Trust: "trusted"}}}}},
		startedAt: time.Now(), candidates: map[string]candidate{}, operations: map[string]*operation{},
	}
	result, code, err := svc.nativeSecretScan(map[string]any{"workspaceId": "ws", "repositoryId": "repo", "scope": "staged"})
	if err != nil || code != "" {
		t.Fatalf("secret scan failed: code=%s err=%v", code, err)
	}
	encoded, _ := json.Marshal(result)
	body := string(encoded)
	if !strings.Contains(body, `"blocked":true`) || !strings.Contains(body, `"rule":"private-key"`) {
		t.Fatalf("secret scan failed to block private key: %s", body)
	}
	if strings.Contains(body, secret) {
		t.Fatalf("secret scan response leaked matched secret: %s", body)
	}
}

func TestSecretScanRejectsOutgoingWithoutUpstream(t *testing.T) {
	root := t.TempDir()
	cmd := exec.Command("git", "init")
	cmd.Dir = root
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git init failed: %v: %s", err, out)
	}
	svc := &service{
		state:     persistedState{Schema: stateSchema, Workspaces: []workspace{{ID: "ws", RootPath: root, Repositories: []repository{{ID: "repo", Name: "repo", RootPath: root, Trust: "trusted"}}}}},
		startedAt: time.Now(), candidates: map[string]candidate{}, operations: map[string]*operation{},
	}
	_, code, err := svc.nativeSecretScan(map[string]any{"workspaceId": "ws", "repositoryId": "repo", "scope": "outgoing"})
	if err == nil || code != "GIT_UPSTREAM_REQUIRED" {
		t.Fatalf("outgoing scan without upstream = code %q err %v", code, err)
	}
}

func TestResolveSourceRepositoryPrefersDeepestTrustedRepository(t *testing.T) {
	root := t.TempDir()
	parent := filepath.Join(root, "workspace")
	project := filepath.Join(parent, "games", "Example")
	if err := os.MkdirAll(project, 0o755); err != nil {
		t.Fatal(err)
	}
	svc := &service{
		state: persistedState{Schema: stateSchema, Workspaces: []workspace{{
			ID: "ws", RootPath: parent, Repositories: []repository{
				{ID: "parent", Name: "Parent", RootPath: parent, Trust: "trusted"},
				{ID: "project", Name: "Project", RootPath: project, Trust: "trusted"},
			},
		}}},
		startedAt: time.Now(), candidates: map[string]candidate{}, operations: map[string]*operation{},
	}
	result, code, err := svc.resolveSourceRepository(map[string]any{"projectPath": project})
	if err != nil || code != "" {
		t.Fatalf("resolve failed: code=%s err=%v", code, err)
	}
	m := result.(map[string]any)
	if m["repositoryId"] != "project" || m["projectRelativePrefix"] != "" {
		t.Fatalf("unexpected resolution: %#v", m)
	}
}

func TestSourceFileStatesReturnsCleanRequestedFiles(t *testing.T) {
	root := t.TempDir()
	for _, args := range [][]string{{"init"}, {"config", "user.name", "Cluster Test"}, {"config", "user.email", "cluster@example.invalid"}} {
		cmd := exec.Command("git", args...)
		cmd.Dir = root
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v failed: %v: %s", args, err, out)
		}
	}
	if err := os.MkdirAll(filepath.Join(root, "Content"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "Content", "Clean.uasset"), []byte("asset"), 0o644); err != nil {
		t.Fatal(err)
	}
	for _, args := range [][]string{{"add", "Content/Clean.uasset"}, {"commit", "-m", "initial"}} {
		cmd := exec.Command("git", args...)
		cmd.Dir = root
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v failed: %v: %s", args, err, out)
		}
	}
	svc := &service{state: persistedState{Schema: stateSchema}, startedAt: time.Now(), candidates: map[string]candidate{}, operations: map[string]*operation{}}
	result, code, err := svc.sourceFileStates(repository{ID: "repo", RootPath: root, Trust: "trusted"}, []string{"Content/Clean.uasset"})
	if err != nil || code != "" {
		t.Fatalf("states failed: code=%s err=%v", code, err)
	}
	states := result.([]map[string]any)
	if len(states) != 1 || states[0]["state"] != "clean" || states[0]["tracked"] != true {
		t.Fatalf("clean tracked state missing: %#v", states)
	}
}

func TestSourceControlRuntimeAdvertisesResolutionAndAsyncOperations(t *testing.T) {
	capabilities := strings.Join(runtimeCapabilities(), ",")
	for _, required := range []string{"repository.resolve", "revision.materialize", "operation.start", "operation.status", "operation.cancel"} {
		if !strings.Contains(capabilities, required) {
			t.Fatalf("runtime capability %q is missing: %s", required, capabilities)
		}
	}
}

func TestSourceOperationStatusIsRepositoryScoped(t *testing.T) {
	svc := &service{state: persistedState{Schema: stateSchema}, startedAt: time.Now(), candidates: map[string]candidate{}, operations: map[string]*operation{
		"op_test": {Schema: 2, ID: "op_test", RepositoryID: "repo-a", State: "running", Stage: "running", StartedAt: nowISO(), UpdatedAt: nowISO(), CreatedAt: nowISO()},
	}}
	result, code, err := svc.sourceOperationStatus(repository{ID: "repo-a"}, map[string]any{"operationId": "op_test"})
	if err != nil || code != "" || result == nil {
		t.Fatalf("expected scoped operation lookup to succeed: code=%q err=%v result=%#v", code, err, result)
	}
	if _, code, err = svc.sourceOperationStatus(repository{ID: "repo-b"}, map[string]any{"operationId": "op_test"}); err == nil || code != "OPERATION_NOT_FOUND" {
		t.Fatalf("cross-repository operation lookup was not rejected: code=%q err=%v", code, err)
	}
}

func TestSourceOperationCancelRequestsContextCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	svc := &service{state: persistedState{Schema: stateSchema}, startedAt: time.Now(), candidates: map[string]candidate{}, operations: map[string]*operation{
		"op_cancel": {Schema: 2, ID: "op_cancel", RepositoryID: "repo", State: "running", Stage: "running", StartedAt: nowISO(), UpdatedAt: nowISO(), CreatedAt: nowISO(), cancel: cancel},
	}}
	result, code, err := svc.sourceOperationCancel(repository{ID: "repo"}, map[string]any{"operationId": "op_cancel"})
	if err != nil || code != "" {
		t.Fatalf("cancel failed: code=%q err=%v", code, err)
	}
	if cancelled, _ := result.(map[string]any)["cancelled"].(bool); !cancelled {
		t.Fatalf("operation did not report cancellation: %#v", result)
	}
	select {
	case <-ctx.Done():
	default:
		t.Fatal("operation context was not cancelled")
	}
}

func TestSourceHistoryScopesToRequestedPath(t *testing.T) {
	root := t.TempDir()
	for _, args := range [][]string{{"init"}, {"config", "user.name", "Cluster Test"}, {"config", "user.email", "cluster@example.invalid"}} {
		cmd := exec.Command("git", args...)
		cmd.Dir = root
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v failed: %v: %s", args, err, out)
		}
	}
	write := func(path, contents string) {
		if err := os.WriteFile(filepath.Join(root, path), []byte(contents), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	commit := func(message string, paths ...string) {
		args := append([]string{"add", "--"}, paths...)
		cmd := exec.Command("git", args...)
		cmd.Dir = root
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git add failed: %v: %s", err, out)
		}
		cmd = exec.Command("git", "commit", "-m", message)
		cmd.Dir = root
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git commit failed: %v: %s", err, out)
		}
	}
	write("A.txt", "a1\n")
	write("B.txt", "b1\n")
	commit("initial", "A.txt", "B.txt")
	write("A.txt", "a2\n")
	commit("change-a", "A.txt")
	write("B.txt", "b2\n")
	commit("change-b", "B.txt")

	svc := &service{state: persistedState{Schema: stateSchema}, startedAt: time.Now(), candidates: map[string]candidate{}, operations: map[string]*operation{}}
	result, code, err := svc.sourceHistory(repository{ID: "repo", RootPath: root, Trust: "trusted"}, []string{"A.txt"}, 10)
	if err != nil || code != "" {
		t.Fatalf("history failed: code=%q err=%v", code, err)
	}
	entries := result.([]map[string]any)
	summaries := []string{}
	for _, entry := range entries {
		summaries = append(summaries, fmt.Sprint(entry["summary"]))
	}
	joined := strings.Join(summaries, ",")
	if !strings.Contains(joined, "initial") || !strings.Contains(joined, "change-a") || strings.Contains(joined, "change-b") {
		t.Fatalf("path-scoped history was wrong: %v", summaries)
	}
}

func TestSourceDiffSupportsValidatedRevisions(t *testing.T) {
	root := t.TempDir()
	for _, args := range [][]string{{"init"}, {"config", "user.name", "Cluster Test"}, {"config", "user.email", "cluster@example.invalid"}} {
		cmd := exec.Command("git", args...)
		cmd.Dir = root
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v failed: %v: %s", args, err, out)
		}
	}
	path := filepath.Join(root, "A.txt")
	if err := os.WriteFile(path, []byte("one\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	for _, args := range [][]string{{"add", "A.txt"}, {"commit", "-m", "one"}} {
		cmd := exec.Command("git", args...)
		cmd.Dir = root
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v failed: %v: %s", args, err, out)
		}
	}
	rev := func() string {
		cmd := exec.Command("git", "rev-parse", "HEAD")
		cmd.Dir = root
		out, err := cmd.Output()
		if err != nil {
			t.Fatal(err)
		}
		return strings.TrimSpace(string(out))
	}
	base := rev()
	if err := os.WriteFile(path, []byte("two\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	for _, args := range [][]string{{"add", "A.txt"}, {"commit", "-m", "two"}} {
		cmd := exec.Command("git", args...)
		cmd.Dir = root
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v failed: %v: %s", args, err, out)
		}
	}
	target := rev()

	svc := &service{state: persistedState{Schema: stateSchema}, startedAt: time.Now(), candidates: map[string]candidate{}, operations: map[string]*operation{}}
	result, code, err := svc.sourceDiff(repository{ID: "repo", RootPath: root, Trust: "trusted"}, []string{"A.txt"}, map[string]any{"baseRevision": base, "targetRevision": target})
	if err != nil || code != "" {
		t.Fatalf("revision diff failed: code=%q err=%v", code, err)
	}
	patch := fmt.Sprint(result.(map[string]any)["patch"])
	if !strings.Contains(patch, "-one") || !strings.Contains(patch, "+two") {
		t.Fatalf("revision diff did not contain expected change: %s", patch)
	}
}

func TestSourceDiffRejectsOptionLikeRevision(t *testing.T) {
	svc := &service{state: persistedState{Schema: stateSchema}, startedAt: time.Now(), candidates: map[string]candidate{}, operations: map[string]*operation{}}
	_, code, err := svc.sourceDiff(repository{ID: "repo", RootPath: t.TempDir(), Trust: "trusted"}, nil, map[string]any{"baseRevision": "--output=/tmp/nope"})
	if err == nil || code != "GIT_REVISION_INVALID" {
		t.Fatalf("option-like revision was not rejected: code=%q err=%v", code, err)
	}
}

func TestSourceRevisionMaterializeWritesExactRevision(t *testing.T) {
	root := t.TempDir()
	for _, args := range [][]string{{"init"}, {"config", "user.name", "Cluster Test"}, {"config", "user.email", "cluster@example.invalid"}} {
		cmd := exec.Command("git", args...)
		cmd.Dir = root
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v failed: %v: %s", args, err, out)
		}
	}
	if err := os.MkdirAll(filepath.Join(root, "Content"), 0o755); err != nil {
		t.Fatal(err)
	}
	asset := filepath.Join(root, "Content", "History.uasset")
	if err := os.WriteFile(asset, []byte("revision-one\x00asset"), 0o644); err != nil {
		t.Fatal(err)
	}
	for _, args := range [][]string{{"add", "Content/History.uasset"}, {"commit", "-m", "one"}} {
		cmd := exec.Command("git", args...)
		cmd.Dir = root
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v failed: %v: %s", args, err, out)
		}
	}
	cmd := exec.Command("git", "rev-parse", "HEAD")
	cmd.Dir = root
	out, err := cmd.Output()
	if err != nil {
		t.Fatal(err)
	}
	revision := strings.TrimSpace(string(out))
	if err := os.WriteFile(asset, []byte("working-tree-change"), 0o644); err != nil {
		t.Fatal(err)
	}
	stateDir := t.TempDir()
	svc := &service{cfg: config{stateDir: stateDir}, state: persistedState{Schema: stateSchema}, startedAt: time.Now(), candidates: map[string]candidate{}, operations: map[string]*operation{}}
	result, code, err := svc.sourceRevisionMaterialize(repository{ID: "repo", RootPath: root, Trust: "trusted"}, []string{"Content/History.uasset"}, map[string]any{"revision": revision})
	if err != nil || code != "" {
		t.Fatalf("materialize failed: code=%q err=%v", code, err)
	}
	materialized := result.(map[string]any)["materializedPath"].(string)
	bytes, err := os.ReadFile(materialized)
	if err != nil {
		t.Fatal(err)
	}
	if string(bytes) != "revision-one\x00asset" {
		t.Fatalf("materialized revision mismatch: %q", string(bytes))
	}
	if !pathWithin(filepath.Join(stateDir, "revisions"), materialized) {
		t.Fatalf("materialized file escaped revision cache: %s", materialized)
	}
}

func TestSourceRevisionMaterializeRejectsInvalidRevision(t *testing.T) {
	svc := &service{cfg: config{stateDir: t.TempDir()}, state: persistedState{Schema: stateSchema}, startedAt: time.Now(), candidates: map[string]candidate{}, operations: map[string]*operation{}}
	_, code, err := svc.sourceRevisionMaterialize(repository{ID: "repo", RootPath: t.TempDir(), Trust: "trusted"}, []string{"Content/A.uasset"}, map[string]any{"revision": "--output=nope"})
	if err == nil || code != "GIT_REVISION_INVALID" {
		t.Fatalf("invalid revision was not rejected: code=%q err=%v", code, err)
	}
}

func TestOperationProgressReporterPublishesMeaningfulStage(t *testing.T) {
	svc := &service{state: persistedState{Schema: stateSchema}, startedAt: time.Now(), candidates: map[string]candidate{}, operations: map[string]*operation{}}
	phaseReady := make(chan struct{})
	release := make(chan struct{})
	op := svc.startOperation("git.test", "ws", "repo", "repo", func(ctx context.Context, report operationProgressReporter) (any, error) {
		report("fetching", "Fetching remote refs", 35)
		close(phaseReady)
		select {
		case <-release:
			return map[string]any{"ok": true}, nil
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	})
	select {
	case <-phaseReady:
	case <-time.After(time.Second):
		t.Fatal("operation did not publish progress in time")
	}
	svc.mu.RLock()
	snapshot := cloneOperation(svc.operations[op.ID])
	svc.mu.RUnlock()
	if snapshot == nil || snapshot.Stage != "fetching" || snapshot.Progress != 35 || snapshot.ProgressMessage != "Fetching remote refs" {
		t.Fatalf("unexpected progress snapshot: %#v", snapshot)
	}
	close(release)
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		svc.mu.RLock()
		finished := cloneOperation(svc.operations[op.ID])
		svc.mu.RUnlock()
		if finished != nil && finished.State == "succeeded" {
			if finished.Progress != 100 || finished.Stage != "complete" {
				t.Fatalf("unexpected terminal progress: %#v", finished)
			}
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("operation did not complete in time")
}

func TestHealthIncludesVersionAndProtocol(t *testing.T) {
	s := &service{}
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	recorder := httptest.NewRecorder()
	s.handleHealth(recorder, req)
	if recorder.Code != http.StatusOK {
		t.Fatalf("health status = %d, want %d", recorder.Code, http.StatusOK)
	}
	var payload map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode health response: %v", err)
	}
	if payload["service"] != "cluster-workstation" || payload["version"] != buildVersion {
		t.Fatalf("unexpected health identity: %#v", payload)
	}
	if int(payload["protocol"].(float64)) != serviceProtocol || int(payload["schema"].(float64)) != 1 {
		t.Fatalf("unexpected health contract: %#v", payload)
	}
}

func TestBundledGitRuntimePreferredLayout(t *testing.T) {
	base := t.TempDir()
	gitName := "git"
	lfsName := "git-lfs"
	gitDir := filepath.Join(base, "runtime", "git", "bin")
	if runtime.GOOS == "windows" {
		gitName = "git.exe"
		lfsName = "git-lfs.exe"
		gitDir = filepath.Join(base, "runtime", "git", "cmd")
	}
	lfsDir := filepath.Join(base, "runtime", "git-lfs")
	if err := os.MkdirAll(gitDir, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(lfsDir, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(gitDir, gitName), []byte("git"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(lfsDir, lfsName), []byte("lfs"), 0o700); err != nil {
		t.Fatal(err)
	}
	resolved, ok := bundledGitRuntime(base)
	if !ok || resolved.Kind != "bundled" || resolved.LFSBinDir != lfsDir {
		t.Fatalf("unexpected bundled runtime: %#v ok=%v", resolved, ok)
	}
}

func TestResolveGitRuntimeHonorsExplicitOverride(t *testing.T) {
	gitFile := filepath.Join(t.TempDir(), "cluster-test-git")
	if runtime.GOOS == "windows" {
		gitFile += ".exe"
	}
	if err := os.WriteFile(gitFile, []byte("git"), 0o700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("CLUSTER_GIT_BIN", gitFile)
	resolved := resolveGitRuntime()
	if resolved.Kind != "explicit" || resolved.Executable != gitFile {
		t.Fatalf("unexpected explicit runtime: %#v", resolved)
	}
}

func TestGitCommandEnvReplacesPathAndGitFlags(t *testing.T) {
	t.Setenv("PATH", "system-path")
	t.Setenv("GIT_TERMINAL_PROMPT", "1")
	t.Setenv("GIT_OPTIONAL_LOCKS", "1")
	svc := &service{gitRuntime: gitRuntime{Executable: "git", LFSBinDir: "private-lfs", Kind: "bundled"}}
	env := svc.gitCommandEnv()
	counts := map[string]int{}
	values := map[string]string{}
	for _, entry := range env {
		separator := strings.IndexByte(entry, '=')
		if separator < 0 {
			continue
		}
		key := strings.ToUpper(entry[:separator])
		if key == "PATH" || key == "GIT_TERMINAL_PROMPT" || key == "GIT_OPTIONAL_LOCKS" {
			counts[key]++
			values[key] = entry[separator+1:]
		}
	}
	if counts["PATH"] != 1 || !strings.HasPrefix(values["PATH"], "private-lfs"+string(os.PathListSeparator)) {
		t.Fatalf("unexpected PATH environment: count=%d value=%q", counts["PATH"], values["PATH"])
	}
	if counts["GIT_TERMINAL_PROMPT"] != 1 || values["GIT_TERMINAL_PROMPT"] != "0" {
		t.Fatalf("unexpected GIT_TERMINAL_PROMPT: count=%d value=%q", counts["GIT_TERMINAL_PROMPT"], values["GIT_TERMINAL_PROMPT"])
	}
	if counts["GIT_OPTIONAL_LOCKS"] != 1 || values["GIT_OPTIONAL_LOCKS"] != "0" {
		t.Fatalf("unexpected GIT_OPTIONAL_LOCKS: count=%d value=%q", counts["GIT_OPTIONAL_LOCKS"], values["GIT_OPTIONAL_LOCKS"])
	}
}
