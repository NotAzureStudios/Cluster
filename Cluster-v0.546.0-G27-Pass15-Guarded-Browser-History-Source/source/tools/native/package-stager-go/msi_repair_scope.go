package main

import "errors"

// A per-machine ProductCode must NEVER be passed to the repair executor.
// Other-user and mixed-context observations are likewise ineligible.
func classifyCurrentUserMSIRepairScope(first, context, second uint32) error {
	if first != 0 || (context != 1 && context != 2) || second != msiEnumeratedEnd {
		return errors.New("MSI repair refuses per-machine, ambiguous or unavailable install scope")
	}
	return nil
}
