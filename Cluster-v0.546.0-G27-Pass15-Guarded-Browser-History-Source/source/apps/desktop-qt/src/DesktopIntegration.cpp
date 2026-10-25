#include "DesktopIntegration.h"
#include "AppController.h"
#include "DesktopPreferences.h"
#include "NativeUpdateManager.h"
#include "NativeCapabilityBroker.h"
#include "GlobalShortcutManager.h"

#include <QAction>
#include <QActionGroup>
#include <QCoreApplication>
#include <QCloseEvent>
#include <QEvent>
#include <QIcon>
#include <QMenu>
#include <QMouseEvent>
#include <QSystemTrayIcon>
#include <QWindow>
#include <QVariant>

DesktopIntegration::DesktopIntegration(AppController *controller, QWindow *window, QObject *parent)
    : QObject(parent)
    , m_controller(controller)
    , m_window(window)
{
    if (QCoreApplication::instance())
        QCoreApplication::instance()->installEventFilter(this);
    if (m_controller) {
        connect(m_controller, &AppController::activateWindowRequested, this, &DesktopIntegration::showWindow);
        if (!m_controller->desktopPreferences()->shellIntegrationReady())
            m_controller->desktopPreferences()->registerShellIntegration();
        connect(m_controller->nativeCapabilities(), &NativeCapabilityBroker::showAppSettingsRequested, this, [this] {
            showWindow();
            if (m_window) QMetaObject::invokeMethod(m_window, "showAppSettings");
        });
        connect(m_controller->nativeCapabilities(), &NativeCapabilityBroker::showServerProfilesRequested, this, [this] {
            showWindow();
            if (m_window) QMetaObject::invokeMethod(m_window, "showServerProfiles");
        });
        connect(m_controller->nativeCapabilities(), &NativeCapabilityBroker::reloadRendererRequested, this, [this] {
            showWindow();
            if (m_window) QMetaObject::invokeMethod(m_window, "reloadSharedRenderer");
        });
        if (m_controller->globalShortcuts()) {
            connect(m_controller->globalShortcuts(), &GlobalShortcutManager::activateRequested, this, &DesktopIntegration::showWindow);
            connect(m_controller->globalShortcuts(), &GlobalShortcutManager::commandRequested, this, [this](const QString &command) {
                showWindow();
                if (m_window) QMetaObject::invokeMethod(m_window, "dispatchSharedRendererCommand", Q_ARG(QVariant, QVariant(command)));
            });
        }
    }

    if (!QSystemTrayIcon::isSystemTrayAvailable())
        return;

    const QIcon icon(QStringLiteral(":/qt/qml/Cluster/Desktop/assets/cluster-icon.png"));
    m_tray = new QSystemTrayIcon(icon, this);
    m_menu = new QMenu;

    QAction *openAction = m_menu->addAction(QStringLiteral("Open Cluster"));
    openAction->setShortcut(QKeySequence(QStringLiteral("Ctrl+Shift+O")));
    QAction *searchAction = m_menu->addAction(QStringLiteral("Search / Commands…"));
    searchAction->setShortcut(QKeySequence(QStringLiteral("Ctrl+K")));
    QAction *quickCreateAction = m_menu->addAction(QStringLiteral("Quick create…"));
    quickCreateAction->setShortcut(QKeySequence(QStringLiteral("Ctrl+Shift+N")));
    m_connectionAction = m_menu->addAction(QStringLiteral("Connection status"));
    m_connectionAction->setEnabled(false);
    m_menu->addSeparator();
    m_quickActionsMenu = m_menu->addMenu(QStringLiteral("Quick navigation"));
    m_recentMenu = m_menu->addMenu(QStringLiteral("Recent workspaces"));
    m_serversMenu = m_menu->addMenu(QStringLiteral("Servers"));
    QAction *manageServersAction = m_menu->addAction(QStringLiteral("Manage servers…"));
    QAction *refreshAction = m_menu->addAction(QStringLiteral("Refresh"));
    m_notificationsAction = m_menu->addAction(QStringLiteral("Desktop notifications"));
    m_notificationsAction->setCheckable(true);
    QAction *settingsAction = m_menu->addAction(QStringLiteral("App settings"));
    QAction *updatesAction = m_menu->addAction(QStringLiteral("Check for updates"));
    m_menu->addSeparator();
    QAction *quitAction = m_menu->addAction(QStringLiteral("Quit Cluster"));

    connect(openAction, &QAction::triggered, this, &DesktopIntegration::showWindow);
    connect(searchAction, &QAction::triggered, this, [this] {
        showWindow();
        if (m_window) QMetaObject::invokeMethod(m_window, "dispatchSharedRendererCommand", Q_ARG(QVariant, QVariant(QStringLiteral("command-palette"))));
    });
    connect(quickCreateAction, &QAction::triggered, this, [this] {
        showWindow();
        if (m_window) QMetaObject::invokeMethod(m_window, "dispatchSharedRendererCommand", Q_ARG(QVariant, QVariant(QStringLiteral("quick-create"))));
    });
    connect(manageServersAction, &QAction::triggered, this, [this] {
        showWindow();
        if (m_window) QMetaObject::invokeMethod(m_window, "showServerProfiles");
    });
    connect(refreshAction, &QAction::triggered, this, [this] {
        showWindow();
        if (m_window) QMetaObject::invokeMethod(m_window, "reloadSharedRenderer");
    });
    connect(m_notificationsAction, &QAction::triggered, this, [this](bool enabled) {
        if (!m_controller || !m_controller->desktopPreferences()) return;
        m_controller->desktopPreferences()->setNotificationsEnabled(enabled);
        rebuildNotificationToggle();
    });
    connect(settingsAction, &QAction::triggered, this, [this] {
        showWindow();
        if (m_window) QMetaObject::invokeMethod(m_window, "showAppSettings");
    });
    connect(updatesAction, &QAction::triggered, m_controller->updateManager(), &NativeUpdateManager::checkForUpdates);
    connect(quitAction, &QAction::triggered, this, [this] { m_quitting = true; QCoreApplication::quit(); });
    connect(m_tray, &QSystemTrayIcon::activated, this, [this](QSystemTrayIcon::ActivationReason reason) {
        if (reason == QSystemTrayIcon::Trigger || reason == QSystemTrayIcon::DoubleClick)
            showWindow();
    });
    connect(m_controller, &AppController::unreadNotificationCountChanged, this, &DesktopIntegration::updateTrayStatus);
    connect(m_controller, &AppController::stateChanged, this, &DesktopIntegration::updateTrayStatus);
    connect(m_controller, &AppController::connectionOnlineChanged, this, &DesktopIntegration::updateTrayStatus);
    connect(m_controller, &AppController::connectionRecoveryChanged, this, &DesktopIntegration::updateTrayStatus);
    connect(m_controller->desktopPreferences(), &DesktopPreferences::notificationsEnabledChanged, this, &DesktopIntegration::rebuildNotificationToggle);
    connect(m_controller->nativeCapabilities(), &NativeCapabilityBroker::notificationRequested, this,
            [this](const QString &title, const QString &body, const QString &route, const QString &, const QString &priority) {
        if (!m_tray || !m_controller->desktopPreferences()->notificationsEnabled()) return;
        m_pendingNotificationRoute = route;
        const auto icon = priority == QStringLiteral("critical") ? QSystemTrayIcon::Critical
            : priority == QStringLiteral("high") ? QSystemTrayIcon::Warning
            : QSystemTrayIcon::Information;
        const int timeout = priority == QStringLiteral("critical") ? 9000 : priority == QStringLiteral("high") ? 7000 : 5000;
        m_tray->showMessage(title, body, icon, timeout);
    });
    connect(m_controller->serverProfiles(), &ServerProfileStore::profilesChanged, this, &DesktopIntegration::rebuildServerMenu);
    connect(m_controller->serverProfiles(), &ServerProfileStore::recentWorkspacesChanged, this, &DesktopIntegration::rebuildRecentMenu);
    connect(m_controller->serverProfiles(), &ServerProfileStore::activeProfileChanged, this, [this] {
        rebuildServerMenu();
        rebuildRecentMenu();
        updateTrayStatus();
    });
    connect(m_tray, &QSystemTrayIcon::messageClicked, this, [this] {
        showWindow();
        const QString route = m_pendingNotificationRoute.isEmpty() ? QStringLiteral("notifications") : m_pendingNotificationRoute;
        m_pendingNotificationRoute.clear();
        if (m_window) QMetaObject::invokeMethod(m_window, "navigateSharedRenderer", Q_ARG(QVariant, QVariant(route)));
    });

    rebuildServerMenu();
    rebuildRecentMenu();
    rebuildQuickActionsMenu();
    rebuildNotificationToggle();
    m_tray->setContextMenu(m_menu);
    updateTrayStatus();
    m_tray->show();
}

