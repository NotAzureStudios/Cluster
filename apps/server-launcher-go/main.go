package main

import (
	"bufio"
	nativealerts "cluster.local/native-alerts"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"
)

var version = "1.2.0-dev"

const privateNodeVersion = "24.20.0"

// Must exceed the native Host's API drain allowance (135 s) and gateway
// shutdown (up to 4 s). This is a fallback for failed graceful termination,
// not the expected time for an idle server to stop.
const managedHostStopGrace = 150 * time.Second

type launcherOptions struct {
	root         string
	browser      bool
	repair       bool
	headless     bool
	noAutostart  bool
	modeOverride string
	startup      bool
}

func main() {
	rootFlag := flag.String("root", "", "Cluster Server workspace root")
	browser := flag.Bool("browser", false, "open Cluster Web after startup")
	repair := flag.Bool("repair", false, "force dependency and build repair")
	headless := flag.Bool("headless", false, "legacy alias for --command-line")
	commandLine := flag.Bool("command-line", false, "run Cluster Server in command-line mode")
	interfaceMode := flag.Bool("interface", false, "run Cluster Server with the native Windows interface")
	noAutostart := flag.Bool("no-autostart", false, "open the native Windows interface without starting the server")
	startup := flag.Bool("startup", false, "Windows logon launch; start the server using the saved interface mode")
	service := flag.Bool("service", false, "run under Windows Service Control Manager")
	installService := flag.Bool("service-install", false, "install dedicated Windows Service after least-privilege provisioning")
	removeService := flag.Bool("service-remove", false, "remove stopped Windows Service")
	diagnose := flag.Bool("diagnose", false, "read-only offline installation and PostgreSQL data-directory checks (JSON)")
	repairManaged := flag.Bool("repair-managed", false, "repair trusted local Windows Server runtime/link components while Server is stopped")
	inspectStagedUpdate := flag.Bool("inspect-staged-update", false, "read-only: independently verify a signed staged Server update (JSON)")
	updateReadiness := flag.Bool("update-readiness", false, "read-only: signed staging and installation blocker report (JSON)")
 nativeUpdateApply := flag.Bool("native-update-apply", false, "internal: execute approved signed Server update from independent native worker")
	updateChannel := flag.String("update-channel", "main", "signed Server update channel to inspect (main or development)")
	webUpdateAction := flag.String("web-server-update", "", "internal: authenticated Web update check/stage/status; never install")
	flag.Parse()

	root, err := resolveRoot(*rootFlag)
	if err != nil {
		fatal(err)
	}
	launcherRoot = root
	if *webUpdateAction != "" {
		if *nativeUpdateApply || *updateReadiness || *inspectStagedUpdate || *diagnose || *repairManaged || *repair ||
			*service || *installService || *removeService || *startup || *browser || *interfaceMode ||
			*commandLine || *headless || *noAutostart || *updateChannel != "main" {
			fmt.Fprintln(os.Stderr, "Web Server update actions are exclusive, main-channel operations")
			os.Exit(2)
		}
		if err := runWebServerUpdateAction(root, *webUpdateAction); err != nil { fatal(err) }
		return
	}
 if *nativeUpdateApply {
  if *updateReadiness || *inspectStagedUpdate || *diagnose || *repairManaged || *repair || *service ||
   *installService || *removeService || *startup || *browser || *interfaceMode ||
   *commandLine || *headless || *noAutostart {
   fmt.Fprintln(os.Stderr,"native Server update worker cannot be combined with any launcher or maintenance mode")
   os.Exit(2)
  }
  if err:=runNativeServerUpdateInstall(root,*updateChannel);err!=nil{fatal(err)}
  return
 }
	if *updateReadiness {
		if *inspectStagedUpdate || *diagnose || *repairManaged || *repair || *service ||
			*installService || *removeService || *startup || *browser || *interfaceMode ||
			*commandLine || *headless || *noAutostart {
			fmt.Fprintln(os.Stderr, "--update-readiness is an exclusive, read-only operation")
			os.Exit(2)
		}
		readiness:=inspectServerUpdateReadiness(root,*updateChannel,inspectStagedServerUpdate)
		if err:=json.NewEncoder(os.Stdout).Encode(readiness);err!=nil{fatal(err)}
		return
	}
	if *inspectStagedUpdate {
		if *diagnose || *repairManaged || *repair || *service || *installService || *removeService || *startup ||
			*browser || *interfaceMode || *commandLine || *headless || *noAutostart {
			fmt.Fprintln(os.Stderr, "--inspect-staged-update is an exclusive, read-only operation")
			os.Exit(2)
		}
		candidate, inspectErr := inspectStagedServerUpdate(root, *updateChannel)
		if inspectErr != nil {
			fmt.Fprintln(os.Stderr, "Server update is not ready for installation: "+inspectErr.Error())
			os.Exit(2)
		}
		if err := json.NewEncoder(os.Stdout).Encode(struct {
			Ready bool `json:"ready"`
			Release string `json:"release"`
			Sequence int `json:"sequence"`
			Channel string `json:"channel"`
			SHA256 string `json:"sha256"`
		}{true,candidate.Release,candidate.Sequence,candidate.Channel,candidate.SHA256});err!=nil{fatal(err)}
		return
	}
	if *repairManaged {
		if *diagnose || *repair || *service || *installService || *removeService || *startup || *browser || *interfaceMode || *commandLine || *headless {
			fmt.Fprintln(os.Stderr, "--repair-managed is an exclusive offline maintenance action")
			os.Exit(2)
		}
		report, repairErr := repairManagedInstallation(root)
		if err := writeManagedRepairReport(os.Stdout, report); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(2)
		}
		if repairErr != nil {
			fmt.Fprintln(os.Stderr, "Managed self-repair incomplete: "+repairErr.Error())
			os.Exit(2)
		}
		return
	}
	if *diagnose {
		if *service || *installService || *removeService || *repair || *startup {
			fmt.Fprintln(os.Stderr, "--diagnose cannot be combined with service, startup or repair actions")
			os.Exit(2)
		}
		report := collectNativeOfflineDiagnostics(root)
		if err := writeNativeOfflineDiagnostics(os.Stdout, report); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(2)
		}
		if !report.Healthy {
			os.Exit(2)
		}
		return
	}
	if *service || *installService || *removeService {
		if err := runPlatformServiceAction(root, *service, *installService, *removeService); err != nil {
			fatal(err)
		}
		return
	}
	modeOverride := ""
	if *headless || *commandLine {
		modeOverride = "command-line"
	}
	if *interfaceMode {
		if modeOverride != "" {
			fatal(fmt.Errorf("choose only one launcher mode: --interface or --command-line"))
		}
		modeOverride = "interface"
	}
	options := launcherOptions{root: root, browser: *browser, repair: *repair, headless: modeOverride == "command-line", noAutostart: *noAutostart, modeOverride: modeOverride, startup: *startup}
	if err := runPlatformLauncher(options); err != nil {
		recordLauncherEmergency(root, nativealerts.LauncherStartupFailed)
		fatal(err)
	}
}

