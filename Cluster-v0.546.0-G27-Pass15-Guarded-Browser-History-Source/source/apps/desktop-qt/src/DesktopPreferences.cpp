#include "DesktopPreferences.h"

#include <QCoreApplication>
#include <QGuiApplication>
#include <QStyleHints>
#include <QAccessibilityHints>
#include <QDesktopServices>
#include <QDir>
#include <QFileInfo>
#include <QSettings>
#include <QStandardPaths>
#include <QUrl>
#ifdef Q_OS_WIN
#include <windows.h>
#endif

namespace {
const QString Prefix = QStringLiteral("desktop/");

QString normalizedChoice(const QString &value, const QStringList &allowed, const QString &fallback)
{
    const QString normalized = value.trimmed().toLower();
    return allowed.contains(normalized) ? normalized : fallback;
}

QString quotedExecutable()
{
    return QStringLiteral("\"") + QDir::toNativeSeparators(QCoreApplication::applicationFilePath()) + QStringLiteral("\"");
}
}

DesktopPreferences::DesktopPreferences(QObject *parent)
    : QObject(parent)
{
    load();
    if (auto *hints = QGuiApplication::styleHints(); hints && hints->accessibility()) {
        connect(hints->accessibility(), &QAccessibilityHints::contrastPreferenceChanged, this, [this] {
            emit systemAccessibilityChanged();
            if (m_contrastMode == QStringLiteral("system")) emit highContrastChanged();
        });
    }
    m_shellIntegrationReady = checkShellIntegration();
}

QString DesktopPreferences::appearance() const { return m_appearance; }
QString DesktopPreferences::density() const { return m_density; }
bool DesktopPreferences::reducedMotion() const {
    return m_motionMode == QStringLiteral("none") || m_motionMode == QStringLiteral("reduced") || (m_motionMode == QStringLiteral("system") && systemReducedMotion());
}
bool DesktopPreferences::highContrast() const {
    return m_contrastMode == QStringLiteral("high") || (m_contrastMode == QStringLiteral("system") && systemHighContrast());
}
QString DesktopPreferences::motionMode() const { return m_motionMode; }
QString DesktopPreferences::contrastMode() const { return m_contrastMode; }
QString DesktopPreferences::transparencyMode() const { return m_transparencyMode; }
QString DesktopPreferences::textScale() const { return m_textScale; }
bool DesktopPreferences::largeTargets() const { return m_largeTargets; }
QString DesktopPreferences::focusIndicator() const { return m_focusIndicator; }
QString DesktopPreferences::statusPalette() const { return m_statusPalette; }
bool DesktopPreferences::systemHighContrast() const {
    const auto *hints = QGuiApplication::styleHints();
    const auto *accessibility = hints ? hints->accessibility() : nullptr;
    return accessibility && accessibility->contrastPreference() == Qt::ContrastPreference::HighContrast;
}
bool DesktopPreferences::systemReducedMotion() const {
#ifdef Q_OS_WIN
    BOOL enabled = TRUE;
    if (SystemParametersInfoW(SPI_GETCLIENTAREAANIMATION, 0, &enabled, 0)) return !enabled;
#endif
    return false;
}
bool DesktopPreferences::systemReducedTransparency() const {
#ifdef Q_OS_WIN
    QSettings settings(QStringLiteral("HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize"), QSettings::NativeFormat);
    return settings.value(QStringLiteral("EnableTransparency"), 1).toInt() == 0;
#else
    return false;
#endif
}
bool DesktopPreferences::launchAtStartup() const { return m_launchAtStartup; }
bool DesktopPreferences::closeToTray() const { return m_closeToTray; }
bool DesktopPreferences::notificationsEnabled() const { return m_notificationsEnabled; }
bool DesktopPreferences::autoCheckUpdates() const { return m_autoCheckUpdates; }
bool DesktopPreferences::sidebarCollapsed() const { return m_sidebarCollapsed; }
QString DesktopPreferences::updateFeedUrl() const { return m_updateFeedUrl; }
bool DesktopPreferences::shellIntegrationReady() const { return m_shellIntegrationReady; }

void DesktopPreferences::setAppearance(const QString &value)
{
    const QString normalized = normalizedChoice(value, {QStringLiteral("system"), QStringLiteral("light"), QStringLiteral("dark")}, QStringLiteral("system"));
    if (m_appearance == normalized) return;
    m_appearance = normalized;
    persist(Prefix + QStringLiteral("appearance"), normalized);
    emit appearanceChanged();
}

void DesktopPreferences::setDensity(const QString &value)
{
    const QString normalized = normalizedChoice(value, {QStringLiteral("comfortable"), QStringLiteral("compact")}, QStringLiteral("comfortable"));
    if (m_density == normalized) return;
    m_density = normalized;
    persist(Prefix + QStringLiteral("density"), normalized);
    emit densityChanged();
}

