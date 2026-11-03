//go:build windows

package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"syscall"
	"time"
	"unsafe"
)

type nativeSettingKind string

const (
	settingText     nativeSettingKind = "text"
	settingNumber   nativeSettingKind = "number"
	settingBoolean  nativeSettingKind = "boolean"
	settingSelect   nativeSettingKind = "select"
	settingSecret   nativeSettingKind = "secret"
	settingTextarea nativeSettingKind = "textarea"
)

type nativeSettingSpec struct {
	Key       string
	Label     string
	Section   string
	Kind      nativeSettingKind
	Default   any
	Options   []string
	Min       *float64
	Max       *float64
	Integer   bool
	Restart   bool
	Sensitive bool
	Help      string
}

func num(v float64) *float64 { return &v }

// Keep this list in the same order and vocabulary as ServerConfigPage.tsx.
// The native panel intentionally exposes the same server-managed settings without
// importing the renderer or running a WebView.
var nativeServerSettings = []nativeSettingSpec{
	{"serverHost", "API bind host", "Network · Bind addresses", settingText, "0.0.0.0", nil, nil, nil, false, true, false, "Network interface used by the API server. Use 0.0.0.0 for LAN access or localhost for local-only access."},
	{"serverPort", "API port", "Network · Bind addresses", settingNumber, 4000, nil, num(1), num(65535), true, true, false, "TCP port used by the Cluster API."},
	{"webHost", "Web bind host", "Network · Bind addresses", settingText, "localhost", nil, nil, nil, false, true, false, "Network interface used by the web client."},
	{"webPort", "Web port", "Network · Bind addresses", settingNumber, 3000, nil, num(1), num(65535), true, true, false, "TCP port used by the Cluster web client."},
	{"allowInsecureLanHttp", "Allow HTTP on a trusted LAN", "Network · Transport", settingBoolean, false, []string{"false", "true"}, nil, nil, false, true, false, "Explicitly permit plaintext HTTP only on a specific private LAN address. Never use on an untrusted network."},
	{"webTlsCertFile", "TLS certificate PEM path", "Network · Transport", settingText, "", nil, nil, nil, false, true, false, "Certificate file used when the native gateway terminates HTTPS directly."},
	{"webTlsKeyFile", "TLS private key PEM path", "Network · Transport", settingText, "", nil, nil, nil, false, true, true, "Private key file path for direct HTTPS (do not paste the key contents)."},
	{"publicApiUrl", "Public API URL", "Network · Public routing", settingText, "http://localhost:4000", nil, nil, nil, false, true, false, "Browser-visible API address used outside the server machine."},
	{"publicWebUrl", "Public web URL", "Network · Public routing", settingText, "http://localhost:3000", nil, nil, nil, false, true, false, "Canonical address users open for Cluster."},
	{"corsOrigins", "Allowed CORS origins", "Network · Public routing", settingTextarea, "http://localhost:3000, http://127.0.0.1:3000", nil, nil, nil, false, true, false, "Comma-separated browser origins allowed to call the API."},
	{"trustedProxy", "Trust reverse proxy headers", "Network · Public routing", settingBoolean, false, []string{"false", "true"}, nil, nil, false, true, false, "Accept forwarded client IP and protocol headers only when traffic passes through a trusted proxy."},
	{"requestBodyLimitMb", "Request body limit (MB)", "Network · Request limits", settingNumber, 512, nil, num(1), num(2048), false, true, false, "Maximum size of a complete API request."},
	{"uploadLimitMb", "Upload limit (MB)", "Network · Request limits", settingNumber, 512, nil, num(1), num(4096), false, true, false, "Largest individual upload accepted by the server before tool-specific limits."},
	{"requestTimeoutSeconds", "External request timeout (seconds)", "Network · Request limits", settingNumber, 20, nil, num(1), num(3600), false, true, false, "Timeout used for outbound integration requests."},

	{"authRequired", "Require authentication", "Security · Authentication", settingBoolean, true, []string{"false", "true"}, nil, nil, false, false, false, "Require authenticated users for protected Cluster routes."},
	{"devLoginEnabled", "Allow local development login", "Security · Authentication", settingBoolean, false, []string{"false", "true"}, nil, nil, false, false, false, "Development-only login bypass. Keep disabled on a real team server."},
	{"requireDiscordLink", "Require Discord identity link", "Security · Authentication", settingBoolean, false, []string{"false", "true"}, nil, nil, false, false, false, "Require users to link a Discord identity before normal access."},
	{"sessionDays", "Session lifetime (days)", "Security · Sessions", settingNumber, 7, nil, num(1), num(365), true, false, false, "Absolute session lifetime before a user must sign in again."},
	{"sessionIdleHours", "Idle timeout (hours)", "Security · Sessions", settingNumber, 168, nil, num(1), num(8760), true, false, false, "Sign users out after this many hours without authenticated activity."},
	{"sessionMaxPerUser", "Maximum sessions per user", "Security · Sessions", settingNumber, 10, nil, num(1), num(100), true, false, false, "Maximum concurrent browser or device sessions allowed for one account."},
	{"sessionSecure", "Secure-only session cookies", "Security · Sessions", settingBoolean, false, []string{"false", "true"}, nil, nil, false, true, false, "Send session cookies only over HTTPS."},
	{"rateLimitEnabled", "Enable rate limiting", "Security · Request protection", settingBoolean, true, []string{"false", "true"}, nil, nil, false, false, false, "Limit repeated API requests to reduce abuse, accidental loops, and brute-force traffic."},
	{"rateLimitMax", "Requests per window", "Security · Request protection", settingNumber, 12000, nil, num(1), num(1000000), true, false, false, "Per-client API traffic budget per window. The default supports many concurrent dashboard widgets; authentication and sensitive actions have tighter independent limits."},
	{"rateLimitWindowMinutes", "Rate-limit window (minutes)", "Security · Request protection", settingNumber, 1, nil, num(1), num(1440), true, false, false, "Length of the general and authentication rate-limit window."},
	{"authRateLimitMax", "Authentication attempts per window", "Security · Request protection", settingNumber, 120, nil, num(3), num(1000), true, false, false, "Maximum authentication attempts during one rate-limit window."},
	{"securityHeadersEnabled", "Enable security headers", "Security · Request protection", settingBoolean, true, []string{"false", "true"}, nil, nil, false, true, false, "Send browser security headers for framing, MIME sniffing, referrers, and related protections."},
	{"requireMutationOrigin", "Require valid mutation origin", "Security · Request protection", settingBoolean, true, []string{"false", "true"}, nil, nil, false, false, false, "Reject write requests whose browser Origin does not match an allowed Cluster origin."},
	{"avatarUploadLimitMb", "Avatar limit (MB)", "Security · Upload policy", settingNumber, 8, nil, num(1), num(25), true, false, false, "Maximum avatar upload size."},
	{"allowExecutableUploads", "Allow executable uploads", "Security · Upload policy", settingBoolean, false, []string{"false", "true"}, nil, nil, false, false, false, "Permit executable or script-like files in Library uploads."},
	{"allowedUploadMimeCsv", "Allowed upload MIME patterns", "Security · Upload policy", settingTextarea, "", nil, nil, nil, false, false, false, "Comma-separated MIME patterns accepted by the global upload gate."},
	{"logLevel", "Log level", "Security · Audit and logging", settingSelect, "info", []string{"trace", "debug", "info", "warn", "error", "fatal", "silent"}, nil, nil, false, true, false, "Minimum server log severity. Debug and trace create much larger logs."},
	{"enableRequestLogs", "Enable request logs", "Security · Audit and logging", settingBoolean, false, []string{"false", "true"}, nil, nil, false, true, false, "Record one log entry for each HTTP request."},

	{"dataRootOverride", "Data root override", "Storage · Path overrides", settingText, "", nil, nil, nil, false, true, false, "Absolute directory containing Cluster projects, Library files, exports, runtime data, and system state."},
	{"uploadRootOverride", "Upload root override", "Storage · Path overrides", settingText, "", nil, nil, nil, false, true, false, "Absolute directory used for uploaded file payloads when it must differ from the main data root."},
	{"configFileOverride", "Config file override", "Storage · Path overrides", settingText, "", nil, nil, nil, false, true, false, "Absolute path to the JSON configuration file loaded at startup."},
	{"databaseUrlOverride", "Database URL override", "Storage · Path overrides", settingSecret, "", nil, nil, nil, false, true, true, "Protected PostgreSQL connection URL. Blank keeps the existing database connection."},
	{"autoSeed", "Seed starter data on empty database", "Storage · Startup", settingBoolean, true, []string{"false", "true"}, nil, nil, false, true, false, "Create starter workspace data when the database is empty."},

	{"backupEnabled", "Enable scheduled backups", "Backups · Schedule", settingBoolean, false, []string{"false", "true"}, nil, nil, false, false, false, "Run automatic backups using the schedule and retention rules below."},
	{"backupFrequency", "Frequency", "Backups · Schedule", settingSelect, "daily", []string{"hourly", "daily", "weekly", "monthly", "custom"}, nil, nil, false, false, false, "Base recurrence used by the backup scheduler."},
	{"backupScheduleDate", "Start date", "Backups · Schedule", settingText, "", nil, nil, nil, false, false, false, "First date on which the configured backup schedule is allowed to run (YYYY-MM-DD)."},
	{"backupScheduleTime", "Run time", "Backups · Schedule", settingText, "03:00", nil, nil, nil, false, false, false, "Local clock time used for scheduled backup runs (HH:MM)."},
	{"backupScheduleDaysCsv", "Scheduled days", "Backups · Schedule", settingText, "Mon, Tue, Wed, Thu, Fri", nil, nil, nil, false, false, false, "Comma-separated weekdays allowed for weekly or custom backup runs."},
	{"backupTimezone", "Timezone", "Backups · Schedule", settingText, "America/New_York", nil, nil, nil, false, false, false, "IANA timezone used to interpret the backup date and time."},
	{"backupScheduleRule", "Custom schedule rule", "Backups · Schedule", settingTextarea, "Run backup into data/system/backups", nil, nil, nil, false, false, false, "Advanced recurrence rule used only when Frequency is Custom."},
	{"backupRetentionDays", "Retention (days)", "Backups · Verification and retention", settingNumber, 14, nil, num(1), num(3650), true, false, false, "Delete automatic backup files older than this age after a successful newer backup exists."},
	{"backupVerifyAfterCreate", "Verify every new backup", "Backups · Verification and retention", settingBoolean, true, []string{"false", "true"}, nil, nil, false, false, false, "Read and validate each backup immediately after creation."},

	{"discordWebhookUrl", "Discord webhook URL", "Integrations · Discord", settingSecret, "", nil, nil, nil, false, false, true, "Webhook credential used for Discord notifications. Blank keeps the existing protected value."},
	{"discordVoiceUrl", "Discord voice/channel URL", "Integrations · Discord", settingText, "", nil, nil, nil, false, false, false, "Discord channel URL used by workspace links."},
	{"discordMessagePrefix", "Discord message prefix", "Integrations · Discord", settingText, "", nil, nil, nil, false, false, false, "Optional prefix added to Discord messages."},
	{"discordBotToken", "Discord bot token", "Integrations · Discord", settingSecret, "", nil, nil, nil, false, false, true, "Bot credential used for Discord API operations. Blank keeps the existing protected value."},
	{"discordGuildId", "Discord guild ID", "Integrations · Discord", settingText, "", nil, nil, nil, false, false, false, "Discord guild identifier."},
	{"discordForumChannelId", "Discord forum channel ID", "Integrations · Discord", settingText, "", nil, nil, nil, false, false, false, "Discord forum channel identifier."},
	{"discordChatChannelId", "Discord chat channel ID", "Integrations · Discord", settingText, "", nil, nil, nil, false, false, false, "Discord chat channel identifier."},
	{"discordAdminRoleId", "Discord admin role ID", "Integrations · Discord", settingText, "", nil, nil, nil, false, false, false, "Discord role identifier treated as an administrative role."},

	{"giteaBaseUrl", "Git service base URL", "Integrations · Git", settingText, "", nil, nil, nil, false, false, false, "Base URL of the Git service API, including scheme and any installation subpath."},
	{"giteaAllowPrivateNetwork", "Allow private/LAN Git server", "Integrations · Git", settingBoolean, false, []string{"false", "true"}, nil, nil, false, false, false, "Allow the Git integration to connect to trusted RFC1918, loopback, or ULA addresses."},
	{"giteaToken", "Git access token", "Integrations · Git", settingSecret, "", nil, nil, nil, false, false, true, "Git service access token. Blank keeps the existing protected value."},
	{"giteaDefaultOwner", "Default Git owner/organization", "Integrations · Git", settingText, "", nil, nil, nil, false, false, false, "Fallback Git owner or organization."},
	{"giteaDefaultRepo", "Default Git repository", "Integrations · Git", settingText, "", nil, nil, nil, false, false, false, "Fallback repository used when no project-specific repository is configured."},
	{"gitProviderLabel", "Git provider label", "Integrations · Git", settingText, "Git", nil, nil, nil, false, false, false, "Display label for the configured Git service."},
	{"gitImportClosedIssues", "Import closed Git issues", "Integrations · Git", settingBoolean, true, []string{"false", "true"}, nil, nil, false, false, false, "Include closed issues during imports and refreshes."},
	{"gitAutoRefreshLinkedCards", "Auto-refresh linked cards", "Integrations · Git", settingBoolean, true, []string{"false", "true"}, nil, nil, false, false, false, "Automatically refresh cards linked to Git issues."},
}

