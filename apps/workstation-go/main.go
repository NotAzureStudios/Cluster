package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

const (
	serviceProtocol = 1
	stateSchema     = 1
	maxBodyBytes    = 1 << 20
	defaultListen   = "127.0.0.1:0"
)

var buildVersion = "1.2.3-dev"

type config struct {
	listen        string
	stateDir      string
	discoveryFile string
}

type gitRuntime struct {
	Executable string
	LFSBinDir  string
	Kind       string
}

type discovery struct {
	Schema    int    `json:"schema"`
	Protocol  int    `json:"protocol"`
	Endpoint  string `json:"endpoint"`
	Token     string `json:"token"`
	PID       int    `json:"pid"`
	StartedAt string `json:"startedAt"`
	Version   string `json:"version"`
}

type projectRef struct {
	ProfileID string `json:"profileId"`
	ProjectID string `json:"projectId"`
}

type repository struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	RelativePath string `json:"relativePath"`
	RootPath     string `json:"rootPath"`
	Trust        string `json:"trust"`
	AddedAt      string `json:"addedAt"`
}

type workspace struct {
	ID           string       `json:"id"`
	Name         string       `json:"name"`
	RootName     string       `json:"rootName"`
	RootPath     string       `json:"rootPath"`
	ProjectRefs  []projectRef `json:"projectRefs"`
	Repositories []repository `json:"repositories"`
	CreatedAt    string       `json:"createdAt"`
	UpdatedAt    string       `json:"updatedAt"`
}

type persistedState struct {
	Schema     int         `json:"schema"`
	Workspaces []workspace `json:"workspaces"`
}

type candidate struct {
	CandidateID  string    `json:"candidateId"`
	Name         string    `json:"name"`
	RelativePath string    `json:"relativePath"`
	RootPath     string    `json:"-"`
	WorkspaceID  string    `json:"-"`
	ExpiresAt    time.Time `json:"-"`
}

type operation struct {
	Schema          int                `json:"schema"`
	ID              string             `json:"id"`
	Kind            string             `json:"kind"`
	State           string             `json:"state"`
	Stage           string             `json:"stage"`
	WorkspaceID     string             `json:"workspaceId"`
	RepositoryID    string             `json:"repositoryId"`
	TargetLabel     string             `json:"targetLabel,omitempty"`
	StartedAt       string             `json:"startedAt"`
	UpdatedAt       string             `json:"updatedAt"`
	CompletedAt     string             `json:"completedAt,omitempty"`
	Message         string             `json:"message,omitempty"`
	Percent         int                `json:"percent,omitempty"`
	Logs            []string           `json:"logs"`
	Type            string             `json:"type"`
	Queue           string             `json:"queue"`
	Status          string             `json:"status"`
	Trace           any                `json:"trace"`
	Priority        int                `json:"priority"`
	CostUnits       int                `json:"costUnits"`
	Progress        int                `json:"progress"`
	ProgressMessage string             `json:"progressMessage,omitempty"`
	Attempts        int                `json:"attempts"`
	MaxAttempts     int                `json:"maxAttempts"`
	RunAfter        string             `json:"runAfter"`
	LastError       string             `json:"lastError,omitempty"`
	CreatedAt       string             `json:"createdAt"`
	FinishedAt      string             `json:"finishedAt,omitempty"`
	Result          any                `json:"result,omitempty"`
	cancel          context.CancelFunc `json:"-"`
}

type service struct {
	cfg        config
	gitRuntime gitRuntime
	token      string
	startedAt  time.Time
	statePath  string
	mu         sync.RWMutex
	state      persistedState
	candidates map[string]candidate
	operations map[string]*operation
}

func main() {
	if len(os.Args) == 2 && (os.Args[1] == "--version" || os.Args[1] == "-version") {
		fmt.Printf("cluster-workstation-service %s protocol %d\n", buildVersion, serviceProtocol)
		return
	}
	cfg := parseFlags()
	if err := os.MkdirAll(cfg.stateDir, 0o700); err != nil {
		log.Fatal(err)
	}
	token, err := randomToken(32)
	if err != nil {
		log.Fatal(err)
	}
	s := &service{
		cfg: cfg, gitRuntime: resolveGitRuntime(), token: token, startedAt: time.Now().UTC(),
		statePath: filepath.Join(cfg.stateDir, "workspaces.json"),
		state:     persistedState{Schema: stateSchema}, candidates: map[string]candidate{}, operations: map[string]*operation{},
	}
	if err := s.loadState(); err != nil {
		log.Printf("workstation state load warning: %v", err)
	}

	listener, err := net.Listen("tcp", cfg.listen)
	if err != nil {
		log.Fatalf("listen %s: %v", cfg.listen, err)
	}
	addr := listener.Addr().String()
	endpoint := "http://" + addr
	if err := s.writeDiscovery(endpoint); err != nil {
		listener.Close()
		log.Fatal(err)
	}
	defer os.Remove(cfg.discoveryFile)

	mux := http.NewServeMux()
	mux.HandleFunc("/health", s.handleHealth)
	mux.HandleFunc("/v1/source-control/runtime", s.auth(s.handleRuntime))
	mux.HandleFunc("/v1/source-control/actions", s.auth(s.handleSourceControlAction))
	mux.HandleFunc("/v1/native/capability", s.auth(s.handleNativeCapability))

	server := &http.Server{Handler: mux, ReadHeaderTimeout: 3 * time.Second, IdleTimeout: 30 * time.Second, MaxHeaderBytes: 16 << 10}
	log.Printf("Cluster Workstation service %s listening on %s", buildVersion, endpoint)
	if err := server.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}

func parseFlags() config {
	var cfg config
	flag.StringVar(&cfg.listen, "listen", defaultListen, "loopback listen address")
	flag.StringVar(&cfg.stateDir, "state-dir", defaultStateDir(), "state directory")
	flag.StringVar(&cfg.discoveryFile, "discovery-file", "", "discovery JSON file")
	flag.Parse()
	if cfg.discoveryFile == "" {
		cfg.discoveryFile = filepath.Join(cfg.stateDir, "source-control-endpoint.json")
	}
	host, _, err := net.SplitHostPort(cfg.listen)
	if err != nil || (host != "127.0.0.1" && host != "localhost" && host != "::1") {
		log.Fatal("workstation service must listen on loopback")
	}
	return cfg
}

func bundledGitRuntime(base string) (gitRuntime, bool) {
	var gitCandidates []string
	var lfsCandidates []string
	if runtime.GOOS == "windows" {
		gitCandidates = []string{
			filepath.Join(base, "runtime", "git", "cmd", "git.exe"),
			filepath.Join(base, "runtime", "git", "bin", "git.exe"),
		}
		lfsCandidates = []string{
			filepath.Join(base, "runtime", "git-lfs"),
			filepath.Join(base, "runtime", "git", "mingw64", "bin"),
			filepath.Join(base, "runtime", "git", "ucrt64", "bin"),
		}
	} else {
		gitCandidates = []string{filepath.Join(base, "runtime", "git", "bin", "git")}
		lfsCandidates = []string{filepath.Join(base, "runtime", "git-lfs")}
	}
	for _, candidate := range gitCandidates {
		if info, err := os.Stat(candidate); err == nil && info.Mode().IsRegular() {
			lfsDir := ""
			for _, dir := range lfsCandidates {
				name := "git-lfs"
				if runtime.GOOS == "windows" {
					name = "git-lfs.exe"
				}
				if info, err := os.Stat(filepath.Join(dir, name)); err == nil && info.Mode().IsRegular() {
					lfsDir = dir
					break
				}
			}
			return gitRuntime{Executable: candidate, LFSBinDir: lfsDir, Kind: "bundled"}, true
		}
	}
	return gitRuntime{}, false
}

func resolveGitRuntime() gitRuntime {
	if override := strings.TrimSpace(os.Getenv("CLUSTER_GIT_BIN")); override != "" {
		if info, err := os.Stat(override); err == nil && info.Mode().IsRegular() {
			return gitRuntime{Executable: override, LFSBinDir: strings.TrimSpace(os.Getenv("CLUSTER_GIT_LFS_BIN_DIR")), Kind: "explicit"}
		}
	}
	executable, _ := os.Executable()
	if privateRuntime, ok := bundledGitRuntime(filepath.Dir(executable)); ok {
		return privateRuntime
	}
	if systemGit, err := exec.LookPath("git"); err == nil {
		return gitRuntime{Executable: systemGit, Kind: "system"}
	}
	return gitRuntime{Kind: "unavailable"}
}

func (s *service) effectiveGitRuntime() gitRuntime {
	if s.gitRuntime.Executable != "" || s.gitRuntime.Kind == "unavailable" {
		return s.gitRuntime
	}
	return resolveGitRuntime()
}

func setEnvironmentValue(env []string, key, value string) []string {
	prefix := key + "="
	filtered := make([]string, 0, len(env)+1)
	for _, entry := range env {
		separator := strings.IndexByte(entry, '=')
		if separator >= 0 && strings.EqualFold(entry[:separator], key) {
			continue
		}
		filtered = append(filtered, entry)
	}
	return append(filtered, prefix+value)
}

func (s *service) gitCommandEnv() []string {
	env := append([]string{}, os.Environ()...)
	runtimeInfo := s.effectiveGitRuntime()
	if runtimeInfo.LFSBinDir != "" {
		pathValue := runtimeInfo.LFSBinDir
		if existing := os.Getenv("PATH"); existing != "" {
			pathValue += string(os.PathListSeparator) + existing
		}
		env = setEnvironmentValue(env, "PATH", pathValue)
	}
	env = setEnvironmentValue(env, "GIT_TERMINAL_PROMPT", "0")
	env = setEnvironmentValue(env, "GIT_OPTIONAL_LOCKS", "0")
	return env
}

func (s *service) runGitCommand(ctx context.Context, dir string, args ...string) (string, error) {
	runtimeInfo := s.effectiveGitRuntime()
	if runtimeInfo.Executable == "" {
		return "", errors.New("Git runtime is unavailable")
	}
	return runCommand(ctx, dir, runtimeInfo.Executable, s.gitCommandEnv(), args...)
}

func (s *service) runGitCommandToFile(ctx context.Context, cwd, outputPath string, args ...string) error {
	runtimeInfo := s.effectiveGitRuntime()
	if runtimeInfo.Executable == "" {
		return errors.New("Git runtime is unavailable")
	}
	return runCommandToFile(ctx, cwd, outputPath, runtimeInfo.Executable, s.gitCommandEnv(), args...)
}

func defaultStateDir() string {
	home, _ := os.UserHomeDir()
	if home == "" {
		home = "."
	}
	return filepath.Join(home, ".cluster", "workstation")
}

func randomToken(bytes int) (string, error) {
	buf := make([]byte, bytes)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}

func randomID(prefix string) string {
	token, err := randomToken(12)
	if err != nil {
		return fmt.Sprintf("%s-%d", prefix, time.Now().UnixNano())
	}
	return prefix + "-" + token
}

func nowISO() string { return time.Now().UTC().Format(time.RFC3339Nano) }

func (s *service) writeDiscovery(endpoint string) error {
	if err := os.MkdirAll(filepath.Dir(s.cfg.discoveryFile), 0o700); err != nil {
		return err
	}
	payload, err := json.MarshalIndent(discovery{Schema: 1, Protocol: serviceProtocol, Endpoint: endpoint, Token: s.token, PID: os.Getpid(), StartedAt: s.startedAt.Format(time.RFC3339Nano), Version: buildVersion}, "", "  ")
	if err != nil {
		return err
	}
	tmp := s.cfg.discoveryFile + ".tmp"
	if err := os.WriteFile(tmp, payload, 0o600); err != nil {
		return err
	}
	_ = os.Chmod(tmp, 0o600)
	return os.Rename(tmp, s.cfg.discoveryFile)
}

