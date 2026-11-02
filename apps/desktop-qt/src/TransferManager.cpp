#include "TransferManager.h"
#include "DesktopDownloadRangePolicy.h"
#include "DesktopTransferQueuePolicy.h"
#include "DesktopTransferJournalPolicy.h"
#include "DesktopTransferRequestPolicy.h"
#include "ApiClient.h"

#include <QCryptographicHash>
#include <QDateTime>
#include <QUrl>
#include <QProcess>
#include <QDesktopServices>
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QLockFile>
#include <QFileSystemWatcher>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QJsonParseError>
#include <QDebug>
#include <QRegularExpression>
#include <QNetworkAccessManager>
#include <QNetworkReply>
#include <QNetworkRequest>
#include <QSaveFile>
#include <QStandardPaths>
#include <QTimer>
#include <QUuid>
#include <QtConcurrent>
#include <QFutureWatcher>

#include <algorithm>

namespace {
void addCsrf(QNetworkRequest &request, const ApiClient *api)
{
    // Session-bearing native uploads must never follow 3xx responses to an
    // unexpected host. Every redirect needs a separately admitted request.
    request.setAttribute(QNetworkRequest::RedirectPolicyAttribute, QNetworkRequest::ManualRedirectPolicy);
    if (api && !api->csrfToken().isEmpty()) request.setRawHeader(QByteArrayLiteral("X-Cluster-CSRF"), api->csrfToken().toUtf8());
}
constexpr qint64 UploadChunkBytes = 4 * 1024 * 1024;


// Client or authorization failures do not become automatic retries. Transient
// network, throttling and service failures retain an explicit Retry path.
bool retryableUploadReply(const QNetworkReply *reply)
{
    const int status = reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
    return status == 0 || status == 408 || status == 425 || status == 429 || status >= 500;
}

QString transferState(const QVariantMap &entry)
{
    return entry.value(QStringLiteral("state")).toString();
}

bool terminalState(const QString &state)
{
    return state == QStringLiteral("complete") || state == QStringLiteral("cancelled");
}

QString downloadDirectory()
{
    QString directory = QStandardPaths::writableLocation(QStandardPaths::DownloadLocation);
    if (directory.isEmpty())
        directory = QStandardPaths::writableLocation(QStandardPaths::TempLocation);
    QDir().mkpath(directory);
    return directory;
}
}

TransferManager::TransferManager(ApiClient *api, QObject *parent)
    : QObject(parent)
    , m_api(api)
    , m_model(new VariantListModel(this))
{
    m_model->setSortKey(QStringLiteral("updatedAt"));
    m_model->setSortDescending(true);
    m_scopeWatcher = new QFileSystemWatcher(this);
    connect(m_scopeWatcher, &QFileSystemWatcher::directoryChanged, this, [this] {
        // QSaveFile publishes via rename. Watch the containing directory rather
        // than one inode that will be replaced on every atomic commit.
        if (ownsQueue() || m_standbyRefreshScheduled) return;
        m_standbyRefreshScheduled = true;
        QTimer::singleShot(250, this, [this] {
            m_standbyRefreshScheduled = false;
            refreshStandbyQueue();
        });
    });
    connect(m_api, &ApiClient::onlineChanged, this, [this] {
        if (m_api->online())
            schedule();
    });
}

TransferManager::~TransferManager()
{
    if (m_activeReply) m_activeReply->abort();
    if (m_activeFile) {
        m_activeFile->close();
        delete m_activeFile;
        m_activeFile = nullptr;
    }
    m_activeId.clear();
    releaseScopeOwnership();
}
bool TransferManager::ownsQueue() const { return m_queueReadable && m_scopeWritable && m_scopeLock && m_scopeLock->isLocked() && !m_queueWriteFailed; }
bool TransferManager::retryOwnership()
{
    if (m_queueWriteFailed) {
        // The operator must explicitly re-read the last durable journal. Never
        // resume until the abandoned request has finished and closed its file.
        if (m_activeReply || m_activeFile) return false;
        m_queueWriteFailed = false;
        load(); // Restored in-flight entries are paused, not replayed.
        if (ownsQueue()) schedule();
        return ownsQueue();
    }
    if (!ownsQueue()) refreshStandbyQueue();
    return ownsQueue();
}
QString TransferManager::queueBlockedReason() const
{
    if (m_queueWriteFailed) return QStringLiteral("journal-write-failed");
    if (!m_queueReadable) return QStringLiteral("journal-invalid");
    if (!m_scopeLock) return QStringLiteral("unavailable");
    if (!m_scopeWritable || !m_scopeLock->isLocked()) return QStringLiteral("owned-by-another-window");
    return {};
}
VariantListModel *TransferManager::model() const { return m_model; }
int TransferManager::activeCount() const
{
    int count = 0;
    for (const QVariantMap &entry : m_transfers) {
        const QString state = transferState(entry);
        if (state == QStringLiteral("running") || state == QStringLiteral("queued")
            || state == QStringLiteral("verifying") || state == QStringLiteral("committing"))
            ++count;
    }
    return count;
}
int TransferManager::pendingCount() const
{
    int count = 0;
    for (const QVariantMap &entry : m_transfers) {
        if (!terminalState(transferState(entry)))
            ++count;
    }
    return count;
}
bool TransferManager::busy() const { return !m_activeId.isEmpty(); }
QString TransferManager::scope() const { return m_scope; }

void TransferManager::setProfileDataRoot(const QString &root)
{
    const QString trimmed = root.trimmed();
    const QString normalized = trimmed.isEmpty() ? QString() : QDir::cleanPath(trimmed);
    if (m_profileDataRoot == normalized)
        return;
    if (m_activeReply) m_activeReply->abort();
    if (m_activeFile) {
        m_activeFile->close();
        delete m_activeFile;
        m_activeFile = nullptr;
    }
    m_activeId.clear();
    releaseScopeOwnership();
    m_profileDataRoot = normalized;
    acquireScopeOwnership();
    load();
    schedule();
}

void TransferManager::setScope(const QString &scope)
{
    const QString normalized = scope.trimmed();
    if (m_scope == normalized)
        return;
    if (m_activeReply)
        m_activeReply->abort();
    if (m_activeFile) {
        m_activeFile->close();
        delete m_activeFile;
        m_activeFile = nullptr;
    }
    m_activeId.clear();
    releaseScopeOwnership();
    m_scope = normalized;
    acquireScopeOwnership();
    load();
    schedule();
}

QString TransferManager::startUpload(const QString &localPath, const QString &purpose,
                                     const QString &finalizePath, const QVariantMap &finalizeBody,
                                     const QVariantMap &evidenceLink)
{
    if (!ownsQueue()) return {};
    if (!finalizePath.isEmpty()
        && !cluster::desktop::request::projectFileFinalizationPath(finalizePath.toStdString())) return {};
    const QFileInfo info(localPath);
    // A queued upload is bound to the selected regular file's initial size
    // and modification generation. Do not later stream a different revision
    // (or a symlink substituted after the native picker issued its handle).
    if (!info.exists() || !info.isFile() || info.isSymLink() || !info.isReadable()
        || info.size() < 0 || info.size() > cluster::desktop::journal::maximumExactJsonInteger
        || info.lastModified().toMSecsSinceEpoch() <= 0)
        return {};
    const TransferMap previousQueue = m_transfers;
    if (!reserveQueueEntry()) return {};
    const QString id = QUuid::createUuid().toString(QUuid::WithoutBraces);
    const QString stamp = nowIso();
    QVariantMap entry {
        {QStringLiteral("id"), id},
        {QStringLiteral("direction"), QStringLiteral("upload")},
        {QStringLiteral("state"), QStringLiteral("queued")},
        {QStringLiteral("title"), info.fileName()},
        {QStringLiteral("fileName"), info.fileName()},
        {QStringLiteral("filePath"), info.absoluteFilePath()},
        {QStringLiteral("purpose"), purpose.left(80)},
        {QStringLiteral("totalBytes"), info.size()},
        {QStringLiteral("sourceModifiedAtMs"), info.lastModified().toMSecsSinceEpoch()},
        {QStringLiteral("transferredBytes"), 0},
        {QStringLiteral("progress"), 0.0},
        {QStringLiteral("createdAt"), stamp},
        {QStringLiteral("updatedAt"), stamp},
        {QStringLiteral("finalizePath"), finalizePath},
        {QStringLiteral("finalizeBody"), finalizeBody},
        {QStringLiteral("evidenceLink"), evidenceLink},
        {QStringLiteral("resumable"), true},
    };
    if (!publish(id, entry)) {
        // A newly accepted job must have a durable queue receipt before it
        // can issue its first network operation. Restore pruned history if
        // the atomic journal commit fails (for example, a full disk).
        m_transfers = previousQueue;
        rebuildModel();
        emit countsChanged();
        return {};
    }
    schedule();
    return id;
}

QString TransferManager::startDownload(const QString &remotePath, const QString &suggestedName,
                                       const QString &expectedChecksumSha256)
{
    if (!ownsQueue()) return {};
    if (!cluster::desktop::request::sameServerApiPath(remotePath.toStdString())
        || !cluster::desktop::journal::validSha256(expectedChecksumSha256.toStdString())) return {};
    const QString name = safeDownloadName(suggestedName);
    const QString initial = downloadDirectory() + QLatin1Char('/') + name;
    const QFileInfo original(initial);
    QString target;
    // Reserve both the finished destination and its private .cluster-part
    // sibling. A queued transfer owns these paths before either file exists.
    // Never attach a new job to retained bytes from a different job.
    for (int index = 1; index <= 10000; ++index) {
        const QString candidate = index == 1 ? initial
            : original.path() + QLatin1Char('/') + original.completeBaseName()
              + QStringLiteral(" (%1)").arg(index)
              + (original.completeSuffix().isEmpty() ? QString() : QStringLiteral(".") + original.completeSuffix());
        if (downloadDestinationAvailable(candidate)) {
            target = candidate;
            break;
        }
    }
    if (target.isEmpty()) return {};
    const TransferMap previousQueue = m_transfers;
    if (!reserveQueueEntry()) return {};
    const QString id = QUuid::createUuid().toString(QUuid::WithoutBraces);
    const QString stamp = nowIso();
    if (!publish(id, {
        {QStringLiteral("id"), id},
        {QStringLiteral("direction"), QStringLiteral("download")},
        {QStringLiteral("state"), QStringLiteral("queued")},
        {QStringLiteral("title"), name},
        {QStringLiteral("fileName"), name},
        {QStringLiteral("filePath"), target},
        {QStringLiteral("temporaryPath"), target + QStringLiteral(".cluster-part")},
        {QStringLiteral("remotePath"), remotePath},
        {QStringLiteral("expectedChecksumSha256"), expectedChecksumSha256.toLower()},
        // No Content-Range header has been accepted yet. Zero is an explicit
        // unknown total, not an omitted field that invalidates a fresh queue
        // on the next Desktop launch.
        {QStringLiteral("totalBytes"), 0},
        {QStringLiteral("transferredBytes"), 0},
        {QStringLiteral("progress"), 0.0},
        {QStringLiteral("createdAt"), stamp},
        {QStringLiteral("updatedAt"), stamp},
        {QStringLiteral("resumable"), true},
    })) {
        m_transfers = previousQueue;
        rebuildModel();
        emit countsChanged();
        return {};
    }
    schedule();
    return id;
}

bool TransferManager::pause(const QString &transferId)
{
    if (!ownsQueue()) return false;
    QVariantMap entry = transfer(transferId);
    if (entry.isEmpty() || terminalState(transferState(entry)))
        return false;
    entry.insert(QStringLiteral("state"), QStringLiteral("paused"));
    entry.insert(QStringLiteral("updatedAt"), nowIso());
    entry.remove(QStringLiteral("error"));
    if (!publish(transferId, entry)) return false;
    // Publish the intent first; an aborted reply may complete synchronously.
    if (m_activeId == transferId && m_activeReply) m_activeReply->abort();
    return true;
}