func nativeSettingSections() []string {
	seen := map[string]bool{}
	result := []string{"Updates"}
	for _, spec := range nativeServerSettings {
		if !seen[spec.Section] {
			seen[spec.Section] = true
			result = append(result, spec.Section)
		}
	}
	result = append(result, "Control panel")
	return result
}

func nativeSettingsForSection(section string) []nativeSettingSpec {
	if section == "Updates" {
		return []nativeSettingSpec{
			{Key: "native.updateChannel", Label: "Server update channel", Section: "Updates", Kind: settingSelect, Default: "main", Options: []string{"main", "development"}, Help: "Main uses reviewed Server releases; development uses test releases. This never changes Desktop or Web update channels."},
			{Key: "native.updateManifestUrl", Label: "Main: signed manifest feed", Section: "Updates", Kind: settingText, Default: "", Help: "Paste the HTTPS URL for a signed JSON Cluster Server update manifest, NOT a .exe download URL or GitHub release page. An official manual installer is separate from a feed."},
			{Key: "native.developmentUpdateManifestUrl", Label: "Development: signed manifest feed", Section: "Updates", Kind: settingText, Default: "", Help: "Paste the HTTPS URL for a development-channel signed JSON Cluster Server manifest. Do not paste an installer, repository or release page."},
		}
	}
	if section == "Control panel" {
		return []nativeSettingSpec{
			{Key: "native.useInterface", Label: "Use visual interface", Section: "Control panel", Kind: settingBoolean, Default: true, Options: []string{"No", "Yes"}, Help: "Choose whether ClusterServer.exe opens the lightweight native control panel. No uses command-line mode."},
			{Key: "native.darkMode", Label: "Dark mode", Section: "Control panel", Kind: settingBoolean, Default: false, Options: []string{"No", "Yes"}, Help: "Use the dark visual theme for the native Windows control panel."},
			{Key: "native.startServerOnLaunch", Label: "Start server when ClusterServer opens", Section: "Control panel", Kind: settingBoolean, Default: false, Options: []string{"false", "true"}, Help: "When the visual interface opens normally, start the managed Cluster server automatically. Command-line mode always starts the server immediately."},
			{Key: "native.alwaysOnTop", Label: "Always on top", Section: "Control panel", Kind: settingBoolean, Default: false, Options: []string{"false", "true"}, Help: "Keep the native control panel above other application windows; does not affect server processes."},
			{Key: "native.minimizeToTray", Label: "Minimize to notification area", Section: "Control panel", Kind: settingBoolean, Default: false, Options: []string{"false", "true"}, Help: "Hide the window in the Windows system tray when minimized; the server is not stopped."},
			{Key: "native.closeToTray", Label: "Close button hides to notification area", Section: "Control panel", Kind: settingBoolean, Default: false, Options: []string{"false", "true"}, Help: "Leave control panel available in the tray when clicking X. Exit control panel through the tray menu."},
			{Key: "native.startMinimized", Label: "Start control panel minimized", Section: "Control panel", Kind: settingBoolean, Default: false, Options: []string{"false", "true"}, Help: "Open control panel minimized; with tray minimize enabled it starts hidden in the tray."},
			{Key: "native.startWithWindows", Label: "Start Cluster Server with Windows", Section: "Control panel", Kind: settingBoolean, Default: false, Options: []string{"false", "true"}, Help: "Open the control panel at Windows sign-in using a Scheduled Task. Optional independently installed Windows Service starts before sign-in; the control panel will attach to it instead of starting a duplicate server."},
		}
	}
	out := []nativeSettingSpec{}
	for _, spec := range nativeServerSettings {
		if spec.Section == section {
			out = append(out, spec)
		}
	}
	return out
}

