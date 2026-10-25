package main

// The inventory graph is a read-only map of KNOWN local MSI receipts. It may
// identify dependent Package records but can never prove that an unrecorded OS
// application does not depend on the product. All mutation authority stays false.
import (
	"errors"
	"sort"
)

type msiDependencyEdge struct {
	DependentPackageKey       string `json:"dependentPackageKey"`
	DependencyPackageKey      string `json:"dependencyPackageKey"`
	DependencyVersion         string `json:"dependencyVersion"`
	DependencyReceiptSha256   string `json:"dependencyReceiptSha256"`
	RecordedDependencyPresent bool   `json:"recordedDependencyPresent"`
	RecordedReceiptMatches    bool   `json:"recordedReceiptMatches"`
}

const maxMSIProfileDependencyEdges = 256

func knownMSIDependencyEdges(records []msiAttemptStatus) ([]msiDependencyEdge, error) {
	index := map[string]msiAttemptStatus{}
	for _, record := range records {
		if !validPackageKey(record.PackageKey) || index[record.PackageKey].PackageKey != "" {
			return nil, errors.New("invalid MSI dependency inventory identity")
		}
		index[record.PackageKey] = record
	}
	edges := make([]msiDependencyEdge, 0)
	for _, record := range records {
		if !record.HasReceipt || record.Attempt == nil {
			continue
		}
		if !validMSIDependencyEvidence(record.Attempt.Dependencies, record.PackageKey) {
			return nil, errors.New("corrupt MSI dependency inventory evidence")
		}
		for _, dep := range record.Attempt.Dependencies {
			known, present := index[dep.PackageKey]
			existing := present && known.HasReceipt && known.Attempt != nil && known.ReceiptSha256 != ""
			matches := existing && known.ReceiptSha256 == dep.ReceiptSha256 &&
				known.Attempt.Version == dep.Version && known.Attempt.ProductCode == dep.ProductCode &&
				known.Attempt.ProductVersion == dep.ProductVersion
			edges = append(edges, msiDependencyEdge{DependentPackageKey: record.PackageKey, DependencyPackageKey: dep.PackageKey,
				DependencyVersion: dep.Version, DependencyReceiptSha256: dep.ReceiptSha256,
				RecordedDependencyPresent: existing, RecordedReceiptMatches: matches})
			if len(edges) > maxMSIProfileDependencyEdges {
				return nil, errors.New("MSI dependency inventory exceeds bounded graph")
			}
		}
	}
	sort.Slice(edges, func(i, j int) bool {
		if edges[i].DependentPackageKey == edges[j].DependentPackageKey {
			return edges[i].DependencyPackageKey < edges[j].DependencyPackageKey
		}
		return edges[i].DependentPackageKey < edges[j].DependentPackageKey
	})
	return edges, nil
}