func (s *service) loadState() error {
	data, err := os.ReadFile(s.statePath)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	var state persistedState
	if err := json.Unmarshal(data, &state); err != nil {
		return err
	}
	if state.Schema != stateSchema {
		return fmt.Errorf("unsupported workstation state schema %d", state.Schema)
	}
	for wi := range state.Workspaces {
		state.Workspaces[wi].RootPath = filepath.Clean(state.Workspaces[wi].RootPath)
		for ri := range state.Workspaces[wi].Repositories {
			state.Workspaces[wi].Repositories[ri].RootPath = filepath.Clean(state.Workspaces[wi].Repositories[ri].RootPath)
		}
	}
	s.state = state
	return nil
}

func (s *service) saveStateLocked() error {
	data, err := json.MarshalIndent(s.state, "", "  ")
	if err != nil {
		return err
	}
	tmp := s.statePath + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	_ = os.Chmod(tmp, 0o600)
	return os.Rename(tmp, s.statePath)
}

func (s *service) auth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer "+s.token {
			writeError(w, http.StatusUnauthorized, "WORKSTATION_AUTH_REQUIRED", "A valid local Workstation token is required.")
			return
		}
		next(w, r)
	}
}

func (s *service) handleHealth(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "schema": 1, "protocol": serviceProtocol, "service": "cluster-workstation", "version": buildVersion})
}

func runtimeCapabilities() []string {
	return []string{"runtime.status", "repository.resolve", "repository.status", "repository.sync", "repository.history", "files.status", "files.checkout", "files.add", "files.delete", "files.revert", "changes.commit", "locks.list", "locks.acquire", "locks.release", "diff.read", "revision.materialize", "operation.start", "operation.status", "operation.cancel", "cluster.open"}
}

func nativeCapabilities() []string {
	return []string{
		"workstation.status", "workspace.local.list", "workspace.local.create", "workspace.local.remove", "workspace.local.discoverRepositories", "workspace.local.attachRepository", "workspace.local.setRepositoryTrust",
		"git.local.status", "git.local.details", "git.local.init", "git.local.lfsHealth", "git.local.lfsPolicy", "git.local.diff", "git.local.mutate", "git.local.secretScan", "git.local.clone", "git.local.operation.start", "git.local.operation.list", "git.local.operation.cancel",
		"task.local.definitions", "task.local.run", "task.local.list", "task.local.cancel", "hardware.local.capabilities",
	}
}

func (s *service) handleRuntime(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	runtimeInfo := s.effectiveGitRuntime()
	writeJSON(w, http.StatusOK, map[string]any{"schema": 1, "protocol": serviceProtocol, "available": true, "desktopVersion": buildVersion, "serviceVersion": buildVersion, "authenticatedLocalIpc": true, "rawPathExposure": false, "gitRuntime": runtimeInfo.Kind, "bundledGitLfs": runtimeInfo.Kind == "bundled" && runtimeInfo.LFSBinDir != "", "capabilities": runtimeCapabilities()})
}

type sourceRequest struct {
	Schema       int            `json:"schema"`
	Protocol     int            `json:"protocol"`
	RequestID    string         `json:"requestId"`
	Action       string         `json:"action"`
	RepositoryID string         `json:"repositoryId"`
	Paths        []string       `json:"paths"`
	Input        map[string]any `json:"input"`
}

func (s *service) handleSourceControlAction(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	var req sourceRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	if req.Schema != 1 || req.Protocol != serviceProtocol || req.RequestID == "" {
		writeError(w, 400, "INVALID_REQUEST", "Unsupported source-control request envelope.")
		return
	}
	result, code, err := s.dispatchSource(req)
	response := map[string]any{"schema": 1, "protocol": serviceProtocol, "requestId": req.RequestID, "ok": err == nil}
	if err != nil {
		response["error"] = map[string]any{"code": code, "message": err.Error(), "retryable": code == "WORKSTATION_BUSY" || code == "GIT_TIMEOUT"}
	} else {
		response["result"] = result
	}
	writeJSON(w, http.StatusOK, response)
}

func (s *service) dispatchSource(req sourceRequest) (any, string, error) {
	if req.Action == "runtime.status" {
		runtimeInfo := s.effectiveGitRuntime()
		return map[string]any{"schema": 1, "protocol": serviceProtocol, "available": true, "desktopVersion": buildVersion, "serviceVersion": buildVersion, "authenticatedLocalIpc": true, "rawPathExposure": false, "gitRuntime": runtimeInfo.Kind, "bundledGitLfs": runtimeInfo.Kind == "bundled" && runtimeInfo.LFSBinDir != "", "capabilities": runtimeCapabilities()}, "", nil
	}
	if req.Action == "repository.resolve" {
		return s.resolveSourceRepository(req.Input)
	}
	repo, ws, err := s.repositoryByID(req.RepositoryID)
	if err != nil {
		return nil, "REPOSITORY_NOT_FOUND", err
	}
	if repo.Trust != "trusted" {
		return nil, "REPOSITORY_NOT_TRUSTED", errors.New("Repository operations require explicit Desktop trust.")
	}
	switch req.Action {
	case "repository.status":
		return s.sourceRepositoryStatus(ws, repo)
	case "repository.history":
		return s.sourceHistory(repo, req.Paths, intFromInput(req.Input, "limit", 30))
	case "files.status":
		return s.sourceFileStates(repo, req.Paths)
	case "diff.read":
		return s.sourceDiff(repo, req.Paths, req.Input)
	case "revision.materialize":
		return s.sourceRevisionMaterialize(repo, req.Paths, req.Input)
	case "files.add":
		_, e := s.git(repo, 20*time.Second, append([]string{"add", "--"}, safePaths(req.Paths)...)...)
		return ack(e)
	case "files.delete":
		_, e := s.git(repo, 20*time.Second, append([]string{"rm", "--"}, safePaths(req.Paths)...)...)
		return ack(e)
	case "files.revert":
		_, e := s.git(repo, 20*time.Second, append([]string{"restore", "--"}, safePaths(req.Paths)...)...)
		return ack(e)
	case "files.checkout":
		if boolFromInput(req.Input, "lock") {
			if len(req.Paths) != 1 {
				return nil, "LOCK_PATH_REQUIRED", errors.New("Exactly one path is required for an LFS checkout lock.")
			}
			return s.lfsLock(repo, req.Paths[0])
		}
		return map[string]any{"checkedOut": safePaths(req.Paths)}, "", nil
	case "changes.commit":
		return s.sourceCommit(repo, req.Input, req.Paths)
	case "locks.list":
		return s.lfsLocks(repo)
	case "locks.acquire":
		if len(req.Paths) != 1 {
			return nil, "LOCK_PATH_REQUIRED", errors.New("Exactly one lock path is required.")
		}
		return s.lfsLock(repo, req.Paths[0])
	case "locks.release":
		if len(req.Paths) != 1 {
			return nil, "LOCK_PATH_REQUIRED", errors.New("Exactly one unlock path is required.")
		}
		return s.lfsUnlock(repo, req.Paths[0], boolFromInput(req.Input, "force"))
	case "repository.sync":
		return s.sourceSync(repo, req.Input)
	case "operation.start":
		return s.sourceOperationStart(ws, repo, req.Paths, req.Input)
	case "operation.status":
		return s.sourceOperationStatus(repo, req.Input)
	case "operation.cancel":
		return s.sourceOperationCancel(repo, req.Input)
	case "cluster.open":
		return map[string]any{"deepLink": stringFromInput(req.Input, "deepLink")}, "", nil
	default:
		return nil, "ACTION_UNSUPPORTED", fmt.Errorf("unsupported source-control action %q", req.Action)
	}
}

func ack(err error) (any, string, error) {
	if err != nil {
		return nil, "GIT_COMMAND_FAILED", err
	}
	return map[string]any{"ok": true}, "", nil
}

type nativeRequest struct {
	Capability string         `json:"capability"`
	Payload    map[string]any `json:"payload"`
}

func (s *service) handleNativeCapability(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	var req nativeRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	result, code, err := s.dispatchNative(req.Capability, req.Payload)
	if err != nil {
		writeJSON(w, 200, map[string]any{"ok": false, "error": map[string]any{"code": code, "message": err.Error()}})
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true, "result": result})
}

func (s *service) dispatchNative(capability string, p map[string]any) (any, string, error) {
	switch capability {
	case "workstation.status":
		runtimeInfo := s.effectiveGitRuntime()
		return map[string]any{"schema": 1, "protocol": 1, "version": buildVersion, "pid": os.Getpid(), "startedAt": s.startedAt.Format(time.RFC3339Nano), "backgroundIndependent": true, "authenticatedLocalIpc": true, "rawPathExposure": false, "sessionLeaseCount": 1, "gitRuntime": runtimeInfo.Kind, "bundledGitLfs": runtimeInfo.Kind == "bundled" && runtimeInfo.LFSBinDir != "", "capabilities": nativeCapabilities()}, "", nil
	case "workspace.local.list":
		return map[string]any{"workspaces": s.publicWorkspaces()}, "", nil
	case "workspace.local.create":
		return s.createWorkspace(p)
	case "workspace.local.remove":
		return s.removeWorkspace(p)
	case "workspace.local.discoverRepositories":
		return s.discoverRepositories(p)
	case "workspace.local.attachRepository":
		return s.attachRepository(p)
	case "workspace.local.setRepositoryTrust":
		return s.setRepositoryTrust(p)
	case "git.local.init":
		return s.gitInit(p)
	case "git.local.status":
		return s.nativeGitStatus(p)
	case "git.local.details":
		return s.nativeGitDetails(p)
	case "git.local.lfsHealth":
		return s.nativeLFSHealth(p)
	case "git.local.lfsPolicy":
		return s.nativeLFSPolicy(p)
	case "git.local.diff":
		return s.nativeDiff(p)
	case "git.local.mutate":
		return s.nativeMutate(p)
	case "git.local.clone":
		return s.nativeClone(p)
	case "git.local.operation.start":
		return s.nativeOperationStart(p)
	case "git.local.operation.list":
		return map[string]any{"operations": s.operationSnapshots()}, "", nil
	case "git.local.operation.cancel":
		return s.nativeOperationCancel(p)
	case "git.local.secretScan":
		return s.nativeSecretScan(p)
	case "task.local.definitions":
		return map[string]any{"definitions": []any{}}, "", nil
	case "task.local.list":
		return map[string]any{"operations": []any{}}, "", nil
	case "task.local.run":
		return nil, "TASKS_NOT_CONFIGURED", errors.New("No signed local task manifest is configured for this repository.")
	case "task.local.cancel":
		return map[string]any{"cancelled": false}, "", nil
	case "hardware.local.capabilities":
		return map[string]any{"schema": 1, "architecture": runtime.GOARCH, "buildArchitecture": runtime.GOARCH, "kernelType": runtime.GOOS, "kernelVersion": "", "productType": runtime.GOOS, "logicalCpuCount": runtime.NumCPU(), "localTaskExecution": true, "gpuEnumeration": false, "processEnumeration": false, "stableIdentifiers": false}, "", nil
	default:
		return nil, "CAPABILITY_UNSUPPORTED", fmt.Errorf("unsupported workstation capability %q", capability)
	}
}

func (s *service) publicWorkspaces() []map[string]any {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]map[string]any, 0, len(s.state.Workspaces))
	for _, ws := range s.state.Workspaces {
		out = append(out, publicWorkspace(ws))
	}
	return out
}

