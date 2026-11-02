package main

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
)

// Cap retained diagnostic evidence on long-running unattended servers.
// Rotate only the exact native-managed log, never data, database or Library paths.
func rotateNativeSessionLog(path string, maxBytes int64, backups int) error {
	if maxBytes <= 0 || backups < 1 {
		return fmt.Errorf("invalid native log retention policy")
	}
	info, err := os.Lstat(path)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() {
		return fmt.Errorf("refusing to open a nonregular native log at %s", filepath.Base(path))
	}
	if info.Size() < maxBytes {
		return nil
	}
	oldest := fmt.Sprintf("%s.%d", path, backups)
	if err := os.Remove(oldest); err != nil && !os.IsNotExist(err) {
		return err
	}
	for index := backups - 1; index >= 1; index-- {
		source := fmt.Sprintf("%s.%d", path, index)
		target := fmt.Sprintf("%s.%d", path, index+1)
		if _, err := os.Lstat(source); err == nil {
			if err := os.Rename(source, target); err != nil {
				return err
			}
		} else if !os.IsNotExist(err) {
			return err
		}
	}
	return os.Rename(path, path+".1")
}

var nativeCredentialURL = regexp.MustCompile(`(?i)\b(postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s@]+@`)
var nativeSecretSetting = regexp.MustCompile(`(?i)\b(DATABASE_URL|DIRECT_DATABASE_URL|POSTGRES_PASSWORD|SESSION_SECRET|CLUSTER_AUTH_SECRET|CLUSTER_SECRET_KEY|CLUSTER_UPDATE_TOKEN|AUTHORIZATION)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)`)

func redactNativeLogLine(line string) string {
	line = nativeCredentialURL.ReplaceAllString(line, "${1}://[REDACTED]@")
	return nativeSecretSetting.ReplaceAllString(line, "${1}=[REDACTED]")
}
