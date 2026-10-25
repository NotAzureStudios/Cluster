//go:build !windows

package main

// The native service uses the Windows build; Linux provides the same
// configuration projection so source fixtures and development tools compile.
func configuredNativeNetwork(root string) (nativeNetworkPlan, error) {
	return nativeNetworkPlan{WebHost: "127.0.0.1", WebPort: 3000, PublicAPIPort: 4000, PrivatePostgresPort: 54321}, nil
}
