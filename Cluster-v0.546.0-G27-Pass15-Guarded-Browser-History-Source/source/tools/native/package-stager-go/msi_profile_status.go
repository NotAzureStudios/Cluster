package main

// Read-only, bounded MSI profile recovery inspection. Neither registration
// evidence nor a stable local inventory snapshot authorizes installation,
// retry, repair, uninstall, clearance of locks or OS-health claims.
import (
	"crypto/sha256"
	"errors"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

const maxMSIProfileEntries = 64

type msiProfileStatus struct {
	Schema                      int                 `json:"schema"`
	State                       string              `json:"state"`
	ReadOnly                    bool                `json:"readOnly"`
	OSAttested                  bool                `json:"osAttested"`
	RetryAuthorized             bool                `json:"retryAuthorized"`
	ManualReviewRequired        bool                `json:"manualReviewRequired"`
	AdmissionLockPresent        bool                `json:"admissionLockPresent"`
	Complete                    bool                `json:"complete"`
	Records                     []msiAttemptStatus  `json:"records"`
	DependencyEdges             []msiDependencyEdge `json:"dependencyEdges"`
	LifecycleMutationAuthorized bool                `json:"lifecycleMutationAuthorized"`
	LifecyclePlans              []msiLifecyclePlan  `json:"lifecyclePlans"`
	LifecycleRecords            []msiRepairStatus   `json:"lifecycleRecords"`
}

type msiProfileSnapshot struct {
	root           os.FileInfo
	attempts       os.FileInfo
	admission      os.FileInfo
	names          []string
	files          map[string]os.FileInfo
	lifecycleDir   os.FileInfo
	lifecycleNames []string
	lifecycleFiles map[string]os.FileInfo
}

func collectMSIProfileSnapshot(abs string) (msiProfileSnapshot, error) {
	var result msiProfileSnapshot
	if err := directoryNoLinks(abs); err != nil {
		return result, err
	}
	root, e := os.Lstat(abs)
	if e != nil {
		return result, e
	}
	result.root = root
	lock := filepath.Join(abs, "msi-admission.lock")
	if info, e := os.Lstat(lock); e == nil {
		if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return result, errors.New("unsafe MSI profile admission lock")
		}
		result.admission = info
	} else if !os.IsNotExist(e) {
		return result, e
	}
	dir := filepath.Join(abs, "msi-attempts")
	if _, e := os.Lstat(dir); os.IsNotExist(e) {
		result.lifecycleDir, result.lifecycleNames, result.lifecycleFiles, e = collectMSILifecycleSnapshot(abs)
		return result, e
	} else if e != nil {
		return result, e
	}
	if err := directoryNoLinks(dir); err != nil {
		return result, err
	}
	result.attempts, e = os.Lstat(dir)
	if e != nil {
		return result, e
	}
	d, e := os.Open(dir)
	if e != nil {
		return result, e
	}
	defer d.Close()
	names, e := d.Readdirnames(maxMSIProfileEntries + 1)
	if e != nil && !errors.Is(e, io.EOF) {
		return result, e
	}
	if len(names) > maxMSIProfileEntries {
		return result, errors.New("MSI profile inventory exceeds bounded inspection")
	}
	sort.Strings(names)
	result.names = names
	result.files = make(map[string]os.FileInfo, len(names))
	for _, name := range names {
		key := ""
		receipt := strings.HasSuffix(name, ".json")
		switch {
		case receipt:
			key = strings.TrimSuffix(name, ".json")
		case strings.HasSuffix(name, ".lock"):
			key = strings.TrimSuffix(name, ".lock")
		default:
			return result, errors.New("unknown MSI profile custody entry")
		}
		if !validPackageKey(key) {
			return result, errors.New("invalid MSI profile custody entry")
		}
		info, e := os.Lstat(filepath.Join(dir, name))
		if e != nil || info.Mode()&os.ModeSymlink != 0 ||
			(receipt && (!info.Mode().IsRegular() || info.Size() < 1 || info.Size() > 4096)) ||
			(!receipt && !info.IsDir()) {
			return result, errors.New("unsafe MSI profile custody entry")
		}
		result.files[name] = info
	}
	result.lifecycleDir, result.lifecycleNames, result.lifecycleFiles, e = collectMSILifecycleSnapshot(abs)
	return result, e
}