bool TransferManager::resume(const QString &transferId)
{
    if (!ownsQueue()) return false;
    QVariantMap entry = transfer(transferId);
    const QString state = transferState(entry);
    if (entry.isEmpty() || (state != QStringLiteral("paused") && state != QStringLiteral("failed"))
        || (state == QStringLiteral("failed") && !entry.value(QStringLiteral("retryable"), true).toBool()))
        return false;
    entry.insert(QStringLiteral("state"), QStringLiteral("queued"));
    entry.insert(QStringLiteral("updatedAt"), nowIso());
    entry.remove(QStringLiteral("error"));
    if (!publish(transferId, entry)) return false;
    schedule();
    return true;
}

bool TransferManager::retry(const QString &transferId) { return resume(transferId); }

bool TransferManager::cancel(const QString &transferId)
{
    if (!ownsQueue()) return false;
    QVariantMap entry = transfer(transferId);
    if (entry.isEmpty() || terminalState(transferState(entry)))
        return false;
    const bool active = m_activeId == transferId;
    entry.insert(QStringLiteral("state"), QStringLiteral("cancelled"));
    entry.insert(QStringLiteral("updatedAt"), nowIso());
    entry.remove(QStringLiteral("error"));
    if (!publish(transferId, entry)) return false;
    // Windows won't reliably unlink an open .cluster-part. Active downloads
    // release their handle in finished/verification before removing the file.
    if (active && m_activeReply) m_activeReply->abort();
    else if (!active && entry.value(QStringLiteral("direction")).toString() == QStringLiteral("download"))
        removeOwnedPartial(entry);
    return true;
}

bool TransferManager::openResult(const QString &transferId) const
{
    const QVariantMap entry = transfer(transferId);
    if (!downloadPathsSafe(entry)) return false;
    if (entry.value(QStringLiteral("direction")).toString() != QStringLiteral("download")
        || entry.value(QStringLiteral("state")).toString() != QStringLiteral("complete"))
        return false;
    const QString path = entry.value(QStringLiteral("filePath")).toString();
    if (path.isEmpty() || !QFileInfo::exists(path) || !QFileInfo(path).isFile())
        return false;
    return QDesktopServices::openUrl(QUrl::fromLocalFile(path));
}

bool TransferManager::revealResult(const QString &transferId) const
{
    const QVariantMap entry = transfer(transferId);
    if (!downloadPathsSafe(entry)) return false;
    if (entry.value(QStringLiteral("direction")).toString() != QStringLiteral("download")
        || entry.value(QStringLiteral("state")).toString() != QStringLiteral("complete"))
        return false;
    const QString path = entry.value(QStringLiteral("filePath")).toString();
    if (path.isEmpty() || !QFileInfo::exists(path) || !QFileInfo(path).isFile())
        return false;
#ifdef Q_OS_WIN
    QStringList args;
    args << QStringLiteral("/select,") << QDir::toNativeSeparators(path);
    return QProcess::startDetached(QStringLiteral("explorer.exe"), args);
#else
    return QDesktopServices::openUrl(QUrl::fromLocalFile(QFileInfo(path).absolutePath()));
#endif
}

bool TransferManager::remove(const QString &transferId)
{
    if (!ownsQueue() || !m_transfers.contains(transferId)) return false;
    if (m_activeId == transferId) {
        // Keep the active record until its reply or checksum worker releases
        // the file. Removing it now races the asynchronous completion path.
        return cancel(transferId);
    }
    const QVariantMap previous = m_transfers.take(transferId);
    if (!save()) {
        m_transfers.insert(transferId, previous);
        holdFailedJournalWrite();
        return false;
    }
    rebuildModel();
    emit countsChanged();
    schedule();
    return true;
}

bool TransferManager::retryAll()
{
    if (!ownsQueue()) return false;
    const auto ids = m_transfers.keys();
    for (const QString &id : ids) {
        const QVariantMap entry = m_transfers.value(id);
        const QString state = transferState(entry);
        if (state == QStringLiteral("paused")
            || (state == QStringLiteral("failed") && entry.value(QStringLiteral("retryable"), true).toBool())) {
            // This is not a transaction across jobs: prior resumptions may
            // have committed. If one fails, stop and make the caller refresh.
            if (!resume(id)) return false;
        }
    }
    return true;
}

QString TransferManager::nowIso()
{
    return QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs);
}

QString TransferManager::safeDownloadName(const QString &name)
{
    QString cleaned = QFileInfo(name).fileName().trimmed();
    // Windows device names, control characters and reserved punctuation are
    // not permissible download destinations. Qt on Linux must agree with the
    // supported Windows Desktop semantics.
    const QString forbidden = QStringLiteral("<>:\"/\\|?*");
    for (qsizetype i = 0; i < cleaned.size(); ++i) {
        if (cleaned.at(i).unicode() < 32 || forbidden.contains(cleaned.at(i)))
            cleaned[i] = QChar(u'_');
    }
    while (cleaned.endsWith(QChar(u'.')) || cleaned.endsWith(QChar(u' '))) cleaned.chop(1);
    if (cleaned.isEmpty() || cleaned == QStringLiteral(".") || cleaned == QStringLiteral(".."))
        cleaned = QStringLiteral("cluster-download");
    cleaned = cleaned.left(180);
    const QString stem = cleaned.section(QChar(u'.'), 0, 0).toUpper();
    static const QRegularExpression device(QStringLiteral("^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$"));
    if (device.match(stem).hasMatch()) cleaned.prepend(QChar(u'_'));
    return cleaned;
}

bool TransferManager::validJournalEntry(const QJsonObject &record) const
{
    using namespace cluster::desktop::journal;
    const QJsonValue idValue = record.value(QStringLiteral("id"));
    const QJsonValue directionValue = record.value(QStringLiteral("direction"));
    const QJsonValue stateValue = record.value(QStringLiteral("state"));
    const QJsonValue fileValue = record.value(QStringLiteral("filePath"));
    const QJsonValue totalValue = record.value(QStringLiteral("totalBytes"));
    const QJsonValue progressValue = record.value(QStringLiteral("transferredBytes"));
    const QString id = idValue.toString();
    const QString direction = directionValue.toString();
    const QString state = stateValue.toString();
    const QString path = fileValue.toString();
    if (!idValue.isString() || id.isEmpty() || id.size() > 80
        || !directionValue.isString() || !validDirection(direction.toStdString())
        || !stateValue.isString() || !validState(state.toStdString())
        || !fileValue.isString() || path.isEmpty() || path.size() > 4096
        || !QFileInfo(path).isAbsolute()
        || !totalValue.isDouble() || !progressValue.isDouble()) return false;
    const qint64 total = totalValue.toInteger(-1);
    const qint64 transferred = progressValue.toInteger(-1);
    if (!validProgress(total, transferred)) return false;
    const QJsonValue checksum = record.value(QStringLiteral("checksumSha256"));
    if (!checksum.isUndefined() && (!checksum.isString() || !validSha256(checksum.toString().toStdString())))
        return false;
    if (direction == QStringLiteral("download")) {
        const QJsonValue partial = record.value(QStringLiteral("temporaryPath"));
        const QJsonValue remote = record.value(QStringLiteral("remotePath"));
        const QJsonValue expected = record.value(QStringLiteral("expectedChecksumSha256"));
        const QJsonValue receipt = record.value(QStringLiteral("downloadCommitReceipt"));
        if (!partial.isString() || !pairedPartial(path.toStdString(), partial.toString().toStdString())
            || !remote.isString() || !cluster::desktop::request::sameServerApiPath(remote.toString().toStdString())
            || (!expected.isUndefined() && (!expected.isString()
                || !validSha256(expected.toString().toStdString())))
            || (!receipt.isUndefined() && !receipt.isBool())
            || !validCommitReceipt(direction.toStdString(), receipt.toBool(), total, transferred,
                                   checksum.toString().toStdString())) return false;
    } else {
        if (record.value(QStringLiteral("downloadCommitReceipt")).toBool()) return false;
        const QJsonValue completion = record.value(QStringLiteral("uploadCompletionReceipt"));
        const QJsonValue sourceModified = record.value(QStringLiteral("sourceModifiedAtMs"));
        // Historical journals may predate source-generation receipts. Keep
        // their other jobs readable and preserve the upload evidence, but
        // NEVER resume an unpinned upload: runUpload holds it nonretryable.
        if (!sourceModified.isUndefined()
            && (!sourceModified.isDouble()
                || !validSourceModifiedAt(sourceModified.toInteger(-1)))) return false;
        const QJsonValue session = record.value(QStringLiteral("uploadSessionId"));
        const QJsonValue finalize = record.value(QStringLiteral("finalizePath"));
        const QJsonValue body = record.value(QStringLiteral("finalizeBody"));
        const QJsonValue evidence = record.value(QStringLiteral("evidenceLink"));
        const QJsonValue result = record.value(QStringLiteral("result"));
        const QJsonValue evidenceResult = record.value(QStringLiteral("evidenceResult"));
        if ((!evidence.isUndefined() && !evidence.isObject())
            || (!result.isUndefined() && !result.isObject())
            || (!evidenceResult.isUndefined() && !evidenceResult.isObject())) return false;
        const QJsonObject intent = evidence.toObject();
        if (!intent.isEmpty()) {
            // A retained intent is not enough to claim a file was saved, let
            // alone that its independent work relationship was committed.
            // Validate every receipt before loading any entry from this journal.
            static const QRegularExpression safeId(QStringLiteral("^[A-Za-z0-9_-]{1,200}$"));
            const QString kind = intent.value(QStringLiteral("targetKind")).toString();
            const QString targetId = intent.value(QStringLiteral("targetId")).toString();
            const QString relation = intent.value(QStringLiteral("relationship")).toString();
            if (!QStringList{QStringLiteral("card"), QStringLiteral("ticket"), QStringLiteral("build"),
                             QStringLiteral("whiteboard"), QStringLiteral("qa_plan"), QStringLiteral("qa_session")}.contains(kind)
                || !safeId.match(targetId).hasMatch()
                || !QStringList{QStringLiteral("evidence_for"), QStringLiteral("references"),
                                QStringLiteral("informs"), QStringLiteral("supports")}.contains(relation)
                || !finalize.isString()
                || !cluster::desktop::request::projectFileFinalizationPath(finalize.toString().toStdString())) return false;
            const QString canonicalPath = finalize.toString();
            const QString projectId = canonicalPath.mid(QStringLiteral("/api/projects/").size(),
                canonicalPath.size() - QStringLiteral("/api/projects/").size() - QStringLiteral("/files").size());
            const QJsonObject savedFile = result.toObject();
            if (!savedFile.isEmpty()) {
                if (!completion.toBool() || !safeId.match(savedFile.value(QStringLiteral("id")).toString()).hasMatch()
                    || savedFile.value(QStringLiteral("projectId")).toString() != projectId
                    || savedFile.value(QStringLiteral("sizeBytes")).toInteger(-1) != total
                    || !validSha256(checksum.toString().toStdString(), false)
                    || savedFile.value(QStringLiteral("checksumSha256")).toString().compare(
                           checksum.toString(), Qt::CaseInsensitive) != 0) return false;
            }
            const QJsonObject linked = evidenceResult.toObject();
            if (!linked.isEmpty()) {
                if (savedFile.isEmpty()
                    || !safeId.match(linked.value(QStringLiteral("id")).toString()).hasMatch()
                    || linked.value(QStringLiteral("projectId")).toString() != projectId
                    || linked.value(QStringLiteral("sourceType")).toString() != QStringLiteral("file")
                    || linked.value(QStringLiteral("sourceId")).toString() != savedFile.value(QStringLiteral("id")).toString()
                    || linked.value(QStringLiteral("targetType")).toString() != kind
                    || linked.value(QStringLiteral("targetId")).toString() != targetId
                    || linked.value(QStringLiteral("relationship")).toString() != relation) return false;
            }
            if (state == QStringLiteral("complete") && linked.isEmpty()) return false;
        } else if (!evidenceResult.toObject().isEmpty()) {
            // A detached relationship receipt may not turn a normal upload
            // into an apparent evidence operation after journal recovery.
            return false;
        }
        if ((!session.isUndefined() && (!session.isString()
             || !cluster::desktop::request::validUploadId(session.toString().toStdString())))
            || (!finalize.isUndefined() && (!finalize.isString()
                 || (!finalize.toString().isEmpty()
                   && !cluster::desktop::request::projectFileFinalizationPath(finalize.toString().toStdString()))))
            || (!body.isUndefined() && !body.isObject())
            || (!completion.isUndefined() && !completion.isBool())
            || (completion.toBool() && (!finalize.isString() || finalize.toString().isEmpty()
                || !validUploadCompletionReceipt(true, session.toString().toStdString(), total,
                                                  transferred, checksum.toString().toStdString())))) return false;
    }
    return true;
}

