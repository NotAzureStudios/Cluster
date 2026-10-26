#pragma once

#include <QObject>
#include <QString>
#include <QVariantMap>

class DesktopPreferences final : public QObject
{
    Q_OBJECT
    Q_PROPERTY(QString appearance READ appearance WRITE setAppearance NOTIFY appearanceChanged)
    Q_PROPERTY(QString density READ density WRITE setDensity NOTIFY densityChanged)
    Q_PROPERTY(bool reducedMotion READ reducedMotion WRITE setReducedMotion NOTIFY reducedMotionChanged)
    Q_PROPERTY(bool highContrast READ highContrast WRITE setHighContrast NOTIFY highContrastChanged)
    Q_PROPERTY(QString motionMode READ motionMode WRITE setMotionMode NOTIFY motionModeChanged)
    Q_PROPERTY(QString contrastMode READ contrastMode WRITE setContrastMode NOTIFY contrastModeChanged)
    Q_PROPERTY(QString transparencyMode READ transparencyMode WRITE setTransparencyMode NOTIFY transparencyModeChanged)
    Q_PROPERTY(QString textScale READ textScale WRITE setTextScale NOTIFY textScaleChanged)
    Q_PROPERTY(bool largeTargets READ largeTargets WRITE setLargeTargets NOTIFY largeTargetsChanged)
    Q_PROPERTY(QString focusIndicator READ focusIndicator WRITE setFocusIndicator NOTIFY focusIndicatorChanged)
    Q_PROPERTY(QString statusPalette READ statusPalette WRITE setStatusPalette NOTIFY statusPaletteChanged)
    Q_PROPERTY(bool systemHighContrast READ systemHighContrast NOTIFY systemAccessibilityChanged)
    Q_PROPERTY(bool systemReducedMotion READ systemReducedMotion NOTIFY systemAccessibilityChanged)
    Q_PROPERTY(bool systemReducedTransparency READ systemReducedTransparency NOTIFY systemAccessibilityChanged)
    Q_PROPERTY(bool launchAtStartup READ launchAtStartup WRITE setLaunchAtStartup NOTIFY launchAtStartupChanged)
    Q_PROPERTY(bool closeToTray READ closeToTray WRITE setCloseToTray NOTIFY closeToTrayChanged)
    Q_PROPERTY(bool notificationsEnabled READ notificationsEnabled WRITE setNotificationsEnabled NOTIFY notificationsEnabledChanged)
    Q_PROPERTY(bool autoCheckUpdates READ autoCheckUpdates WRITE setAutoCheckUpdates NOTIFY autoCheckUpdatesChanged)
    Q_PROPERTY(bool sidebarCollapsed READ sidebarCollapsed WRITE setSidebarCollapsed NOTIFY sidebarCollapsedChanged)
    Q_PROPERTY(QString updateFeedUrl READ updateFeedUrl WRITE setUpdateFeedUrl NOTIFY updateFeedUrlChanged)
    Q_PROPERTY(bool shellIntegrationReady READ shellIntegrationReady NOTIFY shellIntegrationReadyChanged)

public:
    explicit DesktopPreferences(QObject *parent = nullptr);

    QString appearance() const;
    void setAppearance(const QString &value);
    QString density() const;
    void setDensity(const QString &value);
    bool reducedMotion() const;
    void setReducedMotion(bool value);
    bool highContrast() const;
    void setHighContrast(bool value);
    QString motionMode() const;
    void setMotionMode(const QString &value);
    QString contrastMode() const;
    void setContrastMode(const QString &value);
    QString transparencyMode() const;
    void setTransparencyMode(const QString &value);
    QString textScale() const;
    void setTextScale(const QString &value);
    bool largeTargets() const;
    void setLargeTargets(bool value);
    QString focusIndicator() const;
    void setFocusIndicator(const QString &value);
    QString statusPalette() const;
    void setStatusPalette(const QString &value);
    bool systemHighContrast() const;
    bool systemReducedMotion() const;
    bool systemReducedTransparency() const;
    bool launchAtStartup() const;
    void setLaunchAtStartup(bool value);
    bool closeToTray() const;
    void setCloseToTray(bool value);
    bool notificationsEnabled() const;
    void setNotificationsEnabled(bool value);
    bool autoCheckUpdates() const;
    void setAutoCheckUpdates(bool value);
    bool sidebarCollapsed() const;
    void setSidebarCollapsed(bool value);
    QString updateFeedUrl() const;
    void setUpdateFeedUrl(const QString &value);
    bool shellIntegrationReady() const;

    Q_INVOKABLE QVariantMap snapshot() const;
    Q_INVOKABLE void reset();
    Q_INVOKABLE bool registerShellIntegration();
    Q_INVOKABLE bool openApplicationData();
    Q_INVOKABLE bool openLogsFolder();

signals:
    void appearanceChanged();
    void densityChanged();
    void reducedMotionChanged();
    void highContrastChanged();
    void motionModeChanged();
    void contrastModeChanged();
    void transparencyModeChanged();
    void textScaleChanged();
    void largeTargetsChanged();
    void focusIndicatorChanged();
    void statusPaletteChanged();
    void systemAccessibilityChanged();
    void launchAtStartupChanged();
    void closeToTrayChanged();
    void notificationsEnabledChanged();
    void autoCheckUpdatesChanged();
    void sidebarCollapsedChanged();
    void updateFeedUrlChanged();
    void shellIntegrationReadyChanged();

private:
    void load();
    void persist(const QString &key, const QVariant &value);
    void applyStartupRegistration();
    bool checkShellIntegration() const;

    QString m_appearance = QStringLiteral("system");
    QString m_density = QStringLiteral("comfortable");
    bool m_reducedMotion = false;
    bool m_highContrast = false;
    QString m_motionMode = QStringLiteral("system");
    QString m_contrastMode = QStringLiteral("system");
    QString m_transparencyMode = QStringLiteral("system");
    QString m_textScale = QStringLiteral("default");
    bool m_largeTargets = false;
    QString m_focusIndicator = QStringLiteral("strong");
    QString m_statusPalette = QStringLiteral("default");
    bool m_launchAtStartup = false;
    bool m_closeToTray = true;
    bool m_notificationsEnabled = true;
    bool m_autoCheckUpdates = true;
    bool m_sidebarCollapsed = false;
    QString m_updateFeedUrl;
    bool m_shellIntegrationReady = false;
};