func sameMSIProfileFile(before, after os.FileInfo) bool {
	if before == nil || after == nil {
		return before == nil && after == nil
	}
	return os.SameFile(before, after) && before.Mode() == after.Mode() && before.Size() == after.Size() &&
		before.ModTime().Equal(after.ModTime())
}
func sameMSIProfileSnapshot(a, b msiProfileSnapshot) bool {
	if !sameMSIProfileFile(a.root, b.root) || !sameMSIProfileFile(a.attempts, b.attempts) ||
		!sameMSIProfileFile(a.lifecycleDir, b.lifecycleDir) ||
		!sameMSIProfileFile(a.admission, b.admission) || len(a.names) != len(b.names) {
		return false
	}
	for i, name := range a.names {
		if name != b.names[i] || !sameMSIProfileFile(a.files[name], b.files[name]) {
			return false
		}
	}
	if len(a.lifecycleNames) != len(b.lifecycleNames) {
		return false
	}
	for i, name := range a.lifecycleNames {
		if name != b.lifecycleNames[i] || !sameMSIProfileFile(a.lifecycleFiles[name], b.lifecycleFiles[name]) {
			return false
		}
	}
	return true
}

// Hash every durable receipt from the bounded start/end inventory, not only
// its FileInfo identity. An in-place rewrite can preserve inode, byte count,
// and modification time (including with a restored timestamp). Hashes do not
// attest Windows installer behavior or make observation atomic; they reject
// changes that the metadata-only snapshot could not detect.
func hashMSIProfileReceiptSnapshot(root string, snapshot msiProfileSnapshot) (map[string][32]byte, error) {
	result := make(map[string][32]byte, len(snapshot.names)+len(snapshot.lifecycleNames))
	collect := func(prefix, base string, names []string, files map[string]os.FileInfo) error {
		for _, name := range names {
			if !strings.HasSuffix(name, ".json") {
				continue
			}
			info := files[name]
			if info == nil || !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 || info.Size() < 1 || info.Size() > 4096 {
				return errors.New("unsafe MSI journal during receipt digest snapshot")
			}
			payload, err := readStableMSIAttemptReceipt(filepath.Join(root, base, name), info)
			if err != nil {
				return err
			}
			result[prefix+name] = sha256.Sum256(payload)
		}
		return nil
	}
	if err := collect("attempt:", "msi-attempts", snapshot.names, snapshot.files); err != nil {
		return nil, err
	}
	if err := collect("lifecycle:", "msi-lifecycle", snapshot.lifecycleNames, snapshot.lifecycleFiles); err != nil {
		return nil, err
	}
	return result, nil
}

func sameMSIProfileReceiptDigests(a, b map[string][32]byte) bool {
	if len(a) != len(b) {
		return false
	}
	for name, digest := range a {
		if b[name] != digest {
			return false
		}
	}
	return true
}

func inspectMSIProfile(root string) (msiProfileStatus, error) {
	return inspectMSIProfileWithCheckpoint(root, nil)
}

