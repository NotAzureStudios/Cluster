#include "GlobalShortcutManager.h"

#include <QCoreApplication>
#include <QSettings>
#include <QUuid>

#ifdef Q_OS_WIN
#include <windows.h>
#elif defined(Q_OS_MACOS)
#include <Carbon/Carbon.h>
#elif defined(Q_OS_LINUX)
#include <QDBusArgument>
#include <QDBusConnection>
#include <QDBusInterface>
#include <QDBusMessage>
#include <QDBusMetaType>
#include <QDBusObjectPath>
#include <QDBusVariant>
#include <QEventLoop>
#include <QTimer>
#endif

#ifdef Q_OS_LINUX
struct PortalShortcut {
    QString id;
    QVariantMap options;
};
using PortalShortcutList = QList<PortalShortcut>;
Q_DECLARE_METATYPE(PortalShortcut)
Q_DECLARE_METATYPE(PortalShortcutList)

QDBusArgument &operator<<(QDBusArgument &argument, const PortalShortcut &shortcut)
{
    argument.beginStructure();
    argument << shortcut.id << shortcut.options;
    argument.endStructure();
    return argument;
}
const QDBusArgument &operator>>(const QDBusArgument &argument, PortalShortcut &shortcut)
{
    argument.beginStructure();
    argument >> shortcut.id >> shortcut.options;
    argument.endStructure();
    return argument;
}
#endif

namespace {
constexpr int ShowClusterId = 0x434C01;
constexpr int CommandPaletteId = 0x434C02;
constexpr int QuickCreateId = 0x434C03;
#ifdef Q_OS_MACOS
GlobalShortcutManager *g_macShortcutManager = nullptr;
OSStatus macHotKeyHandler(EventHandlerCallRef, EventRef event, void *)
{
    EventHotKeyID hotKey{};
    if (GetEventParameter(event, kEventParamDirectObject, typeEventHotKeyID, nullptr, sizeof(hotKey), nullptr, &hotKey) == noErr && g_macShortcutManager)
        QMetaObject::invokeMethod(g_macShortcutManager, "trigger", Qt::QueuedConnection, Q_ARG(int, int(hotKey.id)));
    return noErr;
}
#elif defined(Q_OS_LINUX)
QString portalToken(const QString &prefix)
{
    QString token = prefix + QLatin1Char('_') + QUuid::createUuid().toString(QUuid::WithoutBraces);
    token.remove(QLatin1Char('-'));
    return token;
}
#endif
}

GlobalShortcutManager::GlobalShortcutManager(QObject *parent) : QObject(parent)
{
    QSettings settings;
#ifdef Q_OS_LINUX
    const bool hasSavedPreference = settings.contains(QStringLiteral("desktop/globalShortcutsEnabled"));
    m_enabled = hasSavedPreference ? settings.value(QStringLiteral("desktop/globalShortcutsEnabled")).toBool() : false;
#else
    m_enabled = settings.value(QStringLiteral("desktop/globalShortcutsEnabled"), true).toBool();
#endif
#ifdef Q_OS_WIN
    m_provider = QStringLiteral("Windows RegisterHotKey");
#elif defined(Q_OS_MACOS)
    m_provider = QStringLiteral("macOS Carbon Hot Keys");
#else
    m_provider = QStringLiteral("XDG Desktop Portal GlobalShortcuts");
    qDBusRegisterMetaType<PortalShortcut>();
    qDBusRegisterMetaType<PortalShortcutList>();
    m_supported = portalAvailable();
#endif
    if (QCoreApplication::instance()) QCoreApplication::instance()->installNativeEventFilter(this);
    if (m_enabled && m_supported) registerShortcuts();
}

GlobalShortcutManager::~GlobalShortcutManager()
{
    unregisterShortcuts();
    if (QCoreApplication::instance()) QCoreApplication::instance()->removeNativeEventFilter(this);
}

