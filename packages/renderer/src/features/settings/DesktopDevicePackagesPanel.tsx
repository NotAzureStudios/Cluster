import { useEffect, useRef, useState } from "react";
import { clusterApiFetch } from "@cluster/api-client";
import { api, installationDeviceId } from "../../core/api";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterNativeSelect } from "../../components/ClusterNativeControls";
import { buildPackageStagingKit } from "./package-staging-kit";
import { validateMSILifecyclePlans } from "./msi-lifecycle-planning";
import { validUpgradeRecoveryEvidence } from "./msi-upgrade-recovery";
import { validMSIRollbackReview } from "./msi-rollback-review";
import { validMSIRollbackJournal } from "./msi-rollback-journal";
import { validMSIRollbackCascade } from "./msi-rollback-cascade";
import { validMSIIncidentWorklist } from "./msi-incident-worklist";
import { recordBrowserDownloadHandoff } from "../../core/browser-download-transfers";
import { downloadPackageSegments, downloadPackageSegmentsToSink } from "./package-segment-download";
import { readPackageStageReceiptLease, reportNativePackageStage, reportFailedNativePackageStage, reportNativeManagedSelection, reportNativeManagedRollback, verifiedStageMatchesLease,
  type PackageStageReceiptLease } from "./package-staging-receipts";
import { getNativePackageStageStatus, stageNativePackageKit, auditNativePackageKit, auditNativeManagedPackage, getNativePackageTrustStatus, provisionNativePackageTrust, subscribeNativePackageStaging, getNativePackageControlTrustStatus, provisionNativePackageControlTrust, runAuthorizedNativePackageContent, runNativeSupervisedMSI, inspectNativeMSIUpgradeReadiness, inspectNativeMSIUpgrade, runNativeSupervisedMSIUpgrade, type ClusterNativeMSIUpgradeStatus, inspectNativeMSIRollbackReview, type ClusterNativeMSIRollbackReview, inspectNativeMSIRollbackCascade, type ClusterNativeMSIRollbackCascade, inspectNativeMSIIncidentWorklist, type ClusterNativeMSIIncidentWorklist, writeNativeClipboardText, inspectNativeMSIRollbackStatus, type ClusterNativeMSIRollbackStatus, runNativeSupervisedMSIRollback, inspectNativeMSIRepair, runNativeSupervisedMSIRepair, type ClusterNativeMSIRepairStatus, inspectNativeMSIUninstall, runNativeSupervisedMSIUninstall, type ClusterNativeMSIUninstallStatus, inspectNativeMSIAttempt, inspectNativeMSIProfile, type ClusterNativeMSIProfileStatus, type ClusterNativeMSIAttemptStatus, runNativePackageFileUpdate, getNativePackageDestinations, chooseNativePackageDestination, forgetNativePackageDestination, transferDownloadedPackageKitToNative, prepareNativePackageArchive, inspectNativePackageArchive, diagnoseNativePackageArchive, recoverNativePackageArchive, bindNativePackageArchiveOffer, appendNativePackageArchiveSegment, commitNativePackageArchive, stageRetainedNativePackageArchive, type ClusterNativePackageDestination, type ClusterPackageDeploymentGrant, type ClusterDesktopPackageStageStatus } from "../../core/desktop";

type DevicePlatform = "windows-x64" | "linux-x64" | "macos-arm64";
type Channel = "stable" | "beta" | "testing";
type Target = {
  package: { id: string; key: string; title: string };
  release: { id: string; version: string; platform: string; filename: string; artifactSize: number; artifactSha256: string; signingKeyFingerprint: string };
  manifest: { schema: 1; packageKey: string; version: string; platform: string; artifactSize: number; artifactSha256: string; filename: string; dependencies?: { packageKey: string; version: string; requirement: "content-selected" | "msi-installed" }[]; installer?: { kind: "windows-msi"; path: string; sha256: string; productCode: string; productVersion: string; scope: "user" } };
  signatureBase64: string;
  signingPublicKeyPem: string;
  selection: "device_pin" | "rollout";
  deviceReported?: { state: string; osAttested: false; releaseId: string } | null;
};

function platformFor(runtimePlatform: string): DevicePlatform {
  if (runtimePlatform === "macos") return "macos-arm64";
  if (runtimePlatform === "linux") return "linux-x64";
  return "windows-x64";
}