func publicWorkspace(ws workspace) map[string]any {
	repos := make([]map[string]any, 0, len(ws.Repositories))
	for _, repo := range ws.Repositories {
		repos = append(repos, map[string]any{"id": repo.ID, "name": repo.Name, "relativePath": repo.RelativePath, "trust": repo.Trust, "addedAt": repo.AddedAt})
	}
	return map[string]any{"id": ws.ID, "name": ws.Name, "rootName": ws.RootName, "projectRefs": ws.ProjectRefs, "repositories": repos, "createdAt": ws.CreatedAt, "updatedAt": ws.UpdatedAt}
}

func (s *service) createWorkspace(p map[string]any) (any, string, error) {
	root := cleanAbsolute(stringFromInput(p, "rootPath"))
	if root == "" {
		return nil, "WORKSPACE_ROOT_REQUIRED", errors.New("A verified local workspace root is required.")
	}
	info, err := os.Stat(root)
	if err != nil || !info.IsDir() {
		return nil, "WORKSPACE_ROOT_INVALID", errors.New("The workspace root is not an accessible directory.")
	}
	name := strings.TrimSpace(stringFromInput(p, "name"))
	if name == "" {
		name = filepath.Base(root)
	}
	now := nowISO()
	ws := workspace{ID: randomID("ws"), Name: name, RootName: filepath.Base(root), RootPath: root, CreatedAt: now, UpdatedAt: now}
	if refs, ok := p["projectRefs"].([]any); ok {
		for _, raw := range refs {
			if m, ok := raw.(map[string]any); ok {
				ws.ProjectRefs = append(ws.ProjectRefs, projectRef{ProfileID: stringFromInput(m, "profileId"), ProjectID: stringFromInput(m, "projectId")})
			}
		}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, current := range s.state.Workspaces {
		if samePath(current.RootPath, root) {
			return map[string]any{"workspace": publicWorkspace(current)}, "", nil
		}
	}
	s.state.Workspaces = append(s.state.Workspaces, ws)
	if err := s.saveStateLocked(); err != nil {
		return nil, "WORKSPACE_STATE_SAVE_FAILED", err
	}
	return map[string]any{"workspace": publicWorkspace(ws)}, "", nil
}

func (s *service) removeWorkspace(p map[string]any) (any, string, error) {
	id := stringFromInput(p, "workspaceId")
	s.mu.Lock()
	defer s.mu.Unlock()
	for i, ws := range s.state.Workspaces {
		if ws.ID == id {
			s.state.Workspaces = append(s.state.Workspaces[:i], s.state.Workspaces[i+1:]...)
			if err := s.saveStateLocked(); err != nil {
				return nil, "WORKSPACE_STATE_SAVE_FAILED", err
			}
			return map[string]any{"removed": true}, "", nil
		}
	}
	return map[string]any{"removed": false}, "", nil
}

func (s *service) discoverRepositories(p map[string]any) (any, string, error) {
	workspaceID := stringFromInput(p, "workspaceId")
	maxDepth := intFromInput(p, "maxDepth", 4)
	if maxDepth < 1 {
		maxDepth = 1
	}
	if maxDepth > 8 {
		maxDepth = 8
	}
	ws, err := s.workspaceByID(workspaceID)
	if err != nil {
		return nil, "WORKSPACE_NOT_FOUND", err
	}
	found := []candidate{}
	rootDepth := strings.Count(filepath.Clean(ws.RootPath), string(os.PathSeparator))
	_ = filepath.WalkDir(ws.RootPath, func(path string, d os.DirEntry, walkErr error) error {
		if walkErr != nil {
			if d != nil && d.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if !d.IsDir() {
			return nil
		}
		rel, _ := filepath.Rel(ws.RootPath, path)
		depth := strings.Count(filepath.Clean(path), string(os.PathSeparator)) - rootDepth
		if depth > maxDepth {
			return filepath.SkipDir
		}
		base := d.Name()
		if path != ws.RootPath && (base == ".git" || base == "node_modules" || base == ".cluster" || base == "DerivedDataCache" || base == "Intermediate" || base == "Saved") {
			return filepath.SkipDir
		}
		if _, err := os.Stat(filepath.Join(path, ".git")); err == nil {
			already := false
			for _, repo := range ws.Repositories {
				if samePath(repo.RootPath, path) {
					already = true
					break
				}
			}
			if !already {
				id := candidateID(workspaceID, path)
				found = append(found, candidate{CandidateID: id, Name: base, RelativePath: cleanRel(rel), RootPath: path, WorkspaceID: workspaceID, ExpiresAt: time.Now().Add(10 * time.Minute)})
			}
			if len(found) >= 64 {
				return filepath.SkipAll
			}
		}
		return nil
	})
	sort.Slice(found, func(i, j int) bool { return found[i].RelativePath < found[j].RelativePath })
	s.mu.Lock()
	for _, c := range found {
		s.candidates[c.CandidateID] = c
	}
	s.mu.Unlock()
	public := make([]map[string]any, 0, len(found))
	for _, c := range found {
		public = append(public, map[string]any{"candidateId": c.CandidateID, "name": c.Name, "relativePath": c.RelativePath})
	}
	return map[string]any{"repositories": public, "expiresInSeconds": 600}, "", nil
}

func candidateID(workspaceID, path string) string {
	sum := sha256.Sum256([]byte(workspaceID + "\x00" + filepath.Clean(path)))
	return "repo-candidate-" + hex.EncodeToString(sum[:12])
}

func (s *service) attachRepository(p map[string]any) (any, string, error) {
	workspaceID, candidateIDValue := stringFromInput(p, "workspaceId"), stringFromInput(p, "candidateId")
	s.mu.Lock()
	defer s.mu.Unlock()
	c, ok := s.candidates[candidateIDValue]
	if !ok || c.WorkspaceID != workspaceID || time.Now().After(c.ExpiresAt) {
		return nil, "REPOSITORY_CANDIDATE_EXPIRED", errors.New("Repository candidate expired; scan the workspace again.")
	}
	for wi := range s.state.Workspaces {
		if s.state.Workspaces[wi].ID == workspaceID {
			ws := &s.state.Workspaces[wi]
			for _, r := range ws.Repositories {
				if samePath(r.RootPath, c.RootPath) {
					return map[string]any{"workspace": publicWorkspace(*ws)}, "", nil
				}
			}
			now := nowISO()
			ws.Repositories = append(ws.Repositories, repository{ID: randomID("repo"), Name: c.Name, RelativePath: c.RelativePath, RootPath: c.RootPath, Trust: "untrusted", AddedAt: now})
			ws.UpdatedAt = now
			if err := s.saveStateLocked(); err != nil {
				return nil, "WORKSPACE_STATE_SAVE_FAILED", err
			}
			delete(s.candidates, candidateIDValue)
			return map[string]any{"workspace": publicWorkspace(*ws)}, "", nil
		}
	}
	return nil, "WORKSPACE_NOT_FOUND", errors.New("Workspace no longer exists.")
}

func (s *service) setRepositoryTrust(p map[string]any) (any, string, error) {
	wsID, repoID := stringFromInput(p, "workspaceId"), stringFromInput(p, "repositoryId")
	trusted := boolFromInput(p, "trusted")
	s.mu.Lock()
	defer s.mu.Unlock()
	for wi := range s.state.Workspaces {
		if s.state.Workspaces[wi].ID != wsID {
			continue
		}
		for ri := range s.state.Workspaces[wi].Repositories {
			if s.state.Workspaces[wi].Repositories[ri].ID == repoID {
				if trusted {
					s.state.Workspaces[wi].Repositories[ri].Trust = "trusted"
				} else {
					s.state.Workspaces[wi].Repositories[ri].Trust = "untrusted"
				}
				s.state.Workspaces[wi].UpdatedAt = nowISO()
				if err := s.saveStateLocked(); err != nil {
					return nil, "WORKSPACE_STATE_SAVE_FAILED", err
				}
				return map[string]any{"workspace": publicWorkspace(s.state.Workspaces[wi])}, "", nil
			}
		}
	}
	return nil, "REPOSITORY_NOT_FOUND", errors.New("Repository is not attached to this workspace.")
}

func (s *service) gitInit(p map[string]any) (any, string, error) {
	ws, err := s.workspaceByID(stringFromInput(p, "workspaceId"))
	if err != nil {
		return nil, "WORKSPACE_NOT_FOUND", err
	}
	if _, err = os.Stat(filepath.Join(ws.RootPath, ".git")); err == nil {
		return s.attachOrReturnRootRepo(ws)
	}
	repo := repository{ID: randomID("repo"), Name: ws.RootName, RelativePath: ".", RootPath: ws.RootPath, Trust: "trusted", AddedAt: nowISO()}
	if _, err := s.git(repo, 20*time.Second, "init", "-b", "main"); err != nil {
		return nil, "GIT_INIT_FAILED", err
	}
	s.mu.Lock()
	for wi := range s.state.Workspaces {
		if s.state.Workspaces[wi].ID == ws.ID {
			s.state.Workspaces[wi].Repositories = append(s.state.Workspaces[wi].Repositories, repo)
			s.state.Workspaces[wi].UpdatedAt = nowISO()
			_ = s.saveStateLocked()
			ws = s.state.Workspaces[wi]
			break
		}
	}
	s.mu.Unlock()
	return map[string]any{"initialized": true, "workspace": publicWorkspace(ws)}, "", nil
}

func (s *service) attachOrReturnRootRepo(ws workspace) (any, string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for wi := range s.state.Workspaces {
		if s.state.Workspaces[wi].ID != ws.ID {
			continue
		}
		for _, r := range s.state.Workspaces[wi].Repositories {
			if samePath(r.RootPath, ws.RootPath) {
				return map[string]any{"initialized": true, "workspace": publicWorkspace(s.state.Workspaces[wi])}, "", nil
			}
		}
		repo := repository{ID: randomID("repo"), Name: ws.RootName, RelativePath: ".", RootPath: ws.RootPath, Trust: "trusted", AddedAt: nowISO()}
		s.state.Workspaces[wi].Repositories = append(s.state.Workspaces[wi].Repositories, repo)
		s.state.Workspaces[wi].UpdatedAt = nowISO()
		if err := s.saveStateLocked(); err != nil {
			return nil, "WORKSPACE_STATE_SAVE_FAILED", err
		}
		return map[string]any{"initialized": true, "workspace": publicWorkspace(s.state.Workspaces[wi])}, "", nil
	}
	return nil, "WORKSPACE_NOT_FOUND", errors.New("Workspace not found.")
}

func (s *service) nativeGitStatus(p map[string]any) (any, string, error) {
	repo, _, err := s.repoFromPayload(p)
	if err != nil {
		return nil, "REPOSITORY_NOT_FOUND", err
	}
	status, code, e := s.nativeStatus(repo)
	return status, code, e
}
func (s *service) nativeGitDetails(p map[string]any) (any, string, error) {
	repo, _, err := s.repoFromPayload(p)
	if err != nil {
		return nil, "REPOSITORY_NOT_FOUND", err
	}
	return s.gitDetails(repo)
}
func (s *service) nativeLFSHealth(p map[string]any) (any, string, error) {
	repo, _, err := s.repoFromPayload(p)
	if err != nil {
		return nil, "REPOSITORY_NOT_FOUND", err
	}
	return s.lfsHealth(repo)
}
func (s *service) nativeLFSPolicy(p map[string]any) (any, string, error) {
	repo, _, err := s.repoFromPayload(p)
	if err != nil {
		return nil, "REPOSITORY_NOT_FOUND", err
	}
	return s.lfsPolicy(repo)
}
func (s *service) nativeDiff(p map[string]any) (any, string, error) {
	repo, _, err := s.repoFromPayload(p)
	if err != nil {
		return nil, "REPOSITORY_NOT_FOUND", err
	}
	path, err := safeRel(stringFromInput(p, "relativePath"))
	if err != nil {
		return nil, "INVALID_PATH", err
	}
	staged := boolFromInput(p, "staged")
	args := []string{"diff", "--no-ext-diff", "--no-color"}
	if staged {
		args = append(args, "--cached")
	}
	args = append(args, "--", path)
	out, e := s.git(repo, 15*time.Second, args...)
	if e != nil {
		return nil, "GIT_DIFF_FAILED", e
	}
	truncated := len(out) > 512*1024
	if truncated {
		out = out[:512*1024]
	}
	return map[string]any{"relativePath": path, "staged": staged, "patch": out, "truncated": truncated, "hunks": []any{}}, "", nil
}

func (s *service) nativeMutate(p map[string]any) (any, string, error) {
	repo, _, err := s.repoFromPayload(p)
	if err != nil {
		return nil, "REPOSITORY_NOT_FOUND", err
	}
	action := stringFromInput(p, "action")
	path, _ := safeRel(stringFromInput(p, "relativePath"))
	var args []string
	switch action {
	case "stage":
		args = []string{"add", "--", path}
	case "unstage":
		args = []string{"restore", "--staged", "--", path}
	case "discard":
		args = []string{"restore", "--", path}
	case "commit":
		args = []string{"commit", "-m", stringFromInput(p, "message")}
	case "amend":
		args = []string{"commit", "--amend", "-m", stringFromInput(p, "message")}
	case "branch.create":
		args = []string{"branch", stringFromInput(p, "name")}
	case "branch.checkout":
		args = []string{"switch", stringFromInput(p, "name")}
	case "branch.delete":
		args = []string{"branch", "-d", stringFromInput(p, "name")}
	case "tag.create":
		args = []string{"tag", stringFromInput(p, "name")}
	case "tag.delete":
		args = []string{"tag", "-d", stringFromInput(p, "name")}
	case "upstream.set":
		args = []string{"branch", "--set-upstream-to", stringFromInput(p, "upstream")}
	case "upstream.unset":
		args = []string{"branch", "--unset-upstream"}
	case "stash.push":
		args = []string{"stash", "push", "-m", stringFromInput(p, "message")}
	case "stash.apply":
		args = []string{"stash", "apply", stringFromInput(p, "stashRef")}
	case "stash.pop":
		args = []string{"stash", "pop", stringFromInput(p, "stashRef")}
	case "stash.drop":
		args = []string{"stash", "drop", stringFromInput(p, "stashRef")}
	case "merge.start":
		args = []string{"merge", stringFromInput(p, "target")}
	case "merge.continue":
		args = []string{"merge", "--continue"}
	case "merge.abort":
		args = []string{"merge", "--abort"}
	case "rebase.start":
		args = []string{"rebase", stringFromInput(p, "target")}
	case "rebase.continue":
		args = []string{"rebase", "--continue"}
	case "rebase.abort":
		args = []string{"rebase", "--abort"}
	case "cherry-pick.start":
		args = []string{"cherry-pick", stringFromInput(p, "target")}
	case "cherry-pick.continue":
		args = []string{"cherry-pick", "--continue"}
	case "cherry-pick.abort":
		args = []string{"cherry-pick", "--abort"}
	case "revert.start":
		args = []string{"revert", stringFromInput(p, "target")}
	case "revert.continue":
		args = []string{"revert", "--continue"}
	case "revert.abort":
		args = []string{"revert", "--abort"}
	case "reset.soft", "reset.mixed", "reset.hard":
		args = []string{"reset", "--" + strings.TrimPrefix(action, "reset."), stringFromInput(p, "target")}
	case "remote.add":
		args = []string{"remote", "add", stringFromInput(p, "remote"), stringFromInput(p, "url")}
	case "remote.remove":
		args = []string{"remote", "remove", stringFromInput(p, "remote")}
	case "remote.rename":
		args = []string{"remote", "rename", stringFromInput(p, "remote"), stringFromInput(p, "nextName")}
	case "remote.set-url":
		args = []string{"remote", "set-url", stringFromInput(p, "remote"), stringFromInput(p, "url")}
	case "lfs.track", "lfs.track-lockable", "lfs.untrack":
		return s.nativeLFSMutate(repo, action, p)
	case "ignore.add", "ignore.remove", "attributes.text", "attributes.binary", "attributes.remove":
		return s.nativePolicyMutation(repo, action, p)
	case "lfs.prune.dry-run":
		out, e := s.git(repo, 30*time.Second, "lfs", "prune", "--dry-run")
		if e != nil {
			return nil, "GIT_LFS_PRUNE_FAILED", e
		}
		return s.nativeMutationResult(repo, action, out)
	case "lfs.prune":
		if !boolFromInput(p, "confirmed") {
			return nil, "CONFIRMATION_REQUIRED", errors.New("LFS prune requires explicit confirmation.")
		}
		out, e := s.git(repo, 60*time.Second, "lfs", "prune")
		if e != nil {
			return nil, "GIT_LFS_PRUNE_FAILED", e
		}
		return s.nativeMutationResult(repo, action, out)
	default:
		return nil, "GIT_MUTATION_UNSUPPORTED", fmt.Errorf("unsupported Git mutation %q", action)
	}
	if len(args) == 0 {
		return nil, "GIT_MUTATION_INVALID", errors.New("Git mutation arguments were empty.")
	}
	out, e := s.git(repo, 45*time.Second, args...)
	if e != nil {
		return nil, "GIT_MUTATION_FAILED", e
	}
	return s.nativeMutationResult(repo, action, out)
}

func (s *service) nativeMutationResult(repo repository, action, message string) (any, string, error) {
	status, _, err := s.nativeStatus(repo)
	if err != nil {
		return nil, "GIT_STATUS_FAILED", err
	}
	details, _, err := s.gitDetails(repo)
	if err != nil {
		return nil, "GIT_DETAILS_FAILED", err
	}
	return map[string]any{"ok": true, "action": action, "message": strings.TrimSpace(message), "status": status, "details": details}, "", nil
}

func (s *service) nativeClone(p map[string]any) (any, string, error) {
	ws, err := s.workspaceByID(stringFromInput(p, "workspaceId"))
	if err != nil {
		return nil, "WORKSPACE_NOT_FOUND", err
	}
	remote := strings.TrimSpace(stringFromInput(p, "remote"))
	name := strings.TrimSpace(stringFromInput(p, "destinationName"))
	if remote == "" || name == "" || strings.ContainsAny(name, "/\\") {
		return nil, "CLONE_INPUT_INVALID", errors.New("Remote and simple destination name are required.")
	}
	target := filepath.Join(ws.RootPath, name)
	if !pathInside(ws.RootPath, target) {
		return nil, "CLONE_DESTINATION_INVALID", errors.New("Clone destination must remain inside the approved workspace.")
	}
	op := s.startOperation("git.clone", ws.ID, "", name, func(ctx context.Context, report operationProgressReporter) (any, error) {
		report("planning", "Preparing clone", 10)
		args := []string{"clone", "--progress"}
		strategy := stringFromInput(p, "strategy")
		if strategy == "current" {
			args = append(args, "--filter=blob:none")
		} else if strategy == "lightweight" {
			args = append(args, "--depth=1", "--filter=blob:none")
		}
		args = append(args, remote, target)
		report("cloning", "Cloning repository", 30)
		out, err := s.runGitCommand(ctx, ws.RootPath, args...)
		if err != nil {
			return nil, fmt.Errorf("git clone failed: %w: %s", err, tail(out, 4000))
		}
		report("registering", "Registering trusted repository", 88)
		repo := repository{ID: randomID("repo"), Name: name, RelativePath: name, RootPath: target, Trust: "trusted", AddedAt: nowISO()}
		s.mu.Lock()
		for wi := range s.state.Workspaces {
			if s.state.Workspaces[wi].ID == ws.ID {
				s.state.Workspaces[wi].Repositories = append(s.state.Workspaces[wi].Repositories, repo)
				s.state.Workspaces[wi].UpdatedAt = nowISO()
				_ = s.saveStateLocked()
				break
			}
		}
		s.mu.Unlock()
		report("finalizing", "Finalizing repository", 96)
		return map[string]any{"repositoryId": repo.ID, "cloneStrategy": strategy}, nil
	})
	return map[string]any{"operation": op}, "", nil
}

func (s *service) nativeOperationStart(p map[string]any) (any, string, error) {
	repo, ws, err := s.repoFromPayload(p)
	if err != nil {
		return nil, "REPOSITORY_NOT_FOUND", err
	}
	action := stringFromInput(p, "action")
	rel, _ := safeRel(stringFromInput(p, "relativePath"))
	kind := "git." + action
	op := s.startOperation(kind, ws.ID, repo.ID, repo.Name, func(ctx context.Context, report operationProgressReporter) (any, error) {
		var args []string
		switch action {
		case "fetch":
			report("fetching", "Fetching remote refs", 25)
			args = []string{"fetch", "--prune"}
		case "pull":
			report("pulling", "Fast-forwarding from upstream", 25)
			args = []string{"pull", "--ff-only"}
		case "push":
			report("pushing", "Publishing local commits", 25)
			args = []string{"push"}
		case "lfs.fetch.current":
			report("lfs-fetch", "Fetching current LFS objects", 25)
			args = []string{"lfs", "fetch", "--recent"}
		case "lfs.fetch.recent":
			report("lfs-fetch", "Fetching recent LFS objects", 25)
			args = []string{"lfs", "fetch", "--recent"}
		case "lfs.checkout":
			report("lfs-checkout", "Hydrating LFS working tree", 25)
			args = []string{"lfs", "checkout"}
		case "lfs.locks":
			report("lfs-locks", "Reading remote LFS locks", 30)
			out, err := s.runGitCommand(ctx, repo.RootPath, "lfs", "locks", "--json")
			if err != nil {
				return nil, fmt.Errorf("git lfs locks failed: %w: %s", err, tail(out, 2000))
			}
			var result any
			if json.Unmarshal([]byte(out), &result) != nil {
				result = map[string]any{"raw": out}
			}
			return map[string]any{"lfsLocks": result}, nil
		case "lfs.lock":
			report("lfs-lock", "Acquiring LFS lock", 30)
			if rel == "" {
				return nil, errors.New("LFS lock path is required")
			}
			args = []string{"lfs", "lock", rel}
		case "lfs.unlock":
			report("lfs-unlock", "Releasing LFS lock", 30)
			if rel == "" {
				return nil, errors.New("LFS unlock path is required")
			}
			args = []string{"lfs", "unlock", rel}
		default:
			return nil, fmt.Errorf("unsupported background operation %q", action)
		}
		out, err := s.runGitCommand(ctx, repo.RootPath, args...)
		if err != nil {
			return nil, fmt.Errorf("Git operation failed: %w: %s", err, tail(out, 4000))
		}
		report("finalizing", "Refreshing repository state", 92)
		return map[string]any{"output": tail(out, 8000)}, nil
	})
	return map[string]any{"operation": op}, "", nil
}

func (s *service) nativeOperationCancel(p map[string]any) (any, string, error) {
	id := stringFromInput(p, "operationId")
	s.mu.Lock()
	defer s.mu.Unlock()
	op := s.operations[id]
	if op == nil {
		return map[string]any{"cancelled": false}, "", nil
	}
	if op.cancel != nil {
		op.State = "cancelling"
		op.Status = "running"
		op.UpdatedAt = nowISO()
		op.cancel()
		return map[string]any{"cancelled": true}, "", nil
	}
	return map[string]any{"cancelled": false}, "", nil
}

type operationProgressReporter func(stage, message string, progress int)

func (s *service) startOperation(kind, wsID, repoID, label string, fn func(context.Context, operationProgressReporter) (any, error)) *operation {
	now := nowISO()
	id := randomID("op")
	ctx, cancel := context.WithCancel(context.Background())
	op := &operation{Schema: 2, ID: id, Kind: kind, State: "queued", Stage: "queued", WorkspaceID: wsID, RepositoryID: repoID, TargetLabel: label, StartedAt: now, UpdatedAt: now, Logs: []string{}, Type: kind, Queue: "workstation", Status: "queued", Trace: map[string]any{"correlationId": id}, Priority: 10, CostUnits: 2, Progress: 0, Attempts: 0, MaxAttempts: 1, RunAfter: now, CreatedAt: now, cancel: cancel}
	s.mu.Lock()
	s.operations[id] = op
	s.mu.Unlock()
	go func() {
		report := func(stage, message string, progress int) {
			if progress < 0 {
				progress = 0
			}
			if progress > 99 {
				progress = 99
			}
			s.updateOperation(id, func(o *operation) {
				o.State = "running"
				o.Status = "running"
				o.Stage = stage
				o.Progress = progress
				o.Percent = progress
				o.ProgressMessage = message
				o.Attempts = 1
			})
		}
		report("starting", "Preparing operation", 5)
		result, err := fn(ctx, report)
		s.updateOperation(id, func(o *operation) {
			done := nowISO()
			o.UpdatedAt = done
			o.CompletedAt = done
			o.FinishedAt = done
			o.cancel = nil
			if errors.Is(err, context.Canceled) {
				o.State = "cancelled"
				o.Status = "cancelled"
				o.Stage = "cancelled"
				o.ProgressMessage = "Operation cancelled"
				o.LastError = "Operation cancelled"
				return
			}
			if err != nil {
				o.State = "failed"
				o.Status = "failed"
				o.Stage = "failed"
				o.ProgressMessage = "Operation failed"
				o.LastError = err.Error()
				o.Logs = append(o.Logs, tail(err.Error(), 4000))
				return
			}
			o.State = "succeeded"
			o.Status = "succeeded"
			o.Stage = "complete"
			o.Progress = 100
			o.Percent = 100
			o.ProgressMessage = "Complete"
			o.Result = result
		})
	}()
	return cloneOperation(op)
}
func (s *service) updateOperation(id string, fn func(*operation)) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if op := s.operations[id]; op != nil {
		fn(op)
		op.UpdatedAt = nowISO()
	}
}
func (s *service) operationSnapshots() []*operation {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]*operation, 0, len(s.operations))
	for _, op := range s.operations {
		out = append(out, cloneOperation(op))
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt > out[j].CreatedAt })
	if len(out) > 100 {
		out = out[:100]
	}
	return out
}
func cloneOperation(op *operation) *operation {
	if op == nil {
		return nil
	}
	copy := *op
	copy.cancel = nil
	copy.Logs = append([]string{}, op.Logs...)
	return &copy
}