void GlobalShortcutManager::setEnabled(bool enabled)
{
    if (m_enabled == enabled) return;
    m_enabled = enabled;
    QSettings().setValue(QStringLiteral("desktop/globalShortcutsEnabled"), enabled);
    if (enabled) registerShortcuts(); else unregisterShortcuts();
    emit statusChanged();
}

QVariantMap GlobalShortcutManager::status() const
{
    QString note;
#ifdef Q_OS_LINUX
    if (!m_supported) note = QStringLiteral("This Linux desktop does not expose the XDG GlobalShortcuts portal. Cluster foreground shortcuts remain available.");
    else if (m_registered) note = QStringLiteral("Global shortcuts are bound through the desktop portal and work while Cluster is unfocused.");
    else if (m_enabled) note = QStringLiteral("The desktop portal is available, but global shortcut binding is not active.");
    else note = QStringLiteral("Enable global shortcuts to let your desktop environment choose and approve system-wide bindings.");
#else
    note = m_registered ? QStringLiteral("Global shortcuts work even while Cluster is unfocused.") : QStringLiteral("Global shortcut registration is not currently active.");
#endif
    return {
        {QStringLiteral("enabled"), m_enabled},
        {QStringLiteral("registered"), m_registered},
        {QStringLiteral("supported"), m_supported},
        {QStringLiteral("provider"), m_provider},
        {QStringLiteral("error"), m_error},
#ifdef Q_OS_LINUX
        {QStringLiteral("showCluster"), shortcutLabel(QStringLiteral("show-cluster"), QStringLiteral("Desktop configured"))},
        {QStringLiteral("commandPalette"), shortcutLabel(QStringLiteral("command-palette"), QStringLiteral("Desktop configured"))},
        {QStringLiteral("quickCreate"), shortcutLabel(QStringLiteral("quick-create"), QStringLiteral("Desktop configured"))},
#else
        {QStringLiteral("showCluster"), QStringLiteral("Ctrl+Alt+Space")},
        {QStringLiteral("commandPalette"), QStringLiteral("Ctrl+Alt+K")},
        {QStringLiteral("quickCreate"), QStringLiteral("Ctrl+Alt+N")},
#endif
        {QStringLiteral("note"), note},
    };
}

bool GlobalShortcutManager::registerShortcuts()
{
    unregisterPlatformShortcuts();
    m_error.clear();
    if (!m_enabled) { emit statusChanged(); return false; }
#ifdef Q_OS_LINUX
    m_supported = portalAvailable();
    if (!m_supported) {
        m_error = QStringLiteral("The XDG Desktop Portal GlobalShortcuts interface is unavailable on this Linux desktop.");
        emit statusChanged();
        return false;
    }
#endif
    m_registered = registerPlatformShortcuts();
    emit statusChanged();
    return m_registered;
}

void GlobalShortcutManager::unregisterShortcuts()
{
    unregisterPlatformShortcuts();
    if (m_registered) {
        m_registered = false;
        emit statusChanged();
    }
}

