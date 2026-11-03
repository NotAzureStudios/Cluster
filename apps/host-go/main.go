package main

import (
	nativealerts "cluster.local/native-alerts"
	processjob "cluster.local/native-process-job"
	"context"
	"errors"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"os/signal"
	"strings"
	"sync/atomic"
	"syscall"
	"time"
)

var version = "1.0.4-dev"

type host struct {
	root             string
	mode             string
	origin           string
	apiOrigin        string
	bindAddress      string
	webPort          int
	remoteAccess     bool
	configuredOrigin string
	scheme           string
	secure           bool
	tlsCertFile      string
	tlsKeyFile       string
	api              *exec.Cmd
	apiJob           *processjob.Job
	apiDone          chan struct{}
	apiErr           error
	apiRestartLimit  int
	apiRestarting    atomic.Bool
	apiRestartCount  atomic.Int64
	shutdownToken    string
	server           *http.Server
	startedAt        time.Time
	alerts           *nativealerts.Spool
}

func main() {
	log.SetFlags(0)
	mode := flag.String("mode", "serve", "serve or browser")
	rootFlag := flag.String("root", "", "Cluster workspace root")
	webPort := flag.Int("web-port", 3000, "preferred web port")
	apiPort := flag.Int("api-port", 4100, "preferred private API port")
	bindAddress := flag.String("bind", environmentOr("CLUSTER_HOST_BIND", "127.0.0.1"), "web bind address")
	allowRemote := flag.Bool("allow-remote", false, "allow non-loopback clients")
	publicOrigin := flag.String("public-origin", environmentOr("CLUSTER_HOST_PUBLIC_ORIGIN", ""), "public browser origin used for redirects and share links")
	allowInsecureHTTP := flag.Bool("allow-insecure-http", environmentBool("CLUSTER_HOST_ALLOW_INSECURE_HTTP", false), "allow remote plain HTTP on a trusted network")
	tlsCert := flag.String("tls-cert", environmentOr("CLUSTER_HOST_TLS_CERT", ""), "TLS certificate PEM file")
	tlsKey := flag.String("tls-key", environmentOr("CLUSTER_HOST_TLS_KEY", ""), "TLS private key PEM file")
	apiRestartLimit := flag.Int("api-restart-limit", environmentInt("CLUSTER_HOST_API_RESTART_LIMIT", 3), "maximum API restart attempts after an unexpected exit")
	strictPorts := flag.Bool("strict-ports", environmentBool("CLUSTER_HOST_STRICT_PORTS", false), "fail startup instead of silently switching web or private API ports")
	controlFile := flag.String("control-file", "", "optional local launcher control file used for graceful shutdown")
	readyFile := flag.String("ready-file", "", "optional private Windows Service readiness marker")
	flag.Parse()

	root, err := resolveRoot(*rootFlag)
	if err != nil {
		log.Fatalf("Cluster Host configuration error: %v", err)
	}
	modeValue := strings.ToLower(strings.TrimSpace(*mode))
	if modeValue != "serve" && modeValue != "browser" {
		log.Fatalf("Cluster Host configuration error: unsupported mode %q", modeValue)
	}

	resolvedBind, err := normalizeBindAddress(*bindAddress)
	if err != nil {
		log.Fatalf("Cluster Host configuration error: %v", err)
	}
	certFile, keyFile, secure, err := resolveTLSFiles(*tlsCert, *tlsKey)
	if err != nil {
		log.Fatalf("Cluster Host configuration error: %v", err)
	}
	remoteAccess := !isLoopbackBind(resolvedBind)
	if remoteAccess && !*allowRemote {
		log.Fatalf("Cluster Host configuration error: binding to %s requires --allow-remote", resolvedBind)
	}
	if remoteAccess && !secure && !*allowInsecureHTTP {
		log.Fatalf("Cluster Host configuration error: remote access requires TLS. Supply --tls-cert and --tls-key, or explicitly use --allow-insecure-http only on a trusted LAN")
	}
	if *apiRestartLimit < 0 || *apiRestartLimit > 20 {
		log.Fatalf("Cluster Host configuration error: api restart limit must be between 0 and 20")
	}

	shutdownToken, err := generateShutdownToken()
	if err != nil {
		log.Fatalf("Cluster Host configuration error: could not create managed shutdown token: %v", err)
	}
	scheme := "http"
	if secure {
		scheme = "https"
	}
	runtimeHost := &host{
		root: root, mode: modeValue, bindAddress: resolvedBind, remoteAccess: remoteAccess,
		configuredOrigin: strings.TrimSpace(*publicOrigin), scheme: scheme, secure: secure, tlsCertFile: certFile, tlsKeyFile: keyFile,
		apiRestartLimit: *apiRestartLimit, shutdownToken: shutdownToken, startedAt: time.Now(),
	}
	runtimeHost.alerts, err = nativealerts.New(root, os.Getenv("CLUSTER_NATIVE_ALERT_DISCORD_WEBHOOK_URL"))
	if err != nil {
		log.Printf("Cluster native emergency alert transport disabled: invalid webhook configuration (local journal remains enabled).")
	}
	signalContext, stopSignals := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stopSignals()
	ctx, cancel := context.WithCancel(signalContext)
	defer cancel()
	if strings.TrimSpace(*controlFile) != "" {
		go watchControlFile(ctx, strings.TrimSpace(*controlFile), cancel)
	}
	if err := runtimeHost.run(ctx, clampPort(*webPort, 3000), clampPort(*apiPort, 4100), strings.TrimSpace(*readyFile), *strictPorts); err != nil {
		log.Fatalf("Cluster Host stopped: %v", err)
	}
}

