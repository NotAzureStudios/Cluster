package main

import "testing"

func TestExactRevisionInPlaceRepairAdmission(t *testing.T) {
	const installedHash = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
	cases := []struct {
		name string
		installed bool
		hash string
		sequence int
		allowed bool
	}{
		{"exact match",true,installedHash,50,true},
		{"case-insensitive hash",true,"0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF",50,true},
		{"uninstalled",false,installedHash,50,false},
		{"different installer",true,"ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",50,false},
		{"future candidate",true,installedHash,51,false},
		{"older candidate",true,installedHash,49,false},
	}
	for _,tc := range cases {
		t.Run(tc.name,func(t *testing.T) {
			if got:=sameReleaseRepairAllowed(tc.installed,tc.hash,installedHash,tc.sequence,50);got!=tc.allowed {
				t.Fatalf("repair eligibility=%v, expected=%v",got,tc.allowed)
			}
		})
	}
}