func runServerHeadless(options launcherOptions) error {
	root := options.root
	fmt.Printf("Cluster Server %s\nWorkspace: %s\n\n", displayReleaseVersion(root), root)
	if options.repair && fileExists(filepath.Join(root, ".cluster-installer-managed.json")) {
		return fmt.Errorf("managed releases cannot be repaired by compiling on startup; run Cluster-Installer.exe")
	}

	node, npm, cleanupRuntime, err := preparePlatformRuntime(root)
	if err != nil {
		return err
	}
	if cleanupRuntime != nil {
		defer cleanupRuntime()
	}

	env, err := ensureServerEnvironment(root)
	if err != nil {
		return err
	}
	defer cleanupRuntimes()
	if err := prepareApplication(root, node, npm, env, options.repair); err != nil {
		return err
	}

	cmd, err := managedHostCommand(options, node, env, "")
	if err != nil {
		return err
	}
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("Cluster Host stopped: %w", err)
	}
	return nil
}

func managedHostCommand(options launcherOptions, node string, env map[string]string, controlFile string) (*exec.Cmd, error) {
	host := filepath.Join(options.root, "bin", platformHostName())
	if _, err := os.Stat(host); err != nil {
		return nil, fmt.Errorf("native Cluster host is missing at %s", host)
	}
	args := []string{"--mode", "serve", "--root", options.root, "--strict-ports"}
	network, err := configuredNativeNetwork(options.root)
	if err != nil {
		return nil, fmt.Errorf("invalid native network configuration: %w", err)
	}
	args = append(args, "--web-port", fmt.Sprint(network.WebPort), "--api-port", fmt.Sprint(network.PublicAPIPort), "--bind", network.WebHost)
	if network.PublicWebOrigin != "" {
		args = append(args, "--public-origin", network.PublicWebOrigin)
	}
	if network.TLSCertFile != "" {
		args = append(args, "--tls-cert", network.TLSCertFile, "--tls-key", network.TLSKeyFile)
	}
	if network.AllowInsecureLANHTTP {
		args = append(args, "--allow-insecure-http")
	}
	// Network binding is an explicit operator configuration. The Host retains
	// its own TLS/remote-access enforcement and will reject unsafe exposure.
	if network.WebHost != "127.0.0.1" && network.WebHost != "::1" {
		args = append(args, "--allow-remote")
	}
	if options.browser {
		args[1] = "browser"
	}
	if strings.TrimSpace(controlFile) != "" {
		args = append(args, "--control-file", controlFile)
	}
	cmd := exec.Command(host, args...)
	cmd.Dir = options.root
	cmd.Stdin, cmd.Stdout, cmd.Stderr = os.Stdin, os.Stdout, os.Stderr
	configureChildProcess(cmd)
	cmd.Env = mergeEnvironment(os.Environ(), env)
	if nodeDir := filepath.Dir(node); nodeDir != "" {
		cmd.Env = prependPath(cmd.Env, nodeDir)
	}
	return cmd, nil
}