func (s *service) workspaceByID(id string) (workspace, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, ws := range s.state.Workspaces {
		if ws.ID == id {
			return ws, nil
		}
	}
	return workspace{}, errors.New("workspace not found")
}
func (s *service) repositoryByID(id string) (repository, workspace, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, ws := range s.state.Workspaces {
		for _, repo := range ws.Repositories {
			if repo.ID == id {
				return repo, ws, nil
			}
		}
	}
	return repository{}, workspace{}, errors.New("repository not found")
}
func (s *service) repoFromPayload(p map[string]any) (repository, workspace, error) {
	repo, ws, err := s.repositoryByID(stringFromInput(p, "repositoryId"))
	if err != nil {
		return repository{}, workspace{}, err
	}
	if reqWs := stringFromInput(p, "workspaceId"); reqWs != "" && reqWs != ws.ID {
		return repository{}, workspace{}, errors.New("repository does not belong to requested workspace")
	}
	if repo.Trust != "trusted" {
		return repository{}, workspace{}, errors.New("repository is not trusted")
	}
	return repo, ws, nil
}

func (s *service) git(repo repository, timeout time.Duration, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	out, err := s.runGitCommand(ctx, repo.RootPath, args...)
	if errors.Is(ctx.Err(), context.DeadlineExceeded) {
		return out, fmt.Errorf("Git command timed out")
	}
	if err != nil {
		return out, fmt.Errorf("%w: %s", err, tail(out, 4000))
	}
	return out, nil
}
func runCommand(ctx context.Context, dir, name string, env []string, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.Dir = dir
	cmd.Env = env
	if runtime.GOOS == "windows" {
		cmd.SysProcAttr = &syscall.SysProcAttr{}
	}
	out, err := cmd.CombinedOutput()
	return string(out), err
}

