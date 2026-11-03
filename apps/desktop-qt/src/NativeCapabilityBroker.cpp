#include "NativeCapabilityBroker.h"

#include "AppController.h"
#include "GlobalShortcutManager.h"
#include "LibraryMountManager.h"
#include "DesktopPreferences.h"
#include "ServerProfileStore.h"
#include "WorkstationServiceManager.h"

#include <algorithm>

#ifdef Q_OS_WIN
#include <windows.h>
#include <psapi.h>
#elif defined(Q_OS_LINUX)
#include <unistd.h>
#endif

#include <QCoreApplication>
#include <QCryptographicHash>
#include <QClipboard>
#include <QDateTime>
#include <QDesktopServices>
#include <QDir>
#include <QFile>
#include <QFileDialog>
#include <QFileDevice>
#include <QDialog>
#include <QMessageBox>
#include <QFileInfo>
#include <QFileSystemWatcher>
#include <QGuiApplication>
#include <QImageReader>
#include <QInputDialog>
#include <QLineEdit>
#include <QJsonArray>
#include <QMap>
#include <QJsonDocument>
#include <QJsonObject>
#include <QMimeDatabase>
#include <QProcess>
#include <QRegularExpression>
#include <QSaveFile>
#include <QSettings>
#include <QStandardPaths>
#include <QSystemTrayIcon>
#include <QTemporaryFile>
#include <QSharedPointer>
#include <QTimer>
#include <QUuid>
#include <QUrl>
#include "DesktopTransferRequestPolicy.h"

namespace {
constexpr qsizetype MaxRequestBytes = 16 * 1024;
constexpr qsizetype MaxKitChunkRequestBytes = 80 * 1024;
constexpr qsizetype MaxArchiveChunkRequestBytes = 768 * 1024;
constexpr qsizetype MaxArchiveChunkPayloadBytes = 736 * 1024;
constexpr qsizetype MaxArchiveChunkBytes = 512 * 1024;
constexpr qsizetype MaxArchiveChunkBase64Bytes = 4 * ((MaxArchiveChunkBytes + 2) / 3);
constexpr qint64 MaxDurableArchiveBytes = 32LL * 1024 * 1024; // Current signed MSI ZIP publication cap; Go spool is separately larger.
constexpr qint64 MaxPackageKitBytes = 32 * 1024 * 1024 + 64 * 1024; // Per-kit maximum; signed manifest enforces 4 MiB for non-MSI.
constexpr qint64 MaxPackageKitAgeMs = 10 * 60 * 1000;
constexpr qsizetype MaxPayloadBytes = 8 * 1024;
constexpr qsizetype MaxKitChunkPayloadBytes = 70 * 1024;
constexpr int MaxRequestsPerMinute = 120;
constexpr int MaxNotificationsPerMinute = 6;
constexpr int MaxDialogsPerMinute = 8;
constexpr int MaxSeenRequestIds = 512;
constexpr int MaxOpenHandles = 96;
constexpr qint64 HandleLifetimeMs = 30 * 60 * 1000;
constexpr int MaxSelectedFiles = 16;
constexpr int MaxDroppedItems = 16;
constexpr int MaxNotificationTitle = 120;
constexpr int MaxNotificationBody = 320;
constexpr int MaxNotificationTag = 128;
constexpr int MaxSeenNotificationTags = 256;
constexpr int MaxRouteLength = 160;
constexpr int MaxNativeWatches = 24;
constexpr int MaxClipboardText = 4096;
constexpr int MaxClipboardReadPurpose = 96;
constexpr qint64 MaxNativePreviewBytes = 8 * 1024;


// An upgrade registration sample is a read-only observation, never a grant
// to retry/rollback or a claim that an MSI custom action produced healthy software.
bool validNativeMSIUpgradeRecovery(const QJsonObject &status)
{
    const QJsonObject receipt = status.value(QStringLiteral("receipt")).toObject();
    if (receipt.value(QStringLiteral("operation")).toString() != QStringLiteral("upgrade"))
        return status.value(QStringLiteral("upgradeRecovery")).isUndefined();
    const QJsonObject recovery = status.value(QStringLiteral("upgradeRecovery")).toObject();
    const QJsonObject product = recovery.value(QStringLiteral("registration")).toObject();
    const QString observed = product.value(QStringLiteral("state")).toString();
    const QString target = receipt.value(QStringLiteral("productVersion")).toString();
    const QString prior = receipt.value(QStringLiteral("priorProductVersion")).toString();
    const QString reported = product.value(QStringLiteral("reportedVersion")).toString();
    const QString state = recovery.value(QStringLiteral("state")).toString();
    if (!status.value(QStringLiteral("upgradeRecovery")).isObject()
        || !recovery.value(QStringLiteral("readOnly")).toBool(false)
        || recovery.value(QStringLiteral("osAttested")).toBool(true)
        || recovery.value(QStringLiteral("rollbackAuthorized")).toBool(true)
        || product.value(QStringLiteral("productCode")).toString() != receipt.value(QStringLiteral("productCode")).toString()
        || product.value(QStringLiteral("expectedVersion")).toString() != target
        || !product.value(QStringLiteral("readOnly")).toBool(false)
        || product.value(QStringLiteral("osAttested")).toBool(true)) return false;
    const bool complete = product.value(QStringLiteral("probeComplete")).toBool(false);
    if (!complete)
        return state == QStringLiteral("upgrade_registration_unavailable") && !product.value(QStringLiteral("versionMatches")).toBool();
    if (product.value(QStringLiteral("probeScope")).toString() != QStringLiteral("current_user_and_machine")) return false;
    if (observed == QStringLiteral("registered_version_match"))
        return state == QStringLiteral("upgrade_target_registered_not_health_attested") && reported == target && product.value(QStringLiteral("versionMatches")).toBool();
    if (observed == QStringLiteral("registered_version_mismatch") && !product.value(QStringLiteral("versionMatches")).toBool()) {
        if (reported == prior) return state == QStringLiteral("upgrade_predecessor_remains_registered");
        return state == QStringLiteral("upgrade_unexpected_version_registered") && !reported.isEmpty() && reported != target;
    }
    if (observed == QStringLiteral("not_registered_for_user"))
        return state == QStringLiteral("upgrade_product_not_registered") && reported.isEmpty() && !product.value(QStringLiteral("versionMatches")).toBool();
    return state == QStringLiteral("upgrade_registration_ambiguous");
}

// A rollback journal and an MSI registration query are independent evidence.
// Neither may claim that Windows or the application is healthy.
bool validNativeMSIRollbackRecovery(const QJsonObject &status)
{
    const QJsonObject receipt = status.value(QStringLiteral("receipt")).toObject();
    if (receipt.value(QStringLiteral("operation")).toString() != QStringLiteral("msi-rollback"))
        return status.value(QStringLiteral("rollbackRecovery")).isUndefined();
    const QJsonObject recovery = status.value(QStringLiteral("rollbackRecovery")).toObject();
    const QJsonObject product = recovery.value(QStringLiteral("registration")).toObject();
    const QString observed = product.value(QStringLiteral("state")).toString();
    const QString oldVersion = receipt.value(QStringLiteral("productVersion")).toString();
    const QString newVersion = receipt.value(QStringLiteral("priorProductVersion")).toString();
    const QString reported = product.value(QStringLiteral("reportedVersion")).toString();
    const QString state = recovery.value(QStringLiteral("state")).toString();
    if (!status.value(QStringLiteral("rollbackRecovery")).isObject()
        || !recovery.value(QStringLiteral("readOnly")).isBool() || !recovery.value(QStringLiteral("readOnly")).toBool()
        || !recovery.value(QStringLiteral("osAttested")).isBool() || recovery.value(QStringLiteral("osAttested")).toBool()
        || !recovery.value(QStringLiteral("rollbackConfirmed")).isBool() || recovery.value(QStringLiteral("rollbackConfirmed")).toBool()
        || product.value(QStringLiteral("productCode")).toString() != receipt.value(QStringLiteral("productCode")).toString()
        || product.value(QStringLiteral("expectedVersion")).toString() != oldVersion
        || !product.value(QStringLiteral("readOnly")).toBool(false) || product.value(QStringLiteral("osAttested")).toBool(true)) return false;
    const bool complete = product.value(QStringLiteral("probeComplete")).toBool(false);
    if (!complete) return state == QStringLiteral("rollback_registration_unavailable") && !product.value(QStringLiteral("versionMatches")).toBool();
    if (product.value(QStringLiteral("probeScope")).toString() != QStringLiteral("current_user_and_machine")) return false;
    if (observed == QStringLiteral("registered_version_match"))
        return state == QStringLiteral("rollback_predecessor_registered_not_health_attested") && reported == oldVersion && product.value(QStringLiteral("versionMatches")).toBool();
    if (observed == QStringLiteral("registered_version_mismatch") && !product.value(QStringLiteral("versionMatches")).toBool()) {
        if (reported == newVersion) return state == QStringLiteral("rollback_successor_remains_registered");
        return state == QStringLiteral("rollback_unexpected_version_registered") && !reported.isEmpty() && reported != oldVersion;
    }
    if (observed == QStringLiteral("not_registered_for_user"))
        return state == QStringLiteral("rollback_product_not_registered") && reported.isEmpty() && !product.value(QStringLiteral("versionMatches")).toBool();
    return state == QStringLiteral("rollback_registration_ambiguous");
}

// Optional creation-time boot evidence is part of a read-only MSI receipt,
// never authority for installer execution or recovery.
bool validNativeMSIBootAnchor(const QJsonValue &value)
{
    if (value.isUndefined())
        return true; // historical receipts had no anchor
    if (!value.isObject())
        return false;
    const QJsonObject anchor = value.toObject();
    static const QRegularExpression timestamp(QStringLiteral("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\\.[0-9]{1,9})?Z$"));
    const QJsonValue uptime = anchor.value(QStringLiteral("uptimeMilliseconds"));
    return timestamp.match(anchor.value(QStringLiteral("observedAt")).toString()).hasMatch()
        && uptime.isDouble() && uptime.toDouble() >= 0 && uptime.toDouble() <= 315360000000.0;
}

// An uptime comparison is strictly read-only advisory evidence. Validate it
// independently of renderer state before exposing it to any desktop window.
// It must never authorize a retry, upgrade, repair, uninstall or OS health.
bool validNativeMSIBootObservation(const QJsonValue &value, bool hasReceipt)
{
    if (!hasReceipt)
        return value.isUndefined();
    if (!value.isObject())
        return false;
    const QJsonObject boot = value.toObject();
    const QString state = boot.value(QStringLiteral("state")).toString();
    if (!boot.value(QStringLiteral("anchorRecorded")).isBool())
        return false;
    if (!boot.value(QStringLiteral("readOnly")).isBool() || !boot.value(QStringLiteral("readOnly")).toBool()
        || !boot.value(QStringLiteral("osAttested")).isBool() || boot.value(QStringLiteral("osAttested")).toBool()
        || !boot.value(QStringLiteral("rebootConfirmed")).isBool() || boot.value(QStringLiteral("rebootConfirmed")).toBool())
        return false;
    if (state == QStringLiteral("os_uptime_unavailable"))
        return boot.value(QStringLiteral("observedAt")).isUndefined()
            && boot.value(QStringLiteral("uptimeMilliseconds")).isUndefined()
            && boot.value(QStringLiteral("estimatedBootAt")).isUndefined();
    if (state != QStringLiteral("reboot_indicated_unverified")
        && state != QStringLiteral("same_boot_indicated_unverified")
        && state != QStringLiteral("boot_relation_ambiguous"))
        return false;
    static const QRegularExpression timestamp(QStringLiteral("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\\.[0-9]{1,9})?Z$"));
    const QJsonValue uptime = boot.value(QStringLiteral("uptimeMilliseconds"));
    return timestamp.match(boot.value(QStringLiteral("observedAt")).toString()).hasMatch()
        && timestamp.match(boot.value(QStringLiteral("estimatedBootAt")).toString()).hasMatch()
        && uptime.isDouble() && uptime.toDouble() >= 0
        && uptime.toDouble() <= 315360000000.0;
}

// A new MSI receipt can retain the exact signed prerequisite registrations
// checked during admission. Older receipts may omit this field. Qt must not
// expose a forged dependency array through either inspection path.
bool validNativeMSIDependencies(const QJsonValue &value, const QString &owner)
{
    if (value.isUndefined()) return true;
    if (!value.isArray()) return false;
    const QJsonArray entries = value.toArray();
    if (entries.size() > 12) return false;
    static const QRegularExpression key(QStringLiteral("^[a-z][a-z0-9-]{2,79}$"));
    static const QRegularExpression releaseVersion(QStringLiteral("^[0-9]+\\.[0-9]+\\.[0-9]+(?:-[A-Za-z0-9.-]+)?$"));
    static const QRegularExpression code(QStringLiteral("^\\{[0-9A-F]{8}-(?:[0-9A-F]{4}-){3}[0-9A-F]{12}\\}$"));
    static const QRegularExpression productVersion(QStringLiteral("^[0-9]{1,5}\\.[0-9]{1,5}\\.[0-9]{1,5}$"));
    static const QRegularExpression digest(QStringLiteral("^[a-f0-9]{64}$"));
    QStringList visited;
    for (const QJsonValue &item : entries) {
        if (!item.isObject()) return false;
        const QJsonObject dep = item.toObject();
        const QString name = dep.value(QStringLiteral("packageKey")).toString();
        if (!key.match(name).hasMatch() || name == owner || visited.contains(name)
            || !releaseVersion.match(dep.value(QStringLiteral("version")).toString()).hasMatch()
            || !code.match(dep.value(QStringLiteral("productCode")).toString()).hasMatch()
            || !productVersion.match(dep.value(QStringLiteral("productVersion")).toString()).hasMatch()
            || !digest.match(dep.value(QStringLiteral("receiptSha256")).toString()).hasMatch()) return false;
        visited.append(name);
    }
    return true;
}

// Every profile dependency edge must be re-derived from the same validated
// receipt array. It is never a removal plan or an OS-installed dependency graph.
bool validNativeMSIProfileEdges(const QJsonObject &profile)
{
    if (!profile.value(QStringLiteral("dependencyEdges")).isArray()
        || !profile.value(QStringLiteral("lifecycleMutationAuthorized")).isBool()
        || profile.value(QStringLiteral("lifecycleMutationAuthorized")).toBool()) return false;
    const QJsonArray actual = profile.value(QStringLiteral("dependencyEdges")).toArray();
    if (actual.size() > 256) return false;
    const QJsonArray records = profile.value(QStringLiteral("records")).toArray();
    QMap<QString, QJsonObject> byKey;
    for (const QJsonValue &record : records) {
        if (!record.isObject()) return false;
        byKey.insert(record.toObject().value(QStringLiteral("packageKey")).toString(), record.toObject());
    }
    QMap<QString, QJsonObject> expected;
    for (const QJsonValue &recordValue : records) {
        const QJsonObject record = recordValue.toObject();
        const QString owner = record.value(QStringLiteral("packageKey")).toString();
        const QJsonArray deps = record.value(QStringLiteral("attempt")).toObject().value(QStringLiteral("dependencies")).toArray();
        for (const QJsonValue &depValue : deps) {
            if (!depValue.isObject()) return false;
            const QJsonObject dep = depValue.toObject();
            const QString key = dep.value(QStringLiteral("packageKey")).toString();
            const QJsonObject known = byKey.value(key);
            const QJsonObject prior = known.value(QStringLiteral("attempt")).toObject();
            const bool present = known.value(QStringLiteral("hasReceipt")).toBool()
                && !prior.isEmpty() && !known.value(QStringLiteral("receiptSha256")).toString().isEmpty();
            const bool matching = present && known.value(QStringLiteral("receiptSha256")) == dep.value(QStringLiteral("receiptSha256"))
                && prior.value(QStringLiteral("version")) == dep.value(QStringLiteral("version"))
                && prior.value(QStringLiteral("productCode")) == dep.value(QStringLiteral("productCode"))
                && prior.value(QStringLiteral("productVersion")) == dep.value(QStringLiteral("productVersion"));
            expected.insert(owner + QStringLiteral("|") + key, QJsonObject{
                {QStringLiteral("dependentPackageKey"), owner}, {QStringLiteral("dependencyPackageKey"), key},
                {QStringLiteral("dependencyVersion"), dep.value(QStringLiteral("version"))},
                {QStringLiteral("dependencyReceiptSha256"), dep.value(QStringLiteral("receiptSha256"))},
                {QStringLiteral("recordedDependencyPresent"), present},
                {QStringLiteral("recordedReceiptMatches"), matching}
            });
        }
    }
    if (expected.size() != actual.size()) return false;
    int index = 0;
    for (auto it = expected.cbegin(); it != expected.cend(); ++it, ++index) {
        if (!actual.at(index).isObject() || actual.at(index).toObject() != it.value()) return false;
    }
    return true;
}

// Validate lifecycle review as an exact projection of the same receipts and
// graph already authenticated above. This is a UI-only diagnostic, not an
// authorization to mutate Windows Installer state.
bool validNativeMSILifecyclePlans(const QJsonObject &profile)
{
    const QJsonValue field = profile.value(QStringLiteral("lifecyclePlans"));
    if (!field.isArray()) return false;
    const QJsonArray actual = field.toArray();
    const QJsonArray records = profile.value(QStringLiteral("records")).toArray();
    if (actual.size() != records.size() * 3 || actual.size() > 192) return false;
    QMap<QString, QStringList> dependents;
    QMap<QString, bool> drifted;
    QStringList available;
    for (const QJsonValue &value : records)
        available.append(value.toObject().value(QStringLiteral("packageKey")).toString());
    for (const QJsonValue &value : profile.value(QStringLiteral("dependencyEdges")).toArray()) {
        const QJsonObject edge = value.toObject();
        const QString owner = edge.value(QStringLiteral("dependentPackageKey")).toString();
        const QString required = edge.value(QStringLiteral("dependencyPackageKey")).toString();
        if (available.contains(required)) dependents[required].append(owner);
        if (!edge.value(QStringLiteral("recordedReceiptMatches")).toBool()) {
            drifted[owner] = true;
            drifted[required] = true;
        }
    }
    const QStringList operations{QStringLiteral("upgrade"), QStringLiteral("repair"), QStringLiteral("uninstall")};
    const QStringList warningList{QStringLiteral("unknown_external_dependents_not_excluded"),
        QStringLiteral("installed_application_health_unverified"), QStringLiteral("independent_lifecycle_authority_not_implemented")};
    const auto jsonArray = [](const QStringList &entries) {
        QJsonArray out;
        for (const QString &entry : entries) out.append(entry);
        return out;
    };
    int idx = 0;
    for (const QJsonValue &value : records) {
        const QJsonObject record = value.toObject();
        const QString key = record.value(QStringLiteral("packageKey")).toString();
        QStringList known = dependents.value(key);
        known.removeDuplicates(); known.sort();
        QStringList blockers;
        const bool global = profile.value(QStringLiteral("admissionLockPresent")).toBool();
        if (global || record.value(QStringLiteral("admissionLockPresent")).toBool())
            blockers.append(QStringLiteral("profile_installation_lock_present"));
        if (record.value(QStringLiteral("lockPresent")).toBool() && !record.value(QStringLiteral("admissionLockPresent")).toBool())
            blockers.append(QStringLiteral("package_operation_lock_present"));
        const bool receipt = record.value(QStringLiteral("hasReceipt")).toBool();
        const QString receiptSha = record.value(QStringLiteral("receiptSha256")).toString();
        const QJsonObject attempt = record.value(QStringLiteral("attempt")).toObject();
        static const QRegularExpression digest(QStringLiteral("^[a-f0-9]{64}$"));
        if (!receipt || attempt.isEmpty() || !digest.match(receiptSha).hasMatch())
            blockers.append(QStringLiteral("trusted_installation_receipt_missing"));
        else {
            const QString state = record.value(QStringLiteral("state")).toString();
            if (state != QStringLiteral("msi_exit_zero_not_os_attested") && state != QStringLiteral("msi_restart_required_not_os_attested"))
                blockers.append(QStringLiteral("installation_attempt_unresolved"));
            if (!attempt.value(QStringLiteral("preLaunchRegistration")).isObject()
                || !attempt.value(QStringLiteral("postExitRegistration")).isObject())
                blockers.append(QStringLiteral("registration_transition_unavailable"));
        }
        const QJsonObject product = record.value(QStringLiteral("product")).toObject();
        if (product.value(QStringLiteral("state")).toString() != QStringLiteral("registered_version_match")
            || !product.value(QStringLiteral("versionMatches")).toBool()
            || !product.value(QStringLiteral("probeComplete")).toBool()
            || product.value(QStringLiteral("probeScope")).toString() != QStringLiteral("current_user_and_machine")
            || record.value(QStringLiteral("registrationDrift")).toString() != QStringLiteral("registration_unchanged_since_exit"))
            blockers.append(QStringLiteral("exact_windows_registration_not_verified"));
        if (drifted.value(key)) blockers.append(QStringLiteral("recorded_prerequisite_evidence_changed"));
        if (!known.isEmpty()) blockers.append(QStringLiteral("known_dependent_packages_present"));
        for (const QJsonValue &held : profile.value(QStringLiteral("lifecycleRecords")).toArray()) {
            if (held.toObject().value(QStringLiteral("packageKey")).toString() == key) {
                blockers.append(QStringLiteral("prior_lifecycle_operation_recorded")); break;
            }
        }
        for (const QString &operation : operations) {
            if (!actual.at(idx).isObject()) return false;
            const QJsonObject plan = actual.at(idx++).toObject();
            if (plan.value(QStringLiteral("schema")).toInt(-1) != 1
                || plan.value(QStringLiteral("packageKey")).toString() != key
                || plan.value(QStringLiteral("operation")).toString() != operation
                || plan.value(QStringLiteral("state")).toString() != (blockers.isEmpty() ? QStringLiteral("requires_operator_review") : QStringLiteral("blocked"))
                || !plan.value(QStringLiteral("readOnly")).isBool() || !plan.value(QStringLiteral("readOnly")).toBool()
                || !plan.value(QStringLiteral("osAttested")).isBool() || plan.value(QStringLiteral("osAttested")).toBool()
                || !plan.value(QStringLiteral("mutationAuthorized")).isBool() || plan.value(QStringLiteral("mutationAuthorized")).toBool()
                || (receipt ? plan.value(QStringLiteral("recordedReceiptSha256")).toString() != receiptSha
                            : !plan.value(QStringLiteral("recordedReceiptSha256")).isUndefined())
                || plan.value(QStringLiteral("knownDependents")).toArray() != jsonArray(known)
                || plan.value(QStringLiteral("blockers")).toArray() != jsonArray(blockers)
                || plan.value(QStringLiteral("warnings")).toArray() != jsonArray(warningList)) return false;
        }
    }
    return true;
}

// The per-attempt before/after registration samples are forensic observations,
// never authorization. Check their identity and relationship before presenting
// a native helper response to any renderer window.
bool validNativeMSIRegistrationSample(const QJsonValue &value, const QString &code, const QString &version)
{
    if (!value.isObject()) return false;
    const QJsonObject sample = value.toObject();
    const QString state = sample.value(QStringLiteral("state")).toString();
    if (sample.value(QStringLiteral("productCode")).toString() != code
        || sample.value(QStringLiteral("expectedVersion")).toString() != version
        || !sample.value(QStringLiteral("readOnly")).isBool() || !sample.value(QStringLiteral("readOnly")).toBool()
        || !sample.value(QStringLiteral("osAttested")).isBool() || sample.value(QStringLiteral("osAttested")).toBool()
        || !sample.value(QStringLiteral("probeComplete")).isBool()
        || !sample.value(QStringLiteral("versionMatches")).isBool()) return false;
    const bool complete = sample.value(QStringLiteral("probeComplete")).toBool();
    const bool matches = sample.value(QStringLiteral("versionMatches")).toBool();
    const QString observed = sample.value(QStringLiteral("reportedVersion")).toString();
    if (state == QStringLiteral("os_query_unavailable"))
        return !complete && !matches && sample.value(QStringLiteral("probeScope")).toString().isEmpty() && observed.isEmpty();
    if (!complete || sample.value(QStringLiteral("probeScope")).toString() != QStringLiteral("current_user_and_machine")) return false;
    if (state == QStringLiteral("registered_version_match")) return matches && observed == version;
    if (state == QStringLiteral("registered_version_mismatch")) {
        static const QRegularExpression versionPattern(QStringLiteral("^[0-9]{1,5}\\.[0-9]{1,5}\\.[0-9]{1,5}$"));
        return !matches && observed != version && versionPattern.match(observed).hasMatch();
    }
    return !matches && observed.isEmpty() && (state == QStringLiteral("not_registered_for_user")
        || state == QStringLiteral("advertised_not_verified") || state == QStringLiteral("registered_version_unavailable")
        || state == QStringLiteral("registration_incomplete_or_unknown"));
}

bool validNativeMSIRegistrationTransition(const QJsonObject &record)
{
    const QJsonObject attempt = record.value(QStringLiteral("attempt")).toObject();
    const bool hasReceipt = record.value(QStringLiteral("hasReceipt")).toBool(false);
    if (!hasReceipt)
        return record.value(QStringLiteral("registrationTransition")).isUndefined();
    const QJsonValue before = attempt.value(QStringLiteral("preLaunchRegistration"));
    const QJsonValue after = attempt.value(QStringLiteral("postExitRegistration"));
    const QString result = record.value(QStringLiteral("registrationTransition")).toString();
    const QJsonObject current = record.value(QStringLiteral("product")).toObject();
    const QString drift = record.value(QStringLiteral("registrationDrift")).toString();
    const QString expectedDrift = after.isUndefined() ? QStringLiteral("no_post_exit_baseline")
        : (after.toObject().value(QStringLiteral("state")).toString() == QStringLiteral("os_query_unavailable")
            || current.value(QStringLiteral("state")).toString() == QStringLiteral("os_query_unavailable"))
        ? QStringLiteral("registration_comparison_unavailable")
        : after.toObject() == current
        ? QStringLiteral("registration_unchanged_since_exit")
        : QStringLiteral("registration_changed_since_exit");
    if (drift != expectedDrift) return false;
    if (before.isUndefined())
        return after.isUndefined() && result == QStringLiteral("historical_receipt_no_transition_evidence");
    const QString code = attempt.value(QStringLiteral("productCode")).toString();
    const QString version = attempt.value(QStringLiteral("productVersion")).toString();
    if (!validNativeMSIRegistrationSample(before, code, version)
        || before.toObject().value(QStringLiteral("state")).toString() != QStringLiteral("not_registered_for_user")
        || attempt.value(QStringLiteral("launchCommittedAt")).toString().isEmpty()) return false;
    if (after.isUndefined())
        return attempt.value(QStringLiteral("state")).toString() == QStringLiteral("msi_started_outcome_unknown")
            && attempt.value(QStringLiteral("finishedAt")).toString().isEmpty()
            && result == QStringLiteral("prelaunch_recorded_outcome_unknown");
    if (!validNativeMSIRegistrationSample(after, code, version)
        || attempt.value(QStringLiteral("finishedAt")).toString().isEmpty()
        || attempt.value(QStringLiteral("state")).toString() == QStringLiteral("msi_started_outcome_unknown")) return false;
    const QString state = after.toObject().value(QStringLiteral("state")).toString();
    const QString expected = state == QStringLiteral("registered_version_match")
        ? QStringLiteral("matching_registration_observed_after_attempt")
        : state == QStringLiteral("not_registered_for_user")
        ? QStringLiteral("no_registration_observed_after_attempt")
        : state == QStringLiteral("os_query_unavailable")
        ? QStringLiteral("post_exit_registration_unavailable")
        : QStringLiteral("conflicting_registration_observed_after_attempt");
    return result == expected;
}

// The single-Package report and profile-wide inventory MUST apply the same
// receipt and Windows Installer product boundary. Profile inspection is not
// a shortcut around native evidence verification or a source of OS health.
bool validNativeMSIAttemptReceiptEnvelope(const QJsonObject &report)
{
    const bool hasReceipt = report.value(QStringLiteral("hasReceipt")).toBool(false);
    const QJsonObject attempt = report.value(QStringLiteral("attempt")).toObject();
    const QJsonObject product = report.value(QStringLiteral("product")).toObject();
    if (!hasReceipt) {
        return attempt.isEmpty() && product.isEmpty()
            && report.value(QStringLiteral("receiptSha256")).isUndefined()
            && report.value(QStringLiteral("stagedArtifactVerified")).toBool(false) == false;
    }
    static const QRegularExpression digest(QStringLiteral("^[a-f0-9]{64}$"));
    static const QRegularExpression key(QStringLiteral("^[a-z][a-z0-9-]{2,79}$"));
    static const QRegularExpression code(QStringLiteral("^\\{[0-9A-F]{8}-(?:[0-9A-F]{4}-){3}[0-9A-F]{12}\\}$"));
    static const QRegularExpression version(QStringLiteral("^[0-9]{1,5}\\.[0-9]{1,5}\\.[0-9]{1,5}$"));
    const QString packageKey = report.value(QStringLiteral("packageKey")).toString();
    const QString state = report.value(QStringLiteral("state")).toString();
    const QString productCode = attempt.value(QStringLiteral("productCode")).toString();
    const QString declaredVersion = attempt.value(QStringLiteral("productVersion")).toString();
    const QJsonValue msiPathValue = attempt.value(QStringLiteral("msiPath"));
    static const QRegularExpression retainedMSIPath(QStringLiteral("^[A-Za-z0-9_./-]+\\.msi$"));
    if (!msiPathValue.isUndefined() && (!msiPathValue.isString()
        || !retainedMSIPath.match(msiPathValue.toString()).hasMatch()
        || msiPathValue.toString().startsWith(QLatin1Char('/'))
        || msiPathValue.toString().split(QLatin1Char('/')).contains(QStringLiteral(".."))
        || msiPathValue.toString().split(QLatin1Char('/')).contains(QStringLiteral(".")))) return false;
    if (report.value(QStringLiteral("stagedArtifactVerified")).toBool(false)
        || !digest.match(report.value(QStringLiteral("receiptSha256")).toString()).hasMatch()
        || !key.match(packageKey).hasMatch()
        || attempt.value(QStringLiteral("packageKey")).toString() != packageKey
        || attempt.value(QStringLiteral("state")).toString() != state
        || !attempt.value(QStringLiteral("osAttested")).isBool() || attempt.value(QStringLiteral("osAttested")).toBool(true)
        || !digest.match(attempt.value(QStringLiteral("artifactSha256")).toString()).hasMatch()
        || !digest.match(attempt.value(QStringLiteral("msiSha256")).toString()).hasMatch()
        || !code.match(productCode).hasMatch() || !version.match(declaredVersion).hasMatch()
        || !validNativeMSIDependencies(attempt.value(QStringLiteral("dependencies")), packageKey)
        || attempt.value(QStringLiteral("version")).toString().isEmpty()
        || product.value(QStringLiteral("productCode")).toString() != productCode
        || product.value(QStringLiteral("expectedVersion")).toString() != declaredVersion)
        return false;
    return validNativeMSIRegistrationSample(report.value(QStringLiteral("product")), productCode, declaredVersion);
}

const QStringList &workstationCapabilities()
{
    static const QStringList values{
        QStringLiteral("workstation.status"),
        QStringLiteral("workspace.local.list"),
        QStringLiteral("workspace.local.create"),
        QStringLiteral("workspace.local.remove"),
        QStringLiteral("workspace.local.discoverRepositories"),
        QStringLiteral("workspace.local.attachRepository"),
        QStringLiteral("workspace.local.setRepositoryTrust"),
        QStringLiteral("git.local.status"),
        QStringLiteral("git.local.details"),
        QStringLiteral("git.local.init"),
        QStringLiteral("git.local.lfsHealth"),
        QStringLiteral("git.local.lfsPolicy"),
        QStringLiteral("git.local.diff"),
        QStringLiteral("git.local.mutate"),
        QStringLiteral("git.local.secretScan"),
        QStringLiteral("git.local.clone"),
        QStringLiteral("git.local.operation.start"),
        QStringLiteral("git.local.operation.list"),
        QStringLiteral("git.local.operation.cancel"),
        QStringLiteral("task.local.definitions"),
        QStringLiteral("task.local.run"),
        QStringLiteral("task.local.list"),
        QStringLiteral("task.local.cancel"),
        QStringLiteral("hardware.local.capabilities")
    };
    return values;
}

// Only Qt's native directory picker may create these bindings. The renderer
// receives display metadata, never permission to submit an arbitrary path.
QSettings packageDestinationStore()
{
    return QSettings(QSettings::IniFormat, QSettings::UserScope,
                     QStringLiteral("Cluster"), QStringLiteral("DesktopPackageDestinations"));
}

QSettings packageUpdateHistoryStore()
{
    return QSettings(QSettings::IniFormat, QSettings::UserScope,
                     QStringLiteral("Cluster"), QStringLiteral("DesktopPackageUpdateHistory"));
}

bool savedDestinationIsSafe(const QString &value)
{
    if (value.isEmpty() || value.size() > 2048 || !QDir::isAbsolutePath(value)) return false;
    const QFileInfo folder(value);
    return folder.exists() && folder.isDir() && !folder.isSymLink();
}

qint64 nowMs()
{
    return QDateTime::currentMSecsSinceEpoch();
}

qint64 processRssMiB()
{
#ifdef Q_OS_WIN
    PROCESS_MEMORY_COUNTERS counters{};
    if (GetProcessMemoryInfo(GetCurrentProcess(), &counters, sizeof(counters))) {
        return static_cast<qint64>(counters.WorkingSetSize / (1024ULL * 1024ULL));
    }
    return -1;
#elif defined(Q_OS_LINUX)
    QFile file(QStringLiteral("/proc/self/statm"));
    if (!file.open(QIODevice::ReadOnly | QIODevice::Text)) return -1;
    const QList<QByteArray> parts = file.readAll().trimmed().split(' ');
    if (parts.size() < 2) return -1;
    bool ok = false;
    const qint64 residentPages = parts.at(1).toLongLong(&ok);
    if (!ok) return -1;
    const long pageSize = sysconf(_SC_PAGESIZE);
    if (pageSize <= 0) return -1;
    return residentPages * static_cast<qint64>(pageSize) / (1024LL * 1024LL);
#else
    return -1;
#endif
}

QString boundedText(const QJsonValue &value, int maximum)
{
    if (!value.isString()) return {};
    return value.toString().trimmed().left(maximum);
}

QString brokerLogPath()
{
    QString root = QStandardPaths::writableLocation(QStandardPaths::AppLocalDataLocation);
    if (root.isEmpty()) root = QDir::homePath() + QStringLiteral("/.cluster");
    return QDir::cleanPath(root + QStringLiteral("/logs/native-capabilities.log"));
}

QString platformName()
{
#ifdef Q_OS_WIN
    return QStringLiteral("windows");
#elif defined(Q_OS_MACOS)
    return QStringLiteral("macos");
#else
    return QStringLiteral("linux");
#endif
}

bool safeRoute(const QString &value)
{
    if (value.size() > MaxRouteLength) return false;
    static const QRegularExpression pattern(QStringLiteral("^[A-Za-z0-9_./:-]*$"));
    return pattern.match(value).hasMatch();
}

QString canonicalExistingPath(const QString &path, bool directory)
{
    QFileInfo info(path);
    if (!info.exists()) return {};
    if (directory != info.isDir()) return {};
    const QString canonical = info.canonicalFilePath();
    return canonical.isEmpty() ? QDir::cleanPath(info.absoluteFilePath()) : QDir::cleanPath(canonical);
}

QStringList sanitizedNameFilters(const QJsonObject &payload)
{
    const QJsonArray filters = payload.value(QStringLiteral("filters")).toArray();
    QStringList result;
    for (const QJsonValue &entry : filters) {
        if (result.size() >= 8 || !entry.isObject()) break;
        const QJsonObject filter = entry.toObject();
        QString name = boundedText(filter.value(QStringLiteral("name")), 40);
        if (name.isEmpty()) name = QStringLiteral("Files");
        QStringList patterns;
        for (const QJsonValue &extensionValue : filter.value(QStringLiteral("extensions")).toArray()) {
            if (patterns.size() >= 16 || !extensionValue.isString()) break;
            QString extension = extensionValue.toString().trimmed().toLower();
            if (extension.startsWith(QLatin1Char('.'))) extension.remove(0, 1);
            static const QRegularExpression extensionPattern(QStringLiteral("^[a-z0-9]{1,12}$"));
            if (extensionPattern.match(extension).hasMatch()) patterns << QStringLiteral("*.%1").arg(extension);
        }
        if (!patterns.isEmpty()) result << QStringLiteral("%1 (%2)").arg(name, patterns.join(QLatin1Char(' ')));
    }
    return result;
}
}

