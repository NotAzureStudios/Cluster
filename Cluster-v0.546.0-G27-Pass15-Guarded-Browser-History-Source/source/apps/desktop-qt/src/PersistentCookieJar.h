#pragma once

#include <QNetworkCookieJar>
#include <QString>

class QSettings;

class PersistentCookieJar final : public QNetworkCookieJar
{
    Q_OBJECT

public:
    explicit PersistentCookieJar(QObject *parent = nullptr);

    void setProfileContext(const QString &profileId, const QString &origin, const QString &profileDataPath);
    void clearForCurrentOrigin();
    bool persistenceAvailable() const;

    bool setCookiesFromUrl(const QList<QNetworkCookie> &cookieList, const QUrl &url) override;
    bool deleteCookie(const QNetworkCookie &cookie) override;
    bool updateCookie(const QNetworkCookie &cookie) override;
    bool insertCookie(const QNetworkCookie &cookie) override;

private:
    QString storagePath() const;
    QString legacyStorageKey() const;
    void load();
    void save() const;
    QByteArray protect(const QByteArray &plain) const;
    QByteArray unprotect(const QByteArray &cipher) const;
    QByteArray unprotectLegacy(const QByteArray &cipher) const;
    QByteArray entropy() const;

    QString m_profileId;
    QString m_origin;
    QString m_profileDataPath;
};