// The optional checkpoint is used only by deterministic tests to inject a
// directory change between the first and final observations.
func inspectMSIProfileWithCheckpoint(root string, checkpoint func()) (msiProfileStatus, error) {
	out := msiProfileStatus{Schema: 1, State: "no_recorded_msi_attempts", ReadOnly: true, Complete: true, Records: []msiAttemptStatus{}, DependencyEdges: []msiDependencyEdge{}, LifecyclePlans: []msiLifecyclePlan{}, LifecycleRecords: []msiRepairStatus{}, LifecycleMutationAuthorized: false}
	abs, e := filepath.Abs(root)
	if root == "" || e != nil {
		return out, errors.New("invalid MSI inventory root")
	}
	if _, e = os.Lstat(abs); os.IsNotExist(e) {
		if checkpoint != nil {
			checkpoint()
		}
		if _, newErr := os.Lstat(abs); !os.IsNotExist(newErr) {
			return out, errors.New("MSI profile root changed during inspection")
		}
		return out, nil
	} else if e != nil {
		return out, e
	}
	start, e := collectMSIProfileSnapshot(abs)
	if e != nil {
		return out, e
	}
	baselineReceipts, e := hashMSIProfileReceiptSnapshot(abs, start)
	if e != nil {
		return out, errors.New("MSI profile receipt baseline unavailable: " + e.Error())
	}
	out.AdmissionLockPresent = start.admission != nil
	out.LifecycleRecords, e = readMSILifecycleInventory(abs, start.lifecycleNames)
	if e != nil {
		return out, e
	}
	out.ManualReviewRequired = out.AdmissionLockPresent || len(out.LifecycleRecords) > 0
	keys := map[string]bool{}
	for _, name := range start.names {
		if strings.HasSuffix(name, ".json") {
			keys[strings.TrimSuffix(name, ".json")] = true
		}
		if strings.HasSuffix(name, ".lock") {
			keys[strings.TrimSuffix(name, ".lock")] = true
		}
	}
	ordered := make([]string, 0, len(keys))
	for key := range keys {
		ordered = append(ordered, key)
	}
	sort.Strings(ordered)
	for _, key := range ordered {
		status, err := inspectMSIAttempt(abs, key)
		if err != nil {
			return out, err
		}
		if !status.HasReceipt && !status.LockPresent {
			return out, errors.New("MSI inventory changed during inspection")
		}
		if status.AdmissionLockPresent != out.AdmissionLockPresent {
			return out, errors.New("MSI global admission changed during inspection")
		}
		out.Records = append(out.Records, status)
		out.ManualReviewRequired = true
	}
	if checkpoint != nil {
		checkpoint()
	}
	// The filesystem snapshot alone does not tell us whether Windows
	// Installer registration changed while inspecting another Package. A
	// final read-only registration pass refuses mixed-epoch OS evidence.
	for _, status := range out.Records {
		if !status.HasReceipt || status.Attempt == nil || status.Product == nil {
			continue
		}
		latest, _ := readMSIRegistrationForRecovery(status.Attempt.ProductCode, status.Attempt.ProductVersion)
		if *status.Product != latest {
			return out, errors.New("Windows Installer registration changed during MSI profile inventory")
		}
	}
	terminal, e := collectMSIProfileSnapshot(abs)
	if e != nil || !sameMSIProfileSnapshot(start, terminal) {
		return out, errors.New("MSI profile inventory changed during inspection")
	}
	terminalReceipts, e := hashMSIProfileReceiptSnapshot(abs, terminal)
	if e != nil || !sameMSIProfileReceiptDigests(baselineReceipts, terminalReceipts) {
		return out, errors.New("MSI receipt bytes changed during profile inspection")
	}
	graph, graphErr := knownMSIDependencyEdges(out.Records)
	if graphErr != nil {
		return out, graphErr
	}
	out.DependencyEdges = graph
	plans, planErr := planMSILifecycle(out.Records, graph, out.AdmissionLockPresent)
	if planErr != nil {
		return out, planErr
	}
	// A successful original install receipt can outlive a repair or
	// uninstall. Any recorded lifecycle operation vetoes a new mutation.
	for i := range plans {
		for _, held := range out.LifecycleRecords {
			if held.PackageKey == plans[i].PackageKey {
				plans[i].Blockers = append(plans[i].Blockers, "prior_lifecycle_operation_recorded")
				plans[i].State = "blocked"
				break
			}
		}
	}
	out.LifecyclePlans = plans
	if out.ManualReviewRequired {
		out.State = "msi_profile_manual_review"
	}
	return out, nil
}