NativeCapabilityBroker::NativeCapabilityBroker(AppController *controller, QObject *parent)
    : QObject(parent)
    , m_controller(controller)
    , m_fileWatcher(new QFileSystemWatcher(this))
{
    rotateBrokerEpoch();
    if (m_controller) {
        connect(m_controller, &AppController::nativeSessionReadyChanged, this, [this] {
            if (!m_controller || m_controller->nativeSessionReady()) return;
            // A different signed-in user must not inherit an in-flight transfer,
            // temporary Package kit or stale native capability request epoch.
            clearTransientCapabilityState();
            rotateBrokerEpoch();
        });
    }
    if (m_controller && m_controller->workstationService()) {
        connect(m_controller->workstationService(), &WorkstationServiceManager::operationSnapshotChanged, this, [this](const QJsonArray &operations) {
            QJsonObject event{
                {QStringLiteral("schema"), 1},
                {QStringLiteral("event"), QStringLiteral("workstation.operations.changed")},
                {QStringLiteral("operations"), operations},
            };
            if (m_controller && m_controller->serverProfiles())
                event.insert(QStringLiteral("profileId"), m_controller->serverProfiles()->activeProfileId());
            emit eventReady(QString::fromUtf8(QJsonDocument(event).toJson(QJsonDocument::Compact)));
        });
    }
    connect(m_fileWatcher, &QFileSystemWatcher::directoryChanged, this, [this](const QString &path) { publishWatchEvent(path, QStringLiteral("directory")); });
    connect(m_fileWatcher, &QFileSystemWatcher::fileChanged, this, [this](const QString &path) { publishWatchEvent(path, QStringLiteral("file")); });
    if (m_controller && m_controller->serverProfiles()) {
        connect(m_controller->serverProfiles(), &ServerProfileStore::activeProfileChanged, this, [this] {
            clearTransientCapabilityState();
            rotateBrokerEpoch();
            publishTransferEvent();
        });
    }
    if (m_controller && m_controller->transferManager())
        connect(m_controller->transferManager(), &TransferManager::countsChanged, this, &NativeCapabilityBroker::publishTransferEvent);
}

QStringList NativeCapabilityBroker::capabilities() const
{
    QStringList result{
        QStringLiteral("runtime.info"),
        QStringLiteral("dialog.pickFiles"),
        QStringLiteral("dialog.pickDirectory"),
        QStringLiteral("dialog.saveFile"),
        QStringLiteral("file.open"),
        QStringLiteral("file.reveal"),
        QStringLiteral("file.preview"),
        QStringLiteral("watch.start"),
        QStringLiteral("watch.stop"),
        QStringLiteral("watch.list"),
        QStringLiteral("clipboard.status"),
        QStringLiteral("clipboard.readText"),
        QStringLiteral("clipboard.writeText"),
        QStringLiteral("session.status"),
        QStringLiteral("session.claim"),
        QStringLiteral("library.mount.status"),
        QStringLiteral("library.mount.start"),
        QStringLiteral("library.mount.stop"),
        QStringLiteral("library.mount.refresh"),
        QStringLiteral("library.mount.clearCache"),
        QStringLiteral("shortcut.global.status"),
        QStringLiteral("shortcut.global.setEnabled"),
        QStringLiteral("navigation.back"),
        QStringLiteral("navigation.forward"),
        QStringLiteral("workspace.recent"),
        QStringLiteral("package.destination.list"),
        QStringLiteral("package.destination.choose"),
        QStringLiteral("package.destination.remove"),
        QStringLiteral("package.previewFiles"),
        QStringLiteral("package.auditFiles"),
        QStringLiteral("package.syncFiles"),
        QStringLiteral("package.replaceFiles"),
        QStringLiteral("package.rollbackFiles"),
        QStringLiteral("package.auditManaged"),
        QStringLiteral("package.transfer.begin"),
        QStringLiteral("package.transfer.inspect"),
        QStringLiteral("package.transfer.diagnose"),
        QStringLiteral("package.transfer.recover"),
        QStringLiteral("package.transfer.append"),
        QStringLiteral("package.transfer.commit"),
        QStringLiteral("package.transfer.bindOffer"),
        QStringLiteral("package.transfer.stage"),
        QStringLiteral("package.kit.begin"),
        QStringLiteral("package.kit.chunk"),
        QStringLiteral("package.kit.finish"),
        QStringLiteral("package.kit.cancel"),
        QStringLiteral("package.stageKit"),
        QStringLiteral("package.auditKit"),
        QStringLiteral("package.deployContent"),
        QStringLiteral("package.rollbackContent"),
        QStringLiteral("package.previewInstaller"),
        QStringLiteral("package.previewUpgrade"),
        QStringLiteral("package.upgradeMsi"),
        QStringLiteral("package.rollbackMsi"),
        QStringLiteral("package.installMsi"),
        QStringLiteral("package.repairMsi"),
        QStringLiteral("package.uninstallMsi"),
        QStringLiteral("package.msiRepairStatus"),
        QStringLiteral("package.msiUninstallStatus"),
        QStringLiteral("package.msiUpgradeStatus"),
        QStringLiteral("package.msiRollbackStatus"),
        QStringLiteral("package.msiRollbackReview"),
        QStringLiteral("package.msiRollbackCascade"),
        QStringLiteral("package.msiIncidentWorklist"),
        QStringLiteral("package.msiProfileStatus"),
        QStringLiteral("package.msiAttemptStatus"),
        QStringLiteral("package.controlTrustStatus"),
        QStringLiteral("package.provisionControlTrust"),
        QStringLiteral("package.trustStatus"),
        QStringLiteral("package.provisionTrust"),
        QStringLiteral("package.stageStatus"),
        QStringLiteral("transfer.list"),
        QStringLiteral("transfer.status"),
        QStringLiteral("transfer.claim"),
        QStringLiteral("transfer.download"),
        QStringLiteral("transfer.uploadProjectFile"),
        QStringLiteral("transfer.pause"),
        QStringLiteral("transfer.resume"),
        QStringLiteral("transfer.retry"),
        QStringLiteral("transfer.cancel"),
        QStringLiteral("transfer.remove"),
        QStringLiteral("transfer.retryAll"),
        QStringLiteral("transfer.open"),
        QStringLiteral("transfer.reveal"),
        QStringLiteral("diagnostics.startup"),
        QStringLiteral("notification.status"),
        QStringLiteral("notification.show"),
        QStringLiteral("window.appSettings"),
        QStringLiteral("window.serverProfiles"),
        QStringLiteral("window.reload")
    };
    result.append(workstationCapabilities());
    result.removeDuplicates();
    return result;
}

QString NativeCapabilityBroker::successResponse(const QString &id, const QJsonValue &result) const
{
    QJsonObject response{
        {QStringLiteral("schema"), 1},
        {QStringLiteral("id"), id},
        {QStringLiteral("ok"), true}
    };
    if (!result.isUndefined()) response.insert(QStringLiteral("result"), result);
    return QString::fromUtf8(QJsonDocument(response).toJson(QJsonDocument::Compact));
}

QString NativeCapabilityBroker::errorResponse(const QString &id, const QString &code, const QString &message) const
{
    const QJsonObject response{
        {QStringLiteral("schema"), 1},
        {QStringLiteral("id"), id},
        {QStringLiteral("ok"), false},
        {QStringLiteral("error"), QJsonObject{
            {QStringLiteral("code"), code.left(64)},
            {QStringLiteral("message"), message.left(240)}
        }}
    };
    return QString::fromUtf8(QJsonDocument(response).toJson(QJsonDocument::Compact));
}

bool NativeCapabilityBroker::acceptRequestId(const QString &id)
{
    static const QRegularExpression pattern(QStringLiteral("^[A-Za-z0-9_-]{8,80}$"));
    if (!pattern.match(id).hasMatch() || m_seenRequestIds.contains(id)) return false;
    m_seenRequestIds.insert(id);
    m_seenRequestOrder.enqueue(id);
    while (m_seenRequestOrder.size() > MaxSeenRequestIds)
        m_seenRequestIds.remove(m_seenRequestOrder.dequeue());
    return true;
}

bool NativeCapabilityBroker::consumeRequestBudget()
{
    const qint64 cutoff = nowMs() - 60'000;
    while (!m_requestTimes.isEmpty() && m_requestTimes.head() < cutoff) m_requestTimes.dequeue();
    if (m_requestTimes.size() >= MaxRequestsPerMinute) return false;
    m_requestTimes.enqueue(nowMs());
    return true;
}

bool NativeCapabilityBroker::consumeNotificationBudget()
{
    const qint64 cutoff = nowMs() - 60'000;
    while (!m_notificationTimes.isEmpty() && m_notificationTimes.head() < cutoff) m_notificationTimes.dequeue();
    if (m_notificationTimes.size() >= MaxNotificationsPerMinute) return false;
    m_notificationTimes.enqueue(nowMs());
    return true;
}

bool NativeCapabilityBroker::consumeDialogBudget()
{
    const qint64 cutoff = nowMs() - 60'000;
    while (!m_dialogTimes.isEmpty() && m_dialogTimes.head() < cutoff) m_dialogTimes.dequeue();
    if (m_dialogTimes.size() >= MaxDialogsPerMinute) return false;
    m_dialogTimes.enqueue(nowMs());
    return true;
}

void NativeCapabilityBroker::purgeExpiredHandles()
{
    const qint64 current = nowMs();
    while (!m_handleOrder.isEmpty()) {
        const QString handle = m_handleOrder.head();
        const auto it = m_handles.constFind(handle);
        if (it != m_handles.constEnd() && it->expiresAtMs > current && m_handles.size() <= MaxOpenHandles) break;
        m_handleOrder.dequeue();
        m_handles.remove(handle);
    }
}

QString NativeCapabilityBroker::issueHandle(const QString &path, bool directory)
{
    purgeExpiredHandles();
    const QString canonical = canonicalExistingPath(path, directory);
    if (canonical.isEmpty()) return {};
    QString handle;
    do {
        handle = QStringLiteral("fh-%1").arg(QUuid::createUuid().toString(QUuid::WithoutBraces));
    } while (m_handles.contains(handle));
    LocalHandle record;
    record.path = canonical;
    record.profileId = m_controller && m_controller->serverProfiles() ? m_controller->serverProfiles()->activeProfileId() : QString();
    record.expiresAtMs = nowMs() + HandleLifetimeMs;
    record.directory = directory;
    m_handles.insert(handle, record);
    m_handleOrder.enqueue(handle);
    purgeExpiredHandles();
    return handle;
}

QString NativeCapabilityBroker::issueDestinationHandle(const QString &path)
{
    purgeExpiredHandles();
    QFileInfo info(path);
    const QString parent = canonicalExistingPath(info.absolutePath(), true);
    if (parent.isEmpty() || info.fileName().isEmpty() || info.fileName() == QStringLiteral(".") || info.fileName() == QStringLiteral("..")) return {};
    const QString clean = QDir::cleanPath(QDir(parent).absoluteFilePath(info.fileName()));
    if (!QFileInfo(clean).absoluteFilePath().startsWith(QDir(parent).absolutePath() + QDir::separator())) return {};
    QString handle;
    do {
        handle = QStringLiteral("fh-%1").arg(QUuid::createUuid().toString(QUuid::WithoutBraces));
    } while (m_handles.contains(handle));
    LocalHandle record;
    record.path = clean;
    record.profileId = m_controller && m_controller->serverProfiles() ? m_controller->serverProfiles()->activeProfileId() : QString();
    record.expiresAtMs = nowMs() + HandleLifetimeMs;
    record.directory = false;
    record.writableDestination = true;
    m_handles.insert(handle, record);
    m_handleOrder.enqueue(handle);
    purgeExpiredHandles();
    return handle;
}

const NativeCapabilityBroker::LocalHandle *NativeCapabilityBroker::resolveHandle(const QString &handle) const
{
    const auto it = m_handles.constFind(handle);
    if (it == m_handles.constEnd() || it->expiresAtMs <= nowMs()) return nullptr;
    if (!m_controller || !m_controller->serverProfiles() || it->profileId != m_controller->serverProfiles()->activeProfileId()) return nullptr;
    return &it.value();
}

QJsonObject NativeCapabilityBroker::describeHandle(const QString &handle, const LocalHandle &record) const
{
    QFileInfo info(record.path);
    QJsonObject object{
        {QStringLiteral("handle"), handle},
        {QStringLiteral("name"), info.fileName().isEmpty() ? info.absoluteDir().dirName() : info.fileName()},
        {QStringLiteral("kind"), record.directory ? QStringLiteral("directory") : QStringLiteral("file")},
        {QStringLiteral("expiresAt"), QDateTime::fromMSecsSinceEpoch(record.expiresAtMs, Qt::UTC).toString(Qt::ISODateWithMs)},
        {QStringLiteral("writableDestination"), record.writableDestination}
    };
    if (!record.directory) {
        object.insert(QStringLiteral("sizeBytes"), static_cast<double>(std::max<qint64>(0, info.size())));
        QMimeDatabase mime;
        object.insert(QStringLiteral("mimeType"), mime.mimeTypeForFile(info).name());
    }
    return object;
}

QJsonObject NativeCapabilityBroker::runtimeInfo() const
{
    const ServerProfileStore *profiles = m_controller ? m_controller->serverProfiles() : nullptr;
    return {
        {QStringLiteral("schema"), 3},
        {QStringLiteral("protocolVersion"), protocolVersion()},
        {QStringLiteral("brokerEpoch"), m_brokerEpoch},
        {QStringLiteral("platform"), platformName()},
        {QStringLiteral("appVersion"), QCoreApplication::applicationVersion()},
        {QStringLiteral("profileId"), profiles ? profiles->activeProfileId() : QString()},
        {QStringLiteral("serverUrl"), profiles ? profiles->activeServerUrl() : QString()},
        {QStringLiteral("capabilities"), QJsonArray::fromStringList(capabilities())},
        {QStringLiteral("opaqueFileHandles"), true},
        {QStringLiteral("rawFilesystemPathsExposed"), false},
        {QStringLiteral("profileIsolation"), true},
        {QStringLiteral("nativeFileWatching"), true},
        {QStringLiteral("nativeNavigation"), true},
        {QStringLiteral("nativeRecentWorkspaces"), true},
        {QStringLiteral("workstationService"), m_controller && m_controller->workstationService() && m_controller->workstationService()->available()},
        {QStringLiteral("workstationServiceProtocol"), 1},
        {QStringLiteral("workstationOperationEvents"), true},
        {QStringLiteral("nativeTransfers"), true},
        {QStringLiteral("nativeStartupDiagnostics"), true},
        {QStringLiteral("nativeSaveDialogs"), true},
        {QStringLiteral("nativeFilesystemDrop"), true},
        {QStringLiteral("sharedRendererParity"), true},
        {QStringLiteral("requestProfileBinding"), true},
        {QStringLiteral("strictPayloadSchemas"), true},
        {QStringLiteral("processRssMiB"), processRssMiB() >= 0 ? QJsonValue(static_cast<double>(processRssMiB())) : QJsonValue()},
        {QStringLiteral("processRssBudgetMiB"), 768},
        {QStringLiteral("desktopOnlyAdvantages"), QJsonArray{
            QStringLiteral("isolated-server-profiles"),
            QStringLiteral("native-notifications"),
            QStringLiteral("native-filesystem"),
            QStringLiteral("user-confirmed-clipboard-read"),
            QStringLiteral("platform-aware-library-mount-policy"),
            QStringLiteral("profile-scoped-recent-workspaces"),
            QStringLiteral("workstation-source-control"),
            QStringLiteral("git-lfs-locking"),
            QStringLiteral("native-transfer-queue"),
            QStringLiteral("native-startup-diagnostics"),
            QStringLiteral("native-command-shortcuts"),
            QStringLiteral("offline-resilience"),
            QStringLiteral("native-updater-rollback"),
            QStringLiteral("startup-diagnostics"),
            QStringLiteral("system-tray-integration"),
            QStringLiteral("deep-link-shell-integration")
        }}
    };
}

void NativeCapabilityBroker::rotateBrokerEpoch()
{
    m_brokerEpoch = QUuid::createUuid().toString(QUuid::WithoutBraces);
}

QJsonArray NativeCapabilityBroker::safeTransferItems() const
{
    QJsonArray items;
    if (!m_controller || !m_controller->transferManager()) return items;
    const bool writable = m_controller->transferManager()->ownsQueue();
    const bool otherWriter = m_controller->transferManager()->queueBlockedReason() == QStringLiteral("owned-by-another-window");
    const QVariantList source = m_controller->transferManager()->model()->sourceItems();
    for (const QVariant &value : source) {
        const QVariantMap entry = value.toMap();
        QJsonObject item;
        const QStringList fields{
            QStringLiteral("id"), QStringLiteral("direction"), QStringLiteral("state"),
            QStringLiteral("title"), QStringLiteral("fileName"), QStringLiteral("purpose"),
            QStringLiteral("totalBytes"), QStringLiteral("transferredBytes"), QStringLiteral("progress"),
            QStringLiteral("createdAt"), QStringLiteral("updatedAt"), QStringLiteral("completedAt"),
            QStringLiteral("resumable"), QStringLiteral("error"), QStringLiteral("retryable")
        };
        for (const QString &field : fields) {
            if (entry.contains(field)) item.insert(field, QJsonValue::fromVariant(entry.value(field)));
        }
        const QString state = entry.value(QStringLiteral("state")).toString();
        const bool isUpload = entry.value(QStringLiteral("direction")).toString() == QStringLiteral("upload");
        const bool hasEvidence = isUpload && !entry.value(QStringLiteral("evidenceLink")).toMap().isEmpty();
        const bool fileSaved = isUpload && !entry.value(QStringLiteral("result")).toMap().isEmpty()
            && entry.value(QStringLiteral("uploadCompletionReceipt")).toBool();
        const bool evidenceLinked = hasEvidence && !entry.value(QStringLiteral("evidenceResult")).toMap().isEmpty();
        QString stage = state;
        if (state == QStringLiteral("committing") && isUpload)
            stage = fileSaved && hasEvidence ? QStringLiteral("linking-evidence") : QStringLiteral("finalizing-file");
        else if (state == QStringLiteral("failed") && hasEvidence && fileSaved && !evidenceLinked)
            stage = QStringLiteral("evidence-link-failed");
        else if (state == QStringLiteral("paused") && hasEvidence && fileSaved && !evidenceLinked)
            stage = QStringLiteral("evidence-link-paused");
        else if (state == QStringLiteral("queued") && hasEvidence && fileSaved && !evidenceLinked)
            stage = QStringLiteral("evidence-link-queued");
        else if (state == QStringLiteral("cancelled") && hasEvidence && fileSaved && !evidenceLinked)
            stage = QStringLiteral("evidence-link-cancelled");
        item.insert(QStringLiteral("stage"), stage);
        item.insert(QStringLiteral("fileSaved"), fileSaved);
        if (hasEvidence) {
            item.insert(QStringLiteral("evidenceStatus"), evidenceLinked ? QStringLiteral("linked")
                : state == QStringLiteral("failed") ? QStringLiteral("failed")
                : state == QStringLiteral("paused") ? QStringLiteral("paused")
                : state == QStringLiteral("cancelled") ? QStringLiteral("cancelled") : QStringLiteral("pending"));
            item.insert(QStringLiteral("evidenceTargetKind"), entry.value(QStringLiteral("evidenceLink")).toMap().value(QStringLiteral("targetKind")).toString());
        }
        const bool downloadComplete = entry.value(QStringLiteral("direction")).toString() == QStringLiteral("download")
            && state == QStringLiteral("complete") && QFileInfo::exists(entry.value(QStringLiteral("filePath")).toString());
        item.insert(QStringLiteral("ownedByAnotherWindow"), !writable && otherWriter);
        item.insert(QStringLiteral("canPause"), writable && (state == QStringLiteral("running") || state == QStringLiteral("queued") || state == QStringLiteral("verifying") || state == QStringLiteral("committing")));
        item.insert(QStringLiteral("canResume"), writable && state == QStringLiteral("paused"));
        item.insert(QStringLiteral("canRetry"), writable && state == QStringLiteral("failed")
            && entry.value(QStringLiteral("retryable"), true).toBool());
        item.insert(QStringLiteral("canOpen"), downloadComplete);
        items.append(item);
        if (items.size() >= 100) break;
    }
    return items;
}

void NativeCapabilityBroker::publishTransferEvent()
{
    if (!m_controller || !m_controller->serverProfiles() || m_controller->serverProfiles()->activeProfileId().isEmpty()
        || !m_controller->transferManager()) return;
    const TransferManager *manager = m_controller->transferManager();
    // The native event already contains the current projection. Consumers
    // must not re-query the same broker on every progress tick; include the
    // writer posture so Transfer Center also avoids a second status call.
    const QJsonObject event{
        {QStringLiteral("schema"), 1},
        {QStringLiteral("event"), QStringLiteral("transfer.changed")},
        {QStringLiteral("profileId"), m_controller->serverProfiles()->activeProfileId()},
        {QStringLiteral("items"), safeTransferItems()},
        {QStringLiteral("queueStatus"), QJsonObject{{QStringLiteral("writable"), manager->ownsQueue()},
            {QStringLiteral("blockedReason"), manager->queueBlockedReason()}}}
    };
    emit eventReady(QString::fromUtf8(QJsonDocument(event).toJson(QJsonDocument::Compact)));
}

void NativeCapabilityBroker::clearTransientCapabilityState()
{
    clearWatches();
    m_handles.clear();
    m_handleOrder.clear();
    m_seenRequestIds.clear();
    m_seenRequestOrder.clear();
    m_seenNotificationTags.clear();
    m_seenNotificationTagOrder.clear();
    m_requestTimes.clear();
    m_notificationTimes.clear();
    m_dialogTimes.clear();
    if (m_packageStageProcess) {
        m_packageStageProcess->kill();
        m_packageStageProcess->deleteLater();
        m_packageStageProcess = nullptr;
    }
    m_packageStageStatus = {};
    if (m_packageIncomingKit) { delete m_packageIncomingKit; m_packageIncomingKit = nullptr; }
    m_packageIncomingId.clear(); m_packageIncomingProfile.clear(); m_packageIncomingReleaseSha.clear();
    m_packageIncomingKey.clear(); m_packageIncomingVersion.clear(); m_packageIncomingKitSha.clear();
    m_packageIncomingExpectedBytes = 0; m_packageIncomingReceivedBytes = 0;
    m_packageIncomingStartedAt = 0; m_packageIncomingReady = false;
}

bool NativeCapabilityBroker::validatePayloadShape(const QString &capability, const QJsonObject &payload, QString *errorMessage) const
{
    static const QHash<QString, QSet<QString>> allowed = {
        {QStringLiteral("runtime.info"), {}},
        {QStringLiteral("dialog.pickFiles"), {QStringLiteral("title"), QStringLiteral("multiple"), QStringLiteral("filters")}},
        {QStringLiteral("dialog.pickDirectory"), {QStringLiteral("title")}},
        {QStringLiteral("dialog.saveFile"), {QStringLiteral("title"), QStringLiteral("suggestedName"), QStringLiteral("filters")}},
        {QStringLiteral("file.open"), {QStringLiteral("handle")}},
        {QStringLiteral("file.reveal"), {QStringLiteral("handle")}},
        {QStringLiteral("file.preview"), {QStringLiteral("handle")}},
        {QStringLiteral("watch.start"), {QStringLiteral("handle")}},
        {QStringLiteral("watch.stop"), {QStringLiteral("watchId")}},
        {QStringLiteral("watch.list"), {}},
        {QStringLiteral("clipboard.status"), {}},
        {QStringLiteral("clipboard.readText"), {QStringLiteral("purpose")}},
        {QStringLiteral("clipboard.writeText"), {QStringLiteral("text")}},
        {QStringLiteral("session.status"), {}},
        {QStringLiteral("session.claim"), {QStringLiteral("code")}},
        {QStringLiteral("library.mount.status"), {}},
        {QStringLiteral("library.mount.start"), {QStringLiteral("layout"), QStringLiteral("organization"), QStringLiteral("location")}},
        {QStringLiteral("library.mount.stop"), {}},
        {QStringLiteral("library.mount.refresh"), {}},
        {QStringLiteral("library.mount.clearCache"), {}},
        {QStringLiteral("shortcut.global.status"), {}},
        {QStringLiteral("shortcut.global.setEnabled"), {QStringLiteral("enabled")}},
        {QStringLiteral("navigation.back"), {}},
        {QStringLiteral("navigation.forward"), {}},
        {QStringLiteral("workspace.recent"), {}},
        {QStringLiteral("workstation.status"), {}},
        {QStringLiteral("workspace.local.list"), {}},
        {QStringLiteral("workspace.local.create"), {QStringLiteral("handle"), QStringLiteral("name"), QStringLiteral("projectIds")}},
        {QStringLiteral("workspace.local.remove"), {QStringLiteral("workspaceId")}},
        {QStringLiteral("workspace.local.discoverRepositories"), {QStringLiteral("workspaceId"), QStringLiteral("maxDepth")}},
        {QStringLiteral("workspace.local.attachRepository"), {QStringLiteral("workspaceId"), QStringLiteral("candidateId")}},
        {QStringLiteral("workspace.local.setRepositoryTrust"), {QStringLiteral("workspaceId"), QStringLiteral("repositoryId"), QStringLiteral("trusted")}},
        {QStringLiteral("git.local.status"), {QStringLiteral("workspaceId"), QStringLiteral("repositoryId")}},
        {QStringLiteral("git.local.details"), {QStringLiteral("workspaceId"), QStringLiteral("repositoryId")}},
        {QStringLiteral("git.local.init"), {QStringLiteral("workspaceId")}},
        {QStringLiteral("git.local.lfsHealth"), {QStringLiteral("workspaceId"), QStringLiteral("repositoryId")}},
        {QStringLiteral("git.local.lfsPolicy"), {QStringLiteral("workspaceId"), QStringLiteral("repositoryId")}},
        {QStringLiteral("git.local.diff"), {QStringLiteral("workspaceId"), QStringLiteral("repositoryId"), QStringLiteral("relativePath"), QStringLiteral("staged")}},
        {QStringLiteral("git.local.mutate"), {QStringLiteral("workspaceId"), QStringLiteral("repositoryId"), QStringLiteral("action"), QStringLiteral("relativePath"), QStringLiteral("message"), QStringLiteral("name"), QStringLiteral("upstream"), QStringLiteral("pattern"), QStringLiteral("target"), QStringLiteral("remote"), QStringLiteral("url"), QStringLiteral("nextName"), QStringLiteral("stashRef"), QStringLiteral("hunkId"), QStringLiteral("confirmed")}},
        {QStringLiteral("git.local.secretScan"), {QStringLiteral("workspaceId"), QStringLiteral("repositoryId"), QStringLiteral("scope")}},
        {QStringLiteral("git.local.clone"), {QStringLiteral("workspaceId"), QStringLiteral("remote"), QStringLiteral("destinationName"), QStringLiteral("strategy")}},
        {QStringLiteral("git.local.operation.start"), {QStringLiteral("workspaceId"), QStringLiteral("repositoryId"), QStringLiteral("action"), QStringLiteral("relativePath")}},
        {QStringLiteral("git.local.operation.list"), {}},
        {QStringLiteral("git.local.operation.cancel"), {QStringLiteral("operationId")}},
        {QStringLiteral("task.local.definitions"), {QStringLiteral("workspaceId"), QStringLiteral("repositoryId")}},
        {QStringLiteral("task.local.run"), {QStringLiteral("workspaceId"), QStringLiteral("repositoryId"), QStringLiteral("taskId")}},
        {QStringLiteral("task.local.list"), {}},
        {QStringLiteral("task.local.cancel"), {QStringLiteral("operationId")}},
        {QStringLiteral("hardware.local.capabilities"), {}},
        {QStringLiteral("package.destination.list"), {}},
        {QStringLiteral("package.destination.choose"), {QStringLiteral("packageKey")}},
        {QStringLiteral("package.destination.remove"), {QStringLiteral("packageKey")}},
        {QStringLiteral("package.previewFiles"), {QStringLiteral("expectedArtifactSha256"), QStringLiteral("expectedPackageKey"), QStringLiteral("expectedVersion"), QStringLiteral("preparedKit")}},
        {QStringLiteral("package.auditFiles"), {QStringLiteral("expectedArtifactSha256"), QStringLiteral("expectedPackageKey"), QStringLiteral("expectedVersion"), QStringLiteral("preparedKit")}},
        {QStringLiteral("package.syncFiles"), {QStringLiteral("expectedArtifactSha256"), QStringLiteral("expectedPackageKey"), QStringLiteral("expectedVersion"), QStringLiteral("preparedKit")}},
        {QStringLiteral("package.replaceFiles"), {QStringLiteral("expectedArtifactSha256"), QStringLiteral("expectedPackageKey"), QStringLiteral("expectedVersion"), QStringLiteral("preparedKit")}},
        {QStringLiteral("package.rollbackFiles"), {QStringLiteral("expectedArtifactSha256"), QStringLiteral("expectedPackageKey"), QStringLiteral("expectedVersion"), QStringLiteral("preparedKit")}},
        {QStringLiteral("package.auditManaged"), {QStringLiteral("expectedArtifactSha256"), QStringLiteral("expectedPackageKey"), QStringLiteral("expectedVersion"), QStringLiteral("preparedKit")}},
        {QStringLiteral("package.transfer.begin"), {QStringLiteral("artifactSha256"), QStringLiteral("artifactSize")}},
        {QStringLiteral("package.transfer.inspect"), {QStringLiteral("artifactSha256")}},
        {QStringLiteral("package.transfer.recover"), {QStringLiteral("artifactSha256")}},
        {QStringLiteral("package.transfer.diagnose"), {QStringLiteral("artifactSha256")}},
        {QStringLiteral("package.transfer.append"), {QStringLiteral("artifactSha256"), QStringLiteral("offset"), QStringLiteral("chunkBase64")}},
        {QStringLiteral("package.transfer.commit"), {QStringLiteral("artifactSha256")}},
        {QStringLiteral("package.transfer.bindOffer"), {QStringLiteral("artifactSha256"), QStringLiteral("deploymentId"), QStringLiteral("packageId"), QStringLiteral("releaseId"), QStringLiteral("channel"), QStringLiteral("platform")}},
        {QStringLiteral("package.transfer.stage"), {QStringLiteral("artifactSha256"), QStringLiteral("packageKey"), QStringLiteral("version"), QStringLiteral("manifest"), QStringLiteral("signatureBase64"), QStringLiteral("publicKeyPem")}},
        {QStringLiteral("package.kit.begin"), {QStringLiteral("expectedArtifactSha256"), QStringLiteral("expectedPackageKey"), QStringLiteral("expectedVersion"), QStringLiteral("kitSha256"), QStringLiteral("kitSizeBytes")}},
        {QStringLiteral("package.kit.chunk"), {QStringLiteral("transferId"), QStringLiteral("offset"), QStringLiteral("chunkBase64")}},
        {QStringLiteral("package.kit.finish"), {QStringLiteral("transferId")}},
        {QStringLiteral("package.kit.cancel"), {QStringLiteral("transferId")}},
        {QStringLiteral("package.stageKit"), {QStringLiteral("expectedArtifactSha256"), QStringLiteral("expectedPackageKey"), QStringLiteral("expectedVersion"), QStringLiteral("preparedKit")}},
        {QStringLiteral("package.auditKit"), {QStringLiteral("expectedArtifactSha256"), QStringLiteral("expectedPackageKey"), QStringLiteral("expectedVersion"), QStringLiteral("preparedKit")}},
        {QStringLiteral("package.deployContent"), {QStringLiteral("expectedArtifactSha256"), QStringLiteral("expectedPackageKey"), QStringLiteral("expectedVersion"), QStringLiteral("grant"), QStringLiteral("preparedKit")}},
        {QStringLiteral("package.rollbackContent"), {QStringLiteral("expectedArtifactSha256"), QStringLiteral("expectedPackageKey"), QStringLiteral("expectedVersion"), QStringLiteral("grant"), QStringLiteral("preparedKit")}},
        {QStringLiteral("package.previewInstaller"), {QStringLiteral("expectedArtifactSha256"), QStringLiteral("expectedPackageKey"), QStringLiteral("expectedVersion"), QStringLiteral("preparedKit")}},
        {QStringLiteral("package.installMsi"), {QStringLiteral("expectedArtifactSha256"), QStringLiteral("expectedPackageKey"), QStringLiteral("expectedVersion"), QStringLiteral("grant"), QStringLiteral("preparedKit")}},
        {QStringLiteral("package.repairMsi"), {QStringLiteral("expectedArtifactSha256"), QStringLiteral("expectedPackageKey"), QStringLiteral("expectedVersion"), QStringLiteral("grant"), QStringLiteral("preparedKit")}},
        {QStringLiteral("package.previewUpgrade"), {QStringLiteral("expectedArtifactSha256"), QStringLiteral("expectedPackageKey"), QStringLiteral("expectedVersion"), QStringLiteral("priorReceiptSha256"), QStringLiteral("preparedKit")}},
        {QStringLiteral("package.upgradeMsi"), {QStringLiteral("expectedArtifactSha256"), QStringLiteral("expectedPackageKey"), QStringLiteral("expectedVersion"), QStringLiteral("grant"), QStringLiteral("preparedKit")}},
        {QStringLiteral("package.rollbackMsi"), {QStringLiteral("expectedArtifactSha256"), QStringLiteral("expectedPackageKey"), QStringLiteral("expectedVersion"), QStringLiteral("grant"), QStringLiteral("preparedKit")}},
        {QStringLiteral("package.uninstallMsi"), {QStringLiteral("expectedArtifactSha256"), QStringLiteral("expectedPackageKey"), QStringLiteral("expectedVersion"), QStringLiteral("grant"), QStringLiteral("preparedKit")}},
        {QStringLiteral("package.msiRepairStatus"), {QStringLiteral("packageKey")}},
        {QStringLiteral("package.msiUninstallStatus"), {QStringLiteral("packageKey")}},
        {QStringLiteral("package.msiUpgradeStatus"), {QStringLiteral("packageKey")}},
        {QStringLiteral("package.msiRollbackStatus"), {QStringLiteral("packageKey")}},
        {QStringLiteral("package.msiRollbackReview"), {QStringLiteral("packageKey")}},
        {QStringLiteral("package.msiRollbackCascade"), {QStringLiteral("packageKey")}},
        {QStringLiteral("package.msiIncidentWorklist"), {}},
        {QStringLiteral("package.msiProfileStatus"), {}},
        {QStringLiteral("package.msiAttemptStatus"), {QStringLiteral("packageKey")}},
        {QStringLiteral("package.controlTrustStatus"), {}},
        {QStringLiteral("package.provisionControlTrust"), {}},
        {QStringLiteral("package.trustStatus"), {}},
        {QStringLiteral("package.provisionTrust"), {}},
        {QStringLiteral("package.stageStatus"), {}},
        {QStringLiteral("transfer.list"), {}},
        {QStringLiteral("transfer.status"), {}},
        {QStringLiteral("transfer.claim"), {}},
        {QStringLiteral("transfer.download"), {QStringLiteral("url"), QStringLiteral("fileName"), QStringLiteral("checksumSha256")}},
        {QStringLiteral("transfer.uploadProjectFile"), {QStringLiteral("handle"), QStringLiteral("projectId"), QStringLiteral("title"), QStringLiteral("originalName"), QStringLiteral("mimeType"), QStringLiteral("category"), QStringLiteral("assetRole"), QStringLiteral("status"), QStringLiteral("tags"), QStringLiteral("versionGroupId"), QStringLiteral("versionNumber"), QStringLiteral("versionLabel"), QStringLiteral("derivedFromId"), QStringLiteral("proxyOfId"), QStringLiteral("exportOfId"), QStringLiteral("evidenceForKind"), QStringLiteral("evidenceForId"), QStringLiteral("evidenceForLabel"), QStringLiteral("evidenceRelationship")}},
        {QStringLiteral("transfer.pause"), {QStringLiteral("transferId")}},
        {QStringLiteral("transfer.resume"), {QStringLiteral("transferId")}},
        {QStringLiteral("transfer.retry"), {QStringLiteral("transferId")}},
        {QStringLiteral("transfer.cancel"), {QStringLiteral("transferId")}},
        {QStringLiteral("transfer.remove"), {QStringLiteral("transferId")}},
        {QStringLiteral("transfer.retryAll"), {}},
        {QStringLiteral("transfer.open"), {QStringLiteral("transferId")}},
        {QStringLiteral("transfer.reveal"), {QStringLiteral("transferId")}},
        {QStringLiteral("diagnostics.startup"), {}},
        {QStringLiteral("notification.status"), {}},
        {QStringLiteral("notification.show"), {QStringLiteral("title"), QStringLiteral("body"), QStringLiteral("route"), QStringLiteral("tag"), QStringLiteral("priority")}},
        {QStringLiteral("window.appSettings"), {}},
        {QStringLiteral("window.serverProfiles"), {}},
        {QStringLiteral("window.reload"), {}}
    };
    const auto it = allowed.constFind(capability);
    if (it == allowed.constEnd()) {
        if (errorMessage) *errorMessage = QStringLiteral("That native capability has no payload schema.");
        return false;
    }
    for (auto field = payload.constBegin(); field != payload.constEnd(); ++field) {
        if (!it.value().contains(field.key())) {
            if (errorMessage) *errorMessage = QStringLiteral("Native capability payload contained an unsupported field: %1").arg(field.key().left(48));
            return false;
        }
    }
    return true;
}

