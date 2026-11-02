//go:build windows

package main

import (
	"archive/zip"
	processjob "cluster.local/native-process-job"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

const postgresVersion = "18.6"
const postgresBinariesRevision = "5"

func preparePlatformRuntime(root string) (node string, npm string, cleanup cleanupFunc, err error) {
	// The prebuilt installer already provisions a hash-verified private Node
	// distribution. Prefer that single runtime instead of downloading a second
	// copy for the Manager. Keep the older standalone root/runtime/node fallback
	// for developer-source work and installations without the shared runtime.
	if fileExists(filepath.Join(root, ".cluster-installer-managed.json")) {
		installerNodeRoot := filepath.Join(filepath.Dir(root), "Toolchains", "node-v"+privateNodeVersion)
		installerNode := filepath.Join(installerNodeRoot, "node.exe")
		installerNpm := filepath.Join(installerNodeRoot, "node_modules", "npm", "bin", "npm-cli.js")
		if fileExists(installerNode) && fileExists(installerNpm) {
			cmd := exec.Command(installerNode, "--version")
			configureChildProcess(cmd)
			if output, versionErr := cmd.Output(); versionErr == nil && strings.TrimSpace(string(output)) == "v"+privateNodeVersion {
				fmt.Println("Using installer-provisioned private Node runtime.")
				return installerNode, installerNpm, nil, nil
			}
			fmt.Println("Installer-provisioned Node runtime is unavailable or invalid; checking server-local runtime.")
		}
	}
	nodeRoot := filepath.Join(root, "runtime", "node")
	node = filepath.Join(nodeRoot, "node.exe")
	npm = filepath.Join(nodeRoot, "node_modules", "npm", "bin", "npm-cli.js")
	if fileExists(node) && fileExists(npm) {
		cmd := exec.Command(node, "--version")
		configureChildProcess(cmd)
		out, versionErr := cmd.Output()
		if versionErr == nil && strings.TrimSpace(string(out)) == "v"+privateNodeVersion {
			return node, npm, nil, nil
		}
		fmt.Printf("Private Node.js runtime is stale or invalid; refreshing v%s...\n", privateNodeVersion)
		_ = os.RemoveAll(nodeRoot)
	}
	fmt.Printf("Downloading private Node.js %s runtime...\n", privateNodeVersion)
	cache := filepath.Join(root, "runtime", "cache")
	if err := os.MkdirAll(cache, 0o755); err != nil {
		return "", "", nil, err
	}
	archive := filepath.Join(cache, "node.zip")
	url := fmt.Sprintf("https://nodejs.org/dist/v%s/node-v%s-win-x64.zip", privateNodeVersion, privateNodeVersion)
	if err := downloadFile(url, archive); err != nil {
		return "", "", nil, err
	}
	temporary := nodeRoot + ".installing"
	_ = os.RemoveAll(temporary)
	if err := extractZipFlatten(archive, temporary); err != nil {
		return "", "", nil, err
	}
	if err := stageRuntimeDirectory(temporary, nodeRoot); err != nil {
		return "", "", nil, fmt.Errorf("could not install private Node.js runtime: %w", err)
	}
	if !fileExists(node) || !fileExists(npm) {
		return "", "", nil, fmt.Errorf("private Node.js runtime staging completed but required files are missing")
	}
	return node, npm, nil, nil
}

func stageRuntimeDirectory(source, destination string) error {
	_ = os.RemoveAll(destination)
	var renameErr error
	for attempt := 1; attempt <= 4; attempt++ {
		if err := os.Rename(source, destination); err == nil {
			return nil
		} else {
			renameErr = err
			if attempt < 4 {
				time.Sleep(time.Duration(attempt) * 250 * time.Millisecond)
			}
		}
	}
	// Windows Defender, Explorer, or an indexing service can briefly hold the
	// extracted directory open and make an otherwise valid atomic rename fail
	// with ACCESS_DENIED. Copying into a fresh destination is slower but avoids
	// turning a harmless transient file lock into a dead first launch.
	fmt.Printf("Runtime directory rename was blocked (%v); using copy fallback...\n", renameErr)
	_ = os.RemoveAll(destination)
	if err := copyTree(source, destination); err != nil {
		return fmt.Errorf("rename failed (%v) and copy fallback failed: %w", renameErr, err)
	}
	_ = os.RemoveAll(source)
	return nil
}

func ensureDatabase(root string) (databaseConfig, cleanupFunc, error) {
	pgRoot := filepath.Join(root, "runtime", "postgresql")
	bin := filepath.Join(pgRoot, "bin")
	if !fileExists(filepath.Join(bin, "postgres.exe")) {
		fmt.Printf("Downloading private PostgreSQL %s runtime...\n", postgresVersion)
		if err := installPostgresRuntime(root, pgRoot); err != nil {
			return databaseConfig{}, nil, err
		}
	}
	data := filepath.Join(root, "data", "postgresql")
	config := filepath.Join(root, "data", "system", "config", "embedded-postgres.env")
	values := readEnvFile(config)
	password := values["POSTGRES_PASSWORD"]
	port := 54321
	if password == "" {
		password = randomSecret(36)
	}
	if !fileExists(filepath.Join(data, "PG_VERSION")) {
		fmt.Println("Initializing private PostgreSQL database as SQL role \"cluster\"...")
		if err := os.MkdirAll(filepath.Dir(data), 0o755); err != nil {
			return databaseConfig{}, nil, err
		}
		temporary := data + ".initializing"
		_ = os.RemoveAll(temporary)
		pwfile := filepath.Join(root, "data", "system", "runtime", "postgres-password.txt")
		if err := os.MkdirAll(filepath.Dir(pwfile), 0o755); err != nil {
			return databaseConfig{}, nil, err
		}
		if err := os.WriteFile(pwfile, []byte(password+"\n"), 0o600); err != nil {
			return databaseConfig{}, nil, err
		}
		args := []string{"-D", temporary, "--username=cluster", "--pwfile=" + pwfile, "--auth=scram-sha-256", "--encoding=UTF8", "--locale=C"}
		if err := runCommand(root, nil, filepath.Join(bin, "initdb.exe"), args...); err != nil {
			return databaseConfig{}, nil, err
		}
		_ = os.Remove(pwfile)
		postgresqlConf := filepath.Join(temporary, "postgresql.conf")
		f, err := os.OpenFile(postgresqlConf, os.O_APPEND|os.O_WRONLY, 0o600)
		if err != nil {
			return databaseConfig{}, nil, err
		}
		fmt.Fprintf(f, "\n# Managed by Cluster Server\nlisten_addresses = '127.0.0.1'\nport = %d\nmax_connections = 100\nshared_buffers = '128MB'\ntimezone = 'UTC'\n", port)
		_ = f.Close()
		if err := stageRuntimeDirectory(temporary, data); err != nil {
			return databaseConfig{}, nil, fmt.Errorf("could not stage private PostgreSQL data directory: %w", err)
		}
	}
	if !portFree(port) {
		return databaseConfig{}, nil, fmt.Errorf("PostgreSQL port %d is already occupied; Cluster will not attach to an unknown database", port)
	}
	logs := filepath.Join(root, "data", "system", "logs")
	if err := os.MkdirAll(logs, 0o755); err != nil {
		return databaseConfig{}, nil, err
	}
	logFile := filepath.Join(logs, "postgresql.log")
	fmt.Printf("Starting private PostgreSQL on 127.0.0.1:%d...\n", port)
	// pg_ctl exits after spawning the persistent postmaster. Its children must
	// remain under a long-lived kernel job, not become orphaned subprocesses.
	pgJob, err := processjob.New()
	if err != nil {
		return databaseConfig{}, nil, fmt.Errorf("cannot supervise private PostgreSQL: %w", err)
	}
	stopPostgres := func() error {
		cmd := exec.Command(filepath.Join(bin, "pg_ctl.exe"), "-D", data, "-m", "fast", "-w", "stop")
		configureChildProcess(cmd)
		cmd.Dir = root
		return cmd.Run()
	}
	started := false
	defer func() {
		if !started {
			_ = stopPostgres()
			_ = pgJob.Close()
		}
	}()
	startCmd := exec.Command(filepath.Join(bin, "pg_ctl.exe"), "-D", data, "-l", logFile, "-w", "start")
	configureChildProcess(startCmd)
	startCmd.Dir = root
	startCmd.Stdout, startCmd.Stderr = os.Stdout, os.Stderr
	if err := startCmd.Start(); err != nil {
		_ = pgJob.Close()
		return databaseConfig{}, nil, fmt.Errorf("could not start PostgreSQL supervisor: %w", err)
	}
	if err := pgJob.Assign(startCmd); err != nil {
		_ = startCmd.Process.Kill()
		_ = startCmd.Wait()
		return databaseConfig{}, nil, fmt.Errorf("PostgreSQL start refused: child job assignment failed: %w", err)
	}
	if err := startCmd.Wait(); err != nil {
		return databaseConfig{}, nil, fmt.Errorf("private PostgreSQL failed to start: %w", err)
	}
	if active, err := pgJob.ActiveProcesses(); err != nil || active == 0 {
		return databaseConfig{}, nil, fmt.Errorf("PostgreSQL spawned no job-owned server process (active=%d, error=%v); refusing detached database", active, err)
	}
	pgEnv := map[string]string{"PGHOST": "127.0.0.1", "PGPORT": fmt.Sprint(port), "PGUSER": "cluster", "PGPASSWORD": password}
	existsOut, _ := commandOutput(root, pgEnv, filepath.Join(bin, "psql.exe"), "-d", "postgres", "-tAc", "SELECT 1 FROM pg_database WHERE datname='cluster'")
	if strings.TrimSpace(existsOut) != "1" {
		fmt.Println("Creating Cluster database...")
		if err := runCommand(root, pgEnv, filepath.Join(bin, "createdb.exe"), "-O", "cluster", "cluster"); err != nil {
			return databaseConfig{}, nil, err
		}
	}
	if err := writeEnvFile(config, map[string]string{"POSTGRES_PASSWORD": password}); err != nil {
		return databaseConfig{}, nil, err
	}
	cleanup := func() {
		// PostgreSQL gets its normal fast stop first. Only after its exit do
		// we close the Job Object, which also fences any leftover children.
		if err := stopPostgres(); err != nil {
			fmt.Fprintf(os.Stderr, "Cluster PostgreSQL shutdown required process-job cleanup: %v\n", err)
		}
		if err := pgJob.Close(); err != nil {
			fmt.Fprintf(os.Stderr, "Cluster PostgreSQL process-job cleanup failed: %v\n", err)
		}
	}
	started = true
	return databaseConfig{postgresURL(password, "127.0.0.1", port, true), postgresURL(password, "127.0.0.1", port, false)}, cleanup, nil
}

func installPostgresRuntime(root, destination string) error {
    cache := filepath.Join(root, "runtime", "cache")
    if err := os.MkdirAll(cache, 0o755); err != nil { return err }
    archiveName := fmt.Sprintf("postgresql-%s-%s-windows-x64-binaries.zip", postgresVersion, postgresBinariesRevision)
    archive := filepath.Join(cache, archiveName)
    url := "https://get.enterprisedb.com/postgresql/" + archiveName
    // Verify even on cache hits. A renamed PE installer or a partial download
    // must never be treated as a portable PostgreSQL distribution.
    if err := verifySHA256(archive, postgresBinariesSHA256); err != nil {
        if fileExists(archive) {
            fmt.Printf("Cached PostgreSQL binaries failed integrity verification (%v); removing cache entry.\n", err)
            _ = os.Remove(archive)
        }
        fmt.Printf("Downloading verified portable PostgreSQL %s runtime archive...\n", postgresVersion)
        if err := downloadFile(url, archive); err != nil { return fmt.Errorf("unable to download PostgreSQL binaries: %w", err) }
        if err := verifySHA256(archive, postgresBinariesSHA256); err != nil {
            _ = os.Remove(archive)
            return fmt.Errorf("downloaded PostgreSQL binaries failed official SHA-256 verification: %w", err)
        }
    } else {
        fmt.Println("Using verified cached portable PostgreSQL binaries ZIP.")
    }
    temporary := destination + ".installing"
    _ = os.RemoveAll(temporary)
    defer os.RemoveAll(temporary)
    fmt.Println("Extracting verified PostgreSQL binaries without Administrator elevation...")
    if err := extractPostgresBinaries(archive, temporary); err != nil {
        return fmt.Errorf("portable PostgreSQL extraction failed: %w", err)
    }
    for _, executable := range []string{"postgres.exe", "pg_ctl.exe", "initdb.exe", "psql.exe", "createdb.exe"} {
        if !fileExists(filepath.Join(temporary,"bin",executable)) { return fmt.Errorf("portable PostgreSQL runtime missing %s", executable) }
    }
    fmt.Println("Staging private PostgreSQL runtime...")
    if err := stageRuntimeDirectory(temporary, destination); err != nil { return fmt.Errorf("could not stage verified PostgreSQL runtime: %w", err) }
    // A previous RC may have cached the elevation-requiring installer. It is
    // obsolete once the portable binaries have been safely staged.
    _ = os.Remove(filepath.Join(cache, "postgresql-installer.exe"))
    fmt.Println("Private PostgreSQL runtime is ready.")
    return nil
}

func downloadFile(source, destination string) error {
	client := &http.Client{Timeout: 30 * time.Minute}
	var lastErr error
	for attempt := 1; attempt <= 3; attempt++ {
		if attempt > 1 {
			delay := time.Duration(attempt-1) * 2 * time.Second
			fmt.Printf("Retrying download in %s (attempt %d/3)...\n", delay, attempt)
			time.Sleep(delay)
		}
		if err := downloadFileAttempt(client, source, destination); err == nil {
			return nil
		} else {
			lastErr = err
			fmt.Printf("Download attempt %d/3 failed: %v\n", attempt, err)
		}
	}
	return fmt.Errorf("download failed after 3 attempts: %w", lastErr)
}

func downloadFileAttempt(client *http.Client, source, destination string) error {
	request, err := http.NewRequest(http.MethodGet, source, nil)
	if err != nil {
		return err
	}
	request.Header.Set("User-Agent", "ClusterServer/"+version)
	request.Header.Set("Accept", "application/octet-stream,*/*")
	response, err := client.Do(request)
	if err != nil {
		return fmt.Errorf("request failed: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("%s returned HTTP %d %s", source, response.StatusCode, http.StatusText(response.StatusCode))
	}
	if err := os.MkdirAll(filepath.Dir(destination), 0o755); err != nil {
		return err
	}
	partial := destination + ".partial"
	_ = os.Remove(partial)
	file, err := os.Create(partial)
	if err != nil {
		return err
	}

	buffer := make([]byte, 1024*1024)
	var written int64
	var nextReport int64 = 25 * 1024 * 1024
	for {
		read, readErr := response.Body.Read(buffer)
		if read > 0 {
			n, writeErr := file.Write(buffer[:read])
			written += int64(n)
			if writeErr != nil {
				_ = file.Close()
				_ = os.Remove(partial)
				return writeErr
			}
			if written >= nextReport {
				if response.ContentLength > 0 {
					fmt.Printf("  downloaded %.0f / %.0f MiB\n", float64(written)/(1024*1024), float64(response.ContentLength)/(1024*1024))
				} else {
					fmt.Printf("  downloaded %.0f MiB\n", float64(written)/(1024*1024))
				}
				nextReport += 25 * 1024 * 1024
			}
		}
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			_ = file.Close()
			_ = os.Remove(partial)
			return fmt.Errorf("download interrupted after %d bytes: %w", written, readErr)
		}
	}
	if closeErr := file.Close(); closeErr != nil {
		_ = os.Remove(partial)
		return closeErr
	}
	if response.ContentLength > 0 && written != response.ContentLength {
		_ = os.Remove(partial)
		return fmt.Errorf("download size mismatch: received %d bytes, expected %d", written, response.ContentLength)
	}
	if written < 1024*1024 {
		_ = os.Remove(partial)
		return fmt.Errorf("downloaded file is unexpectedly small (%d bytes)", written)
	}
	_ = os.Remove(destination)
	if err := os.Rename(partial, destination); err != nil {
		return err
	}
	fmt.Printf("Download complete: %.0f MiB\n", float64(written)/(1024*1024))
	return nil
}

func validateWindowsExecutable(file string) error {
	handle, err := os.Open(file)
	if err != nil {
		return err
	}
	defer handle.Close()
	header := make([]byte, 2)
	if _, err := io.ReadFull(handle, header); err != nil {
		return err
	}
	if string(header) != "MZ" {
		return fmt.Errorf("file does not contain a Windows PE executable header")
	}
	info, err := handle.Stat()
	if err != nil {
		return err
	}
	if info.Size() < 10*1024*1024 {
		return fmt.Errorf("installer is unexpectedly small (%d bytes)", info.Size())
	}
	return nil
}

func extractZipFlatten(archive, destination string) error {
	reader, err := zip.OpenReader(archive)
	if err != nil {
		return err
	}
	defer reader.Close()
	if err := os.MkdirAll(destination, 0o755); err != nil {
		return err
	}
	for _, file := range reader.File {
		name := filepath.ToSlash(file.Name)
		parts := strings.Split(name, "/")
		if len(parts) > 1 {
			name = strings.Join(parts[1:], "/")
		} else {
			continue
		}
		if name == "" {
			continue
		}
		target := filepath.Join(destination, filepath.FromSlash(name))
		if file.FileInfo().IsDir() {
			if err := os.MkdirAll(target, 0o755); err != nil {
				return err
			}
			continue
		}
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return err
		}
		src, err := file.Open()
		if err != nil {
			return err
		}
		dst, err := os.Create(target)
		if err != nil {
			src.Close()
			return err
		}
		_, copyErr := io.Copy(dst, src)
		src.Close()
		dst.Close()
		if copyErr != nil {
			return copyErr
		}
	}
	return nil
}

func findDirectoryContaining(root, filename string) (string, error) {
	var found string
	_ = filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
		if err == nil && !info.IsDir() && strings.EqualFold(info.Name(), filename) {
			found = filepath.Dir(path)
			return filepath.SkipAll
		}
		return nil
	})
	if found == "" {
		return "", fmt.Errorf("PostgreSQL extraction completed but %s was not found", filename)
	}
	return found, nil
}

func copyTree(source, destination string) error {
	return filepath.Walk(source, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(source, path)
		target := filepath.Join(destination, rel)
		if info.IsDir() {
			return os.MkdirAll(target, info.Mode())
		}
		src, err := os.Open(path)
		if err != nil {
			return err
		}
		defer src.Close()
		dst, err := os.Create(target)
		if err != nil {
			return err
		}
		_, copyErr := io.Copy(dst, src)
		closeErr := dst.Close()
		if copyErr != nil {
			return copyErr
		}
		return closeErr
	})
}

func portFree(port int) bool {
	listener, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
	if err != nil {
		return false
	}
	_ = listener.Close()
	return true
}