func resolveRoot(value string) (string, error) {
	if strings.TrimSpace(value) != "" {
		return filepath.Abs(value)
	}
	exe, err := os.Executable()
	if err != nil {
		return "", err
	}
	return filepath.Dir(exe), nil
}

func platformHostName() string {
	if runtime.GOOS == "windows" {
		return "cluster-host.exe"
	}
	return "cluster-host"
}

func prepareApplication(root, node, npm string, env map[string]string, force bool) error {
	return prepareApplicationContext(context.Background(), root, node, npm, env, force)
}

func prepareApplicationContext(ctx context.Context, root, node, npm string, env map[string]string, force bool) error {
	if err := ctx.Err(); err != nil {
		return fmt.Errorf("Cluster Server startup cancelled: %w", err)
	}
	marker := filepath.Join(root, "data", "system", "runtime", "build-version.txt")
	serverEntry := filepath.Join(root, "apps", "server", "dist", "index.js")
	webEntry := filepath.Join(root, "apps", "web", "dist", "index.html")
	markerBytes, _ := os.ReadFile(marker)
	prebuiltReady := releasePrebuiltReady(root) && fileExists(serverEntry) && fileExists(webEntry) && fileExists(filepath.Join(root, "packages", "shared", "dist", "index.js"))
	// Source compilation belongs to Cluster-Installer.exe, never to an ordinary
	// start of an installer-managed release. A broken release is a repairable
	// installation failure; silently running npm here masks missing artifacts,
	// requires build tools on every machine, and can mutate a live installation.
	managedInstall := fileExists(filepath.Join(root, ".cluster-installer-managed.json"))
	if managedInstall {
		// A deployed server is an immutable application, not a development tree.
		// Verify its local dependency graph and apply database migrations using
		// the bundled Prisma CLI directly. Never call npm install, generate,
		// build, or source-repair on the machine hosting a managed release.
		coreDependenciesPresent := fileExists(filepath.Join(root, "node_modules", "prisma", "package.json")) &&
			fileExists(filepath.Join(root, "node_modules", "@prisma", "client", "package.json"))
		dependenciesReady := coreDependenciesPresent && installedDependencyGraphHealthy(root)
		if err := verifyManagedStartup(root, force, prebuiltReady, dependenciesReady); err != nil {
			return err
		}
		fmt.Println("Using prebuilt Cluster Server and verified installed dependencies.")
		if err := runManagedDatabaseCommandContext(ctx, root, node, env, "deploy"); err != nil {
			return err
		}
		if strings.TrimSpace(string(markerBytes)) != version {
			if err := os.MkdirAll(filepath.Dir(marker), 0o755); err != nil {
				return err
			}
			if err := os.WriteFile(marker, []byte(version+"\n"), 0o644); err != nil {
				return err
			}
		}
		return nil
	}
	needsBuild := force || (!prebuiltReady && (strings.TrimSpace(string(markerBytes)) != version || !fileExists(serverEntry) || !fileExists(webEntry)))
	dependencyMarker := filepath.Join(root, "data", "system", "runtime", "dependencies.sha256")
	dependencyHash, err := dependencyFingerprint(root)
	if err != nil {
		return err
	}
	installedHash, _ := os.ReadFile(dependencyMarker)
	installedFingerprint := strings.TrimSpace(string(installedHash))
	coreDependenciesPresent := fileExists(filepath.Join(root, "node_modules", "prisma", "package.json")) && fileExists(filepath.Join(root, "node_modules", "@prisma", "client", "package.json"))
	dependenciesReady := coreDependenciesPresent && installedFingerprint == dependencyHash
	if !force && !dependenciesReady && coreDependenciesPresent && installedDependencyGraphHealthy(root) {
		// Migrate installations created by the old version-based fingerprint without
		// reinstalling an already-correct dependency tree. This is intentionally a
		// local manifest validation and never touches the network.
		fmt.Println("Validated existing Cluster dependencies; skipping redundant install.")
		dependenciesReady = true
		if err := os.MkdirAll(filepath.Dir(dependencyMarker), 0o755); err != nil {
			return err
		}
		if err := os.WriteFile(dependencyMarker, []byte(dependencyHash+"\n"), 0o644); err != nil {
			return err
		}
	}
	if force || !dependenciesReady {
		fmt.Println("Installing Cluster Server dependencies...")
		installArgs := []string{"install", "--include=dev", "--no-audit", "--no-fund", "--no-progress"}
		if fileExists(filepath.Join(root, "package-lock.json")) {
			installArgs[0] = "ci"
		}
		if err := runNpmContext(ctx, root, node, npm, env, installArgs...); err != nil {
			return err
		}
		if err := os.MkdirAll(filepath.Dir(dependencyMarker), 0o755); err != nil {
			return err
		}
		if err := os.WriteFile(dependencyMarker, []byte(dependencyHash+"\n"), 0o644); err != nil {
			return err
		}
		if !prebuiltReady {
			needsBuild = true
		}
	}
	fmt.Println("Preparing Cluster database...")
	if !prebuiltReady || force {
		fmt.Println("Generating Prisma client for source/repair build...")
		if err := runNpmContext(ctx, root, node, npm, env, "run", "db:generate"); err != nil {
			return err
		}
	}
	if err := runNpmContext(ctx, root, node, npm, env, "run", "db:deploy"); err != nil {
		return err
	}
	if prebuiltReady && !force {
		fmt.Println("Using prebuilt Cluster Server, Prisma client, and web client from the release package.")
	}
	if needsBuild {
		fmt.Println("Building Cluster Server and web client (repair/source package fallback)...")
		if err := runNpmContext(ctx, root, node, npm, env, "run", "build:server"); err != nil {
			return fmt.Errorf("server build failed: %w", err)
		}
		if err := runNpmContext(ctx, root, node, npm, env, "run", "build:web"); err != nil {
			return fmt.Errorf("web build failed: %w", err)
		}
		if err := os.MkdirAll(filepath.Dir(marker), 0o755); err != nil {
			return err
		}
		if err := os.WriteFile(marker, []byte(version+"\n"), 0o644); err != nil {
			return err
		}
	} else if prebuiltReady {
		if err := os.MkdirAll(filepath.Dir(marker), 0o755); err != nil {
			return err
		}
		if err := os.WriteFile(marker, []byte(version+"\n"), 0o644); err != nil {
			return err
		}
	}
	return nil
}