func (s *service) nativeStatus(repo repository) (any, string, error) {
	version, err := s.git(repo, 5*time.Second, "--version")
	if err != nil {
		return nil, "GIT_UNAVAILABLE", err
	}
	branchOut, _ := s.git(repo, 5*time.Second, "rev-parse", "--abbrev-ref", "HEAD")
	branch := strings.TrimSpace(branchOut)
	detached := branch == "HEAD" || branch == ""
	upstreamOut, _ := s.git(repo, 5*time.Second, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}")
	upstream := strings.TrimSpace(upstreamOut)
	ahead, behind := 0, 0
	if upstream != "" {
		counts, _ := s.git(repo, 5*time.Second, "rev-list", "--left-right", "--count", "HEAD...@{u}")
		parts := strings.Fields(counts)
		if len(parts) == 2 {
			ahead, _ = strconv.Atoi(parts[0])
			behind, _ = strconv.Atoi(parts[1])
		}
	}
	statusOut, _ := s.git(repo, 8*time.Second, "status", "--porcelain")
	changed := 0
	if strings.TrimSpace(statusOut) != "" {
		changed = len(strings.Split(strings.TrimSpace(statusOut), "\n"))
	}
	remotesOut, _ := s.git(repo, 5*time.Second, "remote")
	remotes := nonEmptyLines(remotesOut)
	return map[string]any{"available": true, "version": strings.TrimSpace(version), "branch": branch, "detached": detached, "upstream": nilIfEmpty(upstream), "ahead": ahead, "behind": behind, "changedFiles": changed, "clean": changed == 0, "remotes": remotes}, "", nil
}

func (s *service) gitDetails(repo repository) (any, string, error) {
	branchesOut, _ := s.git(repo, 8*time.Second, "for-each-ref", "--format=%(refname:short)%09%(HEAD)%09%(upstream:short)", "refs/heads")
	branches := []map[string]any{}
	for _, line := range nonEmptyLines(branchesOut) {
		parts := strings.Split(line, "\t")
		if len(parts) > 0 {
			b := map[string]any{"name": parts[0], "current": len(parts) > 1 && strings.TrimSpace(parts[1]) == "*"}
			if len(parts) > 2 && parts[2] != "" {
				b["upstream"] = parts[2]
			}
			branches = append(branches, b)
		}
	}
	tagsOut, _ := s.git(repo, 5*time.Second, "tag", "--list")
	tags := nonEmptyLines(tagsOut)
	historyOut, _ := s.git(repo, 8*time.Second, "log", "-30", "--date=iso-strict", "--pretty=format:%H%x09%h%x09%an%x09%aI%x09%s")
	history := []map[string]any{}
	for _, line := range nonEmptyLines(historyOut) {
		p := strings.SplitN(line, "\t", 5)
		if len(p) == 5 {
			history = append(history, map[string]any{"sha": p[0], "shortSha": p[1], "author": p[2], "authoredAt": p[3], "subject": p[4]})
		}
	}
	changesOut, _ := s.git(repo, 8*time.Second, "status", "--porcelain")
	changes := []map[string]any{}
	conflicts := []string{}
	for _, line := range nonEmptyLines(changesOut) {
		if len(line) < 3 {
			continue
		}
		state := strings.TrimSpace(line[:2])
		path := strings.TrimSpace(line[3:])
		changes = append(changes, map[string]any{"state": state, "relativePath": path})
		if strings.Contains(state, "U") || state == "AA" || state == "DD" {
			conflicts = append(conflicts, path)
		}
	}
	diffStat, _ := s.git(repo, 8*time.Second, "diff", "--stat")
	stashOut, _ := s.git(repo, 5*time.Second, "stash", "list", "--format=%gd%x09%H%x09%s")
	stashes := []map[string]any{}
	for _, line := range nonEmptyLines(stashOut) {
		p := strings.SplitN(line, "\t", 3)
		if len(p) == 3 {
			stashes = append(stashes, map[string]any{"ref": p[0], "sha": p[1], "subject": p[2]})
		}
	}
	remoteOut, _ := s.git(repo, 5*time.Second, "remote", "-v")
	remotes := []map[string]any{}
	seen := map[string]bool{}
	for _, line := range nonEmptyLines(remoteOut) {
		f := strings.Fields(line)
		if len(f) >= 2 && !seen[f[0]] {
			seen[f[0]] = true
			remotes = append(remotes, map[string]any{"name": f[0], "url": f[1]})
		}
	}
	recovery := recoveryState(repo, len(conflicts))
	return map[string]any{"branches": branches, "tags": tags, "upstreams": []any{}, "history": history, "graph": []any{}, "changes": changes, "conflicts": conflicts, "diffStat": diffStat, "stashes": stashes, "remotes": remotes, "recovery": recovery, "signing": map[string]any{"commitSigningEnabled": false, "tagSigningEnabled": false, "signingKeyConfigured": false, "headStatus": "unknown"}, "layout": map[string]any{"worktreeCount": 1, "worktreeBranches": []any{}, "submodules": []any{}, "sparseCheckout": false, "sparsePatterns": []any{}, "partialClone": false}, "policy": s.policyState(repo)}, "", nil
}

func recoveryState(repo repository, conflicts int) map[string]any {
	gitDir := filepath.Join(repo.RootPath, ".git")
	op := "none"
	if exists(filepath.Join(gitDir, "MERGE_HEAD")) {
		op = "merge"
	} else if exists(filepath.Join(gitDir, "rebase-merge")) || exists(filepath.Join(gitDir, "rebase-apply")) {
		op = "rebase"
	} else if exists(filepath.Join(gitDir, "CHERRY_PICK_HEAD")) {
		op = "cherry-pick"
	} else if exists(filepath.Join(gitDir, "REVERT_HEAD")) {
		op = "revert"
	}
	return map[string]any{"operation": op, "inProgress": op != "none", "conflictCount": conflicts, "canContinue": op != "none" && conflicts == 0, "canAbort": op != "none"}
}
func exists(path string) bool { _, err := os.Stat(path); return err == nil }

const maxSecretScanBytes = 4 << 20

type secretRule struct {
	name     string
	severity string
	message  string
	pattern  *regexp.Regexp
}

