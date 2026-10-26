package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

func collectMSILifecycleSnapshot(root string) (os.FileInfo, []string, map[string]os.FileInfo, error) {
	var absent os.FileInfo
	dir := filepath.Join(root, "msi-lifecycle")
	if _, e := os.Lstat(dir); os.IsNotExist(e) {
		return absent, []string{}, map[string]os.FileInfo{}, nil
	} else if e != nil {
		return nil, nil, nil, e
	}
	if e := directoryNoLinks(dir); e != nil {
		return nil, nil, nil, e
	}
	info, e := os.Lstat(dir)
	if e != nil {
		return nil, nil, nil, e
	}
	handle, e := os.Open(dir)
	if e != nil {
		return nil, nil, nil, e
	}
	defer handle.Close()
	names, e := handle.Readdirnames(maxMSIProfileEntries + 1)
	if e != nil && !errors.Is(e, io.EOF) {
		return nil, nil, nil, e
	}
	if len(names) > maxMSIProfileEntries {
		return nil, nil, nil, errors.New("MSI lifecycle inventory bound exceeded")
	}
	sort.Strings(names)
	files := make(map[string]os.FileInfo, len(names))
	for _, name := range names {
		key := strings.TrimSuffix(name, ".json")
		if strings.HasPrefix(key, "rollback_") {
			key = strings.TrimPrefix(key, "rollback_")
		}
		if !strings.HasSuffix(name, ".json") || !validPackageKey(key) {
			return nil, nil, nil, errors.New("unknown MSI lifecycle custody entry")
		}
		stat, e := os.Lstat(filepath.Join(dir, name))
		if e != nil || !stat.Mode().IsRegular() || stat.Mode()&os.ModeSymlink != 0 || stat.Size() < 1 || stat.Size() > 4096 {
			return nil, nil, nil, errors.New("unsafe MSI lifecycle custody entry")
		}
		files[name] = stat
	}
	return info, names, files, nil
}

func readMSILifecycleInventory(root string, names []string) ([]msiRepairStatus, error) {
	out := make([]msiRepairStatus, 0, len(names))
	for _, name := range names {
		key := strings.TrimSuffix(name, ".json")
		rollbackName := strings.HasPrefix(key, "rollback_")
		if rollbackName {
			key = strings.TrimPrefix(key, "rollback_")
		}
		path := filepath.Join(root, "msi-lifecycle", name)
		stat, e := os.Lstat(path)
		if e != nil {
			return nil, e
		}
		raw, e := readStableMSIAttemptReceipt(path, stat)
		if e != nil {
			return nil, e
		}
		var header msiRepairReceipt
		decoder := json.NewDecoder(bytes.NewReader(raw))
		decoder.DisallowUnknownFields()
		if decoder.Decode(&header) != nil || decoder.Decode(new(any)) != io.EOF ||
			(header.Operation != "repair" && header.Operation != "uninstall" && header.Operation != "upgrade" && header.Operation != "msi-rollback") ||
			(rollbackName != (header.Operation == "msi-rollback")) {
			return nil, errors.New("unknown or invalid MSI lifecycle operation")
		}
		status, e := inspectMSILifecycle(root, key, header.Operation)
		if e != nil || !status.HasReceipt || !status.ManualReviewRequired || status.Receipt == nil || status.Receipt.Operation != header.Operation ||
			!status.ReadOnly || status.RetryAuthorized || status.OSAttested {
			return nil, errors.New("MSI lifecycle record inconsistent")
		}
		out = append(out, status)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].PackageKey == out[j].PackageKey {
			return out[i].Receipt.Operation < out[j].Receipt.Operation
		}
		return out[i].PackageKey < out[j].PackageKey
	})
	return out, nil
}