export function DesktopDevicePackagesPanel({ available, runtimePlatform }: { available: boolean; runtimePlatform: string }) {
  const [channel, setChannel] = useState<Channel>("stable");
  const [platform, setPlatform] = useState<DevicePlatform>(() => platformFor(runtimePlatform));
  const [targets, setTargets] = useState<Target[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [downloadId, setDownloadId] = useState("");
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [archiveEvidence, setArchiveEvidence] = useState<Record<string, { receivedBytes: number; expectedBytes: number; state: string; bound: boolean }>>({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [nativeStage, setNativeStage] = useState<ClusterDesktopPackageStageStatus>({ state: "idle" });
  const [trust, setTrust] = useState<{ configured: boolean; fingerprint: string } | null>(null);
  const [trustBusy, setTrustBusy] = useState(false);
  const [controlTrust, setControlTrust] = useState<{ configured: boolean; fingerprint: string } | null>(null);
  const [grantBusy, setGrantBusy] = useState(false);
  const [supervisedMsiEnabled, setSupervisedMsiEnabled] = useState(false);
  const [supervisedMsiRepairEnabled, setSupervisedMsiRepairEnabled] = useState(false);
  const [supervisedMsiUninstallEnabled, setSupervisedMsiUninstallEnabled] = useState(false);
  const [supervisedMsiUpgradeEnabled, setSupervisedMsiUpgradeEnabled] = useState(false);
  const [supervisedMsiRollbackEnabled, setSupervisedMsiRollbackEnabled] = useState(false);
  const [msiUpgradeEvidence, setMsiUpgradeEvidence] = useState<Record<string, ClusterNativeMSIUpgradeStatus>>({});
  const [msiRollbackReview, setMsiRollbackReview] = useState<Record<string, ClusterNativeMSIRollbackReview>>({});
  const [msiRollbackCascade, setMsiRollbackCascade] = useState<Record<string, ClusterNativeMSIRollbackCascade>>({});
  const [msiRollbackJournal, setMsiRollbackJournal] = useState<Record<string, ClusterNativeMSIRollbackStatus>>({});
  const [msiRollbackBusy, setMsiRollbackBusy] = useState("");
  const [msiUninstallEvidence, setMsiUninstallEvidence] = useState<Record<string, ClusterNativeMSIUninstallStatus>>({});
  const [msiUninstallEvidenceBusy, setMsiUninstallEvidenceBusy] = useState("");
  const [msiRepairEvidence, setMsiRepairEvidence] = useState<Record<string, ClusterNativeMSIRepairStatus>>({});
  const [msiRepairEvidenceBusy, setMsiRepairEvidenceBusy] = useState("");
  const [msiEvidence, setMsiEvidence] = useState<Record<string, ClusterNativeMSIAttemptStatus>>({});
  const [msiEvidenceBusy, setMsiEvidenceBusy] = useState("");
  const [msiUpgradeBusy, setMsiUpgradeBusy] = useState("");
  const [msiProfileEvidence, setMsiProfileEvidence] = useState<ClusterNativeMSIProfileStatus | null>(null);
  const [msiProfileBusy, setMsiProfileBusy] = useState(false);
  const [msiIncidentWorklist, setMsiIncidentWorklist] = useState<ClusterNativeMSIIncidentWorklist | null>(null);
  const [msiIncidentBusy, setMsiIncidentBusy] = useState(false);
  const [destinations, setDestinations] = useState<ClusterNativePackageDestination[]>([]);
  const [destinationBusy, setDestinationBusy] = useState("");
  const [preparedKitDigest, setPreparedKitDigest] = useState("");
  const generation = useRef(0);
  const msiGrantPending = useRef(false);
  const msiGrantOwner = useRef(0);
  const pending = useRef(false);
  const downloadPending = useRef(false);
  const archiveAbort = useRef<AbortController | null>(null);
  const stageLeases = useRef(new Map<string, PackageStageReceiptLease>());
  const selectionLeases = useRef(new Map<string, PackageStageReceiptLease & { expectedRevision: number }>());
  const rollbackLeases = useRef(new Map<string, PackageStageReceiptLease & { expectedRevision: number }>());
  const managedIntent = useRef<{ artifactSha256: string; packageKey: string; version: string; operation: "deploy" | "rollback" } | null>(null);
  const stageIntent = useRef<{ artifactSha256: string; packageKey: string; version: string; reporting: boolean;
    updateAfterStage?: { target: Target; channel: Channel; platform: DevicePlatform; generation: number } } | null>(null);
  useEffect(() => {
    generation.current++;
    msiGrantOwner.current++;
    msiGrantPending.current = false;
    setGrantBusy(false);
    setMsiEvidenceBusy(""); setMsiUpgradeBusy(""); setMsiUpgradeEvidence({}); setMsiRollbackReview({}); setMsiRollbackBusy(""); setMsiRepairEvidenceBusy(""); setMsiRepairEvidence({}); setMsiUninstallEvidenceBusy(""); setMsiUninstallEvidence({}); setMsiProfileEvidence(null); setMsiProfileBusy(false);
    archiveAbort.current?.abort();
    pending.current = false;
    stageLeases.current.clear(); selectionLeases.current.clear(); rollbackLeases.current.clear(); stageIntent.current = null; managedIntent.current = null;
    setArchiveEvidence({}); setMsiEvidence({}); setTargets([]); setLoaded(false); setError(""); setNotice(""); setBusy(false); setDownloadId(""); setPreparedKitDigest(""); if (!available) setDestinations([]);
  }, [channel, platform, available]);
  useEffect(() => { setPlatform(platformFor(runtimePlatform)); }, [runtimePlatform]);
  useEffect(() => {
    if (!available) return;
    let mounted = true;
    void getNativePackageStageStatus().then((status) => { if (mounted) setNativeStage(status); }).catch(() => undefined);
    void getNativePackageTrustStatus().then((status) => { if (mounted) setTrust(status); }).catch(() => { if (mounted) setTrust(null); });
    void getNativePackageControlTrustStatus().then((status) => { if (mounted) setControlTrust(status); }).catch(() => { if (mounted) setControlTrust(null); });
    void getNativePackageDestinations().then((result) => { if (mounted) setDestinations(result.destinations || []); }).catch(() => { if (mounted) setDestinations([]); });
    const unsubscribe = subscribeNativePackageStaging((event) => {
      if (!mounted) return;
      setNativeStage(event.status);
      if (["file_update_complete", "file_update_rolled_back"].includes(event.status.state))
        void getNativePackageDestinations().then((result) => { if (mounted) setDestinations(result.destinations || []); }).catch(() => undefined);
      const managed = managedIntent.current;
      if (managed && event.status.state !== "verifying") managedIntent.current = null;
      if (managed && event.status.state === "managed_content_selected"
        && event.status.artifactSha256 === managed.artifactSha256
        && event.status.packageKey === managed.packageKey && event.status.version === managed.version) {
        if (managed.operation === "rollback") {
          // The deployment being rolled back was the most recently reported
          // active release, not the restored previous release. Keep the
          // original deployment digest in the receipt challenge chain.
          const previousLease = rollbackLeases.current.get(managed.packageKey) || null;
          rollbackLeases.current.delete(managed.packageKey);
          if (previousLease && Date.now() - previousLease.issuedAt < 9 * 60_000)
            void reportNativeManagedRollback(previousLease, (deploymentId, body) =>
              api<{ revision: number; nextChallenge: string }>(`/api/me/packages/deployments/${encodeURIComponent(deploymentId)}/receipts`, {
                method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" },
              }))
              .then(() => { if (mounted) setNotice("Native managed rollback recorded as a device report, not OS recovery attestation."); })
              .catch(() => { if (mounted) setError("Native managed rollback completed locally, but the device report could not be confirmed."); });
          else setNotice("Managed rollback completed locally. No valid earlier deployment receipt remains to close.");
          return;
        }
        const selectionLease = selectionLeases.current.get(managed.artifactSha256);
        selectionLeases.current.delete(managed.artifactSha256);
        if (selectionLease && Date.now() - selectionLease.issuedAt < 9 * 60_000)
          void reportNativeManagedSelection(selectionLease, (deploymentId, body) =>
            api<{ revision: number; nextChallenge: string }>(`/api/me/packages/deployments/${encodeURIComponent(deploymentId)}/receipts`, {
              method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" },
            }))
            .then((reported) => {
              if (mounted) {
                rollbackLeases.current.set(managed.packageKey, reported.rollbackLease);
                setNotice("Managed content selected; server recorded a device report, not OS installation evidence.");
              }
            })
            .catch(() => { if (mounted) setError("Managed content changed locally, but the nonattested server status could not be confirmed."); });
        else setNotice("Managed content selected locally. A valid server receipt lease is no longer available.");
      }
      const intent = stageIntent.current;
      if (!intent || intent.reporting || !["staged_not_installed", "failed"].includes(event.status.state)
        || event.status.artifactSha256 !== intent.artifactSha256
        || event.status.packageKey !== intent.packageKey || event.status.version !== intent.version) return;
      intent.reporting = true;
      const lease = stageLeases.current.get(intent.artifactSha256) || null;
      stageLeases.current.delete(intent.artifactSha256); // one attempt, no replay on UI event duplication
      if (event.status.state === "failed") {
        if (!lease || Date.now() - lease.issuedAt >= 9 * 60_000) return;
        void reportFailedNativePackageStage(lease, (deploymentId, body) =>
          api<{ revision: number }>(`/api/me/packages/deployments/${encodeURIComponent(deploymentId)}/receipts`, {
            method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" },
          }))
          .then(() => { if (mounted) setNotice("Native verification refused; failure recorded as a device report."); })
          .catch(() => { if (mounted) setError("Native staging failed; the server failure report could not be confirmed."); });
        return;
      }
      if (intent.updateAfterStage) {
        const followUp = intent.updateAfterStage;
        // Native emits its status just before clearing the completed Go process.
        // Defer the next native request to the next turn; do not run it on failure.
        window.setTimeout(() => {
          if (!mounted || generation.current !== followUp.generation) return;
          void (async () => {
            const authorized = await api<{ targets: Target[] }>(`/api/me/packages/targets?${new URLSearchParams({
              channel: followUp.channel, platform: followUp.platform,
            })}`);
            if (!authorized.targets.some((entry) => entry.package.id === followUp.target.package.id
              && entry.release.id === followUp.target.release.id
              && entry.release.artifactSha256 === intent.artifactSha256))
              throw new Error("The Package target changed before destination update; files were not modified.");
            const operation = await runNativePackageFileUpdate({ expectedArtifactSha256: intent.artifactSha256,
              expectedPackageKey: intent.packageKey, expectedVersion: intent.version }, "sync", true);
            if (mounted && operation.accepted) setNativeStage({ state: "verifying", operationId: operation.operationId });
            else if (mounted) setNotice("Native staging succeeded. Destination update was cancelled; no files were changed.");
          })().catch((cause) => { if (mounted) setError(`Staging succeeded, but file update did not start: ${cause instanceof Error ? cause.message : "unavailable"}`); });
        }, 0);
      }
      if (!verifiedStageMatchesLease(lease, event.status)) {
        setNotice("Native staging verified. No fresh device receipt lease remains; server status was not changed.");
        return;
      }
      void reportNativePackageStage(lease, (deploymentId, body) =>
        api<{ revision: number; nextChallenge: string }>(`/api/me/packages/deployments/${encodeURIComponent(deploymentId)}/receipts`, {
          method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" },
        }))
        .then((report) => {
          if (mounted) {
            selectionLeases.current.set(intent.artifactSha256, report.selectionLease);
            setNotice("Native content staged; two device reports recorded. Eligible for a subsequent managed-content selection report, not OS installation.");
          }
        })
        .catch((cause) => { if (mounted) setError(`Content staged locally; receipt not confirmed: ${cause instanceof Error ? cause.message : "server unavailable"}`); });
    });
    return () => { mounted = false; unsubscribe(); };
  }, [available]);

  async function stageLocally(target: Target) {
    if (!available || !trust?.configured || busy || !!downloadId || nativeStage.state === "verifying") return;
    setError(""); setNotice("");
    try {
      // Recheck current device-authorized rollout before asking Qt to import a
      // downloaded file. Qt still verifies the kit against a separate local pin;
      // this is NOT a cryptographic attestation of the selected file's entitlement.
      const fresh = await api<{ targets: Target[] }>(`/api/me/packages/targets?${new URLSearchParams({ channel, platform })}`);
      if (!fresh.targets.some((entry) => entry.package.id === target.package.id
        && entry.release.id === target.release.id && entry.release.artifactSha256 === target.release.artifactSha256))
        throw new Error("This release is no longer an authorized Package target. Refresh the feed.");
      stageIntent.current = { artifactSha256: target.release.artifactSha256,
        packageKey: target.package.key, version: target.release.version, reporting: false };
      const response = await stageNativePackageKit({ expectedArtifactSha256: target.release.artifactSha256,
        expectedPackageKey: target.package.key, expectedVersion: target.release.version });
      if (!response.accepted) stageIntent.current = null;
      if (response.accepted) setNativeStage((previous) => previous.operationId === response.operationId
        && (previous.state === "staged_not_installed" || previous.state === "failed")
        ? previous : { state: "verifying", operationId: response.operationId });
    } catch (cause) { stageIntent.current = null; setError(cause instanceof Error ? cause.message : "Native Package staging failed."); }
  }

  async function enrollTrust() {
    if (!available || trustBusy || nativeStage.state === "verifying") return;
    setTrustBusy(true); setError("");
    try {
      const result = await provisionNativePackageTrust();
      if (result.accepted) {
        const status = await getNativePackageTrustStatus();
        setTrust(status);
        setNotice(result.unchanged ? "Local trust fingerprint unchanged." : "Local trust pin saved. It is user-profile configuration, not machine-wide attestation.");
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Native trust setup failed."); }
    finally { setTrustBusy(false); }
  }

  async function enrollControlTrust() {
    if (!available || trustBusy || grantBusy || nativeStage.state === "verifying") return;
    setTrustBusy(true); setError("");
    try {
      const result = await provisionNativePackageControlTrust();
      if (result.accepted) {
        setControlTrust(await getNativePackageControlTrustStatus());
        setNotice("Separate deployment-control key fingerprint stored locally. Its source must be independently verified.");
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Native deployment authority setup failed."); }
    finally { setTrustBusy(false); }
  }

  async function deployContent(target: Target, operation: "deploy" | "rollback") {
    if (!available || !trust?.configured || !controlTrust?.configured || busy || grantBusy || nativeStage.state === "verifying") return;
    setError(""); setNotice(""); setGrantBusy(true);
    try {
      // No grant is cached, written to browser storage, or included in the
      // staging kit. A fresh authenticated device-proof request is mandatory.
      const response = await api<{ ok: true; grant: ClusterPackageDeploymentGrant; purpose: string }>(
        `/api/me/packages/${encodeURIComponent(target.package.id)}/releases/${encodeURIComponent(target.release.id)}/authorize-content`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ channel, platform, operation }) });
      if (!response.grant || response.grant.schema !== 1 || response.purpose !== "managed_content_only"
        || response.grant.expiresAt * 1000 <= Date.now()) throw new Error("The signed deployment authorization is unavailable or expired.");
      stageIntent.current = null;
      managedIntent.current = { artifactSha256: target.release.artifactSha256,
        packageKey: target.package.key, version: target.release.version, operation };
      const result = await runAuthorizedNativePackageContent({ expectedArtifactSha256: target.release.artifactSha256,
        expectedPackageKey: target.package.key, expectedVersion: target.release.version, grant: response.grant }, operation);
      if (!result.accepted) managedIntent.current = null;
      if (result.accepted) {
        setNativeStage({ state: "verifying", operationId: result.operationId });
        setNotice("Native managed-content operation requested. No executable installation or OS-health attestation is implied.");
      }
    } catch (cause) { managedIntent.current = null; setError(cause instanceof Error ? cause.message : "Authorized managed-content operation failed."); }
    finally { setGrantBusy(false); }
  }

  async function auditLocally(target: Target) {
    if (!available || !trust?.configured || busy || !!downloadId || nativeStage.state === "verifying") return;
    setError(""); setNotice("");
    try {
      // This only verifies bytes stored in the private native staging tree.
      // It does not grant entitlement, select content or submit deployment receipts.
      stageIntent.current = null;
      const response = await auditNativePackageKit({ expectedArtifactSha256: target.release.artifactSha256,
        expectedPackageKey: target.package.key, expectedVersion: target.release.version });
      if (response.accepted) setNativeStage((previous) => previous.operationId === response.operationId
        && (previous.state === "audited_staged_not_installed" || previous.state === "failed")
        ? previous : { state: "verifying", operationId: response.operationId });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Package audit failed."); }
  }

  async function auditManaged(target: Target) {
    if (!available || !trust?.configured || busy || !!downloadId || nativeStage.state === "verifying") return;
    setError(""); setNotice("");
    try {
      // Read-only signed audit of the existing managed copy. This does NOT
      // authorize installation, change the selected release, or send receipts.
      stageIntent.current = null; managedIntent.current = null;
      const response = await auditNativeManagedPackage({ expectedArtifactSha256: target.release.artifactSha256,
        expectedPackageKey: target.package.key, expectedVersion: target.release.version });
      if (response.accepted) setNativeStage((previous) => previous.operationId === response.operationId
        && (previous.state === "audited_managed_content" || previous.state === "failed")
        ? previous : { state: "verifying", operationId: response.operationId });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Managed-content audit failed."); }
  }

  async function changeDestination(packageKey: string, operation: "choose" | "forget") {
    if (!available || busy || !!downloadId || nativeStage.state === "verifying" || destinationBusy) return;
    setDestinationBusy(packageKey); setError(""); setNotice("");
    try {
      const result = operation === "choose"
        ? await chooseNativePackageDestination(packageKey)
        : await forgetNativePackageDestination(packageKey);
      if (!result.accepted) return;
      const updated = await getNativePackageDestinations();
      setDestinations(updated.destinations || []);
      setNotice(operation === "choose"
        ? "Saved Package folder for this Desktop server profile. No files have been modified."
        : "Saved folder mapping removed. Existing files and rollback history are untouched.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not update saved Package folder."); }
    finally { setDestinationBusy(""); }
  }

  async function updateDestinationFiles(target: Target, operation: "preview" | "audit" | "sync" | "replace" | "rollback") {
    if (!available || !trust?.configured || busy || !!downloadId || nativeStage.state === "verifying") return;
    setError(""); setNotice("");
    try {
      // A fresh feed check stops old, revoked targets from being used as a
      // starting point. Native signature, managed selection and local hashes
      // are checked again independently before any destination modification.
      const fresh = await api<{ targets: Target[] }>(`/api/me/packages/targets?${new URLSearchParams({ channel, platform })}`);
      if (!fresh.targets.some((entry) => entry.package.id === target.package.id && entry.release.id === target.release.id
        && entry.release.artifactSha256 === target.release.artifactSha256))
        throw new Error("This Package is no longer an authorized device target.");
      stageIntent.current = null; managedIntent.current = null;
      const result = await runNativePackageFileUpdate({ expectedArtifactSha256: target.release.artifactSha256,
        expectedPackageKey: target.package.key, expectedVersion: target.release.version }, operation,
        preparedKitDigest === target.release.artifactSha256);
      if (result.accepted) setNativeStage({ state: "verifying", operationId: result.operationId });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Native file update failed."); }
  }

  function verifyMSIBootObservation(report: ClusterNativeMSIAttemptStatus): void {
    const fail = (): never => { throw new Error("Inconsistent native MSI recovery evidence: boot continuity invalid. No installation is authorized."); };
    const boot = report.bootObservation;
    if (!report.hasReceipt) { if (boot !== undefined) fail(); return; }
    if (!boot || boot.readOnly !== true || boot.osAttested !== false || boot.rebootConfirmed !== false
      || typeof boot.anchorRecorded !== "boolean" || boot.anchorRecorded !== !!report.attempt?.bootAnchor) fail();
    if (report.attempt?.bootAnchor) {
      const anchor = report.attempt.bootAnchor;
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(anchor.observedAt)
        || !Number.isSafeInteger(anchor.uptimeMilliseconds) || anchor.uptimeMilliseconds < 0
        || anchor.uptimeMilliseconds > 315360000000) fail();
    }
    if (boot.state === "os_uptime_unavailable") {
      if (boot.observedAt !== undefined || boot.estimatedBootAt !== undefined || boot.uptimeMilliseconds !== undefined) fail();
      return;
    }
    if (!["reboot_indicated_unverified", "same_boot_indicated_unverified", "boot_relation_ambiguous"].includes(boot.state)
      || typeof boot.uptimeMilliseconds !== "number" || !Number.isFinite(boot.uptimeMilliseconds)
      || boot.uptimeMilliseconds < 0 || boot.uptimeMilliseconds > 315360000000
      || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(boot.observedAt || "")
      || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(boot.estimatedBootAt || "")) fail();
  }

  function verifyReadOnlyMSIEvidence(report: ClusterNativeMSIAttemptStatus, packageKey: string): void {
    const unsafe = (): never => { throw new Error("Inconsistent native MSI recovery evidence. No installation grant was requested."); };
    if (!report || report.schema !== 1 || report.packageKey !== packageKey || report.osAttested !== false
      || report.retryAuthorized !== false || report.readOnly !== true || typeof report.hasReceipt !== "boolean"
      || typeof report.lockPresent !== "boolean" || typeof report.admissionLockPresent !== "boolean"
      || (report.admissionLockPresent && !report.lockPresent) || typeof report.manualReviewRequired !== "boolean"
      || report.stagedArtifactVerified === true) unsafe();
    if (report.attempt?.msiPath !== undefined) {
      const path = report.attempt.msiPath;
      if (!/^[A-Za-z0-9_./-]+\.msi$/.test(path) || path.startsWith("/")
        || path.split("/").some((part) => part === "." || part === "..")) unsafe();
    }
    verifyMSIBootObservation(report);
    // Recorded MSI registration is read-only evidence. Reject contradictory
    // samples and forged transition labels before asking for any grant.
    const verifyRegistrationSample = (sample: NonNullable<NonNullable<ClusterNativeMSIAttemptStatus["attempt"]>["preLaunchRegistration"]>, code: string, version: string): boolean => {
      if (sample.productCode !== code || sample.expectedVersion !== version || sample.readOnly !== true
        || sample.osAttested !== false || typeof sample.versionMatches !== "boolean" || typeof sample.probeComplete !== "boolean") return false;
      const absent = sample.state === "os_query_unavailable";
      if (absent) return !sample.probeComplete && sample.probeScope === "" && !sample.versionMatches && !sample.reportedVersion;
      if (!sample.probeComplete || sample.probeScope !== "current_user_and_machine") return false;
      if (sample.state === "registered_version_match") return sample.versionMatches && sample.reportedVersion === version;
      if (sample.state === "registered_version_mismatch") return !sample.versionMatches && /^\d{1,5}\.\d{1,5}\.\d{1,5}$/.test(sample.reportedVersion || "") && sample.reportedVersion !== version;
      return !sample.versionMatches && !sample.reportedVersion && ["not_registered_for_user", "advertised_not_verified",
        "registered_version_unavailable", "registration_incomplete_or_unknown"].includes(sample.state);
    };
    // Native dependency snapshots are read-only custody, not permission to
    // update or remove prerequisite products. Older receipts omit them.
    const dependents = report.attempt?.dependencies;
    if (dependents !== undefined) {
      if (!Array.isArray(dependents) || dependents.length > 12) unsafe();
      const seen = new Set<string>();
      for (const dep of dependents) {
        if (!dep || typeof dep !== "object" || !/^[a-z][a-z0-9-]{2,79}$/.test(dep.packageKey)
          || dep.packageKey === packageKey || seen.has(dep.packageKey)
          || !/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(dep.version)
          || !/^\{[0-9A-F]{8}-(?:[0-9A-F]{4}-){3}[0-9A-F]{12}\}$/.test(dep.productCode)
          || !/^\d{1,5}\.\d{1,5}\.\d{1,5}$/.test(dep.productVersion)
          || !/^[a-f0-9]{64}$/.test(dep.receiptSha256)) unsafe();
        seen.add(dep.packageKey);
      }
    }
    const registrationAttempt = report.attempt;
    if (!report.hasReceipt) {
      if (report.registrationTransition !== undefined || report.registrationDrift !== undefined) unsafe();
    } else if (registrationAttempt) {
      const before = registrationAttempt.preLaunchRegistration;
      const after = registrationAttempt.postExitRegistration;
      const transition = report.registrationTransition;
      const current = report.product;
      const drift = report.registrationDrift;
      const sameSample = !!after && !!current && after.state === current.state
        && after.productCode === current.productCode && after.expectedVersion === current.expectedVersion
        && (after.reportedVersion || "") === (current.reportedVersion || "")
        && after.versionMatches === current.versionMatches && after.probeComplete === current.probeComplete
        && after.probeScope === current.probeScope;
      const expectedDrift = !after ? "no_post_exit_baseline"
        : (after.state === "os_query_unavailable" || current?.state === "os_query_unavailable")
        ? "registration_comparison_unavailable"
        : sameSample ? "registration_unchanged_since_exit" : "registration_changed_since_exit";
      if (drift !== expectedDrift) unsafe();
      if (!before) {
        if (after || transition !== "historical_receipt_no_transition_evidence") unsafe();
      } else {
        if (!verifyRegistrationSample(before, registrationAttempt.productCode, registrationAttempt.productVersion)
          || before.state !== "not_registered_for_user" || !registrationAttempt.launchCommittedAt) unsafe();
        if (!after) {
          if (registrationAttempt.state !== "msi_started_outcome_unknown" || registrationAttempt.finishedAt
            || transition !== "prelaunch_recorded_outcome_unknown") unsafe();
        } else {
          if (!verifyRegistrationSample(after, registrationAttempt.productCode, registrationAttempt.productVersion)
            || !registrationAttempt.finishedAt || registrationAttempt.state === "msi_started_outcome_unknown") unsafe();
          const expected = after.state === "registered_version_match" ? "matching_registration_observed_after_attempt"
            : after.state === "not_registered_for_user" ? "no_registration_observed_after_attempt"
            : after.state === "os_query_unavailable" ? "post_exit_registration_unavailable"
            : "conflicting_registration_observed_after_attempt";
          if (transition !== expected) unsafe();
        }
      }
    }
    // A negative preflight must not be manufactured from a partial receipt,
    // inconsistent lock state or a Windows registration query for another item.
    if (!report.hasReceipt) {
      if (report.attempt || report.product || report.receiptSha256) unsafe();
      if (report.lockPresent) {
        if (report.state !== "interrupted_or_active_without_receipt" || !report.manualReviewRequired) unsafe();
      } else if (report.state !== "no_recorded_attempt" || report.manualReviewRequired) unsafe();
      return;
    }
    const attempt = report.attempt;
    const product = report.product;
    const permitted = ["msi_prepared_not_launched", "msi_started_outcome_unknown", "msi_failed_or_outcome_unknown",
      "msi_exit_zero_not_os_attested", "msi_restart_required_not_os_attested"];
    if (!attempt || !product || !report.manualReviewRequired || !permitted.includes(report.state)
      || attempt.state !== report.state || attempt.packageKey !== packageKey || attempt.osAttested !== false
      || !/^[0-9a-f]{64}$/.test(report.receiptSha256 || "")
      || !/^[0-9a-f]{64}$/.test(attempt.artifactSha256 || "") || !/^[0-9a-f]{64}$/.test(attempt.msiSha256 || "")
      || !/^\{[0-9A-F]{8}-(?:[0-9A-F]{4}-){3}[0-9A-F]{12}\}$/.test(attempt.productCode || "")
      || !/^\d{1,5}\.\d{1,5}\.\d{1,5}$/.test(attempt.productVersion || "")
      || product.productCode !== attempt.productCode || product.expectedVersion !== attempt.productVersion
      || product.readOnly !== true || product.osAttested !== false || typeof product.state !== "string"
      || typeof product.probeComplete !== "boolean"
      || !["", "current_user_and_machine"].includes(product.probeScope)
      || (product.probeComplete !== (product.probeScope === "current_user_and_machine"))
      || (product.state === "os_query_unavailable" ? (product.probeComplete || product.versionMatches === true || !!product.reportedVersion)
        : (!product.probeComplete || !["not_registered_for_user", "advertised_not_verified", "registered_version_match",
          "registered_version_mismatch", "registered_version_unavailable", "registration_incomplete_or_unknown"].includes(product.state)))
      || (product.state === "registered_version_match" ? (!product.versionMatches || product.reportedVersion !== product.expectedVersion)
        : product.versionMatches === true)) unsafe();
  }

  function isRecordedMSIAttemptBlocked(report: ClusterNativeMSIAttemptStatus | undefined): boolean {
    // Missing history is not proof that a product is absent; it is only the
    // native helper's narrow "no local attempt recorded" preflight state.
    return !!report && (report.hasReceipt || report.lockPresent || report.manualReviewRequired
      || report.state !== "no_recorded_attempt");
  }

  function verifyReadOnlyMSIProfile(report: ClusterNativeMSIProfileStatus): void {
    const unsafe = (): never => { throw new Error("Inconsistent native MSI profile inventory. No recovery action was taken."); };
    if (!report || report.schema !== 1 || report.readOnly !== true || report.osAttested !== false
      || report.retryAuthorized !== false || report.complete !== true
      || typeof report.admissionLockPresent !== "boolean" || typeof report.manualReviewRequired !== "boolean"
      || !Array.isArray(report.records) || report.records.length > 64
      || !Array.isArray(report.lifecycleRecords) || report.lifecycleRecords.length > 64
      || report.lifecycleMutationAuthorized !== false || !Array.isArray(report.dependencyEdges) || report.dependencyEdges.length > 256
      || report.manualReviewRequired !== (report.admissionLockPresent || report.records.length > 0 || report.lifecycleRecords.length > 0)
      || report.state !== (report.manualReviewRequired ? "msi_profile_manual_review" : "no_recorded_msi_attempts")) unsafe();
    // A profile graph is only meaningful when it is an exact, sorted
    // projection of the same individual native receipts we validated.
    const recorded = new Map(report.records.map((record) => [record.packageKey, record]));
    const expectedEdges = report.records.flatMap((record) => (record.attempt?.dependencies || []).map((dep) => {
      const matched = recorded.get(dep.packageKey);
      const exists = !!matched?.hasReceipt && !!matched.attempt && !!matched.receiptSha256;
      return { dependentPackageKey: record.packageKey, dependencyPackageKey: dep.packageKey,
        dependencyVersion: dep.version, dependencyReceiptSha256: dep.receiptSha256,
        recordedDependencyPresent: exists,
        recordedReceiptMatches: exists && matched!.receiptSha256 === dep.receiptSha256
          && matched!.attempt!.version === dep.version && matched!.attempt!.productCode === dep.productCode
          && matched!.attempt!.productVersion === dep.productVersion };
    })).sort((a, b) => a.dependentPackageKey === b.dependentPackageKey
      ? (a.dependencyPackageKey < b.dependencyPackageKey ? -1 : a.dependencyPackageKey > b.dependencyPackageKey ? 1 : 0)
      : (a.dependentPackageKey < b.dependentPackageKey ? -1 : 1));
    if (report.dependencyEdges.length !== expectedEdges.length) unsafe();
    for (let i = 0; i < expectedEdges.length; i++) {
      const actual = report.dependencyEdges[i];
      const wanted = expectedEdges[i];
      if (!actual || actual.dependentPackageKey !== wanted.dependentPackageKey
        || actual.dependencyPackageKey !== wanted.dependencyPackageKey
        || actual.dependencyVersion !== wanted.dependencyVersion
        || actual.dependencyReceiptSha256 !== wanted.dependencyReceiptSha256
        || actual.recordedDependencyPresent !== wanted.recordedDependencyPresent
        || actual.recordedReceiptMatches !== wanted.recordedReceiptMatches) unsafe();
    }
    let previous = "";
    for (const item of report.records) {
      if (!item || !/^[a-z][a-z0-9-]{2,79}$/.test(item.packageKey) || (previous !== "" && item.packageKey <= previous)
        || item.admissionLockPresent !== report.admissionLockPresent
        || !item.manualReviewRequired || (!item.lockPresent && !item.hasReceipt)) unsafe();
      verifyReadOnlyMSIEvidence(item, item.packageKey);
      previous = item.packageKey;
    }
    let previousLifecycleKey = "";
    let previousLifecycleOperation = "";
    let pendingRollback: (typeof report.lifecycleRecords)[number] | null = null;
    for (const item of report.lifecycleRecords) {
      if (!item || !/^[a-z][a-z0-9-]{2,79}$/.test(item.packageKey)
        || (previousLifecycleKey && (item.packageKey < previousLifecycleKey
          || (item.packageKey === previousLifecycleKey && !(previousLifecycleOperation === "msi-rollback" && item.receipt?.operation === "upgrade"))))
        || item.schema !== 1 || item.hasReceipt !== true || item.manualReviewRequired !== true
        || item.readOnly !== true || item.osAttested !== false || item.retryAuthorized !== false
        || !/^[a-f0-9]{64}$/.test(item.receiptSha256 || "") || !item.receipt
        || item.receipt.packageKey !== item.packageKey || item.receipt.schema !== 1
        || !["repair", "uninstall", "upgrade", "msi-rollback"].includes(item.receipt.operation)
        || !item.state.startsWith(`${item.receipt.operation}_`) || item.receipt.state !== item.state
        || !["prepared_not_launched", "started_outcome_unknown", "failed_or_outcome_unknown", "exit_zero_not_os_attested", "restart_required_not_os_attested"].includes(item.state.slice(item.receipt.operation.length + 1))
        || !/^[a-f0-9]{64}$/.test(item.receipt.priorReceiptSha256)
        || !/^[a-f0-9]{64}$/.test(item.receipt.artifactSha256)
        || !/^[a-f0-9]{64}$/.test(item.receipt.msiSha256)
        || ((item.receipt.operation === "upgrade" || item.receipt.operation === "msi-rollback") && (!/^[a-f0-9]{64}$/.test((item.receipt as {priorMsiSha256?:string}).priorMsiSha256 || "")
          || !/^[0-9]{1,5}\.[0-9]{1,5}\.[0-9]{1,5}$/.test((item.receipt as {priorProductVersion?:string}).priorProductVersion || "")
          || (item.receipt as {priorProductVersion?:string}).priorProductVersion === item.receipt.productVersion))
        || (item.receipt.operation !== "upgrade" && item.receipt.operation !== "msi-rollback" && ((item.receipt as {priorMsiSha256?:string}).priorMsiSha256 !== undefined
          || (item.receipt as {priorProductVersion?:string}).priorProductVersion !== undefined))
        || !/^\{[0-9A-F]{8}-(?:[0-9A-F]{4}-){3}[0-9A-F]{12}\}$/.test(item.receipt.productCode)
        || !/^[0-9]{1,5}\.[0-9]{1,5}\.[0-9]{1,5}$/.test(item.receipt.productVersion)
        || item.receipt.osAttested !== false || !validUpgradeRecoveryEvidence(item)
        || (item.receipt.operation === "msi-rollback" && !validMSIRollbackJournal(item, item.packageKey))
        || (item.receipt.operation !== "msi-rollback" && ((item.receipt as {upgradeJournalSha256?:string}).upgradeJournalSha256 !== undefined
          || (item.receipt as {successorMsiSha256?:string}).successorMsiSha256 !== undefined))) unsafe();
      if (item.receipt.operation === "msi-rollback") pendingRollback = item;
      else if (pendingRollback) {
        const rollback = pendingRollback.receipt!;
        const upgrade = item.receipt;
        if (item.packageKey !== pendingRollback.packageKey || upgrade.operation !== "upgrade"
          || (rollback as {upgradeJournalSha256?: string}).upgradeJournalSha256 !== item.receiptSha256
          || (rollback as {priorMsiSha256?: string}).priorMsiSha256 !== (upgrade as {priorMsiSha256?: string}).priorMsiSha256
          || (rollback as {successorMsiSha256?: string}).successorMsiSha256 !== upgrade.msiSha256
          || rollback.priorReceiptSha256 !== upgrade.priorReceiptSha256
          || rollback.productVersion !== (upgrade as {priorProductVersion?: string}).priorProductVersion
          || (rollback as {priorProductVersion?: string}).priorProductVersion !== upgrade.productVersion) unsafe();
        pendingRollback = null;
      }
      previousLifecycleKey = item.packageKey;
      previousLifecycleOperation = item.receipt.operation;
    }
    if (pendingRollback) unsafe();
    validateMSILifecyclePlans(report);
  }

  async function inspectMSIProfile() {
    if (!available || msiProfileBusy || grantBusy) return;
    const startingGeneration = generation.current;
    setMsiProfileBusy(true); setError("");
    try {
      const report = await inspectNativeMSIProfile();
      if (startingGeneration !== generation.current) return;
      verifyReadOnlyMSIProfile(report);
      setMsiProfileEvidence(report);
    } catch (cause) {
      if (startingGeneration === generation.current)
        setError(cause instanceof Error ? cause.message : "Native MSI profile inspection failed.");
    } finally { if (startingGeneration === generation.current) setMsiProfileBusy(false); }
  }

  async function reviewMSIUpgrade(target: Target) {
    if (!available || platform !== "windows-x64" || !target.manifest.installer || !trust?.configured
      || msiUpgradeBusy || grantBusy || nativeStage.state === "verifying") return;
    const startingGeneration = generation.current;
    setMsiUpgradeBusy(target.package.key); setError(""); setNotice("");
    try {
      // Re-read both the selected server release and native custody. An old
      // UI profile snapshot must never authorize a review or future mutation.
      const fresh = await api<{ targets: Target[] }>(`/api/me/packages/targets?${new URLSearchParams({ channel, platform })}`);
      if (startingGeneration !== generation.current) return;
      if (!fresh.targets.some((entry) => entry.package.id === target.package.id && entry.package.key === target.package.key
        && entry.release.id === target.release.id && entry.release.version === target.release.version
        && entry.release.artifactSha256 === target.release.artifactSha256
        && entry.manifest.installer?.sha256 === target.manifest.installer?.sha256))
        throw new Error("The MSI upgrade target is no longer selected for this device.");
      const report = await inspectNativeMSIProfile();
      if (startingGeneration !== generation.current) return;
      verifyReadOnlyMSIProfile(report);
      setMsiProfileEvidence(report);
      const predecessor = report.records.find((record) => record.packageKey === target.package.key);
      if (!predecessor?.hasReceipt || !predecessor.attempt?.msiPath || !predecessor.receiptSha256
        || report.admissionLockPresent || report.lifecycleRecords.length)
        throw new Error("No verified retained predecessor MSI and clean lifecycle evidence is available for review.");
      // The native helper still rechecks ProductCode, installed version,
      // predecessor source checksum, known dependents and both registration reads.
      const result = await inspectNativeMSIUpgradeReadiness({
        expectedArtifactSha256: target.release.artifactSha256,
        expectedPackageKey: target.package.key,
        expectedVersion: target.release.version,
        priorReceiptSha256: predecessor.receiptSha256,
        preparedKit: preparedKitDigest === target.release.artifactSha256,
      });
      if (startingGeneration !== generation.current) return;
      if (result.accepted) setNativeStage({ state: "verifying", operationId: result.operationId });
      else setNotice("MSI upgrade review was canceled. No Windows installation changed.");
    } catch (cause) {
      if (startingGeneration === generation.current)
        setError(cause instanceof Error ? cause.message : "MSI upgrade readiness inspection failed.");
    } finally { if (startingGeneration === generation.current) setMsiUpgradeBusy(""); }
  }

  async function inspectMSI(target: Target) {
    if (!available || msiEvidenceBusy || !target.manifest.installer) return;
    const startingGeneration = generation.current;
    setMsiEvidenceBusy(target.package.key); setError("");
    try {
      const report = await inspectNativeMSIAttempt(target.package.key);
      if (startingGeneration !== generation.current) return;
      verifyReadOnlyMSIEvidence(report, target.package.key);
      setMsiEvidence((previous) => ({ ...previous, [target.package.key]: report }));
    } catch (cause) {
      if (startingGeneration === generation.current)
        setError(cause instanceof Error ? cause.message : "MSI attempt evidence unavailable.");
    } finally { if (startingGeneration === generation.current) setMsiEvidenceBusy(""); }
  }

  function verifyReadOnlyMSIRepairEvidence(report: ClusterNativeMSIRepairStatus, packageKey: string): void {
    const unsafe = (): never => { throw new Error("Inconsistent native MSI repair journal; manual review required."); };
    const sha = (value: unknown) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
    const code = (value: unknown) => typeof value === "string" && /^\{[0-9A-F]{8}-(?:[0-9A-F]{4}-){3}[0-9A-F]{12}\}$/.test(value);
    const version = (value: unknown) => typeof value === "string" && /^[0-9]{1,5}\.[0-9]{1,5}\.[0-9]{1,5}$/.test(value);
    if (!report || report.schema !== 1 || report.packageKey !== packageKey
      || report.readOnly !== true || report.osAttested !== false || report.retryAuthorized !== false
      || typeof report.hasReceipt !== "boolean" || typeof report.manualReviewRequired !== "boolean") unsafe();
    if (!report.hasReceipt) {
      if (report.manualReviewRequired !== false || report.state !== "no_recorded_repair"
        || report.receipt || report.receiptSha256) unsafe();
    } else {
      const receipt = report.receipt;
      const states = ["repair_prepared_not_launched", "repair_started_outcome_unknown",
        "repair_failed_or_outcome_unknown", "repair_exit_zero_not_os_attested", "repair_restart_required_not_os_attested"];
      if (!receipt || !states.includes(report.state) || receipt.state !== report.state
        || report.manualReviewRequired !== true || !sha(report.receiptSha256)
        || receipt.schema !== 1 || receipt.operation !== "repair" || receipt.packageKey !== packageKey
        || !sha(receipt.priorReceiptSha256) || !sha(receipt.artifactSha256) || !sha(receipt.msiSha256)
        || !code(receipt.productCode) || !version(receipt.productVersion)
        || receipt.osAttested !== false || Number.isNaN(Date.parse(receipt.startedAt))) unsafe();
    }
  }

  async function inspectMSIRepair(target: Target) {
    if (!available || msiRepairEvidenceBusy) return;
    const startingGeneration = generation.current;
    setMsiRepairEvidenceBusy(target.package.key); setError("");
    try {
      const report = await inspectNativeMSIRepair(target.package.key);
      if (startingGeneration !== generation.current) return;
      verifyReadOnlyMSIRepairEvidence(report, target.package.key);
      setMsiRepairEvidence((previous) => ({ ...previous, [target.package.key]: report }));
    } catch (cause) {
      if (startingGeneration === generation.current)
        setError(cause instanceof Error ? cause.message : "MSI repair evidence unavailable.");
    } finally { if (startingGeneration === generation.current) setMsiRepairEvidenceBusy(""); }
  }

  async function runMSIUpgrade(target: Target) {
    if (!available || platform !== "windows-x64" || !supervisedMsiUpgradeEnabled || !target.manifest.installer
      || !trust?.configured || !controlTrust?.configured || nativeStage.state === "verifying"
      || grantBusy || msiGrantPending.current || msiUpgradeBusy) return;
    const snapshot = nativeStage.msiUpgrade;
    // An earlier signed, read-only preview is only a prerequisite for the operator
    // UI. Native admission repeats every check after grant consumption.
    if (nativeStage.state !== "msi_upgrade_reviewable_not_authorized" || !snapshot
      || snapshot.packageKey !== target.package.key || snapshot.artifactSha256 !== target.release.artifactSha256
      || snapshot.version !== target.release.version || snapshot.state !== "reviewable_not_authorized"
      || snapshot.mutationAuthorized !== false || snapshot.readOnly !== true
      || !/^[a-f0-9]{64}$/.test(snapshot.priorReceiptSha256)
      || !/^[a-f0-9]{64}$/.test(snapshot.priorMsiSha256)) {
      setError("Run the signed, read-only predecessor MSI upgrade review before requesting authorization."); return;
    }
    msiGrantPending.current = true;
    const owner = ++msiGrantOwner.current;
    const current = generation.current;
    setGrantBusy(true); setError(""); setNotice("");
    try {
      const fresh = await api<{ targets: Target[]; nativeUpgradeAvailable?: boolean; nativeRollbackAvailable?: boolean }>(`/api/me/packages/targets?${new URLSearchParams({ channel, platform })}`);
      if (current !== generation.current) return;
      if (fresh.nativeUpgradeAvailable !== true || !fresh.targets.some((item) => item.package.id === target.package.id
        && item.package.key === target.package.key && item.release.id === target.release.id
        && item.release.version === target.release.version && item.release.artifactSha256 === target.release.artifactSha256
        && item.manifest.installer?.sha256 === target.manifest.installer?.sha256))
        throw new Error("Signed upgrade target was revoked or upgrade is no longer enabled.");
      const [profile, journal] = await Promise.all([inspectNativeMSIProfile(), inspectNativeMSIUpgrade(target.package.key)]);
      if (current !== generation.current) return;
      verifyReadOnlyMSIProfile(profile);
      if (journal.hasReceipt || journal.manualReviewRequired || journal.state !== "no_recorded_upgrade")
        throw new Error("An earlier upgrade journal requires manual review. No new grant requested.");
      const predecessor = profile.records.find((record) => record.packageKey === target.package.key);
      if (!predecessor?.hasReceipt || predecessor.receiptSha256 !== snapshot.priorReceiptSha256
        || predecessor.attempt?.msiSha256 !== snapshot.priorMsiSha256
        || predecessor.attempt?.productCode !== target.manifest.installer.productCode
        || predecessor.attempt.productVersion !== snapshot.priorProductVersion
        || profile.admissionLockPresent || profile.lifecycleRecords.length
        || profile.dependencyEdges.some((edge) => !edge.recordedReceiptMatches || edge.dependencyPackageKey === target.package.key))
        throw new Error("Predecessor receipt, Windows software identity, or dependent Package evidence changed.");
      const authorization = await api<{ ok: true; grant: ClusterPackageDeploymentGrant; purpose: string; executableInstallationAllowed: boolean }>(
        `/api/me/packages/${encodeURIComponent(target.package.id)}/releases/${encodeURIComponent(target.release.id)}/authorize-content`,
        { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ channel, platform, operation: "upgrade", priorReceiptSha256: snapshot.priorReceiptSha256,
            priorMsiSha256: snapshot.priorMsiSha256 }) });
      if (current !== generation.current) return;
      if (!authorization.grant || authorization.purpose !== "supervised_user_msi_upgrade"
        || authorization.executableInstallationAllowed !== true || authorization.grant.expiresAt * 1000 <= Date.now())
        throw new Error("A separate executable MSI upgrade authorization was not issued.");
      const result = await runNativeSupervisedMSIUpgrade({expectedArtifactSha256: target.release.artifactSha256,
        expectedPackageKey: target.package.key, expectedVersion: target.release.version, grant: authorization.grant});
      if (current === generation.current && result.accepted)
        setNativeStage({state:"verifying",operationId:result.operationId});
    } catch (cause) {
      if (current === generation.current) setError(cause instanceof Error ? cause.message : "Supervised MSI upgrade refused.");
    } finally {
      if (owner === msiGrantOwner.current) { msiGrantPending.current = false; setGrantBusy(false); }
    }
  }

  async function inspectMSIUpgradeJournal(target: Target) {
    if (!available || msiUpgradeBusy) return;
    const current = generation.current;
    setMsiUpgradeBusy(target.package.key); setError("");
    try {
      const journal = await inspectNativeMSIUpgrade(target.package.key);
      if (current !== generation.current) return;
      const receipt = journal.receipt;
      if (journal.schema !== 1 || journal.packageKey !== target.package.key || journal.readOnly !== true
        || journal.osAttested !== false || journal.retryAuthorized !== false
        || journal.hasReceipt !== !!receipt || journal.manualReviewRequired !== journal.hasReceipt
        || (journal.hasReceipt && (!/^[a-f0-9]{64}$/.test(journal.receiptSha256 || "")
          || !/^[a-f0-9]{64}$/.test(receipt?.priorMsiSha256 || "")
          || !/^[a-f0-9]{64}$/.test(receipt?.priorReceiptSha256 || "")
          || receipt?.operation !== "upgrade" || receipt.state !== journal.state
          || !validUpgradeRecoveryEvidence(journal))))
        throw new Error("Native upgrade journal evidence was inconsistent.");
      setMsiUpgradeEvidence((previous) => ({...previous,[target.package.key]:journal}));
    } catch (cause) { if (current === generation.current) setError(cause instanceof Error ? cause.message : "MSI upgrade journal unavailable."); }
    finally { if (current === generation.current) setMsiUpgradeBusy(""); }
  }

  async function inspectMSIRollback(target: Target) {
    if (!available || msiRollbackBusy || grantBusy || nativeStage.state === "verifying" || platform !== "windows-x64") return;
    const current = generation.current;
    setMsiRollbackBusy(target.package.key); setError("");
    try {
      const report = await inspectNativeMSIRollbackReview(target.package.key);
      if (current !== generation.current) return;
      if (!validMSIRollbackReview(report, target.package.key))
        throw new Error("Native rollback evidence or dependency order was inconsistent.");
      setMsiRollbackReview((previous) => ({ ...previous, [target.package.key]: report }));
    } catch (cause) {
      if (current === generation.current) setError(cause instanceof Error ? cause.message : "MSI rollback review failed.");
    } finally { if (current === generation.current) setMsiRollbackBusy(""); }
  }

  async function inspectMSIRollbackCascade(target: Target) {
    if (!available || msiRollbackBusy || grantBusy || nativeStage.state === "verifying" || platform !== "windows-x64") return;
    const current = generation.current;
    setMsiRollbackBusy(target.package.key); setError("");
    try {
      const plan = await inspectNativeMSIRollbackCascade(target.package.key);
      if (current !== generation.current) return;
      if (!validMSIRollbackCascade(plan, target.package.key))
        throw new Error("Native MSI dependency recovery workflow was inconsistent.");
      setMsiRollbackCascade(previous => ({...previous, [target.package.key]:plan}));
    } catch (cause) {
      if (current === generation.current) setError(cause instanceof Error ? cause.message : "MSI recovery workflow unavailable.");
    } finally { if (current === generation.current) setMsiRollbackBusy(""); }
  }

  async function runMSIRollback(target: Target) {
    const previous = msiRollbackReview[target.package.key];
    if (!available || busy || grantBusy || msiGrantPending.current || !trust?.configured || !controlTrust?.configured
      || !supervisedMsiRollbackEnabled || nativeStage.state === "verifying" || platform !== "windows-x64"
      || !target.manifest.installer || !previous || !validMSIRollbackReview(previous, target.package.key)
      || previous.state !== "reviewable_not_authorized" || previous.outstandingDependents.length !== 0
      || previous.settledDependents.length !== previous.knownDependents.length
      || previous.recoveryOrder.at(-1) !== target.package.key
      || target.manifest.installer.productVersion !== previous.predecessorProductVersion
      || msiProfileEvidence?.lifecycleRecords.some((journal) => journal.receipt?.operation === "msi-rollback")) return;
    msiGrantPending.current = true;
    const owner = ++msiGrantOwner.current;
    const initial = generation.current;
    setGrantBusy(true); setError(""); setNotice("");
    try {
      const fresh = await inspectNativeMSIRollbackReview(target.package.key);
      if (initial !== generation.current) return;
      if (!validMSIRollbackReview(fresh, target.package.key) || fresh.state !== "reviewable_not_authorized"
        || fresh.priorReceiptSha256 !== previous.priorReceiptSha256
        || fresh.upgradeJournalSha256 !== previous.upgradeJournalSha256
        || fresh.predecessorMsiSha256 !== previous.predecessorMsiSha256
        || fresh.successorMsiSha256 !== previous.successorMsiSha256
        || fresh.predecessorProductVersion !== target.manifest.installer.productVersion
        || fresh.outstandingDependents.length !== 0 || fresh.settledDependents.length !== fresh.knownDependents.length
        || fresh.recoveryOrder.at(-1) !== target.package.key
        || JSON.stringify(fresh.knownDependents) !== JSON.stringify(previous.knownDependents)
        || JSON.stringify(fresh.settledDependents) !== JSON.stringify(previous.settledDependents)
        || JSON.stringify(fresh.outstandingDependents) !== JSON.stringify(previous.outstandingDependents))
        throw new Error("Rollback predecessor, upgrade journal or dependent dispositions changed before authorization.");
      const status = await inspectNativeMSIRollbackStatus(target.package.key);
      if (initial !== generation.current) return;
      if (!validMSIRollbackJournal(status, target.package.key) || status.hasReceipt)
        throw new Error("A rollback already has a durable journal; automatic replay is forbidden.");
      const targetsResult = await api<{targets: Target[]; nativeRollbackAvailable?: boolean}>(
        `/api/me/packages/targets?${new URLSearchParams({channel, platform})}`);
      if (initial !== generation.current) return;
      if (targetsResult.nativeRollbackAvailable !== true || !targetsResult.targets.some((current) =>
        current.package.id === target.package.id && current.package.key === target.package.key
        && current.release.id === target.release.id && current.release.artifactSha256 === target.release.artifactSha256
        && current.manifest.installer?.productCode === target.manifest.installer?.productCode
        && current.manifest.installer?.productVersion === previous.predecessorProductVersion))
        throw new Error("Original MSI release is no longer entitled to this device.");
      const authorization = await api<{ok:boolean;grant:ClusterPackageDeploymentGrant;purpose:string;executableInstallationAllowed:boolean}>(
        `/api/me/packages/${encodeURIComponent(target.package.id)}/releases/${encodeURIComponent(target.release.id)}/authorize-content`,
        {method:"POST", body: JSON.stringify({channel,platform,operation:"msi-rollback",
          priorReceiptSha256:previous.priorReceiptSha256,priorMsiSha256:previous.predecessorMsiSha256,
          upgradeJournalSha256:previous.upgradeJournalSha256,successorMsiSha256:previous.successorMsiSha256})});
      if (initial !== generation.current) return;
      if (!authorization.ok || authorization.purpose !== "supervised_user_msi_rollback"
        || authorization.executableInstallationAllowed !== true
        || !authorization.grant || authorization.grant.expiresAt * 1000 <= Date.now())
        throw new Error("No separate signed MSI rollback grant was issued.");
      const result = await runNativeSupervisedMSIRollback({expectedArtifactSha256:target.release.artifactSha256,
        expectedPackageKey:target.package.key,expectedVersion:target.release.version,grant:authorization.grant});
      if (initial === generation.current && result.accepted)
        setNativeStage({state:"verifying",operationId:result.operationId});
    } catch (cause) {
      if (initial === generation.current) setError(cause instanceof Error ? cause.message : "Signed rollback refused.");
    } finally {
      if (owner === msiGrantOwner.current) {msiGrantPending.current=false;setGrantBusy(false);}
    }
  }

  async function inspectMSIRollbackJournal(target: Target) {
    if (!available || msiRollbackBusy || grantBusy) return;
    const current = generation.current;
    setMsiRollbackBusy(target.package.key); setError("");
    try {
      const journal = await inspectNativeMSIRollbackStatus(target.package.key);
      if (current !== generation.current) return;
      if (!validMSIRollbackJournal(journal, target.package.key))
        throw new Error("Native rollback journal or registration evidence is inconsistent.");
      setMsiRollbackJournal((previous) => ({ ...previous, [target.package.key]: journal }));
    } catch (cause) {
      if (current === generation.current) setError(cause instanceof Error ? cause.message : "MSI rollback journal unavailable.");
    } finally { if (current === generation.current) setMsiRollbackBusy(""); }
  }

  async function runMSIRepair(target: Target) {
    if (!available || busy || grantBusy || msiGrantPending.current || !trust?.configured || !controlTrust?.configured
      || !supervisedMsiRepairEnabled || nativeStage.state === "verifying" || platform !== "windows-x64"
      || !target.manifest.installer) return;
    msiGrantPending.current = true;
    const grantOwner = ++msiGrantOwner.current;
    const startingGeneration = generation.current;
    setGrantBusy(true); setError(""); setNotice("");
    try {
      const current = await api<{ targets: Target[]; nativeRepairAvailable?: boolean }>(`/api/me/packages/targets?${new URLSearchParams({ channel, platform })}`);
      if (startingGeneration !== generation.current) return;
      if (current.nativeRepairAvailable !== true || !current.targets.some((item) => item.package.id === target.package.id
        && item.package.key === target.package.key && item.release.id === target.release.id
        && item.release.artifactSha256 === target.release.artifactSha256
        && item.release.version === target.release.version
        && item.manifest.installer?.sha256 === target.manifest.installer?.sha256))
        throw new Error("The signed MSI repair target is no longer authorized.");
      const [profile, previousRepair] = await Promise.all([inspectNativeMSIProfile(), inspectNativeMSIRepair(target.package.key)]);
      if (startingGeneration !== generation.current) return;
      verifyReadOnlyMSIProfile(profile);
      verifyReadOnlyMSIRepairEvidence(previousRepair, target.package.key);
      setMsiProfileEvidence(profile);
      setMsiRepairEvidence((previous) => ({ ...previous, [target.package.key]: previousRepair }));
      if (previousRepair.hasReceipt || previousRepair.manualReviewRequired)
        throw new Error("An earlier MSI repair journal exists. Manual investigation is required before any further action.");
      const repairPlan = profile.lifecyclePlans.find((item) => item.packageKey === target.package.key && item.operation === "repair");
      const record = profile.records.find((item) => item.packageKey === target.package.key);
      if (!repairPlan || repairPlan.state !== "requires_operator_review" || repairPlan.blockers.length !== 0
        || !record?.hasReceipt || !record.receiptSha256 || !record.attempt
        || record.attempt.artifactSha256 !== target.release.artifactSha256
        || record.attempt.version !== target.release.version
        || record.attempt.msiSha256 !== target.manifest.installer.sha256
        || record.attempt.productCode !== target.manifest.installer.productCode
        || record.attempt.productVersion !== target.manifest.installer.productVersion
        || repairPlan.recordedReceiptSha256 !== record.receiptSha256)
        throw new Error("This MSI is not eligible for supervised repair based on local evidence and dependency review.");
      const authorization = await api<{ ok: true; grant: ClusterPackageDeploymentGrant; purpose: string }>(
        `/api/me/packages/${encodeURIComponent(target.package.id)}/releases/${encodeURIComponent(target.release.id)}/authorize-content`,
        { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ channel, platform, operation: "repair", priorReceiptSha256: record.receiptSha256 }) });
      if (startingGeneration !== generation.current) return;
      if (authorization.purpose !== "supervised_user_msi_repair" || !authorization.grant
        || authorization.grant.expiresAt * 1000 <= Date.now())
        throw new Error("A dedicated MSI repair authorization was not issued.");
      const response = await runNativeSupervisedMSIRepair({
        expectedArtifactSha256: target.release.artifactSha256,
        expectedPackageKey: target.package.key, expectedVersion: target.release.version, grant: authorization.grant,
      });
      if (startingGeneration === generation.current && response.accepted)
        setNativeStage({ state: "verifying", operationId: response.operationId });
    } catch (cause) {
      if (startingGeneration === generation.current)
        setError(cause instanceof Error ? cause.message : "Supervised repair refused.");
    } finally {
      if (grantOwner === msiGrantOwner.current) { msiGrantPending.current = false; setGrantBusy(false); }
    }
  }

  function verifyReadOnlyMSIUninstallEvidence(report: ClusterNativeMSIUninstallStatus, packageKey: string): void {
    const unsafe = (): never => { throw new Error("Inconsistent native MSI uninstall journal; manual review required."); };
    const sha = (value: unknown) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
    const code = (value: unknown) => typeof value === "string" && /^\{[0-9A-F]{8}-(?:[0-9A-F]{4}-){3}[0-9A-F]{12}\}$/.test(value);
    const version = (value: unknown) => typeof value === "string" && /^[0-9]{1,5}\.[0-9]{1,5}\.[0-9]{1,5}$/.test(value);
    if (!report || report.schema !== 1 || report.packageKey !== packageKey
      || report.readOnly !== true || report.osAttested !== false || report.retryAuthorized !== false
      || typeof report.hasReceipt !== "boolean" || typeof report.manualReviewRequired !== "boolean") unsafe();
    if (!report.hasReceipt) {
      if (report.manualReviewRequired !== false || report.state !== "no_recorded_uninstall"
        || report.receipt || report.receiptSha256) unsafe();
    } else {
      const receipt = report.receipt;
      const states = ["uninstall_prepared_not_launched", "uninstall_started_outcome_unknown",
        "uninstall_failed_or_outcome_unknown", "uninstall_exit_zero_not_os_attested", "uninstall_restart_required_not_os_attested"];
      if (!receipt || !states.includes(report.state) || receipt.state !== report.state
        || report.manualReviewRequired !== true || !sha(report.receiptSha256)
        || receipt.schema !== 1 || receipt.operation !== "uninstall" || receipt.packageKey !== packageKey
        || !sha(receipt.priorReceiptSha256) || !sha(receipt.artifactSha256) || !sha(receipt.msiSha256)
        || !code(receipt.productCode) || !version(receipt.productVersion)
        || receipt.osAttested !== false || Number.isNaN(Date.parse(receipt.startedAt))) unsafe();
    }
  }

  async function inspectMSIUninstall(target: Target) {
    if (!available || msiUninstallEvidenceBusy) return;
    const startingGeneration = generation.current;
    setMsiUninstallEvidenceBusy(target.package.key); setError("");
    try {
      const report = await inspectNativeMSIUninstall(target.package.key);
      if (startingGeneration !== generation.current) return;
      verifyReadOnlyMSIUninstallEvidence(report, target.package.key);
      setMsiUninstallEvidence((previous) => ({ ...previous, [target.package.key]: report }));
    } catch (cause) {
      if (startingGeneration === generation.current)
        setError(cause instanceof Error ? cause.message : "MSI uninstall evidence unavailable.");
    } finally { if (startingGeneration === generation.current) setMsiUninstallEvidenceBusy(""); }
  }

  async function runMSIUninstall(target: Target) {
    if (!available || busy || grantBusy || msiGrantPending.current || !trust?.configured || !controlTrust?.configured
      || !supervisedMsiUninstallEnabled || nativeStage.state === "verifying" || platform !== "windows-x64"
      || !target.manifest.installer) return;
    msiGrantPending.current = true;
    const grantOwner = ++msiGrantOwner.current;
    const startingGeneration = generation.current;
    setGrantBusy(true); setError(""); setNotice("");
    try {
      const current = await api<{ targets: Target[]; nativeUninstallAvailable?: boolean }>(`/api/me/packages/targets?${new URLSearchParams({ channel, platform })}`);
      if (startingGeneration !== generation.current) return;
      if (current.nativeUninstallAvailable !== true || !current.targets.some((item) => item.package.id === target.package.id
        && item.package.key === target.package.key && item.release.id === target.release.id
        && item.release.artifactSha256 === target.release.artifactSha256
        && item.release.version === target.release.version
        && item.manifest.installer?.sha256 === target.manifest.installer?.sha256))
        throw new Error("The signed MSI uninstall target is no longer authorized.");
      const [profile, previousUninstall] = await Promise.all([inspectNativeMSIProfile(), inspectNativeMSIUninstall(target.package.key)]);
      if (startingGeneration !== generation.current) return;
      verifyReadOnlyMSIProfile(profile);
      verifyReadOnlyMSIUninstallEvidence(previousUninstall, target.package.key);
      setMsiProfileEvidence(profile);
      setMsiUninstallEvidence((previous) => ({ ...previous, [target.package.key]: previousUninstall }));
      if (previousUninstall.hasReceipt || previousUninstall.manualReviewRequired)
        throw new Error("An earlier MSI uninstall journal exists. Manual investigation is required before any further action.");
      const uninstallPlan = profile.lifecyclePlans.find((item) => item.packageKey === target.package.key && item.operation === "uninstall");
      const record = profile.records.find((item) => item.packageKey === target.package.key);
      // Historical graph edges remain visible after a separate dependent's
      // completed uninstall. The old lifecycle projection may still list
      // those edges as blockers; only a FRESH native cascade projection may
      // override that one historical blocker. The native executor is the
      // final authority and repeats the durable journal / OS checks.
      const ordinaryEligible = uninstallPlan?.state === "requires_operator_review" && uninstallPlan.blockers.length === 0;
      let cascadeEligible = false;
      if (!ordinaryEligible && record?.receiptSha256 && uninstallPlan &&
          uninstallPlan.blockers.every(reason => reason === "known_dependent_packages_present")) {
        for (const saved of Object.values(msiRollbackCascade)) {
          if (!validMSIRollbackCascade(saved, saved.packageKey)) continue;
          if (!saved.steps.some(step => step.packageKey === target.package.key && step.operation === "uninstall" &&
              step.state === "independent_operator_review_required" && step.recordedReceiptSha256 === record.receiptSha256)) continue;
          const latest = await inspectNativeMSIRollbackCascade(saved.packageKey);
          if (startingGeneration !== generation.current) return;
          if (validMSIRollbackCascade(latest, saved.packageKey) &&
              latest.priorReceiptSha256 === saved.priorReceiptSha256 &&
              latest.upgradeJournalSha256 === saved.upgradeJournalSha256 &&
              latest.recoveryOrder.join("|") === saved.recoveryOrder.join("|") &&
              latest.steps.some(step => step.packageKey === target.package.key && step.operation === "uninstall" &&
                step.state === "independent_operator_review_required" && step.recordedReceiptSha256 === record.receiptSha256)) {
            cascadeEligible = true;
            break;
          }
        }
      }
      if (!uninstallPlan || (!ordinaryEligible && !cascadeEligible)
        || !record?.hasReceipt || !record.receiptSha256 || !record.attempt
        || record.attempt.artifactSha256 !== target.release.artifactSha256
        || record.attempt.version !== target.release.version
        || record.attempt.msiSha256 !== target.manifest.installer.sha256
        || record.attempt.productCode !== target.manifest.installer.productCode
        || record.attempt.productVersion !== target.manifest.installer.productVersion
        || uninstallPlan.recordedReceiptSha256 !== record.receiptSha256)
        throw new Error("This MSI is not eligible for supervised uninstall based on local evidence and dependency review.");
      const authorization = await api<{ ok: true; grant: ClusterPackageDeploymentGrant; purpose: string }>(
        `/api/me/packages/${encodeURIComponent(target.package.id)}/releases/${encodeURIComponent(target.release.id)}/authorize-content`,
        { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ channel, platform, operation: "uninstall", priorReceiptSha256: record.receiptSha256 }) });
      if (startingGeneration !== generation.current) return;
      if (authorization.purpose !== "supervised_user_msi_uninstall" || !authorization.grant
        || authorization.grant.expiresAt * 1000 <= Date.now())
        throw new Error("A dedicated MSI uninstall authorization was not issued.");
      const response = await runNativeSupervisedMSIUninstall({
        expectedArtifactSha256: target.release.artifactSha256,
        expectedPackageKey: target.package.key, expectedVersion: target.release.version, grant: authorization.grant,
      });
      if (startingGeneration === generation.current && response.accepted)
        setNativeStage({ state: "verifying", operationId: response.operationId });
    } catch (cause) {
      if (startingGeneration === generation.current)
        setError(cause instanceof Error ? cause.message : "Supervised uninstall refused.");
    } finally {
      if (grantOwner === msiGrantOwner.current) { msiGrantPending.current = false; setGrantBusy(false); }
    }
  }

  async function runMSI(target: Target, operation: "preview" | "install") {
    if (!available || busy || grantBusy || msiGrantPending.current || !trust?.configured || nativeStage.state === "verifying"
      || !target.manifest.installer || platform !== "windows-x64") return;
    // State updates alone are not a lock: two clicks can enter before React
    // renders. The local helper also enforces durable receipt/lock custody.
    msiGrantPending.current = true;
    const grantOwner = ++msiGrantOwner.current;
    const startingGeneration = generation.current;
    setGrantBusy(true); setError(""); setNotice("");
    try {
      const current = await api<{ targets: Target[] }>(`/api/me/packages/targets?${new URLSearchParams({ channel, platform })}`);
      if (startingGeneration !== generation.current) return;
      if (!current.targets.some((item) => item.package.id === target.package.id && item.package.key === target.package.key
        && item.release.id === target.release.id && item.release.artifactSha256 === target.release.artifactSha256
        && item.release.version === target.release.version && item.manifest.installer?.sha256 === target.manifest.installer?.sha256))
        throw new Error("MSI release is no longer authorized for this device.");
      const identity = { expectedArtifactSha256: target.release.artifactSha256,
        expectedPackageKey: target.package.key, expectedVersion: target.release.version };
      if (operation === "preview") {
        const response = await runNativeSupervisedMSI(identity, "preview");
        if (startingGeneration === generation.current && response.accepted)
          setNativeStage({ state: "verifying", operationId: response.operationId });
        return;
      }
      if (!supervisedMsiEnabled || !controlTrust?.configured)
        throw new Error("Supervised MSI installer authority is not enabled or configured.");

      // Always inspect durable local state BEFORE asking the server to mint a
      // short-lived install grant. No record does not attest absence or health;
      // a prior record/lock means explicit human investigation, never replay.
      const report = await inspectNativeMSIAttempt(target.package.key);
      if (startingGeneration !== generation.current) return;
      verifyReadOnlyMSIEvidence(report, target.package.key);
      setMsiEvidence((previous) => ({ ...previous, [target.package.key]: report }));
      if (isRecordedMSIAttemptBlocked(report))
        throw new Error("A prior MSI attempt, operation lock, or recovery review requires manual investigation. No new installation grant was requested.");

      const authorization = await api<{ ok: true; grant: ClusterPackageDeploymentGrant; purpose: string }>(
        `/api/me/packages/${encodeURIComponent(target.package.id)}/releases/${encodeURIComponent(target.release.id)}/authorize-content`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ channel, platform, operation: "install" }) });
      if (startingGeneration !== generation.current) return;
      if (authorization.purpose !== "supervised_user_msi_install" || !authorization.grant
        || authorization.grant.expiresAt * 1000 <= Date.now())
        throw new Error("The dedicated short-lived MSI authorization is unavailable.");
      const response = await runNativeSupervisedMSI({ ...identity, grant: authorization.grant }, "install");
      if (startingGeneration === generation.current && response.accepted)
        setNativeStage({ state: "verifying", operationId: response.operationId });
    } catch (cause) {
      if (startingGeneration === generation.current)
        setError(cause instanceof Error ? cause.message : "Supervised MSI authorization failed.");
    } finally {
      if (grantOwner === msiGrantOwner.current) {
        msiGrantPending.current = false;
        setGrantBusy(false);
      }
    }
  }

  async function refresh() {
    if (!available || pending.current) return;
    const request = ++generation.current;
    pending.current = true;
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await api<{ targets: Target[]; nativeInstallationAvailable?: boolean; nativeRepairAvailable?: boolean; nativeUninstallAvailable?: boolean; nativeUpgradeAvailable?: boolean; nativeRollbackAvailable?: boolean }>(`/api/me/packages/targets?${new URLSearchParams({ channel, platform })}`);
      if (generation.current !== request) return;
      setSupervisedMsiEnabled(result.nativeInstallationAvailable === true);
      setSupervisedMsiRepairEnabled(result.nativeRepairAvailable === true);
      setSupervisedMsiUninstallEnabled(result.nativeUninstallAvailable === true);
      setSupervisedMsiUpgradeEnabled(result.nativeUpgradeAvailable === true);
      setSupervisedMsiRollbackEnabled(result.nativeRollbackAvailable === true);
      setTargets(result.targets || []); setLoaded(true);
    } catch (cause) {
      if (generation.current === request) setError(cause instanceof Error ? cause.message : "Device Package feed unavailable.");
    } finally {
      if (generation.current === request) { pending.current = false; setBusy(false); }
    }
  }

  async function inspectArchive(target: Target) {
    if (!available || downloadPending.current) return;
    try {
      // Recheck the currently authorized target before revealing local evidence.
      const fresh = await api<{ targets: Target[] }>(`/api/me/packages/targets?${new URLSearchParams({ channel, platform })}`);
      if (!fresh.targets.some((item) => item.package.id === target.package.id && item.release.id === target.release.id
        && item.release.artifactSha256 === target.release.artifactSha256))
        throw new Error("The selected Package is no longer authorized for this device.");
      const result = await inspectNativePackageArchive(target.release.artifactSha256);
      if (result.digest !== target.release.artifactSha256 || result.expectedBytes !== target.release.artifactSize)
        throw new Error("The native archive checkpoint differs from the selected release.");
      if (result.offer && (result.offer.packageId !== target.package.id || result.offer.releaseId !== target.release.id
        || result.offer.channel !== channel || result.offer.platform !== platform))
        throw new Error("The native checkpoint is bound to another Package context.");
      setArchiveEvidence((old) => ({ ...old, [target.release.id]: {
        receivedBytes: result.receivedBytes, expectedBytes: result.expectedBytes, state: result.state, bound: !!result.offer,
      } }));
      setError("");
    } catch (cause) {
      if ((cause as { code?: string })?.code === "PACKAGE_TRANSFER_NOT_FOUND")
        setNotice("No native archive checkpoint exists for this release in the active Desktop profile.");
      else setError(cause instanceof Error ? cause.message : "Native archive evidence unavailable.");
    }
  }


  async function diagnoseArchive(target: Target) {
    if (!available || busy || downloadPending.current) return;
    const request = generation.current;
    try {
      const fresh = await api<{ targets: Target[] }>(`/api/me/packages/targets?${new URLSearchParams({ channel, platform })}`);
      if (!fresh.targets.some((entry) => entry.package.id === target.package.id && entry.release.id === target.release.id
        && entry.release.artifactSha256 === target.release.artifactSha256))
        throw new Error("The selected Package is no longer authorized for this device.");
      const observed = await diagnoseNativePackageArchive(target.release.artifactSha256);
      if (generation.current !== request) return;
      setError("");
      setNotice(`Native archive diagnostic: ${observed.state.replaceAll("_", " ")}. `
        + (observed.lockPresent ? "A native process lock exists; investigate the prior helper before recovery. " : "")
        + (observed.manualReviewRequired ? "Local recovery requires explicit review. " : "")
        + "This read-only check did not recover bytes, renew an offer or install software.");
    } catch (cause) {
      if (generation.current === request) setError(cause instanceof Error ? cause.message : "Native transfer diagnostic unavailable.");
    }
  }

  async function recoverArchive(target: Target) {
    if (!available || busy || downloadPending.current || nativeStage.state === "verifying") return;
    setBusy(true); setError(""); setNotice("");
    const request = generation.current;
    try {
      // Local recovery is not a new entitlement. Verify current server-side
      // target access before asking Qt to offer the explicit OS confirmation.
      const fresh = await api<{ targets: Target[] }>(`/api/me/packages/targets?${new URLSearchParams({ channel, platform })}`);
      if (!fresh.targets.some((entry) => entry.package.id === target.package.id && entry.release.id === target.release.id
        && entry.release.artifactSha256 === target.release.artifactSha256))
        throw new Error("Device Package access changed; checkpoint recovery is not authorized.");
      const result = await recoverNativePackageArchive(target.release.artifactSha256);
      if ("accepted" in result && result.accepted === false) return;
      if (result.digest !== target.release.artifactSha256 || result.expectedBytes !== target.release.artifactSize)
        throw new Error("Recovered checkpoint does not match the currently selected release.");
      if (result.offer && (result.offer.packageId !== target.package.id || result.offer.releaseId !== target.release.id
        || result.offer.channel !== channel || result.offer.platform !== platform))
        throw new Error("Recovered checkpoint belongs to another Package offer.");
      if (generation.current !== request) return;
      setArchiveEvidence((old) => ({ ...old, [target.release.id]: {
        receivedBytes: result.receivedBytes, expectedBytes: result.expectedBytes, state: result.state, bound: !!result.offer,
      } }));
      const recovered = result.recoveredBytes ?? 0;
      setNotice(result.recoveryAction === "committed_interrupted_rename"
        ? "Native archive commit recovered after verifying the entire retained archive SHA-256. No installation occurred."
        : recovered > 0
          ? `Verified ${recovered.toLocaleString()} previously uncheckpointed bytes. A new server-authorized offer is still required to continue downloading.`
          : "Native archive checkpoint verified without changing retained payload bytes. No authorization or installation occurred.");
    } catch (cause) {
      if (generation.current === request) setError(cause instanceof Error ? cause.message : "Local native transfer recovery refused.");
    } finally {
      if (generation.current === request) setBusy(false);
    }
  }

  async function stageRetained(target: Target) {
    if (!available || busy || downloadPending.current || nativeStage.state === "verifying") return;
    setBusy(true); setError(""); setNotice("");
    const current = generation.current;
    try {
      if (!trust?.configured) throw new Error("Configure an independent Desktop Package signing pin before staging.");
      const fresh = await api<{ targets: Target[] }>(`/api/me/packages/targets?${new URLSearchParams({ channel, platform })}`);
      const authorized = fresh.targets.find((entry) => entry.package.id === target.package.id
        && entry.release.id === target.release.id
        && entry.release.artifactSha256 === target.release.artifactSha256);
      if (!authorized) throw new Error("This Package is no longer an authorized device target.");
      const checkpoint = await inspectNativePackageArchive(target.release.artifactSha256);
      if (checkpoint.state !== "committed" || checkpoint.digest !== target.release.artifactSha256
        || checkpoint.prefixSha256 !== target.release.artifactSha256
        || checkpoint.receivedBytes !== target.release.artifactSize
        || checkpoint.expectedBytes !== target.release.artifactSize)
        throw new Error("A complete verified archive is required before staging.");
      if (checkpoint.offer && (checkpoint.offer.packageId !== target.package.id
        || checkpoint.offer.releaseId !== target.release.id
        || checkpoint.offer.channel !== channel || checkpoint.offer.platform !== platform))
        throw new Error("Native archive belongs to a different Package offer.");
      const result = await stageRetainedNativePackageArchive({
        expectedArtifactSha256: authorized.release.artifactSha256,
        expectedPackageKey: authorized.package.key,
        expectedVersion: authorized.release.version,
        manifest: authorized.manifest, signatureBase64: authorized.signatureBase64,
        publicKeyPem: authorized.signingPublicKeyPem,
      });
      if (current !== generation.current) return;
      if (result.accepted) setNotice("Native verification started for the retained archive. The result will appear in Desktop staging status; no installation is authorized.");
      else setNotice("Native staging was cancelled. The verified archive is retained.");
    } catch (cause) {
      if (current === generation.current) setError(cause instanceof Error ? cause.message : "Retained archive stage failed.");
    } finally { if (current === generation.current) setBusy(false); }
  }

  async function download(target: Target, directlyStage = false, updateAfterStage = false, archiveOnly = false) {
    if (!available || downloadPending.current || pending.current) return;
    downloadPending.current = true;
    const request = generation.current;
    const controller = archiveOnly ? new AbortController() : null;
    archiveAbort.current = controller;
    setDownloadId(target.release.id); setDownloadProgress(0); setError(""); setNotice("");
    const { release, manifest } = target;
    try {
      if (manifest.schema !== 1 || manifest.packageKey !== target.package.key || manifest.platform !== platform
        || manifest.version !== release.version || manifest.filename !== release.filename
        || manifest.artifactSha256 !== release.artifactSha256 || manifest.artifactSize !== release.artifactSize
        || !/^[a-f0-9]{64}$/.test(release.artifactSha256) || release.artifactSize < 1 || release.artifactSize > (manifest.installer ? 32 : 4) * 1024 * 1024)
        throw new Error("Signed target metadata does not match the Package release.");
      const endpoint = `/api/me/packages/${encodeURIComponent(target.package.id)}/releases/${encodeURIComponent(release.id)}/download`;
      // Every byte segment carries a fresh non-exportable Desktop device proof.
      // The server rechecks active entitlements, release and device state for
      // every continuation; a receipt lease alone never confers access.
      let lease: PackageStageReceiptLease | null = null;
      if (archiveOnly) {
        // The native helper independently checks every prefix and verifies the
        // complete SHA before committing. No full ZIP assembly in renderer.
        const checkpoint = await prepareNativePackageArchive(manifest.artifactSha256, manifest.artifactSize);
        if (checkpoint.state === "committed") {
          // A local archive is not a standing entitlement. Recheck before
          // presenting it as available in the current authorized Package feed.
          const fresh = await api<{ targets: Target[] }>(`/api/me/packages/targets?${new URLSearchParams({ channel, platform })}`);
          if (!fresh.targets.some((item) => item.package.id === target.package.id && item.release.id === release.id
            && item.release.artifactSha256 === manifest.artifactSha256))
            throw new Error("This locally retained archive is no longer an authorized device target.");
          if (checkpoint.prefixSha256 !== manifest.artifactSha256 || checkpoint.receivedBytes !== manifest.artifactSize)
            throw new Error("Existing committed native archive does not match the release.");
          setNotice("The selected signed Package archive is already verified in this Desktop profile. No installation or server receipt was created.");
          return;
        }
        // The native profile holds only a nonsecret deployment identity. A
        // restart rotates its challenge through the server's authenticated
        // recovery route without creating another deployment offer.
        if (checkpoint.offer && (checkpoint.offer.packageId !== target.package.id
          || checkpoint.offer.releaseId !== release.id || checkpoint.offer.channel !== channel
          || checkpoint.offer.platform !== platform))
          throw new Error("The retained archive belongs to a different device offer or Package context; manual recovery is required.");
        await downloadPackageSegmentsToSink({ endpoint, channel, platform, deviceId: installationDeviceId(),
          artifactSize: manifest.artifactSize, artifactSha256: manifest.artifactSha256, fetcher: clusterApiFetch,
          resumeFrom: checkpoint.receivedBytes, signal: controller?.signal,
          ...(checkpoint.offer ? { recovery: { deploymentId: checkpoint.offer.deploymentId } } : {}),
          onLease: async (headers) => {
            lease = readPackageStageReceiptLease(headers, { artifactSha256: manifest.artifactSha256,
              packageKey: target.package.key, version: release.version });
            if (lease) await bindNativePackageArchiveOffer(manifest.artifactSha256, {
              deploymentId: lease.deploymentId, packageId: target.package.id,
              releaseId: release.id, channel, platform,
            });
            return lease ? { deploymentId: lease.deploymentId, receiptChallenge: lease.challenge } : null;
          },
          onSegment: async (start, chunk) => {
            const progress = await appendNativePackageArchiveSegment(manifest.artifactSha256, start, chunk);
            if (!progress || progress.receivedBytes !== start + chunk.length) throw new Error("Native archive checkpoint differs from downloaded segment.");
          },
          onProgress: (received, total) => {
            if (generation.current === request) setDownloadProgress(Math.floor(received * 100 / total));
          },
        });
        await commitNativePackageArchive(manifest.artifactSha256, manifest.artifactSize);
        if (generation.current !== request) return;
        setNotice(`Verified ${target.package.title} ${release.version} in this Desktop profile's native archive store. No staging, installation, or deployment occurred.`);
        return;
      }
      const downloaded = await downloadPackageSegments({ endpoint, channel, platform, deviceId: installationDeviceId(),
        artifactSize: manifest.artifactSize, artifactSha256: manifest.artifactSha256, fetcher: clusterApiFetch,
        onLease: (headers) => {
          lease = readPackageStageReceiptLease(headers, { artifactSha256: manifest.artifactSha256,
            packageKey: target.package.key, version: release.version });
          return lease ? { deploymentId: lease.deploymentId, receiptChallenge: lease.challenge } : null;
        },
        onProgress: (received, total) => {
          if (generation.current === request) setDownloadProgress(Math.floor(received * 100 / total));
        },
      });
      const bytes = downloaded.bytes;
      if (bytes.byteLength !== manifest.artifactSize) throw new Error("Downloaded Package size does not match the signed manifest.");
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))).map((n) => n.toString(16).padStart(2, "0")).join("");
      if (digest !== manifest.artifactSha256 || downloaded.initialHeaders.get("x-cluster-package-sha256") !== digest)
        throw new Error("Downloaded Package digest does not match the signed target and server response.");
      // Deliberately DO NOT include deployment/receipt challenges in the kit.
      // The signing public key within it is informative, NOT the trust pin.
      const kit = buildPackageStagingKit({ archive: bytes, filename: release.filename, manifest,
        signatureBase64: target.signatureBase64, publicKeyPem: target.signingPublicKeyPem });
      if (generation.current !== request) return;
      // Only ever retain opaque challenges in volatile renderer memory.
      // If the response did not include a valid lease, staging is still safe
      // but no progress report is emitted.
      if (lease) stageLeases.current.set(digest, lease);
      if (directlyStage) {
        if (!trust?.configured) throw new Error("Set up local Package signing trust before direct staging.");
        const authorized = await api<{ targets: Target[] }>(`/api/me/packages/targets?${new URLSearchParams({ channel, platform })}`);
        if (!authorized.targets.some((entry) => entry.package.id === target.package.id
          && entry.release.id === release.id && entry.release.artifactSha256 === digest))
          throw new Error("The Package is no longer an authorized device target.");
        await transferDownloadedPackageKitToNative(kit, { expectedArtifactSha256: digest,
          expectedPackageKey: target.package.key, expectedVersion: release.version });
        if (generation.current !== request) throw new Error("The selected Package feed changed during handoff.");
        setPreparedKitDigest(digest);
        stageIntent.current = { artifactSha256: digest, packageKey: target.package.key,
          version: release.version, reporting: false,
          ...(updateAfterStage ? { updateAfterStage: { target, channel, platform, generation: request } } : {}) };
        try {
          const operation = await stageNativePackageKit({ expectedArtifactSha256: digest,
            expectedPackageKey: target.package.key, expectedVersion: release.version }, true);
          if (!operation.accepted) {
            stageIntent.current = null;
            setNotice("Downloaded and checked the kit. Native staging was cancelled; no destination files changed.");
          } else {
            setNativeStage({ state: "verifying", operationId: operation.operationId });
            setNotice("Transferred the verified Package directly to native staging. Native signature verification is in progress.");
          }
        } catch (cause) { stageIntent.current = null; throw cause; }
        return;
      }
      const url = URL.createObjectURL(kit);
      try {
        const a = document.createElement("a");
        a.href = url;
        a.download = `${target.package.key}-${release.version}-${platform}-staging-kit.zip`;
        a.rel = "noopener";
        a.style.display = "none";
        document.body.appendChild(a);
        a.click();
        recordBrowserDownloadHandoff({ fileName: a.download, url: a.href });
        a.remove();
      } finally { window.setTimeout(() => URL.revokeObjectURL(url), 60_000); }
      setNotice(`Prepared ${target.package.title} ${release.version} kit.${lease ? " Stage within nine minutes to report verification." : " No device receipt lease available."} No installation occurred.`);
    } catch (cause) {
      if (generation.current === request) {
        if (controller?.signal.aborted)
          setNotice("Archive transfer paused. Verified bytes remain in this Desktop profile. Select Retain archive again to reauthorize and resume.");
        else setError(cause instanceof Error ? cause.message : "Could not prepare Package staging kit.");
      }
    } finally { if (archiveAbort.current === controller) archiveAbort.current = null;
      downloadPending.current = false; setDownloadId(""); setDownloadProgress(0); }
  }

  return <div className="settings-card-v092 span-2" data-testid="device-managed-packages">
    <div className="settings-card-head-v092"><h3>Studio file updates</h3><span>Signed Package delivery · destination files · guarded rollback</span></div>
    <p className="muted tight">Inspect the Package releases your verified Desktop registration can receive. Preparing a staging kit downloads verified ZIP bytes with their signed manifest and public key. It does not install or activate software.</p>
    <div className="button-row compact">
      <p className="muted tight"><strong>Independent signing trust:</strong> {trust?.configured
        ? <>Configured for this profile · <code>{trust.fingerprint}</code></>
        : "Not configured or status unavailable"}. Do not copy the fingerprint from a downloaded ZIP.</p>
      <ClusterButton type="button" variant="secondary" disabled={!available || trustBusy || nativeStage.state === "verifying"} onClick={() => void enrollTrust()}>{trustBusy ? "Opening native confirmation…" : trust?.configured ? "Review / replace local trust pin…" : "Set up local signing trust…"}</ClusterButton>
    </div>
    <div className="button-row compact">
      <p className="muted tight"><strong>Separate deployment-control trust:</strong> {controlTrust?.configured
        ? <>Configured · <code>{controlTrust.fingerprint}</code></> : "Not configured"}. Obtain this fingerprint from an independent administrator channel, not from a grant or Package kit.</p>
      <ClusterButton type="button" variant="secondary" disabled={!available || trustBusy || grantBusy || nativeStage.state === "verifying"} onClick={() => void enrollControlTrust()}>{controlTrust?.configured ? "Review deployment-control trust…" : "Enroll deployment-control trust…"}</ClusterButton>
    </div>
    <p className="muted tight"><strong>Managed content:</strong> After staging, a fresh 60-second server-signed grant can authorize copying verified files into Cluster's private managed root and switching an atomic, reversible content pointer. This does not run installers, deploy system software, or attest OS health. Rollback to a previous version requires explicit current authorization (typically an administrator pin).</p>
    <p className="muted tight"><strong>Saved destinations:</strong> Set a destination once for each Package and server profile. Later updates reuse that local mapping with explicit native confirmation. If none is saved, the native folder picker still opens. Saving or forgetting a mapping never changes existing files.</p>
    <p className="muted tight"><strong>Destination file updates:</strong> Choose a signed kit and an existing destination folder in native dialogs. Preview differences, copy new files, or replace previously tracked versions. Cluster refuses untracked file collisions and locally modified content by default. A separate, double-confirmed replacement mode backs up originals before adopting an existing folder, and offers a guarded rollback of the last update. Files tracked by a different Package are never adopted, even in replacement mode. No application installation or launch.</p>
    <p className="muted tight"><strong>Durable archive checkpoint:</strong> Retaining the downloaded release stores its verified bytes in the active Desktop server profile's native checkpoint store. It never stores a server challenge or authorizes staging. Each authorized HTTP segment streams into the native disk checkpoint rather than building a second browser ZIP. An interrupted local checkpoint can be explicitly reconciled after hashing retained bytes, with a native confirmation and renewed server authorization before any further download. The original offer is never restored automatically; stale process locks require manual investigation.</p>
    <p className="muted tight"><strong>Native verification:</strong> Use Download & verify to hand the signed kit straight to Qt without saving it to Downloads, or save a staging kit and select it manually. A per-server-profile signing pin must be provisioned locally from an independent administrator channel. Qt verifies signed staging bytes with your confirmation. Managed content deployment requires its own grant. Windows x64 MSI execution is separately opt-in and administrator-authorized; the native preflight must confirm the staged MSI Property-table identity matches the signed release. Successful execution or OS registration never proves software health.</p>
    {nativeStage.state !== "idle" && <p role="status" className="muted tight">Native verification: {nativeStage.message || nativeStage.note || nativeStage.state.replaceAll("_", " ")}</p>}
    {nativeStage.state === "msi_upgrade_reviewable_not_authorized" && nativeStage.msiUpgrade && <p role="status" className="muted tight">
      Read-only MSI upgrade review: {nativeStage.msiUpgrade.priorProductVersion} → {nativeStage.msiUpgrade.targetProductVersion}.
      Retained predecessor SHA-256: <code>{nativeStage.msiUpgrade.priorMsiSha256}</code>.
      This is not permission to upgrade, repair, uninstall, or roll back; Windows software was not changed.
    </p>}
    {nativeStage.state === "msi_verified_not_executed" && nativeStage.msiProduct && <p role="status" className="muted tight">Windows Installer product registration: {nativeStage.msiProduct.state.replaceAll("_", " ")} · Claimed version {nativeStage.msiProduct.expectedVersion} · Reported version {nativeStage.msiProduct.reportedVersion || "unavailable"}. This read-only check does not prove application health or installer origin.</p>}
    {nativeStage.state === "msi_verified_not_executed" && nativeStage.msiIdentity && <p role="status" className="muted tight">Staged MSI Property table: {nativeStage.msiIdentity.verified ? "ProductCode and ProductVersion match the signed Package" : "Not independently verified"}. {nativeStage.msiIdentity.verified ? `Embedded ProductCode ${nativeStage.msiIdentity.actualProductCode}, version ${nativeStage.msiIdentity.actualProductVersion}.` : "Installation is blocked until the embedded values can be verified."} This is an installer-identity check, not software-health or publisher verification.</p>}
    {nativeStage.state === "file_update_audit" && nativeStage.fileAudit && <div className="settings-card-v092" role="status">
      <strong>Tracked destination integrity audit</strong>
      <p><strong>Audited target:</strong> <code>{nativeStage.packageKey}</code> v{nativeStage.version} · local file hashes only</p>
      {nativeStage.fileAudit.tracked === 0 && <p>No destination ownership ledger exists yet. Existing files may be untracked; do not interpret this as an installed Package.</p>}
      <p>{nativeStage.fileAudit.verified} matching tracked files · {nativeStage.fileAudit.missing} missing · {nativeStage.fileAudit.modified} modified</p>
      <p>{nativeStage.fileAudit.retired} retained older-release files ({nativeStage.fileAudit.retiredVerified} matching · {nativeStage.fileAudit.retiredModified} modified · {nativeStage.fileAudit.retiredMissing} missing)</p>
      <p>{nativeStage.fileAudit.untrackedCurrent} current-release files not tracked · {nativeStage.fileAudit.untrackedMissing} never-copied files · {nativeStage.fileAudit.untrackedCollision} untracked collisions</p>
      <p>{nativeStage.fileAudit.pendingRecovery ? "An interrupted or active file update needs review before this audit can be considered stable."
        : nativeStage.fileAudit.healthy ? "All expected current-release files match their tracked hashes."
        : "Tracked destination does not fully match the selected release. Review discrepancies before updating."}</p>
      {!!nativeStage.fileAudit.trackedArtifactSha256 && <p className="muted tight">Tracked artifact: <code>{nativeStage.fileAudit.trackedArtifactSha256}</code></p>}
      {!!nativeStage.fileAudit.issues?.length && <div className="data-table-shell" style={{ maxHeight: 180, overflowY: "auto" }}>
        <table><thead><tr><th scope="col">File</th><th scope="col">Observed status</th></tr></thead><tbody>
          {nativeStage.fileAudit.issues.map((entry, index) => <tr key={`${entry.path}-${index}`}><td><code>{entry.path}</code></td><td>{entry.action.replaceAll("_", " ")}</td></tr>)}
        </tbody></table>
        <p className="muted tight">First 20 discrepancies shown. No tracked files were changed or deleted.</p>
      </div>}
      <p className="muted tight">Local, read-only file evidence. Not proof of software installation or machine health.</p>
    </div>}
    {nativeStage.state === "file_update_preview" && nativeStage.filePlan && <div className="settings-card-v092" role="status">
      <strong>Verified destination update plan</strong>
      <p>{nativeStage.filePlan.missing} new · {nativeStage.filePlan.managedUpdates} tracked upgrades · {nativeStage.filePlan.current} already current</p>
      <p>{nativeStage.filePlan.untrackedConflicts} untracked collisions · {nativeStage.filePlan.modifiedConflicts} locally modified conflicts · {nativeStage.filePlan.foreignOwnershipConflicts ?? 0} files claimed by other Packages · {nativeStage.filePlan.overlappingRoots ?? 0} overlapping destination roots</p>
      {!!nativeStage.filePlan.foreignOwnershipConflicts && <p role="alert">Other managed Packages own files in this exact destination. Update and replacement are blocked regardless of matching file hashes. Resolve the overlapping Package configuration before applying changes.</p>}
      {!!nativeStage.filePlan.overlappingRoots && <p role="alert">Another managed Package uses a parent or child of this destination. Update, adoption and rollback are blocked even if the current files do not collide. Choose separate destination directories and inspect existing ownership first.</p>}
      {!!nativeStage.filePlan.overlappingRootExamples?.length && <p className="muted tight">Registered overlapping destinations (first {nativeStage.filePlan.overlappingRootExamples.length}): {nativeStage.filePlan.overlappingRootExamples.join(", ")}</p>}
      {!!nativeStage.filePlan.foreignOwnershipExamples?.length && <p className="muted tight">Overlapping paths (first {nativeStage.filePlan.foreignOwnershipExamples.length}): {nativeStage.filePlan.foreignOwnershipExamples.join(", ")}</p>}
      {nativeStage.filePlan.dependenciesReady === false && <p role="alert">Prerequisite not ready: {nativeStage.filePlan.dependencyBlocker || "A signed Package dependency is not selected locally."} Updates will be blocked until the dependency is selected.</p>}
      <p>{nativeStage.filePlan.pendingRecovery
        ? "An active or interrupted destination operation needs inspection before another update."
        : nativeStage.filePlan.canUpdateSafely
          ? "Eligible for a guarded update. Native checks files and current authorization again before changing anything."
          : "Normal updates will refuse these conflicts. Review affected files before choosing an explicit backup-and-replace operation."}</p>
      {!!nativeStage.filePlan.conflictExamples?.length && <div className="data-table-shell" style={{ maxHeight: 180, overflowY: "auto" }}>
        <table><thead><tr><th scope="col">Conflicting file</th><th scope="col">Reason</th></tr></thead><tbody>
          {nativeStage.filePlan.conflictExamples.map((entry, index) => <tr key={`${entry.path}-${index}`}>
            <td><code>{entry.path}</code></td><td>{entry.action === "conflict_modified" ? "Locally modified" : "Untracked file"}</td>
          </tr>)}
        </tbody></table>
        {nativeStage.filePlan.untrackedConflicts + nativeStage.filePlan.modifiedConflicts > nativeStage.filePlan.conflictExamples.length &&
          <p className="muted tight">Showing the first 20 conflicts. Use the native signed-file preview for the complete plan.</p>}
      </div>}
      <p className="muted tight">Read-only preview. No files installed, executed, or modified.</p>
    </div>}
    <p className="muted tight"><strong>Security:</strong> The public key included with the kit is not a trust root. Provision its SHA-256 DER/SPKI fingerprint independently before running the native Go stager. Current device state is self-reported, not OS-attested.</p>
    <div className="button-row compact">
      <label>Channel <ClusterNativeSelect aria-label="Device Package channel" value={channel} disabled={!available || busy || !!downloadId} onChange={(event) => setChannel(event.target.value as Channel)}><option value="stable">Stable</option><option value="beta">Beta</option><option value="testing">Testing</option></ClusterNativeSelect></label>
      <label>Target platform (not attested) <ClusterNativeSelect aria-label="Device Package platform" value={platform} disabled={!available || busy || !!downloadId} onChange={(event) => setPlatform(event.target.value as DevicePlatform)}><option value="windows-x64">Windows x64</option><option value="linux-x64">Linux x64</option><option value="macos-arm64">macOS ARM64</option></ClusterNativeSelect></label>
      <ClusterButton type="button" variant="secondary" disabled={!available || busy || !!downloadId} onClick={() => void refresh()}>{busy ? "Checking…" : "Check eligible Packages"}</ClusterButton>
    </div>
    {platform === "windows-x64" && <div className="studio-explanation-v272">
      <strong>Local MSI recovery inventory</strong>
      <p className="muted tight">Read-only inspection of this server profile. Includes recorded attempts and interrupted installer locks, even for Packages not in the current rollout.</p>
      <ClusterButton type="button" variant="secondary" disabled={!available || msiProfileBusy || grantBusy || nativeStage.state === "verifying"}
        onClick={() => void inspectMSIProfile()}>{msiProfileBusy ? "Inspecting profile evidence…" : "Inspect all local MSI attempts…"}</ClusterButton>
      <ClusterButton type="button" variant="secondary" disabled={!available || msiIncidentBusy || grantBusy || msiProfileBusy}
        onClick={() => { if (msiIncidentBusy) return; setMsiIncidentBusy(true); setMsiIncidentWorklist(null);
          void inspectNativeMSIIncidentWorklist().then(worklist => {
            if (!validMSIIncidentWorklist(worklist)) throw new Error("Inconsistent MSI incident worklist; no action was taken.");
            setMsiIncidentWorklist(worklist);
          }).catch(cause => setError(cause instanceof Error ? cause.message : "MSI incident inspection refused."))
            .finally(() => setMsiIncidentBusy(false)); }}>
        {msiIncidentBusy ? "Inspecting MSI incidents…" : "Review all MSI recovery incidents…"}
      </ClusterButton>
      {msiIncidentWorklist && <section className="studio-explanation-v272" role="status" aria-label="Read-only MSI incident worklist">
        <strong>MSI incident worklist: {msiIncidentWorklist.state.replaceAll("_", " ")}</strong>
        <p className="muted tight">{msiIncidentWorklist.manualRecoveryCount} manual-recovery cases · {msiIncidentWorklist.reviewCount} unverified installation reviews · {msiIncidentWorklist.items.length} total records. A successful process exit is not application health or replay authority.</p>
        <div className="data-table-shell" style={{maxHeight: 290, overflowY: "auto"}}>
          <table><thead><tr><th scope="col">Case / Package</th><th scope="col">Evidence</th><th scope="col">Recovery disposition</th></tr></thead><tbody>
            {msiIncidentWorklist.items.map(item => <tr key={item.caseId}>
              <td><code>{item.packageKey}</code><div className="muted tight">{item.operation} · {item.state.replaceAll("_", " ")}</div></td>
              <td><code title={item.receiptSha256 || "Missing receipt"}>{item.receiptSha256 ? `${item.receiptSha256.slice(0, 12)}…` : "No receipt"}</code><div className="muted tight">Prior receipt: {item.operation === "install" ? "not applicable" : item.predecessorMatches ? "exact match" : "missing or changed"} · Original installation registration: {item.registrationState.replaceAll("_", " ")}</div></td>
              <td>{item.severity.replaceAll("_", " ")} · {item.recoveryAction.replaceAll("_", " ")}
                <ClusterButton type="button" variant="secondary" aria-label={`Copy MSI incident evidence ${item.caseId}`}
                  onClick={() => { const evidence = ["Cluster MSI read-only recovery evidence", `Case: ${item.caseId}`,
                    `State: ${item.state}`, `Receipt SHA-256: ${item.receiptSha256 || "missing"}`,
                    `Prior receipt SHA-256: ${item.priorReceiptSha256 || "not applicable"}`,
                    `Original receipt match: ${item.predecessorMatches ? "yes" : "no"}`,
                    `Original installation registration: ${item.registrationState}`,
                    `Disposition: ${item.recoveryAction}`, "No mutation, retry or OS-health authority"].join("\n");
                    void writeNativeClipboardText(evidence).then(written => {if (written) setNotice("MSI incident evidence copied.");
                      else setError("Native clipboard rejected MSI incident evidence.");
                    }).catch(() => setError("Could not copy MSI incident evidence.")); }}>
                  Copy evidence
                </ClusterButton>
              </td>
            </tr>)}
          </tbody></table>
        </div>
        <p className="muted tight">Read-only evidence only. This worklist cannot clear journals or locks, grant mutations, attest installed software, or automatically retry an MSI operation.</p>
      </section>}
      {msiProfileEvidence && <div role="status">
        <p className="muted tight"><strong>{msiProfileEvidence.manualReviewRequired ? "Manual review required" : "No recorded attempts"}</strong> · Profile-wide admission lock: {msiProfileEvidence.admissionLockPresent ? "present" : "none"} · {msiProfileEvidence.records.length} installation records · {msiProfileEvidence.lifecycleRecords.length} upgrade/repair/uninstall/rollback journals.</p>
        {msiProfileEvidence.records.map((item) => <p key={item.packageKey} className="muted tight">
          <code>{item.packageKey}</code> · {item.state.replaceAll("_", " ")} · Receipt: {item.hasReceipt ? "present" : "none"} · Lock: {item.lockPresent ? "present" : "none"} · Boot observation: {item.bootObservation?.state.replaceAll("_", " ") || "no receipt"} ({item.bootObservation?.anchorRecorded ? "receipt anchor" : "timestamp comparison"}) · Registration: {item.registrationTransition?.replaceAll("_", " ") || "no receipt"} · Since exit: {item.registrationDrift?.replaceAll("_", " ") || "no baseline"}
        </p>)}
        {msiProfileEvidence.lifecycleRecords.map((item) => <p key={`lifecycle-${item.packageKey}-${item.receipt?.operation || "unknown"}`} className="muted tight"><code>{item.packageKey}</code> · {item.receipt?.operation}: {item.state.replaceAll("_", " ")} · Prior installation receipt bound · Manual review required</p>)}
        {msiProfileEvidence.lifecyclePlans.length > 0 && <div className="data-table-shell" style={{ maxHeight: 260, overflowY: "auto" }}>
          <table><thead><tr><th scope="col">Package</th><th scope="col">Lifecycle review</th><th scope="col">Safety finding</th></tr></thead><tbody>
          {msiProfileEvidence.lifecyclePlans.map((plan) => <tr key={`${plan.packageKey}-${plan.operation}`}>
            <td><code>{plan.packageKey}</code></td><td>{plan.operation}</td>
            <td>{plan.blockers.length ? `Blocked: ${plan.blockers.map((code) => code.replaceAll("_", " ")).join(", ")}` : "Needs independent signed authorization and manual health review"}{plan.knownDependents.length ? ` · Known dependents: ${plan.knownDependents.join(", ")}` : ""}</td>
          </tr>)}
          </tbody></table>
          <p className="muted tight">Read-only planning only. External dependencies and application health are not verified. No repair, update, or uninstall may run from this view.</p>
        </div>}
        {msiProfileEvidence.dependencyEdges.length > 0 && <p className="muted tight" role="status">Dependency custody: {msiProfileEvidence.dependencyEdges.map((edge) => `${edge.dependentPackageKey} → ${edge.dependencyPackageKey}: ${edge.recordedReceiptMatches ? "same recorded prerequisite" : "missing or changed prerequisite evidence"}`).join("; ")}. Upgrades and removal remain blocked pending an independently authorized lifecycle.</p>}
        {msiProfileEvidence.records.some((item) => !!item.attempt?.dependencies?.length) && <p className="muted tight" role="status">Recorded MSI prerequisites: {msiProfileEvidence.records.flatMap((item) => (item.attempt?.dependencies || []).map((dep) => `${item.packageKey} depends on ${dep.packageKey} v${dep.version}`)).join("; ")}. A dependent record must be reviewed before its prerequisite is upgraded, repaired, or removed.</p>}
        <p className="muted tight">This inventory does not authorize installation, retry, repair, uninstall, lock removal, or claim Windows software health.</p>
      </div>}
    </div>}
    {!available && <p className="muted">Package handoff is available inside a signed-in Cluster Desktop session only.</p>}
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {loaded && !targets.length && <p className="muted">There are no signed, authorized Package targets for this channel and selected platform.</p>}
    {targets.map((target) => <div className="studio-explanation-v272" key={target.package.id}>
      <strong>{target.package.title} · {target.release.version}</strong>
      {!!target.manifest.dependencies?.length && <p className="muted tight">Signed prerequisites: {target.manifest.dependencies.map((dep) => `${dep.packageKey} v${dep.version} (${dep.requirement === "msi-installed" ? "OS-installed MSI required" : "managed content selected"})`).join(", ")}. MSI requirements also need prior local installation receipts and matching live Windows registration before a supervised installer can launch.</p>}
      <p className="muted tight">{target.selection === "device_pin" ? "Device-specific pin" : "Active rollout"} · {target.release.platform} · {Math.ceil(target.release.artifactSize / 1024)} KiB</p>
      <p className="muted tight">SHA-256 <code>{target.release.artifactSha256}</code></p>
      <p className="muted tight">Signing fingerprint <code>{target.release.signingKeyFingerprint}</code> · {target.deviceReported ? `Device claim: ${target.deviceReported.state}` : "No sampled device report"}</p>
      {(() => {
        const destination = destinations.find((entry) => entry.packageKey === target.package.key);
        return <div>
          <p className="muted tight"><strong>Update destination:</strong> {destination
            ? <>{destination.available ? "Saved for this server profile" : "Saved folder unavailable"} · <code>{destination.path}</code></>
            : "Not saved; native folder selection required each time"}</p>
          {destination && <p className="muted tight"><strong>Local update report:</strong> {destination.lastUpdateAt
            ? destination.reportedArtifactSha256 === target.release.artifactSha256
              ? `Current release reported (${destination.reportedVersion}). This is local file-update status, not an installation attestation.`
              : `New release available compared with locally reported ${destination.reportedVersion || "previous version"}. Last updated ${destination.lastUpdateAt}.`
            : "No current local update report. Preview the folder to check actual file hashes."}</p>}
          <div className="button-row compact">
            <ClusterButton type="button" variant="secondary" disabled={!available || !!downloadId || busy || nativeStage.state === "verifying" || !!destinationBusy} onClick={() => void changeDestination(target.package.key, "choose")}>{destinationBusy === target.package.key ? "Opening native settings…" : destination ? "Change saved destination…" : "Save destination folder…"}</ClusterButton>
            {destination && <ClusterButton type="button" variant="secondary" disabled={!available || !!downloadId || busy || nativeStage.state === "verifying" || !!destinationBusy} onClick={() => void changeDestination(target.package.key, "forget")}>Forget destination…</ClusterButton>}
          </div>
        </div>;
      })()}
      <ClusterButton type="button" variant="secondary" disabled={!available || !!downloadId || busy} onClick={() => void download(target)}>{downloadId === target.release.id ? `Downloading ${downloadProgress}%…` : "Save staging kit (offline)…"}</ClusterButton>
      <ClusterButton type="button" variant="secondary" disabled={!available || !!downloadId || busy} onClick={() => void download(target, false, false, true)}>{downloadId === target.release.id ? `Saving ${downloadProgress}%…` : "Retain verified archive in Desktop…"}</ClusterButton>
            <ClusterButton type="button" variant="secondary" disabled={!available || !trust?.configured || !!downloadId || busy || nativeStage.state === "verifying"} onClick={() => void stageRetained(target)}>Stage retained archive…</ClusterButton>
      {downloadId === target.release.id && archiveAbort.current && <ClusterButton type="button" variant="secondary"
        onClick={() => archiveAbort.current?.abort()}>Pause archive transfer</ClusterButton>}
      <ClusterButton type="button" variant="secondary" disabled={!available || !!downloadId || busy}
        onClick={() => void inspectArchive(target)}>Inspect native archive progress…</ClusterButton>
      <ClusterButton type="button" variant="secondary" disabled={!available || !!downloadId || busy}
        onClick={() => void diagnoseArchive(target)}>Diagnose interrupted native transfer…</ClusterButton>
      <ClusterButton type="button" variant="secondary" disabled={!available || !!downloadId || busy || nativeStage.state === "verifying"}
        onClick={() => void recoverArchive(target)}>Recover interrupted archive checkpoint…</ClusterButton>
      {archiveEvidence[target.release.id] && <p className="muted tight" role="status">
        Native archive: {archiveEvidence[target.release.id].state} · {archiveEvidence[target.release.id].receivedBytes.toLocaleString()} of {archiveEvidence[target.release.id].expectedBytes.toLocaleString()} bytes verified
        · {archiveEvidence[target.release.id].bound ? "bound to an original recoverable offer" : "offer not yet bound"}.
        This is disk transport evidence, not a staged or installed Package.
      </p>}
      <ClusterButton type="button" variant="secondary" disabled={!available || !trust?.configured || !!downloadId || busy || nativeStage.state === "verifying"} onClick={() => void download(target, true)}>{downloadId === target.release.id ? `Transferring ${downloadProgress}%…` : "Download & verify in Desktop…"}</ClusterButton>
      <ClusterButton type="button" disabled={!available || !trust?.configured || !!downloadId || busy || nativeStage.state === "verifying"} onClick={() => void download(target, true, true)}>{downloadId === target.release.id ? `Preparing ${downloadProgress}%…` : "Download & update files…"}</ClusterButton>
      {preparedKitDigest === target.release.artifactSha256 && <p className="muted tight">This Package's downloaded kit is available in the current native session. File preview and update actions can reuse it without selecting the ZIP again. Native verification and confirmation still apply.</p>}
      <ClusterButton type="button" variant="secondary" disabled={!available || !trust?.configured || !!downloadId || busy || nativeStage.state === "verifying"} onClick={() => void stageLocally(target)}>Verify and stage downloaded kit…</ClusterButton>
      <ClusterButton type="button" variant="secondary" disabled={!available || !trust?.configured || !!downloadId || busy || nativeStage.state === "verifying"} onClick={() => void auditLocally(target)}>Audit existing staged files…</ClusterButton>
      <ClusterButton type="button" variant="secondary" disabled={!available || !trust?.configured || !!downloadId || busy || nativeStage.state === "verifying"} onClick={() => void auditManaged(target)}>Audit managed copy…</ClusterButton>
      <ClusterButton type="button" variant="secondary" disabled={!available || !trust?.configured || !controlTrust?.configured || grantBusy || !!downloadId || busy || nativeStage.state === "verifying"} onClick={() => void deployContent(target, "deploy")}>{grantBusy ? "Checking authorization…" : "Authorize managed content deployment…"}</ClusterButton>
      <ClusterButton type="button" variant="secondary" disabled={!available || !trust?.configured || !controlTrust?.configured || grantBusy || !!downloadId || busy || nativeStage.state === "verifying"} onClick={() => void deployContent(target, "rollback")}>Authorize managed rollback…</ClusterButton>
      {target.manifest.installer && platform === "windows-x64" && <>
        <p className="muted tight">Signed per-user MSI: {target.manifest.installer.path}, claimed Windows product {target.manifest.installer.productCode}, version {target.manifest.installer.productVersion}. Requires a staged kit and separately approved execution grant. Installation health and rollback are not attested.</p>
        <ClusterButton type="button" variant="secondary" disabled={!available || !!msiEvidenceBusy || nativeStage.state === "verifying"} onClick={() => void inspectMSI(target)}>{msiEvidenceBusy === target.package.key ? "Inspecting local record…" : "Inspect MSI attempt / recovery evidence…"}</ClusterButton>
        {msiEvidence[target.package.key] && <div className="studio-explanation-v272" role="status">
          <strong>Local MSI evidence: {msiEvidence[target.package.key].state.replaceAll("_", " ")}</strong>
          <p className="muted tight">Receipt: {msiEvidence[target.package.key].hasReceipt ? "present" : "none"} · Operation lock: {msiEvidence[target.package.key].lockPresent ? "present" : "none"} · Profile-wide admission lock: {msiEvidence[target.package.key].admissionLockPresent ? "present, another installer is active or recovery needs review" : "none"} · {msiEvidence[target.package.key].manualReviewRequired ? "Manual operator review required" : "No recorded attempt"}</p>
          {msiEvidence[target.package.key].attempt && <p className="muted tight">Installer {msiEvidence[target.package.key].attempt?.version}, evidence recorded {msiEvidence[target.package.key].attempt?.startedAt}. {msiEvidence[target.package.key].attempt?.state === "msi_prepared_not_launched" ? "A launch was not committed; the grant outcome still requires manual review. No installation is claimed." : <>Launch committed: {msiEvidence[target.package.key].attempt?.launchCommittedAt || "unknown (older receipt)"} · Process exit: {msiEvidence[target.package.key].attempt?.state === "msi_exit_zero_not_os_attested" ? 0 : msiEvidence[target.package.key].attempt?.finishedAt ? msiEvidence[target.package.key].attempt?.exitCode ?? "unknown" : "unknown"}. Local attempt evidence does not attest installation health.</>}</p>}
          {msiEvidence[target.package.key].attempt?.artifactSha256 !== undefined && msiEvidence[target.package.key].attempt?.artifactSha256 !== target.release.artifactSha256 && <p className="muted tight" role="alert">This local receipt belongs to a different release. It must not be interpreted as verification of the currently selected installer.</p>}
          {msiEvidence[target.package.key].product && <p className="muted tight">Windows Installer query: {msiEvidence[target.package.key].product.state.replaceAll("_", " ")} · Declared product version: {msiEvidence[target.package.key].product.expectedVersion} · Reported: {msiEvidence[target.package.key].product.reportedVersion || "unavailable"} · Exact version match: {msiEvidence[target.package.key].product.versionMatches ? "yes" : "no / unverified"}. Probe: {msiEvidence[target.package.key].product.probeComplete ? "complete for current user + machine" : "unavailable / incomplete"}. Other users’ MSI contexts are not enumerated. This is not software-health attestation.</p>}
          {!!msiEvidence[target.package.key].attempt?.dependencies?.length && <p className="muted tight" role="status">MSI prerequisites checked at launch: {msiEvidence[target.package.key].attempt!.dependencies!.map((dep) => `${dep.packageKey} v${dep.version} (${dep.productVersion})`).join(", ")}. This receipt contains registration snapshots, not application-health or removal authorization.</p>}
          {msiEvidence[target.package.key].registrationTransition && <p className="muted tight" role="status">Registration across this attempt: {msiEvidence[target.package.key].registrationTransition?.replaceAll("_", " ")}. Pre-launch: {msiEvidence[target.package.key].attempt?.preLaunchRegistration?.state?.replaceAll("_", " ") || "not retained in older receipts"}; after process return: {msiEvidence[target.package.key].attempt?.postExitRegistration?.state?.replaceAll("_", " ") || "unknown or not recorded"}. These samples are not proof of installation origin, working application health, or permission to retry, repair or uninstall.</p>}
          {msiEvidence[target.package.key].registrationDrift && <p className="muted tight" role="status">Registration since process return: {msiEvidence[target.package.key].registrationDrift?.replaceAll("_", " ")}. A change or continued registration does not prove who installed the product or whether its application is healthy.</p>}
          {msiEvidence[target.package.key].bootObservation && <p className="muted tight" role="status">OS uptime comparison: {msiEvidence[target.package.key].bootObservation?.state === "reboot_indicated_unverified" ? "A system restart is indicated since the recorded attempt, but not confirmed." : msiEvidence[target.package.key].bootObservation?.state === "same_boot_indicated_unverified" ? "Uptime indicates this may still be the original boot." : msiEvidence[target.package.key].bootObservation?.state === "boot_relation_ambiguous" ? "Restart timing is ambiguous." : "OS uptime is unavailable."} {msiEvidence[target.package.key].bootObservation?.anchorRecorded ? "Compared with an immutable recorded boot anchor." : "Compared with historical receipt timestamps."} Wall-clock changes can affect this estimate. It does not verify the installation or authorize retry, repair, or removal.</p>}
          {msiEvidence[target.package.key].recoveryAssessment && <p className="muted tight" role="status">Recovery assessment: {msiEvidence[target.package.key].recoveryAssessment?.replaceAll("_", " ")}. {msiEvidence[target.package.key].requiresRebootReview ? "A reboot was requested. Verify installation separately after restart; do not automatically retry." : "Review local Windows Installer evidence before deciding what to do."}</p>}
          {msiEvidence[target.package.key].stagedArtifactState && <p className="muted tight">Pinned release stage: {msiEvidence[target.package.key].stagedArtifactState?.replaceAll("_", " ")}. Stage presence is not a signed-file integrity check.</p>}
          {msiEvidence[target.package.key].receiptSha256 && <p className="muted tight">Evidence SHA-256: <code>{msiEvidence[target.package.key].receiptSha256}</code></p>}
          <p className="muted tight">This view cannot clear records, authorize retries, uninstall, repair, or roll back Windows software.</p>
        </div>}
        <ClusterButton type="button" variant="secondary"
          disabled={!available || !!msiRepairEvidenceBusy || grantBusy || nativeStage.state === "verifying"}
          onClick={() => void inspectMSIRepair(target)}>{msiRepairEvidenceBusy === target.package.key ? "Inspecting repair journal…" : "Inspect prior MSI repair journal…"}</ClusterButton>
        {msiRepairEvidence[target.package.key] && <p className="muted tight" role="status">
          MSI repair journal: {msiRepairEvidence[target.package.key].state.replaceAll("_", " ")}.
          {msiRepairEvidence[target.package.key].hasReceipt ? " An existing repair attempt requires operator investigation; automatic repair replay is forbidden." : " No repair attempt recorded for this Package."}
          This is local evidence, not proof of Windows software health.
        </p>}
        {supervisedMsiRepairEnabled && <ClusterButton type="button" variant="secondary"
          disabled={!available || !trust?.configured || !controlTrust?.configured || grantBusy || !!msiRepairEvidenceBusy
            || nativeStage.state === "verifying" || !!msiRepairEvidence[target.package.key]?.hasReceipt
            || !msiProfileEvidence?.lifecyclePlans.some((plan) => plan.packageKey === target.package.key
              && plan.operation === "repair" && plan.state === "requires_operator_review" && plan.blockers.length === 0)}
          onClick={() => void runMSIRepair(target)}>Authorize supervised MSI repair…</ClusterButton>}
        <ClusterButton type="button" variant="secondary"
          disabled={!available || !!msiUninstallEvidenceBusy || grantBusy || nativeStage.state === "verifying"}
          onClick={() => void inspectMSIUninstall(target)}>{msiUninstallEvidenceBusy === target.package.key ? "Inspecting uninstall journal…" : "Inspect prior MSI uninstall journal…"}</ClusterButton>
        {msiUninstallEvidence[target.package.key] && <p className="muted tight" role="status">
          MSI uninstall journal: {msiUninstallEvidence[target.package.key].state.replaceAll("_", " ")}.
          {msiUninstallEvidence[target.package.key].hasReceipt ? " A previous removal attempt requires manual review; automatic repeat is refused." : " No uninstall attempt recorded for this Package."}
          Windows Installer process exit does not guarantee product removal or absence of externally dependent software.
        </p>}
        {supervisedMsiUninstallEnabled && <ClusterButton type="button" variant="secondary"
          disabled={!available || !trust?.configured || !controlTrust?.configured || grantBusy || !!msiUninstallEvidenceBusy
            || nativeStage.state === "verifying" || !!msiUninstallEvidence[target.package.key]?.hasReceipt
            || !msiProfileEvidence?.lifecyclePlans.some((plan) => plan.packageKey === target.package.key
              && plan.operation === "uninstall" && plan.state === "requires_operator_review" && plan.blockers.length === 0)
              && !Object.values(msiRollbackCascade).some(workflow => validMSIRollbackCascade(workflow, workflow.packageKey) &&
                workflow.steps.some(step => step.packageKey === target.package.key && step.operation === "uninstall" &&
                  step.state === "independent_operator_review_required" &&
                  step.recordedReceiptSha256 === msiProfileEvidence?.records.find(r => r.packageKey === target.package.key)?.receiptSha256))}
          onClick={() => void runMSIUninstall(target)}>Authorize supervised MSI uninstall…</ClusterButton>}
        <ClusterButton type="button" variant="secondary"
          disabled={!available || !!msiUpgradeBusy || grantBusy || nativeStage.state === "verifying"}
          onClick={() => void inspectMSIUpgradeJournal(target)}>Inspect MSI upgrade journal…</ClusterButton>
        {msiUpgradeEvidence[target.package.key] && <p className="muted tight" role="status">Upgrade lifecycle journal: {msiUpgradeEvidence[target.package.key].state.replaceAll("_", " ")}.
          {msiUpgradeEvidence[target.package.key].upgradeRecovery ? ` Windows registration: ${msiUpgradeEvidence[target.package.key].upgradeRecovery!.state.replaceAll("_", " ")}.` : ""}
          {msiUpgradeEvidence[target.package.key].hasReceipt ? " Manual review required; automatic upgrade retry or rollback is forbidden. Registration is not application-health proof." : " No upgrade journal recorded."}</p>}
        {supervisedMsiRollbackEnabled && msiRollbackReview[target.package.key]?.state === "reviewable_not_authorized"
          && target.manifest.installer?.productVersion === msiRollbackReview[target.package.key]?.predecessorProductVersion &&
          <ClusterButton type="button" variant="secondary"
            disabled={!available || !trust?.configured || !controlTrust?.configured || grantBusy || !!msiRollbackBusy
              || nativeStage.state === "verifying" || !!msiRollbackJournal[target.package.key]?.hasReceipt}
            onClick={() => void runMSIRollback(target)}>Authorize supervised MSI rollback…</ClusterButton>}
        <ClusterButton type="button" variant="secondary"
          disabled={!available || !!msiRollbackBusy || grantBusy || nativeStage.state === "verifying" || platform !== "windows-x64"}
          onClick={() => void inspectMSIRollbackJournal(target)}>Inspect MSI rollback attempt journal…</ClusterButton>
        {msiRollbackJournal[target.package.key] && <p className="muted tight" role="status">
          Rollback attempt: {msiRollbackJournal[target.package.key].state.replaceAll("_", " ")}.
          {msiRollbackJournal[target.package.key].rollbackRecovery
            ? ` Windows registration: ${msiRollbackJournal[target.package.key].rollbackRecovery!.state.replaceAll("_", " ")}.` : ""}
          {' '}Any recorded rollback requires manual review. No automatic retry, OS attestation, or application-health certification.
        </p>}
        <ClusterButton type="button" variant="secondary"
          disabled={!available || !!msiRollbackBusy || grantBusy || nativeStage.state === "verifying" || platform !== "windows-x64"}
          onClick={() => void inspectMSIRollback(target)}>
          {msiRollbackBusy === target.package.key ? "Inspecting rollback custody…" : "Review MSI rollback readiness…"}
        </ClusterButton>
        <ClusterButton type="button" variant="secondary"
          disabled={!available || !!msiRollbackBusy || grantBusy || nativeStage.state === "verifying"}
          onClick={() => void inspectMSIRollbackCascade(target)}>
          {msiRollbackBusy === target.package.key ? "Inspecting dependency workflow…" : "Review dependency-ordered MSI recovery…"}
        </ClusterButton>
        {msiRollbackCascade[target.package.key] && <section className="muted tight" role="status" aria-label="MSI dependency recovery workflow">
          <strong>Dependency recovery workflow: {msiRollbackCascade[target.package.key].state.replaceAll("_", " ")}</strong>
          <p>Each entry requires its own supervised authorization. This is a read-only workflow, not an automatic multi-Package rollback or application-health check.</p>
          <p>Next independently reviewable Package: <strong>{msiRollbackCascade[target.package.key].nextReviewablePackageKey || "none"}</strong>.
            {msiRollbackCascade[target.package.key].manualRecoveryRequired && ` Manual recovery with no replay required for: ${msiRollbackCascade[target.package.key].manualReviewPackages.join(", ")}.`}</p>
          <ol>{msiRollbackCascade[target.package.key].steps.map(step => <li key={step.packageKey}>
            <strong>{step.packageKey}</strong>: {step.operation === "msi-rollback" ? "Independent MSI rollback" : "Independent MSI uninstall review"}
            {" · "}{step.state.replaceAll("_", " ")}
            {step.dispositionObserved ? " · Matching uninstall journal and scoped Windows registration absence observed" :
              (step.waitingFor.length > 0 && ` · Prerequisite order: ${step.waitingFor.join(", ")}`)}
            {` · Next action: ${step.recoveryAction.replaceAll("_", " ")}`}
            {step.lifecycleJournalSha256 && ` · Journal: ${step.lifecycleJournalState.replaceAll("_", " ")} (${step.lifecycleJournalSha256})`}
            {step.blockers.length > 0 && ` · Blockers: ${step.blockers.join(", ").replaceAll("_", " ")}`}
          </li>)}</ol>
          <p>Previously completed uninstall operations are never cleared. A dependent counts as disposed only after matching its independent completed journal with a current scoped Windows ProductCode-absence observation. This does not attest application health or grant any further mutation.</p>
        </section>}
        {msiRollbackReview[target.package.key] && <section className="muted tight" role="status" aria-label="MSI rollback review">
          <p>Rollback recovery: {msiRollbackReview[target.package.key].state.replaceAll("_", " ")}.
            Neither Windows registration nor this plan authorizes a downgrade or verifies application health.</p>
          <p>Recorded predecessor: {msiRollbackReview[target.package.key].predecessorProductVersion}; successor: {msiRollbackReview[target.package.key].successorProductVersion}.</p>
          <p>Known dependency review order: {msiRollbackReview[target.package.key].recoveryOrder.join(" → ")}.</p>
          <p>Observed completed dependent uninstalls: {msiRollbackReview[target.package.key].settledDependents.join(", ") || "none"}.
            Outstanding dependent dispositions: {msiRollbackReview[target.package.key].outstandingDependents.join(", ") || "none"}.</p>
          {msiRollbackReview[target.package.key].blockers.length > 0 && <p>Blocking evidence: {msiRollbackReview[target.package.key].blockers.join(", ").replaceAll("_", " ")}.</p>}
          <p>External dependents and actual Windows rollback behavior remain unverified. Each affected Package requires its own authorization.</p>
        </section>}
        {supervisedMsiUpgradeEnabled && <ClusterButton type="button" variant="secondary"
          disabled={!available || !trust?.configured || !controlTrust?.configured || grantBusy || !!msiUpgradeBusy
            || nativeStage.state !== "msi_upgrade_reviewable_not_authorized"
            || nativeStage.msiUpgrade?.artifactSha256 !== target.release.artifactSha256
            || !!msiProfileEvidence?.lifecycleRecords.length}
          onClick={() => void runMSIUpgrade(target)}>Authorize supervised MSI upgrade…</ClusterButton>}
        <ClusterButton type="button" variant="secondary"
          disabled={!available || !trust?.configured || !!msiUpgradeBusy || grantBusy || msiProfileBusy
            || nativeStage.state === "verifying" || !msiProfileEvidence?.records.some((record) => record.packageKey === target.package.key
              && !!record.hasReceipt && !!record.receiptSha256 && !!record.attempt?.msiPath)
            || !!msiProfileEvidence?.lifecycleRecords.length || !!msiProfileEvidence?.admissionLockPresent}
          onClick={() => void reviewMSIUpgrade(target)}>{msiUpgradeBusy === target.package.key
            ? "Checking retained MSI upgrade evidence…" : "Review signed MSI upgrade readiness (no install)…"}</ClusterButton>
        <ClusterButton type="button" variant="secondary" disabled={!trust?.configured || grantBusy || nativeStage.state === "verifying"} onClick={() => void runMSI(target, "preview")}>Verify signed MSI readiness…</ClusterButton>
        {supervisedMsiEnabled && <ClusterButton type="button" variant="secondary"
          disabled={!available || !trust?.configured || !controlTrust?.configured || grantBusy || !!msiEvidenceBusy
            || nativeStage.state === "verifying" || isRecordedMSIAttemptBlocked(msiEvidence[target.package.key])}
          onClick={() => void runMSI(target, "install")}>
          {isRecordedMSIAttemptBlocked(msiEvidence[target.package.key]) ? "MSI attempt requires manual review" : "Authorize supervised MSI installation…"}
        </ClusterButton>}
      </>}
      <ClusterButton type="button" variant="secondary" disabled={!available || !trust?.configured || !!downloadId || busy || nativeStage.state === "verifying"} onClick={() => void updateDestinationFiles(target, "audit")}>Audit tracked destination files…</ClusterButton>
      <ClusterButton type="button" variant="secondary" disabled={!available || !trust?.configured || !!downloadId || busy || nativeStage.state === "verifying"} onClick={() => void updateDestinationFiles(target, "preview")}>Preview destination files…</ClusterButton>
      <ClusterButton type="button" variant="secondary" disabled={!available || !trust?.configured || !!downloadId || busy || nativeStage.state === "verifying"} onClick={() => void updateDestinationFiles(target, "sync")}>Update selected folder…</ClusterButton>
      <ClusterButton type="button" variant="secondary" disabled={!available || !trust?.configured || !!downloadId || busy || nativeStage.state === "verifying"} onClick={() => void updateDestinationFiles(target, "replace")}>Replace conflicting files (back up originals)…</ClusterButton>
      <ClusterButton type="button" variant="secondary" disabled={!available || !trust?.configured || !!downloadId || busy || nativeStage.state === "verifying"} onClick={() => void updateDestinationFiles(target, "rollback")}>Roll back selected folder…</ClusterButton>
    </div>)}
  </div>;
}