func findNativeSetting(key string) (nativeSettingSpec, bool) {
	if strings.HasPrefix(key, "native.") {
		for _, section := range []string{"Updates", "Control panel"} {
			for _, spec := range nativeSettingsForSection(section) {
				if spec.Key == key {
					return spec, true
				}
			}
		}
	}
	for _, spec := range nativeServerSettings {
		if spec.Key == key {
			return spec, true
		}
	}
	return nativeSettingSpec{}, false
}

type clusterConfigDisk struct {
	Version         int            `json:"version,omitempty"`
	UpdatedAt       string         `json:"updatedAt,omitempty"`
	SecretPolicy    string         `json:"secretPolicy,omitempty"`
	EncryptionKeyID any            `json:"encryptionKeyId,omitempty"`
	Settings        map[string]any `json:"settings"`
}

func serverConfigPath(root string) string {
	if explicit := strings.TrimSpace(os.Getenv("CLUSTER_CONFIG_FILE")); explicit != "" {
		return explicit
	}
	return filepath.Join(root, "data", "system", "config", "cluster.config.json")
}

func loadServerConfig(root string) (clusterConfigDisk, error) {
	path := serverConfigPath(root)
	raw, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return clusterConfigDisk{Version: 2, SecretPolicy: "server-managed-only", Settings: map[string]any{}}, nil
	}
	if err != nil {
		return clusterConfigDisk{}, err
	}
	var generic map[string]any
	if err := json.Unmarshal(raw, &generic); err != nil {
		return clusterConfigDisk{}, fmt.Errorf("config JSON is invalid: %w", err)
	}
	cfg := clusterConfigDisk{Version: 2, SecretPolicy: "server-managed-only", Settings: map[string]any{}}
	if versionValue, ok := generic["version"].(float64); ok {
		cfg.Version = int(versionValue)
	}
	if value, ok := generic["updatedAt"].(string); ok {
		cfg.UpdatedAt = value
	}
	if value, ok := generic["secretPolicy"].(string); ok {
		cfg.SecretPolicy = value
	}
	cfg.EncryptionKeyID = generic["encryptionKeyId"]
	if nested, ok := generic["settings"].(map[string]any); ok {
		cfg.Settings = nested
	} else {
		// Legacy flat files are accepted because the server itself still migrates them.
		for key, value := range generic {
			if key == "version" || key == "updatedAt" || key == "secretPolicy" || key == "encryptionKeyId" {
				continue
			}
			cfg.Settings[key] = value
		}
	}
	return cfg, nil
}