QJsonValue NativeCapabilityBroker::dispatch(const QString &capability, const QJsonObject &payload, QString *errorCode, QString *errorMessage)
{
    auto fail = [&](const QString &code, const QString &message) -> QJsonValue {
        *errorCode = code;
        *errorMessage = message;
        return {};
    };

    if (capability == QStringLiteral("runtime.info"))
        return runtimeInfo();

    if (workstationCapabilities().contains(capability)) {
        WorkstationServiceManager *manager = m_controller ? m_controller->workstationService() : nullptr;
        if (!manager) return fail(QStringLiteral("WORKSTATION_UNAVAILABLE"), QStringLiteral("Cluster Workstation service is unavailable."));
        QJsonObject forwarded = payload;
        if (capability == QStringLiteral("workspace.local.create")) {
            const QString handle = boundedText(payload.value(QStringLiteral("handle")), 256);
            const LocalHandle *record = resolveHandle(handle);
            if (!record || !record->directory) return fail(QStringLiteral("WORKSPACE_HANDLE_INVALID"), QStringLiteral("Choose an active Desktop directory for the local workspace."));
            forwarded.remove(QStringLiteral("handle"));
            forwarded.insert(QStringLiteral("rootPath"), record->path);
            QJsonArray projectRefs;
            const QString profileId = m_controller && m_controller->serverProfiles() ? m_controller->serverProfiles()->activeProfileId() : QString();
            for (const QJsonValue &projectId : payload.value(QStringLiteral("projectIds")).toArray()) {
                const QString id = projectId.toString().trimmed();
                if (!id.isEmpty()) projectRefs.append(QJsonObject{{QStringLiteral("profileId"), profileId}, {QStringLiteral("projectId"), id}});
            }
            forwarded.remove(QStringLiteral("projectIds"));
            forwarded.insert(QStringLiteral("projectRefs"), projectRefs);
        }
        QString workstationCode;
        QString workstationMessage;
        const QJsonObject result = manager->requestCapability(capability, forwarded, &workstationCode, &workstationMessage);
        if (!workstationCode.isEmpty()) return fail(workstationCode, workstationMessage);
        return result;
    }

    if (capability == QStringLiteral("session.status")) {
        return QJsonObject{{QStringLiteral("ready"), m_controller && m_controller->nativeSessionReady()}};
    }
    if (capability == QStringLiteral("session.claim")) {
        const QString code = boundedText(payload.value(QStringLiteral("code")), 256);
        if (!m_controller || code.size() < 32 || !m_controller->claimNativeSession(code))
            return fail(QStringLiteral("SESSION_CLAIM_REJECTED"), QStringLiteral("The one-time native session handoff was rejected."));
        return QJsonObject{{QStringLiteral("accepted"), true}};
    }
    if (capability.startsWith(QStringLiteral("library.mount."))) {
        if (!m_controller || !m_controller->libraryMountManager())
            return fail(QStringLiteral("MOUNT_UNAVAILABLE"), QStringLiteral("The native Library mount service is unavailable."));
        auto *manager = m_controller->libraryMountManager();
        if (capability == QStringLiteral("library.mount.status")) return QJsonObject::fromVariantMap(manager->status());
        if (capability == QStringLiteral("library.mount.start")) {
            QVariantMap options;
            options.insert(QStringLiteral("layout"), boundedText(payload.value(QStringLiteral("layout")), 16));
            options.insert(QStringLiteral("organization"), boundedText(payload.value(QStringLiteral("organization")), 16));
            options.insert(QStringLiteral("location"), boundedText(payload.value(QStringLiteral("location")), 180));
            if (!manager->start(options)) {
                const QString reason = manager->status().value(QStringLiteral("lastError")).toMap().value(QStringLiteral("message")).toString();
                return fail(QStringLiteral("MOUNT_START_FAILED"), reason.isEmpty()
                    ? QStringLiteral("Mounted Libraries could not start.") : reason);
            }
            return QJsonObject::fromVariantMap(manager->status());
        }
        if (capability == QStringLiteral("library.mount.stop")) { if (!manager->stop()) return fail(QStringLiteral("MOUNT_REQUIRED_BY_SERVER"), manager->status().value(QStringLiteral("lastError")).toMap().value(QStringLiteral("message")).toString()); return QJsonObject::fromVariantMap(manager->status()); }
        if (capability == QStringLiteral("library.mount.refresh")) { if (!manager->refresh()) return fail(QStringLiteral("MOUNT_REFRESH_UNAVAILABLE"), QStringLiteral("Mounted Libraries are not ready to refresh.")); return QJsonObject{{QStringLiteral("accepted"), true}}; }
        if (capability == QStringLiteral("library.mount.clearCache")) { if (!manager->clearCache()) return fail(QStringLiteral("MOUNT_CACHE_BUSY"), QStringLiteral("Unmount Cluster Libraries before clearing their native cache.")); return QJsonObject{{QStringLiteral("cleared"), true}}; }
    }
    if (capability.startsWith(QStringLiteral("shortcut.global."))) {
        if (!m_controller || !m_controller->globalShortcuts()) return fail(QStringLiteral("GLOBAL_SHORTCUTS_UNAVAILABLE"), QStringLiteral("Global shortcuts are unavailable."));
        auto *shortcuts = m_controller->globalShortcuts();
        if (capability == QStringLiteral("shortcut.global.status")) return QJsonObject::fromVariantMap(shortcuts->status());
        if (capability == QStringLiteral("shortcut.global.setEnabled")) {
            if (!payload.value(QStringLiteral("enabled")).isBool()) return fail(QStringLiteral("INVALID_PAYLOAD"), QStringLiteral("enabled must be a boolean."));
            shortcuts->setEnabled(payload.value(QStringLiteral("enabled")).toBool());
            return QJsonObject::fromVariantMap(shortcuts->status());
        }
    }

    if (capability == QStringLiteral("workspace.recent")) {
        if (!m_controller || !m_controller->serverProfiles()) return QJsonArray{};
        return QJsonArray::fromVariantList(m_controller->serverProfiles()->recentWorkspaces().mid(0, 8));
    }

    // Native-only, user-typed out-of-band trust enrollment. The renderer may
    // ask for the native dialog but CANNOT supply or overwrite any fingerprint.
    if (capability == QStringLiteral("package.trustStatus") || capability == QStringLiteral("package.provisionTrust")
        || capability == QStringLiteral("package.controlTrustStatus") || capability == QStringLiteral("package.provisionControlTrust")) {
        const bool controlTrust = capability == QStringLiteral("package.controlTrustStatus") || capability == QStringLiteral("package.provisionControlTrust");
        if (!m_controller || !m_controller->nativeSessionReady() || !m_controller->connectionOnline())
            return fail(QStringLiteral("NATIVE_SESSION_REQUIRED"), QStringLiteral("Package trust setup requires a signed-in Desktop session."));
        const QString profileId = m_controller->serverProfiles() ? m_controller->serverProfiles()->activeProfileId() : QString();
        static const QRegularExpression profilePattern(QStringLiteral("^[a-zA-Z0-9_-]{8,80}$"));
        static const QRegularExpression fingerprintPattern(QStringLiteral("^[a-f0-9]{64}$"));
        if (!profilePattern.match(profileId).hasMatch())
            return fail(QStringLiteral("PROFILE_INVALID"), QStringLiteral("A valid server profile is required."));
        const QString configDir = QDir::cleanPath(QStandardPaths::writableLocation(QStandardPaths::AppConfigLocation) + (controlTrust ? QStringLiteral("/package-control-trust") : QStringLiteral("/package-trust")));
        const QString pinPath = QDir(configDir).filePath(profileId + QStringLiteral(".pin"));
        const QFileInfo configInfo(configDir);
        if (configInfo.exists() && (!configInfo.isDir() || configInfo.isSymLink()))
            return fail(QStringLiteral("PACKAGE_TRUST_UNSAFE"), QStringLiteral("Unsafe native trust directory."));
        const QFileInfo pinInfo(pinPath);
        if (pinInfo.isSymLink() || (pinInfo.exists() && (!pinInfo.isFile() || pinInfo.size() > 80)))
            return fail(QStringLiteral("PACKAGE_TRUST_UNSAFE"), QStringLiteral("Unsafe trust-pin file."));
        QString existing;
        if (pinInfo.exists()) {
            QFile file(pinPath);
            if (!file.open(QIODevice::ReadOnly))
                return fail(QStringLiteral("PACKAGE_TRUST_UNREADABLE"), QStringLiteral("Cannot inspect Package trust configuration."));
            existing = QString::fromLatin1(file.readAll()).trimmed();
            if (!fingerprintPattern.match(existing).hasMatch())
                return fail(QStringLiteral("PACKAGE_TRUST_INVALID"), QStringLiteral("Existing pin is invalid. Repair it using trusted local administrator procedures."));
        }
        if (capability == QStringLiteral("package.trustStatus") || capability == QStringLiteral("package.controlTrustStatus"))
            return QJsonObject{{QStringLiteral("configured"), !existing.isEmpty()},
                {QStringLiteral("fingerprint"), existing}, {QStringLiteral("profileId"), profileId},
                {QStringLiteral("authority"), QStringLiteral("user_profile_local_pin_not_machine_attested")}};
        if (m_packageStageProcess)
            return fail(QStringLiteral("PACKAGE_STAGE_BUSY"), QStringLiteral("Cannot change trust while native verification is running."));
        if (!consumeDialogBudget())
            return fail(QStringLiteral("RATE_LIMITED"), QStringLiteral("Too many native Package dialogs."));
        const QString epoch = m_brokerEpoch;
        bool ok = false;
        const QString typed = QInputDialog::getText(nullptr, controlTrust ? QStringLiteral("Enroll independent deployment-control key pin") : QStringLiteral("Enroll independent Package signing pin"),
            controlTrust ? QStringLiteral("Obtain the separate deployment-control public key fingerprint from your studio administrator over a trusted independent channel. Never copy it from a downloaded grant.\n\nEnter exactly 64 lowercase hexadecimal characters:")
                : QStringLiteral("Obtain the DER/SPKI SHA-256 fingerprint directly from your studio administrator, NOT from the downloaded Package kit.\n\nEnter exactly 64 lowercase hexadecimal characters:"),
            QLineEdit::Normal, QString(), &ok).trimmed();
        if (!ok) return QJsonObject{{QStringLiteral("accepted"), false}};
        if (!fingerprintPattern.match(typed).hasMatch())
            return fail(QStringLiteral("PACKAGE_TRUST_INVALID"), QStringLiteral("Fingerprint must be exactly 64 lowercase hexadecimal characters."));
        const QString repeated = QInputDialog::getText(nullptr, QStringLiteral("Confirm independent trust fingerprint"),
            QStringLiteral("Re-enter the fingerprint from the independent administrator channel:"),
            QLineEdit::Normal, QString(), &ok).trimmed();
        if (!ok) return QJsonObject{{QStringLiteral("accepted"), false}};
        if (repeated != typed)
            return fail(QStringLiteral("PACKAGE_TRUST_MISMATCH"), QStringLiteral("Confirmation fingerprint does not match."));
        if (existing == typed) return QJsonObject{{QStringLiteral("accepted"), true}, {QStringLiteral("unchanged"), true}};
        const QString summary = QStringLiteral("Server profile: %1\nCurrent: %2\nNew: %3\n\nThis trusts Package signing identity for this local profile. Ensure you verified the fingerprint independently. Continue?")
            .arg(profileId, existing.isEmpty() ? QStringLiteral("not configured") : existing,
                typed);
        if (QMessageBox::warning(nullptr, QStringLiteral("Confirm Package signing trust"), summary,
            QMessageBox::Yes | QMessageBox::No, QMessageBox::No) != QMessageBox::Yes)
            return QJsonObject{{QStringLiteral("accepted"), false}};
        if (m_brokerEpoch != epoch || !m_controller || !m_controller->nativeSessionReady()
            || !m_controller->connectionOnline() || !m_controller->serverProfiles()
            || m_controller->serverProfiles()->activeProfileId() != profileId)
            return fail(QStringLiteral("PACKAGE_SESSION_CHANGED"), QStringLiteral("Desktop session changed during trust enrollment."));
        if (!QDir().mkpath(configDir) || QFileInfo(configDir).isSymLink() || QFileInfo(pinPath).isSymLink())
            return fail(QStringLiteral("PACKAGE_TRUST_UNSAFE"), QStringLiteral("Native trust directory changed unexpectedly."));
        QSaveFile output(pinPath);
        if (!output.open(QIODevice::WriteOnly) || !output.setPermissions(QFileDevice::ReadOwner | QFileDevice::WriteOwner))
            return fail(QStringLiteral("PACKAGE_TRUST_WRITE_FAILED"), QStringLiteral("Could not prepare private Package trust file."));
        const QByteArray contents = typed.toLatin1() + '\n';
        if (output.write(contents) != contents.size() || !output.commit())
            return fail(QStringLiteral("PACKAGE_TRUST_WRITE_FAILED"), QStringLiteral("Failed to atomically store native Package trust pin."));
        return QJsonObject{{QStringLiteral("accepted"), true}, {QStringLiteral("configured"), true},
            {QStringLiteral("fingerprint"), typed}, {QStringLiteral("profileId"), profileId},
            {QStringLiteral("authority"), QStringLiteral("user_profile_local_pin_not_machine_attested")}};
    }

    if (capability == QStringLiteral("package.destination.list")
        || capability == QStringLiteral("package.destination.choose")
        || capability == QStringLiteral("package.destination.remove")) {
        if (!m_controller || !m_controller->nativeSessionReady()
            || !m_controller->connectionOnline() || !m_controller->serverProfiles())
            return fail(QStringLiteral("NATIVE_SESSION_REQUIRED"), QStringLiteral("An authenticated, connected Desktop session is required."));
        const QString profileId = m_controller->serverProfiles()->activeProfileId();
        static const QRegularExpression profilePattern(QStringLiteral("^[a-zA-Z0-9_-]{8,80}$"));
        static const QRegularExpression packagePattern(QStringLiteral("^[a-z][a-z0-9-]{2,79}$"));
        if (!profilePattern.match(profileId).hasMatch())
            return fail(QStringLiteral("PROFILE_INVALID"), QStringLiteral("No valid active server profile."));
        QSettings store = packageDestinationStore();
        store.setFallbacksEnabled(false);
        store.beginGroup(profileId);
        QSettings history = packageUpdateHistoryStore();
        history.setFallbacksEnabled(false);
        history.beginGroup(profileId);
        if (capability == QStringLiteral("package.destination.list")) {
            QJsonArray destinations;
            const QStringList keys = store.childKeys();
            if (keys.size() > 100) return fail(QStringLiteral("PACKAGE_DESTINATION_LIMIT"), QStringLiteral("Too many saved Package destinations."));
            for (const QString &key : keys) {
                if (!packagePattern.match(key).hasMatch()) continue;
                const QString path = store.value(key).toString();
                history.beginGroup(key);
                const bool matchingPath = history.value(QStringLiteral("path")).toString() == path;
                const QString reportedDigest = matchingPath ? history.value(QStringLiteral("artifactSha256")).toString() : QString();
                const QString reportedVersion = matchingPath ? history.value(QStringLiteral("version")).toString() : QString();
                const QString lastUpdateAt = matchingPath ? history.value(QStringLiteral("updatedAt")).toString() : QString();
                history.endGroup();
                destinations.append(QJsonObject{{QStringLiteral("packageKey"), key},
                    {QStringLiteral("path"), path},
                    {QStringLiteral("available"), savedDestinationIsSafe(path)},
                    {QStringLiteral("reportedArtifactSha256"), reportedDigest},
                    {QStringLiteral("reportedVersion"), reportedVersion},
                    {QStringLiteral("lastUpdateAt"), lastUpdateAt}});
            }
            return QJsonObject{{QStringLiteral("profileId"), profileId},
                {QStringLiteral("destinations"), destinations}};
        }
        const QString key = boundedText(payload.value(QStringLiteral("packageKey")), 80);
        if (!packagePattern.match(key).hasMatch())
            return fail(QStringLiteral("PACKAGE_KEY_INVALID"), QStringLiteral("Select a valid Package before changing its destination."));
        if (m_packageStageProcess)
            return fail(QStringLiteral("PACKAGE_STAGE_BUSY"), QStringLiteral("Finish the current Package operation first."));
        if (!consumeDialogBudget())
            return fail(QStringLiteral("RATE_LIMITED"), QStringLiteral("Too many native Package dialogs."));
        if (capability == QStringLiteral("package.destination.remove")) {
            if (!store.contains(key)) return QJsonObject{{QStringLiteral("accepted"), true}, {QStringLiteral("removed"), false}};
            if (QMessageBox::question(nullptr, QStringLiteral("Forget Package destination"),
                QStringLiteral("Forget the saved destination for %1?\nExisting files and native rollback history will not be deleted.").arg(key),
                QMessageBox::Yes | QMessageBox::No, QMessageBox::No) != QMessageBox::Yes)
                return QJsonObject{{QStringLiteral("accepted"), false}};
            store.remove(key);
            history.remove(key); // removes only UI advisory status, not native backups or destination files
            history.sync();
            store.sync();
            if (store.status() != QSettings::NoError)
                return fail(QStringLiteral("PACKAGE_DESTINATION_SAVE_FAILED"), QStringLiteral("Could not forget saved destination."));
            return QJsonObject{{QStringLiteral("accepted"), true}, {QStringLiteral("removed"), true}};
        }
        const QString path = QFileDialog::getExistingDirectory(nullptr,
            QStringLiteral("Select persistent Package destination for %1").arg(key),
            store.value(key).toString().isEmpty()
                ? QStandardPaths::writableLocation(QStandardPaths::DocumentsLocation)
                : store.value(key).toString(), QFileDialog::ShowDirsOnly);
        if (path.isEmpty()) return QJsonObject{{QStringLiteral("accepted"), false}};
        if (!m_controller || !m_controller->nativeSessionReady() || !m_controller->connectionOnline()
            || !m_controller->serverProfiles() || m_controller->serverProfiles()->activeProfileId() != profileId)
            return fail(QStringLiteral("PACKAGE_SESSION_CHANGED"), QStringLiteral("Server profile changed during destination selection."));
        const QString selected = QDir::cleanPath(QFileInfo(path).absoluteFilePath());
        if (!savedDestinationIsSafe(selected))
            return fail(QStringLiteral("PACKAGE_DESTINATION_INVALID"), QStringLiteral("Destination must be an existing ordinary local directory."));
        if (QMessageBox::question(nullptr, QStringLiteral("Save Package destination"),
            QStringLiteral("Use this folder for future updates to %1?\n%2\n\nEach update still requires explicit confirmation. This does not modify any files.").arg(key, selected),
            QMessageBox::Yes | QMessageBox::No, QMessageBox::No) != QMessageBox::Yes)
            return QJsonObject{{QStringLiteral("accepted"), false}};
        if (store.value(key).toString() != selected) {
            history.remove(key); // do not report a different folder as up to date
            history.sync();
        }
        store.setValue(key, selected);
        store.sync();
        if (store.status() != QSettings::NoError)
            return fail(QStringLiteral("PACKAGE_DESTINATION_SAVE_FAILED"), QStringLiteral("Could not save the selected destination."));
        return QJsonObject{{QStringLiteral("accepted"), true}, {QStringLiteral("packageKey"), key},
            {QStringLiteral("path"), selected}, {QStringLiteral("available"), true}};
    }

    if (capability.startsWith(QStringLiteral("package.transfer."))) {
        // Renderer has no local path authority. The CLI computes and checks the
        // canonical digest, checkpoint length and prefix hash on each operation.
        // This is transport staging ONLY, not a Package deployment grant.
        if (!m_controller || !m_controller->nativeSessionReady() || !m_controller->connectionOnline()
            || !m_controller->serverProfiles())
            return fail(QStringLiteral("NATIVE_SESSION_REQUIRED"), QStringLiteral("Sign in to use native archive transport."));
        const QString profile = m_controller->serverProfiles()->activeProfileId();
        static const QRegularExpression profilePattern(QStringLiteral("^[A-Za-z0-9_-]{8,80}$"));
        static const QRegularExpression digestPattern(QStringLiteral("^[a-f0-9]{64}$"));
        const QString digest = payload.value(QStringLiteral("artifactSha256")).toString();
        if (!profilePattern.match(profile).hasMatch() || !digestPattern.match(digest).hasMatch()
            || m_packageStageProcess)
            return fail(QStringLiteral("PACKAGE_TRANSFER_INVALID"), QStringLiteral("Invalid archive or active native operation."));
        const QString root = QDir::cleanPath(QStandardPaths::writableLocation(QStandardPaths::AppLocalDataLocation)
            + QStringLiteral("/package-staging/") + profile);
        if (!QDir().mkpath(root) || QFileInfo(root).isSymLink())
            return fail(QStringLiteral("PACKAGE_TRANSFER_ROOT_UNSAFE"), QStringLiteral("Unable to prepare the native profile transfer root."));
        const QFileInfo helper(QDir(QCoreApplication::applicationDirPath()).filePath(
#ifdef Q_OS_WIN
            QStringLiteral("cluster-package-stager.exe")
#else
            QStringLiteral("cluster-package-stager")
#endif
        ));
        if (!helper.isFile() || helper.isSymLink() || !helper.isExecutable())
            return fail(QStringLiteral("PACKAGE_HELPER_MISSING"), QStringLiteral("Native Package transfer helper is unavailable."));
        if (capability == QStringLiteral("package.transfer.stage")) {
            // This is staging only: renderer sends signed, bounded sidecars,
            // never an arbitrary local path, executable command, trust root or
            // install grant. The native helper reads the already verified disk
            // archive and independently checks Ed25519/SPKI before extraction.
            if (!consumeDialogBudget())
                return fail(QStringLiteral("RATE_LIMITED"), QStringLiteral("Too many Package staging prompts."));
            const QString key = payload.value(QStringLiteral("packageKey")).toString();
            const QString version = payload.value(QStringLiteral("version")).toString();
            static const QRegularExpression keyPattern(QStringLiteral("^[a-z][a-z0-9-]{2,79}$"));
            static const QRegularExpression versionPattern(QStringLiteral("^[0-9]+\\.[0-9]+\\.[0-9]+(?:-[A-Za-z0-9.-]+)?$"));
            const QJsonObject manifest = payload.value(QStringLiteral("manifest")).toObject();
            const QByteArray manifestBytes = QJsonDocument(manifest).toJson(QJsonDocument::Compact);
            const QString signature = payload.value(QStringLiteral("signatureBase64")).toString();
            const QString publicKey = payload.value(QStringLiteral("publicKeyPem")).toString();
            static const QRegularExpression signaturePattern(QStringLiteral("^[A-Za-z0-9+/]{86}==$"));
            if (!keyPattern.match(key).hasMatch() || !versionPattern.match(version).hasMatch()
                || manifestBytes.size() < 40 || manifestBytes.size() > 4096
                || manifest.value(QStringLiteral("artifactSha256")).toString() != digest
                || manifest.value(QStringLiteral("packageKey")).toString() != key
                || manifest.value(QStringLiteral("version")).toString() != version
                || !signaturePattern.match(signature).hasMatch()
                || publicKey.size() < 100 || publicKey.size() > 4096
                || !publicKey.startsWith(QStringLiteral("-----BEGIN PUBLIC KEY-----")))
                return fail(QStringLiteral("PACKAGE_SIGNED_METADATA_INVALID"), QStringLiteral("Signed Package metadata does not match the selected retained archive."));
            const QString trustDir = QDir::cleanPath(QStandardPaths::writableLocation(QStandardPaths::AppConfigLocation)
                + QStringLiteral("/package-trust"));
            const QFileInfo trustRoot(trustDir);
            const QFileInfo pinInfo(QDir(trustDir).filePath(profile + QStringLiteral(".pin")));
            if (!trustRoot.isDir() || trustRoot.isSymLink() || !pinInfo.isFile() || pinInfo.isSymLink()
                || pinInfo.size() < 64 || pinInfo.size() > 80)
                return fail(QStringLiteral("PACKAGE_TRUST_MISSING"), QStringLiteral("Independent Package signing trust is not configured."));
            QFile pinFile(pinInfo.absoluteFilePath());
            if (!pinFile.open(QIODevice::ReadOnly))
                return fail(QStringLiteral("PACKAGE_TRUST_UNREADABLE"), QStringLiteral("Cannot read independently configured Package signing trust."));
            const QString pin = QString::fromLatin1(pinFile.readAll()).trimmed();
            if (!digestPattern.match(pin).hasMatch())
                return fail(QStringLiteral("PACKAGE_TRUST_INVALID"), QStringLiteral("Invalid independently provisioned Package key fingerprint."));
            if (QMessageBox::question(nullptr, QStringLiteral("Stage verified native archive"),
                QStringLiteral("Verify and stage %1 v%2 from the retained native ZIP?\n\n"
                               "SHA-256: %3…\nIndependent key: %4…\n\n"
                               "The native helper rechecks signed metadata and the full archive before extraction. "
                               "This does NOT install or activate software, and it grants no deployment permission.")
                    .arg(key, version, digest.left(16), pin.left(16)),
                QMessageBox::Yes | QMessageBox::No, QMessageBox::No) != QMessageBox::Yes)
                return QJsonObject{{QStringLiteral("accepted"), false}};
            if (!m_controller || !m_controller->nativeSessionReady() || !m_controller->connectionOnline()
                || !m_controller->serverProfiles() || m_controller->serverProfiles()->activeProfileId() != profile)
                return fail(QStringLiteral("PACKAGE_SESSION_CHANGED"), QStringLiteral("Desktop session changed during Package confirmation."));
            const QJsonObject sidecars{{QStringLiteral("manifest"), manifest},
                {QStringLiteral("signatureBase64"), signature}, {QStringLiteral("publicKeyPem"), publicKey}};
            const QByteArray bytes = QJsonDocument(sidecars).toJson(QJsonDocument::Compact);
            if (bytes.size() > 8192)
                return fail(QStringLiteral("PACKAGE_SIGNED_METADATA_INVALID"), QStringLiteral("Signed sidecars are too large."));
            const QString operationId = QUuid::createUuid().toString(QUuid::WithoutBraces);
            const QString startEpoch = m_brokerEpoch;
            auto *process = new QProcess(this);
            process->setProgram(helper.absoluteFilePath());
            process->setArguments(QStringList{
                QStringLiteral("--action"), QStringLiteral("transfer-stage"),
                QStringLiteral("--root"), root, QStringLiteral("--staging-root"), root,
                QStringLiteral("--transfer-sha256"), digest,
                QStringLiteral("--expected-artifact-sha256"), digest,
                QStringLiteral("--expected-package-key"), key,
                QStringLiteral("--expected-version"), version,
                QStringLiteral("--trusted-key-sha256"), pin});
            process->setProcessChannelMode(QProcess::MergedChannels);
            m_packageStageProcess = process;
            m_packageStageStatus = QJsonObject{{QStringLiteral("state"), QStringLiteral("verifying")},
                {QStringLiteral("artifactSha256"), digest}, {QStringLiteral("packageKey"), key},
                {QStringLiteral("version"), version}, {QStringLiteral("operationId"), operationId}};
            connect(process, QOverload<int, QProcess::ExitStatus>::of(&QProcess::finished), this,
                [this, process, digest, key, version, pin, profile, operationId, startEpoch](int exitCode, QProcess::ExitStatus exitStatus) {
                    const QByteArray output = process->readAllStandardOutput();
                    const QByteArray prefix("CLUSTER_STAGE_RESULT ");
                    const auto pos = output.indexOf(prefix);
                    const QByteArray resultBytes = pos >= 0
                        ? output.mid(pos + prefix.size()).split('\n').first().trimmed() : QByteArray();
                    const QJsonObject evidence = QJsonDocument::fromJson(resultBytes).object();
                    const bool success = exitStatus == QProcess::NormalExit && exitCode == 0
                        && evidence.value(QStringLiteral("schema")).toInt() == 1
                        && evidence.value(QStringLiteral("state")).toString() == QStringLiteral("verified_staged_not_installed")
                        && evidence.value(QStringLiteral("archiveSha256")).toString() == digest
                        && evidence.value(QStringLiteral("packageKey")).toString() == key
                        && evidence.value(QStringLiteral("version")).toString() == version
                        && evidence.value(QStringLiteral("signingKeySha256")).toString() == pin;
                    if (!m_controller || !m_controller->serverProfiles()
                        || m_controller->serverProfiles()->activeProfileId() != profile || m_brokerEpoch != startEpoch) {
                        if (m_packageStageProcess == process) m_packageStageProcess = nullptr;
                        m_packageStageStatus = QJsonObject{{QStringLiteral("state"), QStringLiteral("idle")}};
                        process->deleteLater();
                        return; // The old profile must not update a newly selected server profile.
                    }
                    m_packageStageStatus = QJsonObject{{QStringLiteral("state"), success ? QStringLiteral("staged_not_installed") : QStringLiteral("failed")},
                        {QStringLiteral("artifactSha256"), digest}, {QStringLiteral("packageKey"), key},
                        {QStringLiteral("version"), version}, {QStringLiteral("operationId"), operationId},
                        {QStringLiteral("message"), success
                            ? QStringLiteral("Retained ZIP independently verified and staged. No installation/deployment.")
                            : QStringLiteral("Native retained archive staging failed or timed out; inspect it before retrying.")}};
                    emit eventReady(QString::fromUtf8(QJsonDocument(QJsonObject{{QStringLiteral("schema"), 1},
                        {QStringLiteral("event"), QStringLiteral("package.staging.changed")},
                        {QStringLiteral("profileId"), profile}, {QStringLiteral("status"), m_packageStageStatus}}).toJson(QJsonDocument::Compact)));
                    if (m_packageStageProcess == process) m_packageStageProcess = nullptr;
                    process->deleteLater();
                });
            process->start();
            if (!process->waitForStarted(2500)) {
                m_packageStageProcess = nullptr;
                process->deleteLater();
                m_packageStageStatus = QJsonObject{{QStringLiteral("state"), QStringLiteral("failed")}};
                return fail(QStringLiteral("PACKAGE_STAGE_HELPER_FAILED"), QStringLiteral("Cannot launch independently pinned native staging helper."));
            }
            if (process->write(bytes) != bytes.size() || !process->waitForBytesWritten(5000)) {
                process->kill(); process->waitForFinished(1000);
                return fail(QStringLiteral("PACKAGE_STAGE_HANDOFF_FAILED"), QStringLiteral("Cannot deliver bounded signed metadata to native verification."));
            }
            process->closeWriteChannel();
            QTimer::singleShot(30000, process, [process] {
                if (process->state() != QProcess::NotRunning) process->kill();
            });
            return QJsonObject{{QStringLiteral("accepted"), true}, {QStringLiteral("operationId"), operationId}};
        }
        const bool diagnose = capability == QStringLiteral("package.transfer.diagnose");
        const bool recover = capability == QStringLiteral("package.transfer.recover");
        if (recover) {
            if (!consumeDialogBudget())
                return fail(QStringLiteral("RATE_LIMITED"), QStringLiteral("Too many transfer recovery prompts."));
            if (QMessageBox::question(nullptr, QStringLiteral("Recover native Package transfer"),
                QStringLiteral("Inspect and reconcile the retained native transfer for SHA-256 %1…?\n\n"
                               "The helper will verify the last published checkpoint and all retained bytes. "
                               "It may restore durable progress or finish an interrupted rename. "
                               "It will not delete archive bytes, clear a stranded process lock, "
                               "install software, or grant a new download lease.\n\n"
                               "Only proceed after the previous transfer helper is no longer running.")
                    .arg(digest.left(16)), QMessageBox::Yes | QMessageBox::No,
                    QMessageBox::No) != QMessageBox::Yes)
                return QJsonObject{{QStringLiteral("accepted"), false}};
            if (!m_controller || !m_controller->nativeSessionReady() || !m_controller->connectionOnline()
                || !m_controller->serverProfiles() || m_controller->serverProfiles()->activeProfileId() != profile)
                return fail(QStringLiteral("PACKAGE_SESSION_CHANGED"), QStringLiteral("Desktop session changed during recovery confirmation."));
        }
        const bool append = capability == QStringLiteral("package.transfer.append");
        const bool begin = capability == QStringLiteral("package.transfer.begin");
        const bool bind = capability == QStringLiteral("package.transfer.bindOffer");
        const QString action = begin ? QStringLiteral("transfer-begin")
            : append ? QStringLiteral("transfer-append")
            : bind ? QStringLiteral("transfer-bind")
            : recover ? QStringLiteral("transfer-recover")
            : diagnose ? QStringLiteral("transfer-diagnose")
            : capability == QStringLiteral("package.transfer.inspect") ? QStringLiteral("transfer-inspect")
            : capability == QStringLiteral("package.transfer.commit") ? QStringLiteral("transfer-commit") : QString();
        if (action.isEmpty())
            return fail(QStringLiteral("PACKAGE_TRANSFER_UNSUPPORTED"), QStringLiteral("Unsupported native transfer action."));
        const qint64 expected = payload.value(QStringLiteral("artifactSize")).toInteger(-1);
        const qint64 offset = payload.value(QStringLiteral("offset")).toInteger(-1);
        if (begin && (expected < 1 || expected > MaxDurableArchiveBytes))
            return fail(QStringLiteral("PACKAGE_TRANSFER_SIZE_INVALID"), QStringLiteral("Archive length is outside the native transfer budget."));
        const QByteArray encoded = append ? payload.value(QStringLiteral("chunkBase64")).toString().toLatin1() : QByteArray();
        const auto decoded = append
            ? QByteArray::fromBase64Encoding(encoded, QByteArray::AbortOnBase64DecodingErrors)
            : QByteArray::fromBase64Encoding(QByteArray(), QByteArray::AbortOnBase64DecodingErrors);
        if (append && (offset < 0 || encoded.isEmpty() || encoded.size() > MaxArchiveChunkBase64Bytes
            || !decoded || decoded.decoded.isEmpty() || decoded.decoded.size() > MaxArchiveChunkBytes
            || decoded.decoded.toBase64() != encoded))
            return fail(QStringLiteral("PACKAGE_TRANSFER_CHUNK_INVALID"), QStringLiteral("Archive chunk encoding, offset or size is invalid."));
        QStringList args{QStringLiteral("--action"), action, QStringLiteral("--root"), root,
            QStringLiteral("--transfer-sha256"), digest};
        if (bind) {
            static const QRegularExpression idPattern(QStringLiteral("^[A-Za-z0-9_-]{1,160}$"));
            const QString deploymentId = payload.value(QStringLiteral("deploymentId")).toString();
            const QString packageId = payload.value(QStringLiteral("packageId")).toString();
            const QString releaseId = payload.value(QStringLiteral("releaseId")).toString();
            const QString channel = payload.value(QStringLiteral("channel")).toString();
            const QString platform = payload.value(QStringLiteral("platform")).toString();
            if (!idPattern.match(deploymentId).hasMatch() || !idPattern.match(packageId).hasMatch()
                || !idPattern.match(releaseId).hasMatch()
                || (channel != QStringLiteral("stable") && channel != QStringLiteral("beta") && channel != QStringLiteral("testing"))
                || (platform != QStringLiteral("windows-x64") && platform != QStringLiteral("linux-x64") && platform != QStringLiteral("macos-arm64")))
                return fail(QStringLiteral("PACKAGE_TRANSFER_OFFER_INVALID"), QStringLiteral("Invalid nonsecret offer binding."));
            args << QStringLiteral("--transfer-offer-id") << deploymentId
                << QStringLiteral("--transfer-package-id") << packageId
                << QStringLiteral("--transfer-release-id") << releaseId
                << QStringLiteral("--transfer-channel") << channel
                << QStringLiteral("--transfer-platform") << platform;
        }
        if (begin) args << QStringLiteral("--transfer-size") << QString::number(expected);
        if (append) args << QStringLiteral("--transfer-offset") << QString::number(offset)
            << QStringLiteral("--transfer-chunk-size") << QString::number(decoded.decoded.size());
        QProcess process;
        process.start(helper.absoluteFilePath(), args);
        if (!process.waitForStarted(3000))
            return fail(QStringLiteral("PACKAGE_TRANSFER_HELPER_FAILED"), QStringLiteral("Cannot start native transfer verification."));
        if (append) {
            qint64 written = 0;
            while (written < decoded.decoded.size()) {
                const qint64 n = process.write(decoded.decoded.constData() + written, decoded.decoded.size() - written);
                if (n <= 0 || !process.waitForBytesWritten(5000)) {
                    process.kill(); process.waitForFinished(1000);
                    return fail(QStringLiteral("PACKAGE_TRANSFER_WRITE_FAILED"), QStringLiteral("Native archive chunk could not be written."));
                }
                written += n;
            }
        }
        process.closeWriteChannel();
        if (!process.waitForFinished(30000)) {
            process.kill(); process.waitForFinished(1000);
            return fail(QStringLiteral("PACKAGE_TRANSFER_TIMEOUT"), QStringLiteral("Native archive verification timed out; inspect the checkpoint."));
        }
        const QByteArray output = process.readAllStandardOutput().trimmed();
        if (diagnose) {
            const QByteArray prefix("CLUSTER_TRANSFER_DIAGNOSTIC ");
            const QJsonDocument parsed = output.startsWith(prefix) && output.size() < 8192
                ? QJsonDocument::fromJson(output.mid(prefix.size())) : QJsonDocument();
            const QJsonObject evidence = parsed.object();
            if (process.exitStatus() != QProcess::NormalExit || process.exitCode() != 0
                || !parsed.isObject() || evidence.value(QStringLiteral("schema")).toInt() != 1
                || evidence.value(QStringLiteral("digest")).toString() != digest
                || !evidence.value(QStringLiteral("readOnly")).toBool(false)
                || evidence.value(QStringLiteral("state")).toString().isEmpty())
                return fail(QStringLiteral("PACKAGE_TRANSFER_DIAGNOSIS_INVALID"), QStringLiteral("Native transport diagnosis could not be verified."));
            return evidence; // Bounded codes/counts only. No on-disk location, token or new capability.
        }
        const QByteArray prefix("CLUSTER_TRANSFER_CHECKPOINT ");
        const QJsonDocument parsed = output.startsWith(prefix) && output.size() < 8192
            ? QJsonDocument::fromJson(output.mid(prefix.size())) : QJsonDocument();
        const QJsonObject evidence = parsed.object();
        if (process.exitStatus() == QProcess::NormalExit && process.exitCode() == 3 && !append && !begin)
            return fail(QStringLiteral("PACKAGE_TRANSFER_NOT_FOUND"), QStringLiteral("No native checkpoint exists for this archive."));
        if (process.exitStatus() != QProcess::NormalExit || process.exitCode() != 0 || !parsed.isObject()
            || evidence.value(QStringLiteral("schema")).toInt() != 2 // Native transfer checkpoint v2; diagnostics retain schema 1.
            || evidence.value(QStringLiteral("digest")).toString() != digest
            || evidence.value(QStringLiteral("expectedBytes")).toInteger() < 1
            || evidence.value(QStringLiteral("expectedBytes")).toInteger() > MaxDurableArchiveBytes
            || evidence.value(QStringLiteral("receivedBytes")).toInteger(-1) < 0
            || evidence.value(QStringLiteral("receivedBytes")).toInteger() > evidence.value(QStringLiteral("expectedBytes")).toInteger()
            || (action == QStringLiteral("transfer-commit") && evidence.value(QStringLiteral("state")).toString() != QStringLiteral("committed"))
            || (recover && (evidence.value(QStringLiteral("recoveryAction")).toString().isEmpty()
                || evidence.value(QStringLiteral("recoveredBytes")).toInteger(-1) < 0))
            || (bind && (evidence.value(QStringLiteral("offer")).toObject().value(QStringLiteral("deploymentId")).toString() != payload.value(QStringLiteral("deploymentId")).toString()
                || evidence.value(QStringLiteral("offer")).toObject().value(QStringLiteral("packageId")).toString() != payload.value(QStringLiteral("packageId")).toString()
                || evidence.value(QStringLiteral("offer")).toObject().value(QStringLiteral("releaseId")).toString() != payload.value(QStringLiteral("releaseId")).toString())))
            return fail(QStringLiteral("PACKAGE_TRANSFER_UNSAFE"), QStringLiteral("Native transfer evidence is unavailable or invalid; manual inspection required."));
        // Checkpoint v2 contains serialized SHA-256 internal progress and disk
        // file timestamps for native crash recovery. Neither belongs in an
        // untrusted renderer response. Qt verifies the complete local helper
        // envelope first and then projects only the stable public contract.
        QJsonObject publicCheckpoint = evidence;
        publicCheckpoint.remove(QStringLiteral("hashState"));
        publicCheckpoint.remove(QStringLiteral("tailSha256"));
        publicCheckpoint.remove(QStringLiteral("payloadModTimeNano"));
        return publicCheckpoint; // No local path, hash internals, bearer or installer authority.
    }

    if (capability.startsWith(QStringLiteral("package.kit."))) {
        // Only the renderer attached to the authenticated Desktop origin can
        // stream an already-downloaded kit. Qt owns the private temp location.
        if (!m_controller || !m_controller->nativeSessionReady() || !m_controller->connectionOnline()
            || !m_controller->serverProfiles())
            return fail(QStringLiteral("NATIVE_SESSION_REQUIRED"), QStringLiteral("An authenticated Desktop session is required."));
        const QString profileId = m_controller->serverProfiles()->activeProfileId();
        static const QRegularExpression profilePattern(QStringLiteral("^[A-Za-z0-9_-]{8,80}$"));
        static const QRegularExpression shaPattern(QStringLiteral("^[a-f0-9]{64}$"));
        static const QRegularExpression keyPattern(QStringLiteral("^[a-z][a-z0-9-]{2,79}$"));
        static const QRegularExpression versionPattern(QStringLiteral("^[0-9]+\\.[0-9]+\\.[0-9]+(?:-[A-Za-z0-9.-]+)?$"));
        if (!profilePattern.match(profileId).hasMatch())
            return fail(QStringLiteral("PROFILE_INVALID"), QStringLiteral("Invalid active server profile."));
        if (capability == QStringLiteral("package.kit.begin")) {
            if (m_packageStageProcess) return fail(QStringLiteral("PACKAGE_STAGE_BUSY"), QStringLiteral("A Package operation is running."));
            const QString sha = payload.value(QStringLiteral("expectedArtifactSha256")).toString();
            const QString key = payload.value(QStringLiteral("expectedPackageKey")).toString();
            const QString version = payload.value(QStringLiteral("expectedVersion")).toString();
            const QString kitSha = payload.value(QStringLiteral("kitSha256")).toString();
            const qint64 size = payload.value(QStringLiteral("kitSizeBytes")).toInteger(-1);
            if (!shaPattern.match(sha).hasMatch() || !shaPattern.match(kitSha).hasMatch()
                || !keyPattern.match(key).hasMatch() || !versionPattern.match(version).hasMatch()
                || size < 1 || size > MaxPackageKitBytes)
                return fail(QStringLiteral("PACKAGE_KIT_INVALID"), QStringLiteral("Invalid bounded staging-kit identity or size."));
            if (m_packageIncomingKit) { delete m_packageIncomingKit; m_packageIncomingKit = nullptr; }
            const QString root = QDir::cleanPath(QStandardPaths::writableLocation(QStandardPaths::AppLocalDataLocation)
                + QStringLiteral("/package-kit-imports/") + profileId);
            if (!QDir().mkpath(root) || QFileInfo(root).isSymLink())
                return fail(QStringLiteral("PACKAGE_KIT_ROOT_UNSAFE"), QStringLiteral("Cannot create a private kit transfer root."));
            auto *incoming = new QTemporaryFile(root + QStringLiteral("/.package-XXXXXX"), this);
            incoming->setAutoRemove(true);
            if (!incoming->open() || !incoming->setPermissions(QFileDevice::ReadOwner | QFileDevice::WriteOwner)) {
                delete incoming;
                return fail(QStringLiteral("PACKAGE_KIT_TRANSFER_FAILED"), QStringLiteral("Cannot prepare the private kit transfer."));
            }
            m_packageIncomingKit = incoming;
            m_packageIncomingId = QUuid::createUuid().toString(QUuid::WithoutBraces);
            m_packageIncomingProfile = profileId;
            m_packageIncomingReleaseSha = sha; m_packageIncomingKey = key;
            m_packageIncomingVersion = version; m_packageIncomingKitSha = kitSha;
            m_packageIncomingExpectedBytes = size; m_packageIncomingReceivedBytes = 0;
            m_packageIncomingStartedAt = nowMs(); m_packageIncomingReady = false;
            const QString expiryId = m_packageIncomingId;
            QTimer::singleShot(MaxPackageKitAgeMs, this, [this, expiryId] {
                if (m_packageIncomingId == expiryId && m_packageIncomingKit && !m_packageStageProcess) {
                    delete m_packageIncomingKit; m_packageIncomingKit = nullptr;
                    m_packageIncomingReady = false; m_packageIncomingId.clear();
                }
            });
            return QJsonObject{{QStringLiteral("transferId"), m_packageIncomingId}, {QStringLiteral("accepted"), true}};
        }
        const QString id = payload.value(QStringLiteral("transferId")).toString();
        if (id.isEmpty() || id != m_packageIncomingId || !m_packageIncomingKit || m_packageIncomingProfile != profileId)
            return fail(QStringLiteral("PACKAGE_KIT_TRANSFER_MISSING"), QStringLiteral("Kit transfer is no longer active."));
        if (nowMs() - m_packageIncomingStartedAt > MaxPackageKitAgeMs) {
            delete m_packageIncomingKit; m_packageIncomingKit = nullptr; m_packageIncomingReady = false;
            return fail(QStringLiteral("PACKAGE_KIT_TRANSFER_EXPIRED"), QStringLiteral("Kit transfer expired."));
        }
        if (capability == QStringLiteral("package.kit.cancel")) {
            delete m_packageIncomingKit; m_packageIncomingKit = nullptr; m_packageIncomingReady = false;
            m_packageIncomingId.clear();
            return QJsonObject{{QStringLiteral("cancelled"), true}};
        }
        if (capability == QStringLiteral("package.kit.chunk")) {
            const qint64 offset = payload.value(QStringLiteral("offset")).toInteger(-1);
            const QByteArray encoded = payload.value(QStringLiteral("chunkBase64")).toString().toLatin1();
            if (m_packageIncomingReady || offset != m_packageIncomingReceivedBytes
                || encoded.size() < 1 || encoded.size() > 65536)
                return fail(QStringLiteral("PACKAGE_KIT_CHUNK_INVALID"), QStringLiteral("Out-of-order or oversized kit chunk."));
            const auto decoded = QByteArray::fromBase64Encoding(encoded, QByteArray::AbortOnBase64DecodingErrors);
            if (!decoded || decoded.decoded.isEmpty() || decoded.decoded.size() > 48 * 1024
                || decoded.decoded.toBase64() != encoded || m_packageIncomingReceivedBytes + decoded.decoded.size() > m_packageIncomingExpectedBytes)
                return fail(QStringLiteral("PACKAGE_KIT_CHUNK_INVALID"), QStringLiteral("Invalid bounded base64 kit chunk."));
            if (m_packageIncomingKit->write(decoded.decoded) != decoded.decoded.size())
                return fail(QStringLiteral("PACKAGE_KIT_TRANSFER_FAILED"), QStringLiteral("Could not write native kit chunk."));
            m_packageIncomingReceivedBytes += decoded.decoded.size();
            return QJsonObject{{QStringLiteral("receivedBytes"), m_packageIncomingReceivedBytes}};
        }
        if (capability == QStringLiteral("package.kit.finish")) {
            if (m_packageIncomingReady || m_packageIncomingReceivedBytes != m_packageIncomingExpectedBytes
                || !m_packageIncomingKit->flush())
                return fail(QStringLiteral("PACKAGE_KIT_INCOMPLETE"), QStringLiteral("Kit transfer is incomplete."));
            m_packageIncomingKit->seek(0);
            const QByteArray content = m_packageIncomingKit->readAll();
            const QString digest = QString::fromLatin1(QCryptographicHash::hash(content, QCryptographicHash::Sha256).toHex());
            if (content.size() != m_packageIncomingExpectedBytes || digest != m_packageIncomingKitSha) {
                delete m_packageIncomingKit; m_packageIncomingKit = nullptr; m_packageIncomingReady = false;
                return fail(QStringLiteral("PACKAGE_KIT_DIGEST_MISMATCH"), QStringLiteral("Transferred kit failed its full-byte checksum."));
            }
            m_packageIncomingKit->close();
            m_packageIncomingReady = true;
            return QJsonObject{{QStringLiteral("accepted"), true}, {QStringLiteral("kitSha256"), digest}};
        }
    }

    if (capability == QStringLiteral("package.msiProfileStatus")) {
        // Bounded, read-only evidence only. Never accepts target paths, flags,
        // grants, or a Package-selected identity supplied by renderer.
        if (!m_controller || !m_controller->nativeSessionReady() || !m_controller->serverProfiles())
            return fail(QStringLiteral("NATIVE_SESSION_REQUIRED"), QStringLiteral("Sign in to inspect MSI profile evidence."));
        const QString profileId = m_controller->serverProfiles()->activeProfileId();
        static const QRegularExpression profilePattern(QStringLiteral("^[A-Za-z0-9_-]{8,80}$"));
        if (!profilePattern.match(profileId).hasMatch())
            return fail(QStringLiteral("PACKAGE_TARGET_INVALID"), QStringLiteral("Invalid MSI profile identity."));
        const QFileInfo helper(QDir(QCoreApplication::applicationDirPath()).filePath(
#ifdef Q_OS_WIN
            QStringLiteral("cluster-package-stager.exe")
#else
            QStringLiteral("cluster-package-stager")
#endif
        ));
        if (!helper.isFile() || helper.isSymLink() || !helper.isExecutable())
            return fail(QStringLiteral("PACKAGE_HELPER_MISSING"), QStringLiteral("Native MSI evidence helper is missing."));
        const QString root = QDir::cleanPath(QStandardPaths::writableLocation(QStandardPaths::AppLocalDataLocation)
            + QStringLiteral("/package-staging/") + profileId);
        QProcess inspector;
        inspector.start(helper.absoluteFilePath(), {QStringLiteral("--action"), QStringLiteral("msi-profile-status"),
            QStringLiteral("--root"), root});
        if (!inspector.waitForStarted(1500) || !inspector.waitForFinished(8000)) {
            inspector.kill(); inspector.waitForFinished(1000);
            return fail(QStringLiteral("PACKAGE_MSI_EVIDENCE_UNAVAILABLE"), QStringLiteral("MSI profile inventory failed or timed out."));
        }
        const QByteArray prefix("CLUSTER_MSI_PROFILE_STATUS ");
        const QByteArray output = inspector.readAllStandardOutput().trimmed();
        if (inspector.exitStatus() != QProcess::NormalExit || inspector.exitCode() != 0
            || !output.startsWith(prefix) || output.size() > 768 * 1024)
            return fail(QStringLiteral("PACKAGE_MSI_EVIDENCE_UNSAFE"), QStringLiteral("Local MSI inventory is incomplete or inaccessible."));
        const QJsonDocument parsed = QJsonDocument::fromJson(output.mid(prefix.size()));
        const QJsonObject value = parsed.object();
        const QJsonArray records = value.value(QStringLiteral("records")).toArray();
        const QJsonArray lifecycleRecords = value.value(QStringLiteral("lifecycleRecords")).toArray();
        const QString state = value.value(QStringLiteral("state")).toString();
        const bool globalLock = value.value(QStringLiteral("admissionLockPresent")).toBool(false);
        const bool manual = value.value(QStringLiteral("manualReviewRequired")).toBool(false);
        const bool validSummary = parsed.isObject() && value.value(QStringLiteral("schema")).toInt(-1) == 1
            && value.value(QStringLiteral("readOnly")).isBool() && value.value(QStringLiteral("readOnly")).toBool(false)
            && value.value(QStringLiteral("osAttested")).isBool() && !value.value(QStringLiteral("osAttested")).toBool(true)
            && value.value(QStringLiteral("retryAuthorized")).isBool() && !value.value(QStringLiteral("retryAuthorized")).toBool(true)
            && value.value(QStringLiteral("complete")).isBool() && value.value(QStringLiteral("complete")).toBool(false)
            && value.value(QStringLiteral("admissionLockPresent")).isBool()
            && value.value(QStringLiteral("manualReviewRequired")).isBool()
            && value.value(QStringLiteral("records")).isArray() && records.size() <= 64
            && value.value(QStringLiteral("lifecycleRecords")).isArray() && lifecycleRecords.size() <= 64
            && validNativeMSIProfileEdges(value)
            && validNativeMSILifecyclePlans(value)
            && ((globalLock || !records.isEmpty() || !lifecycleRecords.isEmpty()) == manual)
            && state == (manual ? QStringLiteral("msi_profile_manual_review") : QStringLiteral("no_recorded_msi_attempts"));
        static const QRegularExpression keyPattern(QStringLiteral("^[a-z][a-z0-9-]{2,79}$"));
        QString lastKey;
        bool validRecords = true;
        for (const QJsonValue recordValue : records) {
            const QJsonObject record = recordValue.toObject();
            const QString key = record.value(QStringLiteral("packageKey")).toString();
            const bool hasReceipt = record.value(QStringLiteral("hasReceipt")).toBool(false);
            const bool hasLock = record.value(QStringLiteral("lockPresent")).toBool(false);
            const QString recordState = record.value(QStringLiteral("state")).toString();
            const bool known = recordState == QStringLiteral("interrupted_or_active_without_receipt")
                || recordState == QStringLiteral("msi_prepared_not_launched")
                || recordState == QStringLiteral("msi_started_outcome_unknown")
                || recordState == QStringLiteral("msi_failed_or_outcome_unknown")
                || recordState == QStringLiteral("msi_exit_zero_not_os_attested")
                || recordState == QStringLiteral("msi_restart_required_not_os_attested");
            if (!recordValue.isObject() || !keyPattern.match(key).hasMatch() || (!lastKey.isEmpty() && key <= lastKey)
                || !record.value(QStringLiteral("hasReceipt")).isBool() || !record.value(QStringLiteral("lockPresent")).isBool()
                || !record.value(QStringLiteral("admissionLockPresent")).isBool()
                || record.value(QStringLiteral("admissionLockPresent")).toBool() != globalLock
                || !record.value(QStringLiteral("manualReviewRequired")).isBool()
                || !record.value(QStringLiteral("manualReviewRequired")).toBool()
                || !record.value(QStringLiteral("readOnly")).isBool() || !record.value(QStringLiteral("readOnly")).toBool()
                || !record.value(QStringLiteral("retryAuthorized")).isBool() || record.value(QStringLiteral("retryAuthorized")).toBool()
                || !record.value(QStringLiteral("osAttested")).isBool() || record.value(QStringLiteral("osAttested")).toBool()
                || !validNativeMSIBootObservation(record.value(QStringLiteral("bootObservation")), hasReceipt)
                || !validNativeMSIRegistrationTransition(record)
                || !validNativeMSIAttemptReceiptEnvelope(record)
                || (hasReceipt && !validNativeMSIBootAnchor(record.value(QStringLiteral("attempt")).toObject().value(QStringLiteral("bootAnchor"))))
                || (hasReceipt && record.value(QStringLiteral("bootObservation")).toObject().value(QStringLiteral("anchorRecorded")).toBool()
                    != record.value(QStringLiteral("attempt")).toObject().value(QStringLiteral("bootAnchor")).isObject())
                || !known || (!hasReceipt && recordState != QStringLiteral("interrupted_or_active_without_receipt"))
                || (hasReceipt && recordState == QStringLiteral("interrupted_or_active_without_receipt"))
                || (!hasReceipt && !hasLock) || (globalLock && !hasLock)) {
                validRecords = false;
                break;
            }
            lastKey = key;
        }
        bool validLifecycleRecords = true;
        QString lastLifecycleKey;
        QJsonObject pendingRollback;
        QString pendingRollbackKey;
        static const QRegularExpression lifecycleSha(QStringLiteral("^[a-f0-9]{64}$"));
        static const QRegularExpression lifecycleCode(QStringLiteral("^\\{[0-9A-F]{8}-(?:[0-9A-F]{4}-){3}[0-9A-F]{12}\\}$"));
        for (const QJsonValue &item : lifecycleRecords) {
            const QJsonObject status = item.toObject();
            const QJsonObject receipt = status.value(QStringLiteral("receipt")).toObject();
            const QString key = status.value(QStringLiteral("packageKey")).toString();
            const QString op = receipt.value(QStringLiteral("operation")).toString();
            const QString state = status.value(QStringLiteral("state")).toString();
            const QString suffix = state.mid(op.length() + 1);
            if (!item.isObject() || !keyPattern.match(key).hasMatch()
                || (!lastLifecycleKey.isEmpty() && (key < lastLifecycleKey || (key == lastLifecycleKey && op != QStringLiteral("upgrade"))))
                || (op != QStringLiteral("repair") && op != QStringLiteral("uninstall") && op != QStringLiteral("upgrade") && op != QStringLiteral("msi-rollback"))
                || !state.startsWith(op + QStringLiteral("_"))
                || (suffix != QStringLiteral("prepared_not_launched") && suffix != QStringLiteral("started_outcome_unknown")
                    && suffix != QStringLiteral("failed_or_outcome_unknown") && suffix != QStringLiteral("exit_zero_not_os_attested")
                    && suffix != QStringLiteral("restart_required_not_os_attested"))
                || receipt.value(QStringLiteral("schema")).toInt() != 1 || status.value(QStringLiteral("schema")).toInt() != 1
                || receipt.value(QStringLiteral("packageKey")).toString() != key || receipt.value(QStringLiteral("state")).toString() != state
                || !status.value(QStringLiteral("hasReceipt")).isBool() || !status.value(QStringLiteral("hasReceipt")).toBool()
                || !status.value(QStringLiteral("manualReviewRequired")).isBool() || !status.value(QStringLiteral("manualReviewRequired")).toBool()
                || !status.value(QStringLiteral("readOnly")).isBool() || !status.value(QStringLiteral("readOnly")).toBool()
                || !status.value(QStringLiteral("osAttested")).isBool() || status.value(QStringLiteral("osAttested")).toBool()
                || !status.value(QStringLiteral("retryAuthorized")).isBool() || status.value(QStringLiteral("retryAuthorized")).toBool()
                || !receipt.value(QStringLiteral("osAttested")).isBool() || receipt.value(QStringLiteral("osAttested")).toBool()
                || !lifecycleSha.match(status.value(QStringLiteral("receiptSha256")).toString()).hasMatch()
                || !lifecycleSha.match(receipt.value(QStringLiteral("priorReceiptSha256")).toString()).hasMatch()
                || !lifecycleSha.match(receipt.value(QStringLiteral("artifactSha256")).toString()).hasMatch()
                || !lifecycleSha.match(receipt.value(QStringLiteral("msiSha256")).toString()).hasMatch()
                || !lifecycleCode.match(receipt.value(QStringLiteral("productCode")).toString()).hasMatch()
                || (op == QStringLiteral("upgrade") && (!lifecycleSha.match(receipt.value(QStringLiteral("priorMsiSha256")).toString()).hasMatch()
                    || receipt.value(QStringLiteral("priorProductVersion")).toString().isEmpty()
                    || receipt.value(QStringLiteral("priorProductVersion")) == receipt.value(QStringLiteral("productVersion"))))
                || (op == QStringLiteral("msi-rollback") && (!lifecycleSha.match(receipt.value(QStringLiteral("priorMsiSha256")).toString()).hasMatch()
                    || !lifecycleSha.match(receipt.value(QStringLiteral("successorMsiSha256")).toString()).hasMatch()
                    || !lifecycleSha.match(receipt.value(QStringLiteral("upgradeJournalSha256")).toString()).hasMatch()
                    || receipt.value(QStringLiteral("priorProductVersion")).toString().isEmpty()
                    || receipt.value(QStringLiteral("priorProductVersion")) == receipt.value(QStringLiteral("productVersion"))
                    || !receipt.value(QStringLiteral("msiPath")).isString()
                    || receipt.value(QStringLiteral("msiSha256")) != receipt.value(QStringLiteral("priorMsiSha256"))
                    || receipt.value(QStringLiteral("msiSha256")) == receipt.value(QStringLiteral("successorMsiSha256"))))
                || (op != QStringLiteral("upgrade") && op != QStringLiteral("msi-rollback") && (receipt.contains(QStringLiteral("priorMsiSha256")) || receipt.contains(QStringLiteral("priorProductVersion"))))
                || (op != QStringLiteral("msi-rollback") && (receipt.contains(QStringLiteral("successorMsiSha256")) || receipt.contains(QStringLiteral("upgradeJournalSha256"))))
                || !validNativeMSIUpgradeRecovery(status) || !validNativeMSIRollbackRecovery(status)) {
                validLifecycleRecords = false; break;
            }
            if (op == QStringLiteral("msi-rollback")) {
                pendingRollback = status;
                pendingRollbackKey = key;
            } else if (!pendingRollback.isEmpty()) {
                const QJsonObject rollback = pendingRollback.value(QStringLiteral("receipt")).toObject();
                if (key != pendingRollbackKey || op != QStringLiteral("upgrade")
                    || rollback.value(QStringLiteral("upgradeJournalSha256")).toString() != status.value(QStringLiteral("receiptSha256")).toString()
                    || rollback.value(QStringLiteral("priorMsiSha256")) != receipt.value(QStringLiteral("priorMsiSha256"))
                    || rollback.value(QStringLiteral("successorMsiSha256")) != receipt.value(QStringLiteral("msiSha256"))
                    || rollback.value(QStringLiteral("priorReceiptSha256")) != receipt.value(QStringLiteral("priorReceiptSha256"))
                    || rollback.value(QStringLiteral("productVersion")) != receipt.value(QStringLiteral("priorProductVersion"))
                    || rollback.value(QStringLiteral("priorProductVersion")) != receipt.value(QStringLiteral("productVersion"))) {
                    validLifecycleRecords = false; break;
                }
                pendingRollback = QJsonObject();
                pendingRollbackKey.clear();
            }
            lastLifecycleKey = key;
        }
        if (!pendingRollback.isEmpty()) validLifecycleRecords = false;
        if (!validSummary || !validRecords || !validLifecycleRecords)
            return fail(QStringLiteral("PACKAGE_MSI_EVIDENCE_UNSAFE"), QStringLiteral("Native MSI profile inventory is inconsistent."));
        return value;
    }

    if (capability == QStringLiteral("package.msiIncidentWorklist")) {
        // An authenticated, read-only projection, NOT a remediation queue.
        // Only the locally owned profile root is sent to the native helper.
        if (!m_controller || !m_controller->nativeSessionReady() || !m_controller->serverProfiles())
            return fail(QStringLiteral("NATIVE_SESSION_REQUIRED"), QStringLiteral("Sign in to inspect MSI incidents."));
        const QString profileId = m_controller->serverProfiles()->activeProfileId();
        static const QRegularExpression profilePattern(QStringLiteral("^[A-Za-z0-9_-]{8,80}$"));
        static const QRegularExpression keyPattern(QStringLiteral("^[a-z][a-z0-9-]{2,79}$"));
        static const QRegularExpression shaPattern(QStringLiteral("^[a-f0-9]{64}$"));
        if (!profilePattern.match(profileId).hasMatch())
            return fail(QStringLiteral("PACKAGE_PROFILE_INVALID"), QStringLiteral("Invalid MSI incident profile."));
        const QFileInfo helper(QDir(QCoreApplication::applicationDirPath()).filePath(
#ifdef Q_OS_WIN
            QStringLiteral("cluster-package-stager.exe")
#else
            QStringLiteral("cluster-package-stager")
#endif
        ));
        if (!helper.isFile() || helper.isSymLink() || !helper.isExecutable())
            return fail(QStringLiteral("PACKAGE_HELPER_MISSING"), QStringLiteral("Native Package helper unavailable."));
        const QString root = QDir::cleanPath(QStandardPaths::writableLocation(QStandardPaths::AppLocalDataLocation)
            + QStringLiteral("/package-staging/") + profileId);
        QProcess inspection;
        inspection.start(helper.absoluteFilePath(), {QStringLiteral("--action"), QStringLiteral("msi-incident-worklist"),
            QStringLiteral("--root"), root});
        if (!inspection.waitForStarted(1500) || !inspection.waitForFinished(7000)) {
            inspection.kill(); inspection.waitForFinished(1000);
            return fail(QStringLiteral("PACKAGE_INCIDENT_UNAVAILABLE"), QStringLiteral("MSI incident inspection timed out."));
        }
        const QByteArray response = inspection.readAllStandardOutput().trimmed();
        const QByteArray prefix("CLUSTER_MSI_INCIDENT_WORKLIST ");
        if (inspection.exitStatus() != QProcess::NormalExit || inspection.exitCode() != 0 ||
            response.size() > 128*1024 || !response.startsWith(prefix))
            return fail(QStringLiteral("PACKAGE_INCIDENT_UNSAFE"), QStringLiteral("Native MSI incident inventory refused."));
        const QJsonDocument doc = QJsonDocument::fromJson(response.mid(prefix.size()));
        const QJsonObject result = doc.object();
        const QJsonArray cases = result.value(QStringLiteral("items")).toArray();
        const QString state = result.value(QStringLiteral("state")).toString();
        if (!doc.isObject() || result.value(QStringLiteral("schema")).toInt() != 1 ||
            !result.value(QStringLiteral("readOnly")).isBool() || !result.value(QStringLiteral("readOnly")).toBool() ||
            !result.value(QStringLiteral("complete")).isBool() || !result.value(QStringLiteral("complete")).toBool() ||
            !result.value(QStringLiteral("osAttested")).isBool() || result.value(QStringLiteral("osAttested")).toBool(true) ||
            !result.value(QStringLiteral("mutationAuthorized")).isBool() || result.value(QStringLiteral("mutationAuthorized")).toBool(true) ||
            !result.value(QStringLiteral("retryAuthorized")).isBool() || result.value(QStringLiteral("retryAuthorized")).toBool(true) ||
            !result.value(QStringLiteral("admissionLockPresent")).isBool() ||
            !result.value(QStringLiteral("items")).isArray() || cases.size() > 128 ||
            !result.value(QStringLiteral("manualRecoveryCount")).isDouble() ||
            !result.value(QStringLiteral("reviewCount")).isDouble() ||
            !result.value(QStringLiteral("observationCount")).isDouble())
            return fail(QStringLiteral("PACKAGE_INCIDENT_UNSAFE"), QStringLiteral("Invalid MSI incident summary."));
        int manual = 0, review = 0, observation = 0;
        QString previous;
        for (const QJsonValue &entry : cases) {
            if (!entry.isObject())
                return fail(QStringLiteral("PACKAGE_INCIDENT_UNSAFE"), QStringLiteral("Malformed MSI incident entry."));
            const QJsonObject item = entry.toObject();
            const QString id = item.value(QStringLiteral("caseId")).toString();
            const QString key = item.value(QStringLiteral("packageKey")).toString();
            const QString op = item.value(QStringLiteral("operation")).toString();
            const QString severity = item.value(QStringLiteral("severity")).toString();
            const QString digest = item.value(QStringLiteral("receiptSha256")).toString();
            const QString prior = item.value(QStringLiteral("priorReceiptSha256")).toString();
            const bool predecessorRecorded = item.value(QStringLiteral("predecessorRecorded")).toBool();
            const bool predecessorMatches = item.value(QStringLiteral("predecessorMatches")).toBool();
            if (!keyPattern.match(key).hasMatch() || id <= previous || !item.value(QStringLiteral("caseId")).isString() ||
                !item.value(QStringLiteral("state")).isString() || item.value(QStringLiteral("state")).toString().isEmpty() ||
                !item.value(QStringLiteral("registrationState")).isString() ||
                !item.value(QStringLiteral("receiptSha256")).isString() ||
                !item.value(QStringLiteral("priorReceiptSha256")).isString() ||
                !QSet<QString>{QStringLiteral("unavailable"),QStringLiteral("os_query_unavailable"),
                    QStringLiteral("not_registered_for_user"),QStringLiteral("registered_version_match"),
                    QStringLiteral("registered_version_mismatch"),QStringLiteral("registered_version_unavailable"),
                    QStringLiteral("advertised_not_verified"),QStringLiteral("registration_incomplete_or_unknown")
                }.contains(item.value(QStringLiteral("registrationState")).toString()) ||
                !item.value(QStringLiteral("readOnly")).isBool() || !item.value(QStringLiteral("readOnly")).toBool() ||
                !item.value(QStringLiteral("retryAuthorized")).isBool() || item.value(QStringLiteral("retryAuthorized")).toBool(true) ||
                !item.value(QStringLiteral("mutationAuthorized")).isBool() || item.value(QStringLiteral("mutationAuthorized")).toBool(true) ||
                !item.value(QStringLiteral("osAttested")).isBool() || item.value(QStringLiteral("osAttested")).toBool(true) ||
                !item.value(QStringLiteral("predecessorRecorded")).isBool() || !item.value(QStringLiteral("predecessorMatches")).isBool() ||
                (predecessorMatches && !predecessorRecorded))
                return fail(QStringLiteral("PACKAGE_INCIDENT_UNSAFE"), QStringLiteral("Unsafe MSI incident identity or authority."));
            if (op == QStringLiteral("install")) {
                if (id != QStringLiteral("attempt:")+key || !prior.isEmpty() || predecessorRecorded || predecessorMatches ||
                    (!digest.isEmpty() && !shaPattern.match(digest).hasMatch()) ||
                    (severity != QStringLiteral("review") && severity != QStringLiteral("manual_recovery")) ||
                    item.value(QStringLiteral("recoveryAction")).toString() !=
                        (severity == QStringLiteral("review") ? QStringLiteral("review_unattested_installation") : QStringLiteral("investigate_install_attempt_no_replay")))
                    return fail(QStringLiteral("PACKAGE_INCIDENT_UNSAFE"), QStringLiteral("Invalid installation incident."));
            } else if (op == QStringLiteral("repair") || op == QStringLiteral("uninstall") ||
                       op == QStringLiteral("upgrade") || op == QStringLiteral("msi-rollback")) {
                if (id != QStringLiteral("lifecycle:")+key+QStringLiteral(":")+op || !shaPattern.match(digest).hasMatch() ||
                    !shaPattern.match(prior).hasMatch() || severity != QStringLiteral("manual_recovery") ||
                    item.value(QStringLiteral("recoveryAction")).toString() != (predecessorMatches ?
                    QStringLiteral("manual_lifecycle_review_no_replay") : QStringLiteral("investigate_missing_or_changed_predecessor")))
                    return fail(QStringLiteral("PACKAGE_INCIDENT_UNSAFE"), QStringLiteral("Invalid lifecycle incident."));
            } else return fail(QStringLiteral("PACKAGE_INCIDENT_UNSAFE"), QStringLiteral("Unknown MSI incident operation."));
            if (severity == QStringLiteral("manual_recovery")) ++manual;
            else if (severity == QStringLiteral("review")) ++review;
            else ++observation;
            previous = id;
        }
        const QString expected = manual > 0 || result.value(QStringLiteral("admissionLockPresent")).toBool() ?
            QStringLiteral("manual_recovery_required") : review > 0 ? QStringLiteral("review_required") : QStringLiteral("empty");
        if (state != expected || result.value(QStringLiteral("manualRecoveryCount")).toInt(-1) != manual ||
            result.value(QStringLiteral("reviewCount")).toInt(-1) != review ||
            result.value(QStringLiteral("observationCount")).toInt(-1) != observation)
            return fail(QStringLiteral("PACKAGE_INCIDENT_UNSAFE"), QStringLiteral("MSI incident totals contradict the evidence."));
        return result;
    }

    if (capability == QStringLiteral("package.msiRollbackCascade")) {
        // An operator-only projection of bounded native receipt evidence.
        // No renderer paths, grants or supplied dependency graph are accepted.
        if (!m_controller || !m_controller->nativeSessionReady() || !m_controller->serverProfiles())
            return fail(QStringLiteral("NATIVE_SESSION_REQUIRED"), QStringLiteral("Sign in before reviewing MSI recovery order."));
        const QString profileId = m_controller->serverProfiles()->activeProfileId();
        const QString key = payload.value(QStringLiteral("packageKey")).toString();
        static const QRegularExpression profilePattern(QStringLiteral("^[A-Za-z0-9_-]{8,80}$"));
        static const QRegularExpression keyPattern(QStringLiteral("^[a-z][a-z0-9-]{2,79}$"));
        static const QRegularExpression shaPattern(QStringLiteral("^[a-f0-9]{64}$"));
        if (!profilePattern.match(profileId).hasMatch() || !keyPattern.match(key).hasMatch())
            return fail(QStringLiteral("PACKAGE_TARGET_INVALID"), QStringLiteral("Invalid rollback workflow target."));
        const QFileInfo helper(QDir(QCoreApplication::applicationDirPath()).filePath(
#ifdef Q_OS_WIN
            QStringLiteral("cluster-package-stager.exe")
#else
            QStringLiteral("cluster-package-stager")
#endif
        ));
        if (!helper.isFile() || helper.isSymLink() || !helper.isExecutable())
            return fail(QStringLiteral("PACKAGE_HELPER_MISSING"), QStringLiteral("Package helper unavailable."));
        const QString root = QDir::cleanPath(QStandardPaths::writableLocation(QStandardPaths::AppLocalDataLocation)
            + QStringLiteral("/package-staging/") + profileId);
        QProcess inspection;
        inspection.start(helper.absoluteFilePath(), {QStringLiteral("--action"), QStringLiteral("msi-rollback-cascade"),
            QStringLiteral("--root"), root, QStringLiteral("--package-key"), key});
        if (!inspection.waitForStarted(1500) || !inspection.waitForFinished(7000)) {
            inspection.kill(); inspection.waitForFinished(1000);
            return fail(QStringLiteral("PACKAGE_CASCADE_UNAVAILABLE"), QStringLiteral("MSI recovery workflow inspection timed out."));
        }
        const QByteArray response = inspection.readAllStandardOutput().trimmed();
        const QByteArray prefix("CLUSTER_MSI_ROLLBACK_CASCADE ");
        if (inspection.exitStatus() != QProcess::NormalExit || inspection.exitCode() != 0 ||
            response.size() > 64*1024 || !response.startsWith(prefix))
            return fail(QStringLiteral("PACKAGE_CASCADE_UNSAFE"), QStringLiteral("Native recovery workflow refused."));
        const QJsonDocument doc = QJsonDocument::fromJson(response.mid(prefix.size()));
        const QJsonObject result = doc.object();
        const QString state = result.value(QStringLiteral("state")).toString();
        const bool isBlocked = state == QStringLiteral("blocked");
        if (!doc.isObject() || result.value(QStringLiteral("schema")).toInt() != 1 ||
            result.value(QStringLiteral("packageKey")).toString() != key ||
            (!isBlocked && state != QStringLiteral("independent_dispositions_required")) ||
            !result.value(QStringLiteral("readOnly")).isBool() || !result.value(QStringLiteral("readOnly")).toBool() ||
            !result.value(QStringLiteral("osAttested")).isBool() || result.value(QStringLiteral("osAttested")).toBool(true) ||
            !result.value(QStringLiteral("mutationAuthorized")).isBool() || result.value(QStringLiteral("mutationAuthorized")).toBool(true) ||
            !result.value(QStringLiteral("automaticExecution")).isBool() || result.value(QStringLiteral("automaticExecution")).toBool(true) ||
            !shaPattern.match(result.value(QStringLiteral("priorReceiptSha256")).toString()).hasMatch() ||
            !shaPattern.match(result.value(QStringLiteral("upgradeJournalSha256")).toString()).hasMatch() ||
            !result.value(QStringLiteral("recoveryOrder")).isArray() || !result.value(QStringLiteral("steps")).isArray() ||
            !result.value(QStringLiteral("blockers")).isArray() || !result.value(QStringLiteral("warnings")).isArray() ||
            !result.value(QStringLiteral("manualReviewPackages")).isArray() ||
            !result.value(QStringLiteral("manualRecoveryRequired")).isBool() ||
            !result.value(QStringLiteral("nextReviewablePackageKey")).isString())
            return fail(QStringLiteral("PACKAGE_CASCADE_UNSAFE"), QStringLiteral("Invalid recovery workflow contract."));
        const QJsonArray order = result.value(QStringLiteral("recoveryOrder")).toArray();
        const QJsonArray steps = result.value(QStringLiteral("steps")).toArray();
        const QJsonArray blockers = result.value(QStringLiteral("blockers")).toArray();
        const QJsonArray warnings = result.value(QStringLiteral("warnings")).toArray();
        const QJsonArray manualPackages = result.value(QStringLiteral("manualReviewPackages")).toArray();
        const QString nextReviewable = result.value(QStringLiteral("nextReviewablePackageKey")).toString();
        if (order.isEmpty() || order.size() > 64 || order.size() != steps.size() ||
            order.last().toString() != key || warnings.size() < 3 || warnings.size() > 12)
            return fail(QStringLiteral("PACKAGE_CASCADE_UNSAFE"), QStringLiteral("Invalid MSI recovery order length."));
        QSet<QString> seen;
        int blockedSteps = 0;
        bool allPriorSettled = true;
        QJsonArray expectedManualPackages;
        QString expectedNextReviewable;
        for (int i = 0; i < steps.size(); ++i) {
            const QString current = order.at(i).toString();
            const QJsonObject step = steps.at(i).toObject();
            const QJsonArray waits = step.value(QStringLiteral("waitingFor")).toArray();
            const QJsonArray reasons = step.value(QStringLiteral("blockers")).toArray();
            const QString stepState = step.value(QStringLiteral("state")).toString();
            const bool blocked = !reasons.isEmpty();
            const bool disposed = step.value(QStringLiteral("dispositionObserved")).toBool();
            const QString journalSha = step.value(QStringLiteral("lifecycleJournalSha256")).toString();
            const QString journalState = step.value(QStringLiteral("lifecycleJournalState")).toString();
            static const QSet<QString> allowedUninstallStates{
                QStringLiteral("uninstall_prepared_not_launched"), QStringLiteral("uninstall_started_outcome_unknown"),
                QStringLiteral("uninstall_failed_or_outcome_unknown"), QStringLiteral("uninstall_exit_zero_not_os_attested"),
                QStringLiteral("uninstall_restart_required_not_os_attested")};
            if (!step.value(QStringLiteral("lifecycleJournalSha256")).isString() ||
                !step.value(QStringLiteral("lifecycleJournalState")).isString() ||
                (journalSha.isEmpty() ? journalState != QStringLiteral("not_recorded") :
                    !shaPattern.match(journalSha).hasMatch() || !allowedUninstallStates.contains(journalState)) ||
                (i == steps.size()-1 && !journalSha.isEmpty()) ||
                (disposed && journalState != QStringLiteral("uninstall_exit_zero_not_os_attested")) ||
                (!journalSha.isEmpty() && !disposed && !reasons.contains(QStringLiteral("dependent_lifecycle_outcome_unconfirmed"))))
                return fail(QStringLiteral("PACKAGE_CASCADE_UNSAFE"), QStringLiteral("Recovery journal evidence is inconsistent."));
            const QString expectedState = disposed ? QStringLiteral("observed_uninstall_registration_absent") :
                blocked ? QStringLiteral("blocked") : allPriorSettled ? QStringLiteral("independent_operator_review_required") :
                QStringLiteral("awaiting_prior_dispositions");
            const QString action = disposed ? QStringLiteral("preserve_completed_disposition") :
                blocked ? (journalSha.isEmpty() ? QStringLiteral("resolve_evidence_blocker") : QStringLiteral("manual_recovery_no_replay")) :
                allPriorSettled ? QStringLiteral("request_independent_authorization") : QStringLiteral("wait_for_independent_dispositions");
            if (step.value(QStringLiteral("recoveryAction")).toString() != action ||
                !step.value(QStringLiteral("recoveryAction")).isString())
                return fail(QStringLiteral("PACKAGE_CASCADE_UNSAFE"), QStringLiteral("Recovery action conflicts with journal evidence."));
            if (!journalSha.isEmpty() && !disposed) expectedManualPackages.append(current);
            if (expectedState == QStringLiteral("independent_operator_review_required")) {
                if (!expectedNextReviewable.isEmpty())
                    return fail(QStringLiteral("PACKAGE_CASCADE_UNSAFE"), QStringLiteral("Multiple reviewable operations in recovery sequence."));
                expectedNextReviewable = current;
            }
            if (!keyPattern.match(current).hasMatch() || seen.contains(current) || !steps.at(i).isObject() ||
                step.value(QStringLiteral("index")).toInt(-1) != i || step.value(QStringLiteral("packageKey")).toString() != current ||
                step.value(QStringLiteral("operation")).toString() != (i == steps.size()-1 ? QStringLiteral("msi-rollback") : QStringLiteral("uninstall")) ||
                !shaPattern.match(step.value(QStringLiteral("recordedReceiptSha256")).toString()).hasMatch() ||
                !step.value(QStringLiteral("separateAuthorizationRequired")).isBool() || !step.value(QStringLiteral("separateAuthorizationRequired")).toBool() ||
                !step.value(QStringLiteral("mutationAuthorized")).isBool() || step.value(QStringLiteral("mutationAuthorized")).toBool(true) ||
                !step.value(QStringLiteral("waitingFor")).isArray() || waits.size() != i || !step.value(QStringLiteral("blockers")).isArray() ||
                !step.value(QStringLiteral("dispositionObserved")).isBool() || (disposed && (i == steps.size()-1 || blocked)) ||
                stepState != expectedState)
                return fail(QStringLiteral("PACKAGE_CASCADE_UNSAFE"), QStringLiteral("MSI recovery step is inconsistent."));
            for (int j = 0; j < waits.size(); ++j)
                if (!waits.at(j).isString() || waits.at(j).toString() != order.at(j).toString())
                    return fail(QStringLiteral("PACKAGE_CASCADE_UNSAFE"), QStringLiteral("Recovery dependencies were reordered."));
            for (const auto &reason : reasons)
                if (!reason.isString() || reason.toString().isEmpty())
                    return fail(QStringLiteral("PACKAGE_CASCADE_UNSAFE"), QStringLiteral("Recovery blocker invalid."));
            if (blocked) {
                if (blockedSteps >= blockers.size() || blockers.at(blockedSteps).toString() != current + QStringLiteral(":review_blocked"))
                    return fail(QStringLiteral("PACKAGE_CASCADE_UNSAFE"), QStringLiteral("Recovery blockers inconsistent."));
                ++blockedSteps;
            }
            seen.insert(current);
            if (i < steps.size()-1 && !disposed) allPriorSettled = false;
        }
        for (const auto &warning : warnings)
            if (!warning.isString() || warning.toString().isEmpty())
                return fail(QStringLiteral("PACKAGE_CASCADE_UNSAFE"), QStringLiteral("Invalid recovery caveat."));
        if (blockedSteps != blockers.size() || (blockedSteps != 0) != isBlocked ||
            expectedManualPackages != manualPackages ||
            result.value(QStringLiteral("manualRecoveryRequired")).toBool() != !expectedManualPackages.isEmpty() ||
            expectedNextReviewable != nextReviewable)
            return fail(QStringLiteral("PACKAGE_CASCADE_UNSAFE"), QStringLiteral("MSI recovery incident summary inconsistent."));
        return result;
    }

    if (capability == QStringLiteral("package.msiRollbackReview")) {
        // Read-only, authenticated private-root review. Never accept caller
        // supplied paths, grant bytes, shell arguments or lifecycle overrides.
        if (!m_controller || !m_controller->nativeSessionReady() || !m_controller->serverProfiles())
            return fail(QStringLiteral("NATIVE_SESSION_REQUIRED"), QStringLiteral("Sign in before inspecting MSI rollback evidence."));
        const QString profileId = m_controller->serverProfiles()->activeProfileId();
        const QString key = payload.value(QStringLiteral("packageKey")).toString();
        static const QRegularExpression profilePattern(QStringLiteral("^[A-Za-z0-9_-]{8,80}$"));
        static const QRegularExpression keyPattern(QStringLiteral("^[a-z][a-z0-9-]{2,79}$"));
        static const QRegularExpression shaPattern(QStringLiteral("^[a-f0-9]{64}$"));
        static const QRegularExpression versionPattern(QStringLiteral("^[0-9]{1,5}\\.[0-9]{1,5}\\.[0-9]{1,5}$"));
        if (!profilePattern.match(profileId).hasMatch() || !keyPattern.match(key).hasMatch())
            return fail(QStringLiteral("PACKAGE_TARGET_INVALID"), QStringLiteral("Invalid rollback review identity."));
        const QFileInfo helper(QDir(QCoreApplication::applicationDirPath()).filePath(
#ifdef Q_OS_WIN
            QStringLiteral("cluster-package-stager.exe")
#else
            QStringLiteral("cluster-package-stager")
#endif
        ));
        if (!helper.isFile() || helper.isSymLink() || !helper.isExecutable())
            return fail(QStringLiteral("PACKAGE_HELPER_MISSING"), QStringLiteral("Package helper unavailable."));
        const QString root = QDir::cleanPath(QStandardPaths::writableLocation(QStandardPaths::AppLocalDataLocation)
            + QStringLiteral("/package-staging/") + profileId);
        QProcess inspection;
        inspection.start(helper.absoluteFilePath(), {QStringLiteral("--action"), QStringLiteral("msi-rollback-review"),
            QStringLiteral("--root"), root, QStringLiteral("--package-key"), key});
        if (!inspection.waitForStarted(1500) || !inspection.waitForFinished(7000)) {
            inspection.kill(); inspection.waitForFinished(1000);
            return fail(QStringLiteral("PACKAGE_ROLLBACK_REVIEW_UNAVAILABLE"), QStringLiteral("Rollback review timed out."));
        }
        const QByteArray response = inspection.readAllStandardOutput().trimmed();
        const QByteArray prefix("CLUSTER_MSI_ROLLBACK_REVIEW ");
        if (inspection.exitStatus() != QProcess::NormalExit || inspection.exitCode() != 0 ||
            response.size() > 32*1024 || !response.startsWith(prefix))
            return fail(QStringLiteral("PACKAGE_ROLLBACK_REVIEW_UNSAFE"), QStringLiteral("Native rollback custody review failed."));
        const QJsonDocument doc = QJsonDocument::fromJson(response.mid(prefix.size()));
        const QJsonObject result = doc.object();
        const QString state = result.value(QStringLiteral("state")).toString();
        const bool reviewable = state == QStringLiteral("reviewable_not_authorized");
        if (!doc.isObject() || result.value(QStringLiteral("schema")).toInt() != 1 ||
            result.value(QStringLiteral("packageKey")).toString() != key ||
            (state != QStringLiteral("blocked") && !reviewable) ||
            !result.value(QStringLiteral("readOnly")).isBool() || !result.value(QStringLiteral("readOnly")).toBool() ||
            !result.value(QStringLiteral("osAttested")).isBool() || result.value(QStringLiteral("osAttested")).toBool(true) ||
            !result.value(QStringLiteral("mutationAuthorized")).isBool() || result.value(QStringLiteral("mutationAuthorized")).toBool(true) ||
            !result.value(QStringLiteral("rollbackAuthorized")).isBool() || result.value(QStringLiteral("rollbackAuthorized")).toBool(true) ||
            !result.value(QStringLiteral("blockers")).isArray() || !result.value(QStringLiteral("warnings")).isArray() ||
            !result.value(QStringLiteral("knownDependents")).isArray() || !result.value(QStringLiteral("settledDependents")).isArray() ||
            !result.value(QStringLiteral("outstandingDependents")).isArray() || !result.value(QStringLiteral("recoveryOrder")).isArray())
            return fail(QStringLiteral("PACKAGE_ROLLBACK_REVIEW_UNSAFE"), QStringLiteral("Rollback review envelope is inconsistent."));
        const QJsonArray blockers = result.value(QStringLiteral("blockers")).toArray();
        const QJsonArray warnings = result.value(QStringLiteral("warnings")).toArray();
        const QJsonArray dependents = result.value(QStringLiteral("knownDependents")).toArray();
        const QJsonArray settled = result.value(QStringLiteral("settledDependents")).toArray();
        const QJsonArray outstanding = result.value(QStringLiteral("outstandingDependents")).toArray();
        const QJsonArray order = result.value(QStringLiteral("recoveryOrder")).toArray();
        if ((reviewable && !blockers.isEmpty()) || (!reviewable && blockers.isEmpty()) ||
            order.isEmpty() || order.size() > 64 || dependents.size() != order.size()-1 ||
            settled.size()+outstanding.size() != dependents.size() || (reviewable && !outstanding.isEmpty()) ||
            warnings.isEmpty() || warnings.size() > 12 ||
            order.last().toString() != key)
            return fail(QStringLiteral("PACKAGE_ROLLBACK_REVIEW_UNSAFE"), QStringLiteral("Rollback recovery order is inconsistent."));
        QSet<QString> seen;
        for (int i = 0; i < order.size(); ++i) {
            const QString current = order.at(i).toString();
            if (!keyPattern.match(current).hasMatch() || seen.contains(current) ||
                (i < dependents.size() && dependents.at(i).toString() != current))
                return fail(QStringLiteral("PACKAGE_ROLLBACK_REVIEW_UNSAFE"), QStringLiteral("Rollback recovery order contains invalid Package identities."));
            seen.insert(current);
        }
        int settledIndex=0, outstandingIndex=0;
        for (const auto &dependent : dependents) {
            const QString current = dependent.toString();
            if (settledIndex < settled.size() && settled.at(settledIndex).toString() == current && settled.at(settledIndex).isString())
                ++settledIndex;
            else if (outstandingIndex < outstanding.size() && outstanding.at(outstandingIndex).toString() == current && outstanding.at(outstandingIndex).isString())
                ++outstandingIndex;
            else return fail(QStringLiteral("PACKAGE_ROLLBACK_REVIEW_UNSAFE"), QStringLiteral("Dependent disposition partition is inconsistent."));
        }
        if (settledIndex != settled.size() || outstandingIndex != outstanding.size())
            return fail(QStringLiteral("PACKAGE_ROLLBACK_REVIEW_UNSAFE"), QStringLiteral("Dependent dispositions were reordered."));
        for (const auto &warning : warnings)
            if (!warning.isString() || warning.toString().isEmpty())
                return fail(QStringLiteral("PACKAGE_ROLLBACK_REVIEW_UNSAFE"), QStringLiteral("Rollback warnings are invalid."));
        for (const auto &reason : blockers)
            if (!reason.isString() || reason.toString().isEmpty())
                return fail(QStringLiteral("PACKAGE_ROLLBACK_REVIEW_UNSAFE"), QStringLiteral("Rollback blockers are invalid."));
        for (const QString &digest : {QStringLiteral("priorReceiptSha256"), QStringLiteral("upgradeJournalSha256"),
            QStringLiteral("predecessorMsiSha256"), QStringLiteral("successorMsiSha256")})
            if (!shaPattern.match(result.value(digest).toString()).hasMatch())
                return fail(QStringLiteral("PACKAGE_ROLLBACK_REVIEW_UNSAFE"), QStringLiteral("Rollback receipt bindings are missing."));
        if (!versionPattern.match(result.value(QStringLiteral("predecessorProductVersion")).toString()).hasMatch() ||
            !versionPattern.match(result.value(QStringLiteral("successorProductVersion")).toString()).hasMatch())
            return fail(QStringLiteral("PACKAGE_ROLLBACK_REVIEW_UNSAFE"), QStringLiteral("Rollback version evidence is invalid."));
        return result;
    }

    if (capability == QStringLiteral("package.msiRepairStatus") || capability == QStringLiteral("package.msiUninstallStatus") || capability == QStringLiteral("package.msiUpgradeStatus") || capability == QStringLiteral("package.msiRollbackStatus")) {
        const bool rollbackInspection = capability == QStringLiteral("package.msiRollbackStatus");
        const bool uninstallInspection = capability == QStringLiteral("package.msiUninstallStatus");
        const bool upgradeInspection = capability == QStringLiteral("package.msiUpgradeStatus");
        const QString lifecycleOperation = rollbackInspection ? QStringLiteral("msi-rollback") : upgradeInspection ? QStringLiteral("upgrade") : uninstallInspection ? QStringLiteral("uninstall") : QStringLiteral("repair");
        // An installation grant or renderer-provided path cannot be smuggled
        // through the read-only repair journal inspection boundary.
        if (!m_controller || !m_controller->nativeSessionReady() || !m_controller->serverProfiles())
            return fail(QStringLiteral("NATIVE_SESSION_REQUIRED"), QStringLiteral("Sign in before inspecting repair custody."));
        const QString profileId = m_controller->serverProfiles()->activeProfileId();
        const QString key = payload.value(QStringLiteral("packageKey")).toString();
        static const QRegularExpression profilePattern(QStringLiteral("^[A-Za-z0-9_-]{8,80}$"));
        static const QRegularExpression keyPattern(QStringLiteral("^[a-z][a-z0-9-]{2,79}$"));
        static const QRegularExpression shaPattern(QStringLiteral("^[a-f0-9]{64}$"));
        static const QRegularExpression codePattern(QStringLiteral("^\\{[0-9A-F]{8}-(?:[0-9A-F]{4}-){3}[0-9A-F]{12}\\}$"));
        static const QRegularExpression versionPattern(QStringLiteral("^[0-9]{1,5}\\.[0-9]{1,5}\\.[0-9]{1,5}$"));
        if (!profilePattern.match(profileId).hasMatch() || !keyPattern.match(key).hasMatch())
            return fail(QStringLiteral("PACKAGE_TARGET_INVALID"), QStringLiteral("Invalid repair inspection identity."));
        const QFileInfo helper(QDir(QCoreApplication::applicationDirPath()).filePath(
#ifdef Q_OS_WIN
            QStringLiteral("cluster-package-stager.exe")
#else
            QStringLiteral("cluster-package-stager")
#endif
        ));
        if (!helper.isFile() || helper.isSymLink() || !helper.isExecutable())
            return fail(QStringLiteral("PACKAGE_HELPER_MISSING"), QStringLiteral("Package helper unavailable."));
        const QString root = QDir::cleanPath(QStandardPaths::writableLocation(QStandardPaths::AppLocalDataLocation)
            + QStringLiteral("/package-staging/") + profileId);
        QProcess inspector;
        inspector.start(helper.absoluteFilePath(), {QStringLiteral("--action"), rollbackInspection ? QStringLiteral("msi-rollback-status") : upgradeInspection ? QStringLiteral("msi-upgrade-status") : uninstallInspection ? QStringLiteral("msi-uninstall-status") : QStringLiteral("msi-repair-status"),
            QStringLiteral("--root"), root, QStringLiteral("--package-key"), key});
        if (!inspector.waitForStarted(1500) || !inspector.waitForFinished(5000)) {
            inspector.kill(); inspector.waitForFinished(1000);
            return fail(QStringLiteral("PACKAGE_MSI_REPAIR_EVIDENCE_UNAVAILABLE"), QStringLiteral("Repair journal inspection timed out."));
        }
        const QByteArray output = inspector.readAllStandardOutput().trimmed();
        const QByteArray prefix = rollbackInspection ? QByteArray("CLUSTER_MSI_ROLLBACK_STATUS ") : upgradeInspection ? QByteArray("CLUSTER_MSI_UPGRADE_STATUS ") : uninstallInspection ? QByteArray("CLUSTER_MSI_UNINSTALL_STATUS ") : QByteArray("CLUSTER_MSI_REPAIR_STATUS ");
        if (inspector.exitStatus() != QProcess::NormalExit || inspector.exitCode() != 0
            || output.size() > 8192 || !output.startsWith(prefix))
            return fail(QStringLiteral("PACKAGE_MSI_REPAIR_EVIDENCE_UNSAFE"), QStringLiteral("Repair evidence could not be verified."));
        const QJsonDocument doc = QJsonDocument::fromJson(output.mid(prefix.size()));
        const QJsonObject result = doc.object();
        if (!doc.isObject() || result.value(QStringLiteral("schema")).toInt() != 1
            || result.value(QStringLiteral("packageKey")).toString() != key
            || !result.value(QStringLiteral("readOnly")).isBool() || !result.value(QStringLiteral("readOnly")).toBool()
            || !result.value(QStringLiteral("osAttested")).isBool() || result.value(QStringLiteral("osAttested")).toBool(true)
            || !result.value(QStringLiteral("retryAuthorized")).isBool() || result.value(QStringLiteral("retryAuthorized")).toBool(true)
            || !result.value(QStringLiteral("hasReceipt")).isBool() || !result.value(QStringLiteral("manualReviewRequired")).isBool())
            return fail(QStringLiteral("PACKAGE_MSI_REPAIR_EVIDENCE_UNSAFE"), QStringLiteral("Inconsistent repair status envelope."));
        const bool recorded = result.value(QStringLiteral("hasReceipt")).toBool();
        const QJsonObject receipt = result.value(QStringLiteral("receipt")).toObject();
        if (recorded) {
            const QString state = result.value(QStringLiteral("state")).toString();
            const bool knownState = state == lifecycleOperation + QStringLiteral("_prepared_not_launched")
                || state == lifecycleOperation + QStringLiteral("_started_outcome_unknown")
                || state == lifecycleOperation + QStringLiteral("_failed_or_outcome_unknown")
                || state == lifecycleOperation + QStringLiteral("_exit_zero_not_os_attested")
                || state == lifecycleOperation + QStringLiteral("_restart_required_not_os_attested");
            if (!knownState || !result.value(QStringLiteral("manualReviewRequired")).toBool()
                || !shaPattern.match(result.value(QStringLiteral("receiptSha256")).toString()).hasMatch()
                || receipt.value(QStringLiteral("schema")).toInt() != 1
                || receipt.value(QStringLiteral("operation")).toString() != lifecycleOperation
                || receipt.value(QStringLiteral("packageKey")).toString() != key
                || receipt.value(QStringLiteral("state")).toString() != state
                || !shaPattern.match(receipt.value(QStringLiteral("priorReceiptSha256")).toString()).hasMatch()
                || !shaPattern.match(receipt.value(QStringLiteral("artifactSha256")).toString()).hasMatch()
                || !shaPattern.match(receipt.value(QStringLiteral("msiSha256")).toString()).hasMatch()
                || !codePattern.match(receipt.value(QStringLiteral("productCode")).toString()).hasMatch()
                || !versionPattern.match(receipt.value(QStringLiteral("productVersion")).toString()).hasMatch()
                || ((upgradeInspection || rollbackInspection) && (!shaPattern.match(receipt.value(QStringLiteral("priorMsiSha256")).toString()).hasMatch()
                    || !versionPattern.match(receipt.value(QStringLiteral("priorProductVersion")).toString()).hasMatch()
                    || receipt.value(QStringLiteral("priorProductVersion")) == receipt.value(QStringLiteral("productVersion"))))
                || (!upgradeInspection && !rollbackInspection && (receipt.contains(QStringLiteral("priorMsiSha256")) || receipt.contains(QStringLiteral("priorProductVersion"))))
                || (rollbackInspection && (!shaPattern.match(receipt.value(QStringLiteral("upgradeJournalSha256")).toString()).hasMatch()
                    || !shaPattern.match(receipt.value(QStringLiteral("successorMsiSha256")).toString()).hasMatch()
                    || !receipt.value(QStringLiteral("msiPath")).isString()
                    || receipt.value(QStringLiteral("msiSha256")) != receipt.value(QStringLiteral("priorMsiSha256"))
                    || receipt.value(QStringLiteral("msiSha256")) == receipt.value(QStringLiteral("successorMsiSha256"))))
                || (!rollbackInspection && (receipt.contains(QStringLiteral("upgradeJournalSha256")) || receipt.contains(QStringLiteral("successorMsiSha256"))))
                || !receipt.value(QStringLiteral("osAttested")).isBool() || receipt.value(QStringLiteral("osAttested")).toBool(true)
                || !QRegularExpression(QStringLiteral("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\\.[0-9]{1,9})?Z$")).match(receipt.value(QStringLiteral("startedAt")).toString()).hasMatch())
                return fail(QStringLiteral("PACKAGE_MSI_REPAIR_EVIDENCE_UNSAFE"), QStringLiteral("Repair receipt is inconsistent."));
            if (!validNativeMSIUpgradeRecovery(result) || !validNativeMSIRollbackRecovery(result))
                return fail(QStringLiteral("PACKAGE_MSI_UPGRADE_EVIDENCE_UNSAFE"), QStringLiteral("Read-only upgrade registration evidence is inconsistent."));
        } else if (result.value(QStringLiteral("manualReviewRequired")).toBool()
            || result.value(QStringLiteral("state")).toString() != QStringLiteral("no_recorded_") + lifecycleOperation
            || !receipt.isEmpty() || !result.value(QStringLiteral("receiptSha256")).isUndefined())
            return fail(QStringLiteral("PACKAGE_MSI_REPAIR_EVIDENCE_UNSAFE"), QStringLiteral("Empty repair custody report is inconsistent."));
        return result;
    }

    if (capability == QStringLiteral("package.msiAttemptStatus")) {
        // Read-only per-server-profile local forensic evidence. No renderer
        // paths, grants, command arguments, or receipt dismissal are accepted.
        if (!m_controller || !m_controller->nativeSessionReady() || !m_controller->serverProfiles())
            return fail(QStringLiteral("NATIVE_SESSION_REQUIRED"), QStringLiteral("Sign in to inspect local MSI evidence."));
        const QString profileId = m_controller->serverProfiles()->activeProfileId();
        const QString key = payload.value(QStringLiteral("packageKey")).toString();
        static const QRegularExpression profilePattern(QStringLiteral("^[A-Za-z0-9_-]{8,80}$"));
        static const QRegularExpression keyPattern(QStringLiteral("^[a-z][a-z0-9-]{2,79}$"));
        if (!profilePattern.match(profileId).hasMatch() || !keyPattern.match(key).hasMatch())
            return fail(QStringLiteral("PACKAGE_TARGET_INVALID"), QStringLiteral("Invalid MSI evidence identity."));
        const QFileInfo helper(QDir(QCoreApplication::applicationDirPath()).filePath(
#ifdef Q_OS_WIN
            QStringLiteral("cluster-package-stager.exe")
#else
            QStringLiteral("cluster-package-stager")
#endif
        ));
        if (!helper.isFile() || helper.isSymLink() || !helper.isExecutable())
            return fail(QStringLiteral("PACKAGE_HELPER_MISSING"), QStringLiteral("Native Package evidence helper is missing."));
        const QString root = QDir::cleanPath(QStandardPaths::writableLocation(QStandardPaths::AppLocalDataLocation)
            + QStringLiteral("/package-staging/") + profileId);
        QProcess inspector;
        inspector.start(helper.absoluteFilePath(), {QStringLiteral("--action"), QStringLiteral("msi-attempt-status"),
            QStringLiteral("--root"), root, QStringLiteral("--package-key"), key});
        if (!inspector.waitForStarted(1500) || !inspector.waitForFinished(4000)) {
            inspector.kill(); inspector.waitForFinished(1000);
            return fail(QStringLiteral("PACKAGE_MSI_EVIDENCE_UNAVAILABLE"), QStringLiteral("Native attempt inspection failed or timed out."));
        }
        const QByteArray prefix("CLUSTER_MSI_ATTEMPT_STATUS ");
        const QByteArray output = inspector.readAllStandardOutput().trimmed();
        if (inspector.exitStatus() != QProcess::NormalExit || inspector.exitCode() != 0
            || !output.startsWith(prefix) || output.size() > 8192)
            return fail(QStringLiteral("PACKAGE_MSI_EVIDENCE_UNSAFE"), QStringLiteral("Local MSI attempt evidence is invalid or inaccessible; manual inspection required."));
        const QJsonDocument parsed = QJsonDocument::fromJson(output.mid(prefix.size()));
        const QJsonObject value = parsed.object();
        const QJsonValue receiptValue = value.value(QStringLiteral("hasReceipt"));
        const QJsonValue lockValue = value.value(QStringLiteral("lockPresent"));
        const QJsonValue admissionValue = value.value(QStringLiteral("admissionLockPresent"));
        const QJsonValue reviewValue = value.value(QStringLiteral("manualReviewRequired"));
        const bool hasReceipt = receiptValue.isBool() && receiptValue.toBool();
        const bool hasLock = lockValue.isBool() && lockValue.toBool();
        const bool needsReview = reviewValue.isBool() && reviewValue.toBool();
        const QString recordState = value.value(QStringLiteral("state")).toString();
        const QJsonObject attempt = value.value(QStringLiteral("attempt")).toObject();
        const QJsonObject product = value.value(QStringLiteral("product")).toObject();
        const bool cleanRecord = !hasReceipt && !hasLock && !needsReview
            && recordState == QStringLiteral("no_recorded_attempt")
            && attempt.isEmpty() && product.isEmpty()
            && value.value(QStringLiteral("receiptSha256")).isUndefined()
            && validNativeMSIBootObservation(value.value(QStringLiteral("bootObservation")), false)
            && validNativeMSIRegistrationTransition(value);
        const bool interruptedLock = !hasReceipt && hasLock && needsReview
            && recordState == QStringLiteral("interrupted_or_active_without_receipt")
            && attempt.isEmpty() && product.isEmpty()
            && value.value(QStringLiteral("receiptSha256")).isUndefined()
            && validNativeMSIBootObservation(value.value(QStringLiteral("bootObservation")), false)
            && validNativeMSIRegistrationTransition(value);
        static const QRegularExpression digestPattern(QStringLiteral("^[a-f0-9]{64}$"));
        static const QRegularExpression msiCodePattern(QStringLiteral("^\\{[0-9A-F]{8}-(?:[0-9A-F]{4}-){3}[0-9A-F]{12}\\}$"));
        const QString productCode = attempt.value(QStringLiteral("productCode")).toString();
        static const QRegularExpression msiVersionPattern(QStringLiteral("^[0-9]{1,5}\\.[0-9]{1,5}\\.[0-9]{1,5}$"));
        const bool knownAttemptState = recordState == QStringLiteral("msi_prepared_not_launched")
            || recordState == QStringLiteral("msi_started_outcome_unknown")
            || recordState == QStringLiteral("msi_failed_or_outcome_unknown")
            || recordState == QStringLiteral("msi_exit_zero_not_os_attested")
            || recordState == QStringLiteral("msi_restart_required_not_os_attested");
        const bool pastAttempt = hasReceipt && needsReview && knownAttemptState
            && validNativeMSIBootObservation(value.value(QStringLiteral("bootObservation")), true)
            && validNativeMSIRegistrationTransition(value)
            && validNativeMSIAttemptReceiptEnvelope(value)
            && validNativeMSIBootAnchor(attempt.value(QStringLiteral("bootAnchor")))
            && value.value(QStringLiteral("bootObservation")).toObject().value(QStringLiteral("anchorRecorded")).toBool()
                == attempt.value(QStringLiteral("bootAnchor")).isObject()
            && digestPattern.match(value.value(QStringLiteral("receiptSha256")).toString()).hasMatch()
            && attempt.value(QStringLiteral("packageKey")).toString() == key
            && attempt.value(QStringLiteral("state")).toString() == recordState
            && attempt.value(QStringLiteral("osAttested")).isBool()
            && !attempt.value(QStringLiteral("osAttested")).toBool(true)
            && digestPattern.match(attempt.value(QStringLiteral("artifactSha256")).toString()).hasMatch()
            && digestPattern.match(attempt.value(QStringLiteral("msiSha256")).toString()).hasMatch()
            && msiCodePattern.match(productCode).hasMatch()
            && msiVersionPattern.match(attempt.value(QStringLiteral("productVersion")).toString()).hasMatch()
            && product.value(QStringLiteral("productCode")).toString() == productCode
            && product.value(QStringLiteral("expectedVersion")).toString() == attempt.value(QStringLiteral("productVersion")).toString()
            && product.value(QStringLiteral("readOnly")).isBool() && product.value(QStringLiteral("readOnly")).toBool(false)
            && product.value(QStringLiteral("osAttested")).isBool() && !product.value(QStringLiteral("osAttested")).toBool(true)
            && product.value(QStringLiteral("probeComplete")).isBool()
            && (product.value(QStringLiteral("probeComplete")).toBool(false)
                ? (product.value(QStringLiteral("probeScope")).toString() == QStringLiteral("current_user_and_machine")
                   && product.value(QStringLiteral("state")).toString() != QStringLiteral("os_query_unavailable"))
                : (product.value(QStringLiteral("probeScope")).toString().isEmpty()
                   && product.value(QStringLiteral("state")).toString() == QStringLiteral("os_query_unavailable")));
        if (!parsed.isObject() || value.value(QStringLiteral("schema")).toInt() != 1
            || value.value(QStringLiteral("packageKey")).toString() != key
            || receiptValue.isBool() == false || lockValue.isBool() == false || reviewValue.isBool() == false
            || !admissionValue.isBool() || (admissionValue.toBool() && !hasLock)
            || !value.value(QStringLiteral("readOnly")).isBool() || !value.value(QStringLiteral("readOnly")).toBool(false)
            || !value.value(QStringLiteral("retryAuthorized")).isBool() || value.value(QStringLiteral("retryAuthorized")).toBool(true)
            || !value.value(QStringLiteral("osAttested")).isBool() || value.value(QStringLiteral("osAttested")).toBool(true)
            || !(cleanRecord || interruptedLock || pastAttempt))
            return fail(QStringLiteral("PACKAGE_MSI_EVIDENCE_UNSAFE"), QStringLiteral("The native MSI evidence response is inconsistent; no installation is authorized."));
        return value;
    }

    if (capability == QStringLiteral("package.stageStatus"))
        return m_packageStageStatus.isEmpty()
            ? QJsonObject{{QStringLiteral("state"), QStringLiteral("idle")}} : m_packageStageStatus;

    if (capability == QStringLiteral("package.stageKit") || capability == QStringLiteral("package.auditKit") || capability == QStringLiteral("package.auditManaged")
        || capability == QStringLiteral("package.deployContent") || capability == QStringLiteral("package.rollbackContent")
        || capability == QStringLiteral("package.previewInstaller") || capability == QStringLiteral("package.previewUpgrade") || capability == QStringLiteral("package.upgradeMsi") || capability == QStringLiteral("package.rollbackMsi") || capability == QStringLiteral("package.installMsi") || capability == QStringLiteral("package.repairMsi") || capability == QStringLiteral("package.uninstallMsi")
        || capability == QStringLiteral("package.previewFiles") || capability == QStringLiteral("package.auditFiles") || capability == QStringLiteral("package.syncFiles")
        || capability == QStringLiteral("package.rollbackFiles") || capability == QStringLiteral("package.replaceFiles")) {
        const bool fileOperation = capability == QStringLiteral("package.previewFiles") || capability == QStringLiteral("package.auditFiles") || capability == QStringLiteral("package.syncFiles")
            || capability == QStringLiteral("package.rollbackFiles") || capability == QStringLiteral("package.replaceFiles");
        const bool filePreview = capability == QStringLiteral("package.previewFiles");
        const bool fileAudit = capability == QStringLiteral("package.auditFiles");
        const bool fileReadOnly = filePreview || fileAudit;
        const bool fileRollback = capability == QStringLiteral("package.rollbackFiles");
        const bool fileAdopt = capability == QStringLiteral("package.replaceFiles");
        const bool auditManaged = capability == QStringLiteral("package.auditManaged");
        const bool auditOnly = capability == QStringLiteral("package.auditKit") || auditManaged;
        const bool managedOperation = capability == QStringLiteral("package.deployContent") || capability == QStringLiteral("package.rollbackContent");
        const bool rollbackOperation = capability == QStringLiteral("package.rollbackContent");
        const bool installerPreview = capability == QStringLiteral("package.previewInstaller");
        const bool installerUpgradePreview = capability == QStringLiteral("package.previewUpgrade");
        const QString upgradePriorSha = installerUpgradePreview ? boundedText(payload.value(QStringLiteral("priorReceiptSha256")), 64) : QString();
        const bool installerUpgrade = capability == QStringLiteral("package.upgradeMsi");
        const bool installerRollback = capability == QStringLiteral("package.rollbackMsi");
        const bool installerInstall = capability == QStringLiteral("package.installMsi");
        const bool installerRepair = capability == QStringLiteral("package.repairMsi");
        const bool installerUninstall = capability == QStringLiteral("package.uninstallMsi");
        const bool needsControlGrant = managedOperation || installerInstall || installerRepair || installerUninstall || installerUpgrade || installerRollback;
#ifndef Q_OS_WIN
        if (installerInstall || installerRepair || installerUninstall || installerUpgrade || installerRollback) return fail(QStringLiteral("PACKAGE_MSI_WINDOWS_ONLY"), QStringLiteral("Supervised MSI installation is Windows-only."));
#endif
        // Renderer supplies only target identity constraints. No paths, pins,
        // commands, installation flags, or authorization assertions are accepted.
        const QString expectedSha = boundedText(payload.value(QStringLiteral("expectedArtifactSha256")), 64);
        const QString expectedKey = boundedText(payload.value(QStringLiteral("expectedPackageKey")), 80);
        const QString expectedVersion = boundedText(payload.value(QStringLiteral("expectedVersion")), 100);
        static const QRegularExpression targetShaPattern(QStringLiteral("^[a-f0-9]{64}$"));
        static const QRegularExpression targetKeyPattern(QStringLiteral("^[a-z][a-z0-9-]{2,79}$"));
        static const QRegularExpression targetVersionPattern(QStringLiteral("^[0-9]+\\.[0-9]+\\.[0-9]+(?:-[A-Za-z0-9.-]+)?$"));
        if ((installerUpgradePreview && !targetShaPattern.match(upgradePriorSha).hasMatch())
            || !targetShaPattern.match(expectedSha).hasMatch() || !targetKeyPattern.match(expectedKey).hasMatch()
            || !targetVersionPattern.match(expectedVersion).hasMatch())
            return fail(QStringLiteral("PACKAGE_TARGET_INVALID"), QStringLiteral("Select a specific signed Package target before opening the native kit."));
        // Qt chooses the local handoff and reads an independently provisioned
        // per-profile pin. This does not confer server rollout authorization.
        if (!m_controller || !m_controller->nativeSessionReady() || !m_controller->connectionOnline())
            return fail(QStringLiteral("NATIVE_SESSION_REQUIRED"), QStringLiteral("Connect an authenticated Desktop session before staging a Package."));
        if (m_packageStageProcess)
            return fail(QStringLiteral("PACKAGE_STAGE_BUSY"), QStringLiteral("One Package operation is already running."));
        if (!consumeDialogBudget())
            return fail(QStringLiteral("RATE_LIMITED"), QStringLiteral("Too many native Package prompts."));
        const QString profileId = m_controller->serverProfiles() ? m_controller->serverProfiles()->activeProfileId() : QString();
        const QString startEpoch = m_brokerEpoch;
        const auto sessionUnchanged = [&]() {
            return m_controller && m_controller->nativeSessionReady() && m_controller->connectionOnline()
                && m_controller->serverProfiles() && m_controller->serverProfiles()->activeProfileId() == profileId
                && m_brokerEpoch == startEpoch;
        };
        static const QRegularExpression profilePattern(QStringLiteral("^[a-zA-Z0-9_-]{8,80}$"));
        if (!profilePattern.match(profileId).hasMatch())
            return fail(QStringLiteral("PROFILE_INVALID"), QStringLiteral("Package staging requires a valid Desktop server profile."));

        const QString configDir = QDir::cleanPath(QStandardPaths::writableLocation(QStandardPaths::AppConfigLocation) + QStringLiteral("/package-trust"));
        const QFileInfo configInfo(configDir);
        if (!configInfo.exists() || !configInfo.isDir() || configInfo.isSymLink())
            return fail(QStringLiteral("PACKAGE_TRUST_MISSING"), QStringLiteral("Provision a native per-profile Package signing pin outside the release feed before staging."));
        const QFileInfo pinInfo(QDir(configDir).filePath(profileId + QStringLiteral(".pin")));
        if (!pinInfo.isFile() || pinInfo.isSymLink() || pinInfo.size() > 80 || pinInfo.size() < 64)
            return fail(QStringLiteral("PACKAGE_TRUST_INVALID"), QStringLiteral("Independent Package signing pin is missing or invalid."));
        QFile pinFile(pinInfo.absoluteFilePath());
        if (!pinFile.open(QIODevice::ReadOnly))
            return fail(QStringLiteral("PACKAGE_TRUST_UNREADABLE"), QStringLiteral("Cannot read native Package trust configuration."));
        const QString pin = QString::fromLatin1(pinFile.readAll()).trimmed();
        static const QRegularExpression fingerprintPattern(QStringLiteral("^[a-f0-9]{64}$"));
        if (!fingerprintPattern.match(pin).hasMatch())
            return fail(QStringLiteral("PACKAGE_TRUST_INVALID"), QStringLiteral("Package signing pin must be 64 lowercase hexadecimal digits."));

        QString controlPin;
        QJsonObject grantEnvelope;
        if (needsControlGrant) {
            // The renderer can relay only signed bytes from the server. The
            // independently pinned control key never comes from the renderer.
            grantEnvelope = payload.value(QStringLiteral("grant")).toObject();
            const QByteArray grantBytes = QJsonDocument(grantEnvelope).toJson(QJsonDocument::Compact);
            if (grantEnvelope.value(QStringLiteral("schema")).toInt() != 1 || grantBytes.size() > 8192
                || grantBytes.size() < 100)
                return fail(QStringLiteral("PACKAGE_GRANT_INVALID"), QStringLiteral("Missing or malformed short-lived server-signed deployment grant."));
            const QString controlDir = QDir::cleanPath(QStandardPaths::writableLocation(QStandardPaths::AppConfigLocation) + QStringLiteral("/package-control-trust"));
            const QFileInfo controlDirInfo(controlDir);
            const QFileInfo controlFileInfo(QDir(controlDir).filePath(profileId + QStringLiteral(".pin")));
            if (!controlDirInfo.isDir() || controlDirInfo.isSymLink() || !controlFileInfo.isFile()
                || controlFileInfo.isSymLink() || controlFileInfo.size() > 80)
                return fail(QStringLiteral("PACKAGE_CONTROL_TRUST_MISSING"), QStringLiteral("Enroll the independent deployment-control key fingerprint in native Desktop settings."));
            QFile controlFile(controlFileInfo.absoluteFilePath());
            if (!controlFile.open(QIODevice::ReadOnly))
                return fail(QStringLiteral("PACKAGE_CONTROL_TRUST_UNREADABLE"), QStringLiteral("Unable to read locally pinned deployment-control key."));
            controlPin = QString::fromLatin1(controlFile.readAll()).trimmed();
            if (!fingerprintPattern.match(controlPin).hasMatch() || controlPin == pin)
                return fail(QStringLiteral("PACKAGE_CONTROL_TRUST_INVALID"), QStringLiteral("Deployment-control key must be a distinct, independently pinned 64-character fingerprint."));
        }
        const QFileInfo helper(QDir(QCoreApplication::applicationDirPath()).filePath(
#ifdef Q_OS_WIN
            QStringLiteral("cluster-package-stager.exe")
#else
            QStringLiteral("cluster-package-stager")
#endif
        ));
        if (!helper.isFile() || helper.isSymLink() || !helper.isExecutable())
            return fail(QStringLiteral("PACKAGE_HELPER_MISSING"), QStringLiteral("The packaged native Package stager is unavailable."));
        const bool usePreparedKit = payload.value(QStringLiteral("preparedKit")).toBool(false);
        QString kitPath;
        if (usePreparedKit) {
            if (!m_packageIncomingReady || !m_packageIncomingKit || m_packageIncomingProfile != profileId
                || m_packageIncomingReleaseSha != expectedSha || m_packageIncomingKey != expectedKey
                || m_packageIncomingVersion != expectedVersion
                || nowMs() - m_packageIncomingStartedAt > MaxPackageKitAgeMs)
                return fail(QStringLiteral("PACKAGE_PREPARED_KIT_UNAVAILABLE"), QStringLiteral("No matching, recent, checksummed Package kit is in this Desktop session."));
            kitPath = m_packageIncomingKit->fileName();
        } else {
            kitPath = QFileDialog::getOpenFileName(nullptr, QStringLiteral("Choose downloaded Cluster Package staging kit"),
                QStandardPaths::writableLocation(QStandardPaths::DownloadLocation), QStringLiteral("Cluster staging kits (*.zip)"));
            if (kitPath.isEmpty()) return QJsonObject{{QStringLiteral("accepted"), false}};
            if (!sessionUnchanged()) return fail(QStringLiteral("PACKAGE_SESSION_CHANGED"), QStringLiteral("The Desktop session or server profile changed during the native file picker."));
        }
        const QFileInfo kit(kitPath);
        if (!kit.isFile() || kit.isSymLink() || kit.size() < 1 || kit.size() > MaxPackageKitBytes)
            return fail(QStringLiteral("PACKAGE_KIT_INVALID"), QStringLiteral("Selected staging kit is unsafe or exceeds the size limit."));
        const QString destination = QDir::cleanPath(QStandardPaths::writableLocation(QStandardPaths::AppLocalDataLocation) + QStringLiteral("/package-staging/") + profileId);
        QString fileDestination;
        if (fileOperation) {
            // The renderer cannot supply a destination. Only a native picker
            // can save the optional per-server-profile, per-Package binding.
            QSettings store = packageDestinationStore();
            store.setFallbacksEnabled(false);
            store.beginGroup(profileId);
            fileDestination = store.value(expectedKey).toString();
            if (fileDestination.isEmpty()) {
                fileDestination = QFileDialog::getExistingDirectory(nullptr, QStringLiteral("Choose existing folder for Package files"),
                    QStandardPaths::writableLocation(QStandardPaths::DocumentsLocation), QFileDialog::ShowDirsOnly);
                if (fileDestination.isEmpty()) return QJsonObject{{QStringLiteral("accepted"), false}};
            }
            if (!sessionUnchanged()) return fail(QStringLiteral("PACKAGE_SESSION_CHANGED"), QStringLiteral("The Desktop session changed during destination selection."));
            if (!savedDestinationIsSafe(fileDestination))
                return fail(QStringLiteral("PACKAGE_DESTINATION_INVALID"), QStringLiteral("Destination is missing or unsafe. Review the saved folder mapping in Desktop settings."));
        }
        const QString prompt = installerRollback
            ? QStringLiteral("ROLL BACK signed per-user MSI %1 to %2?\n\nRelease: %3…\nPublisher: %4…\nRollback key: %5…\n\nWindows Installer may refuse a downgrade. A separate signed grant must bind the original receipt, completed upgrade journal and BOTH MSI checksums. A new non-replayable rollback journal is written before the attempt. No forced uninstall, automatic retry or application-health attestation will occur.")
                .arg(expectedKey, expectedVersion, expectedSha.left(16), pin.left(16), controlPin.left(16))
            : installerUpgrade
            ? QStringLiteral("UPGRADE existing signed per-user MSI %1 to %2?\n\nRelease digest: %3…\nIndependent publisher key: %4…\nLifecycle-control key: %5…\n\nThe signed grant binds the prior installation receipt AND original MSI checksum. Windows Installer custom actions may change working software. The original installer is held read-only, but there is NO automatic rollback or replay; interrupted upgrades need manual review.")
                .arg(expectedKey, expectedVersion, expectedSha.left(16), pin.left(16), controlPin.left(16))
            : installerUninstall
            ? QStringLiteral("UNINSTALL existing signed per-user MSI %1 v%2?\n\nDigest: %3…\nPublisher key: %4…\nLifecycle control key: %5…\n\nThis irreversibly invokes Windows Installer removal custom actions. The separately signed grant names the exact existing receipt. Known dependents, foreign/machine registrations and unresolved custody block removal. No automatic rollback or repeat is allowed. External dependencies may be unknown.")
                .arg(expectedKey, expectedVersion, expectedSha.left(16), pin.left(16), controlPin.left(16))
            : installerRepair
            ? QStringLiteral("REPAIR existing signed per-user MSI %1 v%2?\n\nRelease digest: %3…\nIndependent signing key: %4…\nSeparate lifecycle-control key: %5…\n\nThis runs Windows Installer repair custom actions and changes an existing installation. Repair is not reversible or proof of application health. The native helper requires an exact prior receipt, unchanged Windows registration and a distinct one-time signed repair grant. Interrupted repairs require manual review.")
                .arg(expectedKey, expectedVersion, expectedSha.left(16), pin.left(16), controlPin.left(16))
            : installerInstall
            ? QStringLiteral("Run a signed, per-user MSI installer for %1 v%2?\n\nRelease digest: %3…\nIndependent signing key: %4…\nSeparate installer-control key: %5…\n\nMSI packages can execute custom actions. This operation changes Windows software, cannot guarantee rollback, and will not automatically retry after a crash. Only proceed for trusted studio software.")
                .arg(expectedKey, expectedVersion, expectedSha.left(16), pin.left(16), controlPin.left(16))
            : installerUpgradePreview
            ? QStringLiteral("Read-only MSI upgrade readiness review for %1 v%2?\n\nVerifies the signed target and retained predecessor MSI source; no installation, repair or rollback will run.").arg(expectedKey, expectedVersion)
            : installerPreview
            ? QStringLiteral("Read-only signed MSI preflight for %1 v%2?\n\nThis verifies the MSI archive, staged bytes and signed prerequisites without starting an installer.").arg(expectedKey, expectedVersion)
            : fileOperation
            ? QStringLiteral("%1 verified Package files in this folder?\n%2\n\nPackage: %3 v%4\nDigest: %5…\n\nFirst-time collisions and local edits are NOT overwritten. Subsequent updates replace only files matching the last tracked managed hash. Changes are backed up for a guarded rollback. No programs will be launched.")
                .arg(filePreview ? QStringLiteral("Preview") : (fileAudit ? QStringLiteral("Audit tracked") : (fileRollback ? QStringLiteral("Roll back") : (fileAdopt ? QStringLiteral("Replace conflicts and back up") : QStringLiteral("Update")))),
                    fileDestination, expectedKey, expectedVersion, expectedSha.left(16))
            : managedOperation
            ? QStringLiteral("%1 managed Package content from:\n%2\n\nExpected: %3 v%4\nDigest: %5…\nIndependent release key: %6…\nIndependent deployment control key: %7…\nProfile: %8\n\nThe helper requires an unexpired server-signed, one-time grant. It copies verified content to an unprivileged managed root and atomically updates a reversible pointer. It NEVER executes binaries, installs system software or attests OS health. Continue?")
                .arg(rollbackOperation ? QStringLiteral("Roll back") : QStringLiteral("Deploy"), kit.fileName(), expectedKey,
                    expectedVersion, expectedSha.left(16), pin.left(16), controlPin.left(16), profileId)
            : QStringLiteral("%7 signed Package content from:\n%1\n\n"
                "Expected: %2 v%3\nSHA-256: %4…\nIndependent key pin: %5…\nServer profile: %6\n\n"
                "The native helper will %8. "
                "It will NOT install software, select an active release, execute files, or attest OS health. Continue?")
                .arg(kit.fileName(), expectedKey, expectedVersion, expectedSha.left(16), pin.left(16), profileId,
                    auditOnly ? (auditManaged ? QStringLiteral("Audit managed") : QStringLiteral("Audit previously staged")) : QStringLiteral("Stage"),
                    auditOnly ? (auditManaged ? QStringLiteral("re-verify the managed copy and its staged source without modifying either") : QStringLiteral("re-verify existing staged bytes without modifying them")) : QStringLiteral("verify and quarantine content"));
        if (installerInstall || installerRepair || installerUninstall || installerUpgrade || installerRollback) {
            const QString typed = QInputDialog::getText(nullptr, installerRollback ? QStringLiteral("Confirm supervised MSI rollback") : installerUpgrade ? QStringLiteral("Confirm supervised MSI upgrade") : installerUninstall ? QStringLiteral("Confirm supervised MSI uninstall")
                : (installerRepair ? QStringLiteral("Confirm supervised MSI repair") : QStringLiteral("Confirm supervised MSI installation")),
                QStringLiteral("To authorize MSI custom actions, type %1 %2:").arg(installerRollback ? QStringLiteral("ROLLBACK") : installerUpgrade ? QStringLiteral("UPGRADE") : installerUninstall ? QStringLiteral("UNINSTALL")
                    : (installerRepair ? QStringLiteral("REPAIR") : QStringLiteral("INSTALL")), expectedKey));
            if (typed != (installerRollback ? QStringLiteral("ROLLBACK ") : installerUpgrade ? QStringLiteral("UPGRADE ") : installerUninstall ? QStringLiteral("UNINSTALL ")
                : (installerRepair ? QStringLiteral("REPAIR ") : QStringLiteral("INSTALL "))) + expectedKey)
                return QJsonObject{{QStringLiteral("accepted"), false}};
        }
        if (fileAdopt && QMessageBox::warning(nullptr, QStringLiteral("Back up and replace existing files"),
            QStringLiteral("You chose the explicit override. Files already in this folder, including personally modified files, can be replaced by signed Package versions after private backups are made. Rollback is guarded and may be blocked if files change again. Proceed with this destructive update?"),
            QMessageBox::Yes | QMessageBox::No, QMessageBox::No) != QMessageBox::Yes)
            return QJsonObject{{QStringLiteral("accepted"), false}};
        if (QMessageBox::question(nullptr, installerRollback ? QStringLiteral("Supervised Windows MSI rollback") : installerUpgrade ? QStringLiteral("Supervised Windows MSI upgrade") : installerUninstall ? QStringLiteral("Supervised Windows MSI uninstall")
            : (installerRepair ? QStringLiteral("Supervised Windows MSI repair")
            : (installerInstall ? QStringLiteral("Supervised Windows MSI installation")
            : (installerUpgradePreview ? QStringLiteral("Review MSI upgrade readiness")
            : (installerPreview ? QStringLiteral("Verify signed MSI readiness")
            : (fileOperation ? QStringLiteral("Cluster destination file updater")
            : (managedOperation ? (rollbackOperation ? QStringLiteral("Authorized managed rollback") : QStringLiteral("Authorized managed content deployment"))
            : (auditOnly ? (auditManaged ? QStringLiteral("Audit managed Package copy") : QStringLiteral("Audit staged Package")) : QStringLiteral("Verify and stage Package")))))))), prompt,
            QMessageBox::Yes | QMessageBox::No, QMessageBox::No) != QMessageBox::Yes)
            return QJsonObject{{QStringLiteral("accepted"), false}};
        if (!sessionUnchanged()) return fail(QStringLiteral("PACKAGE_SESSION_CHANGED"), QStringLiteral("The Desktop session changed before staging began."));
        if (!QDir().mkpath(destination) || QFileInfo(destination).isSymLink())
            return fail(QStringLiteral("PACKAGE_ROOT_UNSAFE"), QStringLiteral("Could not create a safe private staging root."));
        QSharedPointer<QTemporaryFile> grantFile;
        if (needsControlGrant) {
            grantFile = QSharedPointer<QTemporaryFile>::create(destination + QStringLiteral("/.authorization-XXXXXX"));
            const QByteArray rawGrant = QJsonDocument(grantEnvelope).toJson(QJsonDocument::Compact);
            if (!grantFile->open() || !grantFile->setPermissions(QFileDevice::ReadOwner | QFileDevice::WriteOwner)
                || grantFile->write(rawGrant) != rawGrant.size() || !grantFile->flush())
                return fail(QStringLiteral("PACKAGE_GRANT_LOCAL_HANDOFF_FAILED"), QStringLiteral("Could not create private short-lived grant handoff."));
            grantFile->close();
        }
        const QString operationId = QUuid::createUuid().toString(QUuid::WithoutBraces);
        auto *process = new QProcess(this);
        process->setProgram(helper.absoluteFilePath());
        QStringList helperArgs{QStringLiteral("--action"), installerRollback ? QStringLiteral("rollback-msi") : fileOperation
                ? (filePreview ? QStringLiteral("preview-files") : (fileAudit ? QStringLiteral("audit-files") : (fileRollback ? QStringLiteral("rollback-files") : (fileAdopt ? QStringLiteral("replace-files") : QStringLiteral("sync-files")))))
                : (installerUpgrade ? QStringLiteral("upgrade-msi") : (installerUninstall ? QStringLiteral("uninstall-msi") : (installerRepair ? QStringLiteral("repair-msi") : (installerInstall ? QStringLiteral("install-msi") : (installerUpgradePreview ? QStringLiteral("preview-upgrade") : (installerPreview ? QStringLiteral("preview-installer")
                  : (managedOperation ? (rollbackOperation ? QStringLiteral("rollback-content") : QStringLiteral("deploy-content"))
                    : (auditOnly ? (auditManaged ? QStringLiteral("audit-managed") : QStringLiteral("verify-stage")) : QStringLiteral("stage"))))))))),
            QStringLiteral("--kit"), kit.absoluteFilePath(),
            QStringLiteral("--trusted-key-sha256"), pin,
            QStringLiteral("--root"), destination};
        if (needsControlGrant) helperArgs << QStringLiteral("--trusted-control-key-sha256") << controlPin
            << QStringLiteral("--grant") << grantFile->fileName();
        if (fileOperation) helperArgs << QStringLiteral("--destination") << fileDestination;
        if (installerUpgradePreview) helperArgs << QStringLiteral("--prior-receipt-sha256") << upgradePriorSha;
        if (!needsControlGrant) helperArgs << QStringLiteral("--expected-artifact-sha256") << expectedSha
            << QStringLiteral("--expected-package-key") << expectedKey << QStringLiteral("--expected-version") << expectedVersion;
        process->setArguments(helperArgs);
        process->setProcessChannelMode(QProcess::MergedChannels);
        m_packageStageProcess = process;
        m_packageStageStatus = QJsonObject{{QStringLiteral("state"), QStringLiteral("verifying")},
            {QStringLiteral("operationId"), operationId}, {QStringLiteral("profileId"), profileId},
            {QStringLiteral("note"), installerRollback ? QStringLiteral("Running independently authorized MSI rollback. Both protected MSI sources remain held; no retry or health attestation.") : installerUpgrade ? QStringLiteral("Running predecessor-bound MSI upgrade. Retained original installer is held; no automatic rollback or OS-health claim.")
                : installerUninstall ? QStringLiteral("Running separately authorized MSI uninstall; known dependents blocked and original receipt retained.")
                : installerRepair ? QStringLiteral("Running separately authorized MSI repair; Windows Installer custom actions may change software. No application health attested.")
                : installerInstall ? QStringLiteral("Running supervised MSI installer; preserve receipt if interrupted.")
                : installerUpgradePreview ? QStringLiteral("Read-only minor MSI upgrade readiness; retained predecessor required, no Windows changes.")
                : fileOperation ? QStringLiteral("Verified destination file update; no execution or software installation.")
                : (managedOperation ? QStringLiteral("Authorized unprivileged managed content; no executable installation or OS attestation.")
                : (auditOnly ? QStringLiteral("Read-only integrity audit; no installation or activation.") : QStringLiteral("Local staging; no installation or activation.")))}};
        connect(process, qOverload<int, QProcess::ExitStatus>(&QProcess::finished), this,
            [this, process, grantFile, operationId, profileId, expectedSha, expectedKey, expectedVersion, pin, auditOnly, auditManaged, managedOperation, installerPreview, installerUpgradePreview, upgradePriorSha, installerInstall, installerRepair, installerUninstall, installerUpgrade, installerRollback, fileOperation, filePreview, fileAudit, fileReadOnly, fileRollback](int exitCode, QProcess::ExitStatus exitStatus) {
                if (m_packageStageProcess != process) return;
                const QByteArray output = process->readAll();
                const QByteArray prefix = installerRollback ? QByteArray("CLUSTER_MSI_ROLLBACK_RESULT ") : fileOperation ? (filePreview ? QByteArray("CLUSTER_FILE_UPDATE_PREVIEW ") : (fileAudit ? QByteArray("CLUSTER_FILE_AUDIT_RESULT ") : QByteArray("CLUSTER_FILE_SYNC_RESULT ")))
                    : (installerUpgrade ? QByteArray("CLUSTER_MSI_UPGRADE_RESULT ") : installerUninstall ? QByteArray("CLUSTER_MSI_UNINSTALL_RESULT ") : (installerRepair ? QByteArray("CLUSTER_MSI_REPAIR_RESULT ") : (installerInstall ? QByteArray("CLUSTER_MSI_RESULT ") : (installerUpgradePreview ? QByteArray("CLUSTER_MSI_UPGRADE_READINESS ") : (installerPreview ? QByteArray("CLUSTER_MSI_PREVIEW ")
                    : (managedOperation ? QByteArray("CLUSTER_MANAGED_CONTENT_RESULT ")
                    : (auditOnly ? (auditManaged ? QByteArray("CLUSTER_MANAGED_AUDIT_RESULT ") : QByteArray("CLUSTER_STAGE_AUDIT_RESULT ")) : QByteArray("CLUSTER_STAGE_RESULT "))))))));
                const int start = output.lastIndexOf(prefix);
                const int end = start < 0 ? -1 : output.indexOf('\n', start);
                const QByteArray evidenceBytes = start < 0 ? QByteArray() : output.mid(start + prefix.size(),
                    (end < 0 ? output.size() : end) - start - prefix.size()).trimmed();
                QJsonParseError parseError{};
                const QJsonDocument parsed = QJsonDocument::fromJson(evidenceBytes, &parseError);
                const QJsonObject evidence = parsed.isObject() ? parsed.object() : QJsonObject{};
                const QString state = evidence.value(QStringLiteral("state")).toString();
                const bool msiStateValid = installerRollback
                    ? (state == QStringLiteral("msi-rollback_exit_zero_not_os_attested") || state == QStringLiteral("msi-rollback_restart_required_not_os_attested"))
                    : installerUpgrade
                    ? (state == QStringLiteral("upgrade_exit_zero_not_os_attested") || state == QStringLiteral("upgrade_restart_required_not_os_attested"))
                    : installerUninstall
                    ? (state == QStringLiteral("uninstall_exit_zero_not_os_attested") || state == QStringLiteral("uninstall_restart_required_not_os_attested"))
                    : installerRepair
                    ? (state == QStringLiteral("repair_exit_zero_not_os_attested") || state == QStringLiteral("repair_restart_required_not_os_attested"))
                    : installerInstall
                    ? (state == QStringLiteral("msi_exit_zero_not_os_attested") || state == QStringLiteral("msi_restart_required_not_os_attested"))
                    : (installerUpgradePreview ? (state == QStringLiteral("reviewable_not_authorized")
                        && evidence.value(QStringLiteral("readOnly")).toBool(false)
                        && !evidence.value(QStringLiteral("mutationAuthorized")).toBool(true)
                        && evidence.value(QStringLiteral("priorReceiptSha256")).toString() == upgradePriorSha
                        && evidence.value(QStringLiteral("priorProductVersion")).toString() != evidence.value(QStringLiteral("targetProductVersion")).toString()
                        && !evidence.value(QStringLiteral("priorMsiPath")).toString().isEmpty()
                        && QRegularExpression(QStringLiteral("^[a-f0-9]{64}$")).match(evidence.value(QStringLiteral("priorMsiSha256")).toString()).hasMatch())
                        : (state == QStringLiteral("msi_verified_not_executed") && evidence.value(QStringLiteral("readOnly")).toBool()));
                const bool existingStateValid = fileOperation
                    ? (fileReadOnly ? evidence.value(QStringLiteral("readOnly")).toBool() && !evidence.value(QStringLiteral("executed")).toBool(true)
                        : (state == QStringLiteral("destination_updated_files_not_executed")
                            || state == QStringLiteral("destination_current_files_not_executed")
                            || (fileRollback && state == QStringLiteral("destination_rolled_back_files_not_executed"))))
                    : (managedOperation ? state == QStringLiteral("managed_content_selected_not_executed")
                        : (auditManaged ? state == QStringLiteral("verified_managed_content_not_executed")
                            : (auditOnly ? state == QStringLiteral("verified_staged_not_installed") : state == QStringLiteral("verified_staged_not_installed"))));
                const bool existingEvidenceValid = fileOperation ? !evidence.value(QStringLiteral("executed")).toBool(false)
                    : (managedOperation || auditManaged ? (!evidence.value(QStringLiteral("executed")).toBool(true)
                        && !evidence.value(QStringLiteral("osAttested")).toBool(true)
                        && evidence.value(QStringLiteral("generation")).toInt() > 0
                        && (!auditManaged || state == QStringLiteral("verified_managed_content_not_executed")))
                        : evidence.value(QStringLiteral("signingKeySha256")).toString() == pin);
                const bool success = exitStatus == QProcess::NormalExit && exitCode == 0
                    && parseError.error == QJsonParseError::NoError && evidence.value(QStringLiteral("schema")).toInt() == 1
                    && (installerInstall || installerRepair || installerUninstall || installerUpgrade || installerRollback || installerPreview || installerUpgradePreview ? msiStateValid && !evidence.value(QStringLiteral("osAttested")).toBool(true)
                        && (!installerPreview || (evidence.value(QStringLiteral("product")).isObject()
                            && evidence.value(QStringLiteral("product")).toObject().value(QStringLiteral("readOnly")).toBool(false)
                            && !evidence.value(QStringLiteral("product")).toObject().value(QStringLiteral("osAttested")).toBool(true)
                            && evidence.value(QStringLiteral("identity")).isObject()
                            && evidence.value(QStringLiteral("identity")).toObject().value(QStringLiteral("state")).toString() == QStringLiteral("msi_properties_match_signed_declaration")
                            && evidence.value(QStringLiteral("identity")).toObject().value(QStringLiteral("verified")).toBool(false)
                            && evidence.value(QStringLiteral("identity")).toObject().value(QStringLiteral("actualProductCode")).toString()
                                == evidence.value(QStringLiteral("identity")).toObject().value(QStringLiteral("declaredProductCode")).toString()
                            && evidence.value(QStringLiteral("identity")).toObject().value(QStringLiteral("actualProductVersion")).toString()
                                == evidence.value(QStringLiteral("identity")).toObject().value(QStringLiteral("declaredProductVersion")).toString()
                            && !evidence.value(QStringLiteral("identity")).toObject().value(QStringLiteral("actualProductCode")).toString().isEmpty()
                            && !evidence.value(QStringLiteral("identity")).toObject().value(QStringLiteral("actualProductVersion")).toString().isEmpty()
                            && evidence.value(QStringLiteral("identity")).toObject().value(QStringLiteral("readOnly")).toBool(false)
                            && !evidence.value(QStringLiteral("identity")).toObject().value(QStringLiteral("osAttested")).toBool(true)))
                        : existingStateValid && existingEvidenceValid)
                    && evidence.value(QStringLiteral("packageKey")).toString() == expectedKey
                    && evidence.value(QStringLiteral("version")).toString() == expectedVersion
                    && evidence.value(installerInstall || installerRepair || installerUninstall || installerUpgrade || installerRollback || installerPreview || installerUpgradePreview || managedOperation || auditManaged || fileOperation
                        ? QStringLiteral("artifactSha256") : QStringLiteral("archiveSha256")).toString() == expectedSha;
                QJsonArray previewConflicts;
                if (success && fileOperation && (filePreview || fileAudit)) {
                    for (const QJsonValue &item : evidence.value(fileAudit ? QStringLiteral("issues") : QStringLiteral("entries")).toArray()) {
                        const QJsonObject row = item.toObject();
                        if (fileAudit || row.value(QStringLiteral("action")).toString().startsWith(QStringLiteral("conflict_"))) {
                            previewConflicts.append(QJsonObject{{QStringLiteral("path"), row.value(QStringLiteral("path"))},
                                {QStringLiteral("action"), row.value(fileAudit ? QStringLiteral("state") : QStringLiteral("action"))}});
                            if (previewConflicts.size() >= 20) break;
                        }
                    }
                }
                const QString filePlanGuidance = evidence.value(QStringLiteral("overlappingRoots")).toInt() > 0
                    ? QStringLiteral("Another managed Package owns an overlapping parent/child root; update and rollback are blocked.")
                    : evidence.value(QStringLiteral("foreignOwnershipConflicts")).toInt() > 0
                    ? QStringLiteral("Files already tracked by another Package cannot be adopted or replaced.")
                    : evidence.value(QStringLiteral("pendingRecovery")).toBool()
                        ? QStringLiteral("An operation is active or interrupted; inspect the lock and recovery journal before retrying.")
                        : evidence.value(QStringLiteral("canUpdateSafely")).toBool()
                            ? QStringLiteral("Eligible for guarded update; native checks hashes again.")
                            : QStringLiteral("Conflicts require explicit review; normal update will refuse.");
                const QString presentedState = installerRollback
                    ? (state == QStringLiteral("msi-rollback_restart_required_not_os_attested") ? QStringLiteral("msi_rollback_restart_required") : QStringLiteral("msi_rollback_process_exited"))
                    : installerUpgrade
                    ? (state == QStringLiteral("upgrade_restart_required_not_os_attested") ? QStringLiteral("msi_upgrade_restart_required") : QStringLiteral("msi_upgrade_process_exited"))
                    : installerUninstall
                    ? (state == QStringLiteral("uninstall_restart_required_not_os_attested") ? QStringLiteral("msi_uninstall_restart_required") : QStringLiteral("msi_uninstall_process_exited"))
                    : installerRepair
                    ? (state == QStringLiteral("repair_restart_required_not_os_attested") ? QStringLiteral("msi_repair_restart_required") : QStringLiteral("msi_repair_process_exited"))
                    : installerInstall
                    ? (state == QStringLiteral("msi_restart_required_not_os_attested")
                        ? QStringLiteral("msi_restart_required") : QStringLiteral("msi_process_exited"))
                    : (installerUpgradePreview ? QStringLiteral("msi_upgrade_reviewable_not_authorized")
                    : (installerPreview ? QStringLiteral("msi_verified_not_executed")
                        : (fileOperation ? (filePreview ? QStringLiteral("file_update_preview")
                            : (fileAudit ? QStringLiteral("file_update_audit")
                                : (fileRollback ? QStringLiteral("file_update_rolled_back") : QStringLiteral("file_update_complete"))))
                            : (managedOperation ? QStringLiteral("managed_content_selected")
                                : (auditOnly ? (auditManaged ? QStringLiteral("audited_managed_content") : QStringLiteral("audited_staged_not_installed"))
                                    : QStringLiteral("staged_not_installed"))))));
                m_packageStageStatus = QJsonObject{{QStringLiteral("state"), success ? presentedState : QStringLiteral("failed")},
                    {QStringLiteral("operationId"), operationId}, {QStringLiteral("profileId"), profileId},
                    {QStringLiteral("artifactSha256"), expectedSha},
                    {QStringLiteral("packageKey"), expectedKey},
                    {QStringLiteral("version"), expectedVersion},
                    {QStringLiteral("evidence"), QStringLiteral("native_helper_self_report")},
                    {QStringLiteral("msiUpgrade"), success && installerUpgradePreview ? QJsonValue(evidence) : QJsonValue(QJsonValue::Null)},
                    {QStringLiteral("msiProduct"), success && installerPreview ? QJsonValue(evidence.value(QStringLiteral("product")).toObject()) : QJsonValue(QJsonValue::Null)},
                    {QStringLiteral("msiIdentity"), success && installerPreview ? QJsonValue(evidence.value(QStringLiteral("identity")).toObject()) : QJsonValue(QJsonValue::Null)},
                    {QStringLiteral("filePlan"), success && fileOperation && filePreview ? QJsonValue(QJsonObject{
                        {QStringLiteral("missing"), evidence.value(QStringLiteral("missing"))},
                        {QStringLiteral("current"), evidence.value(QStringLiteral("current"))},
                        {QStringLiteral("managedUpdates"), evidence.value(QStringLiteral("managedUpdates"))},
                        {QStringLiteral("untrackedConflicts"), evidence.value(QStringLiteral("untrackedConflicts"))},
                        {QStringLiteral("modifiedConflicts"), evidence.value(QStringLiteral("modifiedConflicts"))},
                        {QStringLiteral("foreignOwnershipConflicts"), evidence.value(QStringLiteral("foreignOwnershipConflicts"))},
                        {QStringLiteral("foreignOwnershipExamples"), evidence.value(QStringLiteral("foreignOwnershipExamples"))},
                        {QStringLiteral("overlappingRoots"), evidence.value(QStringLiteral("overlappingRoots"))},
                        {QStringLiteral("overlappingRootExamples"), evidence.value(QStringLiteral("overlappingRootExamples"))},
                        {QStringLiteral("canUpdateSafely"), evidence.value(QStringLiteral("canUpdateSafely"))},
                        {QStringLiteral("dependenciesReady"), evidence.value(QStringLiteral("dependenciesReady"))},
                        {QStringLiteral("dependencyBlocker"), evidence.value(QStringLiteral("dependencyBlocker"))},
                        {QStringLiteral("pendingRecovery"), evidence.value(QStringLiteral("pendingRecovery"))},
                        {QStringLiteral("conflictExamples"), previewConflicts},
                    }) : QJsonValue(QJsonValue::Null)},
                    {QStringLiteral("fileAudit"), success && fileOperation && fileAudit ? QJsonValue(QJsonObject{
                        {QStringLiteral("tracked"), evidence.value(QStringLiteral("tracked"))},
                        {QStringLiteral("verified"), evidence.value(QStringLiteral("verified"))},
                        {QStringLiteral("missing"), evidence.value(QStringLiteral("missing"))},
                        {QStringLiteral("modified"), evidence.value(QStringLiteral("modified"))},
                        {QStringLiteral("retired"), evidence.value(QStringLiteral("retired"))},
                        {QStringLiteral("retiredVerified"), evidence.value(QStringLiteral("retiredVerified"))},
                        {QStringLiteral("retiredMissing"), evidence.value(QStringLiteral("retiredMissing"))},
                        {QStringLiteral("retiredModified"), evidence.value(QStringLiteral("retiredModified"))},
                        {QStringLiteral("untrackedCurrent"), evidence.value(QStringLiteral("untrackedCurrent"))},
                        {QStringLiteral("untrackedMissing"), evidence.value(QStringLiteral("untrackedMissing"))},
                        {QStringLiteral("untrackedCollision"), evidence.value(QStringLiteral("untrackedCollision"))},
                        {QStringLiteral("pendingRecovery"), evidence.value(QStringLiteral("pendingRecovery"))},
                        {QStringLiteral("healthy"), evidence.value(QStringLiteral("healthy"))},
                        {QStringLiteral("trackedArtifactSha256"), evidence.value(QStringLiteral("trackedArtifactSha256"))},
                        {QStringLiteral("issues"), previewConflicts},
                    }) : QJsonValue(QJsonValue::Null)},
                    {QStringLiteral("message"), success ? (fileOperation
                        ? (filePreview ? QStringLiteral("File plan: %1 additions, %2 already current, %3 safe tracked updates, %4 untracked conflicts, %5 locally modified. %6 No files changed.")
                                .arg(evidence.value(QStringLiteral("missing")).toInt()).arg(evidence.value(QStringLiteral("current")).toInt())
                                .arg(evidence.value(QStringLiteral("managedUpdates")).toInt())
                                .arg(evidence.value(QStringLiteral("untrackedConflicts")).toInt())
                                .arg(evidence.value(QStringLiteral("modifiedConflicts")).toInt())
                                .arg(filePlanGuidance)
                            : (fileAudit ? QStringLiteral("Read-only destination audit: %1/%2 tracked current files verified, %3 missing, %4 modified, %5 older files retained. No OS installation attested.")
                                .arg(evidence.value(QStringLiteral("verified")).toInt())
                                .arg(evidence.value(QStringLiteral("tracked")).toInt() - evidence.value(QStringLiteral("retired")).toInt())
                                .arg(evidence.value(QStringLiteral("missing")).toInt())
                                .arg(evidence.value(QStringLiteral("modified")).toInt())
                                .arg(evidence.value(QStringLiteral("retired")).toInt())
                            : (fileRollback ? QStringLiteral("Tracked destination rollback completed; local edits were preserved.")
                                : QStringLiteral("Destination updated: %1 added, %2 replaced, %3 unchanged. No programs executed.")
                                    .arg(evidence.value(QStringLiteral("added")).toInt()).arg(evidence.value(QStringLiteral("replaced")).toInt()).arg(evidence.value(QStringLiteral("unchanged")).toInt()))))
                        : (managedOperation ? QStringLiteral("Server-authorized managed content selected. No executables ran and OS health is not attested.")
                        : (auditOnly ? (auditManaged ? QStringLiteral("Managed copy and staged source passed an independently signed read-only audit. No OS attestation.") : QStringLiteral("Existing staged bytes passed a read-only signed audit. Not installed or activated.")) : QStringLiteral("Verified and staged locally. Not installed or activated."))))
                        : QStringLiteral("Native verification refused: %1").arg(QString::fromUtf8(output).simplified().left(180))}};
                if (installerUpgradePreview) {
                    m_packageStageStatus.insert(QStringLiteral("message"), success
                        ? QStringLiteral("Signed MSI upgrade readiness verified for the exact retained predecessor: %1 to %2. Original installer checksum confirmed. READ-ONLY: no MSI operation, upgrade authority or rollback was issued.")
                            .arg(evidence.value(QStringLiteral("priorProductVersion")).toString(), evidence.value(QStringLiteral("targetProductVersion")).toString())
                        : QStringLiteral("Upgrade preflight blocked. No installer was executed. Re-inspect installation and retained source evidence."));
                    m_packageStageStatus.insert(QStringLiteral("note"), QStringLiteral("This review cannot execute an upgrade or attest application health. Known dependents and prior lifecycle operations block review."));
                }
                if (installerInstall || installerRepair || installerUninstall || installerUpgrade || installerRollback || installerPreview) {
                    m_packageStageStatus.insert(QStringLiteral("message"), success
                        ? (installerRollback ? QStringLiteral("Windows Installer returned from the signed rollback attempt. Original installation and upgrade receipts remain unchanged. No OS or application health is attested.") : installerInstall ? QStringLiteral("Windows Installer returned; MSI exit is NOT OS installation attestation. Review the local attempt receipt before further action.")
                            : installerUpgrade ? QStringLiteral("Windows Installer upgrade process exited. Successor registration and application health are not attested; inspect the retained upgrade journal before further action.")
                            : installerRepair ? QStringLiteral("Windows Installer repair process exited. Repair outcome is not OS or application-health attestation; inspect the retained lifecycle journal.")
                            : installerUninstall ? QStringLiteral("Windows Installer uninstall process exited. Product absence is not attested; inspect the retained lifecycle journal.")
                            : QStringLiteral("Signed staged MSI properties verified in read-only preview. No installer process was started."))
                        : QStringLiteral("Installer refused or outcome uncertain; review native helper and persisted attempt evidence."));
                    m_packageStageStatus.insert(QStringLiteral("note"), installerRollback
                        ? QStringLiteral("Rollback process exit does not verify a downgrade or application health. Both retained MSI sources and all journals require manual review; no retry.")
                        : installerUpgrade
                        ? QStringLiteral("Upgrade process exit does not prove successor health. Original installer retained; rollback requires separate authorization and manual evidence.")
                        : installerUninstall
                        ? QStringLiteral("Uninstall is irreversible and does not verify absence or detect all external software dependents.")
                        : installerRepair
                        ? QStringLiteral("Repair cannot be retried or rolled back automatically; custom MSI actions may run.")
                        : installerInstall
                        ? QStringLiteral("No automatic retry or cross-package rollback. Custom MSI actions may run.")
                        : QStringLiteral("Read-only signed installer inspection."));
                }
                if (success && fileOperation && !fileReadOnly) {
                    // Advisory only: persisted UI freshness is NOT signature or OS
                    // evidence. The Go helper still verifies everything per update.
                    QSettings destinations = packageDestinationStore();
                    destinations.setFallbacksEnabled(false);
                    destinations.beginGroup(profileId);
                    const QString recordedPath = destinations.value(expectedKey).toString();
                    if (!recordedPath.isEmpty() && recordedPath == evidence.value(QStringLiteral("destination")).toString()) {
                        QSettings history = packageUpdateHistoryStore();
                        history.setFallbacksEnabled(false);
                        history.beginGroup(profileId);
                        history.beginGroup(expectedKey);
                        if (fileRollback) {
                            history.remove(QString()); // rollback requires a new local verification to establish freshness
                        } else {
                            history.setValue(QStringLiteral("path"), recordedPath);
                            history.setValue(QStringLiteral("artifactSha256"), expectedSha);
                            history.setValue(QStringLiteral("version"), expectedVersion);
                            history.setValue(QStringLiteral("updatedAt"), QDateTime::currentDateTimeUtc().toString(Qt::ISODate));
                        }
                        history.sync();
                    }
                }
                emit eventReady(QString::fromUtf8(QJsonDocument(QJsonObject{{QStringLiteral("schema"), 1},
                    {QStringLiteral("event"), QStringLiteral("package.staging.changed")},
                    {QStringLiteral("profileId"), profileId}, {QStringLiteral("status"), m_packageStageStatus}}).toJson(QJsonDocument::Compact)));
                m_packageStageProcess = nullptr;
                if (m_packageIncomingKit && nowMs() - m_packageIncomingStartedAt >= MaxPackageKitAgeMs) {
                    delete m_packageIncomingKit; m_packageIncomingKit = nullptr;
                    m_packageIncomingReady = false; m_packageIncomingId.clear();
                }
                process->deleteLater();
            });
        process->start();
        if (!process->waitForStarted(250)) {
            m_packageStageProcess = nullptr;
            m_packageStageStatus = QJsonObject{{QStringLiteral("state"), QStringLiteral("failed")}};
            process->deleteLater();
            return fail(QStringLiteral("PACKAGE_HELPER_START_FAILED"), QStringLiteral("The native verifier could not start."));
        }
        // A signed Windows MSI is NOT an ordinary 30-second staging task.
        // The Go helper owns its bounded (15-minute) process deadline and a
        // kernel kill-on-close job. Qt must not kill an in-flight installer
        // arbitrarily and then mistake the child's unfinished OS work for a
        // trustworthy failure. The durable receipt remains unknown until
        // independently inspected after a crash or timeout.
        if (!installerInstall && !installerRepair && !installerUninstall && !installerUpgrade && !installerRollback) {
            QTimer::singleShot(managedOperation || fileOperation ? 60'000 : 30'000, process, [process] {
                if (process->state() != QProcess::NotRunning) process->kill();
            });
        }
        return QJsonObject{{QStringLiteral("accepted"), true}, {QStringLiteral("operationId"), operationId}};
    }

    if (capability == QStringLiteral("transfer.list"))
        return safeTransferItems();
    if (capability == QStringLiteral("transfer.status")) {
        if (!m_controller || !m_controller->transferManager())
            return fail(QStringLiteral("TRANSFER_UNAVAILABLE"), QStringLiteral("The transfer queue is unavailable."));
        TransferManager *manager = m_controller->transferManager();
        return QJsonObject{{QStringLiteral("writable"), manager->ownsQueue()},
                           {QStringLiteral("blockedReason"), manager->queueBlockedReason()}};
    }
    if (capability == QStringLiteral("transfer.claim")) {
        if (!m_controller || !m_controller->transferManager())
            return fail(QStringLiteral("TRANSFER_UNAVAILABLE"), QStringLiteral("The transfer queue is unavailable."));
        const bool writable = m_controller->transferManager()->retryOwnership();
        publishTransferEvent();
        return QJsonObject{{QStringLiteral("writable"), writable},
                           {QStringLiteral("blockedReason"), m_controller->transferManager()->queueBlockedReason()}};
    }

    if (capability == QStringLiteral("transfer.download")
        || capability == QStringLiteral("transfer.uploadProjectFile")) {
        if (!m_controller || !m_controller->nativeSessionReady() || !m_controller->transferManager())
            return fail(QStringLiteral("TRANSFER_SESSION_REQUIRED"),
                        QStringLiteral("Sign in to an active Cluster Desktop session before queuing a transfer."));
        TransferManager *manager = m_controller->transferManager();
        if (!manager->ownsQueue())
            return fail(QStringLiteral("TRANSFER_QUEUE_UNAVAILABLE"),
                        QStringLiteral("This window cannot write the native transfer journal. Check its status before retrying."));
        if (capability == QStringLiteral("transfer.download")) {
            const QString url = payload.value(QStringLiteral("url")).toString();
            const QString name = boundedText(payload.value(QStringLiteral("fileName")), 180);
            const QString sha = payload.value(QStringLiteral("checksumSha256")).toString().trimmed();
            static const QRegularExpression shaPattern(QStringLiteral("^[a-fA-F0-9]{64}$"));
            if (!cluster::desktop::request::sameServerApiPath(url.toStdString())
                || name.isEmpty() || name.size() > 180
                || (!sha.isEmpty() && !shaPattern.match(sha).hasMatch()))
                return fail(QStringLiteral("TRANSFER_DOWNLOAD_REQUEST_INVALID"),
                            QStringLiteral("Downloads require an authenticated relative /api/ path, a filename and an optional 64-character SHA-256."));
            const QString id = manager->startDownload(url, name, sha);
            if (id.isEmpty())
                return fail(QStringLiteral("TRANSFER_QUEUE_ADMISSION_FAILED"),
                            QStringLiteral("The native download could not be durably queued. No request was sent."));
            return QJsonObject{{QStringLiteral("accepted"), true}, {QStringLiteral("transferId"), id}};
        }
        const QString handle = boundedText(payload.value(QStringLiteral("handle")), 80);
        const LocalHandle *record = resolveHandle(handle);
        if (!record || record->directory || QFileInfo(record->path).isSymLink())
            return fail(QStringLiteral("TRANSFER_FILE_HANDLE_INVALID"),
                        QStringLiteral("Select an unexpired native file handle for this Desktop profile."));
        const QString filePath = canonicalExistingPath(record->path, false);
        const QFileInfo file(filePath);
        if (filePath.isEmpty() || !file.isFile() || !file.isReadable())
            return fail(QStringLiteral("TRANSFER_LOCAL_FILE_UNAVAILABLE"),
                        QStringLiteral("The selected file is unavailable or unreadable."));
        const QString projectId = boundedText(payload.value(QStringLiteral("projectId")), 80);
        static const QRegularExpression safeProjectId(QStringLiteral("^[A-Za-z0-9_-]{1,80}$"));
        if (!safeProjectId.match(projectId).hasMatch())
            return fail(QStringLiteral("TRANSFER_PROJECT_INVALID"), QStringLiteral("A valid project is required."));
        // Evidence link intent is journaled separately from upload metadata.
        // Neither the file finalizer nor the Desktop client grants resource access.
        QVariantMap evidenceIntent;
        const QString evidenceKind = boundedText(payload.value(QStringLiteral("evidenceForKind")), 40);
        const QString evidenceId = boundedText(payload.value(QStringLiteral("evidenceForId")), 200);
        const QString evidenceRelationship = boundedText(payload.value(QStringLiteral("evidenceRelationship")), 40);
        if (!evidenceKind.isEmpty() || !evidenceId.isEmpty() || !evidenceRelationship.isEmpty()) {
            static const QRegularExpression evidenceIdPattern(QStringLiteral("^[A-Za-z0-9_-]{1,200}$"));
            if (!QStringList{QStringLiteral("card"), QStringLiteral("ticket"), QStringLiteral("build"),
                             QStringLiteral("whiteboard"), QStringLiteral("qa_plan"), QStringLiteral("qa_session")}.contains(evidenceKind)
                || !evidenceIdPattern.match(evidenceId).hasMatch()
                || !QStringList{QStringLiteral("evidence_for"), QStringLiteral("references"),
                                QStringLiteral("informs"), QStringLiteral("supports")}.contains(evidenceRelationship))
                return fail(QStringLiteral("TRANSFER_EVIDENCE_INTENT_INVALID"), QStringLiteral("Invalid related-work evidence intent."));
            evidenceIntent = {{QStringLiteral("targetKind"), evidenceKind},
                              {QStringLiteral("targetId"), evidenceId},
                              {QStringLiteral("relationship"), evidenceRelationship}};
        }
        QJsonObject body;
        const QString title = boundedText(payload.value(QStringLiteral("title")), 180);
        const QString originalName = boundedText(payload.value(QStringLiteral("originalName")), 180);
        if (title.isEmpty() || originalName.isEmpty())
            return fail(QStringLiteral("TRANSFER_METADATA_INVALID"), QStringLiteral("An asset title and original filename are required."));
        body.insert(QStringLiteral("title"), title);
        body.insert(QStringLiteral("originalName"), originalName);
        body.insert(QStringLiteral("sizeBytes"), double(file.size()));
        body.insert(QStringLiteral("mimeType"), boundedText(payload.value(QStringLiteral("mimeType")), 128).isEmpty()
            ? QStringLiteral("application/octet-stream") : boundedText(payload.value(QStringLiteral("mimeType")), 128));
        const QString category = boundedText(payload.value(QStringLiteral("category")), 80);
        body.insert(QStringLiteral("category"), category.isEmpty() ? QStringLiteral("shared") : category);
        const QString role = boundedText(payload.value(QStringLiteral("assetRole")), 32);
        const QString status = boundedText(payload.value(QStringLiteral("status")), 32);
        const QStringList roles{QStringLiteral("source"), QStringLiteral("derived"), QStringLiteral("proxy"),
                                QStringLiteral("export"), QStringLiteral("reference"), QStringLiteral("deliverable")};
        const QStringList statuses{QStringLiteral("active"), QStringLiteral("review"), QStringLiteral("approved"),
                                   QStringLiteral("superseded"), QStringLiteral("archived")};
        if ((!role.isEmpty() && !roles.contains(role)) || (!status.isEmpty() && !statuses.contains(status)))
            return fail(QStringLiteral("TRANSFER_METADATA_INVALID"), QStringLiteral("Unsupported asset role or status."));
        body.insert(QStringLiteral("assetRole"), role.isEmpty() ? QStringLiteral("source") : role);
        body.insert(QStringLiteral("status"), status.isEmpty() ? QStringLiteral("active") : status);
        QJsonArray tags;
        if (!payload.value(QStringLiteral("tags")).isUndefined()) {
            if (!payload.value(QStringLiteral("tags")).isArray() || payload.value(QStringLiteral("tags")).toArray().size() > 40)
                return fail(QStringLiteral("TRANSFER_METADATA_INVALID"), QStringLiteral("Invalid asset tags."));
            for (const QJsonValue tag : payload.value(QStringLiteral("tags")).toArray()) {
                if (!tag.isString() || tag.toString().trimmed().isEmpty() || tag.toString().size() > 60)
                    return fail(QStringLiteral("TRANSFER_METADATA_INVALID"), QStringLiteral("Invalid asset tag."));
                tags.append(tag.toString().trimmed());
            }
        }
        body.insert(QStringLiteral("tags"), tags);
        for (const QString &field : {QStringLiteral("versionGroupId"), QStringLiteral("versionLabel"),
                                     QStringLiteral("derivedFromId"), QStringLiteral("proxyOfId"), QStringLiteral("exportOfId")}) {
            const QJsonValue value = payload.value(field);
            if (!value.isUndefined() && !value.isNull()) {
                if (!value.isString() || value.toString().size() > 100)
                    return fail(QStringLiteral("TRANSFER_METADATA_INVALID"), QStringLiteral("Invalid project asset lineage metadata."));
                body.insert(field, value);
            }
        }
        const QJsonValue version = payload.value(QStringLiteral("versionNumber"));
        if (!version.isUndefined() && !version.isNull()) {
            if (!version.isDouble() || version.toInteger(-1) <= 0 || version.toInteger(-1) > 1000000)
                return fail(QStringLiteral("TRANSFER_METADATA_INVALID"), QStringLiteral("Invalid asset version number."));
            body.insert(QStringLiteral("versionNumber"), version);
        }
        body.insert(QStringLiteral("duplicatePolicy"), QStringLiteral("reuse"));
        // The server authorizes project contribution and verifies the canonical
        // uploadId before accepting this metadata. Qt never grants permissions.
        const QString finalizePath = QStringLiteral("/api/projects/%1/files").arg(projectId);
        const QString id = manager->startUpload(filePath, QStringLiteral("project-file"), finalizePath, body.toVariantMap(), evidenceIntent);
        if (id.isEmpty())
            return fail(QStringLiteral("TRANSFER_QUEUE_ADMISSION_FAILED"),
                        QStringLiteral("The native upload could not be durably queued. No file bytes were sent."));
        return QJsonObject{{QStringLiteral("accepted"), true}, {QStringLiteral("transferId"), id}};
    }

    if (capability.startsWith(QStringLiteral("transfer."))) {
        if (!m_controller || !m_controller->transferManager())
            return fail(QStringLiteral("TRANSFER_UNAVAILABLE"), QStringLiteral("The native transfer queue is unavailable."));
        TransferManager *manager = m_controller->transferManager();
        if (!manager->ownsQueue() && capability != QStringLiteral("transfer.open")
            && capability != QStringLiteral("transfer.reveal")) {
            if (manager->queueBlockedReason() == QStringLiteral("journal-write-failed"))
                return fail(QStringLiteral("TRANSFER_QUEUE_JOURNAL_WRITE_FAILED"),
                            QStringLiteral("Cluster could not persist transfer progress. Network activity is held. Review available disk space and retry the queue claim to reload its last durable state; unfinished transfers will require manual resume."));
            if (manager->queueBlockedReason() == QStringLiteral("journal-invalid"))
                return fail(QStringLiteral("TRANSFER_QUEUE_JOURNAL_INVALID"),
                            QStringLiteral("The local transfer journal is invalid. Cluster has preserved it and blocked changes until an administrator repairs the file."));
            return fail(QStringLiteral("TRANSFER_OWNED_BY_ANOTHER_WINDOW"),
                        QStringLiteral("Another Cluster Desktop window owns this transfer queue. Use that window to change transfers."));
        }
        if (capability == QStringLiteral("transfer.retryAll")) {
            if (!manager->retryAll())
                return fail(QStringLiteral("TRANSFER_QUEUE_MUTATION_UNCOMMITTED"),
                            QStringLiteral("The transfer queue could not commit every requested change. Refresh its status; some earlier changes may have succeeded."));
            return QJsonObject{{QStringLiteral("updated"), true}};
        }
        const QString transferId = boundedText(payload.value(QStringLiteral("transferId")), 80);
        if (transferId.isEmpty())
            return fail(QStringLiteral("INVALID_PAYLOAD"), QStringLiteral("A transfer id is required."));
        bool committed = true;
        if (capability == QStringLiteral("transfer.pause")) committed = manager->pause(transferId);
        else if (capability == QStringLiteral("transfer.resume")) committed = manager->resume(transferId);
        else if (capability == QStringLiteral("transfer.retry")) committed = manager->retry(transferId);
        else if (capability == QStringLiteral("transfer.cancel")) committed = manager->cancel(transferId);
        else if (capability == QStringLiteral("transfer.remove")) committed = manager->remove(transferId);
        else if (capability == QStringLiteral("transfer.open")) {
            if (!manager->openResult(transferId)) return fail(QStringLiteral("TRANSFER_RESULT_UNAVAILABLE"), QStringLiteral("That completed download is no longer available."));
        } else if (capability == QStringLiteral("transfer.reveal")) {
            if (!manager->revealResult(transferId)) return fail(QStringLiteral("TRANSFER_RESULT_UNAVAILABLE"), QStringLiteral("That completed download is no longer available."));
        } else {
            return fail(QStringLiteral("CAPABILITY_DENIED"), QStringLiteral("That native transfer action is not exposed."));
        }
        if (!committed)
            return fail(QStringLiteral("TRANSFER_QUEUE_MUTATION_UNCOMMITTED"),
                        QStringLiteral("The transfer was not changed. Its queue may be held, or its state no longer permits this action. Refresh before retrying."));
        return QJsonObject{{QStringLiteral("updated"), true}};
    }

    if (capability == QStringLiteral("diagnostics.startup")) {
        const QVariantMap diagnostics = m_controller ? m_controller->startupDiagnostics() : QVariantMap{};
        return QJsonObject{
            {QStringLiteral("sessionId"), diagnostics.value(QStringLiteral("sessionId")).toString()},
            {QStringLiteral("crashStreak"), diagnostics.value(QStringLiteral("crashStreak")).toInt()},
            {QStringLiteral("safeModeRecommended"), diagnostics.value(QStringLiteral("safeModeRecommended")).toBool()},
            {QStringLiteral("version"), diagnostics.value(QStringLiteral("version")).toString()},
            {QStringLiteral("platform"), diagnostics.value(QStringLiteral("platform")).toString()},
            {QStringLiteral("cpuArchitecture"), diagnostics.value(QStringLiteral("cpuArchitecture")).toString()}
        };
    }

    if (capability == QStringLiteral("dialog.pickFiles")) {
        if (!consumeDialogBudget()) return fail(QStringLiteral("RATE_LIMITED"), QStringLiteral("Too many native file dialogs were requested."));
        const QString title = boundedText(payload.value(QStringLiteral("title")), 80).isEmpty()
            ? QStringLiteral("Choose files") : boundedText(payload.value(QStringLiteral("title")), 80);
        QFileDialog dialog(nullptr, title);
        dialog.setFileMode(payload.value(QStringLiteral("multiple")).toBool(false) ? QFileDialog::ExistingFiles : QFileDialog::ExistingFile);
        const QStringList filters = sanitizedNameFilters(payload);
        if (!filters.isEmpty()) dialog.setNameFilters(filters);
        if (dialog.exec() != QDialog::Accepted) return QJsonArray{};
        QJsonArray selected;
        const QStringList files = dialog.selectedFiles().mid(0, MaxSelectedFiles);
        for (const QString &file : files) {
            const QString handle = issueHandle(file, false);
            if (handle.isEmpty()) continue;
            const LocalHandle *record = resolveHandle(handle);
            if (record) selected.append(describeHandle(handle, *record));
        }
        return selected;
    }

    if (capability == QStringLiteral("dialog.pickDirectory")) {
        if (!consumeDialogBudget()) return fail(QStringLiteral("RATE_LIMITED"), QStringLiteral("Too many native file dialogs were requested."));
        const QString title = boundedText(payload.value(QStringLiteral("title")), 80).isEmpty()
            ? QStringLiteral("Choose folder") : boundedText(payload.value(QStringLiteral("title")), 80);
        const QString directory = QFileDialog::getExistingDirectory(nullptr, title, QString(), QFileDialog::ShowDirsOnly | QFileDialog::DontResolveSymlinks);
        if (directory.isEmpty()) return QJsonValue(QJsonValue::Null);
        const QString handle = issueHandle(directory, true);
        const LocalHandle *record = resolveHandle(handle);
        return record ? QJsonValue(describeHandle(handle, *record)) : fail(QStringLiteral("HANDLE_CREATE_FAILED"), QStringLiteral("The selected folder could not be opened safely."));
    }

    if (capability == QStringLiteral("dialog.saveFile")) {
        if (!consumeDialogBudget()) return fail(QStringLiteral("RATE_LIMITED"), QStringLiteral("Too many native file dialogs were requested."));
        const QString title = boundedText(payload.value(QStringLiteral("title")), 80).isEmpty()
            ? QStringLiteral("Save file") : boundedText(payload.value(QStringLiteral("title")), 80);
        QString suggestedName = boundedText(payload.value(QStringLiteral("suggestedName")), 160);
        suggestedName.replace(QRegularExpression(QStringLiteral("[\\/:*?\"<>|]")), QStringLiteral("_"));
        QFileDialog dialog(nullptr, title);
        dialog.setAcceptMode(QFileDialog::AcceptSave);
        dialog.setFileMode(QFileDialog::AnyFile);
        dialog.setOption(QFileDialog::DontConfirmOverwrite, false);
        const QStringList filters = sanitizedNameFilters(payload);
        if (!filters.isEmpty()) dialog.setNameFilters(filters);
        if (!suggestedName.isEmpty()) dialog.selectFile(suggestedName);
        if (dialog.exec() != QDialog::Accepted || dialog.selectedFiles().isEmpty()) return QJsonValue(QJsonValue::Null);
        const QString handle = issueDestinationHandle(dialog.selectedFiles().first());
        const LocalHandle *record = resolveHandle(handle);
        return record ? QJsonValue(describeHandle(handle, *record)) : fail(QStringLiteral("HANDLE_CREATE_FAILED"), QStringLiteral("The selected save destination could not be represented safely."));
    }

    if (capability == QStringLiteral("file.preview")) {
        const QString handle = boundedText(payload.value(QStringLiteral("handle")), 80);
        const LocalHandle *record = resolveHandle(handle);
        if (!record) return fail(QStringLiteral("INVALID_HANDLE"), QStringLiteral("The local file handle expired or does not belong to this server profile."));
        const QString canonical = canonicalExistingPath(record->path, record->directory);
        if (canonical.isEmpty()) return fail(QStringLiteral("LOCAL_ITEM_MISSING"), QStringLiteral("The selected local item no longer exists."));

        QFileInfo info(canonical);
        QJsonObject preview{
            {QStringLiteral("handle"), handle},
            {QStringLiteral("name"), info.fileName().isEmpty() ? info.absoluteDir().dirName() : info.fileName()},
            {QStringLiteral("kind"), record->directory ? QStringLiteral("directory") : QStringLiteral("file")},
            {QStringLiteral("modifiedAt"), info.lastModified().toUTC().toString(Qt::ISODateWithMs)},
            {QStringLiteral("readOnly"), !info.isWritable()},
        };
        if (record->directory) {
            preview.insert(QStringLiteral("previewKind"), QStringLiteral("directory"));
            return preview;
        }

        QMimeDatabase mimeDatabase;
        const QString mimeType = mimeDatabase.mimeTypeForFile(info).name();
        preview.insert(QStringLiteral("mimeType"), mimeType);
        preview.insert(QStringLiteral("sizeBytes"), static_cast<double>(std::max<qint64>(0, info.size())));
        preview.insert(QStringLiteral("extension"), info.suffix().left(24).toLower());

        if (mimeType.startsWith(QStringLiteral("image/"))) {
            QImageReader reader(canonical);
            const QSize size = reader.size();
            preview.insert(QStringLiteral("previewKind"), QStringLiteral("image"));
            if (size.isValid()) {
                preview.insert(QStringLiteral("width"), size.width());
                preview.insert(QStringLiteral("height"), size.height());
            }
            return preview;
        }

        const bool textLike = mimeType.startsWith(QStringLiteral("text/"))
            || QStringList{QStringLiteral("json"), QStringLiteral("md"), QStringLiteral("csv"), QStringLiteral("log"), QStringLiteral("xml"), QStringLiteral("yaml"), QStringLiteral("yml"), QStringLiteral("ini"), QStringLiteral("toml"), QStringLiteral("ts"), QStringLiteral("tsx"), QStringLiteral("js"), QStringLiteral("jsx"), QStringLiteral("cpp"), QStringLiteral("h"), QStringLiteral("hpp"), QStringLiteral("qml")}.contains(info.suffix().toLower());
        if (textLike) {
            QFile file(canonical);
            if (file.open(QIODevice::ReadOnly)) {
                const QByteArray sample = file.read(MaxNativePreviewBytes);
                QString text = QString::fromUtf8(sample).remove(QChar::Null);
                if (text.size() > MaxNativePreviewBytes) text.truncate(MaxNativePreviewBytes);
                preview.insert(QStringLiteral("previewKind"), QStringLiteral("text"));
                preview.insert(QStringLiteral("text"), text);
                preview.insert(QStringLiteral("truncated"), info.size() > MaxNativePreviewBytes);
                return preview;
            }
        }

        preview.insert(QStringLiteral("previewKind"), QStringLiteral("metadata"));
        return preview;
    }

    if (capability == QStringLiteral("file.open") || capability == QStringLiteral("file.reveal")) {
        const QString handle = boundedText(payload.value(QStringLiteral("handle")), 80);
        const LocalHandle *record = resolveHandle(handle);
        if (!record) return fail(QStringLiteral("INVALID_HANDLE"), QStringLiteral("The local file handle expired or does not belong to this server profile."));
        const QString canonical = canonicalExistingPath(record->path, record->directory);
        if (canonical.isEmpty()) return fail(QStringLiteral("LOCAL_ITEM_MISSING"), QStringLiteral("The selected local item no longer exists."));

        bool ok = false;
        if (capability == QStringLiteral("file.open")) {
            ok = QDesktopServices::openUrl(QUrl::fromLocalFile(canonical));
        } else {
#ifdef Q_OS_WIN
            if (record->directory) {
                ok = QDesktopServices::openUrl(QUrl::fromLocalFile(canonical));
            } else {
                QStringList args;
                args << QStringLiteral("/select,") << QDir::toNativeSeparators(canonical);
                ok = QProcess::startDetached(QStringLiteral("explorer.exe"), args);
            }
#else
            const QString parent = record->directory ? canonical : QFileInfo(canonical).absolutePath();
            ok = QDesktopServices::openUrl(QUrl::fromLocalFile(parent));
#endif
        }
        if (!ok) return fail(QStringLiteral("OS_ACTION_FAILED"), QStringLiteral("The operating system could not open that local item."));
        return QJsonObject{{QStringLiteral("ok"), true}};
    }


    if (capability == QStringLiteral("watch.start")) {
        if (!m_fileWatcher) return fail(QStringLiteral("WATCH_UNAVAILABLE"), QStringLiteral("Native file watching is unavailable."));
        const QString handle = boundedText(payload.value(QStringLiteral("handle")), 80);
        const LocalHandle *record = resolveHandle(handle);
        if (!record) return fail(QStringLiteral("INVALID_HANDLE"), QStringLiteral("The local file handle expired or does not belong to this server profile."));
        const QString canonical = canonicalExistingPath(record->path, record->directory);
        if (canonical.isEmpty()) return fail(QStringLiteral("LOCAL_ITEM_MISSING"), QStringLiteral("The selected local item no longer exists."));
        for (auto it = m_watchPaths.cbegin(); it != m_watchPaths.cend(); ++it) {
            if (it.value() == canonical) return QJsonObject{{QStringLiteral("watchId"), it.key()}, {QStringLiteral("kind"), m_watchKinds.value(it.key())}};
        }
        if (m_watchPaths.size() >= MaxNativeWatches) return fail(QStringLiteral("WATCH_LIMIT_REACHED"), QStringLiteral("Too many native file watches are active."));
        if (!m_fileWatcher->addPath(canonical)) return fail(QStringLiteral("WATCH_START_FAILED"), QStringLiteral("The operating system could not watch that local item."));
        const QString watchId = QStringLiteral("watch-%1").arg(QUuid::createUuid().toString(QUuid::WithoutBraces));
        m_watchPaths.insert(watchId, canonical);
        m_watchKinds.insert(watchId, record->directory ? QStringLiteral("directory") : QStringLiteral("file"));
        return QJsonObject{{QStringLiteral("watchId"), watchId}, {QStringLiteral("kind"), m_watchKinds.value(watchId)}};
    }

    if (capability == QStringLiteral("watch.stop")) {
        const QString watchId = boundedText(payload.value(QStringLiteral("watchId")), 80);
        const QString path = m_watchPaths.take(watchId);
        m_watchKinds.remove(watchId);
        if (path.isEmpty()) return fail(QStringLiteral("WATCH_NOT_FOUND"), QStringLiteral("That native file watch is not active."));
        if (m_fileWatcher) m_fileWatcher->removePath(path);
        return QJsonObject{{QStringLiteral("stopped"), true}};
    }

    if (capability == QStringLiteral("watch.list")) {
        QJsonArray watches;
        for (auto it = m_watchPaths.cbegin(); it != m_watchPaths.cend(); ++it)
            watches.append(QJsonObject{{QStringLiteral("watchId"), it.key()}, {QStringLiteral("kind"), m_watchKinds.value(it.key())}});
        return watches;
    }

    if (capability == QStringLiteral("clipboard.status")) {
        return QJsonObject{
            {QStringLiteral("available"), QGuiApplication::clipboard() != nullptr},
            {QStringLiteral("writeOnly"), false},
            {QStringLiteral("readText"), true},
            {QStringLiteral("readRequiresConfirmation"), true},
            {QStringLiteral("backgroundRead"), false},
            {QStringLiteral("maxTextCharacters"), MaxClipboardText},
        };
    }

    if (capability == QStringLiteral("clipboard.readText")) {
        if (!consumeDialogBudget())
            return fail(QStringLiteral("RATE_LIMITED"), QStringLiteral("Too many clipboard read requests were made."));
        QClipboard *clipboard = QGuiApplication::clipboard();
        if (!clipboard)
            return fail(QStringLiteral("CLIPBOARD_UNAVAILABLE"), QStringLiteral("The operating-system clipboard is unavailable."));
        QString purpose = boundedText(payload.value(QStringLiteral("purpose")), MaxClipboardReadPurpose);
        if (purpose.isEmpty()) purpose = QStringLiteral("use clipboard text in Cluster");
        QMessageBox confirmation(QMessageBox::Question,
                                 QStringLiteral("Allow clipboard access?"),
                                 QStringLiteral("Cluster wants to read plain text from your clipboard to %1. This is a one-time read and Cluster cannot monitor clipboard changes in the background.").arg(purpose),
                                 QMessageBox::Yes | QMessageBox::No);
        confirmation.setDefaultButton(QMessageBox::No);
        if (confirmation.exec() != QMessageBox::Yes)
            return fail(QStringLiteral("USER_CANCELLED"), QStringLiteral("Clipboard access was not granted."));
        const QString raw = clipboard->text(QClipboard::Clipboard);
        const bool truncated = raw.size() > MaxClipboardText;
        const QString text = raw.left(MaxClipboardText);
        return QJsonObject{
            {QStringLiteral("text"), text},
            {QStringLiteral("characters"), text.size()},
            {QStringLiteral("truncated"), truncated},
            {QStringLiteral("plainTextOnly"), true}
        };
    }

    if (capability == QStringLiteral("clipboard.writeText")) {
        if (!payload.value(QStringLiteral("text")).isString()) return fail(QStringLiteral("INVALID_PAYLOAD"), QStringLiteral("Clipboard text is required."));
        const QString text = payload.value(QStringLiteral("text")).toString();
        if (text.size() > MaxClipboardText) return fail(QStringLiteral("PAYLOAD_TOO_LARGE"), QStringLiteral("Clipboard text exceeded the native size limit."));
        QClipboard *clipboard = QGuiApplication::clipboard();
        if (!clipboard) return fail(QStringLiteral("CLIPBOARD_UNAVAILABLE"), QStringLiteral("The operating-system clipboard is unavailable."));
        clipboard->setText(text);
        return QJsonObject{{QStringLiteral("written"), true}};
    }

    if (capability == QStringLiteral("navigation.back")) {
        emit navigateBackRequested();
        return QJsonObject{{QStringLiteral("requested"), true}};
    }
    if (capability == QStringLiteral("navigation.forward")) {
        emit navigateForwardRequested();
        return QJsonObject{{QStringLiteral("requested"), true}};
    }

    if (capability == QStringLiteral("notification.status")) {
        const bool available = QSystemTrayIcon::isSystemTrayAvailable();
        const bool enabled = m_controller && m_controller->desktopPreferences()->notificationsEnabled();
        return QJsonObject{
            {QStringLiteral("available"), available},
            {QStringLiteral("enabled"), enabled},
            {QStringLiteral("appActive"), QGuiApplication::applicationState() == Qt::ApplicationActive},
        };
    }

    if (capability == QStringLiteral("notification.show")) {
        if (!QSystemTrayIcon::isSystemTrayAvailable())
            return fail(QStringLiteral("NOTIFICATIONS_UNAVAILABLE"), QStringLiteral("Operating-system notifications are unavailable on this desktop session."));
        if (!m_controller || !m_controller->desktopPreferences()->notificationsEnabled())
            return fail(QStringLiteral("NOTIFICATIONS_DISABLED"), QStringLiteral("Desktop notifications are disabled."));
        const QString title = boundedText(payload.value(QStringLiteral("title")), MaxNotificationTitle);
        const QString body = boundedText(payload.value(QStringLiteral("body")), MaxNotificationBody);
        const QString route = boundedText(payload.value(QStringLiteral("route")), MaxRouteLength);
        const QString tag = boundedText(payload.value(QStringLiteral("tag")), MaxNotificationTag);
        QString priority = boundedText(payload.value(QStringLiteral("priority")), 16).toLower();
        if (priority != QStringLiteral("critical") && priority != QStringLiteral("high") && priority != QStringLiteral("medium"))
            priority = QStringLiteral("normal");
        if (title.isEmpty()) return fail(QStringLiteral("INVALID_PAYLOAD"), QStringLiteral("A notification title is required."));
        if (!route.isEmpty() && !safeRoute(route)) return fail(QStringLiteral("INVALID_ROUTE"), QStringLiteral("The notification route is invalid."));
        if (!tag.isEmpty() && m_seenNotificationTags.contains(tag))
            return QJsonObject{{QStringLiteral("shown"), false}, {QStringLiteral("duplicate"), true}};

        if (!tag.isEmpty()) {
            m_seenNotificationTags.insert(tag);
            m_seenNotificationTagOrder.enqueue(tag);
            while (m_seenNotificationTagOrder.size() > MaxSeenNotificationTags)
                m_seenNotificationTags.remove(m_seenNotificationTagOrder.dequeue());
        }

        // If Cluster is already the active foreground application, the in-app inbox and
        // badge are the less disruptive surface. Critical events are still allowed through.
        if (QGuiApplication::applicationState() == Qt::ApplicationActive && priority != QStringLiteral("critical"))
            return QJsonObject{{QStringLiteral("shown"), false}, {QStringLiteral("suppressed"), QStringLiteral("app-active")}};
        if (!consumeNotificationBudget())
            return fail(QStringLiteral("RATE_LIMITED"), QStringLiteral("Too many native notifications were requested."));
        emit notificationRequested(title, body, route, tag, priority);
        return QJsonObject{{QStringLiteral("shown"), true}};
    }

    if (capability == QStringLiteral("window.appSettings")) {
        emit showAppSettingsRequested();
        return QJsonObject{{QStringLiteral("opened"), true}};
    }
    if (capability == QStringLiteral("window.serverProfiles")) {
        emit showServerProfilesRequested();
        return QJsonObject{{QStringLiteral("opened"), true}};
    }
    if (capability == QStringLiteral("window.reload")) {
        emit reloadRendererRequested();
        return QJsonObject{{QStringLiteral("requested"), true}};
    }

    return fail(QStringLiteral("CAPABILITY_DENIED"), QStringLiteral("That native capability is not exposed by Cluster Desktop."));
}

