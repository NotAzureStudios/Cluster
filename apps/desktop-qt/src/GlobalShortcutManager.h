#pragma once

#include <QAbstractNativeEventFilter>
#include <QObject>
#include <QVariantMap>

#ifdef Q_OS_LINUX
#include <QDBusObjectPath>
#endif

class QEventLoop;

class GlobalShortcutManager final : public QObject, public QAbstractNativeEventFilter
{
    Q_OBJECT
    Q_PROPERTY(bool enabled READ enabled WRITE setEnabled NOTIFY statusChanged)
    Q_PROPERTY(QVariantMap status READ status NOTIFY statusChanged)

public:
    explicit GlobalShortcutManager(QObject *parent = nullptr);
    ~GlobalShortcutManager() override;

    bool enabled() const { return m_enabled; }
    void setEnabled(bool enabled);
    QVariantMap status() const;
    Q_INVOKABLE bool registerShortcuts();
    Q_INVOKABLE void unregisterShortcuts();
    Q_INVOKABLE void trigger(int id);
    bool nativeEventFilter(const QByteArray &eventType, void *message, qintptr *result) override;

signals:
    void statusChanged();
    void commandRequested(const QString &command);
    void activateRequested();

private:
    bool registerPlatformShortcuts();
    void unregisterPlatformShortcuts();

#ifdef Q_OS_LINUX
    bool portalAvailable();
    bool runPortalRequest(const QString &method, const QVariantList &arguments, const QString &handleToken, QVariantMap *results);
    QString portalRequestPath(const QString &handleToken) const;
    QString shortcutLabel(const QString &id, const QString &fallback) const;

private slots:
    void handlePortalResponse(uint response, const QVariantMap &results);
    void handlePortalActivated(const QDBusObjectPath &sessionHandle, const QString &shortcutId, qulonglong timestamp, const QVariantMap &options);
    void handlePortalSessionClosed(const QVariantMap &details);
#endif

    bool m_enabled = true;
    bool m_registered = false;
    bool m_supported = true;
    QString m_provider;
    QString m_error;
#ifdef Q_OS_MACOS
    void *m_macHotKeys[3] = {nullptr, nullptr, nullptr};
    void *m_macHandler = nullptr;
#elif defined(Q_OS_LINUX)
    QString m_portalSessionHandle;
    QVariantMap m_portalShortcutLabels;
    QEventLoop *m_portalLoop = nullptr;
    uint m_portalResponse = 2;
    QVariantMap m_portalResults;
    QString m_pendingRequestPath;
#endif
};