DesktopIntegration::~DesktopIntegration()
{
    if (QCoreApplication::instance())
        QCoreApplication::instance()->removeEventFilter(this);
    delete m_menu;
}


bool DesktopIntegration::eventFilter(QObject *watched, QEvent *event)
{
    if (event->type() == QEvent::MouseButtonPress && m_window && m_window->isActive()) {
        const auto *mouse = static_cast<QMouseEvent *>(event);
        if (mouse->button() == Qt::BackButton) {
            QMetaObject::invokeMethod(m_window, "goBackSharedRenderer");
            return true;
        }
        if (mouse->button() == Qt::ForwardButton) {
            QMetaObject::invokeMethod(m_window, "goForwardSharedRenderer");
            return true;
        }
    }
    if (watched == m_window && event->type() == QEvent::Close && !m_quitting && m_tray
        && m_controller && m_controller->desktopPreferences()->closeToTray()) {
        static_cast<QCloseEvent *>(event)->ignore();
        m_window->hide();
        if (m_controller->desktopPreferences()->notificationsEnabled())
            m_tray->showMessage(QStringLiteral("Cluster"), QStringLiteral("Cluster is still running in the system tray."), QSystemTrayIcon::Information, 3000);
        return true;
    }
    return QObject::eventFilter(watched, event);
}