void NativeCapabilityBroker::clearWatches()
{
    if (m_fileWatcher) {
        const QStringList watched = m_watchPaths.values();
        if (!watched.isEmpty()) m_fileWatcher->removePaths(watched);
    }
    m_watchPaths.clear();
    m_watchKinds.clear();
}

void NativeCapabilityBroker::publishWatchEvent(const QString &path, const QString &kind)
{
    QString watchId;
    for (auto it = m_watchPaths.cbegin(); it != m_watchPaths.cend(); ++it) {
        if (it.value() == path) { watchId = it.key(); break; }
    }
    if (watchId.isEmpty()) return;

    const bool exists = QFileInfo::exists(path);
    if (!QFileInfo::exists(path)) {
        m_watchPaths.remove(watchId);
        m_watchKinds.remove(watchId);
    } else if (m_fileWatcher && !m_fileWatcher->files().contains(path) && !m_fileWatcher->directories().contains(path)) {
        // QFileSystemWatcher can drop a file watch after atomic replacement; re-arm it while the selected item still exists.
        m_fileWatcher->addPath(path);
    }

    const QJsonObject event{
        {QStringLiteral("schema"), 1},
        {QStringLiteral("event"), QStringLiteral("watch.changed")},
        {QStringLiteral("watchId"), watchId},
        {QStringLiteral("kind"), kind},
        {QStringLiteral("changedAt"), QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs)},
        {QStringLiteral("exists"), exists}
    };
    emit eventReady(QString::fromUtf8(QJsonDocument(event).toJson(QJsonDocument::Compact)));
}


