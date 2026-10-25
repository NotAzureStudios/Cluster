#pragma once

#include <QObject>
#include <QString>
#include <QVariantList>
#include <QVariantMap>

class ServerProfileStore final : public QObject
{
    Q_OBJECT
    Q_PROPERTY(QVariantList profiles READ profiles NOTIFY profilesChanged)
    Q_PROPERTY(QString activeProfileId READ activeProfileId NOTIFY activeProfileChanged)
    Q_PROPERTY(QString activeServerUrl READ activeServerUrl NOTIFY activeProfileChanged)
    Q_PROPERTY(QVariantMap activeProfile READ activeProfile NOTIFY activeProfileChanged)
    Q_PROPERTY(QString activeLastRoute READ activeLastRoute NOTIFY activeProfileChanged)
    Q_PROPERTY(QString activeLastInspector READ activeLastInspector NOTIFY activeProfileChanged)
    Q_PROPERTY(QString profileDataRoot READ profileDataRoot CONSTANT)
    Q_PROPERTY(QString activeNativeDataPath READ activeNativeDataPath NOTIFY activeProfileChanged)
    Q_PROPERTY(bool recoveryRequired READ recoveryRequired NOTIFY recoveryRequiredChanged)
    Q_PROPERTY(QString lastOperationError READ lastOperationError NOTIFY lastOperationErrorChanged)

public:
    explicit ServerProfileStore(QObject *parent = nullptr);

    static QString prepareWebViewEnvironment(int argc, char *argv[]);
    static QString normalizeServerUrl(const QString &rawUrl, QString *errorMessage = nullptr);
    static QString profileIdForUrl(const QString &normalizedUrl);

    QVariantList profiles() const;
    QString activeProfileId() const;
    QString activeServerUrl() const;
    QVariantMap activeProfile() const;
    QString activeLastRoute() const;
    QString activeLastInspector() const;
    QString profileDataRoot() const;
    QString activeNativeDataPath() const;
    bool recoveryRequired() const;
    QString lastOperationError() const;

    Q_INVOKABLE QVariantMap validateServer(const QString &rawUrl) const;
    Q_INVOKABLE QVariantMap addServer(const QString &rawUrl, const QString &label = QString());
    Q_INVOKABLE bool switchProfile(const QString &profileId);
    Q_INVOKABLE bool switchServer(const QString &rawUrl, const QString &label = QString());
    Q_INVOKABLE bool renameProfile(const QString &profileId, const QString &label);
    Q_INVOKABLE bool forgetProfile(const QString &profileId);
    Q_INVOKABLE bool clearProfileData(const QString &profileId);
    Q_INVOKABLE bool resetProfileData(const QString &profileId);
    Q_INVOKABLE bool clearRecoveryState(const QString &profileId);
    Q_INVOKABLE bool openProfileFolder(const QString &profileId) const;
    Q_INVOKABLE bool openProfilesFolder() const;
    Q_INVOKABLE bool requestSignOut(const QString &profileId);
    Q_INVOKABLE void completeSignOut(const QString &profileId, bool serverSessionRevoked);
    Q_INVOKABLE bool isUrlAllowedForActiveProfile(const QString &rawUrl) const;
    Q_INVOKABLE void recordRendererLoadSucceeded(const QString &rawUrl);
    Q_INVOKABLE void recordRendererLoadFailed(const QString &errorMessage);
    Q_INVOKABLE void updateRendererIdentity(const QString &serverLabel, const QString &userLabel, const QString &route, const QString &inspector = QString());
    Q_INVOKABLE QVariantList recentWorkspaces() const;
    Q_INVOKABLE void recordRecentWorkspace(const QString &route, const QString &title, const QString &kind, const QString &resourceId);
    Q_INVOKABLE bool clearRecentWorkspaces();
    Q_INVOKABLE void markCleanExit();

signals:
    void profilesChanged();
    void activeProfileChanged();
    void recoveryRequiredChanged();
    void lastOperationErrorChanged();
    void restartRequested();
    void signOutRequested(const QString &profileId);
    void rendererLoadSucceeded();
    void rendererLoadFailed(const QString &errorMessage);
    void recentWorkspacesChanged();

private:
    struct ProfileRecord {
        QString id;
        QString url;
        QString label;
        QString serverLabel;
        QString userLabel;
        QString createdAt;
        QString lastUsedAt;
        QString lastConnectedAt;
        QString lastFailureAt;
        QString lastError;
        QString lastRoute;
        QString lastInspector;
        int successfulLoads = 0;
        int failedLoads = 0;
        int consecutiveFailures = 0;
        int uncleanLaunches = 0;
        bool pendingClear = false;
        bool recoveryRequired = false;
    };

    void load();
    bool save() const;
    int indexOf(const QString &profileId) const;
    QVariantMap toVariant(const ProfileRecord &profile) const;
    bool activateProfileIndex(int index, bool restart);
    bool restartIntoProfile(const QString &profileId) const;
    QString profilePath(const QString &profileId) const;
    QString nativeProfilePath(const QString &profileId) const;
    void setLastOperationError(const QString &message);
    bool removeProfileData(const QString &profileId) const;
    void refreshRecoveryState();

    QString m_registryRoot;
    QString m_profileDataRoot;
    QString m_nativeDataRoot;
    QString m_activeProfileId;
    QString m_sessionProfileId;
    QList<ProfileRecord> m_profiles;
    bool m_recoveryRequired = false;
    QString m_lastOperationError;
};