void DesktopPreferences::setReducedMotion(bool value)
{
    setMotionMode(value ? QStringLiteral("reduced") : QStringLiteral("full"));
}

void DesktopPreferences::setHighContrast(bool value)
{
    setContrastMode(value ? QStringLiteral("high") : QStringLiteral("standard"));
}

void DesktopPreferences::setMotionMode(const QString &value)
{
    const QString normalized = normalizedChoice(value, {QStringLiteral("system"), QStringLiteral("full"), QStringLiteral("reduced"), QStringLiteral("none")}, QStringLiteral("system"));
    if (m_motionMode == normalized) return;
    m_motionMode = normalized; m_reducedMotion = reducedMotion();
    persist(Prefix + QStringLiteral("motionMode"), normalized);
    emit motionModeChanged(); emit reducedMotionChanged();
}

void DesktopPreferences::setContrastMode(const QString &value)
{
    const QString normalized = normalizedChoice(value, {QStringLiteral("system"), QStringLiteral("standard"), QStringLiteral("high")}, QStringLiteral("system"));
    if (m_contrastMode == normalized) return;
    m_contrastMode = normalized; m_highContrast = highContrast();
    persist(Prefix + QStringLiteral("contrastMode"), normalized);
    emit contrastModeChanged(); emit highContrastChanged();
}

void DesktopPreferences::setTransparencyMode(const QString &value)
{
    const QString normalized = normalizedChoice(value, {QStringLiteral("system"), QStringLiteral("full"), QStringLiteral("reduced"), QStringLiteral("off")}, QStringLiteral("system"));
    if (m_transparencyMode == normalized) return;
    m_transparencyMode = normalized; persist(Prefix + QStringLiteral("transparencyMode"), normalized); emit transparencyModeChanged();
}

void DesktopPreferences::setTextScale(const QString &value)
{
    const QString normalized = normalizedChoice(value, {QStringLiteral("default"), QStringLiteral("large"), QStringLiteral("larger"), QStringLiteral("largest")}, QStringLiteral("default"));
    if (m_textScale == normalized) return;
    m_textScale = normalized; persist(Prefix + QStringLiteral("textScale"), normalized); emit textScaleChanged();
}

void DesktopPreferences::setLargeTargets(bool value)
{
    if (m_largeTargets == value) return;
    m_largeTargets = value; persist(Prefix + QStringLiteral("largeTargets"), value); emit largeTargetsChanged();
}

void DesktopPreferences::setFocusIndicator(const QString &value)
{
    const QString normalized = normalizedChoice(value, {QStringLiteral("auto"), QStringLiteral("strong"), QStringLiteral("always")}, QStringLiteral("strong"));
    if (m_focusIndicator == normalized) return;
    m_focusIndicator = normalized; persist(Prefix + QStringLiteral("focusIndicator"), normalized); emit focusIndicatorChanged();
}

void DesktopPreferences::setStatusPalette(const QString &value)
{
    const QString normalized = normalizedChoice(value, {QStringLiteral("default"), QStringLiteral("color-vision-safe"), QStringLiteral("monochrome")}, QStringLiteral("default"));
    if (m_statusPalette == normalized) return;
    m_statusPalette = normalized; persist(Prefix + QStringLiteral("statusPalette"), normalized); emit statusPaletteChanged();
}

void DesktopPreferences::setLaunchAtStartup(bool value)
{
    if (m_launchAtStartup == value) return;
    m_launchAtStartup = value;
    persist(Prefix + QStringLiteral("launchAtStartup"), value);
    applyStartupRegistration();
    emit launchAtStartupChanged();
}

void DesktopPreferences::setCloseToTray(bool value)
{
    if (m_closeToTray == value) return;
    m_closeToTray = value;
    persist(Prefix + QStringLiteral("closeToTray"), value);
    emit closeToTrayChanged();
}

void DesktopPreferences::setNotificationsEnabled(bool value)
{
    if (m_notificationsEnabled == value) return;
    m_notificationsEnabled = value;
    persist(Prefix + QStringLiteral("notificationsEnabled"), value);
    emit notificationsEnabledChanged();
}

void DesktopPreferences::setAutoCheckUpdates(bool value)
{
    if (m_autoCheckUpdates == value) return;
    m_autoCheckUpdates = value;
    persist(Prefix + QStringLiteral("autoCheckUpdates"), value);
    emit autoCheckUpdatesChanged();
}

void DesktopPreferences::setSidebarCollapsed(bool value)
{
    if (m_sidebarCollapsed == value) return;
    m_sidebarCollapsed = value;
    persist(Prefix + QStringLiteral("sidebarCollapsed"), value);
    emit sidebarCollapsedChanged();
}

