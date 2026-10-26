//go:build windows

package main

import "fmt"

func configuredNativeNetwork(root string) (nativeNetworkPlan, error) {
	cfg, err := loadServerConfig(root)
	if err != nil {
		return nativeNetworkPlan{}, err
	}
	return parseNativeNetwork(cfg.Settings)
}
func serviceNetworkPreflight(root string) error {
	plan, err := configuredNativeNetwork(root)
	if err != nil {
		return err
	}
	if err := checkNativeNetworkListeners(plan); err != nil {
		return fmt.Errorf("network startup preflight failed: %w", err)
	}
	return nil
}