bool TransferManager::uploadSourceMatches(const QVariantMap &entry) const
{
    if (entry.value(QStringLiteral("direction")).toString() != QStringLiteral("upload")) return false;
    const QString path = entry.value(QStringLiteral("filePath")).toString();
    const QFileInfo info(path);
    const qint64 generation = entry.value(QStringLiteral("sourceModifiedAtMs")).toLongLong();
    return info.isAbsolute() && info.exists() && info.isFile() && !info.isSymLink()
        && info.isReadable()
        && cluster::desktop::journal::validSourceModifiedAt(generation)
        && info.size() == entry.value(QStringLiteral("totalBytes")).toLongLong()
        && info.lastModified().toMSecsSinceEpoch() == generation;
}

bool TransferManager::downloadPathsSafe(const QVariantMap &entry) const
{
    if (entry.value(QStringLiteral("direction")).toString() != QStringLiteral("download")) return false;
    const QString target = entry.value(QStringLiteral("filePath")).toString();
    const QString partial = entry.value(QStringLiteral("temporaryPath")).toString();
    if (!cluster::desktop::journal::pairedPartial(target.toStdString(), partial.toStdString())) return false;
    const QFileInfo finalInfo(target);
    const QFileInfo partInfo(partial);
    if (!finalInfo.isAbsolute() || !partInfo.isAbsolute()
        || finalInfo.isSymLink() || partInfo.isSymLink()
        || (finalInfo.exists() && !finalInfo.isFile())
        || (partInfo.exists() && !partInfo.isFile())) return false;
    // A historical download outside the current Downloads folder is retained
    // in the journal for manual recovery, but must never be opened for native
    // append, checksum-based publication or arbitrary file execution.
    const QString currentDownloads = QDir::cleanPath(downloadDirectory());
#ifdef Q_OS_WIN
    constexpr auto pathCase = Qt::CaseInsensitive;
#else
    constexpr auto pathCase = Qt::CaseSensitive;
#endif
    return QDir::cleanPath(finalInfo.absolutePath()).compare(currentDownloads, pathCase) == 0
        && QDir::cleanPath(partInfo.absolutePath()).compare(currentDownloads, pathCase) == 0;
}

bool TransferManager::removeOwnedPartial(const QVariantMap &entry) const
{
    if (entry.value(QStringLiteral("direction")).toString() != QStringLiteral("download")) return false;
    if (!downloadPathsSafe(entry)) return false;
    const QString target = entry.value(QStringLiteral("filePath")).toString();
    const QString partial = entry.value(QStringLiteral("temporaryPath")).toString();
    if (!cluster::desktop::journal::pairedPartial(target.toStdString(), partial.toStdString())
        || !QFileInfo(target).isAbsolute()) return false;
    // Only the Desktop's current Downloads folder is eligible for automatic
    // cancellation cleanup; older destinations are retained, not guessed.
    const QString expectedFolder = QDir::cleanPath(downloadDirectory());
    if (QDir::cleanPath(QFileInfo(target).absolutePath()) != expectedFolder
        || QDir::cleanPath(QFileInfo(partial).absolutePath()) != expectedFolder) return false;
    const QFileInfo file(partial);
    if (!file.exists() || !file.isFile() || file.isSymLink()) return false;
    return QFile::remove(partial);
}

bool TransferManager::reserveQueueEntry()
{
    // A pre-existing journal may exceed current admission limits. Preserve
    // active/failed items instead of truncating saved recovery evidence.
    // Prune only completed/cancelled history, oldest first, and never delete
    // the associated downloaded file.
    while (!cluster::desktop::transfer::mayAdmit(std::size_t(m_transfers.size()))) {
        QString victim;
        QString oldest;
        for (auto it = m_transfers.cbegin(); it != m_transfers.cend(); ++it) {
            if (!cluster::desktop::transfer::historyEvictable(transferState(it.value()).toStdString())) continue;
            const QString updated = it.value().value(QStringLiteral("updatedAt")).toString();
            if (victim.isEmpty() || updated < oldest) {
                victim = it.key();
                oldest = updated;
            }
        }
        if (victim.isEmpty()) return false;
        m_transfers.remove(victim);
    }
    return true;
}

bool TransferManager::downloadDestinationAvailable(const QString &candidate) const
{
    // QFileInfo::exists() alone misses dangling symlinks and queue-only
    // reservations. Avoid reusing either the final path or partial sibling.
    const QString partial = candidate + QStringLiteral(".cluster-part");
    const QFileInfo finalInfo(candidate);
    const QFileInfo partialInfo(partial);
    if (finalInfo.exists() || finalInfo.isSymLink() || partialInfo.exists() || partialInfo.isSymLink())
        return false;
#ifdef Q_OS_WIN
    constexpr auto pathCase = Qt::CaseInsensitive;
#else
    constexpr auto pathCase = Qt::CaseSensitive;
#endif
    for (const auto &other : m_transfers) {
        if (other.value(QStringLiteral("direction")).toString() != QStringLiteral("download")) continue;
        const QString reservedFinal = other.value(QStringLiteral("filePath")).toString();
        const QString reservedPartial = other.value(QStringLiteral("temporaryPath")).toString();
        if (reservedFinal.compare(candidate, pathCase) == 0
            || reservedFinal.compare(partial, pathCase) == 0
            || reservedPartial.compare(candidate, pathCase) == 0
            || reservedPartial.compare(partial, pathCase) == 0)
            return false;
    }
    return true;
}

QByteArray TransferManager::sha256File(const QString &filePath)
{
    // Refuse symlinks and files that visibly change during an asynchronous
    // checksum. A live Windows file-identity test remains a release gate.
    QFileInfo before(filePath);
    if (!before.isFile() || before.isSymLink()) return {};
    const qint64 initialSize = before.size();
    const QDateTime initialModified = before.lastModified();
    QFile file(filePath);
    if (!file.open(QIODevice::ReadOnly) || file.size() != initialSize)
        return {};
    QCryptographicHash hash(QCryptographicHash::Sha256);
    while (!file.atEnd()) {
        const QByteArray block = file.read(1024 * 1024);
        if (block.isEmpty() && file.error() != QFile::NoError)
            return {};
        hash.addData(block);
    }
    QFileInfo after(filePath);
    if (!after.isFile() || after.isSymLink() || after.size() != initialSize
        || after.lastModified() != initialModified || file.size() != initialSize)
        return {};
    return hash.result().toHex();
}

QString TransferManager::storagePath() const
{
    if (m_scope.isEmpty() || m_profileDataRoot.isEmpty())
        return {};
    const QByteArray digest = QCryptographicHash::hash(m_scope.toUtf8(), QCryptographicHash::Sha256).toHex().left(20);
    const QString root = QDir::cleanPath(m_profileDataRoot + QStringLiteral("/transfers"));
    QDir().mkpath(root);
    return root + QStringLiteral("/transfers-") + QString::fromLatin1(digest) + QStringLiteral(".json");
}

void TransferManager::releaseScopeOwnership()
{
    if (m_scopeWatcher) m_scopeWatcher->removePaths(m_scopeWatcher->directories());
    delete m_scopeLock; // QLockFile destructor releases only the lock we own.
    m_scopeLock = nullptr;
    m_scopeWritable = false;
    m_queueReadable = true;
    m_queueWriteFailed = false;
}

void TransferManager::acquireScopeOwnership()
{
    const QString path = storagePath();
    if (path.isEmpty()) return;
    // The first profile may not have a transfer directory yet. QLockFile
    // cannot create missing parents; without this step the only writer would
    // remain permanently read-only and no queue could be persisted.  Create
    // the private storage directory BEFORE attempting to claim ownership.
    // Never follow a direct symlink as the per-profile queue directory.
    const QString directory = QFileInfo(path).absolutePath();
    if (!QDir().mkpath(directory)) return;
    const QFileInfo dirInfo(directory);
    if (!dirInfo.isDir() || dirInfo.isSymLink()) return;
    m_scopeLock = new QLockFile(path + QStringLiteral(".owner.lock"));
    // Never evict a healthy long-running transfer because the file is old.
    // QLockFile still uses its PID/hostname-based stale-process detection.
    m_scopeLock->setStaleLockTime(0);
    m_scopeWritable = m_scopeLock->tryLock(0);
    if (m_scopeWatcher) m_scopeWatcher->addPath(directory);
}

void TransferManager::refreshStandbyQueue()
{
    // Never let directory watcher notifications auto-clear a failed durable
    // write. Only the explicit retryOwnership action may reread that journal.
    if (m_queueWriteFailed || !m_scopeLock || ownsQueue()) return;
    // A malformed queue is a read-only hold, not a stale lock. Allow a
    // corrected journal to be reread while retaining our existing lease.
    if (!m_scopeLock->isLocked())
        m_scopeWritable = m_scopeLock->tryLock(0);
    load();
    if (ownsQueue()) schedule();
}

void TransferManager::load()
{
    m_transfers.clear();
    m_queueReadable = true;
    const QString path = storagePath();
    const QFileInfo queueInfo(path);
    if (!path.isEmpty() && (queueInfo.exists() || queueInfo.isSymLink())) {
        QFile file(path);
        // An unreadable or malformed journal must not be replaced by an
        // empty QSaveFile on the next UI mutation. Retain it for recovery.
        if (queueInfo.isSymLink() || !queueInfo.isFile()
            || queueInfo.size() > cluster::desktop::journal::maximumJournalBytes
            || !file.open(QIODevice::ReadOnly)) {
            m_queueReadable = false;
        } else {
            QJsonParseError error{};
            const QJsonDocument document = QJsonDocument::fromJson(file.readAll(), &error);
            const QJsonObject root = document.object();
            if (error.error != QJsonParseError::NoError || !document.isObject()
                || root.value(QStringLiteral("version")).toInt(-1) != 1
                || !root.value(QStringLiteral("transfers")).isArray()) {
                m_queueReadable = false;
            } else {
                const QJsonArray entries = root.value(QStringLiteral("transfers")).toArray();
                for (const QJsonValue &value : entries) {
                    if (!value.isObject()) {
                        m_queueReadable = false;
                        break;
                    }
                    const QJsonObject record = value.toObject();
                    if (!validJournalEntry(record)) {
                        m_queueReadable = false;
                        break;
                    }
                    QVariantMap entry = record.toVariantMap();
                    const QString id = entry.value(QStringLiteral("id")).toString();
                    if (id.isEmpty() || m_transfers.contains(id)) {
                        m_queueReadable = false;
                        break;
                    }
                    const QString state = transferState(entry);
                    if (ownsQueue() && (state == QStringLiteral("running") || state == QStringLiteral("queued")
                        || state == QStringLiteral("verifying") || state == QStringLiteral("committing")))
                        entry.insert(QStringLiteral("state"), QStringLiteral("paused"));
                    m_transfers.insert(id, entry);
                }
            }
        }
        if (!m_queueReadable) {
            m_transfers.clear();
            qWarning() << "Cluster transfer queue journal is invalid; refusing writes until repaired";
        }
    }
    rebuildModel();
    emit countsChanged();
}

