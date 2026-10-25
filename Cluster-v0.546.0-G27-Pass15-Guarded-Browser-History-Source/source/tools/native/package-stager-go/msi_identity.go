package main

import (
	"errors"
	"fmt"
)

// msiIdentityEvidence concerns the Property table in the exact signed/staged
// MSI bytes, NOT registration state or application health. This is read-only.
type msiIdentityEvidence struct {
	State                  string `json:"state"`
	DeclaredProductCode    string `json:"declaredProductCode"`
	DeclaredProductVersion string `json:"declaredProductVersion"`
	ActualProductCode      string `json:"actualProductCode,omitempty"`
	ActualProductVersion   string `json:"actualProductVersion,omitempty"`
	Verified               bool   `json:"verified"`
	ReadOnly               bool   `json:"readOnly"`
	OSAttested             bool   `json:"osAttested"`
}

func checkMSIPropertyIdentity(declared msiInstaller, actualCode, actualVersion string) (msiIdentityEvidence, error) {
	out := msiIdentityEvidence{State: "msi_property_mismatch", DeclaredProductCode: declared.ProductCode,
		DeclaredProductVersion: declared.ProductVersion, ReadOnly: true, OSAttested: false}
	if !msiProductCodePattern.MatchString(declared.ProductCode) || !msiProductVersionPattern.MatchString(declared.ProductVersion) {
		out.State = "invalid_signed_product_identity"
		return out, errors.New("invalid signed MSI identity")
	}
	// Never return invalid arbitrary strings from a compromised MSI database
	// as legitimate product identity evidence.
	if !msiProductCodePattern.MatchString(actualCode) || !msiProductVersionPattern.MatchString(actualVersion) {
		out.State = "invalid_msi_property_identity"
		return out, errors.New("MSI Property table has invalid product identity")
	}
	out.ActualProductCode, out.ActualProductVersion = actualCode, actualVersion
	if declared.ProductCode != actualCode || declared.ProductVersion != actualVersion {
		return out, fmt.Errorf("signed MSI identity differs from MSI Property table")
	}
	out.State, out.Verified = "msi_properties_match_signed_declaration", true
	return out, nil
}

func inspectStagedMSIProperties(path string, declared msiInstaller) (msiIdentityEvidence, error) {
	code, version, err := readMSIPropertyIdentity(path)
	if err != nil {
		return msiIdentityEvidence{State: "msi_property_unavailable", DeclaredProductCode: declared.ProductCode,
			DeclaredProductVersion: declared.ProductVersion, ReadOnly: true, OSAttested: false}, err
	}
	return checkMSIPropertyIdentity(declared, code, version)
}