void NativeCapabilityBroker::acceptDroppedUrls(const QVariantList &urls)
{
    if (!m_controller || !m_controller->serverProfiles() || m_controller->serverProfiles()->activeProfileId().isEmpty()) return;
    QJsonArray items;
    int accepted = 0;
    for (const QVariant &value : urls) {
        if (accepted >= MaxDroppedItems) break;
        const QUrl url = value.toUrl();
        if (!url.isValid() || !url.isLocalFile()) continue;
        const QString path = url.toLocalFile();
        const QFileInfo info(path);
        if (!info.exists() || (!info.isFile() && !info.isDir())) continue;
        const QString handle = issueHandle(path, info.isDir());
        const LocalHandle *record = resolveHandle(handle);
        if (!record) continue;
        items.append(describeHandle(handle, *record));
        ++accepted;
    }
    if (items.isEmpty()) return;
    const QJsonObject event{
        {QStringLiteral("schema"), 1},
        {QStringLiteral("event"), QStringLiteral("filesystem.drop")},
        {QStringLiteral("profileId"), m_controller->serverProfiles()->activeProfileId()},
        {QStringLiteral("items"), items}
    };
    emit eventReady(QString::fromUtf8(QJsonDocument(event).toJson(QJsonDocument::Compact)));
    writeAudit(QStringLiteral("filesystem.drop"), true, QStringLiteral("items=%1").arg(items.size()));
}