bool TransferManager::save() const
{
    if (!ownsQueue()) return false;
    const QString path = storagePath();
    if (path.isEmpty())
        return false;
    QVariantList entries;
    entries.reserve(m_transfers.size());
    for (const QVariantMap &entry : m_transfers)
        entries.append(entry);
    std::sort(entries.begin(), entries.end(), [](const QVariant &a, const QVariant &b) {
        return a.toMap().value(QStringLiteral("updatedAt")).toString() > b.toMap().value(QStringLiteral("updatedAt")).toString();
    });
    // Never truncate nonterminal history during a disk save. New admission is
    // capped separately, while older oversized queues remain recoverable.
    QSaveFile file(path);
    if (!file.open(QIODevice::WriteOnly))
        return false;
    const QJsonObject root {{QStringLiteral("version"), 1}, {QStringLiteral("transfers"), QJsonArray::fromVariantList(entries)}};
    const QByteArray encoded = QJsonDocument(root).toJson(QJsonDocument::Indented);
    if (encoded.size() > cluster::desktop::journal::maximumJournalBytes
        || file.write(encoded) != encoded.size()) {
        file.cancelWriting();
        return false;
    }
    return file.commit();
}

void TransferManager::rebuildModel()
{
    QVariantList entries;
    entries.reserve(m_transfers.size());
    for (QVariantMap entry : m_transfers) {
        const qint64 total = entry.value(QStringLiteral("totalBytes")).toLongLong();
        const qint64 done = entry.value(QStringLiteral("transferredBytes")).toLongLong();
        entry.insert(QStringLiteral("progress"), total > 0 ? qBound(0.0, double(done) / double(total), 1.0) : 0.0);
        entry.insert(QStringLiteral("subtitle"), entry.value(QStringLiteral("direction")).toString());
        entries.append(entry);
    }
    m_model->replace(entries);
}

void TransferManager::holdFailedJournalWrite()
{
    // QSaveFile has not published the failed update. Never act on a state
    // transition that the next Desktop process cannot observe. Keep the
    // original journal, any upload session, and all retained download bytes.
    m_queueWriteFailed = true;
    m_activeId.clear();
    if (m_activeReply) m_activeReply->abort();
    if (m_activeFile) {
        m_activeFile->flush();
        m_activeFile->close();
        delete m_activeFile;
        m_activeFile = nullptr;
    }
    qWarning() << "Cluster transfer queue write failed; network work held pending explicit journal reload";
    rebuildModel();
    emit countsChanged();
}

bool TransferManager::publish(const QString &id, const QVariantMap &next)
{
    if (!ownsQueue()) return false;
    const bool existed = m_transfers.contains(id);
    const QVariantMap previous = m_transfers.value(id);
    m_transfers.insert(id, next);
    const bool persisted = save();
    if (!persisted) {
        if (existed) m_transfers.insert(id, previous);
        else m_transfers.remove(id);
        holdFailedJournalWrite();
        return false;
    }
    rebuildModel();
    emit countsChanged();
    return true;
}

void TransferManager::publishDownloadProgress(const QString &id, const QVariantMap &next)
{
    if (!ownsQueue()) return;
    // The retained .cluster-part file is the download byte-offset authority
    // after a crash; the queue journal is not. Never rewrite QSaveFile on
    // every readyRead signal (which can be thousands of events per second).
    // Header admission, pause/cancel, verified completion and failures still
    // use publish(), which commits the durable queue transaction.
    m_transfers.insert(id, next);
    rebuildModel();
    emit countsChanged();
}

void TransferManager::schedule()
{
    if (!ownsQueue()) return;
    QTimer::singleShot(0, this, &TransferManager::processNext);
}

void TransferManager::processNext()
{
    if (!ownsQueue() || !m_activeId.isEmpty() || !m_api || !m_api->online())
        return;
    QVariantList candidates;
    for (const QVariantMap &entry : m_transfers) {
        if (transferState(entry) == QStringLiteral("queued"))
            candidates.append(entry);
    }
    std::sort(candidates.begin(), candidates.end(), [](const QVariant &a, const QVariant &b) {
        return a.toMap().value(QStringLiteral("createdAt")).toString() < b.toMap().value(QStringLiteral("createdAt")).toString();
    });
    if (candidates.isEmpty())
        return;
    const QVariantMap entry = candidates.first().toMap();
    m_activeId = entry.value(QStringLiteral("id")).toString();
    if (entry.value(QStringLiteral("direction")).toString() == QStringLiteral("upload"))
        runUpload(m_activeId);
    else
        runDownload(m_activeId);
}

void TransferManager::runUpload(const QString &id)
{
    if (!ownsQueue()) return;
    QVariantMap entry = transfer(id);
    const QString sessionId = entry.value(QStringLiteral("uploadSessionId")).toString();
    const QString finalize = entry.value(QStringLiteral("finalizePath")).toString();
    if ((!sessionId.isEmpty() && !cluster::desktop::request::validUploadId(sessionId.toStdString()))
        || (!finalize.isEmpty() && !cluster::desktop::request::projectFileFinalizationPath(finalize.toStdString()))) {
        fail(id, QStringLiteral("TRANSFER_SESSION_PATH_INVALID"),
             QStringLiteral("The recovered upload contains an invalid server session or destination."), false);
        return;
    }
    if (!entry.value(QStringLiteral("result")).toMap().isEmpty()
        && !entry.value(QStringLiteral("evidenceLink")).toMap().isEmpty()) {
        // File finalization was persisted before this independent mutation.
        // Retry relationship creation only, without consulting the source file.
        finalizeEvidenceLink(id);
        return;
    }
    if (entry.value(QStringLiteral("uploadCompletionReceipt")).toBool()) {
        // The server has already verified every byte. Its file may have
        // moved or been removed locally, and the consumed upload session
        // can return 404. Re-issue ONLY the idempotent authorized Project-file
        // finalizer using our durable, checksum-bound server receipt.
        finalizeUpload(id, {
            {QStringLiteral("uploadId"), sessionId},
            {QStringLiteral("checksumSha256"), entry.value(QStringLiteral("checksumSha256"))},
            {QStringLiteral("sizeBytes"), entry.value(QStringLiteral("totalBytes"))},
        });
        return;
    }
    if (!entry.contains(QStringLiteral("sourceModifiedAtMs"))) {
        fail(id, QStringLiteral("TRANSFER_UPLOAD_SOURCE_UNPINNED"),
             QStringLiteral("This retained upload predates durable source identity. It was preserved but cannot be resumed safely; select the file again to start a new upload."), false);
        return;
    }
    if (!uploadSourceMatches(entry)) {
        fail(id, QStringLiteral("TRANSFER_UPLOAD_SOURCE_CHANGED"),
             QStringLiteral("The selected upload file was replaced, modified or is no longer available. Start a new upload rather than reusing its server session."), false);
        return;
    }
    if (sessionId.isEmpty())
        createUploadSession(id);
    else
        queryUploadSession(id);
}

void TransferManager::createUploadSession(const QString &id)
{
    if (!ownsQueue()) return;
    QVariantMap entry = transfer(id);
    QNetworkRequest request = m_api->createRequest(QStringLiteral("/api/uploads"));
    addCsrf(request, m_api);
    request.setHeader(QNetworkRequest::ContentTypeHeader, QStringLiteral("application/json"));
    const QJsonObject body {
        {QStringLiteral("fileName"), entry.value(QStringLiteral("fileName")).toString()},
        {QStringLiteral("totalBytes"), entry.value(QStringLiteral("totalBytes")).toLongLong()},
        {QStringLiteral("contentType"), QStringLiteral("application/octet-stream")},
        // The canonical server session deduplicates a lost POST response by this
        // stable per-transfer key. Never create a fresh session on a 404 GET.
        {QStringLiteral("clientKey"), QStringLiteral("qt-transfer:%1").arg(id)},
    };
    QNetworkReply *reply = m_api->networkAccessManager()->post(request, QJsonDocument(body).toJson(QJsonDocument::Compact));
    m_activeReply = reply;
    connect(reply, &QNetworkReply::finished, this, [this, id, reply] {
        const QByteArray bytes = reply->readAll();
        if (discardInterruptedReply(id, reply)) return;
        const int status = reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
        if (reply->error() != QNetworkReply::NoError || status < 200 || status >= 300) {
            const QVariantMap error = parseReplyError(reply, bytes);
            const bool retryable = retryableUploadReply(reply);
            finishReply(reply);
            fail(id, error.value(QStringLiteral("code")).toString(), error.value(QStringLiteral("message")).toString(), retryable);
            return;
        }
        const QJsonObject payload = QJsonDocument::fromJson(bytes).object();
        const QString sessionId = payload.value(QStringLiteral("uploadId")).toString();
        const QString mode = payload.value(QStringLiteral("transferMode")).toString();
        const qint64 received = payload.value(QStringLiteral("receivedBytes")).toInteger(-1);
        const qint64 total = transfer(id).value(QStringLiteral("totalBytes")).toLongLong();
        if (!cluster::desktop::request::validUploadId(sessionId.toStdString())
            || mode != QStringLiteral("cluster") || received < 0 || received > total) {
            finishReply(reply);
            // Provider-direct multipart requires a different transport. Do not
            // pretend the Qt chunk uploader supports presigned S3 parts.
            fail(id, QStringLiteral("TRANSFER_SESSION_MODE_UNSUPPORTED"),
                 QStringLiteral("This server did not return a valid Cluster-proxied upload session. No file bytes were sent."), false);
            return;
        }
        QVariantMap entry = transfer(id);
        entry.insert(QStringLiteral("uploadSessionId"), sessionId);
        entry.insert(QStringLiteral("transferredBytes"), received);
        entry.insert(QStringLiteral("state"), QStringLiteral("running"));
        entry.insert(QStringLiteral("updatedAt"), nowIso());
        publish(id, entry);
        finishReply(reply);
        sendUploadChunk(id);
    });
}

void TransferManager::queryUploadSession(const QString &id)
{
    if (!ownsQueue()) return;
    const QVariantMap entry = transfer(id);
    const QString sessionId = entry.value(QStringLiteral("uploadSessionId")).toString();
    QNetworkRequest request = m_api->createRequest(QStringLiteral("/api/uploads/%1").arg(sessionId));
    request.setAttribute(QNetworkRequest::RedirectPolicyAttribute, QNetworkRequest::ManualRedirectPolicy);
    QNetworkReply *reply = m_api->networkAccessManager()->get(request);
    m_activeReply = reply;
    connect(reply, &QNetworkReply::finished, this, [this, id, reply] {
        const QByteArray bytes = reply->readAll();
        if (discardInterruptedReply(id, reply)) return;
        const int status = reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
        if (status == 404) {
            // A 404 may mean the session was revoked, expired or is outside the
            // current user's authorization. Never manufacture a replacement.
            finishReply(reply);
            fail(id, QStringLiteral("TRANSFER_SERVER_SESSION_NOT_FOUND"),
                 QStringLiteral("The original upload session is no longer available. Review before creating a new transfer."), false);
            return;
        }
        if (reply->error() != QNetworkReply::NoError || status < 200 || status >= 300) {
            const QVariantMap error = parseReplyError(reply, bytes);
            const bool retryable = retryableUploadReply(reply);
            finishReply(reply);
            fail(id, error.value(QStringLiteral("code")).toString(), error.value(QStringLiteral("message")).toString(), retryable);
            return;
        }
        const QJsonObject response = QJsonDocument::fromJson(bytes).object();
        const QJsonObject remote = response.value(QStringLiteral("upload")).toObject();
        QVariantMap entry = transfer(id);
        const QString sessionId = entry.value(QStringLiteral("uploadSessionId")).toString();
        const qint64 total = entry.value(QStringLiteral("totalBytes")).toLongLong();
        const qint64 received = remote.value(QStringLiteral("receivedBytes")).toInteger(-1);
        const QString state = remote.value(QStringLiteral("status")).toString();
        if (response.value(QStringLiteral("transferMode")).toString() != QStringLiteral("cluster")
            || remote.value(QStringLiteral("id")).toString() != sessionId
            || remote.value(QStringLiteral("totalBytes")).toInteger(-1) != total
            || received < 0 || received > total) {
            finishReply(reply);
            fail(id, QStringLiteral("TRANSFER_REMOTE_EVIDENCE_INVALID"),
                 QStringLiteral("The server upload record does not match the original transfer."), false);
            return;
        }
        if (state == QStringLiteral("COMPLETED") && remote.value(QStringLiteral("completedAt")).isString()
            && received == total) {
            const QString serverChecksum = remote.value(QStringLiteral("checksumSha256")).toString();
            if (!QRegularExpression(QStringLiteral("^[a-fA-F0-9]{64}$")).match(serverChecksum).hasMatch()) {
                finishReply(reply);
                fail(id, QStringLiteral("TRANSFER_COMPLETION_EVIDENCE_INVALID"),
                     QStringLiteral("The completed server upload has no valid SHA-256 receipt."), false);
                return;
            }
            // A completed remote session may outlive the Qt process. Never
            // commit its destination based only on server metadata: re-hash
            // the local source and compare it to the durable remote receipt.
            entry.insert(QStringLiteral("expectedRemoteChecksumSha256"), serverChecksum.toLower());
            entry.insert(QStringLiteral("transferredBytes"), total);
            entry.insert(QStringLiteral("updatedAt"), nowIso());
            publish(id, entry);
            finishReply(reply);
            verifyUpload(id);
            return;
        }
        if (state == QStringLiteral("PAUSED")) {
            finishReply(reply);
            resumeServerUploadSession(id);
            return;
        }
        if (state != QStringLiteral("OPEN")) {
            finishReply(reply);
            fail(id, QStringLiteral("TRANSFER_REMOTE_STATE_HELD"),
                 QStringLiteral("The server upload is no longer open for writes. An administrator may need to review it."), false);
            return;
        }
        entry.insert(QStringLiteral("transferredBytes"), received);
        entry.insert(QStringLiteral("state"), QStringLiteral("running"));
        entry.insert(QStringLiteral("updatedAt"), nowIso());
        publish(id, entry);
        finishReply(reply);
        sendUploadChunk(id);
    });
}

