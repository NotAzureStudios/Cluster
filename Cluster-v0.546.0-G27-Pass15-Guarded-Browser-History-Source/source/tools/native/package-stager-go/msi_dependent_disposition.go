package main

// An uninstall process exit is NOT a dependent disposition by itself. This
// helper recognizes only matching, completed, non-replayable local journal
// custody *and* a coherent current-user+machine ProductCode absence sample.
// The profile reader double-samples every registration during inspection and
// rejects filesystem/registration changes before publishing the snapshot.
// Neither this result nor registration absence attests installed-file health.
func observedSettledMSIUninstall(profile msiProfileStatus, key string) bool {
	if !validPackageKey(key) || !profile.Complete || !profile.ReadOnly || profile.OSAttested ||
		profile.AdmissionLockPresent || profile.RetryAuthorized || profile.LifecycleMutationAuthorized {
		return false
	}
	var original *msiAttemptStatus
	for i := range profile.Records {
		record := &profile.Records[i]
		if record.PackageKey == key {
			if original != nil {
				return false
			}
			original = record
		}
	}
	if original == nil || !original.HasReceipt || original.Attempt == nil || !original.ReadOnly || original.OSAttested || original.RetryAuthorized ||
		original.LockPresent || original.AdmissionLockPresent || !validDigest(original.ReceiptSha256) ||
		(original.State != "msi_exit_zero_not_os_attested" && original.State != "msi_restart_required_not_os_attested") ||
		original.Attempt.State != original.State || original.Attempt.PreLaunchRegistration == nil || original.Attempt.PostExitRegistration == nil ||
		original.Product == nil {
		return false
	}
	product := original.Product
	if product.State != "not_registered_for_user" || product.ProductCode != original.Attempt.ProductCode ||
		product.ExpectedVersion != original.Attempt.ProductVersion || product.ReportedVersion != "" || product.VersionMatches ||
		product.ProbeScope != "current_user_and_machine" || !product.ProbeComplete || !product.ReadOnly || product.OSAttested {
		return false
	}
	var held *msiRepairStatus
	for i := range profile.LifecycleRecords {
		rec := &profile.LifecycleRecords[i]
		if rec.PackageKey != key {
			continue
		}
		if held != nil {
			return false
		}
		held = rec
	}
	if held == nil || !held.HasReceipt || held.Receipt == nil || !held.ReadOnly || held.OSAttested || held.RetryAuthorized ||
		!held.ManualReviewRequired || !validDigest(held.ReceiptSha256) ||
		held.State != "uninstall_exit_zero_not_os_attested" || held.Receipt.State != held.State {
		return false
	}
	r := held.Receipt
	return r.Schema == 1 && r.Operation == "uninstall" && r.PackageKey == key && !r.OSAttested && r.ExitCode == 0 &&
		r.StartedAt != "" && r.LaunchCommittedAt != "" && r.FinishedAt != "" &&
		r.Version == original.Attempt.Version && r.ArtifactSha256 == original.Attempt.ArtifactSha256 &&
		r.MSISha256 == original.Attempt.MSISha256 && r.ProductCode == original.Attempt.ProductCode &&
		r.ProductVersion == original.Attempt.ProductVersion && r.PriorReceiptSha256 == original.ReceiptSha256 &&
		r.MSIPath == "" && r.UpgradeJournalSha256 == "" && r.SuccessorMSISha256 == ""
}