void NativeCapabilityBroker::processRequestJson(const QString &requestJson, const QString &rendererUrl)
{
    QString requestId = QStringLiteral("invalid-request");
    QString capability = QStringLiteral("unknown");

    if (!m_controller || !m_controller->isAllowedRendererUrl(rendererUrl)) {
        emit responseReady(errorResponse(requestId, QStringLiteral("ORIGIN_DENIED"), QStringLiteral("Native capabilities are only available to the active Cluster server origin.")));
        writeAudit(capability, false, QStringLiteral("origin-denied"));
        return;
    }
    // Only an explicitly named bounded Package transfer chunk can use the
    // larger envelope; every other native capability keeps the 16 KiB cap.
    const bool kitChunkEnvelope = requestJson.contains(QStringLiteral("\"capability\":\"package.kit.chunk\""));
    const bool archiveChunkEnvelope = requestJson.contains(QStringLiteral("\"capability\":\"package.transfer.append\""));
    if (requestJson.toUtf8().size() > (archiveChunkEnvelope ? MaxArchiveChunkRequestBytes : (kitChunkEnvelope ? MaxKitChunkRequestBytes : MaxRequestBytes))) {
        emit responseReady(errorResponse(requestId, QStringLiteral("REQUEST_TOO_LARGE"), QStringLiteral("Native capability request exceeded the size limit.")));
        writeAudit(capability, false, QStringLiteral("request-too-large"));
        return;
    }
    if (!consumeRequestBudget()) {
        emit responseReady(errorResponse(requestId, QStringLiteral("RATE_LIMITED"), QStringLiteral("Native capability request rate exceeded.")));
        writeAudit(capability, false, QStringLiteral("rate-limited"));
        return;
    }

    QJsonParseError parseError;
    const QJsonDocument document = QJsonDocument::fromJson(requestJson.toUtf8(), &parseError);
    if (parseError.error != QJsonParseError::NoError || !document.isObject()) {
        emit responseReady(errorResponse(requestId, QStringLiteral("INVALID_JSON"), QStringLiteral("Native capability request was not valid JSON.")));
        writeAudit(capability, false, QStringLiteral("invalid-json"));
        return;
    }

    const QJsonObject request = document.object();
    static const QSet<QString> requestFields{QStringLiteral("schema"), QStringLiteral("id"), QStringLiteral("capability"), QStringLiteral("payload"), QStringLiteral("profileId"), QStringLiteral("brokerEpoch")};
    for (auto field = request.constBegin(); field != request.constEnd(); ++field) {
        if (!requestFields.contains(field.key())) {
            emit responseReady(errorResponse(requestId, QStringLiteral("INVALID_REQUEST_ENVELOPE"), QStringLiteral("Native capability request contained an unsupported envelope field.")));
            writeAudit(capability, false, QStringLiteral("request-envelope"));
            return;
        }
    }
    requestId = boundedText(request.value(QStringLiteral("id")), 80);
    capability = boundedText(request.value(QStringLiteral("capability")), 80);
    if (request.value(QStringLiteral("schema")).toInt() != 1) {
        emit responseReady(errorResponse(requestId, QStringLiteral("UNSUPPORTED_SCHEMA"), QStringLiteral("Native capability protocol version is not supported.")));
        writeAudit(capability, false, QStringLiteral("schema"));
        return;
    }
    if (!acceptRequestId(requestId)) {
        emit responseReady(errorResponse(requestId.isEmpty() ? QStringLiteral("invalid-request") : requestId, QStringLiteral("INVALID_REQUEST_ID"), QStringLiteral("Native capability request ID was invalid or already used.")));
        writeAudit(capability, false, QStringLiteral("request-id"));
        return;
    }
    if (!capabilities().contains(capability)) {
        emit responseReady(errorResponse(requestId, QStringLiteral("CAPABILITY_DENIED"), QStringLiteral("That native capability is not exposed by Cluster Desktop.")));
        writeAudit(capability, false, QStringLiteral("not-allowlisted"));
        return;
    }

    const QJsonObject payload = request.value(QStringLiteral("payload")).isObject() ? request.value(QStringLiteral("payload")).toObject() : QJsonObject{};
    if (QJsonDocument(payload).toJson(QJsonDocument::Compact).size() >
        (capability == QStringLiteral("package.transfer.append") ? MaxArchiveChunkPayloadBytes : (capability == QStringLiteral("package.kit.chunk") ? MaxKitChunkPayloadBytes : MaxPayloadBytes))) {
        emit responseReady(errorResponse(requestId, QStringLiteral("PAYLOAD_TOO_LARGE"), QStringLiteral("Native capability payload exceeded the size limit.")));
        writeAudit(capability, false, QStringLiteral("payload-too-large"));
        return;
    }
    QString payloadShapeError;
    if (!validatePayloadShape(capability, payload, &payloadShapeError)) {
        emit responseReady(errorResponse(requestId, QStringLiteral("INVALID_PAYLOAD"), payloadShapeError));
        writeAudit(capability, false, QStringLiteral("payload-schema"));
        return;
    }
    if (capability != QStringLiteral("runtime.info")) {
        const QString requestProfileId = boundedText(request.value(QStringLiteral("profileId")), 80);
        const QString brokerEpoch = boundedText(request.value(QStringLiteral("brokerEpoch")), 80);
        const QString activeProfileId = m_controller && m_controller->serverProfiles() ? m_controller->serverProfiles()->activeProfileId() : QString();
        if (activeProfileId.isEmpty() || requestProfileId != activeProfileId) {
            emit responseReady(errorResponse(requestId, QStringLiteral("PROFILE_CONTEXT_MISMATCH"), QStringLiteral("The native request was created for a different server profile.")));
            writeAudit(capability, false, QStringLiteral("profile-context"));
            return;
        }
        if (brokerEpoch.isEmpty() || brokerEpoch != m_brokerEpoch) {
            emit responseReady(errorResponse(requestId, QStringLiteral("BROKER_EPOCH_EXPIRED"), QStringLiteral("The native request belongs to an expired desktop capability session.")));
            writeAudit(capability, false, QStringLiteral("broker-epoch"));
            return;
        }
    }

    purgeExpiredHandles();
    QString errorCode;
    QString errorMessage;
    const QJsonValue result = dispatch(capability, payload, &errorCode, &errorMessage);
    if (!errorCode.isEmpty()) {
        emit responseReady(errorResponse(requestId, errorCode, errorMessage));
        writeAudit(capability, false, errorCode);
        return;
    }
    emit responseReady(successResponse(requestId, result));
    writeAudit(capability, true);
}

void NativeCapabilityBroker::writeAudit(const QString &capability, bool ok, const QString &detail) const
{
    const QString path = brokerLogPath();
    QDir().mkpath(QFileInfo(path).absolutePath());
    QFile file(path);
    if (!file.open(QIODevice::WriteOnly | QIODevice::Append | QIODevice::Text)) return;
    const QString profile = m_controller && m_controller->serverProfiles() ? m_controller->serverProfiles()->activeProfileId() : QStringLiteral("none");
    const QString line = QStringLiteral("%1\tprofile=%2\tcapability=%3\tresult=%4%5\n")
        .arg(QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs),
             profile.left(40), capability.left(80), ok ? QStringLiteral("ok") : QStringLiteral("denied"),
             detail.isEmpty() ? QString() : QStringLiteral("\tdetail=%1").arg(detail.left(80)));
    file.write(line.toUtf8());
}