void TransferManager::resumeServerUploadSession(const QString &id)
{
    if (!ownsQueue()) return;
    const QVariantMap entry = transfer(id);
    const QString sessionId = entry.value(QStringLiteral("uploadSessionId")).toString();
    QNetworkRequest request = m_api->createRequest(QStringLiteral("/api/uploads/%1/resume").arg(sessionId));
    addCsrf(request, m_api);
    QNetworkReply *reply = m_api->networkAccessManager()->post(request, QByteArray{});
    m_activeReply = reply;
    connect(reply, &QNetworkReply::finished, this, [this, id, reply] {
        const QByteArray bytes = reply->readAll();
        if (discardInterruptedReply(id, reply)) return;
        const int status = reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
        if (reply->error() != QNetworkReply::NoError || status < 200 || status >= 300) {
            const QVariantMap error = parseReplyError(reply, bytes);
            const bool retryable = retryableUploadReply(reply);
            finishReply(reply);
            fail(id, error.value(QStringLiteral("code")).toString(), error.value(QStringLiteral("message")).toString(), retryable);
            return;
        }
        const QJsonObject remote = QJsonDocument::fromJson(bytes).object().value(QStringLiteral("upload")).toObject();
        QVariantMap entry = transfer(id);
        const qint64 received = remote.value(QStringLiteral("receivedBytes")).toInteger(-1);
        const qint64 total = entry.value(QStringLiteral("totalBytes")).toLongLong();
        if (remote.value(QStringLiteral("id")).toString() != entry.value(QStringLiteral("uploadSessionId")).toString()
            || remote.value(QStringLiteral("status")).toString() != QStringLiteral("OPEN")
            || remote.value(QStringLiteral("mode")).toString() != QStringLiteral("cluster")
            || remote.value(QStringLiteral("totalBytes")).toInteger(-1) != total
            || received < 0 || received > total) {
            finishReply(reply);
            fail(id, QStringLiteral("TRANSFER_REMOTE_RESUME_INVALID"),
                 QStringLiteral("The server did not authorize this upload to resume."), false);
            return;
        }
        entry.insert(QStringLiteral("transferredBytes"), received);
        entry.insert(QStringLiteral("state"), QStringLiteral("running"));
        entry.insert(QStringLiteral("updatedAt"), nowIso());
        publish(id, entry);
        finishReply(reply);
        sendUploadChunk(id);
    });
}

void TransferManager::sendUploadChunk(const QString &id)
{
    if (!ownsQueue()) return;
    QVariantMap entry = transfer(id);
    if (transferState(entry) == QStringLiteral("paused") || transferState(entry) == QStringLiteral("cancelled")) {
        m_activeId.clear();
        schedule();
        return;
    }
    if (!uploadSourceMatches(entry)) {
        fail(id, QStringLiteral("TRANSFER_UPLOAD_SOURCE_CHANGED"),
             QStringLiteral("The upload file changed during transfer. Retained server bytes were not resumed."), false);
        return;
    }
    const qint64 total = entry.value(QStringLiteral("totalBytes")).toLongLong();
    const qint64 offset = entry.value(QStringLiteral("transferredBytes")).toLongLong();
    if (offset >= total) {
        verifyUpload(id);
        return;
    }
    QFile file(entry.value(QStringLiteral("filePath")).toString());
    if (!file.open(QIODevice::ReadOnly) || !file.seek(offset)) {
        fail(id, QStringLiteral("TRANSFER_FILE_UNAVAILABLE"), QStringLiteral("The local upload file is no longer readable."), false);
        return;
    }
    const QByteArray chunk = file.read(qMin(UploadChunkBytes, total - offset));
    if (chunk.size() != qMin(UploadChunkBytes, total - offset) || !uploadSourceMatches(entry)) {
        fail(id, QStringLiteral("TRANSFER_FILE_READ_FAILED"), QStringLiteral("Cluster could not read the next upload chunk."), false);
        return;
    }
    const QString sessionId = entry.value(QStringLiteral("uploadSessionId")).toString();
    QNetworkRequest request = m_api->createRequest(QStringLiteral("/api/uploads/%1/chunks").arg(sessionId));
    addCsrf(request, m_api);
    request.setHeader(QNetworkRequest::ContentTypeHeader, QStringLiteral("application/octet-stream"));
    request.setRawHeader(QByteArrayLiteral("Content-Range"), QStringLiteral("bytes %1-%2/%3").arg(offset).arg(offset + chunk.size() - 1).arg(total).toUtf8());
    QNetworkReply *reply = m_api->networkAccessManager()->put(request, chunk);
    m_activeReply = reply;
    const qint64 expectedReceived = offset + chunk.size();
    connect(reply, &QNetworkReply::finished, this, [this, id, reply, expectedReceived] {
        const QByteArray bytes = reply->readAll();
        if (discardInterruptedReply(id, reply)) return;
        const int status = reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
        const QJsonObject payload = QJsonDocument::fromJson(bytes).object();
        if (status == 409 && payload.value(QStringLiteral("code")).toString() == QStringLiteral("UPLOAD_OFFSET_CONFLICT")
            && payload.contains(QStringLiteral("receivedBytes"))) {
            QVariantMap entry = transfer(id);
            const qint64 acknowledged = payload.value(QStringLiteral("receivedBytes")).toInteger(-1);
            if (acknowledged < 0 || acknowledged > entry.value(QStringLiteral("totalBytes")).toLongLong()
                || acknowledged == entry.value(QStringLiteral("transferredBytes")).toLongLong()) {
                finishReply(reply);
                fail(id, QStringLiteral("TRANSFER_UPLOAD_OFFSET_INVALID"),
                     QStringLiteral("The server returned an invalid or unchanged upload offset."), false);
                return;
            }
            entry.insert(QStringLiteral("transferredBytes"), acknowledged);
            entry.insert(QStringLiteral("updatedAt"), nowIso());
            publish(id, entry);
            finishReply(reply);
            sendUploadChunk(id);
            return;
        }
        if (reply->error() != QNetworkReply::NoError || status < 200 || status >= 300) {
            const QVariantMap error = parseReplyError(reply, bytes);
            const bool retryable = retryableUploadReply(reply);
            finishReply(reply);
            fail(id, error.value(QStringLiteral("code")).toString(), error.value(QStringLiteral("message")).toString(), retryable);
            return;
        }
        QVariantMap entry = transfer(id);
        const qint64 acknowledged = payload.value(QStringLiteral("receivedBytes")).toInteger(-1);
        if (acknowledged != expectedReceived
            || acknowledged > entry.value(QStringLiteral("totalBytes")).toLongLong()) {
            finishReply(reply);
            fail(id, QStringLiteral("TRANSFER_UPLOAD_PROGRESS_INVALID"),
                 QStringLiteral("The server returned an invalid acknowledged upload offset."), false);
            return;
        }
        entry.insert(QStringLiteral("transferredBytes"), acknowledged);
        entry.insert(QStringLiteral("state"), QStringLiteral("running"));
        entry.insert(QStringLiteral("updatedAt"), nowIso());
        publish(id, entry);
        finishReply(reply);
        QTimer::singleShot(0, this, [this, id] { sendUploadChunk(id); });
    });
}

void TransferManager::verifyUpload(const QString &id)
{
    if (!ownsQueue()) return;
    QVariantMap entry = transfer(id);
    if (!uploadSourceMatches(entry)) {
        fail(id, QStringLiteral("TRANSFER_UPLOAD_SOURCE_CHANGED"),
             QStringLiteral("The upload source changed before checksum verification. Server bytes were retained for review."), false);
        return;
    }
    entry.insert(QStringLiteral("state"), QStringLiteral("verifying"));
    entry.insert(QStringLiteral("updatedAt"), nowIso());
    if (!publish(id, entry)) return;
    auto *watcher = new QFutureWatcher<QByteArray>(this);
    connect(watcher, &QFutureWatcher<QByteArray>::finished, this, [this, id, watcher] {
        const QByteArray checksum = watcher->result();
        watcher->deleteLater();
        if (m_activeId != id || transferState(transfer(id)) != QStringLiteral("verifying")) {
            if (m_activeId == id) {
                if (transferState(transfer(id)) == QStringLiteral("cancelled")
                    && transfer(id).value(QStringLiteral("direction")).toString() == QStringLiteral("download"))
                    removeOwnedPartial(transfer(id));
                m_activeId.clear();
                schedule();
            }
            return;
        }
        if (checksum.isEmpty() || !uploadSourceMatches(transfer(id))) {
            fail(id, QStringLiteral("TRANSFER_CHECKSUM_FAILED"), QStringLiteral("The upload file changed or its checksum could not be calculated."), false);
            return;
        }
        const QString expectedRemote = transfer(id).value(QStringLiteral("expectedRemoteChecksumSha256")).toString();
        if (!expectedRemote.isEmpty() && expectedRemote.compare(QString::fromLatin1(checksum), Qt::CaseInsensitive) != 0) {
            fail(id, QStringLiteral("TRANSFER_REMOTE_CHECKSUM_MISMATCH"),
                 QStringLiteral("The local source no longer matches the server's completed upload. Review the transfer."), false);
            return;
        }
        completeUpload(id, checksum);
    });
    watcher->setFuture(QtConcurrent::run(&TransferManager::sha256File, entry.value(QStringLiteral("filePath")).toString()));
}