func saveServerConfig(root string, cfg clusterConfigDisk) error {
	path := serverConfigPath(root)
	if cfg.Settings == nil {
		cfg.Settings = map[string]any{}
	}
	if _, err := parseNativeNetwork(cfg.Settings); err != nil {
		return fmt.Errorf("invalid network settings; existing configuration preserved: %w", err)
	}
	cfg.Version = 2
	cfg.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	if cfg.SecretPolicy == "" {
		cfg.SecretPolicy = "server-managed-only"
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	raw, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	temporary := fmt.Sprintf("%s.tmp-%d", path, os.Getpid())
	if err := os.WriteFile(temporary, append(raw, '\n'), 0o600); err != nil {
		return err
	}
	if err := os.Rename(temporary, path); err != nil {
		_ = os.Remove(temporary)
		return err
	}
	_ = os.Chmod(path, 0o600)
	return nil
}

type nativePanelPreferences struct {
	Configured          bool   `json:"configured"`
	UseInterface        bool   `json:"useInterface"`
	DarkMode            bool   `json:"darkMode"`
	PerformanceView     *bool  `json:"performanceView,omitempty"`
	AutoScrollLogs      *bool  `json:"autoScrollLogs,omitempty"`
	StartServerOnLaunch bool   `json:"startServerOnLaunch"`
	StartWithWindows    bool   `json:"startWithWindows"`
	AlwaysOnTop         bool   `json:"alwaysOnTop"`
	MinimizeToTray      bool   `json:"minimizeToTray"`
	CloseToTray         bool   `json:"closeToTray"`
	StartMinimized      bool   `json:"startMinimized"`
	UpdateManifestURL   string `json:"updateManifestUrl"`
	DevelopmentUpdateManifestURL string `json:"developmentUpdateManifestUrl"`
	UpdateChannel string `json:"updateChannel"`
}

// New installs expose the performance dashboard by default. An explicit saved
// false remains respected for people who intentionally hid it.
func nativePerformanceEnabled(prefs nativePanelPreferences) bool {
	return prefs.PerformanceView == nil || *prefs.PerformanceView
}

func nativeAutoScrollEnabled(prefs nativePanelPreferences) bool {
	return prefs.AutoScrollLogs == nil || *prefs.AutoScrollLogs
}

func nativePanelPreferencesPath(root string) string {
	return filepath.Join(root, "data", "system", "config", "windows-server-ui.json")
}
func loadNativePanelPreferences(root string) nativePanelPreferences {
	raw, err := os.ReadFile(nativePanelPreferencesPath(root))
	if err != nil {
		return nativePanelPreferences{UseInterface: true}
	}
	var prefs nativePanelPreferences
	if json.Unmarshal(raw, &prefs) != nil {
		return nativePanelPreferences{UseInterface: true}
	}
	if prefs.UpdateChannel != "main" && prefs.UpdateChannel != "development" {
		prefs.UpdateChannel = "main"
	}
	if !prefs.Configured {
		// v0.450 only stored the update URL. Preserve it while making the next
		// launch ask for a mode before any server/bootstrap work begins.
		prefs.UseInterface = true
	}
	return prefs
}
func saveNativePanelPreferences(root string, prefs nativePanelPreferences) error {
	path := nativePanelPreferencesPath(root)
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	raw, _ := json.MarshalIndent(prefs, "", "  ")
	return os.WriteFile(path, append(raw, '\n'), 0o600)
}

func settingDisplayValue(root string, spec nativeSettingSpec) (string, bool, error) {
	if strings.HasPrefix(spec.Key, "native.") {
		prefs := loadNativePanelPreferences(root)
		switch spec.Key {
		case "native.useInterface":
			if prefs.UseInterface {
				return "Yes", prefs.Configured, nil
			}
			return "No", prefs.Configured, nil
		case "native.darkMode":
			if prefs.DarkMode {
				return "Yes", prefs.Configured, nil
			}
			return "No", prefs.Configured, nil
		case "native.startServerOnLaunch":
			return strconv.FormatBool(prefs.StartServerOnLaunch), prefs.Configured, nil
		case "native.alwaysOnTop":
			return strconv.FormatBool(prefs.AlwaysOnTop), prefs.Configured, nil
		case "native.minimizeToTray":
			return strconv.FormatBool(prefs.MinimizeToTray), prefs.Configured, nil
		case "native.closeToTray":
			return strconv.FormatBool(prefs.CloseToTray), prefs.Configured, nil
		case "native.startMinimized":
			return strconv.FormatBool(prefs.StartMinimized), prefs.Configured, nil
		case "native.startWithWindows":
			return strconv.FormatBool(prefs.StartWithWindows), prefs.Configured, nil
		case "native.updateChannel":
			return prefs.UpdateChannel, prefs.UpdateChannel != "", nil
		case "native.updateManifestUrl":
			return prefs.UpdateManifestURL, prefs.UpdateManifestURL != "", nil
		case "native.developmentUpdateManifestUrl":
			return prefs.DevelopmentUpdateManifestURL, prefs.DevelopmentUpdateManifestURL != "", nil
		}
	}
	cfg, err := loadServerConfig(root)
	if err != nil {
		return "", false, err
	}
	value, exists := cfg.Settings[spec.Key]
	if !exists {
		value = spec.Default
	}
	if spec.Sensitive {
		if exists && strings.TrimSpace(fmt.Sprint(value)) != "" {
			return "", true, nil
		}
		return "", false, nil
	}
	switch typed := value.(type) {
	case bool:
		return strconv.FormatBool(typed), exists, nil
	case float64:
		if typed == float64(int64(typed)) {
			return strconv.FormatInt(int64(typed), 10), exists, nil
		}
		return strconv.FormatFloat(typed, 'f', -1, 64), exists, nil
	case nil:
		return "", exists, nil
	default:
		return fmt.Sprint(typed), exists, nil
	}
}

func parseNativeSettingValue(spec nativeSettingSpec, raw string) (any, error) {
	value := strings.TrimSpace(raw)
	// A release EXE is not a JSON feed. Reject this mistake at Save instead
	// of downloading megabytes just to show an opaque 256 KiB error.
	if (spec.Key == "native.updateManifestUrl" || spec.Key == "native.developmentUpdateManifestUrl") && value != "" {
		uri, err := url.Parse(value)
		if err != nil || !allowedServerUpdateURL(uri) {
			return nil, fmt.Errorf("Server update feeds require credential-free HTTPS (localhost HTTP only)")
		}
		if hint := serverUpdateFeedLinkHint(uri); hint != "" {
			return nil, errors.New(hint)
		}
	}
	if spec.Kind == settingSecret || spec.Kind == settingText || spec.Kind == settingTextarea {
		if strings.HasSuffix(strings.ToLower(spec.Key), "url") && value != "" {
			parsed, err := url.Parse(value)
			if err != nil || parsed.Scheme == "" {
				return nil, fmt.Errorf("enter a complete URL including http:// or https://")
			}
			if parsed.Scheme != "http" && parsed.Scheme != "https" && spec.Key != "databaseUrlOverride" {
				return nil, fmt.Errorf("only http:// and https:// URLs are accepted here")
			}
		}
		return raw, nil
	}
	if spec.Kind == settingBoolean {
		switch strings.ToLower(value) {
		case "true", "1", "yes", "on", "enabled":
			return true, nil
		case "false", "0", "no", "off", "disabled":
			return false, nil
		default:
			return nil, fmt.Errorf("enter true or false")
		}
	}
	if spec.Kind == settingSelect {
		for _, option := range spec.Options {
			if strings.EqualFold(option, value) {
				return option, nil
			}
		}
		return nil, fmt.Errorf("choose one of: %s", strings.Join(spec.Options, ", "))
	}
	if spec.Kind == settingNumber {
		number, err := strconv.ParseFloat(value, 64)
		if err != nil {
			return nil, fmt.Errorf("enter a number")
		}
		if spec.Min != nil && number < *spec.Min {
			return nil, fmt.Errorf("minimum is %v", *spec.Min)
		}
		if spec.Max != nil && number > *spec.Max {
			return nil, fmt.Errorf("maximum is %v", *spec.Max)
		}
		if spec.Integer {
			if number != float64(int64(number)) {
				return nil, fmt.Errorf("enter a whole number")
			}
			return int64(number), nil
		}
		return number, nil
	}
	return raw, nil
}

func saveNativeSetting(root string, spec nativeSettingSpec, raw string, clear bool) error {
	if strings.HasPrefix(spec.Key, "native.") {
		prefs := loadNativePanelPreferences(root)
		prefs.Configured = true
		if clear {
			switch spec.Key {
			case "native.useInterface":
				prefs.UseInterface = true
			case "native.darkMode":
				prefs.DarkMode = false
			case "native.startServerOnLaunch":
				prefs.StartServerOnLaunch = false
			case "native.alwaysOnTop":
				prefs.AlwaysOnTop = false
			case "native.minimizeToTray":
				prefs.MinimizeToTray = false
			case "native.closeToTray":
				prefs.CloseToTray = false
			case "native.startMinimized":
				prefs.StartMinimized = false
			case "native.startWithWindows":
				prefs.StartWithWindows = false
			case "native.updateChannel":
				prefs.UpdateChannel = "main"
			case "native.updateManifestUrl":
				prefs.UpdateManifestURL = ""
			case "native.developmentUpdateManifestUrl":
				prefs.DevelopmentUpdateManifestURL = ""
			}
		} else {
			parsed, err := parseNativeSettingValue(spec, raw)
			if err != nil {
				return err
			}
			switch spec.Key {
			case "native.useInterface":
				prefs.UseInterface = parsed.(bool)
			case "native.darkMode":
				prefs.DarkMode = parsed.(bool)
			case "native.startServerOnLaunch":
				prefs.StartServerOnLaunch = parsed.(bool)
			case "native.alwaysOnTop":
				prefs.AlwaysOnTop = parsed.(bool)
			case "native.minimizeToTray":
				prefs.MinimizeToTray = parsed.(bool)
			case "native.closeToTray":
				prefs.CloseToTray = parsed.(bool)
			case "native.startMinimized":
				prefs.StartMinimized = parsed.(bool)
			case "native.startWithWindows":
				prefs.StartWithWindows = parsed.(bool)
			case "native.updateChannel":
				prefs.UpdateChannel = parsed.(string)
			case "native.updateManifestUrl":
				prefs.UpdateManifestURL = strings.TrimSpace(fmt.Sprint(parsed))
			case "native.developmentUpdateManifestUrl":
				prefs.DevelopmentUpdateManifestURL = strings.TrimSpace(fmt.Sprint(parsed))
			}
		}
		if err := saveNativePanelPreferences(root, prefs); err != nil {
			return err
		}
		if spec.Key == "native.darkMode" && activeWindowsPanel != nil {
			activeWindowsPanel.applyTheme(prefs.DarkMode)
			if activeSettingsWindow != nil {
				activeSettingsWindow.applyTheme(prefs.DarkMode)
			}
		}
		if (spec.Key == "native.alwaysOnTop" || spec.Key == "native.minimizeToTray" || spec.Key == "native.closeToTray" || spec.Key == "native.startMinimized") && activeWindowsPanel != nil {
			activeWindowsPanel.applyWindowPreferences(prefs)
		}
		if spec.Key == "native.startWithWindows" {
			return syncWindowsStartupRegistration(prefs.StartWithWindows)
		}
		return nil
	}
	cfg, err := loadServerConfig(root)
	if err != nil {
		return err
	}
	if clear {
		delete(cfg.Settings, spec.Key)
	} else {
		if spec.Sensitive && strings.TrimSpace(raw) == "" {
			return nil
		}
		parsed, err := parseNativeSettingValue(spec, raw)
		if err != nil {
			return err
		}
		cfg.Settings[spec.Key] = parsed
	}
	return saveServerConfig(root, cfg)
}

func syncWindowsStartupRegistration(enabled bool) error {
	const taskName = `Cluster Server`
	// Remove the old HKCU Run entry from v0.451.0 so upgraded servers do not launch
	// twice. An elevated scheduled task is required now that ClusterServer.exe
	// requests administrator rights on normal launches.
	const legacyRunKey = `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`
	legacy := exec.Command("reg.exe", "DELETE", legacyRunKey, "/v", "ClusterServer", "/f")
	configureChildProcess(legacy)
	_ = legacy.Run()

	if !enabled {
		cmd := exec.Command("schtasks.exe", "/Delete", "/TN", taskName, "/F")
		configureChildProcess(cmd)
		_ = cmd.Run() // Missing task is already the desired state.
		return nil
	}
	executable, err := os.Executable()
	if err != nil {
		return fmt.Errorf("could not resolve ClusterServer.exe for Windows startup: %w", err)
	}
	taskCommand := fmt.Sprintf(`"%s" --startup`, executable)
	cmd := exec.Command("schtasks.exe", "/Create", "/SC", "ONLOGON", "/TN", taskName, "/TR", taskCommand, "/RL", "HIGHEST", "/F")
	configureChildProcess(cmd)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("could not update elevated Windows startup task: %w: %s", err, strings.TrimSpace(string(output)))
	}
	return nil
}

