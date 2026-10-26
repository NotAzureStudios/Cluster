#pragma once

#include <QHash>
#include <QJsonValue>
#include <QList>
#include <QSet>
#include <QObject>
#include <QVariantList>
#include <QVariantMap>

class ApiClient;
class ClusterFuseMount;
class ServerProfileStore;
class TransferManager;

class LibraryMountManager final : public QObject
{
    Q_OBJECT
    Q_PROPERTY(QVariantMap status READ status NOTIFY statusChanged)
public:
    LibraryMountManager(ApiClient *api, ServerProfileStore *profiles, TransferManager *transfers, QObject *parent = nullptr);
    ~LibraryMountManager() override;

    QVariantMap status() const;
    void setProfileContext(const QString &profileId, const QString &profileDataPath, const QString &serverUrl);
    void setAuthenticatedUser(const QString &userId);

    Q_INVOKABLE bool start(const QVariantMap &options = {});
    Q_INVOKABLE bool stop();
    void forceStop();
    Q_INVOKABLE bool refresh();
    Q_INVOKABLE bool clearCache();

signals:
    void statusChanged();

private:
    struct SourceContext {
        QString profileId;
        QString label;
        QString serverUrl;
        QString nativeDataPath;
        ApiClient *api = nullptr;
        TransferManager *transfers = nullptr;
        QVariantMap manifest;
        QVariantMap error;
        bool active = false;
        bool authenticated = false;
        bool terminal = false;
        bool ownsObjects = false;
    };

    void rebuildSourceContexts();
    void clearOwnedSourceContexts();
    void requestSourceManifest(SourceContext *source);
    void handleSourceSuccess(SourceContext *source, const QString &operation, const QJsonValue &payload);
    void handleSourceFailure(SourceContext *source, const QString &operation, const QVariantMap &error);
    void finishSourceRefreshIfReady();
    void applyTopology();
    void stopMounts();
    QVariantList arrangeSourceManifest(const SourceContext *source, bool unified, QVariantList *roots, QSet<QString> *syntheticPaths) const;
    QVariantMap sourceRuntimeConfig(const SourceContext *source, const QVariantList &roots) const;
    QString resolvedMountLocation(const QString &requested) const;
    QString separateMountLocation(const QString &base, const QString &label, int index, QSet<QString> *usedWindowsLetters) const;
    QString providerName() const;
    bool providerDetected() const;
    bool anyRunning() const;
    bool activeMountRequired() const;
    SourceContext *sourceById(const QString &profileId) const;
    void queueDirtyFile(const QString &sourceId, const QString &relativePath, const QString &itemId,
                        int revision, const QString &localPath, const QString &parentId);
    QString sourceLabel(const QVariantMap &profile) const;

    ApiClient *m_api = nullptr;
    ServerProfileStore *m_profiles = nullptr;
    TransferManager *m_transfers = nullptr;
    QList<ClusterFuseMount *> m_mounts;
    QHash<QString, SourceContext *> m_sources;
    QString m_profileId;
    QString m_profileDataPath;
    QString m_serverUrl;
    QString m_userId;
    QString m_mountLocation;
    QString m_cacheRoot;
    QString m_layout = QStringLiteral("unified");
    QString m_organization = QStringLiteral("servers");
    QVariantMap m_manifest;
    QVariantMap m_lastError;
    bool m_refreshing = false;
    bool m_requestedRunning = false;
};