void DesktopIntegration::showWindow()
{
    if (!m_window)
        return;
    m_window->show();
    m_window->raise();
    m_window->requestActivate();
}

void DesktopIntegration::rebuildQuickActionsMenu()
{
    if (!m_quickActionsMenu || !m_window) return;
    m_quickActionsMenu->clear();
    struct QuickRoute { const char *label; const char *route; };
    const QuickRoute routes[] = {
        {"Home", "home"},
        {"My Work", "my-work"},
        {"Projects", "projects"},
        {"Notifications", "notifications"},
        {"Scheduler", "scheduler"},
        {"People", "people"}
    };
    for (const auto &item : routes) {
        QAction *action = m_quickActionsMenu->addAction(QString::fromUtf8(item.label));
        const QString route = QString::fromUtf8(item.route);
        connect(action, &QAction::triggered, this, [this, route] {
            showWindow();
            if (m_window) QMetaObject::invokeMethod(m_window, "navigateSharedRenderer", Q_ARG(QVariant, QVariant(route)));
        });
    }
}

void DesktopIntegration::rebuildNotificationToggle()
{
    if (!m_notificationsAction || !m_controller || !m_controller->desktopPreferences()) return;
    const bool enabled = m_controller->desktopPreferences()->notificationsEnabled();
    m_notificationsAction->blockSignals(true);
    m_notificationsAction->setChecked(enabled);
    m_notificationsAction->setText(enabled ? QStringLiteral("Desktop notifications · On") : QStringLiteral("Desktop notifications · Off"));
    m_notificationsAction->blockSignals(false);
}

