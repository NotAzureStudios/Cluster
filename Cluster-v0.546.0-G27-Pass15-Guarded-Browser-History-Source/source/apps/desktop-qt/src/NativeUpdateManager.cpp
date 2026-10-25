#include "NativeUpdateManager.h"
#include "DesktopPreferences.h"

#include <QCoreApplication>
#include <QDateTime>
#include <QDesktopServices>
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonParseError>
#include <QNetworkAccessManager>
#include <QNetworkReply>
#include <QNetworkRequest>
#include <QProcess>
#include <QRegularExpression>
#include <QSaveFile>
#include <QSettings>
#include <QStandardPaths>
#include <QUrl>
#include <QVersionNumber>

namespace {
constexpr qint64 MaxManifestBytes = 256 * 1024;
constexpr qint64 MaxArtifactBytes = 2LL * 1024LL * 1024LL * 1024LL;
constexpr int MaxRecoveryLaunchAttempts = 3;
const QString UpdatePrefix = QStringLiteral("desktop/updateTransaction/");

QString safeFileName(const QString &value)
{
    QString name = QFileInfo(value).fileName().trimmed();
    if (name.isEmpty()) name = QStringLiteral("Cluster-Update.bin");
    name.replace(QChar(u'/'), QChar(u'_'));
    name.replace(QChar(u'\\'), QChar(u'_'));
    return name;
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

QString architectureName()
{
#if defined(Q_PROCESSOR_X86_64)
    return QStringLiteral("x64");
#elif defined(Q_PROCESSOR_ARM_64)
    return QStringLiteral("arm64");
#else
    return QStringLiteral("unsupported");
#endif
}

bool validSha256(const QString &value)
{
    static const QRegularExpression pattern(QStringLiteral("^[0-9a-fA-F]{64}$"));
    return pattern.match(value).hasMatch();
}

qint64 artifactSize(const QJsonObject &artifact)
{
    const QJsonValue value = artifact.value(QStringLiteral("size"));
    if (!value.isDouble()) return -1;
    const double number = value.toDouble(-1);
    if (number < 0 || number > static_cast<double>(MaxArtifactBytes)) return -1;
    const qint64 converted = static_cast<qint64>(number);
    return static_cast<double>(converted) == number ? converted : -1;
}
}

NativeUpdateManager::NativeUpdateManager(DesktopPreferences *preferences, QObject *parent)
    : QObject(parent)
    , m_preferences(preferences)
    , m_network(new QNetworkAccessManager(this))
{
    m_network->setTransferTimeout(30'000);
    loadRecoveryState();
}

QString NativeUpdateManager::state() const { return m_state; }
QString NativeUpdateManager::message() const { return m_message; }
QString NativeUpdateManager::availableVersion() const { return m_availableVersion; }
QString NativeUpdateManager::previousVersion() const { return m_previousVersion; }
bool NativeUpdateManager::updateAvailable() const { return !m_artifact.isEmpty() && isNewerVersion(m_availableVersion, QCoreApplication::applicationVersion()); }
bool NativeUpdateManager::busy() const
{
    return m_state == QStringLiteral("checking")
        || m_state == QStringLiteral("downloading")
        || m_state == QStringLiteral("verifying")
        || m_state == QStringLiteral("applying")
        || m_state == QStringLiteral("rolling-back");
}
bool NativeUpdateManager::recoveryRequired() const
{
    return m_state == QStringLiteral("awaiting-health")
        || m_state == QStringLiteral("rollback-ready")
        || (m_state == QStringLiteral("failed") && !m_previousVersion.isEmpty());
}
bool NativeUpdateManager::rollbackReady() const
{
    return recoveryRequired() && !m_rollbackPath.isEmpty() && QFileInfo::exists(m_rollbackPath) && validSha256(m_rollbackSha256);
}
qreal NativeUpdateManager::progress() const { return m_progress; }
QString NativeUpdateManager::downloadedPath() const { return m_downloadedPath; }

void NativeUpdateManager::checkForUpdates()
{
    if (busy() || recoveryRequired()) return;
    const QUrl manifestUrl(m_preferences ? m_preferences->updateFeedUrl() : QString());
    if (!allowedFeedUrl(manifestUrl)) {
        setState(QStringLiteral("error"), QStringLiteral("Configure a credential-free HTTPS release-manifest URL in Desktop settings."));
        return;
    }
    setState(QStringLiteral("checking"), QStringLiteral("Checking the signed Cluster release feed…"));
    QNetworkRequest request(manifestUrl);
    request.setRawHeader(QByteArrayLiteral("Accept"), QByteArrayLiteral("application/json"));
    request.setRawHeader(QByteArrayLiteral("Cache-Control"), QByteArrayLiteral("no-cache"));
    request.setHeader(QNetworkRequest::UserAgentHeader, QStringLiteral("ClusterDesktop/%1 QtUpdater").arg(QCoreApplication::applicationVersion()));
    request.setAttribute(QNetworkRequest::CacheLoadControlAttribute, QNetworkRequest::AlwaysNetwork);
    request.setAttribute(QNetworkRequest::RedirectPolicyAttribute, QNetworkRequest::SameOriginRedirectPolicy);
    QNetworkReply *reply = m_network->get(request);
    connect(reply, &QNetworkReply::finished, this, [this, reply, manifestUrl] { handleManifest(reply, manifestUrl); });
}

void NativeUpdateManager::downloadUpdate()
{
    if (m_artifact.isEmpty() || busy() || recoveryRequired()) return;
    QDir().mkpath(updateDirectory());
    const QString target = updateDirectory() + QLatin1Char('/') + safeFileName(m_artifact.value(QStringLiteral("filename")).toString());
    beginArtifactDownload(m_artifact, target, false);
}

void NativeUpdateManager::installUpdate()
{
    if (m_downloadedPath.isEmpty() || !QFileInfo::exists(m_downloadedPath)) {
        setState(QStringLiteral("error"), QStringLiteral("Download and verify the update before installing it."));
        return;
    }

    QString verificationError;
    if (!verifyArtifactFile(m_downloadedPath, m_artifact.value(QStringLiteral("sha256")).toString(), &verificationError)) {
        QFile::remove(m_downloadedPath);
        m_downloadedPath.clear();
        setState(QStringLiteral("error"), QStringLiteral("The downloaded update changed after verification. Download it again."));
        return;
    }

    const QString kind = m_artifact.value(QStringLiteral("kind")).toString();
    const bool installer = kind == QStringLiteral("installer")
        || m_downloadedPath.endsWith(QStringLiteral(".exe"), Qt::CaseInsensitive)
        || m_downloadedPath.endsWith(QStringLiteral(".dmg"), Qt::CaseInsensitive)
        || m_downloadedPath.endsWith(QStringLiteral(".deb"), Qt::CaseInsensitive);

    if (installer) {
        if (m_rollbackPath.isEmpty() || !QFileInfo::exists(m_rollbackPath) || !validSha256(m_rollbackSha256)) {
            setState(QStringLiteral("error"), QStringLiteral("The verified rollback installer is missing. Re-download the update before installing."));
            return;
        }
        if (!verifyArtifactFile(m_rollbackPath, m_rollbackSha256, &verificationError)) {
            QFile::remove(m_rollbackPath);
            m_rollbackPath.clear();
            m_rollbackSha256.clear();
            setState(QStringLiteral("error"), QStringLiteral("The rollback installer changed after verification. Re-download the update before installing."));
            return;
        }
        if (!persistPendingInstall(&verificationError)) {
            setState(QStringLiteral("error"), verificationError);
            return;
        }
        if (!QProcess::startDetached(m_downloadedPath, {})) {
            clearRecoveryState(false);
            setState(QStringLiteral("error"), QStringLiteral("The verified installer could not be started."));
            return;
        }
        setState(QStringLiteral("applying"), QStringLiteral("The verified installer is open. Cluster will verify the new runtime on the next launch."));
        QCoreApplication::quit();
        return;
    }

    QDesktopServices::openUrl(QUrl::fromLocalFile(QFileInfo(m_downloadedPath).absolutePath()));
    setState(QStringLiteral("ready"), QStringLiteral("The verified portable update is ready in the update folder."));
}

void NativeUpdateManager::rollbackUpdate()
{
    if (!rollbackReady() || busy()) {
        if (recoveryRequired())
            setState(QStringLiteral("failed"), QStringLiteral("The rollback installer is unavailable. Repair or reinstall Cluster Desktop manually."));
        return;
    }

    QString verificationError;
    if (!verifyArtifactFile(m_rollbackPath, m_rollbackSha256, &verificationError)) {
        QFile::remove(m_rollbackPath);
        m_rollbackPath.clear();
        m_rollbackSha256.clear();
        setState(QStringLiteral("failed"), QStringLiteral("The rollback installer failed integrity verification. Repair or reinstall Cluster Desktop manually."));
        return;
    }

    QSettings settings;
    settings.setValue(UpdatePrefix + QStringLiteral("status"), QStringLiteral("rolling-back"));
    settings.sync();
    if (settings.status() != QSettings::NoError) {
        setState(QStringLiteral("failed"), QStringLiteral("Cluster could not persist rollback state. The rollback was not started."));
        return;
    }

    if (!QProcess::startDetached(m_rollbackPath, {})) {
        settings.setValue(UpdatePrefix + QStringLiteral("status"), QStringLiteral("awaiting-health"));
        settings.sync();
        setState(QStringLiteral("failed"), QStringLiteral("The verified rollback installer could not be started."));
        return;
    }
    setState(QStringLiteral("rolling-back"), QStringLiteral("Rolling back to Cluster %1. Cluster will now close.").arg(m_previousVersion));
    QCoreApplication::quit();
}

void NativeUpdateManager::markRuntimeHealthy()
{
    if (m_state != QStringLiteral("awaiting-health") && m_state != QStringLiteral("rollback-ready")) return;
    if (QCoreApplication::applicationVersion() != m_availableVersion) return;

    const QString healthyVersion = m_availableVersion;
    clearRecoveryState(true);
    m_previousVersion.clear();
    setState(QStringLiteral("healthy"), QStringLiteral("Cluster %1 passed the desktop runtime health check. Rollback data was retired.").arg(healthyVersion));
}

void NativeUpdateManager::recordStartupFailure(const QString &reason)
{
    if (m_state != QStringLiteral("awaiting-health") && m_state != QStringLiteral("rollback-ready")) return;
    QSettings settings;
    const int failures = qBound(1, settings.value(UpdatePrefix + QStringLiteral("startupFailures"), 0).toInt() + 1, 99);
    settings.setValue(UpdatePrefix + QStringLiteral("startupFailures"), failures);
    settings.setValue(UpdatePrefix + QStringLiteral("lastStartupFailure"), reason.left(1000));
    settings.setValue(UpdatePrefix + QStringLiteral("lastStartupFailureAt"), QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs));
    settings.sync();
    if (failures >= 2 && rollbackReady()) {
        setState(QStringLiteral("rollback-ready"), QStringLiteral("The updated Cluster runtime failed during startup %1 times. Rollback to %2 is ready.").arg(failures).arg(m_previousVersion));
    }
}

void NativeUpdateManager::discardDownload()
{
    if (recoveryRequired()) return;
    if (m_activeReply) m_activeReply->abort();
    if (m_activeFile) {
        m_activeFile->close();
        m_activeFile->deleteLater();
        m_activeFile = nullptr;
    }
    if (!m_downloadedPath.isEmpty()) QFile::remove(m_downloadedPath);
    if (!m_rollbackPath.isEmpty()) QFile::remove(m_rollbackPath);
    m_downloadedPath.clear();
    m_rollbackPath.clear();
    m_rollbackSha256.clear();
    m_progress = 0;
    emit progressChanged();
    setState(m_artifact.isEmpty() ? QStringLiteral("idle") : QStringLiteral("available"),
             m_artifact.isEmpty() ? QString() : QStringLiteral("Cluster %1 is available.").arg(m_availableVersion));
}

void NativeUpdateManager::setState(const QString &state, const QString &message)
{
    m_state = state;
    m_message = message;
    emit stateChanged();
}

void NativeUpdateManager::handleManifest(QNetworkReply *reply, const QUrl &manifestUrl)
{
    const int status = reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
    if (!sameOrigin(reply->url(), manifestUrl)) {
        setState(QStringLiteral("error"), QStringLiteral("The update feed redirected outside its configured origin."));
        reply->deleteLater();
        return;
    }
    const qint64 contentLength = reply->header(QNetworkRequest::ContentLengthHeader).toLongLong();
    if (contentLength > MaxManifestBytes) {
        setState(QStringLiteral("error"), QStringLiteral("The update manifest exceeded the allowed size."));
        reply->deleteLater();
        return;
    }
    const QByteArray body = reply->readAll();
    if (reply->error() != QNetworkReply::NoError || status < 200 || status >= 300) {
        setState(QStringLiteral("error"), QStringLiteral("The update feed could not be read: %1").arg(reply->errorString()));
        reply->deleteLater();
        return;
    }
    if (body.isEmpty() || body.size() > MaxManifestBytes) {
        setState(QStringLiteral("error"), QStringLiteral("The update manifest is empty or exceeds the allowed size."));
        reply->deleteLater();
        return;
    }

    QDir().mkpath(updateDirectory());
    const QString manifestPath = updateDirectory() + QStringLiteral("/RELEASE_MANIFEST.json");
    QSaveFile manifestFile(manifestPath);
    if (!manifestFile.open(QIODevice::WriteOnly) || manifestFile.write(body) != body.size() || !manifestFile.commit()) {
        setState(QStringLiteral("error"), QStringLiteral("The update manifest could not be saved for verification."));
        reply->deleteLater();
        return;
    }
    QString verificationError;
    if (!verifyManifestFile(manifestPath, &verificationError)) {
        setState(QStringLiteral("error"), verificationError);
        reply->deleteLater();
        return;
    }

    QJsonParseError parseError;
    const QJsonDocument document = QJsonDocument::fromJson(body, &parseError);
    if (parseError.error != QJsonParseError::NoError || !document.isObject()) {
        setState(QStringLiteral("error"), QStringLiteral("The signed update manifest is not valid JSON."));
        reply->deleteLater();
        return;
    }
    const QJsonObject manifest = document.object();
    if (manifest.value(QStringLiteral("schemaVersion")).toInt() != 1
        || manifest.value(QStringLiteral("product")).toString() != QStringLiteral("cluster-desktop")) {
        setState(QStringLiteral("error"), QStringLiteral("The signed update manifest does not match Cluster Desktop update protocol 1."));
        reply->deleteLater();
        return;
    }

    m_availableVersion = manifest.value(QStringLiteral("version")).toString();
    m_artifact = QJsonObject{};
    m_rollbackArtifact = QJsonObject{};
    const QString current = QCoreApplication::applicationVersion();
    for (const QJsonValue &value : manifest.value(QStringLiteral("artifacts")).toArray()) {
        if (!value.isObject()) continue;
        const QJsonObject rawArtifact = value.toObject();
        const bool rollback = rawArtifact.value(QStringLiteral("kind")).toString() == QStringLiteral("rollback");
        QJsonObject artifact;
        QString artifactError;
        if (!validateArtifact(rawArtifact, manifestUrl, rollback, &artifactError, &artifact))
            continue;
        if (rollback && artifact.value(QStringLiteral("version")).toString() == current) {
            if (m_rollbackArtifact.isEmpty()) m_rollbackArtifact = artifact;
            continue;
        }
        if (!rollback && artifact.value(QStringLiteral("version")).toString() == m_availableVersion) {
            const QString kind = artifact.value(QStringLiteral("kind")).toString();
            if (m_artifact.isEmpty() || kind == QStringLiteral("installer")) m_artifact = artifact;
        }
    }

    if (!isNewerVersion(m_availableVersion, current)) {
        m_artifact = QJsonObject{};
        m_rollbackArtifact = QJsonObject{};
        setState(QStringLiteral("current"), QStringLiteral("Cluster Desktop %1 is current.").arg(current));
    } else if (m_artifact.isEmpty()) {
        setState(QStringLiteral("error"), QStringLiteral("The signed release does not contain a compatible %1/%2 desktop artifact.").arg(platformName(), architectureName()));
    } else if (m_artifact.value(QStringLiteral("kind")).toString() == QStringLiteral("installer") && m_rollbackArtifact.isEmpty()) {
        m_artifact = QJsonObject{};
        setState(QStringLiteral("error"), QStringLiteral("The signed release is missing the rollback installer required for a safe desktop update."));
    } else {
        setState(QStringLiteral("available"), QStringLiteral("Cluster %1 is available.").arg(m_availableVersion));
    }
    reply->deleteLater();
}

void NativeUpdateManager::beginArtifactDownload(const QJsonObject &artifact, const QString &targetPath, bool rollback)
{
    const QUrl url(artifact.value(QStringLiteral("resolvedUrl")).toString());
    const qint64 expectedSize = artifactSize(artifact);
    if (!allowedFeedUrl(url) || expectedSize <= 0) {
        setState(QStringLiteral("error"), QStringLiteral("The signed update references an unsafe or invalid artifact."));
        return;
    }

    const QString partialPath = targetPath + QStringLiteral(".partial");
    qint64 resumedFrom = QFileInfo(partialPath).exists() ? QFileInfo(partialPath).size() : 0;
    if (resumedFrom < 0 || resumedFrom >= expectedSize) {
        QFile::remove(partialPath);
        resumedFrom = 0;
    }

    auto *file = new QFile(partialPath, this);
    if (!file->open(QIODevice::WriteOnly | QIODevice::Append)) {
        file->deleteLater();
        setState(QStringLiteral("error"), QStringLiteral("The update download could not be written to disk."));
        return;
    }

    QNetworkRequest request(url);
    request.setHeader(QNetworkRequest::UserAgentHeader, QStringLiteral("ClusterDesktop/%1 QtUpdater").arg(QCoreApplication::applicationVersion()));
    request.setAttribute(QNetworkRequest::CacheLoadControlAttribute, QNetworkRequest::AlwaysNetwork);
    request.setAttribute(QNetworkRequest::RedirectPolicyAttribute, QNetworkRequest::SameOriginRedirectPolicy);
    if (resumedFrom > 0)
        request.setRawHeader(QByteArrayLiteral("Range"), QByteArrayLiteral("bytes=") + QByteArray::number(resumedFrom) + QByteArrayLiteral("-"));
    QNetworkReply *reply = m_network->get(request);
    m_activeReply = reply;
    m_activeFile = file;
    m_sizeLimitExceeded = false;
    m_progress = 0;
    emit progressChanged();
    setState(QStringLiteral("downloading"), rollback ? QStringLiteral("Retaining the verified rollback installer…") : QStringLiteral("Downloading Cluster %1…").arg(m_availableVersion));

    connect(reply, &QNetworkReply::readyRead, this, [this, reply, file, expectedSize] {
        const QByteArray bytes = reply->readAll();
        if (bytes.isEmpty()) return;
        if (file->size() > expectedSize - bytes.size()) {
            m_sizeLimitExceeded = true;
            reply->abort();
            return;
        }
        if (file->write(bytes) != bytes.size()) reply->abort();
    });
    connect(reply, &QNetworkReply::downloadProgress, this, [this, resumedFrom, expectedSize](qint64 received, qint64) {
        const qint64 completed = resumedFrom + qMax<qint64>(0, received);
        m_progress = qBound<qreal>(0, static_cast<qreal>(completed) / static_cast<qreal>(expectedSize), 1);
        emit progressChanged();
    });
    connect(reply, &QNetworkReply::finished, this, [this, reply, artifact, targetPath, rollback, resumedFrom] {
        finishArtifactDownload(reply, artifact, targetPath, rollback, resumedFrom);
    });
}

void NativeUpdateManager::finishArtifactDownload(QNetworkReply *reply, const QJsonObject &artifact, const QString &targetPath, bool rollback, qint64 resumedFrom)
{
    const qint64 expectedSize = artifactSize(artifact);
    QFile *file = m_activeFile;
    if (file) {
        const QByteArray remaining = reply->readAll();
        if (!remaining.isEmpty()) {
            if (file->size() > expectedSize - remaining.size()) m_sizeLimitExceeded = true;
            else if (file->write(remaining) != remaining.size()) m_sizeLimitExceeded = true;
        }
        file->flush();
        file->close();
        file->deleteLater();
    }
    m_activeFile = nullptr;
    m_activeReply = nullptr;

    const QString partialPath = targetPath + QStringLiteral(".partial");
    const int status = reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
    if (!sameOrigin(reply->url(), QUrl(artifact.value(QStringLiteral("resolvedUrl")).toString()))) {
        QFile::remove(partialPath);
        setState(QStringLiteral("error"), QStringLiteral("The update artifact redirected outside its signed origin."));
        reply->deleteLater();
        return;
    }
    if (m_sizeLimitExceeded) {
        QFile::remove(partialPath);
        m_sizeLimitExceeded = false;
        setState(QStringLiteral("error"), QStringLiteral("The update artifact exceeded the size declared by the signed manifest."));
        reply->deleteLater();
        return;
    }

    if (resumedFrom > 0 && status == 200) {
        QFile::remove(partialPath);
        reply->deleteLater();
        beginArtifactDownload(artifact, targetPath, rollback);
        return;
    }
    if (resumedFrom > 0 && status == 206) {
        const QByteArray expectedPrefix = QByteArrayLiteral("bytes ") + QByteArray::number(resumedFrom) + QByteArrayLiteral("-");
        if (!reply->rawHeader(QByteArrayLiteral("Content-Range")).startsWith(expectedPrefix)) {
            QFile::remove(partialPath);
            setState(QStringLiteral("error"), QStringLiteral("The update server returned an invalid resume range."));
            reply->deleteLater();
            return;
        }
    }
    if (resumedFrom == 0 && status == 206) {
        QFile::remove(partialPath);
        setState(QStringLiteral("error"), QStringLiteral("The update server returned an unexpected partial artifact."));
        reply->deleteLater();
        return;
    }
    if (reply->error() != QNetworkReply::NoError || status < 200 || status >= 300) {
        setState(QStringLiteral("error"), QStringLiteral("The update download failed: %1").arg(reply->errorString()));
        reply->deleteLater();
        return;
    }
    if (QFileInfo(partialPath).size() != expectedSize) {
        QFile::remove(partialPath);
        setState(QStringLiteral("error"), QStringLiteral("The update artifact size did not match the signed manifest."));
        reply->deleteLater();
        return;
    }

    setState(QStringLiteral("verifying"), QStringLiteral("Verifying the signed update artifact…"));
    QString verificationError;
    if (!verifyArtifactFile(partialPath, artifact.value(QStringLiteral("sha256")).toString(), &verificationError)) {
        QFile::remove(partialPath);
        setState(QStringLiteral("error"), verificationError);
        reply->deleteLater();
        return;
    }
    QFile::remove(targetPath);
    if (!QFile::rename(partialPath, targetPath)) {
        setState(QStringLiteral("error"), QStringLiteral("The verified update could not be finalized on disk."));
        reply->deleteLater();
        return;
    }

    if (rollback) {
        m_rollbackPath = targetPath;
        m_rollbackSha256 = artifact.value(QStringLiteral("sha256")).toString().toLower();
        m_progress = 1;
        emit progressChanged();
        setState(QStringLiteral("ready"), QStringLiteral("Cluster %1 and its rollback installer are verified and ready.").arg(m_availableVersion));
    } else {
        m_downloadedPath = targetPath;
        if (!m_rollbackArtifact.isEmpty()) {
            const QString rollbackDirectory = updateDirectory() + QStringLiteral("/rollback");
            QDir().mkpath(rollbackDirectory);
            beginArtifactDownload(m_rollbackArtifact, rollbackDirectory + QLatin1Char('/') + safeFileName(m_rollbackArtifact.value(QStringLiteral("filename")).toString()), true);
        } else {
            m_progress = 1;
            emit progressChanged();
            setState(QStringLiteral("ready"), QStringLiteral("Cluster %1 is verified and ready.").arg(m_availableVersion));
        }
    }
    reply->deleteLater();
}

bool NativeUpdateManager::verifyManifestFile(const QString &manifestPath, QString *errorMessage) const
{
    const QString helper = helperPath();
    const QString key = publicKeyPath();
    if (helper.isEmpty() || key.isEmpty()) {
        if (errorMessage) *errorMessage = QStringLiteral("The native update verification helper or public key is missing. Repair the desktop installation.");
        return false;
    }
    QProcess process;
    process.start(helper, {QStringLiteral("verify-manifest"), QStringLiteral("--manifest"), manifestPath, QStringLiteral("--public-key"), key});
    if (!process.waitForFinished(15'000) || process.exitStatus() != QProcess::NormalExit || process.exitCode() != 0) {
        const QString detail = QString::fromUtf8(process.readAllStandardError()).trimmed().left(240);
        if (errorMessage) *errorMessage = detail.isEmpty()
            ? QStringLiteral("The release manifest signature or schema is invalid.")
            : QStringLiteral("The release manifest is invalid: %1").arg(detail);
        return false;
    }
    return true;
}

bool NativeUpdateManager::verifyArtifactFile(const QString &artifactPath, const QString &sha256, QString *errorMessage) const
{
    const QString helper = helperPath();
    if (helper.isEmpty() || !validSha256(sha256)) {
        if (errorMessage) *errorMessage = QStringLiteral("The native update verification helper or signed artifact checksum is invalid.");
        return false;
    }
    QProcess process;
    process.start(helper, {QStringLiteral("verify-artifact"), QStringLiteral("--artifact"), artifactPath, QStringLiteral("--sha256"), sha256});
    if (!process.waitForFinished(60'000) || process.exitStatus() != QProcess::NormalExit || process.exitCode() != 0) {
        if (errorMessage) *errorMessage = QStringLiteral("The downloaded update checksum did not match the signed manifest.");
        return false;
    }
    return true;
}

bool NativeUpdateManager::validateArtifact(const QJsonObject &artifact, const QUrl &manifestUrl, bool rollback, QString *errorMessage, QJsonObject *normalizedArtifact) const
{
    if (artifact.value(QStringLiteral("platform")).toString() != platformName()
        || artifact.value(QStringLiteral("arch")).toString() != architectureName()) return false;

    const QString kind = artifact.value(QStringLiteral("kind")).toString();
    if (rollback ? kind != QStringLiteral("rollback") : (kind != QStringLiteral("installer") && kind != QStringLiteral("portable"))) return false;
    const QString version = artifact.value(QStringLiteral("version")).toString();
    if (QVersionNumber::fromString(version).isNull()) return false;
    if (!validSha256(artifact.value(QStringLiteral("sha256")).toString()) || artifactSize(artifact) <= 0) return false;

    const QString filename = artifact.value(QStringLiteral("filename")).toString();
    if (filename.isEmpty() || safeFileName(filename) != filename) return false;
    QUrl artifactUrl = manifestUrl.resolved(QUrl(artifact.value(QStringLiteral("url")).toString()));
    if (!allowedFeedUrl(artifactUrl) || !sameOrigin(artifactUrl, manifestUrl)) {
        if (errorMessage) *errorMessage = QStringLiteral("The signed update references an artifact outside the feed origin.");
        return false;
    }

    if (normalizedArtifact) {
        *normalizedArtifact = artifact;
        normalizedArtifact->insert(QStringLiteral("resolvedUrl"), artifactUrl.toString(QUrl::FullyEncoded));
    }
    return true;
}

void NativeUpdateManager::loadRecoveryState()
{
    QSettings settings;
    const QString target = settings.value(UpdatePrefix + QStringLiteral("targetVersion")).toString();
    const QString previous = settings.value(UpdatePrefix + QStringLiteral("previousVersion")).toString();
    const QString rollbackPath = settings.value(UpdatePrefix + QStringLiteral("rollbackPath")).toString();
    const QString rollbackSha256 = settings.value(UpdatePrefix + QStringLiteral("rollbackSha256")).toString();
    const QString status = settings.value(UpdatePrefix + QStringLiteral("status")).toString();
    if (target.isEmpty() || previous.isEmpty()) return;

    m_availableVersion = target;
    m_previousVersion = previous;
    m_rollbackPath = rollbackPath;
    m_rollbackSha256 = rollbackSha256;

    const QString current = QCoreApplication::applicationVersion();
    if (current == previous) {
        const bool rolledBack = status == QStringLiteral("rolling-back");
        clearRecoveryState(true);
        setState(QStringLiteral("current"), rolledBack
            ? QStringLiteral("Cluster %1 is running after rollback.").arg(current)
            : QStringLiteral("The pending desktop update was not applied. Cluster %1 remains installed.").arg(current));
        return;
    }

    if (current != target) {
        setState(QStringLiteral("failed"), QStringLiteral("Desktop update recovery found unexpected version %1 (expected %2 or %3). Manual repair is required.").arg(current, target, previous));
        return;
    }

    int attempts = settings.value(UpdatePrefix + QStringLiteral("launchAttempts"), 0).toInt() + 1;
    settings.setValue(UpdatePrefix + QStringLiteral("launchAttempts"), attempts);
    settings.setValue(UpdatePrefix + QStringLiteral("status"), QStringLiteral("awaiting-health"));
    settings.sync();
    if (attempts >= MaxRecoveryLaunchAttempts) {
        const bool canRollback = !m_rollbackPath.isEmpty() && QFileInfo::exists(m_rollbackPath) && validSha256(m_rollbackSha256);
        setState(QStringLiteral("rollback-ready"), canRollback
            ? QStringLiteral("Cluster %1 has not completed its runtime health check after %2 launches. Rollback to %3 is ready.").arg(target).arg(attempts).arg(previous)
            : QStringLiteral("Cluster %1 has not completed its runtime health check and its rollback installer is missing. Manual repair is required.").arg(target));
    } else {
        setState(QStringLiteral("awaiting-health"), QStringLiteral("Cluster %1 is validating the updated desktop runtime. Rollback to %2 remains available until health is confirmed.").arg(target, previous));
    }
}

bool NativeUpdateManager::persistPendingInstall(QString *errorMessage)
{
    if (m_availableVersion.isEmpty() || m_rollbackPath.isEmpty() || !validSha256(m_rollbackSha256)) {
        if (errorMessage) *errorMessage = QStringLiteral("Cluster cannot create a safe update transaction without a verified rollback artifact.");
        return false;
    }
    QSettings settings;
    settings.setValue(UpdatePrefix + QStringLiteral("schemaVersion"), 1);
    settings.setValue(UpdatePrefix + QStringLiteral("status"), QStringLiteral("pending-install"));
    settings.setValue(UpdatePrefix + QStringLiteral("previousVersion"), QCoreApplication::applicationVersion());
    settings.setValue(UpdatePrefix + QStringLiteral("targetVersion"), m_availableVersion);
    settings.setValue(UpdatePrefix + QStringLiteral("rollbackPath"), m_rollbackPath);
    settings.setValue(UpdatePrefix + QStringLiteral("rollbackSha256"), m_rollbackSha256);
    settings.setValue(UpdatePrefix + QStringLiteral("createdAt"), QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs));
    settings.setValue(UpdatePrefix + QStringLiteral("launchAttempts"), 0);
    settings.setValue(UpdatePrefix + QStringLiteral("startupFailures"), 0);
    settings.sync();
    if (settings.status() != QSettings::NoError) {
        if (errorMessage) *errorMessage = QStringLiteral("Cluster could not persist the update recovery transaction. The update was not started.");
        return false;
    }
    m_previousVersion = QCoreApplication::applicationVersion();
    return true;
}

void NativeUpdateManager::clearRecoveryState(bool removeRollbackFile)
{
    QSettings settings;
    settings.remove(QStringLiteral("desktop/updateTransaction"));
    settings.sync();
    if (removeRollbackFile && !m_rollbackPath.isEmpty()) QFile::remove(m_rollbackPath);
    m_rollbackPath.clear();
    m_rollbackSha256.clear();
}

QString NativeUpdateManager::helperPath() const
{
#ifdef Q_OS_WIN
    const QString name = QStringLiteral("cluster-update-helper.exe");
#else
    const QString name = QStringLiteral("cluster-update-helper");
#endif
    for (const QString &candidate : {
             QCoreApplication::applicationDirPath() + QLatin1Char('/') + name,
             QCoreApplication::applicationDirPath() + QStringLiteral("/../libexec/") + name,
         }) {
        const QFileInfo info(candidate);
#ifdef Q_OS_WIN
        if (info.exists() && info.isFile()) return info.absoluteFilePath();
#else
        if (info.isExecutable()) return info.absoluteFilePath();
#endif
    }
    return {};
}

QString NativeUpdateManager::publicKeyPath() const
{
    for (const QString &candidate : {
             QCoreApplication::applicationDirPath() + QStringLiteral("/update-public-key.pem"),
             QCoreApplication::applicationDirPath() + QStringLiteral("/../share/Cluster/update-public-key.pem"),
         }) {
        if (QFileInfo::exists(candidate)) return QFileInfo(candidate).absoluteFilePath();
    }
    return {};
}

QString NativeUpdateManager::updateDirectory() const
{
    return QStandardPaths::writableLocation(QStandardPaths::AppDataLocation) + QStringLiteral("/updates");
}

bool NativeUpdateManager::isNewerVersion(const QString &candidate, const QString &current)
{
    const QVersionNumber candidateVersion = QVersionNumber::fromString(candidate);
    const QVersionNumber currentVersion = QVersionNumber::fromString(current);
    return !candidateVersion.isNull() && candidateVersion.segmentCount() == 3
        && currentVersion.segmentCount() == 3
        && QVersionNumber::compare(candidateVersion, currentVersion) > 0;
}

bool NativeUpdateManager::allowedFeedUrl(const QUrl &url)
{
    if (!url.isValid() || !url.userInfo().isEmpty() || url.hasFragment()) return false;
    if (url.scheme() == QStringLiteral("https")) return !url.host().isEmpty();
    if (url.scheme() == QStringLiteral("http")) {
        const QString host = url.host().toLower();
        return host == QStringLiteral("localhost") || host == QStringLiteral("127.0.0.1") || host == QStringLiteral("::1");
    }
    return false;
}

bool NativeUpdateManager::sameOrigin(const QUrl &left, const QUrl &right)
{
    if (!left.isValid() || !right.isValid()) return false;
    const QString leftScheme = left.scheme().toLower();
    const QString rightScheme = right.scheme().toLower();
    if (leftScheme != rightScheme || left.host().toLower() != right.host().toLower()) return false;
    const int defaultPort = leftScheme == QStringLiteral("https") ? 443 : leftScheme == QStringLiteral("http") ? 80 : -1;
    return left.port(defaultPort) == right.port(defaultPort);
}
