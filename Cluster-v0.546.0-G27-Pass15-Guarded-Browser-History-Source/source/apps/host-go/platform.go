package main

import (
	"os"
	"os/exec"
	"runtime"
	"strings"
)

func openURL(target string) error {
	var command *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		command = exec.Command("rundll32", "url.dll,FileProtocolHandler", target)
	case "darwin":
		command = exec.Command("open", target)
	default:
		command = exec.Command("xdg-open", target)
	}
	return command.Start()
}

func mergedEnv(values map[string]string) []string {
	keys := map[string]struct{}{}
	for key := range values {
		keys[strings.ToUpper(key)] = struct{}{}
	}
	result := make([]string, 0, len(os.Environ())+len(values))
	for _, item := range os.Environ() {
		key := item
		if index := strings.IndexByte(item, '='); index >= 0 {
			key = item[:index]
		}
		if _, replace := keys[strings.ToUpper(key)]; !replace {
			result = append(result, item)
		}
	}
	for key, value := range values {
		result = append(result, key+"="+value)
	}
	return result
}

func fileExists(value string) bool {
	info, err := os.Stat(value)
	return err == nil && !info.IsDir()
}