void DesktopIntegration::rebuildRecentMenu()
{
    if (!m_recentMenu || !m_controller || !m_controller->serverProfiles()) return;
    m_recentMenu->clear();
    const QVariantList items = m_controller->serverProfiles()->recentWorkspaces();
    if (items.isEmpty()) {
        QAction *emptyAction = m_recentMenu->addAction(QStringLiteral("No recent workspaces"));
        emptyAction->setEnabled(false);
        return;
    }
    int count = 0;
    for (const QVariant &value : items) {
        if (count++ >= 8) break;
        const QVariantMap item = value.toMap();
        const QString title = item.value(QStringLiteral("title")).toString();
        const QString route = item.value(QStringLiteral("route")).toString();
        const QString kind = item.value(QStringLiteral("kind")).toString();
        QAction *action = m_recentMenu->addAction(QStringLiteral("%1 · %2").arg(title, kind));
        connect(action, &QAction::triggered, this, [this, route] {
            showWindow();
            if (m_window) QMetaObject::invokeMethod(m_window, "navigateSharedRenderer", Q_ARG(QVariant, QVariant(route)));
        });
    }
    m_recentMenu->addSeparator();
    QAction *clearAction = m_recentMenu->addAction(QStringLiteral("Clear recent workspaces"));
    connect(clearAction, &QAction::triggered, this, [this] {
        if (m_controller && m_controller->serverProfiles()) m_controller->serverProfiles()->clearRecentWorkspaces();
    });
}

void DesktopIntegration::rebuildServerMenu()
{
    if (!m_serversMenu || !m_controller)
        return;
    m_serversMenu->clear();
    const QVariantList profiles = m_controller->serverProfiles()->profiles();
    for (const QVariant &entry : profiles) {
        const QVariantMap profile = entry.toMap();
        const QString profileId = profile.value(QStringLiteral("id")).toString();
        const QString label = profile.value(QStringLiteral("label")).toString();
        QAction *action = m_serversMenu->addAction(label.isEmpty() ? profile.value(QStringLiteral("url")).toString() : label);
        action->setCheckable(true);
        action->setChecked(profile.value(QStringLiteral("active")).toBool());
        action->setEnabled(!profile.value(QStringLiteral("active")).toBool());
        connect(action, &QAction::triggered, this, [this, profileId] {
            m_controller->serverProfiles()->switchProfile(profileId);
        });
    }
    if (!profiles.isEmpty()) m_serversMenu->addSeparator();
    QAction *manage = m_serversMenu->addAction(QStringLiteral("Manage servers…"));
    connect(manage, &QAction::triggered, this, [this] {
        showWindow();
        if (m_window) QMetaObject::invokeMethod(m_window, "showServerProfiles");
    });
}

void DesktopIntegration::updateTrayStatus()
{
    if (!m_tray || !m_controller)
        return;
    const int unread = m_controller->unreadNotificationCount();
    const QString suffix = unread > 0 ? QStringLiteral(" · %1 unread").arg(unread) : QString();
    const QVariantMap profile = m_controller->serverProfiles()->activeProfile();
    const QString server = profile.value(QStringLiteral("label")).toString();
    const QString user = profile.value(QStringLiteral("userLabel")).toString();
    const QString identity = user.isEmpty() ? server : QStringLiteral("%1 · %2").arg(server, user);
    const QVariantMap recovery = m_controller->connectionRecovery();
    const QString recoveryState = recovery.value(QStringLiteral("state")).toString();
    const bool online = m_controller->connectionOnline();
    const QString connectionLabel = online
        ? QStringLiteral("Connected")
        : recoveryState == QStringLiteral("waiting")
            ? QStringLiteral("Reconnecting · attempt %1").arg(recovery.value(QStringLiteral("attempt")).toInt())
            : recoveryState == QStringLiteral("validating")
                ? QStringLiteral("Validating server")
                : QStringLiteral("Offline");
    if (m_connectionAction)
        m_connectionAction->setText(QStringLiteral("%1 · %2").arg(connectionLabel, identity.isEmpty() ? QStringLiteral("Cluster") : identity));
    m_tray->setToolTip(QStringLiteral("Cluster · %1 · %2%3%4")
        .arg(identity.isEmpty() ? m_controller->state() : identity,
             connectionLabel,
             suffix,
             profile.value(QStringLiteral("recoveryRequired")).toBool() ? QStringLiteral(" · recovery needed") : QString()));
}