type updateCheckResult struct {
	Message     string
	DownloadURL string
	Available   bool
}

func configuredUpdateManifestURL(root string) string {
	prefs := loadNativePanelPreferences(root)
	if prefs.UpdateChannel == "development" {
		if override := strings.TrimSpace(os.Getenv("CLUSTER_SERVER_DEVELOPMENT_MANIFEST_URL")); override != "" { return override }
		return strings.TrimSpace(prefs.DevelopmentUpdateManifestURL)
	}
	if override := strings.TrimSpace(os.Getenv("CLUSTER_SERVER_MAIN_MANIFEST_URL")); override != "" { return override }
	if legacy := strings.TrimSpace(os.Getenv("CLUSTER_UPDATE_MANIFEST_URL")); legacy != "" { return legacy }
	return strings.TrimSpace(prefs.UpdateManifestURL)
}

// A missing publisher-signed feed still permits a DISPLAY-ONLY check of the
// studio's canonical GitHub release. GitHub release metadata is never treated
// as an authenticated update manifest and cannot stage or execute an EXE.
func checkOfficialServerRelease(root string) updateCheckResult {
	const latestEndpoint = "https://api.github.com/repos/NotAzureStudios/Cluster/releases/latest"
	client := &http.Client{Timeout: 8*time.Second, CheckRedirect: func(req *http.Request, via []*http.Request) error {
		return errors.New("official release API redirected unexpectedly")
	}}
	req, err := http.NewRequest(http.MethodGet, latestEndpoint, nil)
	if err != nil { return updateCheckResult{Message:"No signed Server update feed is configured."} }
	req.Header.Set("User-Agent", "ClusterServer/"+version)
	req.Header.Set("Accept", "application/vnd.github+json")
	resp, err := client.Do(req)
	if err != nil { return updateCheckResult{Message:"No signed Server update feed configured; GitHub release check unavailable. Use the official Release page for manual updates."} }
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return updateCheckResult{Message:fmt.Sprintf("No signed Server update feed configured. Official GitHub release check returned HTTP %d; private repositories may require authentication.", resp.StatusCode)}
	}
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 256*1024+1))
	if err != nil || len(raw)>256*1024 { return updateCheckResult{Message:"Official release metadata could not be read within the size limit."} }
	var latest struct { TagName string `json:"tag_name"`; HTMLURL string `json:"html_url"` }
	if json.Unmarshal(raw, &latest)!=nil { return updateCheckResult{Message:"Official GitHub release metadata was invalid."} }
	release := strings.TrimPrefix(strings.TrimSpace(latest.TagName), "v")
	next, valid := serverUpdateSequence(release, "main")
	if !valid || !strings.HasPrefix(latest.HTMLURL,"https://github.com/NotAzureStudios/Cluster/releases/") {
		return updateCheckResult{Message:"Official release metadata did not identify a supported Cluster Server release."}
	}
	current := installedServerReleaseSequence(root)
	if current == 0 {
		return updateCheckResult{Message:fmt.Sprintf("Official release %s found. Installed release could not be verified; manual review required. A signed automatic-update feed is not configured.",release)}
	}
	if next > current {
		return updateCheckResult{Message:fmt.Sprintf("Cluster Server %s is published. Your installation is older. Manual upgrade: %s. One-click signed installation is not configured.",release,latest.HTMLURL)}
	}
	return updateCheckResult{Message:fmt.Sprintf("Latest official Server release is %s. No signed automatic-update feed is configured; installed release sequence %d.",release,current)}
}

