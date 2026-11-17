#include "mainwindow.h"
#include "aitoolsdialog.h"
#include "backendclient.h"
#include "localaichatdialog.h"
#include "mediaclient.h"
#include "settingsdialog.h"
#include <QAction>
#include <QActionGroup>
#include <QApplication>
#include <QComboBox>
#include <QFont>
#include <QJsonArray>
#include <QJsonObject>
#include <QKeySequence>
#include <QLineEdit>
#include <QListWidget>
#include <QMenu>
#include <QMenuBar>
#include <QPlainTextEdit>
#include <QStackedWidget>
#include <QTabWidget>
#include <QTimer>
#include <QToolButton>
#include <functional>

namespace {

QAction *addCommand(QMenu *menu, const QString &text, const QKeySequence &shortcut,
                    const std::function<void()> &command) {
    auto *action = menu->addAction(text);
    action->setShortcut(shortcut);
    QObject::connect(action, &QAction::triggered, action, [command](bool) { command(); });
    return action;
}

QKeySequence primaryShortcut(const QString &key) {
#if defined(Q_OS_MACOS)
    return QKeySequence(QStringLiteral("Meta+%1").arg(key));
#else
    return QKeySequence(QStringLiteral("Ctrl+%1").arg(key));
#endif
}

void setMenuShortcut(QAction *action, const QKeySequence &shortcut) {
    action->setShortcut(shortcut);
    action->setShortcutContext(Qt::WidgetShortcut);
}

template <typename PlainSlot, typename LineSlot>
void runEditCommand(PlainSlot plainSlot, LineSlot lineSlot) {
    QWidget *focus = QApplication::focusWidget();
    if (auto *text = qobject_cast<QPlainTextEdit *>(focus)) {
        (text->*plainSlot)();
    } else if (auto *line = qobject_cast<QLineEdit *>(focus)) {
        (line->*lineSlot)();
    }
}

void selectTab(QWidget *dialog, const QString &name) {
    auto *tabs = dialog->findChild<QTabWidget *>();
    if (!tabs) {
        return;
    }
    for (int index = 0; index < tabs->count(); ++index) {
        if (tabs->tabText(index) == name) {
            tabs->setCurrentIndex(index);
            return;
        }
    }
}

int zoomFromPreferences(const QJsonObject &preferences) {
    bool ok = false;
    const int zoom = preferences.value(QStringLiteral("appearance.zoom"))
                         .toString(QStringLiteral("100")).toInt(&ok);
    return ok ? zoom : 100;
}

bool roomHasUnread(const QJsonObject &room) {
    return room.value(QStringLiteral("unread")).toInt() > 0
           || room.value(QStringLiteral("markedUnread")).toBool();
}

} // namespace