void TransferManager::completeUpload(const QString &id, const QByteArray &checksum)
{
    if (!ownsQueue()) return;
    const QVariantMap entry = transfer(id);
    if (!uploadSourceMatches(entry)) {
        fail(id, QStringLiteral("TRANSFER_UPLOAD_SOURCE_CHANGED"),
             QStringLiteral("The upload source changed after verification. No server completion was requested."), false);
        return;
    }
    const QString sessionId = entry.value(QStringLiteral("uploadSessionId")).toString();
    QNetworkRequest request = m_api->createRequest(QStringLiteral("/api/uploads/%1/complete").arg(sessionId));
    addCsrf(request, m_api);
    request.setHeader(QNetworkRequest::ContentTypeHeader, QStringLiteral("application/json"));
    const QByteArray body = QJsonDocument(QJsonObject{{QStringLiteral("checksumSha256"), QString::fromLatin1(checksum)}}).toJson(QJsonDocument::Compact);
    QNetworkReply *reply = m_api->networkAccessManager()->post(request, body);
    m_activeReply = reply;
    connect(reply, &QNetworkReply::finished, this, [this, id, checksum, reply] {
        const QByteArray bytes = reply->readAll();
        if (discardInterruptedReply(id, reply)) return;
        const int status = reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
        if (reply->error() != QNetworkReply::NoError || status < 200 || status >= 300) {
            const QVariantMap error = parseReplyError(reply, bytes);
            const bool retryable = retryableUploadReply(reply);
            finishReply(reply);
            fail(id, error.value(QStringLiteral("code")).toString(), error.value(QStringLiteral("message")).toString(), retryable);
            return;
        }
        QVariantMap result = QJsonDocument::fromJson(bytes).object().toVariantMap();
        const QVariantMap entry = transfer(id);
        if (result.value(QStringLiteral("uploadId")).toString() != entry.value(QStringLiteral("uploadSessionId")).toString()
            || result.value(QStringLiteral("checksumSha256")).toString().compare(QString::fromLatin1(checksum), Qt::CaseInsensitive) != 0
            || result.value(QStringLiteral("sizeBytes")).toLongLong() != entry.value(QStringLiteral("totalBytes")).toLongLong()) {
            finishReply(reply);
            fail(id, QStringLiteral("TRANSFER_COMPLETE_PROOF_INVALID"),
                 QStringLiteral("The server upload completion receipt does not match the verified file."), false);
            return;
        }
        finishReply(reply);
        finalizeUpload(id, result);
    });
}

void TransferManager::finalizeUpload(const QString &id, const QVariantMap &uploadResult)
{
    if (!ownsQueue()) return;
    QVariantMap entry = transfer(id);
    const QString path = entry.value(QStringLiteral("finalizePath")).toString();
    if (path.isEmpty()) {
        entry.insert(QStringLiteral("state"), QStringLiteral("complete"));
        entry.insert(QStringLiteral("transferredBytes"), entry.value(QStringLiteral("totalBytes")));
        entry.insert(QStringLiteral("checksumSha256"), uploadResult.value(QStringLiteral("checksumSha256")));
        entry.insert(QStringLiteral("completedAt"), nowIso());
        entry.insert(QStringLiteral("updatedAt"), nowIso());
        if (!publish(id, entry)) return;
        m_activeId.clear();
        emit transferCompleted(id, uploadResult);
        // Do not DELETE a completed upload: the caller owns its receipt and
        // may consume the verified bytes in a subsequent request.
        schedule();
        return;
    }
    const QString verifiedSession = uploadResult.value(QStringLiteral("uploadId")).toString();
    const QString verifiedHash = uploadResult.value(QStringLiteral("checksumSha256")).toString().toLower();
    const qint64 total = entry.value(QStringLiteral("totalBytes")).toLongLong();
    if (verifiedSession != entry.value(QStringLiteral("uploadSessionId")).toString()
        || uploadResult.value(QStringLiteral("sizeBytes")).toLongLong() != total
        || !cluster::desktop::journal::validUploadCompletionReceipt(
               true, verifiedSession.toStdString(), total, total, verifiedHash.toStdString())) {
        fail(id, QStringLiteral("TRANSFER_UPLOAD_COMPLETION_RECEIPT_INVALID"),
             QStringLiteral("The verified upload receipt does not match the queued server session."), false);
        return;
    }
    if (!entry.value(QStringLiteral("uploadCompletionReceipt")).toBool()) {
        // Phase 1: retain server-complete proof BEFORE invoking the consuming
        // Project-file finalizer. A crash/lost reply now resumes by replaying
        // this idempotent endpoint, never by attempting to recreate the upload.
        entry.insert(QStringLiteral("uploadCompletionReceipt"), true);
        entry.insert(QStringLiteral("checksumSha256"), verifiedHash);
        entry.insert(QStringLiteral("transferredBytes"), total);
        entry.insert(QStringLiteral("state"), QStringLiteral("committing"));
        entry.insert(QStringLiteral("updatedAt"), nowIso());
        if (!publish(id, entry)) return;
    }
    QVariantMap finalBody = entry.value(QStringLiteral("finalizeBody")).toMap();
    finalBody.insert(QStringLiteral("uploadId"), entry.value(QStringLiteral("uploadSessionId")));
    QNetworkRequest request = m_api->createRequest(path);
    addCsrf(request, m_api);
    request.setHeader(QNetworkRequest::ContentTypeHeader, QStringLiteral("application/json"));
    request.setRawHeader(QByteArrayLiteral("X-Cluster-Idempotency-Key"), QStringLiteral("qt-transfer:%1").arg(id).toUtf8());
    QNetworkReply *reply = m_api->networkAccessManager()->post(request, QJsonDocument(QJsonObject::fromVariantMap(finalBody)).toJson(QJsonDocument::Compact));
    m_activeReply = reply;
    connect(reply, &QNetworkReply::finished, this, [this, id, uploadResult, reply] {
        const QByteArray bytes = reply->readAll();
        if (discardInterruptedReply(id, reply)) return;
        const int status = reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
        if (reply->error() != QNetworkReply::NoError || status < 200 || status >= 300) {
            const QVariantMap error = parseReplyError(reply, bytes);
            const bool retryable = retryableUploadReply(reply);
            finishReply(reply);
            fail(id, error.value(QStringLiteral("code")).toString(), error.value(QStringLiteral("message")).toString(), retryable);
            return;
        }
        QVariantMap entry = transfer(id);
        const QJsonObject finalized = QJsonDocument::fromJson(bytes).object();
        const QString canonicalPath = entry.value(QStringLiteral("finalizePath")).toString();
        const QString projectPrefix = QStringLiteral("/api/projects/");
        const QString projectId = canonicalPath.mid(projectPrefix.size(),
            canonicalPath.size() - projectPrefix.size() - QStringLiteral("/files").size());
        const QString fileId = finalized.value(QStringLiteral("id")).toString();
        if (!cluster::desktop::request::projectFileFinalizationPath(canonicalPath.toStdString())
            || fileId.isEmpty() || fileId.size() > 200
            || finalized.value(QStringLiteral("projectId")).toString() != projectId
            || finalized.value(QStringLiteral("checksumSha256")).toString().compare(
                   uploadResult.value(QStringLiteral("checksumSha256")).toString(), Qt::CaseInsensitive) != 0
            || finalized.value(QStringLiteral("sizeBytes")).toInteger(-1)
                   != entry.value(QStringLiteral("totalBytes")).toLongLong()) {
            finishReply(reply);
            fail(id, QStringLiteral("TRANSFER_FINALIZATION_PROOF_INVALID"),
                 QStringLiteral("The server finalization receipt did not identify the expected Project file. Verify server state before retrying."), true);
            return;
        }
        entry.insert(QStringLiteral("transferredBytes"), entry.value(QStringLiteral("totalBytes")));
        entry.insert(QStringLiteral("checksumSha256"), uploadResult.value(QStringLiteral("checksumSha256")));
        entry.insert(QStringLiteral("updatedAt"), nowIso());
        entry.insert(QStringLiteral("result"), finalized.toVariantMap());
        const bool needsLink = !entry.value(QStringLiteral("evidenceLink")).toMap().isEmpty();
        entry.insert(QStringLiteral("state"), needsLink ? QStringLiteral("committing") : QStringLiteral("complete"));
        if (!needsLink) entry.insert(QStringLiteral("completedAt"), nowIso());
        const bool persisted = publish(id, entry);
        finishReply(reply);
        if (!persisted) return;
        if (needsLink) { finalizeEvidenceLink(id); return; }
        m_activeId.clear();
        emit transferCompleted(id, entry.value(QStringLiteral("result")).toMap());
        // Library finalization consumes the upload through its canonical route.
        // A second DELETE would race other legitimate downstream consumers.
        schedule();
    });
}

void TransferManager::finalizeEvidenceLink(const QString &id)
{
    if (!ownsQueue()) return;
    QVariantMap entry = transfer(id);
    const QVariantMap intent = entry.value(QStringLiteral("evidenceLink")).toMap();
    const QVariantMap file = entry.value(QStringLiteral("result")).toMap();
    const QString projectId = file.value(QStringLiteral("projectId")).toString();
    const QString fileId = file.value(QStringLiteral("id")).toString();
    const QString kind = intent.value(QStringLiteral("targetKind")).toString();
    const QString targetId = intent.value(QStringLiteral("targetId")).toString();
    const QString relationship = intent.value(QStringLiteral("relationship")).toString();
    static const QRegularExpression idPattern(QStringLiteral("^[A-Za-z0-9_-]{1,200}$"));
    const QString canonicalPath = entry.value(QStringLiteral("finalizePath")).toString();
    const QString expectedPath = QStringLiteral("/api/projects/%1/files").arg(projectId);
    // The recovered file receipt cannot authorize linking another project or
    // a different blob. Revalidate the complete immutable upload identity.
    if (canonicalPath != expectedPath
        || file.value(QStringLiteral("checksumSha256")).toString().compare(
             entry.value(QStringLiteral("checksumSha256")).toString(), Qt::CaseInsensitive) != 0
        || file.value(QStringLiteral("sizeBytes")).toLongLong() != entry.value(QStringLiteral("totalBytes")).toLongLong()
        || !entry.value(QStringLiteral("uploadCompletionReceipt")).toBool()
        || !idPattern.match(projectId).hasMatch() || !idPattern.match(fileId).hasMatch()
        || !idPattern.match(targetId).hasMatch()
        || !QStringList{QStringLiteral("card"), QStringLiteral("ticket"), QStringLiteral("build"),
                        QStringLiteral("whiteboard"), QStringLiteral("qa_plan"), QStringLiteral("qa_session")}.contains(kind)
        || !QStringList{QStringLiteral("evidence_for"), QStringLiteral("references"),
                        QStringLiteral("informs"), QStringLiteral("supports")}.contains(relationship)) {
        fail(id, QStringLiteral("TRANSFER_EVIDENCE_INTENT_INVALID"),
             QStringLiteral("The retained evidence intent is invalid. The uploaded file remains available."), false);
        return;
    }
    QJsonObject body{
        {QStringLiteral("source"), QJsonObject{{QStringLiteral("kind"), QStringLiteral("file")},
            {QStringLiteral("id"), fileId}, {QStringLiteral("projectId"), projectId}}},
        {QStringLiteral("target"), QJsonObject{{QStringLiteral("kind"), kind},
            {QStringLiteral("id"), targetId}, {QStringLiteral("projectId"), projectId}}},
        {QStringLiteral("relationship"), relationship},
    };
    QNetworkRequest request = m_api->createRequest(QStringLiteral("/api/projects/%1/workflow-links").arg(projectId));
    addCsrf(request, m_api);
    request.setHeader(QNetworkRequest::ContentTypeHeader, QStringLiteral("application/json"));
    request.setRawHeader(QByteArrayLiteral("X-Cluster-Idempotency-Key"), QStringLiteral("qt-evidence:%1").arg(id).toUtf8());
    QNetworkReply *reply = m_api->networkAccessManager()->post(request, QJsonDocument(body).toJson(QJsonDocument::Compact));
    m_activeReply = reply;
    connect(reply, &QNetworkReply::finished, this, [this, id, reply, projectId, fileId, kind, targetId, relationship] {
        const QByteArray bytes = reply->readAll();
        if (discardInterruptedReply(id, reply)) return;
        const int status = reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
        if (reply->error() != QNetworkReply::NoError || status < 200 || status >= 300) {
            const QVariantMap error = parseReplyError(reply, bytes);
            const bool retryable = retryableUploadReply(reply);
            finishReply(reply);
            fail(id, QStringLiteral("TRANSFER_EVIDENCE_LINK_FAILED"),
                 QStringLiteral("File uploaded successfully but evidence link failed: %1").arg(error.value(QStringLiteral("message")).toString()), retryable);
            return;
        }
        const QJsonObject linked = QJsonDocument::fromJson(bytes).object();
        if (linked.value(QStringLiteral("projectId")).toString() != projectId
            || linked.value(QStringLiteral("sourceType")).toString() != QStringLiteral("file")
            || linked.value(QStringLiteral("sourceId")).toString() != fileId
            || linked.value(QStringLiteral("targetType")).toString() != kind
            || linked.value(QStringLiteral("targetId")).toString() != targetId
            || linked.value(QStringLiteral("relationship")).toString() != relationship) {
            finishReply(reply);
            fail(id, QStringLiteral("TRANSFER_EVIDENCE_RECEIPT_INVALID"),
                 QStringLiteral("The relationship receipt did not match the intended file and work item."), false);
            return;
        }
        QVariantMap entry = transfer(id);
        entry.insert(QStringLiteral("evidenceResult"), linked.toVariantMap());
        entry.insert(QStringLiteral("state"), QStringLiteral("complete"));
        entry.insert(QStringLiteral("completedAt"), nowIso());
        entry.insert(QStringLiteral("updatedAt"), nowIso());
        const bool persisted = publish(id, entry);
        finishReply(reply);
        if (!persisted) return;
        m_activeId.clear();
        emit transferCompleted(id, entry.value(QStringLiteral("result")).toMap());
        schedule();
    });
}