type packagedReleaseMetadata struct {
	ClusterVersion string `json:"clusterVersion"`
	Prebuilt       struct {
		Server bool `json:"server"`
		Web    bool `json:"web"`
		Shared bool `json:"shared"`
	} `json:"prebuilt"`
}

func releasePrebuiltReady(root string) bool {
	contents, err := os.ReadFile(filepath.Join(root, "CLUSTER_RELEASE.json"))
	if err != nil {
		return false
	}
	var metadata packagedReleaseMetadata
	if json.Unmarshal(contents, &metadata) != nil {
		return false
	}
	return metadata.ClusterVersion == version && metadata.Prebuilt.Server && metadata.Prebuilt.Web && metadata.Prebuilt.Shared
}

type dependencyManifestFingerprint struct {
	Path                 string            `json:"path"`
	Dependencies         map[string]string `json:"dependencies,omitempty"`
	DevDependencies      map[string]string `json:"devDependencies,omitempty"`
	OptionalDependencies map[string]string `json:"optionalDependencies,omitempty"`
	PeerDependencies     map[string]string `json:"peerDependencies,omitempty"`
}

type dependencyManifestFile struct {
	Dependencies         map[string]string `json:"dependencies"`
	DevDependencies      map[string]string `json:"devDependencies"`
	OptionalDependencies map[string]string `json:"optionalDependencies"`
	PeerDependencies     map[string]string `json:"peerDependencies"`
}