bool GlobalShortcutManager::registerPlatformShortcuts()
{
#ifdef Q_OS_WIN
    const bool a = RegisterHotKey(nullptr, ShowClusterId, MOD_CONTROL | MOD_ALT | MOD_NOREPEAT, VK_SPACE);
    const bool b = RegisterHotKey(nullptr, CommandPaletteId, MOD_CONTROL | MOD_ALT | MOD_NOREPEAT, 'K');
    const bool c = RegisterHotKey(nullptr, QuickCreateId, MOD_CONTROL | MOD_ALT | MOD_NOREPEAT, 'N');
    if (!(a && b && c)) {
        if (a) UnregisterHotKey(nullptr, ShowClusterId);
        if (b) UnregisterHotKey(nullptr, CommandPaletteId);
        if (c) UnregisterHotKey(nullptr, QuickCreateId);
        m_error = QStringLiteral("One or more global shortcuts are already reserved by another application.");
        return false;
    }
    return true;
#elif defined(Q_OS_MACOS)
    g_macShortcutManager = this;
    EventTypeSpec type{ kEventClassKeyboard, kEventHotKeyPressed };
    EventHandlerRef handler = nullptr;
    if (InstallApplicationEventHandler(&macHotKeyHandler, 1, &type, nullptr, &handler) != noErr) {
        m_error = QStringLiteral("macOS did not allow Cluster to install the global shortcut handler.");
        return false;
    }
    m_macHandler = handler;
    const UInt32 mods = controlKey | optionKey;
    const EventHotKeyID ids[3] = {{'CLUS', ShowClusterId}, {'CLUS', CommandPaletteId}, {'CLUS', QuickCreateId}};
    const UInt32 keys[3] = {kVK_Space, kVK_ANSI_K, kVK_ANSI_N};
    for (int i = 0; i < 3; ++i) {
        EventHotKeyRef ref = nullptr;
        if (RegisterEventHotKey(keys[i], mods, ids[i], GetApplicationEventTarget(), 0, &ref) != noErr) {
            m_error = QStringLiteral("One or more global shortcuts are already reserved by another application.");
            unregisterPlatformShortcuts();
            return false;
        }
        m_macHotKeys[i] = ref;
    }
    return true;
#else
    const QString createToken = portalToken(QStringLiteral("cluster_create"));
    const QString sessionToken = portalToken(QStringLiteral("cluster_session"));
    QVariantMap createResults;
    if (!runPortalRequest(QStringLiteral("CreateSession"), {QVariantMap{
            {QStringLiteral("handle_token"), createToken},
            {QStringLiteral("session_handle_token"), sessionToken},
        }}, createToken, &createResults)) return false;

    QVariant sessionValue = createResults.value(QStringLiteral("session_handle"));
    if (sessionValue.canConvert<QDBusObjectPath>()) m_portalSessionHandle = sessionValue.value<QDBusObjectPath>().path();
    if (m_portalSessionHandle.isEmpty()) m_portalSessionHandle = sessionValue.toString();
    if (m_portalSessionHandle.isEmpty()) {
        m_error = QStringLiteral("The desktop portal did not return a global-shortcut session.");
        return false;
    }

    const auto bus = QDBusConnection::sessionBus();
    bus.connect(QStringLiteral("org.freedesktop.portal.Desktop"), QStringLiteral("/org/freedesktop/portal/desktop"),
        QStringLiteral("org.freedesktop.portal.GlobalShortcuts"), QStringLiteral("Activated"),
        this, SLOT(handlePortalActivated(QDBusObjectPath,QString,qulonglong,QVariantMap)));
    bus.connect(QStringLiteral("org.freedesktop.portal.Desktop"), m_portalSessionHandle,
        QStringLiteral("org.freedesktop.portal.Session"), QStringLiteral("Closed"),
        this, SLOT(handlePortalSessionClosed(QVariantMap)));

    PortalShortcutList shortcuts {
        {QStringLiteral("show-cluster"), {{QStringLiteral("description"), QStringLiteral("Show Cluster")}}},
        {QStringLiteral("command-palette"), {{QStringLiteral("description"), QStringLiteral("Open Cluster search and commands")}}},
        {QStringLiteral("quick-create"), {{QStringLiteral("description"), QStringLiteral("Open Cluster Quick Create")}}},
    };
    const QString bindToken = portalToken(QStringLiteral("cluster_bind"));
    QVariantMap bindResults;
    if (!runPortalRequest(QStringLiteral("BindShortcuts"), {
            QVariant::fromValue(QDBusObjectPath(m_portalSessionHandle)),
            QVariant::fromValue(shortcuts),
            QString(),
            QVariantMap{{QStringLiteral("handle_token"), bindToken}},
        }, bindToken, &bindResults)) {
        unregisterPlatformShortcuts();
        return false;
    }

    m_portalShortcutLabels.clear();
    const QVariant boundValue = bindResults.value(QStringLiteral("shortcuts"));
    if (boundValue.isValid()) {
        const PortalShortcutList bound = qdbus_cast<PortalShortcutList>(boundValue);
        for (const PortalShortcut &shortcut : bound) {
            const QString label = shortcut.options.value(QStringLiteral("trigger_description")).toString().trimmed();
            if (!label.isEmpty()) m_portalShortcutLabels.insert(shortcut.id, label.left(80));
        }
    }
    return true;
#endif
}