var secretRules = []secretRule{
	{name: "private-key", severity: "block", message: "Private-key material detected in an added line.", pattern: regexp.MustCompile(`(?i)-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----`)},
	{name: "aws-access-key", severity: "block", message: "AWS-style access key detected in an added line.", pattern: regexp.MustCompile(`\b(?:AKIA|ASIA)[0-9A-Z]{16}\b`)},
	{name: "github-token", severity: "block", message: "GitHub-style access token detected in an added line.", pattern: regexp.MustCompile(`\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b`)},
	{name: "discord-token", severity: "block", message: "Discord-style bot/user token detected in an added line.", pattern: regexp.MustCompile(`\b[A-Za-z0-9_-]{20,30}\.[A-Za-z0-9_-]{5,10}\.[A-Za-z0-9_-]{20,}\b`)},
	{name: "generic-secret-assignment", severity: "warning", message: "Credential-like value assigned in an added line; review before publishing.", pattern: regexp.MustCompile(`(?i)\b(?:password|passwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret)\b\s*[:=]\s*["']?[^\s"']{8,}`)},
}

func (s *service) nativeSecretScan(p map[string]any) (any, string, error) {
	repo, _, err := s.repoFromPayload(p)
	if err != nil {
		return nil, "REPOSITORY_UNAVAILABLE", err
	}
	scope := strings.ToLower(stringFromInput(p, "scope"))
	var args []string
	commitsScanned := 0
	switch scope {
	case "staged":
		args = []string{"diff", "--cached", "--unified=0", "--no-ext-diff", "--no-color", "--no-renames"}
	case "outgoing":
		if _, upstreamErr := s.git(repo, 5*time.Second, "rev-parse", "--verify", "@{u}"); upstreamErr != nil {
			return nil, "GIT_UPSTREAM_REQUIRED", errors.New("outgoing secret scan requires a configured upstream branch")
		}
		countOut, countErr := s.git(repo, 5*time.Second, "rev-list", "--count", "@{u}..HEAD")
		if countErr != nil {
			return nil, "GIT_SCAN_FAILED", countErr
		}
		commitsScanned, _ = strconv.Atoi(strings.TrimSpace(countOut))
		args = []string{"diff", "--unified=0", "--no-ext-diff", "--no-color", "--no-renames", "@{u}..HEAD"}
	default:
		return nil, "SECRET_SCAN_SCOPE_INVALID", errors.New("secret scan scope must be staged or outgoing")
	}
	diff, diffErr := s.git(repo, 20*time.Second, args...)
	if diffErr != nil {
		return nil, "GIT_SCAN_FAILED", diffErr
	}
	if len(diff) > maxSecretScanBytes {
		return nil, "SECRET_SCAN_TOO_LARGE", fmt.Errorf("added diff exceeds the %d MiB safety limit", maxSecretScanBytes/(1<<20))
	}

	findings := []map[string]any{}
	blockCount, warningCount, addedLines, scannedBytes := 0, 0, 0, 0
	currentPath := ""
	newLine := 0
	hunkPattern := regexp.MustCompile(`^@@ -(?:\d+)(?:,\d+)? \+(\d+)(?:,(\d+))? @@`)
	for _, line := range strings.Split(diff, "\n") {
		if strings.HasPrefix(line, "+++ ") {
			raw := strings.TrimSpace(strings.TrimPrefix(line, "+++ "))
			if raw == "/dev/null" {
				currentPath = ""
			} else {
				currentPath = strings.TrimPrefix(raw, "b/")
			}
			continue
		}
		if match := hunkPattern.FindStringSubmatch(line); len(match) > 1 {
			newLine, _ = strconv.Atoi(match[1])
			continue
		}
		if strings.HasPrefix(line, "+") && !strings.HasPrefix(line, "+++") {
			content := strings.TrimPrefix(line, "+")
			addedLines++
			scannedBytes += len(content)
			for _, rule := range secretRules {
				if !rule.pattern.MatchString(content) {
					continue
				}
				if rule.severity == "block" {
					blockCount++
				} else {
					warningCount++
				}
				findings = append(findings, map[string]any{"severity": rule.severity, "rule": rule.name, "path": currentPath, "line": newLine, "message": rule.message})
			}
			newLine++
			continue
		}
		if strings.HasPrefix(line, " ") {
			newLine++
		}
	}

	scan := map[string]any{
		"schema": 1, "scope": scope, "ok": blockCount == 0, "blocked": blockCount > 0,
		"blockCount": blockCount, "warningCount": warningCount, "findingCount": len(findings),
		"scannedAddedLines": addedLines, "scannedBytes": scannedBytes, "commitsScanned": commitsScanned, "findings": findings,
	}
	return map[string]any{"scan": scan}, "", nil
}

func (s *service) lfsHealth(repo repository) (any, string, error) {
	version, err := s.git(repo, 5*time.Second, "lfs", "version")
	if err != nil {
		return map[string]any{"installed": false, "healthy": false, "message": "Git LFS is not available."}, "", nil
	}
	envOut, _ := s.git(repo, 8*time.Second, "lfs", "env")
	endpoint := strings.Contains(envOut, "Endpoint=")
	return map[string]any{"installed": true, "healthy": true, "version": strings.TrimSpace(version), "endpointConfigured": endpoint, "localMediaConfigured": exists(filepath.Join(repo.RootPath, ".git", "lfs")), "message": "Git LFS is available."}, "", nil
}
func (s *service) lfsPolicy(repo repository) (any, string, error) {
	patterns, lockable := readAttributes(repo)
	_, lfsErr := s.git(repo, 5*time.Second, "lfs", "version")
	installed := lfsErr == nil
	message := "Policy read from .gitattributes."
	if !installed {
		message = "Git LFS is not installed; .gitattributes policy was read but LFS operations are unavailable."
	}
	return map[string]any{"installed": installed, "patterns": patterns, "lockablePatterns": lockable, "largeFiles": []any{}, "largeFileThresholdBytes": 50 * 1024 * 1024, "message": message}, "", nil
}
func readAttributes(repo repository) ([]string, []string) {
	data, _ := os.ReadFile(filepath.Join(repo.RootPath, ".gitattributes"))
	patterns := []string{}
	locks := []string{}
	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		f := strings.Fields(line)
		if len(f) < 2 {
			continue
		}
		if strings.Contains(line, "filter=lfs") {
			patterns = append(patterns, f[0])
		}
		if strings.Contains(line, "lockable") {
			locks = append(locks, f[0])
		}
	}
	return uniqueStrings(patterns), uniqueStrings(locks)
}
func commandAvailable(name string) bool { _, err := exec.LookPath(name); return err == nil }

func pathWithin(root, target string) bool {
	root = filepath.Clean(root)
	target = filepath.Clean(target)
	rel, err := filepath.Rel(root, target)
	if err != nil {
		return false
	}
	return rel == "." || (rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)))
}

func (s *service) resolveSourceRepository(input map[string]any) (any, string, error) {
	projectPath := strings.TrimSpace(stringFromInput(input, "projectPath"))
	if projectPath == "" {
		return nil, "PROJECT_PATH_REQUIRED", errors.New("Project path is required to resolve the Cluster Workstation repository.")
	}
	absProject, err := filepath.Abs(projectPath)
	if err != nil {
		return nil, "PROJECT_PATH_INVALID", errors.New("Project path is invalid.")
	}
	absProject = filepath.Clean(absProject)

	s.mu.RLock()
	defer s.mu.RUnlock()
	type match struct {
		workspace  workspace
		repository repository
		relative   string
	}
	matches := []match{}
	for _, ws := range s.state.Workspaces {
		for _, repo := range ws.Repositories {
			if repo.Trust != "trusted" || !pathWithin(repo.RootPath, absProject) {
				continue
			}
			rel, relErr := filepath.Rel(repo.RootPath, absProject)
			if relErr != nil {
				continue
			}
			matches = append(matches, match{workspace: ws, repository: repo, relative: filepath.ToSlash(rel)})
		}
	}
	if len(matches) == 0 {
		return nil, "REPOSITORY_NOT_FOUND", errors.New("No trusted Cluster Desktop repository contains this Unreal project.")
	}
	sort.Slice(matches, func(i, j int) bool { return len(matches[i].repository.RootPath) > len(matches[j].repository.RootPath) })
	selected := matches[0]
	if selected.relative == "." {
		selected.relative = ""
	}
	return map[string]any{
		"schema":                1,
		"repositoryId":          selected.repository.ID,
		"workspaceId":           selected.workspace.ID,
		"displayName":           selected.repository.Name,
		"provider":              "git",
		"projectRelativePrefix": selected.relative,
		"trusted":               true,
	}, "", nil
}

func (s *service) sourceRepositoryStatus(ws workspace, repo repository) (any, string, error) {
	native, code, err := s.nativeStatus(repo)
	if err != nil {
		return nil, code, err
	}
	m := native.(map[string]any)
	policy, _, _ := s.lfsPolicy(repo)
	lfs, _, _ := s.lfsHealth(repo)
	pm := policy.(map[string]any)
	lm := lfs.(map[string]any)
	details, _, _ := s.gitDetails(repo)
	conflicts := len(details.(map[string]any)["conflicts"].([]string))
	return map[string]any{"schema": 1, "repositoryId": repo.ID, "workspaceId": ws.ID, "displayName": repo.Name, "provider": "git", "branch": m["branch"], "detached": m["detached"], "upstream": m["upstream"], "ahead": m["ahead"], "behind": m["behind"], "changedFiles": m["changedFiles"], "conflicts": conflicts, "clean": m["clean"], "lfsAvailable": lm["installed"], "lockablePatterns": pm["lockablePatterns"], "remotes": details.(map[string]any)["remotes"], "updatedAt": nowISO()}, "", nil
}

func (s *service) sourceOperationStart(ws workspace, repo repository, paths []string, input map[string]any) (any, string, error) {
	action := stringFromInput(input, "action")
	if action != "repository.sync" && action != "changes.commit" {
		return nil, "OPERATION_ACTION_INVALID", fmt.Errorf("unsupported source-control background action %q", action)
	}
	label := repo.Name
	op := s.startOperation("source-control."+action, ws.ID, repo.ID, label, func(ctx context.Context, report operationProgressReporter) (any, error) {
		switch action {
		case "repository.sync":
			mode := stringFromInput(input, "mode")
			if mode == "" {
				mode = "fetch"
			}
			var args []string
			switch mode {
			case "fetch":
				report("fetching", "Fetching remote refs", 25)
				args = []string{"fetch", "--prune"}
			case "pull":
				report("pulling", "Fast-forwarding from upstream", 25)
				args = []string{"pull", "--ff-only"}
			case "push":
				report("pushing", "Publishing local commits", 25)
				args = []string{"push"}
			default:
				return nil, fmt.Errorf("unsupported sync mode %q", mode)
			}
			out, err := s.runGitCommand(ctx, repo.RootPath, args...)
			if err != nil {
				return nil, fmt.Errorf("Git sync failed: %w: %s", err, tail(out, 4000))
			}
			report("finalizing", "Refreshing source-control state", 92)
			return map[string]any{"mode": mode, "output": tail(out, 8000)}, nil
		case "changes.commit":
			message := strings.TrimSpace(stringFromInput(input, "message"))
			if message == "" {
				return nil, errors.New("Commit message is required")
			}
			safe := safePaths(paths)
			if len(safe) > 0 {
				report("staging", "Staging selected files", 20)
				out, err := s.runGitCommand(ctx, repo.RootPath, append([]string{"add", "--"}, safe...)...)
				if err != nil {
					return nil, fmt.Errorf("Git add failed: %w: %s", err, tail(out, 4000))
				}
			}
			report("committing", "Creating commit", 55)
			out, err := s.runGitCommand(ctx, repo.RootPath, "commit", "-m", message)
			if err != nil {
				return nil, fmt.Errorf("Git commit failed: %w: %s", err, tail(out, 4000))
			}
			if boolFromInput(input, "push") {
				report("pushing", "Publishing commit", 78)
				pushOut, pushErr := s.runGitCommand(ctx, repo.RootPath, "push")
				if pushErr != nil {
					return nil, fmt.Errorf("Git push failed after commit: %w: %s", pushErr, tail(pushOut, 4000))
				}
			}
			report("finalizing", "Resolving committed revision", 94)
			shaOut, _ := s.runGitCommand(ctx, repo.RootPath, "rev-parse", "HEAD")
			return map[string]any{"committed": true, "revision": strings.TrimSpace(shaOut), "output": tail(out, 4000)}, nil
		}
		return nil, errors.New("Unsupported source-control operation")
	})
	return map[string]any{"operation": op}, "", nil
}