func dependencyManifestPaths() []string {
	return []string{
		"package.json",
		filepath.Join("apps", "server", "package.json"),
		filepath.Join("apps", "web", "package.json"),
		filepath.Join("packages", "shared", "package.json"),
		filepath.Join("packages", "api-client", "package.json"),
		filepath.Join("packages", "renderer", "package.json"),
	}
}

func readDependencyManifest(root, relative string) (dependencyManifestFile, error) {
	contents, err := os.ReadFile(filepath.Join(root, relative))
	if err != nil {
		return dependencyManifestFile{}, fmt.Errorf("dependency manifest %s is missing: %w", relative, err)
	}
	var manifest dependencyManifestFile
	if err := json.Unmarshal(contents, &manifest); err != nil {
		return dependencyManifestFile{}, fmt.Errorf("dependency manifest %s is invalid: %w", relative, err)
	}
	return manifest, nil
}

func dependencyFingerprint(root string) (string, error) {
	hash := sha256.New()
	// Dependency readiness must be driven by the dependency graph, not Cluster's
	// product version. Prior releases hashed entire package manifests (plus the
	// toolchain file), so every version bump forced a full npm install even when
	// not one dependency changed. That made routine upgrades network-dependent and
	// caused healthy embedded PostgreSQL instances to be torn down when npm failed.
	hash.Write([]byte("node-runtime"))
	hash.Write([]byte{0})
	hash.Write([]byte(privateNodeVersion))
	hash.Write([]byte{0})
	for _, relative := range dependencyManifestPaths() {
		manifest, err := readDependencyManifest(root, relative)
		if err != nil {
			return "", err
		}
		record := dependencyManifestFingerprint{
			Path:                 filepath.ToSlash(relative),
			Dependencies:         manifest.Dependencies,
			DevDependencies:      manifest.DevDependencies,
			OptionalDependencies: manifest.OptionalDependencies,
			PeerDependencies:     manifest.PeerDependencies,
		}
		encoded, err := json.Marshal(record)
		if err != nil {
			return "", err
		}
		hash.Write(encoded)
		hash.Write([]byte{0})
	}
	if lock := filepath.Join(root, "package-lock.json"); fileExists(lock) {
		contents, err := os.ReadFile(lock)
		if err != nil {
			return "", err
		}
		hash.Write([]byte("package-lock.json"))
		hash.Write([]byte{0})
		hash.Write(contents)
		hash.Write([]byte{0})
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}

func installedDependencyGraphHealthy(root string) bool {
	for _, relative := range dependencyManifestPaths() {
		manifest, err := readDependencyManifest(root, relative)
		if err != nil {
			return false
		}
		sections := []map[string]string{manifest.Dependencies, manifest.DevDependencies, manifest.OptionalDependencies}
		for _, section := range sections {
			for name, expected := range section {
				if strings.HasPrefix(name, "@cluster/") || expected == "*" || strings.HasPrefix(expected, "workspace:") || strings.HasPrefix(expected, "file:") {
					continue
				}
				// Cluster currently pins external direct dependencies exactly. If a
				// future manifest introduces a range, fail closed and let npm verify it.
				if !regexp.MustCompile(`^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$`).MatchString(expected) {
					return false
				}
				installed, ok := installedPackageVersion(root, filepath.Dir(relative), name)
				if !ok || installed != expected {
					return false
				}
			}
		}
	}
	return true
}

func installedPackageVersion(root, manifestDir, name string) (string, bool) {
	packagePath := filepath.FromSlash(name)
	candidates := []string{filepath.Join(root, "node_modules", packagePath, "package.json")}
	if manifestDir != "." && manifestDir != "" {
		candidates = append(candidates, filepath.Join(root, manifestDir, "node_modules", packagePath, "package.json"))
	}
	for _, candidate := range candidates {
		contents, err := os.ReadFile(candidate)
		if err != nil {
			continue
		}
		var metadata struct {
			Version string `json:"version"`
		}
		if json.Unmarshal(contents, &metadata) == nil && strings.TrimSpace(metadata.Version) != "" {
			return strings.TrimSpace(metadata.Version), true
		}
	}
	return "", false
}

// Managed releases execute database operations with the packaged Prisma CLI,
// without spawning the npm command runner or resolving external dependencies.
func runManagedDatabaseCommandContext(ctx context.Context, root, node string, env map[string]string, action string) error {
	if action != "deploy" && action != "doctor" {
		return fmt.Errorf("unsupported managed database command %q", action)
	}
	script := filepath.Join(root, "tools", "scripts", "database-command.mjs")
	cli := filepath.Join(root, "node_modules", "prisma", "build", "index.js")
	if !fileExists(script) || !fileExists(cli) {
		return fmt.Errorf("managed database CLI is missing from the installed release; repair with Cluster-Installer.exe")
	}
	if err := ctx.Err(); err != nil {
		return fmt.Errorf("database %s cancelled: %w", action, err)
	}
	cmd := exec.CommandContext(ctx, node, script, action)
	cmd.Dir = root
	cmd.Stdout, cmd.Stderr = os.Stdout, os.Stderr
	cmd.Stdin = nil
	configureChildProcess(cmd)
	cmd.Env = prependPath(mergeEnvironment(os.Environ(), env), filepath.Dir(node))
	if err := cmd.Run(); err != nil {
		if ctxErr := ctx.Err(); ctxErr != nil {
			return fmt.Errorf("managed database %s cancelled: %w", action, ctxErr)
		}
		return fmt.Errorf("managed database %s failed: %w", action, err)
	}
	return nil
}

func runNpm(root, node, npm string, env map[string]string, args ...string) error {
	return runNpmContext(context.Background(), root, node, npm, env, args...)
}

func runNpmContext(ctx context.Context, root, node, npm string, env map[string]string, args ...string) error {
	var cmd *exec.Cmd
	if strings.HasSuffix(strings.ToLower(npm), ".js") {
		cmd = exec.CommandContext(ctx, node, append([]string{npm}, args...)...)
	} else {
		cmd = exec.CommandContext(ctx, npm, args...)
	}
	cmd.Dir = root
	cmd.Stdout, cmd.Stderr, cmd.Stdin = os.Stdout, os.Stderr, os.Stdin
	configureChildProcess(cmd)
	cmd.Env = mergeEnvironment(os.Environ(), env)
	cmd.Env = prependPath(cmd.Env, filepath.Dir(node))
	if err := cmd.Run(); err != nil {
		if ctxErr := ctx.Err(); ctxErr != nil {
			return fmt.Errorf("npm %s cancelled: %w", strings.Join(args, " "), ctxErr)
		}
		return fmt.Errorf("npm %s failed: %w", strings.Join(args, " "), err)
	}
	return nil
}

func ensureServerEnvironment(root string) (map[string]string, error) {
	database, cleanup, err := ensureDatabase(root)
	if err != nil {
		return nil, err
	}
	registerRuntimeCleanup(cleanup)

	envFile := filepath.Join(root, "apps", "server", ".env")
	values := readEnvFile(envFile)
	values["DATABASE_URL"] = database.runtimeURL
	values["DIRECT_DATABASE_URL"] = database.directURL
	values["CLUSTER_REQUIRE_AUTH"] = valueOr(values["CLUSTER_REQUIRE_AUTH"], "true")
	values["CLUSTER_REQUIRE_DISCORD_LINK"] = valueOr(values["CLUSTER_REQUIRE_DISCORD_LINK"], "false")
	values["CLUSTER_DEV_LOGIN"] = "false"
	values["CLUSTER_AUTO_SEED"] = "false"
	values["SESSION_SECURE"] = valueOr(values["SESSION_SECURE"], "false")
	for _, key := range []string{"SESSION_SECRET", "CLUSTER_AUTH_SECRET", "CLUSTER_SECRET_KEY"} {
		if len(values[key]) < 32 {
			values[key] = randomSecret(48)
		}
	}
	if err := writeEnvFile(envFile, values); err != nil {
		return nil, err
	}
	return values, nil
}

type databaseConfig struct{ runtimeURL, directURL string }

type cleanupFunc func()

var runtimeCleanups []cleanupFunc
var runtimeCleanupMu sync.Mutex
var launcherRoot string

func registerRuntimeCleanup(fn cleanupFunc) {
	if fn != nil {
		runtimeCleanupMu.Lock()
		runtimeCleanups = append(runtimeCleanups, fn)
		runtimeCleanupMu.Unlock()
	}
}

func randomSecret(bytes int) string {
	b := make([]byte, bytes)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return base64.RawURLEncoding.EncodeToString(b)
}

func postgresURL(password, host string, port int, pooled bool) string {
	query := ""
	if pooled {
		query = "?connection_limit=15&pool_timeout=20&connect_timeout=10"
	}
	return fmt.Sprintf("postgresql://cluster:%s@%s:%d/cluster%s", url.QueryEscape(password), host, port, query)
}

func readEnvFile(file string) map[string]string {
	out := map[string]string{}
	handle, err := os.Open(file)
	if err != nil {
		return out
	}
	defer handle.Close()
	scanner := bufio.NewScanner(handle)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, value, ok := strings.Cut(line, "=")
		if ok {
			out[strings.TrimSpace(key)] = strings.TrimSpace(value)
		}
	}
	return out
}

