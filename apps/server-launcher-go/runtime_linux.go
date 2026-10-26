//go:build linux

package main

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

func preparePlatformRuntime(root string) (node string, npm string, cleanup cleanupFunc, err error) {
	nodeRoot := filepath.Join(root, "runtime", "node")
	node = filepath.Join(nodeRoot, "bin", "node")
	npm = filepath.Join(nodeRoot, "bin", "npm")
	if !fileExists(node) || !fileExists(npm) {
		fmt.Printf("Downloading private Node.js %s runtime...\n", privateNodeVersion)
		tarPath, lookErr := ensureExecutable("tar")
		if lookErr != nil {
			return "", "", nil, fmt.Errorf("Linux Node bootstrap requires tar with xz support: %w", lookErr)
		}
		cache := filepath.Join(root, "runtime", "cache")
		if err := os.MkdirAll(cache, 0o755); err != nil {
			return "", "", nil, err
		}
		archive := filepath.Join(cache, "node.tar.xz")
		source := fmt.Sprintf("https://nodejs.org/dist/v%s/node-v%s-linux-x64.tar.xz", privateNodeVersion, privateNodeVersion)
		if err := downloadLinuxFile(source, archive); err != nil {
			return "", "", nil, err
		}
		temporary := nodeRoot + ".installing"
		_ = os.RemoveAll(temporary)
		if err := os.MkdirAll(temporary, 0o755); err != nil {
			return "", "", nil, err
		}
		cmd := exec.Command(tarPath, "-xJf", archive, "-C", temporary, "--strip-components=1")
		cmd.Stdout, cmd.Stderr = os.Stdout, os.Stderr
		if err := cmd.Run(); err != nil {
			return "", "", nil, fmt.Errorf("private Node.js extraction failed: %w", err)
		}
		_ = os.RemoveAll(nodeRoot)
		if err := os.Rename(temporary, nodeRoot); err != nil {
			return "", "", nil, err
		}
	}
	output, err := commandOutput(root, nil, node, "--version")
	if err != nil {
		return "", "", nil, err
	}
	versionText := strings.TrimPrefix(strings.Fields(output)[0], "v")
	majorText := strings.SplitN(versionText, ".", 2)[0]
	major, _ := strconv.Atoi(majorText)
	if major < 22 {
		return "", "", nil, fmt.Errorf("Node.js 22+ is required; private runtime reported %s", strings.TrimSpace(output))
	}
	return node, npm, nil, nil
}

func ensureDatabase(root string) (databaseConfig, cleanupFunc, error) {
	existing := readEnvFile(filepath.Join(root, "apps", "server", ".env"))
	if strings.HasPrefix(existing["DATABASE_URL"], "postgresql://") {
		return databaseConfig{existing["DATABASE_URL"], valueOr(existing["DIRECT_DATABASE_URL"], existing["DATABASE_URL"])}, nil, nil
	}
	docker, err := ensureExecutable("docker")
	if err != nil {
		return databaseConfig{}, nil, fmt.Errorf("Linux Cluster Server uses the Docker PostgreSQL deployment when no DATABASE_URL is configured. Install Docker Compose or configure apps/server/.env with PostgreSQL first")
	}
	compose := filepath.Join(root, "deployment", "postgresql", "docker-compose.yml")
	if !fileExists(compose) {
		return databaseConfig{}, nil, fmt.Errorf("Docker PostgreSQL compose file is missing at %s", compose)
	}
	password := randomSecret(36)
	deploymentEnv := filepath.Join(root, "deployment", "postgresql", ".env")
	content := fmt.Sprintf("POSTGRES_DB=cluster\nPOSTGRES_USER=cluster\nPOSTGRES_PASSWORD=%s\nPOSTGRES_PORT=5432\nPOSTGRES_BIND_HOST=127.0.0.1\n", password)
	if err := os.WriteFile(deploymentEnv, []byte(content), 0o600); err != nil {
		return databaseConfig{}, nil, err
	}
	fmt.Println("Starting Cluster PostgreSQL Docker service...")
	if err := runCommand(root, nil, docker, "compose", "--env-file", deploymentEnv, "-f", compose, "up", "-d", "postgres"); err != nil {
		return databaseConfig{}, nil, err
	}
	deadline := time.Now().Add(90 * time.Second)
	ready := false
	for time.Now().Before(deadline) {
		probe := exec.Command(docker, "compose", "--env-file", deploymentEnv, "-f", compose, "exec", "-T", "postgres", "pg_isready", "-U", "cluster", "-d", "cluster")
		probe.Dir = root
		if probe.Run() == nil {
			ready = true
			break
		}
		time.Sleep(time.Second)
	}
	if !ready {
		return databaseConfig{}, nil, fmt.Errorf("PostgreSQL container did not become ready within 90 seconds")
	}
	runtimeURL := postgresURL(password, "127.0.0.1", 5432, true)
	directURL := postgresURL(password, "127.0.0.1", 5432, false)
	return databaseConfig{runtimeURL, directURL}, nil, nil
}

func downloadLinuxFile(source, destination string) error {
	response, err := http.Get(source)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("download %s returned HTTP %d", source, response.StatusCode)
	}
	file, err := os.Create(destination)
	if err != nil {
		return err
	}
	defer file.Close()
	_, err = io.Copy(file, response.Body)
	return err
}