void MainWindow::buildMenuBar() {
    auto *bar = menuBar();

    auto *appMenu = bar->addMenu(QStringLiteral("Pinger"));
    auto *aboutAction = appMenu->addAction(QStringLiteral("About Pinger"));
    aboutAction->setMenuRole(QAction::AboutRole);
    connect(aboutAction, &QAction::triggered, this, [this] { showSettings(QStringLiteral("About")); });
    auto *updatesAction = appMenu->addAction(QStringLiteral("Check for Updates…"));
    connect(updatesAction, &QAction::triggered, this, [this] { callCheckForUpdates(); });
    appMenu->addSeparator();
    auto *settingsAction = appMenu->addAction(QStringLiteral("Settings…"));
    settingsAction->setMenuRole(QAction::PreferencesRole);
    settingsAction->setShortcut(QKeySequence::Preferences);
    connect(settingsAction, &QAction::triggered, this, [this] { showSettings(); });
    auto *settingsSections = appMenu->addMenu(QStringLiteral("Settings Section"));
    const QStringList sections = {
        QStringLiteral("General"), QStringLiteral("Account"), QStringLiteral("Appearance"),
        QStringLiteral("Notifications"), QStringLiteral("Keyboard"), QStringLiteral("History"),
        QStringLiteral("Devices"), QStringLiteral("Storage"), QStringLiteral("Security"),
        QStringLiteral("Help"), QStringLiteral("About"), QStringLiteral("AI"),
        QStringLiteral("Integrations"),
    };
    for (const auto &section : sections) {
        addCommand(settingsSections, section, QKeySequence(), [this, section] { showSettings(section); });
    }
    appMenu->addSeparator();
    auto *quitAction = appMenu->addAction(QStringLiteral("Quit Pinger"));
    quitAction->setMenuRole(QAction::QuitRole);
    quitAction->setShortcut(QKeySequence::Quit);
    connect(quitAction, &QAction::triggered, qApp, &QApplication::quit);

    auto *fileMenu = bar->addMenu(QStringLiteral("File"));
    addCommand(fileMenu, QStringLiteral("New Private Model Chat"), primaryShortcut(QStringLiteral("Shift+M")),
               [this] { showLocalAIChatDialog(); });
    switchAccountMenu_ = fileMenu->addMenu(QStringLiteral("Switch Account"));
    addCommand(fileMenu, QStringLiteral("Add Account…"), QKeySequence(), [this] { addAccount(); });
    fileMenu->addSeparator();
    auto *closeAction = fileMenu->addAction(QStringLiteral("Close Window"));
    closeAction->setShortcut(QKeySequence::Close);
    connect(closeAction, &QAction::triggered, this, &QWidget::close);

    auto *editMenu = bar->addMenu(QStringLiteral("Edit"));
    auto *undoAction = editMenu->addAction(QStringLiteral("Undo"));
    undoAction->setShortcut(QKeySequence::Undo);
    connect(undoAction, &QAction::triggered, this,
            [] { runEditCommand(&QPlainTextEdit::undo, &QLineEdit::undo); });
    auto *redoAction = editMenu->addAction(QStringLiteral("Redo"));
    redoAction->setShortcut(QKeySequence::Redo);
    connect(redoAction, &QAction::triggered, this,
            [] { runEditCommand(&QPlainTextEdit::redo, &QLineEdit::redo); });
    editMenu->addSeparator();
    auto *cutAction = editMenu->addAction(QStringLiteral("Cut"));
    cutAction->setShortcut(QKeySequence::Cut);
    connect(cutAction, &QAction::triggered, this,
            [] { runEditCommand(&QPlainTextEdit::cut, &QLineEdit::cut); });
    auto *copyAction = editMenu->addAction(QStringLiteral("Copy"));
    copyAction->setShortcut(QKeySequence::Copy);
    connect(copyAction, &QAction::triggered, this,
            [] { runEditCommand(&QPlainTextEdit::copy, &QLineEdit::copy); });
    auto *pasteAction = editMenu->addAction(QStringLiteral("Paste"));
    pasteAction->setShortcut(QKeySequence::Paste);
    connect(pasteAction, &QAction::triggered, this,
            [] { runEditCommand(&QPlainTextEdit::paste, &QLineEdit::paste); });
    editMenu->addSeparator();
    auto *selectAllAction = editMenu->addAction(QStringLiteral("Select All"));
    selectAllAction->setShortcut(QKeySequence::SelectAll);
    connect(selectAllAction, &QAction::triggered, this,
            [] { runEditCommand(&QPlainTextEdit::selectAll, &QLineEdit::selectAll); });

    messagesMenu_ = bar->addMenu(QStringLiteral("Messages"));
    addCommand(messagesMenu_, QStringLiteral("Search Messages…"), QKeySequence::Find,
               [this] { searchMessages(); });
    addCommand(messagesMenu_, QStringLiteral("Quick Switch Rooms…"), primaryShortcut(QStringLiteral("K")),
               [this] { showQuickSwitcher(); });
    addCommand(messagesMenu_, QStringLiteral("Focus Room Search"), primaryShortcut(QStringLiteral("Shift+S")),
               [this] { roomFilter_->setFocus(); });
    addCommand(messagesMenu_, QStringLiteral("Jump to Latest"), primaryShortcut(QStringLiteral("Shift+L")),
               [this] {
                   if (!currentRoomID_.isEmpty()) {
                       loadHistory(currentRoomID_);
                   }
               });
    addCommand(messagesMenu_, QStringLiteral("Next Room"), QKeySequence(),
               [this] { selectRoomByOffset(1); });
    addCommand(messagesMenu_, QStringLiteral("Previous Room"), QKeySequence(),
               [this] { selectRoomByOffset(-1); });
    addCommand(messagesMenu_, QStringLiteral("Next Needs-Reply Room"), QKeySequence(),
               [this] { selectRoomByOffset(1, true); });
    addCommand(messagesMenu_, QStringLiteral("Previous Needs-Reply Room"), QKeySequence(),
               [this] { selectRoomByOffset(-1, true); });
    messagesMenu_->addSeparator();

    auto *filterGroup = new QActionGroup(messagesMenu_);
    filterGroup->setExclusive(true);
    const QList<QPair<QString, QString>> scopes = {
        {QStringLiteral("All Rooms"), QStringLiteral("all")},
        {QStringLiteral("Unread"), QStringLiteral("unread")},
        {QStringLiteral("Mentions"), QStringLiteral("mentions")},
        {QStringLiteral("Needs Reply"), QStringLiteral("needs-reply")},
        {QStringLiteral("Unanswered"), QStringLiteral("unanswered")},
        {QStringLiteral("Favorites"), QStringLiteral("favorites")},
        {QStringLiteral("Archived"), QStringLiteral("archived")},
    };
    const QHash<QString, QString> scopeShortcuts = {
        {QStringLiteral("all"), QStringLiteral("Shift+A")},
        {QStringLiteral("needs-reply"), QStringLiteral("Shift+U")},
        {QStringLiteral("unanswered"), QStringLiteral("Shift+R")},
        {QStringLiteral("favorites"), QStringLiteral("Shift+F")},
        {QStringLiteral("archived"), QStringLiteral("Shift+H")},
    };
    for (const auto &entry : scopes) {
        const QString &text = entry.first;
        const QString scope = entry.second;
        auto *action = messagesMenu_->addAction(text);
        action->setCheckable(true);
        action->setActionGroup(filterGroup);
        if (scopeShortcuts.contains(scope)) {
            action->setShortcut(primaryShortcut(scopeShortcuts.value(scope)));
        }
        filterActions_.insert(scope, action);
        connect(action, &QAction::triggered, this, [this, scope] {
            roomScope_->setCurrentIndex(roomScope_->findData(scope));
        });
    }
    messagesMenu_->addSeparator();
    auto *analyzeDraftAction =
        addCommand(messagesMenu_, QStringLiteral("Analyze Draft with Language Tutor…"),
                   primaryShortcut(QStringLiteral("Shift+T")),
                   [this] {
                       showAITools(QStringLiteral("Language Tutor"), QStringLiteral("T"),
                                   composer_->toPlainText());
                   });
    setMenuShortcut(analyzeDraftAction, primaryShortcut(QStringLiteral("Shift+T")));
    auto *suggestRepliesAction =
        addCommand(messagesMenu_, QStringLiteral("Suggest Replies with AI"),
                   primaryShortcut(QStringLiteral("Shift+B")),
                   [this] {
                       showAITools(QStringLiteral("Suggestions"), QStringLiteral("B"));
                   });
    setMenuShortcut(suggestRepliesAction, primaryShortcut(QStringLiteral("Shift+B")));
    auto *generateImageAction =
        addCommand(messagesMenu_, QStringLiteral("Generate Image from Draft"),
                   primaryShortcut(QStringLiteral("Shift+J")),
                   [this] {
                       showAITools(QStringLiteral("Image"), QStringLiteral("J"),
                                   composer_->toPlainText());
                   });
    setMenuShortcut(generateImageAction, primaryShortcut(QStringLiteral("Shift+J")));
    messagesMenu_->addSeparator();
    addCommand(messagesMenu_, QStringLiteral("Mark All Rooms as Read"), QKeySequence(), [this] {
        backend_->call(QStringLiteral("MarkAllRead"), QJsonArray(), [this](QJsonValue, const QString &error) {
            if (!error.isEmpty()) {
                showError(error);
                return;
            }
            loadSnapshot();
        });
    });
    messagesMenu_->addSeparator();

    roomMenu_ = messagesMenu_->addMenu(QStringLiteral("Current Room"));
    markReadAction_ = addCommand(roomMenu_, QStringLiteral("Mark Read"), QKeySequence(), [this] {
        const QJsonObject room = roomByID(currentRoomID_);
        runRoomAction(QStringLiteral("MarkRead"),
                      {currentRoomID_, room.value(QStringLiteral("lastEventId")).toString()});
    });
    markUnreadAction_ = addCommand(roomMenu_, QStringLiteral("Mark Unread"), QKeySequence(), [this] {
        runRoomAction(QStringLiteral("MarkUnread"), {currentRoomID_});
    });
    markAnsweredAction_ = addCommand(roomMenu_, QStringLiteral("Mark Answered"), QKeySequence(), [this] {
        markRoomAnswered(currentRoomID_);
    });
    addNeedsReplyAction_ = addCommand(roomMenu_, QStringLiteral("Add to Needs Reply"), QKeySequence(), [this] {
        runRoomAction(QStringLiteral("SetRoomUnanswered"), {currentRoomID_, true});
    });
    roomMenu_->addSeparator();
    favoriteAction_ = addCommand(roomMenu_, QStringLiteral("Add to Favorites"), QKeySequence(), [this] {
        const bool favorite = roomByID(currentRoomID_).value(QStringLiteral("favorite")).toBool();
        runRoomAction(QStringLiteral("SetBooleanPreference"),
                      {QStringLiteral("room.favorite.") + currentRoomID_, !favorite});
    });
    muteAction_ = addCommand(roomMenu_, QStringLiteral("Mute Room"), QKeySequence(), [this] {
        const bool muted = roomByID(currentRoomID_).value(QStringLiteral("muted")).toBool();
        runRoomAction(QStringLiteral("SetBooleanPreference"),
                      {QStringLiteral("room.muted.") + currentRoomID_, !muted});
    });
    archiveAction_ = addCommand(roomMenu_, QStringLiteral("Archive Room"), QKeySequence(), [this] {
        setRoomArchived(roomByID(currentRoomID_), !roomIsArchived(roomByID(currentRoomID_)));
    });
    setMenuShortcut(markReadAction_, QKeySequence(QStringLiteral("U")));
    setMenuShortcut(markUnreadAction_, QKeySequence(QStringLiteral("U")));
    QString answeredShortcut = preferences_.value(QStringLiteral("shortcuts.mark_answered"))
                                   .toString(QStringLiteral("E")).trimmed();
    if (answeredShortcut.size() == 1) {
        setMenuShortcut(markAnsweredAction_, QKeySequence(answeredShortcut.toUpper()));
    }
    setMenuShortcut(addNeedsReplyAction_, QKeySequence(QStringLiteral("N")));
    setMenuShortcut(favoriteAction_, QKeySequence(QStringLiteral("F")));
    setMenuShortcut(muteAction_, QKeySequence(QStringLiteral("M")));
    setMenuShortcut(archiveAction_, QKeySequence(QStringLiteral("A")));

    auto *viewMenu = bar->addMenu(QStringLiteral("View"));
    contentBlurAction_ = viewMenu->addAction(QStringLiteral("Content Blur"));
    contentBlurAction_->setCheckable(true);
    contentBlurAction_->setShortcut(primaryShortcut(QStringLiteral("Shift+P")));
    connect(contentBlurAction_, &QAction::triggered, this, [this](bool checked) {
        callSetBooleanPreference(QStringLiteral("privacy.incognito"), checked);
    });
    connect(contentBlurIndicator_, &QToolButton::clicked, this, [this] {
        contentBlurAction_->trigger();
    });
    hideMediaAction_ = viewMenu->addAction(QStringLiteral("Hide Images and Videos"));
    hideMediaAction_->setCheckable(true);
    hideMediaAction_->setShortcut(primaryShortcut(QStringLiteral("Shift+I")));
    connect(hideMediaAction_, &QAction::triggered, this, [this](bool checked) {
        callSetBooleanPreference(QStringLiteral("appearance.hide_images_and_videos"), checked);
    });
    viewMenu->addSeparator();
    auto *zoomInAction = viewMenu->addAction(QStringLiteral("Zoom In"));
    zoomInAction->setShortcuts({QKeySequence::ZoomIn, primaryShortcut(QStringLiteral("="))});
    connect(zoomInAction, &QAction::triggered, this,
            [this] { setZoomPercent(zoomFromPreferences(preferences_) + 5); });
    auto *zoomOutAction = viewMenu->addAction(QStringLiteral("Zoom Out"));
    zoomOutAction->setShortcut(QKeySequence::ZoomOut);
    connect(zoomOutAction, &QAction::triggered, this,
            [this] { setZoomPercent(zoomFromPreferences(preferences_) - 5); });
    auto *actualSizeAction = viewMenu->addAction(QStringLiteral("Actual Size"));
    actualSizeAction->setShortcut(primaryShortcut(QStringLiteral("0")));
    connect(actualSizeAction, &QAction::triggered, this, [this] { setZoomPercent(100); });
    viewMenu->addSeparator();
    auto *fullScreenAction = viewMenu->addAction(QStringLiteral("Toggle Full Screen"));
    fullScreenAction->setShortcut(QKeySequence::FullScreen);
    connect(fullScreenAction, &QAction::triggered, this, [this] {
        if (isFullScreen()) {
            showNormal();
        } else {
            showFullScreen();
        }
    });

    auto *helpMenu = bar->addMenu(QStringLiteral("Help"));
    addCommand(helpMenu, QStringLiteral("Keyboard Shortcuts"), primaryShortcut(QStringLiteral("/")),
               [this] { showSettings(QStringLiteral("Keyboard")); });
    helpMenu->addSeparator();
    const QList<QPair<QString, QString>> links = {
        {QStringLiteral("Pinger Help"), QStringLiteral("https://github.com/cataWalter/pinger#readme")},
        {QStringLiteral("Report an Issue"), QStringLiteral("https://github.com/cataWalter/pinger/issues/new")},
        {QStringLiteral("Release Notes"), QStringLiteral("https://github.com/cataWalter/pinger/releases")},
        {QStringLiteral("Project Repository"), QStringLiteral("https://github.com/cataWalter/pinger")},
        {QStringLiteral("Project License"), QStringLiteral("https://github.com/cataWalter/pinger/blob/HEAD/LICENSE")},
    };
    for (const auto &entry : links) {
        const QString url = entry.second;
        addCommand(helpMenu, entry.first, QKeySequence(), [this, url] { callOpenExternalURL(url); });
    }

    updateMenuState();
}