func writeEnvFile(file string, values map[string]string) error {
	if err := os.MkdirAll(filepath.Dir(file), 0o700); err != nil {
		return err
	}
	order := []string{"DATABASE_URL", "DIRECT_DATABASE_URL", "CLUSTER_REQUIRE_AUTH", "CLUSTER_REQUIRE_DISCORD_LINK", "CLUSTER_DEV_LOGIN", "CLUSTER_AUTO_SEED", "SESSION_SECURE", "SESSION_SECRET", "CLUSTER_AUTH_SECRET", "CLUSTER_SECRET_KEY", "CLUSTER_SECRET_KEY_PREVIOUS"}
	seen := map[string]bool{}
	var b strings.Builder
	b.WriteString("# Managed by Cluster Server\n")
	writeValue := func(key string) {
		if seen[key] || !regexp.MustCompile(`^[A-Z][A-Z0-9_]*$`).MatchString(key) {
			return
		}
		seen[key] = true
		if value := values[key]; value != "" {
			fmt.Fprintf(&b, "%s=%s\n", key, value)
		}
	}
	for _, key := range order {
		writeValue(key)
	}
	extra := make([]string, 0, len(values))
	for key := range values {
		if !seen[key] {
			extra = append(extra, key)
		}
	}
	sort.Strings(extra)
	for _, key := range extra {
		writeValue(key)
	}
	if err := os.WriteFile(file, []byte(b.String()), 0o600); err != nil {
		return err
	}
	return os.Chmod(file, 0o600)
}