void DesktopPreferences::setUpdateFeedUrl(const QString &value)
{
    const QString normalized = value.trimmed().left(2048);
    if (m_updateFeedUrl == normalized) return;
    m_updateFeedUrl = normalized;
    persist(Prefix + QStringLiteral("updateFeedUrl"), normalized);
    emit updateFeedUrlChanged();
}

QVariantMap DesktopPreferences::snapshot() const
{
    return {
        {QStringLiteral("appearance"), m_appearance},
        {QStringLiteral("density"), m_density},
        {QStringLiteral("reducedMotion"), reducedMotion()},
        {QStringLiteral("highContrast"), highContrast()},
        {QStringLiteral("motionMode"), m_motionMode},
        {QStringLiteral("contrastMode"), m_contrastMode},
        {QStringLiteral("transparencyMode"), m_transparencyMode},
        {QStringLiteral("textScale"), m_textScale},
        {QStringLiteral("largeTargets"), m_largeTargets},
        {QStringLiteral("focusIndicator"), m_focusIndicator},
        {QStringLiteral("statusPalette"), m_statusPalette},
        {QStringLiteral("systemHighContrast"), systemHighContrast()},
        {QStringLiteral("systemReducedMotion"), systemReducedMotion()},
        {QStringLiteral("systemReducedTransparency"), systemReducedTransparency()},
        {QStringLiteral("launchAtStartup"), m_launchAtStartup},
        {QStringLiteral("closeToTray"), m_closeToTray},
        {QStringLiteral("notificationsEnabled"), m_notificationsEnabled},
        {QStringLiteral("autoCheckUpdates"), m_autoCheckUpdates},
        {QStringLiteral("sidebarCollapsed"), m_sidebarCollapsed},
        {QStringLiteral("updateFeedUrl"), m_updateFeedUrl},
        {QStringLiteral("shellIntegrationReady"), m_shellIntegrationReady},
    };
}

void DesktopPreferences::reset()
{
    setAppearance(QStringLiteral("system"));
    setDensity(QStringLiteral("comfortable"));
    setMotionMode(QStringLiteral("system"));
    setContrastMode(QStringLiteral("system"));
    setTransparencyMode(QStringLiteral("system"));
    setTextScale(QStringLiteral("default"));
    setLargeTargets(false);
    setFocusIndicator(QStringLiteral("strong"));
    setStatusPalette(QStringLiteral("default"));
    setLaunchAtStartup(false);
    setCloseToTray(true);
    setNotificationsEnabled(true);
    setAutoCheckUpdates(true);
    setSidebarCollapsed(false);
    setUpdateFeedUrl(QString());
}

bool DesktopPreferences::registerShellIntegration()
{
#ifdef Q_OS_WIN
    const QString executable = quotedExecutable();
    QSettings protocol(QStringLiteral("HKEY_CURRENT_USER\\Software\\Classes\\cluster"), QSettings::NativeFormat);
    protocol.setValue(QStringLiteral("."), QStringLiteral("URL:Cluster Desktop Protocol"));
    protocol.setValue(QStringLiteral("URL Protocol"), QString());
    protocol.setValue(QStringLiteral("DefaultIcon/."), executable + QStringLiteral(",0"));
    protocol.setValue(QStringLiteral("shell/open/command/."), executable + QStringLiteral(" \"%1\""));

    QSettings extension(QStringLiteral("HKEY_CURRENT_USER\\Software\\Classes\\.clusterlink"), QSettings::NativeFormat);
    extension.setValue(QStringLiteral("."), QStringLiteral("Cluster.Desktop.Link"));
    QSettings fileType(QStringLiteral("HKEY_CURRENT_USER\\Software\\Classes\\Cluster.Desktop.Link"), QSettings::NativeFormat);
    fileType.setValue(QStringLiteral("."), QStringLiteral("Cluster workspace link"));
    fileType.setValue(QStringLiteral("DefaultIcon/."), executable + QStringLiteral(",0"));
    fileType.setValue(QStringLiteral("shell/open/command/."), executable + QStringLiteral(" \"%1\""));
    protocol.sync();
    extension.sync();
    fileType.sync();
#endif
    const bool ready = checkShellIntegration();
    if (m_shellIntegrationReady != ready) {
        m_shellIntegrationReady = ready;
        emit shellIntegrationReadyChanged();
    }
    return ready;
}

bool DesktopPreferences::openApplicationData()
{
    const QString path = QStandardPaths::writableLocation(QStandardPaths::AppDataLocation);
    QDir().mkpath(path);
    return QDesktopServices::openUrl(QUrl::fromLocalFile(path));
}