void GlobalShortcutManager::unregisterPlatformShortcuts()
{
#ifdef Q_OS_WIN
    UnregisterHotKey(nullptr, ShowClusterId);
    UnregisterHotKey(nullptr, CommandPaletteId);
    UnregisterHotKey(nullptr, QuickCreateId);
#elif defined(Q_OS_MACOS)
    for (void *&slot : m_macHotKeys) {
        if (slot) UnregisterEventHotKey(static_cast<EventHotKeyRef>(slot));
        slot = nullptr;
    }
    if (m_macHandler) RemoveEventHandler(static_cast<EventHandlerRef>(m_macHandler));
    m_macHandler = nullptr;
    if (g_macShortcutManager == this) g_macShortcutManager = nullptr;
#elif defined(Q_OS_LINUX)
    const auto bus = QDBusConnection::sessionBus();
    if (!m_portalSessionHandle.isEmpty()) {
        QDBusInterface session(QStringLiteral("org.freedesktop.portal.Desktop"), m_portalSessionHandle,
            QStringLiteral("org.freedesktop.portal.Session"), bus);
        if (session.isValid()) session.call(QDBus::NoBlock, QStringLiteral("Close"));
    }
    bus.disconnect(QStringLiteral("org.freedesktop.portal.Desktop"), QStringLiteral("/org/freedesktop/portal/desktop"),
        QStringLiteral("org.freedesktop.portal.GlobalShortcuts"), QStringLiteral("Activated"),
        this, SLOT(handlePortalActivated(QDBusObjectPath,QString,qulonglong,QVariantMap)));
    if (!m_portalSessionHandle.isEmpty()) {
        bus.disconnect(QStringLiteral("org.freedesktop.portal.Desktop"), m_portalSessionHandle,
            QStringLiteral("org.freedesktop.portal.Session"), QStringLiteral("Closed"),
            this, SLOT(handlePortalSessionClosed(QVariantMap)));
    }
    m_portalSessionHandle.clear();
    m_portalShortcutLabels.clear();
#endif
}

bool GlobalShortcutManager::nativeEventFilter(const QByteArray &, void *message, qintptr *)
{
#ifdef Q_OS_WIN
    const MSG *msg = static_cast<MSG *>(message);
    if (msg && msg->message == WM_HOTKEY) {
        trigger(int(msg->wParam));
        return true;
    }
#else
    Q_UNUSED(message)
#endif
    return false;
}

void GlobalShortcutManager::trigger(int id)
{
    emit activateRequested();
    if (id == CommandPaletteId) emit commandRequested(QStringLiteral("command-palette"));
    else if (id == QuickCreateId) emit commandRequested(QStringLiteral("quick-create"));
}

#ifdef Q_OS_LINUX
bool GlobalShortcutManager::portalAvailable()
{
    QDBusInterface portal(QStringLiteral("org.freedesktop.portal.Desktop"), QStringLiteral("/org/freedesktop/portal/desktop"),
        QStringLiteral("org.freedesktop.portal.GlobalShortcuts"), QDBusConnection::sessionBus());
    if (!portal.isValid()) return false;
    const QVariant version = portal.property("version");
    return !version.isValid() || version.toUInt() >= 1;
}

QString GlobalShortcutManager::portalRequestPath(const QString &handleToken) const
{
    QString sender = QDBusConnection::sessionBus().baseService();
    if (sender.startsWith(QLatin1Char(':'))) sender.remove(0, 1);
    sender.replace(QLatin1Char('.'), QLatin1Char('_'));
    return QStringLiteral("/org/freedesktop/portal/desktop/request/%1/%2").arg(sender, handleToken);
}