func mergeEnvironment(base []string, values map[string]string) []string {
	out := append([]string{}, base...)
	for key, value := range values {
		out = setEnv(out, key, value)
	}
	return out
}

func setEnv(env []string, key, value string) []string {
	prefix := strings.ToUpper(key) + "="
	filtered := env[:0]
	for _, item := range env {
		if !strings.HasPrefix(strings.ToUpper(item), prefix) {
			filtered = append(filtered, item)
		}
	}
	return append(filtered, key+"="+value)
}

func prependPath(env []string, directory string) []string {
	if directory == "" {
		return env
	}
	current := ""
	for _, item := range env {
		if strings.HasPrefix(strings.ToUpper(item), "PATH=") {
			current = strings.TrimPrefix(item, "PATH=")
			break
		}
	}
	return setEnv(env, "PATH", directory+string(os.PathListSeparator)+current)
}

func valueOr(value, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return value
}
func fileExists(file string) bool { info, err := os.Stat(file); return err == nil && !info.IsDir() }
func dirExists(file string) bool  { info, err := os.Stat(file); return err == nil && info.IsDir() }

func cleanupRuntimes() {
	runtimeCleanupMu.Lock()
	cleanups := append([]cleanupFunc{}, runtimeCleanups...)
	runtimeCleanups = nil
	runtimeCleanupMu.Unlock()
	for index := len(cleanups) - 1; index >= 0; index-- {
		cleanups[index]()
	}
}

