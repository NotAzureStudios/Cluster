#pragma once

#include "VariantListModel.h"

#include <QByteArray>
#include <QHash>
#include <QJsonObject>
#include <QObject>
#include <QPointer>
#include <QVariantMap>

class ApiClient;
class QFile;
class QNetworkReply;
class QLockFile;
class QFileSystemWatcher;

typedef QHash<QString, QVariantMap> TransferMap;

class TransferManager final : public QObject
{
    Q_OBJECT
    Q_PROPERTY(VariantListModel* model READ model CONSTANT)
    Q_PROPERTY(int activeCount READ activeCount NOTIFY countsChanged)
    Q_PROPERTY(int pendingCount READ pendingCount NOTIFY countsChanged)
    Q_PROPERTY(bool busy READ busy NOTIFY countsChanged)

public:
    explicit TransferManager(ApiClient *api, QObject *parent = nullptr);
    ~TransferManager() override;
    bool ownsQueue() const;
    bool retryOwnership();
    QString queueBlockedReason() const;

    VariantListModel *model() const;
    int activeCount() const;
    int pendingCount() const;
    bool busy() const;

    void setProfileDataRoot(const QString &root);
    void setScope(const QString &scope);
    QString scope() const;

    QString startUpload(const QString &localPath, const QString &purpose,
                        const QString &finalizePath = {}, const QVariantMap &finalizeBody = {},
                        const QVariantMap &evidenceLink = {});
    QString startDownload(const QString &remotePath, const QString &suggestedName,
                          const QString &expectedChecksumSha256 = {});

    Q_INVOKABLE bool pause(const QString &transferId);
    Q_INVOKABLE bool resume(const QString &transferId);
    Q_INVOKABLE bool retry(const QString &transferId);
    Q_INVOKABLE bool cancel(const QString &transferId);
    Q_INVOKABLE bool remove(const QString &transferId);
    Q_INVOKABLE bool retryAll();
    bool openResult(const QString &transferId) const;
    bool revealResult(const QString &transferId) const;

signals:
    void countsChanged();
    void transferCompleted(const QString &transferId, const QVariantMap &result);
    void transferFailed(const QString &transferId, const QVariantMap &error);

private:
    static QString nowIso();
    static QString safeDownloadName(const QString &name);
    bool validJournalEntry(const QJsonObject &record) const;
    bool uploadSourceMatches(const QVariantMap &entry) const;
    bool downloadPathsSafe(const QVariantMap &entry) const;
    bool removeOwnedPartial(const QVariantMap &entry) const;
    bool reserveQueueEntry();
    bool downloadDestinationAvailable(const QString &candidate) const;
    static QByteArray sha256File(const QString &filePath);

    QString storagePath() const;
    void load();
    bool save() const;
    void releaseScopeOwnership();
    void acquireScopeOwnership();
    void refreshStandbyQueue();
    void rebuildModel();
    void holdFailedJournalWrite();
    bool publish(const QString &id, const QVariantMap &next);
    void publishDownloadProgress(const QString &id, const QVariantMap &next);
    void schedule();
    void processNext();
    void runUpload(const QString &id);
    void createUploadSession(const QString &id);
    void queryUploadSession(const QString &id);
    void resumeServerUploadSession(const QString &id);
    void sendUploadChunk(const QString &id);
    void verifyUpload(const QString &id);
    void completeUpload(const QString &id, const QByteArray &checksum);
    void finalizeUpload(const QString &id, const QVariantMap &uploadResult);
    void finalizeEvidenceLink(const QString &id);
    void runDownload(const QString &id);
    void verifyDownload(const QString &id);
    void finishDownload(const QString &id, const QByteArray &checksum);
    void fail(const QString &id, const QString &code, const QString &message, bool retryable = true);
    void finishReply(QNetworkReply *reply);
    bool discardInterruptedReply(const QString &id, QNetworkReply *reply);
    QVariantMap parseReplyError(QNetworkReply *reply, const QByteArray &body) const;
    QVariantMap transfer(const QString &id) const;

    ApiClient *m_api = nullptr;
    VariantListModel *m_model = nullptr;
    TransferMap m_transfers;
    QString m_scope;
    QString m_profileDataRoot;
    QString m_activeId;
    QLockFile *m_scopeLock = nullptr;
    QFileSystemWatcher *m_scopeWatcher = nullptr;
    bool m_scopeWritable = false;
    bool m_queueReadable = true;
    // Separate a post-admission disk failure from a corrupt preexisting journal.
    bool m_queueWriteFailed = false;
    bool m_standbyRefreshScheduled = false;
    QPointer<QNetworkReply> m_activeReply;
    QFile *m_activeFile = nullptr;
    // Never append a response body before validating its range and generation.
    bool m_downloadResetChecked = false;
    bool m_downloadHeadersAccepted = false;
    QString m_downloadHeaderFailure;
    qint64 m_downloadResponseLength = -1;
    qint64 m_downloadResponseTotal = -1;
    qint64 m_downloadResponseWritten = 0;
};
