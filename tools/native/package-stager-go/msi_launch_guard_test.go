package main

import (
	"errors"
	"testing"
)

func TestMSILaunchAdmissionRejectsProductChangedAfterSuspendedProcess(t *testing.T) {
	code := "{12345678-1234-ABCD-ABCD-1234567890AB}"
	version := "1.0.0"
	empty, err := classifyMSIEnumeratedProduct(code, version, msiEnumeratedEnd, 0, "", 0, 0, "")
	if err != nil {
		t.Fatal(err)
	}
	installed, err := classifyMSIEnumeratedProduct(code, version, 0, 4, code, msiEnumeratedEnd, 0, version)
	if err != nil {
		t.Fatal(err)
	}
	queryFails := func(_, _ string) (msiProductState, error) { return empty, errors.New("API inaccessible") }
	tests := []struct {
		name     string
		baseline msiProductState
		readings []msiProductState
		query    func(string, string) (msiProductState, error)
		pass     bool
	}{
		{"stable absent", empty, []msiProductState{empty, empty}, nil, true},
		{"became registered", empty, []msiProductState{installed, installed}, nil, false},
		{"flipped during double read", empty, []msiProductState{empty, installed}, nil, false},
		{"returned absent after registered", installed, []msiProductState{empty, empty}, nil, false},
		{"query failed", empty, nil, queryFails, false},
		{"reported wrong code", empty, []msiProductState{{State: "not_registered_for_user", ProductCode: "{00000000-0000-0000-0000-000000000000}", ExpectedVersion: version, ReadOnly: true, ProbeComplete: true, ProbeScope: msiRegistrationScope}, empty}, nil, false},
		{"unverified context", empty, []msiProductState{{State: "not_registered_for_user", ProductCode: code, ExpectedVersion: version, ReadOnly: true}, empty}, nil, false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			i := 0
			query := tc.query
			if query == nil {
				query = func(c, v string) (msiProductState, error) {
					if c != code || v != version {
						t.Fatal("wrong identity queried")
					}
					j := i
					if j >= len(tc.readings) {
						j = len(tc.readings) - 1
					}
					i++
					return tc.readings[j], nil
				}
			}
			err := verifyMSILaunchAdmission(code, version, tc.baseline, query)
			if (err == nil) != tc.pass {
				t.Fatalf("pass=%v err=%v", tc.pass, err)
			}
			if tc.pass && i != 2 {
				t.Fatalf("expected two OS readings, got %d", i)
			}
		})
	}
	if err := verifyMSILaunchAdmission(code, version, empty, nil); err == nil {
		t.Fatal("nil OS probe accepted")
	}
}