void TransferManager::runDownload(const QString &id)
{
    if (!ownsQueue()) return;
    QVariantMap entry = transfer(id);
    if (!downloadPathsSafe(entry)) {
        fail(id, QStringLiteral("TRANSFER_DOWNLOAD_DESTINATION_UNTRUSTED"),
             QStringLiteral("This download destination is outside the current Downloads folder or is not a safe regular file. Retained bytes were not changed."), false);
        return;
    }
    // A verified commit intent means the server bytes were previously fully
    // downloaded. Never start another HTTP GET: independently rehash either
    // retained partial bytes or the already renamed final artifact on a
    // manual resume. This is the crash boundary after QFile::rename.
    if (entry.value(QStringLiteral("downloadCommitReceipt")).toBool()) {
        verifyDownload(id);
        return;
    }
    const QString temporaryPath = entry.value(QStringLiteral("temporaryPath")).toString();
    const QFileInfo retained(temporaryPath);
    if (retained.isSymLink() || (retained.exists() && !retained.isFile())) {
        fail(id, QStringLiteral("TRANSFER_PART_PATH_INVALID"),
             QStringLiteral("The retained download path is not a regular file. Review it before retrying."), false);
        return;
    }
    const qint64 offset = retained.exists() ? retained.size() : 0;
    const qint64 knownTotal = entry.value(QStringLiteral("totalBytes")).toLongLong();
    if (knownTotal > 0 && offset > knownTotal) {
        fail(id, QStringLiteral("TRANSFER_LOCAL_LENGTH_INVALID"),
             QStringLiteral("The retained download exceeds its verified length. Review before retrying."), false);
        return;
    }
    if (knownTotal > 0 && offset == knownTotal) {
        entry.insert(QStringLiteral("transferredBytes"), offset);
        if (!publish(id, entry)) return;
        verifyDownload(id);
        return;
    }
    // A resume without a stable response identity or a complete expected SHA-256
    // risks joining bytes from two revisions of a mutable resource.
    const QString priorEtag = entry.value(QStringLiteral("responseEtag")).toString();
    const QString expectedSha = entry.value(QStringLiteral("expectedChecksumSha256")).toString();
    const bool shaPinned = QRegularExpression(QStringLiteral("^[a-fA-F0-9]{64}$")).match(expectedSha).hasMatch();
    if (offset > 0 && priorEtag.isEmpty() && !shaPinned) {
        fail(id, QStringLiteral("TRANSFER_RESUME_IDENTITY_MISSING"),
             QStringLiteral("The retained download has no trustworthy server generation or checksum. Start a new download instead of joining unverified bytes."), false);
        return;
    }
    entry.insert(QStringLiteral("transferredBytes"), offset);
    entry.insert(QStringLiteral("state"), QStringLiteral("running"));
    entry.insert(QStringLiteral("updatedAt"), nowIso());
    if (!publish(id, entry)) return;

    m_activeFile = new QFile(temporaryPath);
    if (!m_activeFile->open(QIODevice::WriteOnly | QIODevice::Append)) {
        delete m_activeFile;
        m_activeFile = nullptr;
        fail(id, QStringLiteral("TRANSFER_FILE_WRITE_FAILED"), QStringLiteral("Cluster could not open the temporary download file."), false);
        return;
    }
    const QString remotePath = entry.value(QStringLiteral("remotePath")).toString();
    if (!cluster::desktop::request::sameServerApiPath(remotePath.toStdString())) {
        fail(id, QStringLiteral("TRANSFER_REMOTE_PATH_INVALID"),
             QStringLiteral("This download is not bound to the authenticated Cluster Server API."), false);
        return;
    }
    QNetworkRequest request = m_api->createRequest(remotePath);
    request.setAttribute(QNetworkRequest::CacheLoadControlAttribute, QNetworkRequest::AlwaysNetwork);
    // Never follow a 3xx response to another host with the native user's
    // cookies or a privileged API client. Redirects require a new admission.
    request.setAttribute(QNetworkRequest::RedirectPolicyAttribute, QNetworkRequest::ManualRedirectPolicy);
    if (offset > 0) {
        request.setRawHeader(QByteArrayLiteral("Range"), QStringLiteral("bytes=%1-").arg(offset).toUtf8());
        if (!priorEtag.isEmpty()) request.setRawHeader(QByteArrayLiteral("If-Range"), priorEtag.toUtf8());
    }
    QNetworkReply *reply = m_api->networkAccessManager()->get(request);
    m_activeReply = reply;
    m_downloadResetChecked = false;
    m_downloadHeadersAccepted = false;
    m_downloadHeaderFailure.clear();
    m_downloadResponseLength = -1;
    m_downloadResponseTotal = -1;
    m_downloadResponseWritten = 0;

    // Parse the headers once and fail closed before writing any response bytes.
    // Never interpret an HTTP error (or a silently ignored Range) as permission
    // to truncate the retained .cluster-part file.
    const auto validateHeaders = [this, id, reply, offset, knownTotal, priorEtag]() {
        if (!ownsQueue() || m_downloadResetChecked || m_activeReply != reply || m_activeId != id) return;
        const int status = reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
        if (status == 0) return; // Headers have not arrived.
        m_downloadResetChecked = true;
        const auto reject = [this, reply](const QString &message) {
            m_downloadHeaderFailure = message;
            reply->abort();
        };
        if (status < 200 || status >= 300 || (status != 200 && status != 206)) {
            reject(QStringLiteral("The server rejected this download request."));
            return;
        }
        if (offset > 0 && status != 206) {
            reject(QStringLiteral("The server did not honor the requested resume offset. Retained bytes were preserved."));
            return;
        }
        const QByteArray responseEtag = reply->rawHeader(QByteArrayLiteral("ETag")).trimmed();
        const bool strongEtag = responseEtag.startsWith('"') && responseEtag.endsWith('"')
            && responseEtag.size() >= 3 && responseEtag.size() <= 256;
        if (offset > 0 && !priorEtag.isEmpty() && responseEtag != priorEtag.toUtf8()) {
            reject(QStringLiteral("The server's download generation changed during resume."));
            return;
        }
        const auto admission = cluster::desktop::download::admit(
            status, offset, knownTotal,
            reply->rawHeader(QByteArrayLiteral("Content-Range")).trimmed().toStdString(),
            reply->rawHeader(QByteArrayLiteral("Content-Length")).trimmed().toStdString(),
            responseEtag.toStdString(), priorEtag.toStdString());
        if (!admission.accepted()) {
            using Reject = cluster::desktop::download::Reject;
            if (admission.rejection == Reject::ignoredResume)
                reject(QStringLiteral("The server ignored the requested resume offset. Retained bytes were preserved."));
            else if (admission.rejection == Reject::changedGeneration)
                reject(QStringLiteral("The download changed on the server. Retained bytes were preserved."));
            else if (admission.rejection == Reject::mismatchedRange)
                reject(QStringLiteral("The resumed response does not match the saved byte range or size."));
            else if (admission.rejection == Reject::fragmentTooSmall)
                reject(QStringLiteral("The server returned an excessively small partial range for this download. Automatic continuation was stopped to prevent repeated requests."));
            else
                reject(QStringLiteral("The server returned an invalid or unverifiable download range."));
            return;
        }
        const qint64 length = admission.bodyLength;
        const qint64 total = admission.total;
        m_downloadResponseLength = length;
        m_downloadResponseTotal = total;
        m_downloadHeadersAccepted = true;
        QVariantMap current = transfer(id);
        current.insert(QStringLiteral("totalBytes"), total);
        if (offset == 0 && strongEtag) current.insert(QStringLiteral("responseEtag"), QString::fromLatin1(responseEtag));
        else if (offset == 0) current.remove(QStringLiteral("responseEtag"));
        if (!publish(id, current)) return;
    };
    connect(reply, &QNetworkReply::metaDataChanged, this, validateHeaders);
    connect(reply, &QNetworkReply::readyRead, this, [this, id, reply, validateHeaders] {
        validateHeaders();
        if (!ownsQueue() || !m_downloadHeadersAccepted || m_activeReply != reply || m_activeId != id || !m_activeFile
            || transferState(transfer(id)) != QStringLiteral("running"))
            return;
        const QByteArray chunk = reply->readAll();
        if (m_downloadResponseLength < 0 || chunk.size() > m_downloadResponseLength - m_downloadResponseWritten) {
            m_downloadHeaderFailure = QStringLiteral("The server delivered more bytes than its validated response range.");
            reply->abort();
            return;
        }
        if (m_activeFile->write(chunk) != chunk.size()) {
            m_downloadHeaderFailure = QStringLiteral("The temporary download could not be written to disk.");
            reply->abort();
            return;
        }
        m_downloadResponseWritten += chunk.size();
        QVariantMap current = transfer(id);
        current.insert(QStringLiteral("transferredBytes"), m_activeFile->size());
        current.insert(QStringLiteral("updatedAt"), nowIso());
        publishDownloadProgress(id, current);
    });
    connect(reply, &QNetworkReply::finished, this, [this, id, reply, offset, validateHeaders] {
        validateHeaders();
        if (m_activeId != id || m_activeReply != reply) {
            finishReply(reply);
            return;
        }
        const QString latestState = transferState(transfer(id));
        const bool interruptedByUser = latestState == QStringLiteral("paused") || latestState == QStringLiteral("cancelled");
        const QByteArray trailing = (m_downloadHeadersAccepted && !interruptedByUser) ? reply->readAll() : QByteArray{};
        bool writeOk = m_downloadResponseLength >= 0
            && trailing.size() <= m_downloadResponseLength - m_downloadResponseWritten;
        if (m_activeFile && !trailing.isEmpty() && writeOk) {
            writeOk = m_activeFile->write(trailing) == trailing.size();
            if (writeOk) m_downloadResponseWritten += trailing.size();
        }
        if (m_activeFile) {
            writeOk = m_activeFile->flush() && writeOk;
            m_activeFile->close();
            delete m_activeFile;
            m_activeFile = nullptr;
        }
        const QString validationError = m_downloadHeaderFailure;
        const bool validated = m_downloadHeadersAccepted;
        const qint64 total = m_downloadResponseTotal;
        const qint64 length = m_downloadResponseLength;
        if (interruptedByUser) {
            finishReply(reply);
            if (latestState == QStringLiteral("cancelled"))
                removeOwnedPartial(transfer(id));
            m_activeId.clear();
            schedule();
            return;
        }
        if (!validationError.isEmpty() || !writeOk || !validated) {
            finishReply(reply);
            const bool connectionFailed = !validated && validationError.isEmpty()
                && reply->error() != QNetworkReply::NoError;
            fail(id, connectionFailed ? QStringLiteral("TRANSFER_NETWORK_INTERRUPTED")
                                      : QStringLiteral("TRANSFER_DOWNLOAD_RESPONSE_INVALID"),
                 !validationError.isEmpty() ? validationError : QStringLiteral("Download response or disk write validation failed."),
                 connectionFailed);
            return;
        }
        if (reply->error() == QNetworkReply::OperationCanceledError) {
            finishReply(reply);
            m_activeId.clear();
            schedule();
            return;
        }
        if (reply->error() != QNetworkReply::NoError) {
            const QVariantMap error = parseReplyError(reply, QByteArray{});
            finishReply(reply);
            fail(id, error.value(QStringLiteral("code")).toString(), error.value(QStringLiteral("message")).toString());
            return;
        }
        const qint64 actual = QFileInfo(transfer(id).value(QStringLiteral("temporaryPath")).toString()).size();
        finishReply(reply);
        if (transferState(transfer(id)) != QStringLiteral("running")) {
            m_activeId.clear();
            schedule();
            return;
        }
        if (actual != offset + length || actual > total) {
            fail(id, QStringLiteral("TRANSFER_RESPONSE_LENGTH_MISMATCH"),
                 QStringLiteral("Downloaded bytes do not match the validated response length."), false);
            return;
        }
        if (actual < total) {
            // A valid partial response is not a complete file: issue another
            // strictly bounded continuation rather than hashing truncated data.
            runDownload(id);
            return;
        }
        verifyDownload(id);
    });
}