func (h *host) run(ctx context.Context, preferredWebPort, preferredAPIPort int, readyFile string, strictPorts bool) error {
	if readyFile != "" {
		defer os.Remove(readyFile)
	}
	if h.alerts != nil {
		h.alerts.Start(ctx)
	}
	listener, err := listenConfigured(h.bindAddress, preferredWebPort, strictPorts)
	if err != nil {
		h.nativeEmergency(nativealerts.GatewayBindFailed)
		return err
	}
	webPort := listener.Addr().(*net.TCPAddr).Port
	h.webPort = webPort
	h.origin, err = resolvePublicOrigin(h.configuredOrigin, h.bindAddress, webPort, h.scheme, h.remoteAccess)
	if err != nil {
		_ = listener.Close()
		return err
	}
	// Public HTTPS is distinct from transport TLS. The Go Host is the
	// trusted boundary for both browser session security and API forwarding.
	publicURL, _ := url.Parse(h.origin)
	h.scheme = publicURL.Scheme
	apiPort, err := availableConfiguredPort(preferredAPIPort, strictPorts)
	if err != nil {
		_ = listener.Close()
		return err
	}
	h.apiOrigin = fmt.Sprintf("http://127.0.0.1:%d", apiPort)

	log.Printf("Cluster Host %s", displayReleaseVersion(h.root))
	log.Printf("Workspace: %s", h.root)
	log.Printf("Gateway:   Go managed-host profile")
	log.Printf("Web:       %s", h.origin)
	log.Printf("Transport: %s", map[bool]string{true: "TLS", false: "plain HTTP"}[h.secure])
	if h.remoteAccess {
		log.Printf("Network:   remote access enabled on %s:%d", h.bindAddress, webPort)
		for _, origin := range networkOrigins(webPort, h.scheme) {
			log.Printf("            %s", origin)
		}
	}
	log.Printf("API:       %s (private, restart limit %d)", h.apiOrigin, h.apiRestartLimit)

	if err := h.startAPI(apiPort); err != nil {
		h.nativeEmergency(nativealerts.APIStartFailed)
		_ = listener.Close()
		return err
	}
	defer h.stopAPI()
	if err := h.waitForAPI(ctx, 35*time.Second); err != nil {
		if ctx.Err() == nil {
			h.nativeEmergency(nativealerts.APIReadinessFailed)
		}
		_ = listener.Close()
		return fmt.Errorf("API did not become ready: %w", err)
	}

	target, _ := url.Parse(h.apiOrigin)
	h.server = &http.Server{
		Handler:           h.handler(target),
		ReadHeaderTimeout: 15 * time.Second,
		ReadTimeout:       10 * time.Minute,
		WriteTimeout:      10 * time.Minute,
		IdleTimeout:       90 * time.Second,
	}
	serverErrors := make(chan error, 1)
	go func() {
		var serveErr error
		if h.secure {
			serveErr = h.server.ServeTLS(listener, h.tlsCertFile, h.tlsKeyFile)
		} else {
			serveErr = h.server.Serve(listener)
		}
		if serveErr != nil && !errors.Is(serveErr, http.ErrServerClosed) {
			serverErrors <- serveErr
		}
	}()

	h.watchNativeReadiness(ctx)

	// The launcher treats this as the authoritative readiness boundary.
	// Web/API addresses are logged earlier for diagnostics, but the service is not
	// considered ready until the API probe has passed and the HTTP listener is live.
	if readyFile != "" {
		if err := publishServiceReadiness(readyFile); err != nil {
			return fmt.Errorf("cannot publish service readiness: %w", err)
		}
	}
	log.Printf("Ready:     %s", h.origin)

	if h.mode == "browser" {
		if err := openURL(h.origin); err != nil {
			log.Printf("Browser could not be opened automatically: %v", err)
		}
	}
	for {
		apiDone := h.apiDone
		select {
		case <-ctx.Done():
			return h.shutdownHTTP()
		case err := <-serverErrors:
			h.nativeEmergency(nativealerts.GatewayServeFailed)
			return err
		case <-apiDone:
			if ctx.Err() != nil {
				return h.shutdownHTTP()
			}
			if err := h.recoverAPI(ctx, apiPort); err != nil {
				if h.apiErr == nil {
					return fmt.Errorf("API process exited and could not be recovered: %w", err)
				}
				return fmt.Errorf("API process exited (%v) and could not be recovered: %w", h.apiErr, err)
			}
		}
	}
}

func (h *host) shutdownHTTP() error {
	if h.server == nil {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()
	return h.server.Shutdown(ctx)
}

func watchControlFile(ctx context.Context, file string, cancel context.CancelFunc) {
	ticker := time.NewTicker(250 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			contents, err := os.ReadFile(file)
			if err != nil {
				continue
			}
			if strings.EqualFold(strings.TrimSpace(string(contents)), "stop") {
				_ = os.Remove(file)
				log.Printf("Managed shutdown requested by Cluster Server control panel.")
				cancel()
				return
			}
		}
	}
}

// Native host emergency transport is independent of Cluster's SQL-backed Inbox.
func (h *host) nativeEmergency(code nativealerts.Code) {
	if h.alerts == nil {
		return
	}
	if err := h.alerts.Emit(code); err != nil {
		log.Printf("Cluster native emergency alert delivery/journal issue: %v", err)
	}
}