func fatal(err error) {
	// Fatal bootstrap failures used to terminate immediately. When ClusterServer.exe was
	// launched by double-clicking, Windows closed the console before the error could be read.
	// Always stop managed runtimes, persist the error, and keep an interactive console open.
	cleanupRuntimes()

	logPath := ""
	if launcherRoot != "" {
		logs := filepath.Join(launcherRoot, "data", "system", "logs")
		if mkErr := os.MkdirAll(logs, 0o755); mkErr == nil {
			logPath = filepath.Join(logs, "bootstrap.log")
			if file, openErr := os.OpenFile(logPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600); openErr == nil {
				fmt.Fprintf(file, "%s Cluster Server v%s bootstrap failure: %v\n", time.Now().Format(time.RFC3339), version, err)
				_ = file.Close()
			}
		}
	}

	fmt.Fprintf(os.Stderr, "\nCluster Server could not start.\n%v\n", err)
	if logPath != "" {
		fmt.Fprintf(os.Stderr, "Bootstrap log: %s\n", logPath)
	}
	if runtime.GOOS == "windows" && os.Getenv("CLUSTER_NONINTERACTIVE") != "1" {
		if info, statErr := os.Stdin.Stat(); statErr == nil && info.Mode()&os.ModeCharDevice != 0 {
			fmt.Fprint(os.Stderr, "\nPress Enter to close...")
			_, _ = bufio.NewReader(os.Stdin).ReadString('\n')
		}
	}
	os.Exit(1)
}

func runCommand(dir string, env map[string]string, name string, args ...string) error {
	cmd := exec.Command(name, args...)
	cmd.Dir, cmd.Stdout, cmd.Stderr, cmd.Stdin = dir, os.Stdout, os.Stderr, os.Stdin
	configureChildProcess(cmd)
	cmd.Env = mergeEnvironment(os.Environ(), env)
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("%s failed: %w", name, err)
	}
	return nil
}

func commandOutput(dir string, env map[string]string, name string, args ...string) (string, error) {
	cmd := exec.Command(name, args...)
	configureChildProcess(cmd)
	cmd.Dir = dir
	cmd.Env = mergeEnvironment(os.Environ(), env)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return string(out), fmt.Errorf("%s failed: %w: %s", name, err, strings.TrimSpace(string(out)))
	}
	return string(out), nil
}

func ensureExecutable(name string) (string, error) {
	path, err := exec.LookPath(name)
	if err != nil {
		return "", fmt.Errorf("required executable %q was not found in PATH", name)
	}
	return path, nil
}
func ignoreCleanup() {}

var _ = errors.New

func recordLauncherEmergency(root string, code nativealerts.Code) {
	spool, configErr := nativealerts.New(root, os.Getenv("CLUSTER_NATIVE_ALERT_DISCORD_WEBHOOK_URL"))
	if configErr != nil {
		fmt.Fprintln(os.Stderr, "Native emergency webhook configuration is invalid; recording locally only.")
	}
	if err := spool.Emit(code); err != nil {
		fmt.Fprintf(os.Stderr, "Native emergency alert transport/journal issue: %v\n", err)
	}
}