void TransferManager::verifyDownload(const QString &id)
{
    if (!ownsQueue()) return;
    QVariantMap entry = transfer(id);
    if (!downloadPathsSafe(entry)) {
        fail(id, QStringLiteral("TRANSFER_DOWNLOAD_DESTINATION_UNTRUSTED"),
             QStringLiteral("This downloaded file is outside the current Downloads folder or is not a safe regular file. No bytes were changed."), false);
        return;
    }
    const bool recoveringCommit = entry.value(QStringLiteral("downloadCommitReceipt")).toBool();
    const QString temporaryPath = entry.value(QStringLiteral("temporaryPath")).toString();
    const QString targetPath = entry.value(QStringLiteral("filePath")).toString();
    QString verifyPath = temporaryPath;
    if (recoveringCommit) {
        const QString receipt = entry.value(QStringLiteral("checksumSha256")).toString();
        const bool receiptValid = QRegularExpression(QStringLiteral("^[a-fA-F0-9]{64}$")).match(receipt).hasMatch();
        const QFileInfo temporary(temporaryPath);
        const QFileInfo finalFile(targetPath);
        const bool hasTemporary = temporary.exists() || temporary.isSymLink();
        const bool hasFinal = finalFile.exists() || finalFile.isSymLink();
        if (!receiptValid || hasTemporary == hasFinal
            || (hasTemporary && (!temporary.isFile() || temporary.isSymLink()))
            || (hasFinal && (!finalFile.isFile() || finalFile.isSymLink()))) {
            fail(id, QStringLiteral("TRANSFER_FINALIZE_RECOVERY_AMBIGUOUS"),
                 QStringLiteral("Download commit evidence is missing, ambiguous or not a regular file. No retained bytes were changed."), false);
            return;
        }
        verifyPath = hasFinal ? targetPath : temporaryPath;
        if (QFileInfo(verifyPath).size() != entry.value(QStringLiteral("totalBytes")).toLongLong()) {
            fail(id, QStringLiteral("TRANSFER_FINALIZE_RECOVERY_LENGTH_MISMATCH"),
                 QStringLiteral("Retained download bytes do not match the committed file length."), false);
            return;
        }
    }
    entry.insert(QStringLiteral("state"), QStringLiteral("verifying"));
    entry.insert(QStringLiteral("updatedAt"), nowIso());
    if (!publish(id, entry)) return;
    auto *watcher = new QFutureWatcher<QByteArray>(this);
    connect(watcher, &QFutureWatcher<QByteArray>::finished, this, [this, id, watcher] {
        const QByteArray checksum = watcher->result();
        watcher->deleteLater();
        if (m_activeId != id || transferState(transfer(id)) != QStringLiteral("verifying")) {
            if (m_activeId == id) {
                if (transferState(transfer(id)) == QStringLiteral("cancelled")
                    && transfer(id).value(QStringLiteral("direction")).toString() == QStringLiteral("download"))
                    removeOwnedPartial(transfer(id));
                m_activeId.clear();
                schedule();
            }
            return;
        }
        if (checksum.isEmpty()) {
            fail(id, QStringLiteral("TRANSFER_CHECKSUM_FAILED"), QStringLiteral("Cluster could not calculate the download checksum."), false);
            return;
        }
        finishDownload(id, checksum);
    });
    watcher->setFuture(QtConcurrent::run(&TransferManager::sha256File, verifyPath));
}

void TransferManager::finishDownload(const QString &id, const QByteArray &checksum)
{
    if (!ownsQueue()) return;
    QVariantMap entry = transfer(id);
    if (m_activeId != id || transferState(entry) != QStringLiteral("verifying")) return;
    if (!downloadPathsSafe(entry)) {
        fail(id, QStringLiteral("TRANSFER_DOWNLOAD_DESTINATION_UNTRUSTED"),
             QStringLiteral("The download destination became unsafe before publication. No bytes were committed."), false);
        return;
    }
    const QString expected = entry.value(QStringLiteral("expectedChecksumSha256")).toString();
    if (!expected.isEmpty() && expected.compare(QString::fromLatin1(checksum), Qt::CaseInsensitive) != 0) {
        fail(id, QStringLiteral("TRANSFER_CHECKSUM_MISMATCH"), QStringLiteral("The downloaded file checksum did not match the server value."), false);
        return;
    }
    const QString temporaryPath = entry.value(QStringLiteral("temporaryPath")).toString();
    const QString targetPath = entry.value(QStringLiteral("filePath")).toString();
    const bool recoveringCommit = entry.value(QStringLiteral("downloadCommitReceipt")).toBool();
    if (recoveringCommit) {
        // A previous finalized copy may have survived the crash. Its saved
        // SHA-256 must match newly read local bytes before declaring success.
        if (entry.value(QStringLiteral("checksumSha256")).toString().compare(
                QString::fromLatin1(checksum), Qt::CaseInsensitive) != 0) {
            fail(id, QStringLiteral("TRANSFER_FINALIZE_RECOVERY_CHECKSUM_MISMATCH"),
                 QStringLiteral("The retained download no longer matches its durable commit receipt."), false);
            return;
        }
    } else {
        const QFileInfo original(temporaryPath);
        if (!original.isFile() || original.isSymLink()
            || original.size() != entry.value(QStringLiteral("totalBytes")).toLongLong()) {
            fail(id, QStringLiteral("TRANSFER_FINALIZE_SOURCE_INVALID"),
                 QStringLiteral("The verified temporary file is no longer a complete regular file."), false);
            return;
        }
        // Phase 1: persist checksum evidence BEFORE the filesystem rename.
        // A crash or disk-full failure must never strand an unidentifiable
        // final file that can't be rehashed on the next explicit Resume.
        entry.insert(QStringLiteral("state"), QStringLiteral("committing"));
        // A final network reply may contain the last response bytes. Persist
        // the verified full length rather than the last volatile UI offset.
        entry.insert(QStringLiteral("transferredBytes"), entry.value(QStringLiteral("totalBytes")));
        entry.insert(QStringLiteral("checksumSha256"), QString::fromLatin1(checksum));
        entry.insert(QStringLiteral("downloadCommitReceipt"), true);
        entry.insert(QStringLiteral("updatedAt"), nowIso());
        if (!publish(id, entry)) return;
    }
    const QFileInfo finalFile(targetPath);
    const QFileInfo temporary(temporaryPath);
    if (finalFile.exists() || finalFile.isSymLink()) {
        // Only an independently verified previously committed download may
        // own a preexisting destination. Never overwrite an unrelated file.
        if (!recoveringCommit || temporary.exists() || temporary.isSymLink()
            || !finalFile.isFile() || finalFile.isSymLink()
            || finalFile.size() != entry.value(QStringLiteral("totalBytes")).toLongLong()) {
            fail(id, QStringLiteral("TRANSFER_TARGET_ALREADY_EXISTS"),
                 QStringLiteral("Another file occupies the download destination. Retained bytes were preserved."), false);
            return;
        }
    } else {
        if (!temporary.isFile() || temporary.isSymLink()
            || temporary.size() != entry.value(QStringLiteral("totalBytes")).toLongLong()) {
            fail(id, QStringLiteral("TRANSFER_FINALIZE_SOURCE_INVALID"),
                 QStringLiteral("The retained partial file is missing or changed. No destination was modified."), false);
            return;
        }
        if (!QFile::rename(temporaryPath, targetPath)) {
            fail(id, QStringLiteral("TRANSFER_FINALIZE_FAILED"),
                 QStringLiteral("Cluster could not publish the verified download. Retry after correcting storage permissions."), true);
            return;
        }
    }
    // Phase 2: if this save fails, the durable commit receipt remains, and
    // explicit resume will rehash the final artifact instead of redownloading.
    entry.insert(QStringLiteral("state"), QStringLiteral("complete"));
    entry.insert(QStringLiteral("completedAt"), nowIso());
    entry.insert(QStringLiteral("updatedAt"), nowIso());
    if (!publish(id, entry)) return;
    m_activeId.clear();
    emit transferCompleted(id, {{QStringLiteral("filePath"), targetPath}, {QStringLiteral("checksumSha256"), QString::fromLatin1(checksum)}});
    schedule();
}

void TransferManager::fail(const QString &id, const QString &code, const QString &message, bool retryable)
{
    QVariantMap entry = transfer(id);
    if (entry.isEmpty())
        return;
    if (transferState(entry) == QStringLiteral("paused") || transferState(entry) == QStringLiteral("cancelled")) {
        m_activeId.clear();
        schedule();
        return;
    }
    entry.insert(QStringLiteral("state"), QStringLiteral("failed"));
    entry.insert(QStringLiteral("attempts"), entry.value(QStringLiteral("attempts")).toInt() + 1);
    entry.insert(QStringLiteral("updatedAt"), nowIso());
    entry.insert(QStringLiteral("error"), message);
    entry.insert(QStringLiteral("errorCode"), code.isEmpty() ? QStringLiteral("TRANSFER_FAILED") : code);
    entry.insert(QStringLiteral("retryable"), retryable);
    if (!publish(id, entry)) return;
    m_activeId.clear();
    emit transferFailed(id, {{QStringLiteral("code"), entry.value(QStringLiteral("errorCode"))}, {QStringLiteral("message"), message}, {QStringLiteral("retryable"), retryable}});
    schedule();
}

bool TransferManager::discardInterruptedReply(const QString &id, QNetworkReply *reply)
{
    // A failed durable journal write is not a user cancellation. Discard any
    // reply from a request already in flight; never process its remote result.
    if (!ownsQueue()) {
        finishReply(reply);
        if (m_activeId == id) m_activeId.clear();
        return true;
    }
    const QString state = transferState(transfer(id));
    if (m_activeId == id && !state.isEmpty() && state != QStringLiteral("paused")
        && state != QStringLiteral("cancelled")) return false;
    finishReply(reply);
    if (m_activeId == id) {
        // A request may have committed remotely before its cancellation reply.
        // Never resurrect it locally. The next explicit server inspection must
        // settle an uncertain upload outcome rather than blindly replaying.
        m_activeId.clear();
        schedule();
    }
    return true;
}

void TransferManager::finishReply(QNetworkReply *reply)
{
    if (m_activeReply == reply)
        m_activeReply.clear();
    reply->deleteLater();
}

QVariantMap TransferManager::parseReplyError(QNetworkReply *reply, const QByteArray &body) const
{
    const QJsonObject payload = QJsonDocument::fromJson(body).object();
    QString message = payload.value(QStringLiteral("message")).toString();
    if (message.isEmpty())
        message = payload.value(QStringLiteral("error")).toString();
    if (message.isEmpty())
        message = reply->errorString();
    return {
        {QStringLiteral("code"), payload.value(QStringLiteral("code")).toString(QStringLiteral("TRANSFER_REQUEST_FAILED"))},
        {QStringLiteral("message"), message},
    };
}

QVariantMap TransferManager::transfer(const QString &id) const
{
    return m_transfers.value(id);
}