void MainWindow::updateMenuState() {
    if (!messagesMenu_) {
        return;
    }
    messagesMenu_->menuAction()->setEnabled(pages_ && pages_->currentWidget() == chatPage_);

    switchAccountMenu_->clear();
    const auto accounts = snapshot_.value(QStringLiteral("accounts")).toArray();
    const QString activeAccountID = snapshot_.value(QStringLiteral("activeAccountId")).toString();
    for (const auto &value : accounts) {
        const auto account = value.toObject();
        const auto profile = account.value(QStringLiteral("profile")).toObject();
        const QString accountID = account.value(QStringLiteral("id")).toString();
        QString label = profile.value(QStringLiteral("displayName")).toString();
        if (label.isEmpty()) {
            label = profile.value(QStringLiteral("userId")).toString();
        }
        auto *action = switchAccountMenu_->addAction(label);
        action->setCheckable(true);
        action->setChecked(accountID == activeAccountID);
        connect(action, &QAction::triggered, this, [this, accountID] {
            if (accountID != snapshot_.value(QStringLiteral("activeAccountId")).toString()) {
                switchAccount(accountID);
            }
        });
    }
    switchAccountMenu_->setEnabled(accounts.size() > 1);

    const QString scope = roomScope_->currentData().toString();
    for (auto it = filterActions_.constBegin(); it != filterActions_.constEnd(); ++it) {
        it.value()->setChecked(it.key() == scope);
    }

    contentBlurAction_->setChecked(preferences_.value(QStringLiteral("privacy.incognito")).toBool());
    hideMediaAction_->setChecked(
        preferences_.value(QStringLiteral("appearance.hide_images_and_videos")).toBool());

    const QJsonObject room = roomByID(currentRoomID_);
    const bool hasRoom = !room.isEmpty();
    roomMenu_->menuAction()->setEnabled(hasRoom);
    if (!hasRoom) {
        return;
    }
    const bool unread = roomHasUnread(room);
    const bool needsReply = room.value(QStringLiteral("needsReply")).toBool();
    const bool unanswered = room.value(QStringLiteral("unanswered")).toBool();
    const bool favorite = room.value(QStringLiteral("favorite")).toBool();
    const bool muted = room.value(QStringLiteral("muted")).toBool();
    const bool archived = roomIsArchived(room);
    markReadAction_->setEnabled(unread && !room.value(QStringLiteral("lastEventId")).toString().isEmpty());
    markUnreadAction_->setEnabled(!unread);
    markAnsweredAction_->setEnabled(needsReply);
    addNeedsReplyAction_->setEnabled(unanswered && !needsReply);
    const QString answeredShortcut = preferences_.value(QStringLiteral("shortcuts.mark_answered"))
                                        .toString(QStringLiteral("E")).trimmed();
    markAnsweredAction_->setShortcut(answeredShortcut.size() == 1
                                         ? QKeySequence(answeredShortcut.toUpper())
                                         : QKeySequence());
    favoriteAction_->setText(favorite ? QStringLiteral("Remove from Favorites")
                                      : QStringLiteral("Add to Favorites"));
    muteAction_->setText(muted ? QStringLiteral("Unmute Room") : QStringLiteral("Mute Room"));
    archiveAction_->setText(archived ? QStringLiteral("Restore Room") : QStringLiteral("Archive Room"));
}

