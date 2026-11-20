package main

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"
)

// How long Git may run, by the kind of work. Unreal repositories hold tens of
// thousands of files and multi-gigabyte LFS objects: a cold status can take a
// minute, staging runs the LFS clean filter over every asset, and a push can
// upload gigabytes. A timeout that fires on real work is worse than none — it
// kills Git mid-write and leaves index.lock behind — so these are ceilings for
// hung processes, not expectations. Network work is cancellable through
// operations instead.
const (
	gitQuickTimeout   = 30 * time.Second
	gitReadTimeout    = 5 * time.Minute
	gitLocalTimeout   = 30 * time.Minute
	gitNetworkTimeout = 6 * time.Hour
)

type gitOptions struct {
	// stdin is passed to Git, e.g. NUL-separated pathspecs.
	stdin string
	// write serializes the command with every other write to the same
	// repository and, if it is killed, removes the index.lock it left.
	write bool
}

// gitArgs adds the options every invocation needs: unquoted UTF-8 paths in
// human-readable output, and long paths on Windows (Unreal content trees
// routinely pass 260 characters).
func gitArgs(args []string) []string {
	prefix := []string{"-c", "core.quotepath=false"}
	if runtime.GOOS == "windows" {
		prefix = append(prefix, "-c", "core.longpaths=true")
	}
	return append(prefix, args...)
}

func (s *service) repoMutex(root string) *sync.Mutex {
	key := filepath.Clean(root)
	if runtime.GOOS == "windows" {
		key = strings.ToLower(key)
	}
	lock, _ := s.repoLocks.LoadOrStore(key, &sync.Mutex{})
	return lock.(*sync.Mutex)
}

// runCommandIO runs a process with stdout and stderr kept apart: parsers read
// stdout only, so a warning on stderr (LFS, CRLF, credential helpers) can
// never corrupt a status or a lock list. Cancelling ctx kills the whole
// process tree — git-lfs, ssh and remote helpers included.
func runCommandIO(ctx context.Context, dir, name string, env []string, stdin string, args ...string) (string, string, error) {
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.Dir = dir
	cmd.Env = env
	configureProcessTree(cmd)
	cmd.WaitDelay = 10 * time.Second
	if stdin != "" {
		cmd.Stdin = strings.NewReader(stdin)
	}
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err := cmd.Run()
	return stdout.String(), stderr.String(), err
}

// gitCtx is the one way Git runs for repository work.
func (s *service) gitCtx(ctx context.Context, repo repository, opts gitOptions, args ...string) (string, string, error) {
	runtimeInfo := s.effectiveGitRuntime()
	if runtimeInfo.Executable == "" {
		return "", "", errors.New("Git runtime is unavailable")
	}
	if opts.write {
		lock := s.repoMutex(repo.RootPath)
		lock.Lock()
		defer lock.Unlock()
	}
	started := time.Now()
	stdout, stderr, err := runCommandIO(ctx, repo.RootPath, runtimeInfo.Executable, s.gitCommandEnv(), opts.stdin, gitArgs(args)...)
	if ctxErr := ctx.Err(); ctxErr != nil {
		if opts.write {
			removeOwnIndexLock(repo.RootPath, started)
		}
		if errors.Is(ctxErr, context.DeadlineExceeded) {
			return stdout, stderr, fmt.Errorf("git %s timed out", gitVerb(args))
		}
		return stdout, stderr, ctxErr
	}
	if err != nil {
		detail := strings.TrimSpace(stderr)
		if detail == "" {
			detail = strings.TrimSpace(stdout)
		}
		return stdout, stderr, fmt.Errorf("git %s failed: %s", gitVerb(args), tail(detail, 4000))
	}
	return stdout, stderr, nil
}

func (s *service) gitWith(repo repository, timeout time.Duration, opts gitOptions, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	stdout, _, err := s.gitCtx(ctx, repo, opts, args...)
	return stdout, err
}

// gitWrite runs a command that changes the index, refs or working tree.
func (s *service) gitWrite(repo repository, timeout time.Duration, args ...string) (string, error) {
	return s.gitWith(repo, timeout, gitOptions{write: true}, args...)
}

func gitVerb(args []string) string {
	for _, arg := range args {
		if arg != "" && !strings.HasPrefix(arg, "-") {
			return arg
		}
	}
	return "command"
}

// pathspecInput feeds paths to --pathspec-from-file=- --pathspec-file-nul.
// Paths travel on stdin rather than the command line, which on Windows is
// capped at 32K characters — a few hundred Unreal asset paths.
func pathspecInput(paths []string) string {
	if len(paths) == 0 {
		return ""
	}
	return strings.Join(paths, "\x00") + "\x00"
}

// gitDir resolves the repository's .git directory, following a gitfile
// (worktrees, submodules).
func gitDir(root string) string {
	dotGit := filepath.Join(root, ".git")
	info, err := os.Stat(dotGit)
	if err != nil {
		return ""
	}
	if info.IsDir() {
		return dotGit
	}
	data, err := os.ReadFile(dotGit)
	if err != nil {
		return ""
	}
	line := strings.TrimSpace(string(data))
	if !strings.HasPrefix(line, "gitdir:") {
		return ""
	}
	target := strings.TrimSpace(strings.TrimPrefix(line, "gitdir:"))
	if !filepath.IsAbs(target) {
		target = filepath.Join(root, target)
	}
	return filepath.Clean(target)
}

// removeOwnIndexLock clears the index.lock a killed Git left behind. Only a
// lock created after our command started is ours; an older one belongs to
// another client (the editor, a terminal) and is left alone.
func removeOwnIndexLock(root string, started time.Time) {
	dir := gitDir(root)
	if dir == "" {
		return
	}
	lockPath := filepath.Join(dir, "index.lock")
	info, err := os.Stat(lockPath)
	if err != nil || info.ModTime().Before(started.Add(-time.Second)) {
		return
	}
	_ = os.Remove(lockPath)
}

type porcelainEntry struct {
	XY       string
	Path     string
	OrigPath string
}

// parsePorcelainZ reads `git status --porcelain=v1 -z`. With -z, paths are
// verbatim (no quoting of spaces, quotes or non-ASCII names) and a rename is
// "XY new\0old\0" rather than "old -> new".
func parsePorcelainZ(out string) []porcelainEntry {
	parts := strings.Split(out, "\x00")
	entries := make([]porcelainEntry, 0, len(parts))
	for i := 0; i < len(parts); i++ {
		record := parts[i]
		if len(record) < 4 {
			continue
		}
		entry := porcelainEntry{XY: record[:2], Path: filepath.ToSlash(record[3:])}
		if strings.ContainsAny(entry.XY, "RC") && i+1 < len(parts) {
			entry.OrigPath = filepath.ToSlash(parts[i+1])
			i++
		}
		entries = append(entries, entry)
	}
	return entries
}

func isConflictXY(xy string) bool {
	return strings.Contains(xy, "U") || xy == "AA" || xy == "DD"
}

func nulFields(out string) []string {
	fields := []string{}
	for _, field := range strings.Split(out, "\x00") {
		if field = strings.TrimSpace(field); field != "" {
			fields = append(fields, filepath.ToSlash(field))
		}
	}
	return fields
}
