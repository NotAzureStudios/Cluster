//go:build windows

package main

import (
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

type serverUpdateResponseTransport func(*http.Request) (*http.Response, error)

func (transport serverUpdateResponseTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	return transport(request)
}

func serverUpdateResponse(status int, body string, declaredLength int64) *http.Response {
	return &http.Response{
		StatusCode: status,
		Body: io.NopCloser(strings.NewReader(body)),
		Header: http.Header{"Content-Type": []string{"text/html"}},
		ContentLength: declaredLength,
	}
}

func serverUpdateDiscoveryFixture(t *testing.T) string {
	t.Helper()
	for _, name := range []string{
		"CLUSTER_UPDATE_MANIFEST_URL",
		"CLUSTER_SERVER_MAIN_MANIFEST_URL",
		"CLUSTER_SERVER_DEVELOPMENT_MANIFEST_URL",
	} {
		t.Setenv(name, "")
	}
	root := t.TempDir()
	// The currently installed stable release is authoritative for comparisons.
	marker := []byte(`{"schema":1,"managedInstaller":true,"releaseChannel":"stable","releaseCandidate":"1.0.5","releaseSequence":55}`)
	if err := os.WriteFile(filepath.Join(root, "CLUSTER_RELEASE.json"), marker, 0600); err != nil {
		t.Fatal(err)
	}
	return root
}

func TestOfficialUnpublishedServerFeedFallsBackToReadOnlyReleaseDiscovery(t *testing.T) {
	for _, test := range []struct {
		name string
		status int
		body string
		contentLength int64
	}{
		{"missing signed release", http.StatusNotFound, "<html>Not Found</html>", int64(len("<html>Not Found</html>"))},
		{"oversized github response advertised", http.StatusOK, "MZ", maxServerManifestBytes + 1024},
		{"oversized streamed github response", http.StatusOK, strings.Repeat("<", maxServerManifestBytes+1), -1},
		{"github release HTML page", http.StatusOK, "<!doctype html><html>Not a signed feed</html>", 51},
		{"installer masquerading as JSON", http.StatusOK, "MZ0123456789", 12},
	} {
		t.Run(test.name, func(t *testing.T) {
			root := serverUpdateDiscoveryFixture(t)
			calls := 0
			transport := serverUpdateResponseTransport(func(request *http.Request) (*http.Response, error) {
				if request.URL.String() != defaultOfficialMainServerUpdateFeedURL {
					t.Fatalf("unexpected request: %s", request.URL)
				}
				return serverUpdateResponse(test.status, test.body, test.contentLength), nil
			})
			result := checkUpdateManifestWithTransport(root, transport, func(_ string) updateCheckResult {
				calls++
				// An informational response may NEVER grant update authority.
				return updateCheckResult{
					Message: "Cluster Server 1.0.5 is the latest published release; signed updates are not configured.",
					Available: true,
					DownloadURL: "https://example.test/must-not-stage.exe",
				}
			})
			if calls != 1 {
				t.Fatalf("expected one release metadata fallback, called %d times", calls)
			}
			if result.Available || result.DownloadURL != "" {
				t.Fatalf("unsigned fallback offered executable download: %+v", result)
			}
			if !strings.Contains(result.Message, "1.0.5") || !strings.Contains(result.Message, "Signed automatic-update feed unavailable") {
				t.Fatalf("missing actionable release explanation: %s", result.Message)
			}
		})
	}
}

func TestCustomServerFeedAndInvalidOfficialSignatureNeverUseUnsignedFallback(t *testing.T) {
	for _, test := range []struct {
		name string
		source string
		status int
		body string
	}{
		{"custom oversized response", "https://updates.example.test/server/manifest.json", http.StatusOK, strings.Repeat("A", maxServerManifestBytes+1)},
		{"custom not found", "https://updates.example.test/server/manifest.json", http.StatusNotFound, "not found"},
		{"custom HTML page", "https://updates.example.test/server/manifest.json", http.StatusOK, "<!doctype html><html>not a manifest</html>"},
		{"official JSON signature rejected", defaultOfficialMainServerUpdateFeedURL, http.StatusOK, `{"schemaVersion":1,"signature":"tampered"}`},
	} {
		t.Run(test.name, func(t *testing.T) {
			root := serverUpdateDiscoveryFixture(t)
			prefs := loadNativePanelPreferences(root)
			prefs.UpdateChannel = "main"
			prefs.UpdateManifestURL = test.source
			if err := saveNativePanelPreferences(root, prefs); err != nil {
				t.Fatal(err)
			}
			calls := 0
			transport := serverUpdateResponseTransport(func(request *http.Request) (*http.Response, error) {
				return serverUpdateResponse(test.status, test.body, int64(len(test.body))), nil
			})
			result := checkUpdateManifestWithTransport(root, transport, func(_ string) updateCheckResult {
				calls++
				return updateCheckResult{Message: "must not be used"}
			})
			if calls != 0 || result.Available || result.DownloadURL != "" {
				t.Fatalf("untrusted feed gained fallback or installation authority: %+v (calls=%d)", result, calls)
			}
			if !strings.Contains(result.Message, "feed") && !strings.Contains(result.Message, "manifest") && !strings.Contains(result.Message, "rejected") {
				t.Fatalf("missing feed error: %s", result.Message)
			}
		})
	}
}

func TestCanonicalGitHubReleaseMetadataIsInformationalOnly(t *testing.T) {
	for _, test := range []struct{
		tag string
		expected string
	}{
		{"v1.0.5", "latest published release"},
		{"v1.0.6", "Your installation is older"},
	} {
		t.Run(test.tag, func(t *testing.T) {
			root := serverUpdateDiscoveryFixture(t)
			transport := serverUpdateResponseTransport(func(request *http.Request) (*http.Response, error) {
				if request.URL.String() != "https://api.github.com/repos/NotAzureStudios/Cluster/releases/latest" {
					t.Fatalf("unexpected release API: %s", request.URL)
				}
				body := `{"tag_name":"` + test.tag + `","html_url":"https://github.com/NotAzureStudios/Cluster/releases/tag/` + test.tag + `","assets":[{"name":"Cluster-Installer.exe"},{"name":"Cluster-server-build-receipt.json"}]}`
				return serverUpdateResponse(http.StatusOK, body, int64(len(body))), nil
			})
			lookup := checkOfficialServerReleaseWithClient(root, &http.Client{Timeout: time.Second, Transport: transport})
			if lookup.Available || lookup.DownloadURL != "" || !strings.Contains(lookup.Message, test.expected) {
				t.Fatalf("release metadata not safely displayed: %+v", lookup)
			}
			if (test.tag == "v1.0.6") != (lookup.ManualReleaseURL != "") {
				t.Fatalf("manual release link offered for wrong version: %+v", lookup)
			}
		})
	}
}

func TestOfficialReleaseRequiresExactProjectTagAndServerInstallerReceipt(t *testing.T) {
	for _, tc := range []struct {
		name string
		payload string
	}{
		{
			name: "desktop-only release",
			payload: `{"tag_name":"v1.0.6","html_url":"https://github.com/NotAzureStudios/Cluster/releases/tag/v1.0.6","assets":[{"name":"Cluster-Desktop-Installer.exe"}]}`,
		},
		{
			name: "server installer without receipt",
			payload: `{"tag_name":"v1.0.6","html_url":"https://github.com/NotAzureStudios/Cluster/releases/tag/v1.0.6","assets":[{"name":"Cluster-Installer.exe"}]}`,
		},
		{
			name: "incorrect release link",
			payload: `{"tag_name":"v1.0.6","html_url":"https://github.com/NotAzureStudios/Cluster/releases/tag/v1.0.5","assets":[{"name":"Cluster-Installer.exe"},{"name":"Cluster-server-build-receipt.json"}]}`,
		},
		{
			name: "other product release",
			payload: `{"tag_name":"v2.0.0","html_url":"https://github.com/NotAzureStudios/Cluster/releases/tag/v2.0.0","assets":[{"name":"Cluster-Installer.exe"},{"name":"Cluster-server-build-receipt.json"}]}`,
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			root := serverUpdateDiscoveryFixture(t)
			transport := serverUpdateResponseTransport(func(*http.Request) (*http.Response, error) {
				return serverUpdateResponse(http.StatusOK, tc.payload, int64(len(tc.payload))), nil
			})
			result := checkOfficialServerReleaseWithClient(root, &http.Client{Transport: transport, Timeout: time.Second})
			if result.Available || result.DownloadURL != "" || result.ManualReleaseURL != "" {
				t.Fatalf("incomplete or untrusted release was offered: %+v", result)
			}
		})
	}
}