void MainWindow::showSettings(const QString &tab) {
    SettingsDialog dialog(backend_, snapshot_, media_, [this] { loadSnapshot(); }, this);
    if (!tab.isEmpty()) {
        selectTab(&dialog, tab);
    }
    dialog.exec();
}

void MainWindow::showAITools(const QString &tab, const QString &shortcut, const QString &text) {
    const QJsonObject room = roomByID(currentRoomID_);
    const QString roomName = room.value(QStringLiteral("name")).toString(currentRoomID_);
    AIToolsDialog dialog(backend_, media_, currentRoomID_, roomName, composer_, this);
    if (!tab.isEmpty()) {
        selectTab(&dialog, tab);
    }
    if (!shortcut.isEmpty()) {
        QTimer::singleShot(0, &dialog, [&dialog, shortcut, text] {
            dialog.runKeyboardShortcut(shortcut, text);
        });
    }
    dialog.exec();
}

void MainWindow::setZoomPercent(int percent) {
    const int next = qBound(75, percent, 125);
    callSetStringPreference(QStringLiteral("appearance.zoom"), QString::number(next));
    QFont font = QApplication::font();
    font.setPointSizeF(10.0 * next / 100.0);
    QApplication::setFont(font);
}

void MainWindow::setRoomArchived(const QJsonObject &room, bool archive) {
    const QString key = archivePreferenceKey(room);
    const QString roomID = room.value(QStringLiteral("id")).toString();
    const QString lastEventID = room.value(QStringLiteral("lastEventId")).toString();
    if (!archive || !roomHasUnread(room) || lastEventID.isEmpty()) {
        runRoomAction(QStringLiteral("SetBooleanPreference"), {key, archive});
        return;
    }
    backend_->call(QStringLiteral("MarkRead"), {roomID, lastEventID},
                   [this, key, archive](QJsonValue, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       runRoomAction(QStringLiteral("SetBooleanPreference"), {key, archive});
                   });
}
