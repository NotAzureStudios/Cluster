package main

import (
	"crypto/ed25519"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/url"
	"os"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

const (
	maxManifestBytes = 256 * 1024
	maxArtifactBytes = int64(2 * 1024 * 1024 * 1024)
)

var (
	versionPattern = regexp.MustCompile(`^[0-9]+\.[0-9]+\.[0-9]+$`)
	sha256Pattern  = regexp.MustCompile(`^[0-9a-fA-F]{64}$`)
)

func canonicalJSON(value any) (string, error) {
	switch typed := value.(type) {
	case nil:
		return "null", nil
	case bool:
		if typed {
			return "true", nil
		}
		return "false", nil
	case string:
		encoded, _ := json.Marshal(typed)
		return string(encoded), nil
	case json.Number:
		if _, err := strconv.ParseFloat(string(typed), 64); err != nil {
			return "", err
		}
		return string(typed), nil
	case []any:
		parts := make([]string, 0, len(typed))
		for _, item := range typed {
			encoded, err := canonicalJSON(item)
			if err != nil {
				return "", err
			}
			parts = append(parts, encoded)
		}
		return "[" + strings.Join(parts, ",") + "]", nil
	case map[string]any:
		keys := make([]string, 0, len(typed))
		for key := range typed {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		parts := make([]string, 0, len(keys))
		for _, key := range keys {
			name, _ := json.Marshal(key)
			encoded, err := canonicalJSON(typed[key])
			if err != nil {
				return "", err
			}
			parts = append(parts, string(name)+":"+encoded)
		}
		return "{" + strings.Join(parts, ",") + "}", nil
	default:
		return "", fmt.Errorf("unsupported JSON value %T", value)
	}
}

func readManifest(path string) (map[string]any, error) {
	info, err := os.Stat(path)
	if err != nil {
		return nil, err
	}
	if info.Size() <= 0 || info.Size() > maxManifestBytes {
		return nil, fmt.Errorf("manifest size must be between 1 and %d bytes", maxManifestBytes)
	}
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	decoder := json.NewDecoder(io.LimitReader(file, maxManifestBytes+1))
	decoder.UseNumber()
	var manifest map[string]any
	if err := decoder.Decode(&manifest); err != nil {
		return nil, err
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		if err == nil {
			return nil, errors.New("manifest contains trailing JSON")
		}
		return nil, err
	}
	return manifest, nil
}

func readPublicKey(path string) (ed25519.PublicKey, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	block, rest := pem.Decode(data)
	if block == nil || len(strings.TrimSpace(string(rest))) != 0 {
		return nil, errors.New("public key PEM is invalid")
	}
	parsed, err := x509.ParsePKIXPublicKey(block.Bytes)
	if err != nil {
		return nil, err
	}
	key, ok := parsed.(ed25519.PublicKey)
	if !ok || len(key) != ed25519.PublicKeySize {
		return nil, errors.New("public key is not Ed25519")
	}
	return key, nil
}

func manifestString(manifest map[string]any, key string) (string, error) {
	value, ok := manifest[key].(string)
	if !ok || strings.TrimSpace(value) == "" {
		return "", fmt.Errorf("manifest %s is missing", key)
	}
	return value, nil
}

func manifestInteger(value any, label string) (int64, error) {
	number, ok := value.(json.Number)
	if !ok {
		return 0, fmt.Errorf("%s must be an integer", label)
	}
	parsed, err := strconv.ParseInt(string(number), 10, 64)
	if err != nil {
		return 0, fmt.Errorf("%s must be an integer", label)
	}
	return parsed, nil
}

func validateManifest(manifest map[string]any) error {
	schemaVersion, err := manifestInteger(manifest["schemaVersion"], "schemaVersion")
	if err != nil || schemaVersion != 1 {
		return errors.New("manifest schemaVersion must be 1")
	}
	product, err := manifestString(manifest, "product")
	if err != nil || product != "cluster-desktop" {
		return errors.New("manifest product must be cluster-desktop")
	}
	version, err := manifestString(manifest, "version")
	if err != nil || !versionPattern.MatchString(version) {
		return errors.New("manifest version must use numeric major.minor.patch format")
	}
	channel, err := manifestString(manifest, "channel")
	if err != nil || (channel != "stable" && channel != "beta" && channel != "nightly") {
		return errors.New("manifest channel must be stable, beta, or nightly")
	}
	publishedAt, err := manifestString(manifest, "publishedAt")
	if err != nil {
		return errors.New("manifest publishedAt must be an RFC3339 UTC timestamp")
	}
	parsedPublishedAt, parseErr := time.Parse(time.RFC3339, publishedAt)
	if parseErr != nil || parsedPublishedAt.Location() != time.UTC || !strings.HasSuffix(publishedAt, "Z") {
		return errors.New("manifest publishedAt must be an RFC3339 UTC timestamp")
	}
	artifacts, ok := manifest["artifacts"].([]any)
	if !ok || len(artifacts) == 0 || len(artifacts) > 16 {
		return errors.New("manifest artifacts must contain between 1 and 16 entries")
	}

	for index, raw := range artifacts {
		artifact, ok := raw.(map[string]any)
		if !ok {
			return fmt.Errorf("artifact %d must be an object", index)
		}
		platform, _ := artifact["platform"].(string)
		if platform != "windows" && platform != "linux" && platform != "macos" {
			return fmt.Errorf("artifact %d platform is invalid", index)
		}
		arch, _ := artifact["arch"].(string)
		if arch != "x64" && arch != "arm64" {
			return fmt.Errorf("artifact %d arch is invalid", index)
		}
		kind, _ := artifact["kind"].(string)
		if kind != "installer" && kind != "portable" && kind != "rollback" {
			return fmt.Errorf("artifact %d kind is invalid", index)
		}
		artifactVersion, _ := artifact["version"].(string)
		if !versionPattern.MatchString(artifactVersion) {
			return fmt.Errorf("artifact %d version is invalid", index)
		}
		filename, _ := artifact["filename"].(string)
		if filename == "" || filename == "." || filename == ".." || strings.ContainsAny(filename, `/\\`) {
			return fmt.Errorf("artifact %d filename is invalid", index)
		}
		// A signed Desktop manifest must never select the Windows Server
		// installer, even if both products share a publisher identity.
		if !strings.HasPrefix(strings.ToLower(filename), "cluster-desktop-") {
			return fmt.Errorf("artifact %d is not a Cluster Desktop distribution", index)
		}
		rawURL, _ := artifact["url"].(string)
		parsedURL, parseErr := url.Parse(rawURL)
		if rawURL == "" || parseErr != nil || parsedURL.User != nil || parsedURL.Fragment != "" {
			return fmt.Errorf("artifact %d URL is invalid", index)
		}
		if parsedURL.IsAbs() && parsedURL.Scheme != "https" && parsedURL.Scheme != "http" {
			return fmt.Errorf("artifact %d URL scheme is invalid", index)
		}
		checksum, _ := artifact["sha256"].(string)
		if !sha256Pattern.MatchString(checksum) {
			return fmt.Errorf("artifact %d SHA-256 is invalid", index)
		}
		size, sizeErr := manifestInteger(artifact["size"], fmt.Sprintf("artifact %d size", index))
		if sizeErr != nil || size <= 0 || size > maxArtifactBytes {
			return fmt.Errorf("artifact %d size must be between 1 and %d bytes", index, maxArtifactBytes)
		}
	}
	return nil
}

func verifyManifest(manifestPath, publicKeyPath string) error {
	manifest, err := readManifest(manifestPath)
	if err != nil {
		return err
	}
	rawSignature, ok := manifest["signature"].(string)
	if !ok || rawSignature == "" {
		return errors.New("manifest signature is missing")
	}
	signature, err := base64.StdEncoding.DecodeString(rawSignature)
	if err != nil {
		return fmt.Errorf("signature is not base64: %w", err)
	}
	if len(signature) != ed25519.SignatureSize {
		return errors.New("manifest signature length is invalid")
	}
	delete(manifest, "signature")
	canonical, err := canonicalJSON(manifest)
	if err != nil {
		return err
	}
	key, err := readPublicKey(publicKeyPath)
	if err != nil {
		return err
	}
	if !ed25519.Verify(key, []byte(canonical), signature) {
		return errors.New("manifest signature verification failed")
	}
	return validateManifest(manifest)
}

func verifyArtifact(artifactPath, expected string) error {
	if !sha256Pattern.MatchString(expected) {
		return errors.New("expected SHA-256 is invalid")
	}
	file, err := os.Open(artifactPath)
	if err != nil {
		return err
	}
	defer file.Close()
	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		return err
	}
	actual := hex.EncodeToString(hash.Sum(nil))
	if !strings.EqualFold(actual, expected) {
		return fmt.Errorf("checksum mismatch: got %s", actual)
	}
	return nil
}

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, "usage: cluster-update-helper <verify-manifest|verify-artifact>")
		os.Exit(2)
	}
	var err error
	switch os.Args[1] {
	case "verify-manifest":
		flags := flag.NewFlagSet("verify-manifest", flag.ContinueOnError)
		manifest := flags.String("manifest", "", "release manifest path")
		publicKey := flags.String("public-key", "", "Ed25519 public key path")
		if parseErr := flags.Parse(os.Args[2:]); parseErr != nil {
			err = parseErr
		} else if *manifest == "" || *publicKey == "" {
			err = errors.New("manifest and public-key are required")
		} else {
			err = verifyManifest(*manifest, *publicKey)
		}
	case "verify-artifact":
		flags := flag.NewFlagSet("verify-artifact", flag.ContinueOnError)
		artifact := flags.String("artifact", "", "artifact path")
		checksum := flags.String("sha256", "", "expected SHA-256")
		if parseErr := flags.Parse(os.Args[2:]); parseErr != nil {
			err = parseErr
		} else if *artifact == "" || *checksum == "" {
			err = errors.New("artifact and sha256 are required")
		} else {
			err = verifyArtifact(*artifact, *checksum)
		}
	default:
		err = fmt.Errorf("unknown command %q", os.Args[1])
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	fmt.Println(`{"ok":true}`)
}