bool DesktopPreferences::openLogsFolder()
{
    const QString path = QStandardPaths::writableLocation(QStandardPaths::AppDataLocation) + QStringLiteral("/logs");
    QDir().mkpath(path);
    return QDesktopServices::openUrl(QUrl::fromLocalFile(path));
}

void DesktopPreferences::load()
{
    QSettings settings;
    m_appearance = normalizedChoice(settings.value(Prefix + QStringLiteral("appearance"), QStringLiteral("system")).toString(), {QStringLiteral("system"), QStringLiteral("light"), QStringLiteral("dark")}, QStringLiteral("system"));
    m_density = normalizedChoice(settings.value(Prefix + QStringLiteral("density"), QStringLiteral("comfortable")).toString(), {QStringLiteral("comfortable"), QStringLiteral("compact")}, QStringLiteral("comfortable"));
    const bool legacyReducedMotion = settings.value(Prefix + QStringLiteral("reducedMotion"), false).toBool();
    const bool legacyHighContrast = settings.value(Prefix + QStringLiteral("highContrast"), false).toBool();
    m_motionMode = normalizedChoice(settings.value(Prefix + QStringLiteral("motionMode"), legacyReducedMotion ? QStringLiteral("reduced") : QStringLiteral("system")).toString(), {QStringLiteral("system"), QStringLiteral("full"), QStringLiteral("reduced"), QStringLiteral("none")}, QStringLiteral("system"));
    m_contrastMode = normalizedChoice(settings.value(Prefix + QStringLiteral("contrastMode"), legacyHighContrast ? QStringLiteral("high") : QStringLiteral("system")).toString(), {QStringLiteral("system"), QStringLiteral("standard"), QStringLiteral("high")}, QStringLiteral("system"));
    m_transparencyMode = normalizedChoice(settings.value(Prefix + QStringLiteral("transparencyMode"), QStringLiteral("system")).toString(), {QStringLiteral("system"), QStringLiteral("full"), QStringLiteral("reduced"), QStringLiteral("off")}, QStringLiteral("system"));
    m_textScale = normalizedChoice(settings.value(Prefix + QStringLiteral("textScale"), QStringLiteral("default")).toString(), {QStringLiteral("default"), QStringLiteral("large"), QStringLiteral("larger"), QStringLiteral("largest")}, QStringLiteral("default"));
    m_largeTargets = settings.value(Prefix + QStringLiteral("largeTargets"), false).toBool();
    m_focusIndicator = normalizedChoice(settings.value(Prefix + QStringLiteral("focusIndicator"), QStringLiteral("strong")).toString(), {QStringLiteral("auto"), QStringLiteral("strong"), QStringLiteral("always")}, QStringLiteral("strong"));
    m_statusPalette = normalizedChoice(settings.value(Prefix + QStringLiteral("statusPalette"), QStringLiteral("default")).toString(), {QStringLiteral("default"), QStringLiteral("color-vision-safe"), QStringLiteral("monochrome")}, QStringLiteral("default"));
    m_reducedMotion = reducedMotion();
    m_highContrast = highContrast();
    m_launchAtStartup = settings.value(Prefix + QStringLiteral("launchAtStartup"), false).toBool();
    m_closeToTray = settings.value(Prefix + QStringLiteral("closeToTray"), true).toBool();
    m_notificationsEnabled = settings.value(Prefix + QStringLiteral("notificationsEnabled"), true).toBool();
    m_autoCheckUpdates = settings.value(Prefix + QStringLiteral("autoCheckUpdates"), true).toBool();
    m_sidebarCollapsed = settings.value(Prefix + QStringLiteral("sidebarCollapsed"), false).toBool();
    m_updateFeedUrl = settings.value(Prefix + QStringLiteral("updateFeedUrl")).toString().trimmed().left(2048);
    applyStartupRegistration();
}

void DesktopPreferences::persist(const QString &key, const QVariant &value)
{
    QSettings settings;
    settings.setValue(key, value);
    settings.sync();
}

void DesktopPreferences::applyStartupRegistration()
{
#ifdef Q_OS_WIN
    QSettings run(QStringLiteral("HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Run"), QSettings::NativeFormat);
    if (m_launchAtStartup)
        run.setValue(QStringLiteral("Cluster"), quotedExecutable() + QStringLiteral(" --background"));
    else
        run.remove(QStringLiteral("Cluster"));
    run.sync();
#endif
}

bool DesktopPreferences::checkShellIntegration() const
{
#ifdef Q_OS_WIN
    QSettings protocol(QStringLiteral("HKEY_CURRENT_USER\\Software\\Classes\\cluster"), QSettings::NativeFormat);
    return protocol.contains(QStringLiteral("URL Protocol")) && !protocol.value(QStringLiteral("shell/open/command/.")).toString().isEmpty();
#else
    return true;
#endif
}