func checkUpdateManifest(root string) updateCheckResult {
	prefs := loadNativePanelPreferences(root)
	channel := prefs.UpdateChannel
	if channel != "development" { channel = "main" }
	source := configuredUpdateManifestURL(root)
	if source == "" {
		if channel == "main" { return checkOfficialServerRelease(root) }
		return updateCheckResult{Message: "No signed development update feed is configured. Configure a trusted manifest URL in Settings → Updates."}
	}
	parsed, err := url.Parse(source)
	if err != nil || !allowedServerUpdateURL(parsed) {
		return updateCheckResult{Message: "Invalid release feed: use credential-free HTTPS (localhost HTTP only)."}
	}
	if hint := serverUpdateFeedLinkHint(parsed); hint != "" {
		return updateCheckResult{Message: hint}
	}
	client := &http.Client{Timeout: 8 * time.Second, CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) >= 5 || !sameServerUpdateOrigin(parsed, req.URL) { return errors.New("update feed redirected to another origin") }
		return nil
	}}
	req, err := http.NewRequest(http.MethodGet, source, nil)
	if err != nil { return updateCheckResult{Message: "Invalid update request: " + err.Error()} }
	req.Header.Set("User-Agent", "ClusterServer/"+version)
	response, err := client.Do(req)
	if err != nil { return updateCheckResult{Message: "Update check failed: " + err.Error()} }
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return updateCheckResult{Message: fmt.Sprintf("Update check returned HTTP %d.", response.StatusCode)}
	}
	raw, err := io.ReadAll(io.LimitReader(response.Body, 256*1024+1))
	if err != nil { return updateCheckResult{Message: "Update manifest could not be read: " + err.Error()} }
	if len(raw) > 256*1024 { return updateCheckResult{Message: "The update feed response is larger than the 256 KiB JSON manifest limit. Check that you pasted a signed JSON manifest URL, not a .exe installer download or a GitHub release page."} }
	if bytes := strings.TrimSpace(string(raw[:min(len(raw), 96)])); strings.HasPrefix(bytes, "MZ") || strings.HasPrefix(bytes, "PK") || strings.HasPrefix(strings.ToLower(bytes), "<!doctype") || strings.HasPrefix(strings.ToLower(bytes), "<html") {
		return updateCheckResult{Message: "The update URL returned an executable/archive or HTML page, not a signed JSON manifest. Configure the signed feed URL under Settings → Updates."}
	}
	manifest, err := verifyServerUpdateManifest(raw, parsed, channel)
	if err != nil { return updateCheckResult{Message: "Server update rejected: " + err.Error()} }
	current := installedServerReleaseSequence(root)
	if manifest.Sequence > current {
		return updateCheckResult{
			Message: fmt.Sprintf("%s Windows Server channel: signed Cluster %s (sequence %d) available; currently %s (sequence %d). Download only a matching verified installer.", channel, manifest.Release, manifest.Sequence, displayReleaseVersion(root), current),
			DownloadURL: manifest.Artifact.URL, Available:true,
		}
	}
	if manifest.Sequence == current { return updateCheckResult{Message: fmt.Sprintf("%s Windows Server channel is current (%s).", channel, displayReleaseVersion(root))} }
	return updateCheckResult{Message: fmt.Sprintf("Selected %s release %s is older than installed %s; automatic downgrades are disabled.",channel,manifest.Release,displayReleaseVersion(root))}
}