func (s *service) sourceOperationStatus(repo repository, input map[string]any) (any, string, error) {
	id := stringFromInput(input, "operationId")
	if id == "" {
		return nil, "OPERATION_ID_REQUIRED", errors.New("Operation ID is required.")
	}
	s.mu.RLock()
	op := s.operations[id]
	if op != nil {
		op = cloneOperation(op)
	}
	s.mu.RUnlock()
	if op == nil || op.RepositoryID != repo.ID {
		return nil, "OPERATION_NOT_FOUND", errors.New("Source-control operation not found.")
	}
	return map[string]any{"operation": op}, "", nil
}

func (s *service) sourceOperationCancel(repo repository, input map[string]any) (any, string, error) {
	id := stringFromInput(input, "operationId")
	if id == "" {
		return nil, "OPERATION_ID_REQUIRED", errors.New("Operation ID is required.")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	op := s.operations[id]
	if op == nil || op.RepositoryID != repo.ID {
		return nil, "OPERATION_NOT_FOUND", errors.New("Source-control operation not found.")
	}
	if op.cancel == nil || op.State == "succeeded" || op.State == "failed" || op.State == "cancelled" {
		return map[string]any{"cancelled": false, "operation": cloneOperation(op)}, "", nil
	}
	op.State = "cancelling"
	op.Stage = "cancelling"
	op.ProgressMessage = "Cancellation requested"
	op.UpdatedAt = nowISO()
	op.cancel()
	return map[string]any{"cancelled": true, "operation": cloneOperation(op)}, "", nil
}

func (s *service) sourceHistory(repo repository, paths []string, limit int) (any, string, error) {
	if limit < 1 {
		limit = 30
	}
	if limit > 100 {
		limit = 100
	}
	args := []string{"log", fmt.Sprintf("-%d", limit), "--date=iso-strict", "--pretty=format:%H%x09%h%x09%an%x09%aI%x09%s"}
	safe := safePaths(paths)
	if len(safe) == 1 {
		args = append(args, "--follow", "--", safe[0])
	} else if len(safe) > 1 {
		args = append(args, "--")
		args = append(args, safe...)
	}
	out, err := s.git(repo, 8*time.Second, args...)
	if err != nil {
		return nil, "GIT_HISTORY_FAILED", err
	}
	entries := []map[string]any{}
	for _, line := range nonEmptyLines(out) {
		p := strings.SplitN(line, "\t", 5)
		if len(p) == 5 {
			entries = append(entries, map[string]any{"revision": p[0], "shortRevision": p[1], "author": p[2], "authoredAt": p[3], "summary": p[4]})
		}
	}
	return entries, "", nil
}
func (s *service) sourceFileStates(repo repository, filter []string) (any, string, error) {
	out, err := s.git(repo, 10*time.Second, "status", "--porcelain=v1", "--untracked-files=all")
	if err != nil {
		return nil, "GIT_STATUS_FAILED", err
	}
	requested := safePaths(filter)
	want := map[string]bool{}
	for _, p := range requested {
		want[filepath.ToSlash(p)] = true
	}

	locksByPath := map[string]map[string]any{}
	if rawLocks, _, lockErr := s.lfsLocks(repo); lockErr == nil {
		if locks, ok := rawLocks.([]map[string]any); ok {
			for _, lock := range locks {
				path := filepath.ToSlash(strings.TrimSpace(fmt.Sprint(lock["path"])))
				if path != "" {
					locksByPath[path] = lock
				}
			}
		}
	}

	attributes := readAttributesSimple(repo)
	stateByPath := map[string]map[string]any{}
	for _, line := range nonEmptyLines(out) {
		if len(line) < 3 {
			continue
		}
		xy := line[:2]
		path := strings.TrimSpace(line[3:])
		if strings.Contains(path, " -> ") {
			parts := strings.SplitN(path, " -> ", 2)
			path = parts[1]
		}
		path = filepath.ToSlash(path)
		if len(want) > 0 && !want[path] {
			continue
		}
		state := "modified"
		switch {
		case xy == "??":
			state = "untracked"
		case strings.Contains(xy, "U") || xy == "AA" || xy == "DD":
			state = "conflicted"
		case strings.Contains(xy, "A"):
			state = "added"
		case strings.Contains(xy, "D"):
			state = "deleted"
		case strings.Contains(xy, "R"):
			state = "renamed"
		}
		binary := isBinaryAsset(path)
		lockable := binary || matchesLockable(path, attributes)
		stateByPath[path] = map[string]any{"path": path, "state": state, "staged": xy[0] != ' ' && xy[0] != '?', "tracked": xy != "??", "ignored": false, "binary": binary, "lockable": lockable, "lock": locksByPath[path]}
	}

	// Unreal asks state for clean assets too. Preserve one result per requested path
	// instead of silently omitting clean files from the response.
	if len(requested) > 0 {
		trackedOut, _ := s.git(repo, 8*time.Second, append([]string{"ls-files", "--"}, requested...)...)
		tracked := map[string]bool{}
		for _, line := range nonEmptyLines(trackedOut) {
			tracked[filepath.ToSlash(strings.TrimSpace(line))] = true
		}
		for _, raw := range requested {
			path := filepath.ToSlash(raw)
			if _, exists := stateByPath[path]; exists {
				continue
			}
			ignored := false
			if _, checkErr := s.git(repo, 3*time.Second, "check-ignore", "-q", "--", raw); checkErr == nil {
				ignored = true
			}
			binary := isBinaryAsset(path)
			lockable := binary || matchesLockable(path, attributes)
			state := "untracked"
			if tracked[path] {
				state = "clean"
			} else if ignored {
				state = "ignored"
			}
			stateByPath[path] = map[string]any{"path": path, "state": state, "staged": false, "tracked": tracked[path], "ignored": ignored, "binary": binary, "lockable": lockable, "lock": locksByPath[path]}
		}
	}

	states := make([]map[string]any, 0, len(stateByPath))
	for _, state := range stateByPath {
		states = append(states, state)
	}
	sort.Slice(states, func(i, j int) bool { return fmt.Sprint(states[i]["path"]) < fmt.Sprint(states[j]["path"]) })
	return states, "", nil
}
func readAttributesSimple(repo repository) []string { _, locks := readAttributes(repo); return locks }
func isBinaryAsset(path string) bool {
	ext := strings.ToLower(filepath.Ext(path))
	switch ext {
	case ".uasset", ".umap", ".fbx", ".blend", ".psd", ".wav", ".mp4", ".mov", ".png", ".jpg", ".jpeg", ".exr":
		return true
	}
	return false
}
func matchesLockable(path string, patterns []string) bool {
	for _, p := range patterns {
		if ok, _ := filepath.Match(p, filepath.Base(path)); ok {
			return true
		}
		if ok, _ := filepath.Match(p, path); ok {
			return true
		}
	}
	return false
}
func validGitRevision(value string) bool {
	value = strings.TrimSpace(value)
	if value == "" {
		return false
	}
	if strings.HasPrefix(value, "-") || strings.ContainsAny(value, "\r\n\t ") {
		return false
	}
	if len(value) > 200 {
		return false
	}
	return regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._/@{}~^:+-]*$`).MatchString(value)
}

func (s *service) sourceRevisionMaterialize(repo repository, paths []string, input map[string]any) (any, string, error) {
	safe := safePaths(paths)
	if len(safe) != 1 {
		return nil, "REVISION_PATH_REQUIRED", errors.New("Exactly one repository-relative path is required to materialize a revision.")
	}
	revision := strings.TrimSpace(stringFromInput(input, "revision"))
	if !validGitRevision(revision) {
		return nil, "GIT_REVISION_INVALID", errors.New("Revision is invalid.")
	}
	path := filepath.ToSlash(safe[0])
	if path == "." || strings.HasPrefix(path, "../") || strings.Contains(path, "/../") {
		return nil, "REVISION_PATH_INVALID", errors.New("Revision path is outside the repository.")
	}
	stateDir := s.cfg.stateDir
	if stateDir == "" {
		stateDir = defaultStateDir()
	}
	hash := sha256.Sum256([]byte(repo.ID + "\x00" + revision + "\x00" + path))
	cacheDir := filepath.Join(stateDir, "revisions", repo.ID, hex.EncodeToString(hash[:8]))
	if err := os.MkdirAll(cacheDir, 0o700); err != nil {
		return nil, "REVISION_CACHE_FAILED", err
	}
	name := filepath.Base(path)
	if name == "." || name == string(filepath.Separator) || name == "" {
		name = "revision.bin"
	}
	outputPath := filepath.Join(cacheDir, name)
	if info, err := os.Stat(outputPath); err == nil && info.Mode().IsRegular() {
		return map[string]any{"revision": revision, "path": path, "materializedPath": outputPath, "size": info.Size(), "cached": true}, "", nil
	}
	spec := revision + ":" + path
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := s.runGitCommandToFile(ctx, repo.RootPath, outputPath, "show", "--no-textconv", spec); err != nil {
		_ = os.Remove(outputPath)
		return nil, "GIT_REVISION_MATERIALIZE_FAILED", err
	}
	info, err := os.Stat(outputPath)
	if err != nil {
		return nil, "REVISION_CACHE_FAILED", err
	}
	return map[string]any{"revision": revision, "path": path, "materializedPath": outputPath, "size": info.Size(), "cached": false}, "", nil
}

func runCommandToFile(ctx context.Context, cwd, outputPath, name string, env []string, args ...string) error {
	tmp := outputPath + ".tmp"
	file, err := os.OpenFile(tmp, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		return err
	}
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.Dir = cwd
	cmd.Env = env
	cmd.Stdout = file
	var stderr strings.Builder
	cmd.Stderr = &stderr
	runErr := cmd.Run()
	closeErr := file.Close()
	if runErr != nil {
		_ = os.Remove(tmp)
		return fmt.Errorf("%s failed: %w: %s", name, runErr, tail(stderr.String(), 4000))
	}
	if closeErr != nil {
		_ = os.Remove(tmp)
		return closeErr
	}
	if err := os.Rename(tmp, outputPath); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	return nil
}

func (s *service) sourceDiff(repo repository, paths []string, input map[string]any) (any, string, error) {
	args := []string{"diff", "--no-color", "--no-ext-diff"}
	baseRevision := strings.TrimSpace(stringFromInput(input, "baseRevision"))
	targetRevision := strings.TrimSpace(stringFromInput(input, "targetRevision"))
	if baseRevision != "" && !validGitRevision(baseRevision) {
		return nil, "GIT_REVISION_INVALID", errors.New("Base revision is invalid.")
	}
	if targetRevision != "" && !validGitRevision(targetRevision) {
		return nil, "GIT_REVISION_INVALID", errors.New("Target revision is invalid.")
	}
	if baseRevision != "" {
		args = append(args, baseRevision)
	}
	if targetRevision != "" {
		args = append(args, targetRevision)
	}
	if baseRevision == "" && targetRevision == "" && boolFromInput(input, "staged") {
		args = append(args, "--cached")
	}
	if len(paths) > 0 {
		args = append(args, "--")
		args = append(args, safePaths(paths)...)
	}
	out, err := s.git(repo, 15*time.Second, args...)
	if err != nil {
		return nil, "GIT_DIFF_FAILED", err
	}
	truncated := len(out) > 512*1024
	if truncated {
		out = out[:512*1024]
	}
	return map[string]any{"patch": out, "truncated": truncated}, "", nil
}
func (s *service) sourceCommit(repo repository, input map[string]any, paths []string) (any, string, error) {
	message := strings.TrimSpace(stringFromInput(input, "message"))
	if message == "" {
		return nil, "COMMIT_MESSAGE_REQUIRED", errors.New("Commit message is required.")
	}
	if len(paths) > 0 {
		args := append([]string{"add", "--"}, safePaths(paths)...)
		if _, err := s.git(repo, 20*time.Second, args...); err != nil {
			return nil, "GIT_ADD_FAILED", err
		}
	}
	out, err := s.git(repo, 45*time.Second, "commit", "-m", message)
	if err != nil {
		return nil, "GIT_COMMIT_FAILED", err
	}
	if boolFromInput(input, "push") {
		if _, err := s.git(repo, 60*time.Second, "push"); err != nil {
			return map[string]any{"committed": true, "pushFailed": true, "output": tail(out, 4000)}, "GIT_PUSH_FAILED", err
		}
	}
	sha, _ := s.git(repo, 5*time.Second, "rev-parse", "HEAD")
	return map[string]any{"committed": true, "revision": strings.TrimSpace(sha), "output": tail(out, 4000)}, "", nil
}
func (s *service) sourceSync(repo repository, input map[string]any) (any, string, error) {
	mode := stringFromInput(input, "mode")
	if mode == "" {
		mode = "fetch"
	}
	var args []string
	switch mode {
	case "fetch":
		args = []string{"fetch", "--prune"}
	case "pull":
		args = []string{"pull", "--ff-only"}
	case "push":
		args = []string{"push"}
	default:
		return nil, "SYNC_MODE_INVALID", fmt.Errorf("unsupported sync mode %q", mode)
	}
	out, err := s.git(repo, 60*time.Second, args...)
	if err != nil {
		return nil, "GIT_SYNC_FAILED", err
	}
	return map[string]any{"mode": mode, "output": tail(out, 8000)}, "", nil
}

func (s *service) lfsLocks(repo repository) (any, string, error) {
	out, err := s.git(repo, 15*time.Second, "lfs", "locks", "--json")
	if err != nil {
		return nil, "GIT_LFS_LOCKS_FAILED", err
	}
	var raw map[string]any
	if json.Unmarshal([]byte(out), &raw) != nil {
		return []any{}, "", nil
	}
	locks := []map[string]any{}
	for _, key := range []string{"ours", "theirs"} {
		arr, _ := raw[key].([]any)
		for _, v := range arr {
			m, _ := v.(map[string]any)
			if m == nil {
				continue
			}
			path, _ := m["path"].(string)
			owner := ""
			if o, ok := m["owner"].(map[string]any); ok {
				owner = fmt.Sprint(o["name"])
			}
			locks = append(locks, map[string]any{"id": fmt.Sprint(m["id"]), "path": path, "owner": owner, "lockedAt": m["locked_at"], "ownership": key})
		}
	}
	return locks, "", nil
}
func (s *service) lfsLock(repo repository, path string) (any, string, error) {
	path, err := safeRel(path)
	if err != nil {
		return nil, "INVALID_PATH", err
	}
	out, err := s.git(repo, 20*time.Second, "lfs", "lock", "--json", path)
	if err != nil {
		return nil, "GIT_LFS_LOCK_FAILED", err
	}
	var result any
	if json.Unmarshal([]byte(out), &result) != nil {
		result = map[string]any{"path": path, "ownership": "ours", "raw": tail(out, 2000)}
	}
	return result, "", nil
}
func (s *service) lfsUnlock(repo repository, path string, force bool) (any, string, error) {
	path, err := safeRel(path)
	if err != nil {
		return nil, "INVALID_PATH", err
	}
	args := []string{"lfs", "unlock", "--json"}
	if force {
		args = append(args, "--force")
	}
	args = append(args, path)
	out, err := s.git(repo, 20*time.Second, args...)
	if err != nil {
		return nil, "GIT_LFS_UNLOCK_FAILED", err
	}
	var result any
	if json.Unmarshal([]byte(out), &result) != nil {
		result = map[string]any{"path": path, "unlocked": true, "raw": tail(out, 2000)}
	}
	return result, "", nil
}

func (s *service) nativeLFSMutate(repo repository, action string, p map[string]any) (any, string, error) {
	pattern := strings.TrimSpace(stringFromInput(p, "pattern"))
	if pattern == "" {
		return nil, "LFS_PATTERN_REQUIRED", errors.New("LFS pattern is required.")
	}
	var args []string
	if action == "lfs.untrack" {
		args = []string{"lfs", "untrack", pattern}
	} else {
		args = []string{"lfs", "track", pattern}
		if action == "lfs.track-lockable" {
			args = append(args, "--lockable")
		}
	}
	out, err := s.git(repo, 20*time.Second, args...)
	if err != nil {
		return nil, "GIT_LFS_POLICY_FAILED", err
	}
	return s.nativeMutationResult(repo, action, out)
}
func (s *service) nativePolicyMutation(repo repository, action string, p map[string]any) (any, string, error) {
	switch action {
	case "ignore.add", "ignore.remove":
		pattern := strings.TrimSpace(stringFromInput(p, "pattern"))
		if pattern == "" {
			return nil, "PATTERN_REQUIRED", errors.New("Ignore pattern is required.")
		}
		if err := mutateLineFile(filepath.Join(repo.RootPath, ".gitignore"), pattern, action == "ignore.add"); err != nil {
			return nil, "POLICY_WRITE_FAILED", err
		}
	case "attributes.text", "attributes.binary", "attributes.remove":
		pattern := strings.TrimSpace(stringFromInput(p, "pattern"))
		if pattern == "" {
			return nil, "PATTERN_REQUIRED", errors.New("Attribute pattern is required.")
		}
		line := pattern + " text"
		if action == "attributes.binary" {
			line = pattern + " -text"
		}
		if action == "attributes.remove" {
			if err := removePatternLines(filepath.Join(repo.RootPath, ".gitattributes"), pattern); err != nil {
				return nil, "POLICY_WRITE_FAILED", err
			}
		} else if err := mutateLineFile(filepath.Join(repo.RootPath, ".gitattributes"), line, true); err != nil {
			return nil, "POLICY_WRITE_FAILED", err
		}
	}
	return s.nativeMutationResult(repo, action, "Policy updated.")
}
func mutateLineFile(path, line string, add bool) error {
	data, _ := os.ReadFile(path)
	lines := nonEmptyLines(string(data))
	set := map[string]bool{}
	for _, v := range lines {
		set[v] = true
	}
	if add {
		set[line] = true
	} else {
		delete(set, line)
	}
	out := make([]string, 0, len(set))
	for v := range set {
		out = append(out, v)
	}
	sort.Strings(out)
	text := ""
	if len(out) > 0 {
		text = strings.Join(out, "\n") + "\n"
	}
	return os.WriteFile(path, []byte(text), 0o644)
}
func removePatternLines(path, pattern string) error {
	data, _ := os.ReadFile(path)
	out := []string{}
	for _, line := range strings.Split(string(data), "\n") {
		trim := strings.TrimSpace(line)
		if trim == "" {
			continue
		}
		if strings.Fields(trim)[0] == pattern {
			continue
		}
		out = append(out, line)
	}
	text := ""
	if len(out) > 0 {
		text = strings.Join(out, "\n") + "\n"
	}
	return os.WriteFile(path, []byte(text), 0o644)
}
func (s *service) policyState(repo repository) map[string]any {
	ignoreData, _ := os.ReadFile(filepath.Join(repo.RootPath, ".gitignore"))
	attrData, _ := os.ReadFile(filepath.Join(repo.RootPath, ".gitattributes"))
	attrs := []map[string]any{}
	for _, line := range nonEmptyLines(string(attrData)) {
		f := strings.Fields(line)
		if len(f) > 1 {
			attrs = append(attrs, map[string]any{"pattern": f[0], "attributes": strings.Join(f[1:], " ")})
		}
	}
	return map[string]any{"ignorePatterns": nonEmptyLines(string(ignoreData)), "attributeRules": attrs, "ignoreFileSafe": true, "attributesFileSafe": true}
}

func decodeJSON(w http.ResponseWriter, r *http.Request, target any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
	defer r.Body.Close()
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(target); err != nil {
		writeError(w, 400, "INVALID_JSON", "Request body was not valid JSON: "+err.Error())
		return false
	}
	if err := dec.Decode(&struct{}{}); err != io.EOF {
		writeError(w, 400, "INVALID_JSON", "Request body must contain one JSON value.")
		return false
	}
	return true
}
func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]any{"ok": false, "error": map[string]any{"code": code, "message": message}})
}
func stringFromInput(m map[string]any, key string) string {
	if m == nil {
		return ""
	}
	if v, ok := m[key].(string); ok {
		return strings.TrimSpace(v)
	}
	return ""
}
func boolFromInput(m map[string]any, key string) bool {
	if m == nil {
		return false
	}
	v, _ := m[key].(bool)
	return v
}
func intFromInput(m map[string]any, key string, fallback int) int {
	if m == nil {
		return fallback
	}
	switch v := m[key].(type) {
	case float64:
		return int(v)
	case int:
		return v
	}
	return fallback
}
func cleanAbsolute(path string) string {
	if path == "" {
		return ""
	}
	abs, err := filepath.Abs(path)
	if err != nil {
		return ""
	}
	return filepath.Clean(abs)
}
func pathInside(root, target string) bool {
	root = filepath.Clean(root)
	target = filepath.Clean(target)
	rel, err := filepath.Rel(root, target)
	return err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(os.PathSeparator))
}
func samePath(a, b string) bool {
	aa := filepath.Clean(a)
	bb := filepath.Clean(b)
	if runtime.GOOS == "windows" {
		return strings.EqualFold(aa, bb)
	}
	return aa == bb
}
func cleanRel(value string) string {
	if value == "" || value == "." {
		return "."
	}
	return filepath.ToSlash(filepath.Clean(value))
}
func safeRel(value string) (string, error) {
	value = filepath.ToSlash(strings.TrimSpace(value))
	if value == "" {
		return "", nil
	}
	if filepath.IsAbs(value) {
		return "", errors.New("absolute paths are not accepted")
	}
	clean := filepath.Clean(value)
	if clean == ".." || strings.HasPrefix(clean, ".."+string(os.PathSeparator)) {
		return "", errors.New("path escapes repository")
	}
	return filepath.ToSlash(clean), nil
}
func safePaths(values []string) []string {
	out := []string{}
	for _, v := range values {
		if p, err := safeRel(v); err == nil && p != "" {
			out = append(out, p)
		}
	}
	return out
}
func nonEmptyLines(text string) []string {
	lines := []string{}
	for _, line := range strings.Split(strings.ReplaceAll(text, "\r\n", "\n"), "\n") {
		if strings.TrimSpace(line) != "" {
			lines = append(lines, line)
		}
	}
	return lines
}
func uniqueStrings(values []string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, v := range values {
		if v != "" && !seen[v] {
			seen[v] = true
			out = append(out, v)
		}
	}
	return out
}
func nilIfEmpty(v string) any {
	if v == "" {
		return nil
	}
	return v
}
func tail(v string, n int) string {
	if len(v) <= n {
		return v
	}
	return v[len(v)-n:]
}
