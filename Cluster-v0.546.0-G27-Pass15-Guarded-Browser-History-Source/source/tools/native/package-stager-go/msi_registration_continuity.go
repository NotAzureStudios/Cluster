package main

// A single successful MSI registration query is a momentary read, not a
// coherent recovery report. Observe twice while assembling one receipt and
// once more for each profile record before releasing a profile inventory.
// Conflicting observations are refused, never converted to installed health.
func readMSIRegistrationForRecovery(code, expected string) (msiProductState, bool) {
	product, err := queryInstalledMSIProduct(code, expected)
	if err != nil {
		return msiProductState{State: "os_query_unavailable", ProductCode: code,
			ExpectedVersion: expected, ReadOnly: true, OSAttested: false}, false
	}
	return product, true
}

func sameMSIRegistrationObservation(first, second msiProductState, firstQueryOK, secondQueryOK bool) bool {
	return firstQueryOK == secondQueryOK && first == second
}