func firstManifestString(m map[string]any, keys ...string) string {
	for _, key := range keys {
		if value, ok := m[key].(string); ok && strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

var versionPart = regexp.MustCompile(`\d+`)

func compareVersions(a, b string) int {
	parse := func(value string) []int {
		parts := strings.Split(strings.TrimPrefix(strings.TrimSpace(value), "v"), ".")
		out := make([]int, 0, len(parts))
		for _, part := range parts {
			match := versionPart.FindString(part)
			if match == "" {
				out = append(out, 0)
				continue
			}
			n, _ := strconv.Atoi(match)
			out = append(out, n)
		}
		return out
	}
	left, right := parse(a), parse(b)
	n := len(left)
	if len(right) > n {
		n = len(right)
	}
	for i := 0; i < n; i++ {
		lv, rv := 0, 0
		if i < len(left) {
			lv = left[i]
		}
		if i < len(right) {
			rv = right[i]
		}
		if lv < rv {
			return -1
		}
		if lv > rv {
			return 1
		}
	}
	return 0
}

// Resource sampling is deliberately timer-driven and uses only cheap Win32 counters.
// Nothing is sampled while the native panel is not running.
type fileTime struct{ LowDateTime, HighDateTime uint32 }
type memoryStatusEx struct {
	Length                                                                                               uint32
	MemoryLoad                                                                                           uint32
	TotalPhys, AvailPhys, TotalPageFile, AvailPageFile, TotalVirtual, AvailVirtual, AvailExtendedVirtual uint64
}
type processMemoryCounters struct {
	Cb                                                                                                                                                                     uint32
	PageFaultCount                                                                                                                                                         uint32
	PeakWorkingSetSize, WorkingSetSize, QuotaPeakPagedPoolUsage, QuotaPagedPoolUsage, QuotaPeakNonPagedPoolUsage, QuotaNonPagedPoolUsage, PagefileUsage, PeakPagefileUsage uintptr
}
type resourceSnapshot struct {
	CPUPercent        float64
	MemoryPercent     uint32
	ServerMemoryBytes uint64
	DiskFreeBytes     uint64
	DiskTotalBytes    uint64
}
type systemResourceSampler struct {
	lastIdle, lastKernel, lastUser uint64
	initialized                    bool
}

var (
	procGetSystemTimes       = kernel32.NewProc("GetSystemTimes")
	procGlobalMemoryStatusEx = kernel32.NewProc("GlobalMemoryStatusEx")
	procGetDiskFreeSpaceExW  = kernel32.NewProc("GetDiskFreeSpaceExW")
	procOpenProcess          = kernel32.NewProc("OpenProcess")
	psapi                    = syscall.NewLazyDLL("psapi.dll")
	procGetProcessMemoryInfo = psapi.NewProc("GetProcessMemoryInfo")
)

func fileTimeValue(value fileTime) uint64 {
	return uint64(value.HighDateTime)<<32 | uint64(value.LowDateTime)
}
func (sampler *systemResourceSampler) sample(root string, pid int) resourceSnapshot {
	snapshot := resourceSnapshot{}
	var idle, kernel, user fileTime
	if ok, _, _ := procGetSystemTimes.Call(uintptr(unsafe.Pointer(&idle)), uintptr(unsafe.Pointer(&kernel)), uintptr(unsafe.Pointer(&user))); ok != 0 {
		i, k, u := fileTimeValue(idle), fileTimeValue(kernel), fileTimeValue(user)
		if sampler.initialized {
			idleDelta, totalDelta := i-sampler.lastIdle, (k-sampler.lastKernel)+(u-sampler.lastUser)
			if totalDelta > 0 && idleDelta <= totalDelta {
				snapshot.CPUPercent = float64(totalDelta-idleDelta) * 100 / float64(totalDelta)
			}
		}
		sampler.lastIdle, sampler.lastKernel, sampler.lastUser, sampler.initialized = i, k, u, true
	}
	mem := memoryStatusEx{Length: uint32(unsafe.Sizeof(memoryStatusEx{}))}
	if ok, _, _ := procGlobalMemoryStatusEx.Call(uintptr(unsafe.Pointer(&mem))); ok != 0 {
		snapshot.MemoryPercent = mem.MemoryLoad
	}
	var freeAvailable, total, totalFree uint64
	if ok, _, _ := procGetDiskFreeSpaceExW.Call(uintptr(unsafe.Pointer(utf16(root))), uintptr(unsafe.Pointer(&freeAvailable)), uintptr(unsafe.Pointer(&total)), uintptr(unsafe.Pointer(&totalFree))); ok != 0 {
		snapshot.DiskFreeBytes, snapshot.DiskTotalBytes = freeAvailable, total
	}
	if pid > 0 {
		const processQueryInformation = 0x0400
		const processVMRead = 0x0010
		handle, _, _ := procOpenProcess.Call(processQueryInformation|processVMRead, 0, uintptr(pid))
		if handle != 0 {
			counters := processMemoryCounters{Cb: uint32(unsafe.Sizeof(processMemoryCounters{}))}
			if ok, _, _ := procGetProcessMemoryInfo.Call(handle, uintptr(unsafe.Pointer(&counters)), uintptr(counters.Cb)); ok != 0 {
				snapshot.ServerMemoryBytes = uint64(counters.WorkingSetSize)
			}
			procCloseHandle.Call(handle)
		}
	}
	return snapshot
}

func formatBytesCompact(value uint64) string {
	const mib = 1024 * 1024
	const gib = 1024 * mib
	if value >= gib {
		return fmt.Sprintf("%.1f GB", float64(value)/float64(gib))
	}
	if value >= mib {
		return fmt.Sprintf("%.0f MB", float64(value)/float64(mib))
	}
	return fmt.Sprintf("%d KB", value/1024)
}
