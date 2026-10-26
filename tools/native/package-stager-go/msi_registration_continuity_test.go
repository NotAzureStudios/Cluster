package main

import "testing"

func TestMSIRegistrationReadOnlySnapshotsFailClosed(t *testing.T) {
	basic := msiProductState{State: "registered_version_match", ProductCode: "{12345678-1234-ABCD-ABCD-1234567890AB}",
		ExpectedVersion: "1.0.0", ReportedVersion: "1.0.0", VersionMatches: true, ReadOnly: true,
		ProbeScope: msiRegistrationScope, ProbeComplete: true}
	if !sameMSIRegistrationObservation(basic, basic, true, true) {
		t.Fatal("identical OS readings rejected")
	}
	if sameMSIRegistrationObservation(basic, basic, true, false) {
		t.Fatal("lost query success went undetected")
	}
	for _, mutate := range []func(*msiProductState){
		func(p *msiProductState) { p.State = "os_query_unavailable" },
		func(p *msiProductState) { p.ReportedVersion = "1.0.1" },
		func(p *msiProductState) { p.VersionMatches = false },
		func(p *msiProductState) { p.ProductCode = "{AAAAAAAA-1234-ABCD-ABCD-1234567890AB}" },
		func(p *msiProductState) { p.ProbeComplete = false },
		func(p *msiProductState) { p.ProbeScope = "" },
		func(p *msiProductState) { p.OSAttested = true },
	} {
		changed := basic
		mutate(&changed)
		if sameMSIRegistrationObservation(basic, changed, true, true) {
			t.Fatalf("conflicting OS state treated as coherent: %+v", changed)
		}
	}
}