bool GlobalShortcutManager::runPortalRequest(const QString &method, const QVariantList &arguments, const QString &handleToken, QVariantMap *results)
{
    const auto bus = QDBusConnection::sessionBus();
    const QString requestPath = portalRequestPath(handleToken);
    m_portalResponse = 2;
    m_portalResults.clear();
    m_pendingRequestPath = requestPath;
    if (!bus.connect(QStringLiteral("org.freedesktop.portal.Desktop"), requestPath,
            QStringLiteral("org.freedesktop.portal.Request"), QStringLiteral("Response"),
            this, SLOT(handlePortalResponse(uint,QVariantMap)))) {
        m_error = QStringLiteral("Cluster could not subscribe to the desktop portal response.");
        return false;
    }

    QDBusInterface portal(QStringLiteral("org.freedesktop.portal.Desktop"), QStringLiteral("/org/freedesktop/portal/desktop"),
        QStringLiteral("org.freedesktop.portal.GlobalShortcuts"), bus);
    const QDBusMessage message = portal.callWithArgumentList(QDBus::Block, method, arguments);
    if (message.type() == QDBusMessage::ErrorMessage) {
        bus.disconnect(QStringLiteral("org.freedesktop.portal.Desktop"), requestPath,
            QStringLiteral("org.freedesktop.portal.Request"), QStringLiteral("Response"),
            this, SLOT(handlePortalResponse(uint,QVariantMap)));
        m_error = message.errorMessage().left(240);
        return false;
    }

    if (m_portalResponse == 2) {
        QEventLoop loop;
        m_portalLoop = &loop;
        QTimer timeout;
        timeout.setSingleShot(true);
        timeout.setInterval(120000);
        connect(&timeout, &QTimer::timeout, &loop, &QEventLoop::quit);
        timeout.start();
        loop.exec();
        m_portalLoop = nullptr;
    }
    bus.disconnect(QStringLiteral("org.freedesktop.portal.Desktop"), requestPath,
        QStringLiteral("org.freedesktop.portal.Request"), QStringLiteral("Response"),
        this, SLOT(handlePortalResponse(uint,QVariantMap)));

    if (m_portalResponse != 0) {
        m_error = m_portalResponse == 1
            ? QStringLiteral("Global shortcut binding was cancelled by the user.")
            : QStringLiteral("The desktop portal could not bind Cluster global shortcuts.");
        return false;
    }
    if (results) *results = m_portalResults;
    return true;
}

QString GlobalShortcutManager::shortcutLabel(const QString &id, const QString &fallback) const
{
    const QString label = m_portalShortcutLabels.value(id).toString().trimmed();
    return label.isEmpty() ? fallback : label;
}

void GlobalShortcutManager::handlePortalResponse(uint response, const QVariantMap &results)
{
    m_portalResponse = response;
    m_portalResults = results;
    if (m_portalLoop) m_portalLoop->quit();
}

void GlobalShortcutManager::handlePortalActivated(const QDBusObjectPath &sessionHandle, const QString &shortcutId, qulonglong, const QVariantMap &)
{
    if (sessionHandle.path() != m_portalSessionHandle) return;
    if (shortcutId == QStringLiteral("show-cluster")) trigger(ShowClusterId);
    else if (shortcutId == QStringLiteral("command-palette")) trigger(CommandPaletteId);
    else if (shortcutId == QStringLiteral("quick-create")) trigger(QuickCreateId);
}

void GlobalShortcutManager::handlePortalSessionClosed(const QVariantMap &)
{
    m_portalSessionHandle.clear();
    m_registered = false;
    m_error = QStringLiteral("The desktop environment closed Cluster's global-shortcut session.");
    emit statusChanged();
}
#endif
