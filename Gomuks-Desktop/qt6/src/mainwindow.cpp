#include "mainwindow.h"

#include "backendclient.h"
#include "aitoolsdialog.h"
#include "chatitemdelegate.h"
#include "localaichatdialog.h"
#include "mediaclient.h"
#include "qtutil.h"
#include "settingsdialog.h"
#include "stylesheet.h"

#include <QAction>
#include <QApplication>
#include <QComboBox>
#include <QClipboard>
#include <QCheckBox>
#include <QColorDialog>
#include <QDateTime>
#include <QDateTimeEdit>
#include <QCloseEvent>
#include <QDesktopServices>
#include <QDialog>
#include <QDialogButtonBox>
#include <QFile>
#include <QFileDialog>
#include <QFileInfo>
#include <QFormLayout>
#include <QGuiApplication>
#include <QHBoxLayout>
#include <QInputDialog>
#include <QImage>
#include <QKeyEvent>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonValue>
#include <QLabel>
#include <QLineEdit>
#include <QListWidget>
#include <QListWidgetItem>
#include <QMenu>
#include <QMessageBox>
#include <QPlainTextEdit>
#include <QPixmap>
#include <QPushButton>
#include <QPointer>
#include <QRegularExpression>
#include <QSignalBlocker>
#include <QSet>
#include <QSplitter>
#include <QStackedWidget>
#include <QStatusBar>
#include <QStyle>
#include <QSystemTrayIcon>
#include <QStringList>
#include <QTabWidget>
#include <QTimer>
#include <QUrl>
#include <QVector>
#include <QUuid>
#include <QVBoxLayout>
#include <QWidget>

#include <functional>
#include <memory>
#include <QColor>
#include <QPalette>

MainWindow::MainWindow(BackendClient *backend, QWidget *parent)
    : QMainWindow(parent), backend_(backend), media_(new MediaClient(this)) {
    setWindowTitle(QStringLiteral("Pinger"));
    resize(1100, 720);

    pages_ = new QStackedWidget(this);
    setCentralWidget(pages_);
    buildLoginPage();
    buildVerificationPage();
    buildChatPage();
    configureListViews(this);
    trayIcon_ = new QSystemTrayIcon(style()->standardIcon(QStyle::SP_ComputerIcon), this);
    trayIcon_->setToolTip(QStringLiteral("Pinger"));
    trayMenu_ = new QMenu(this);
    auto *showAction = trayMenu_->addAction(QStringLiteral("Show Pinger"));
    trayMenu_->addSeparator();
    auto *quitAction = trayMenu_->addAction(QStringLiteral("Quit"));
    trayIcon_->setContextMenu(trayMenu_);
    if (QSystemTrayIcon::isSystemTrayAvailable()) {
        trayIcon_->show();
    }
    connect(showAction, &QAction::triggered, this, [this] {
        showNormal();
        raise();
        activateWindow();
    });
    connect(quitAction, &QAction::triggered, qApp, &QApplication::quit);
    connect(trayIcon_, &QSystemTrayIcon::activated, this,
            [this](QSystemTrayIcon::ActivationReason reason) {
                if (reason == QSystemTrayIcon::Trigger || reason == QSystemTrayIcon::DoubleClick) {
                    showNormal();
                    raise();
                    activateWindow();
                }
            });
    connect(trayIcon_, &QSystemTrayIcon::messageClicked, this, [this] {
        showNormal();
        raise();
        activateWindow();
        const QString roomID = pendingNotificationRoomID_;
        const QString accountID = pendingNotificationAccountID_;
        pendingNotificationRoomID_.clear();
        pendingNotificationAccountID_.clear();
        if (roomID.isEmpty()) {
            return;
        }
        roomFilter_->clear();
        pendingRoomID_ = roomID;
        if (!accountID.isEmpty()
            && accountID != snapshot_.value(QStringLiteral("activeAccountId")).toString()) {
            switchAccount(accountID);
        } else {
            loadSnapshot();
        }
    });
    pages_->setCurrentWidget(loginPage_);

    refreshTimer_ = new QTimer(this);
    refreshTimer_->setInterval(500);
    refreshTimer_->setSingleShot(true);
    connect(refreshTimer_, &QTimer::timeout, this, [this] {
        loadSnapshot();
        if (!currentRoomID_.isEmpty() && historyBefore_ == 0) {
            loadHistory(currentRoomID_);
        }
    });
    connect(backend_, &BackendClient::eventReceived, this,
            [this](const QString &event, const QJsonValue &data) {
                if (event == QStringLiteral("quit")) {
                    close();
                    return;
                }
                if (event == QStringLiteral("scheduler:reminder")) {
                    const auto reminder = data.toObject();
                    const QString roomID = reminder.value(QStringLiteral("roomId")).toString();
                    const QString roomName = roomByID(roomID).value(QStringLiteral("name")).toString(roomID);
                    QString text = reminder.value(QStringLiteral("text")).toString().trimmed();
                    if (text.isEmpty()) {
                        text = QStringLiteral("A scheduled reminder is due.");
                    }
                    statusBar()->showMessage(QStringLiteral("%1: %2").arg(roomName, text), 15000);
                    return;
                }
                if (event == QStringLiteral("chat-export:progress")) {
                    const auto progress = data.toObject();
                    statusBar()->showMessage(
                        QStringLiteral("Exporting chat history · %1 messages loaded")
                            .arg(progress.value(QStringLiteral("messages")).toInt()));
                    return;
                }
                if (event == QStringLiteral("media-ready")) {
                    media_->setBaseUrl(data.toObject().value(QStringLiteral("url")).toString());
                    return;
                }
                if (event == QStringLiteral("update")) {
                    const auto update = data.toObject();
                    if (trayIcon_ && trayIcon_->isVisible()
                        && preferences_.value(QStringLiteral("notifications.enabled")).toBool(true)
                        && (!preferences_.value(QStringLiteral("notifications.only_when_unfocused"))
                             .toBool(true) || !isActiveWindow())) {
                        const QString privacy = preferences_.value(QStringLiteral("notifications.privacy"))
                            .toString(QStringLiteral("Sender and message preview"));
                        for (const auto &entry : update.value(QStringLiteral("notifications")).toArray()) {
                            const auto alert = entry.toObject();
                            const QString roomID = alert.value(QStringLiteral("roomId")).toString();
                            const QString room = alert.value(QStringLiteral("room")).toString(
                                QStringLiteral("Pinger"));
                            const QString sender = alert.value(QStringLiteral("sender")).toString();
                            QString message;
                            if (privacy == QStringLiteral("Hidden content")) {
                                message = QStringLiteral("New activity");
                            } else if (privacy == QStringLiteral("Sender only")) {
                                message = sender;
                            } else {
                                const QString body = alert.value(QStringLiteral("body")).toString();
                                message = sender.isEmpty() ? body : QStringLiteral("%1: %2").arg(sender, body);
                            }
                            if (message.trimmed().isEmpty()) {
                                message = QStringLiteral("New activity");
                            }
                            pendingNotificationRoomID_ = roomID;
                            pendingNotificationAccountID_ =
                                alert.value(QStringLiteral("accountId")).toString();
                            trayIcon_->showMessage(room, message,
                                                   QSystemTrayIcon::Information, 5000);
                        }
                    }
                    refreshTimer_->start();
                    updateTrayIcon();
                    return;
                }
                if (event == QStringLiteral("update") || event == QStringLiteral("preferences")) {
                    refreshTimer_->start();
                }
            });
    connect(backend_, &BackendClient::backendFailed, this, &MainWindow::showError);
    media_->setBaseUrl(backend_->mediaBaseUrl());
    loadSnapshot();
}

void MainWindow::closeEvent(QCloseEvent *event) {
    if (trayIcon_ && trayIcon_->isVisible()
        && (preferences_.value(QStringLiteral("window.minimize_to_tray")).toBool()
            || !preferences_.value(QStringLiteral("window.quit_on_close")).toBool(true))) {
        hide();
        event->ignore();
        return;
    }
    QMainWindow::closeEvent(event);
}

void MainWindow::updateTrayIcon() {
    if (!trayIcon_) {
        return;
    }
    int unread = 0;
    for (const auto &entry : snapshot_.value(QStringLiteral("rooms")).toArray()) {
        unread += entry.toObject().value(QStringLiteral("unread")).toInt();
    }
    trayIcon_->setToolTip(unread > 0
        ? QStringLiteral("Pinger · %1 unread").arg(unread)
        : QStringLiteral("Pinger"));
}

void MainWindow::keyPressEvent(QKeyEvent *event) {
    if (handleApplicationKey(event)) {
        event->accept();
        return;
    }
    QMainWindow::keyPressEvent(event);
}

bool MainWindow::handleApplicationKey(QKeyEvent *event) {
    if (pages_->currentWidget() != chatPage_ || event->isAutoRepeat()) {
        return false;
    }
    const auto *focus = QApplication::focusWidget();
    const bool textEntry = qobject_cast<const QLineEdit *>(focus)
        || qobject_cast<const QPlainTextEdit *>(focus)
        || (qobject_cast<const QComboBox *>(focus)
            && qobject_cast<const QComboBox *>(focus)->isEditable());
    const Qt::KeyboardModifiers modifiers = event->modifiers();
    const bool primary = modifiers.testFlag(Qt::ControlModifier)
        || modifiers.testFlag(Qt::MetaModifier);
    const bool shift = modifiers.testFlag(Qt::ShiftModifier);
    const bool alt = modifiers.testFlag(Qt::AltModifier);
    const int key = event->key();

    if (!textEntry && focus == rooms_ && shift
        && (key == Qt::Key_F10 || key == Qt::Key_Menu)) {
        if (rooms_->currentItem()) {
            const QRect itemRect = rooms_->visualItemRect(rooms_->currentItem());
            if (itemRect.isValid()) {
                showRoomContextMenu(itemRect.center());
            }
            return true;
        }
    }
    if (!textEntry && (focus == messages_ || focus == messages_->viewport())) {
        if (key == Qt::Key_J || key == Qt::Key_K) {
            const int direction = key == Qt::Key_J ? 1 : -1;
            if (messages_->count() > 0) {
                messages_->setCurrentRow(qBound(0, messages_->currentRow() + direction,
                                                messages_->count() - 1));
            }
            return true;
        }
        if (key == Qt::Key_Home || key == Qt::Key_End) {
            if (messages_->count() > 0) {
                messages_->setCurrentRow(key == Qt::Key_Home ? 0 : messages_->count() - 1);
            }
            return true;
        }
        if (key == Qt::Key_R && !primary && !shift && !alt && messages_->currentItem()) {
            const QString eventID = messages_->currentItem()->data(Qt::UserRole).toString();
            const QJsonObject message = messagesByID_.value(eventID);
            if (!eventID.isEmpty() && !message.value(QStringLiteral("sending")).toBool()) {
                editEventID_.clear();
                replyToEventID_ = eventID;
                composer_->clear();
                setComposeContext(QStringLiteral("Replying to %1: %2")
                                      .arg(message.value(QStringLiteral("senderName")).toString(),
                                           message.value(QStringLiteral("body")).toString()));
                composer_->setFocus();
                return true;
            }
        }
    }

    if (key == Qt::Key_Escape && !textEntry) {
        if (roomFilter_->hasFocus() && !roomFilter_->text().isEmpty()) {
            roomFilter_->clear();
            return true;
        }
        return false;
    }
    if (!textEntry && !primary && !alt && key == Qt::Key_Slash) {
        roomFilter_->setFocus();
        return true;
    }
    if (!textEntry && !primary && !alt && key == Qt::Key_Question) {
        SettingsDialog dialog(backend_, snapshot_, media_, [this] { loadSnapshot(); }, this);
        if (auto *tabs = dialog.findChild<QTabWidget *>()) {
            for (int tab = 0; tab < tabs->count(); ++tab) {
                if (tabs->tabText(tab) == QStringLiteral("Keyboard")) {
                    tabs->setCurrentIndex(tab);
                    break;
                }
            }
        }
        dialog.exec();
        return true;
    }

    if (!textEntry && primary && alt && !shift
        && key >= Qt::Key_1 && key <= Qt::Key_9) {
        const int accountIndex = key - Qt::Key_1;
        const auto accounts = snapshot_.value(QStringLiteral("accounts")).toArray();
        if (accountIndex < accounts.size()) {
            switchAccount(accounts.at(accountIndex).toObject()
                              .value(QStringLiteral("id")).toString());
            return true;
        }
        return false;
    }

    if (!textEntry && primary && shift) {
        if (key == Qt::Key_Up || key == Qt::Key_Down) {
            selectRoomByOffset(key == Qt::Key_Down ? 1 : -1, true);
            return true;
        }
        if (key == Qt::Key_A) {
            roomScope_->setCurrentIndex(roomScope_->findData(QStringLiteral("all")));
            return true;
        }
        if (key == Qt::Key_H) {
            roomScope_->setCurrentIndex(roomScope_->findData(QStringLiteral("archived")));
            return true;
        }
        if (key == Qt::Key_R) {
            roomScope_->setCurrentIndex(roomScope_->findData(QStringLiteral("unanswered")));
            return true;
        }
        if (key == Qt::Key_U) {
            roomScope_->setCurrentIndex(roomScope_->findData(QStringLiteral("needs-reply")));
            return true;
        }
        if (key == Qt::Key_F) {
            roomScope_->setCurrentIndex(roomScope_->findData(QStringLiteral("favorites")));
            return true;
        }
        if (key == Qt::Key_M) {
            showLocalAIChatDialog();
            return true;
        }
        if (key == Qt::Key_L) {
            if (!currentRoomID_.isEmpty()) {
                loadHistory(currentRoomID_);
            }
            return true;
        }
        if (key == Qt::Key_S) {
            roomFilter_->setFocus();
            return true;
        }
        if (key == Qt::Key_P) {
            callSetBooleanPreference(
                QStringLiteral("privacy.incognito"),
                !preferences_.value(QStringLiteral("privacy.incognito")).toBool());
            return true;
        }
        if (key == Qt::Key_I) {
            callSetBooleanPreference(
                QStringLiteral("appearance.hide_images_and_videos"),
                !preferences_.value(QStringLiteral("appearance.hide_images_and_videos")).toBool());
            return true;
        }
    }

    if (!textEntry && primary && !shift && !alt) {
        if (key == Qt::Key_K) {
            showQuickSwitcher();
            return true;
        }
        if (key == Qt::Key_F) {
            searchMessages();
            return true;
        }
        if (key == Qt::Key_Comma) {
            preferencesButton_->click();
            return true;
        }
        if (key == Qt::Key_Up || key == Qt::Key_Down) {
            selectRoomByOffset(key == Qt::Key_Down ? 1 : -1);
            return true;
        }
        if (key >= Qt::Key_1 && key <= Qt::Key_9) {
            const int row = key - Qt::Key_1;
            if (row < rooms_->count()) {
                rooms_->setCurrentRow(row);
                return true;
            }
        }
        if (key == Qt::Key_Plus || key == Qt::Key_Equal || key == Qt::Key_Minus
            || key == Qt::Key_0) {
            bool ok = false;
            const int current = preferences_.value(QStringLiteral("appearance.zoom"))
                                    .toString(QStringLiteral("100")).toInt(&ok);
            const int zoom = ok ? current : 100;
            const int next = key == Qt::Key_0 ? 100
                : qBound(75, zoom + (key == Qt::Key_Minus ? -5 : 5), 125);
            callSetStringPreference(QStringLiteral("appearance.zoom"), QString::number(next));
            QFont font = QApplication::font();
            font.setPointSizeF(10.0 * next / 100.0);
            QApplication::setFont(font);
            return true;
        }
    }

    if (!textEntry && alt && !primary && !shift
        && (key == Qt::Key_Up || key == Qt::Key_Down)) {
        selectRoomByOffset(key == Qt::Key_Down ? 1 : -1);
        return true;
    }

    if (!textEntry && !primary && !alt && !shift
        && preferences_.value(QStringLiteral("shortcuts.single_keys")).toBool(true)
        && !currentRoomID_.isEmpty()) {
        if (key == Qt::Key_N || key == Qt::Key_U || key == Qt::Key_A
            || key == Qt::Key_F || key == Qt::Key_M) {
            applyRoomShortcut(QString(QChar(key)).toLower());
            return true;
        }
        const QString answered = preferences_.value(QStringLiteral("shortcuts.mark_answered"))
                                     .toString(QStringLiteral("E")).trimmed();
        if (!answered.isEmpty() && event->text().compare(answered, Qt::CaseInsensitive) == 0) {
            const QJsonObject room = roomByID(currentRoomID_);
            if (room.value(QStringLiteral("needsReply")).toBool()) {
                runRoomAction(QStringLiteral("SetRoomUnanswered"),
                              {currentRoomID_, false});
                return true;
            }
        }
    }
    return false;
}

void MainWindow::selectRoomByOffset(int direction, bool needsReplyOnly) {
    QVector<int> rows;
    for (int index = 0; index < rooms_->count(); ++index) {
        const auto room = roomByID(rooms_->item(index)->data(Qt::UserRole).toString());
        if (!needsReplyOnly || room.value(QStringLiteral("needsReply")).toBool()) {
            rows.append(index);
        }
    }
    if (rows.isEmpty()) {
        return;
    }
    int current = rows.indexOf(rooms_->currentRow());
    int next = current < 0 ? (direction > 0 ? 0 : rows.size() - 1)
                           : (current + direction + rows.size()) % rows.size();
    rooms_->setCurrentRow(rows.at(next));
}

void MainWindow::applyRoomShortcut(const QString &key) {
    const QJsonObject room = roomByID(currentRoomID_);
    if (room.isEmpty()) {
        return;
    }
    const bool unread = room.value(QStringLiteral("unread")).toInt() > 0
        || room.value(QStringLiteral("markedUnread")).toBool();
    if (key == QStringLiteral("n")) {
        if (room.value(QStringLiteral("unanswered")).toBool()
            && !room.value(QStringLiteral("needsReply")).toBool()) {
            runRoomAction(QStringLiteral("SetRoomUnanswered"), {currentRoomID_, true});
        }
    } else if (key == QStringLiteral("u")) {
        if (unread) {
            const QString eventID = room.value(QStringLiteral("lastEventId")).toString();
            if (!eventID.isEmpty()) {
                runRoomAction(QStringLiteral("MarkRead"), {currentRoomID_, eventID});
            }
        } else {
            runRoomAction(QStringLiteral("MarkUnread"), {currentRoomID_});
        }
    } else if (key == QStringLiteral("a")) {
        runRoomAction(QStringLiteral("SetBooleanPreference"),
                      {archivePreferenceKey(room), !roomIsArchived(room)});
    } else if (key == QStringLiteral("f") || key == QStringLiteral("m")) {
        const bool favorite = key == QStringLiteral("f");
        const QString preference = favorite ? QStringLiteral("room.favorite.")
                                            : QStringLiteral("room.muted.");
        const QString field = favorite ? QStringLiteral("favorite") : QStringLiteral("muted");
        runRoomAction(QStringLiteral("SetBooleanPreference"),
                      {preference + currentRoomID_, !room.value(field).toBool()});
    }
}

void MainWindow::showQuickSwitcher() {
    auto *dialog = new QDialog(this);
    dialog->setWindowTitle(QStringLiteral("Quick switch"));
    dialog->setModal(true);
    dialog->resize(480, 520);
    auto *layout = new QVBoxLayout(dialog);
    auto *query = new QLineEdit(dialog);
    query->setPlaceholderText(QStringLiteral("Search rooms…"));
    auto *list = new QListWidget(dialog);
    list->setItemDelegate(new RoomListDelegate(list));
    layout->addWidget(query);
    layout->addWidget(list, 1);
    for (int index = 0; index < rooms_->count(); ++index) {
        const auto *source = rooms_->item(index);
        auto *item = new QListWidgetItem(source->text(), list);
        item->setData(Qt::UserRole, source->data(Qt::UserRole));
        item->setData(Qt::UserRole + 1, source->data(Qt::UserRole + 1));
    }
    configureListViews(dialog);
    auto filter = [query, list] {
        const QString text = query->text().trimmed();
        int firstVisible = -1;
        for (int index = 0; index < list->count(); ++index) {
            auto *item = list->item(index);
            const auto room = QJsonObject::fromVariantMap(item->data(Qt::UserRole + 1).toMap());
            const bool match = text.isEmpty()
                || room.value(QStringLiteral("name")).toString().contains(text, Qt::CaseInsensitive)
                || room.value(QStringLiteral("id")).toString().contains(text, Qt::CaseInsensitive)
                || room.value(QStringLiteral("preview")).toString().contains(text, Qt::CaseInsensitive);
            item->setHidden(!match);
            if (match && firstVisible < 0) {
                firstVisible = index;
            }
        }
        if (firstVisible >= 0) {
            list->setCurrentRow(firstVisible);
        }
    };
    connect(query, &QLineEdit::textChanged, dialog, filter);
    auto selectCurrent = [this, dialog, list] {
        if (!list->currentItem()) {
            return;
        }
        const QString roomID = list->currentItem()->data(Qt::UserRole).toString();
        const auto room = roomByID(roomID);
        roomScope_->setCurrentIndex(roomScope_->findData(
            roomIsArchived(room) ? QStringLiteral("archived") : QStringLiteral("all")));
        roomFilter_->clear();
        for (int row = 0; row < rooms_->count(); ++row) {
            if (rooms_->item(row)->data(Qt::UserRole).toString() == roomID) {
                rooms_->setCurrentRow(row);
                break;
            }
        }
        dialog->accept();
    };
    connect(list, &QListWidget::itemActivated, dialog,
            [selectCurrent](QListWidgetItem *) { selectCurrent(); });
    connect(query, &QLineEdit::returnPressed, dialog, selectCurrent);
    if (list->count() > 0) {
        list->setCurrentRow(0);
    }
    query->setFocus();
    dialog->exec();
}

void MainWindow::buildLoginPage() {
    loginPage_ = new QWidget(this);
    auto *outer = new QVBoxLayout(loginPage_);
    outer->addStretch();
    auto *form = new QFormLayout;
    homeserver_ = new QLineEdit(QStringLiteral("https://matrix.org"), loginPage_);
    username_ = new QLineEdit(loginPage_);
    password_ = new QLineEdit(loginPage_);
    password_->setEchoMode(QLineEdit::Password);
    form->addRow(QStringLiteral("Homeserver"), homeserver_);
    form->addRow(QStringLiteral("Username"), username_);
    form->addRow(QStringLiteral("Password"), password_);
    auto *panel = new QWidget(loginPage_);
    panel->setMaximumWidth(420);
    panel->setLayout(form);
    outer->addWidget(new QLabel(QStringLiteral("Sign in to Matrix"), loginPage_), 0, Qt::AlignHCenter);
    outer->addWidget(panel, 0, Qt::AlignHCenter);
    loginButton_ = new QPushButton(QStringLiteral("Sign in"), loginPage_);
    loginButton_->setDefault(true);
    outer->addWidget(loginButton_, 0, Qt::AlignHCenter);
    auto *error = new QLabel(loginPage_);
    error->setObjectName(QStringLiteral("loginError"));
    error->setWordWrap(true);
    error->setAlignment(Qt::AlignCenter);
    outer->addWidget(error, 0, Qt::AlignHCenter);
    outer->addStretch();
    pages_->addWidget(loginPage_);

    connect(loginButton_, &QPushButton::clicked, this, [this, error] {
        loginButton_->setEnabled(false);
        error->clear();
        backend_->call(QStringLiteral("Login"),
                       {homeserver_->text(), username_->text(), password_->text()},
                       [this, error](QJsonValue, const QString &message) {
                           loginButton_->setEnabled(true);
                           if (!message.isEmpty()) {
                               error->setText(message);
                               return;
                           }
                           password_->clear();
                           loadSnapshot();
                       });
    });
}

void MainWindow::buildChatPage() {
    chatPage_ = new QWidget(this);
    auto *layout = new QHBoxLayout(chatPage_);
    auto *sidebar = new QWidget(chatPage_);
    sidebar->setObjectName(QStringLiteral("sidebar"));
    sidebar->setMinimumWidth(240);
    sidebar->setMaximumWidth(360);
    auto *sidebarLayout = new QVBoxLayout(sidebar);
    accountSwitcher_ = new QComboBox(sidebar);
    addAccountButton_ = new QPushButton(QStringLiteral("Add account"), sidebar);
    devicesButton_ = new QPushButton(QStringLiteral("Manage devices"), sidebar);
    searchMessagesButton_ = new QPushButton(QStringLiteral("Search messages"), sidebar);
    joinRoomButton_ = new QPushButton(QStringLiteral("Join a room"), sidebar);
    directChatButton_ = new QPushButton(QStringLiteral("New direct chat"), sidebar);
    createGroupButton_ = new QPushButton(QStringLiteral("Create group"), sidebar);
    scheduledJobsButton_ = new QPushButton(QStringLiteral("Scheduled messages"), sidebar);
    preferencesButton_ = new QPushButton(QStringLiteral("Settings"), sidebar);
    aiButton_ = new QPushButton(QStringLiteral("AI features"), sidebar);
    localAIButton_ = new QPushButton(QStringLiteral("Local AI chats"), sidebar);
    exportButton_ = new QPushButton(QStringLiteral("Export chats"), sidebar);
    logoutButton_ = new QPushButton(QStringLiteral("Log out"), sidebar);
    roomScope_ = new QComboBox(sidebar);
    roomScope_->addItem(QStringLiteral("All rooms"), QStringLiteral("all"));
    roomScope_->addItem(QStringLiteral("Unanswered"), QStringLiteral("unanswered"));
    roomScope_->addItem(QStringLiteral("Needs reply"), QStringLiteral("needs-reply"));
    roomScope_->addItem(QStringLiteral("Favorites"), QStringLiteral("favorites"));
    roomScope_->addItem(QStringLiteral("Archived"), QStringLiteral("archived"));
    roomFilter_ = new QLineEdit(sidebar);
    roomFilter_->setPlaceholderText(QStringLiteral("Search rooms"));
    rooms_ = new QListWidget(sidebar);
    rooms_->setObjectName(QStringLiteral("roomsList"));
    rooms_->setItemDelegate(new RoomListDelegate(rooms_));
    rooms_->setSpacing(0);
    rooms_->setContextMenuPolicy(Qt::CustomContextMenu);
    inviteLabel_ = new QLabel(QStringLiteral("Invitations"), sidebar);
    invites_ = new QListWidget(sidebar);
    invites_->setMaximumHeight(120);
    auto *inviteActions = new QHBoxLayout;
    acceptInviteButton_ = new QPushButton(QStringLiteral("Accept"), sidebar);
    declineInviteButton_ = new QPushButton(QStringLiteral("Decline"), sidebar);
    inviteActions->addWidget(acceptInviteButton_);
    inviteActions->addWidget(declineInviteButton_);
    inviteLabel_->hide();
    invites_->hide();
    acceptInviteButton_->hide();
    declineInviteButton_->hide();
    sidebarLayout->addWidget(accountSwitcher_);
    sidebarLayout->addWidget(addAccountButton_);
    sidebarLayout->addWidget(devicesButton_);
    sidebarLayout->addWidget(searchMessagesButton_);
    sidebarLayout->addWidget(joinRoomButton_);
    sidebarLayout->addWidget(directChatButton_);
    sidebarLayout->addWidget(createGroupButton_);
    sidebarLayout->addWidget(scheduledJobsButton_);
    sidebarLayout->addWidget(preferencesButton_);
    sidebarLayout->addWidget(aiButton_);
    sidebarLayout->addWidget(localAIButton_);
    sidebarLayout->addWidget(exportButton_);
    sidebarLayout->addWidget(logoutButton_);
    sidebarLayout->addWidget(roomScope_);
    sidebarLayout->addWidget(roomFilter_);
    sidebarLayout->addWidget(inviteLabel_);
    sidebarLayout->addWidget(invites_);
    sidebarLayout->addLayout(inviteActions);
    sidebarLayout->addWidget(rooms_);
    layout->addWidget(sidebar);

    auto *conversation = new QWidget(chatPage_);
    auto *conversationLayout = new QVBoxLayout(conversation);
    roomTitle_ = new QLabel(QStringLiteral("Select a room"), conversation);
    messages_ = new QListWidget(conversation);
    messages_->setObjectName(QStringLiteral("messagesList"));
    messages_->setItemDelegate(new MessageBubbleDelegate(messages_));
    messages_->setSpacing(2);
    messages_->setWordWrap(true);
    messages_->setContextMenuPolicy(Qt::CustomContextMenu);
    composer_ = new QPlainTextEdit(conversation);
    composer_->setPlaceholderText(QStringLiteral("Write a message"));
    composer_->setMaximumHeight(120);
    auto *composeContextRow = new QHBoxLayout;
    composeContext_ = new QLabel(conversation);
    composeContext_->setWordWrap(true);
    cancelComposeContextButton_ = new QPushButton(QStringLiteral("Cancel"), conversation);
    composeContextRow->addWidget(composeContext_, 1);
    composeContextRow->addWidget(cancelComposeContextButton_);
    composeContext_->hide();
    cancelComposeContextButton_->hide();
    auto *composerRow = new QHBoxLayout;
    attachButton_ = new QPushButton(QStringLiteral("Attach…"), conversation);
    scheduleMessageButton_ = new QPushButton(QStringLiteral("Schedule…"), conversation);
    sendButton_ = new QPushButton(QStringLiteral("Send"), conversation);
    composerRow->addWidget(composer_, 1);
    composerRow->addWidget(attachButton_);
    composerRow->addWidget(scheduleMessageButton_);
    composerRow->addWidget(sendButton_);
    conversationLayout->addWidget(roomTitle_);
    conversationLayout->addWidget(messages_, 1);
    conversationLayout->addLayout(composeContextRow);
    conversationLayout->addLayout(composerRow);
    layout->addWidget(conversation, 1);
    pages_->addWidget(chatPage_);

    connect(roomFilter_, &QLineEdit::textChanged, this, &MainWindow::updateRoomFilter);
    connect(roomScope_, qOverload<int>(&QComboBox::currentIndexChanged),
            this, [this] { filterRooms(); });
    connect(joinRoomButton_, &QPushButton::clicked, this, &MainWindow::joinRoom);
    connect(directChatButton_, &QPushButton::clicked, this, &MainWindow::startDirectChat);
    connect(createGroupButton_, &QPushButton::clicked, this, &MainWindow::createGroupRoom);
    connect(scheduledJobsButton_, &QPushButton::clicked, this, &MainWindow::openScheduledJobs);
    connect(preferencesButton_, &QPushButton::clicked, this, [this] {
        SettingsDialog dialog(backend_, snapshot_, media_,
                              [this] { loadSnapshot(); }, this);
        dialog.exec();
    });
    connect(aiButton_, &QPushButton::clicked, this, [this] {
        const QJsonObject room = roomByID(currentRoomID_);
        const QString roomName = room.value(QStringLiteral("name")).toString(currentRoomID_);
        AIToolsDialog dialog(backend_, media_, currentRoomID_, roomName, composer_, this);
        dialog.exec();
    });
    connect(localAIButton_, &QPushButton::clicked, this, &MainWindow::showLocalAIChatDialog);
    connect(exportButton_, &QPushButton::clicked, this, &MainWindow::showExportDialog);
    connect(addAccountButton_, &QPushButton::clicked, this, &MainWindow::addAccount);
    connect(devicesButton_, &QPushButton::clicked, this, &MainWindow::showDevices);
    connect(searchMessagesButton_, &QPushButton::clicked, this, &MainWindow::searchMessages);
    connect(accountSwitcher_, qOverload<int>(&QComboBox::currentIndexChanged),
            this, [this](int index) {
                if (index >= 0) {
                    switchAccount(accountSwitcher_->itemData(index).toString());
                }
            });
    connect(invites_, &QListWidget::currentRowChanged, this, [this](int row) {
        const bool selected = row >= 0;
        acceptInviteButton_->setEnabled(selected);
        declineInviteButton_->setEnabled(selected);
    });
    connect(acceptInviteButton_, &QPushButton::clicked, this, [this] {
        auto *item = invites_->currentItem();
        if (!item) {
            return;
        }
        const QString roomID = item->data(Qt::UserRole).toString();
        acceptInviteButton_->setEnabled(false);
        backend_->call(QStringLiteral("AcceptInvite"), {roomID},
                       [this](QJsonValue result, const QString &error) {
                           acceptInviteButton_->setEnabled(true);
                           if (!error.isEmpty()) {
                               showError(error);
                               return;
                           }
                           pendingRoomID_ = result.toString();
                           loadSnapshot();
                       });
    });
    connect(declineInviteButton_, &QPushButton::clicked, this, [this] {
        auto *item = invites_->currentItem();
        if (!item) {
            return;
        }
        const QString roomID = item->data(Qt::UserRole).toString();
        declineInviteButton_->setEnabled(false);
        backend_->call(QStringLiteral("DeclineInvite"), {roomID},
                       [this](QJsonValue, const QString &error) {
                           declineInviteButton_->setEnabled(true);
                           if (!error.isEmpty()) {
                               showError(error);
                               return;
                           }
                           loadSnapshot();
                       });
    });
    connect(rooms_, &QListWidget::customContextMenuRequested,
            this, &MainWindow::showRoomContextMenu);
    connect(messages_, &QListWidget::customContextMenuRequested,
            this, &MainWindow::showMessageContextMenu);
    connect(messages_, &QListWidget::itemDoubleClicked, this,
            [this](QListWidgetItem *item) {
                if (item) {
                    openMediaPreview(item->data(Qt::UserRole).toString());
                }
            });
    connect(cancelComposeContextButton_, &QPushButton::clicked,
            this, &MainWindow::clearComposeContext);
    connect(attachButton_, &QPushButton::clicked, this, &MainWindow::attachFile);
    connect(logoutButton_, &QPushButton::clicked, this, [this] {
        logoutButton_->setEnabled(false);
        backend_->call(QStringLiteral("Logout"), {}, [this](QJsonValue, const QString &error) {
            logoutButton_->setEnabled(true);
            if (!error.isEmpty()) {
                showError(error);
                return;
            }
            loadSnapshot();
        });
    });
    connect(rooms_, &QListWidget::currentItemChanged, this,
            [this](QListWidgetItem *item, QListWidgetItem *) {
                switchRoom(item ? item->data(Qt::UserRole).toString() : QString());
                roomTitle_->setText(item ? item->text() : QStringLiteral("Select a room"));
                messages_->clear();
                updateActiveRoom(currentRoomID_);
                if (!currentRoomID_.isEmpty()) {
                    loadHistory(currentRoomID_);
                }
            });
    connect(sendButton_, &QPushButton::clicked, this, &MainWindow::sendMessage);
    connect(scheduleMessageButton_, &QPushButton::clicked, this, &MainWindow::scheduleMessage);
    connect(composer_, &QPlainTextEdit::textChanged, this, [this] {
        const bool ready = !currentRoomID_.isEmpty() && !composer_->toPlainText().trimmed().isEmpty();
        sendButton_->setEnabled(ready);
        scheduleMessageButton_->setEnabled(ready && editEventID_.isEmpty());
    });
    sendButton_->setEnabled(false);
}

void MainWindow::buildVerificationPage() {
    verificationPage_ = new QWidget(this);
    auto *outer = new QVBoxLayout(verificationPage_);
    outer->addStretch();
    auto *panel = new QWidget(verificationPage_);
    panel->setMaximumWidth(420);
    auto *form = new QFormLayout(panel);
    recoveryKey_ = new QLineEdit(panel);
    recoveryKey_->setEchoMode(QLineEdit::Password);
    recoveryKey_->setPlaceholderText(QStringLiteral("Recovery key or security passphrase"));
    form->addRow(QStringLiteral("Verify this device"), recoveryKey_);
    outer->addWidget(panel, 0, Qt::AlignHCenter);
    verifyButton_ = new QPushButton(QStringLiteral("Verify device"), verificationPage_);
    outer->addWidget(verifyButton_, 0, Qt::AlignHCenter);
    auto *error = new QLabel(verificationPage_);
    error->setWordWrap(true);
    error->setAlignment(Qt::AlignCenter);
    outer->addWidget(error, 0, Qt::AlignHCenter);
    outer->addStretch();
    pages_->addWidget(verificationPage_);

    connect(verifyButton_, &QPushButton::clicked, this, [this, error] {
        verifyButton_->setEnabled(false);
        error->clear();
        backend_->call(QStringLiteral("Verify"), {recoveryKey_->text()},
                       [this, error](QJsonValue, const QString &message) {
                           verifyButton_->setEnabled(true);
                           if (!message.isEmpty()) {
                               error->setText(message);
                               return;
                           }
                           recoveryKey_->clear();
                           loadSnapshot();
                       });
    });
}

void MainWindow::loadSnapshot() {
    backend_->call(QStringLiteral("Snapshot"), {}, [this](QJsonValue value, const QString &error) {
        if (!error.isEmpty()) {
            showError(error);
            return;
        }
        if (value.isObject()) {
            applySnapshot(value.toObject());
        }
    });
}

void MainWindow::applySnapshot(const QJsonObject &snapshot) {
    snapshot_ = snapshot;
    preferences_ = snapshot.value(QStringLiteral("preferences")).toObject();
    bool zoomOk = false;
    const int zoom = preferences_.value(QStringLiteral("appearance.zoom"))
                         .toString(QStringLiteral("100")).toInt(&zoomOk);
    QFont applicationFont = QApplication::font();
    applicationFont.setPointSizeF(10.0 * (zoomOk ? qBound(75, zoom, 125) : 100) / 100.0);
    QApplication::setFont(applicationFont);
    updateTrayIcon();
    if (!initialWindowStateApplied_) {
        initialWindowStateApplied_ = true;
        if (preferences_.value(QStringLiteral("window.start_minimized")).toBool()) {
            QTimer::singleShot(0, this, &QWidget::showMinimized);
        }
    }
    if (snapshot.value(QStringLiteral("needsVerification")).toBool()) {
        pages_->setCurrentWidget(verificationPage_);
        return;
    }
    if (!snapshot.value(QStringLiteral("loggedIn")).toBool()) {
        pages_->setCurrentWidget(loginPage_);
        return;
    }
    pages_->setCurrentWidget(chatPage_);
    {
        const QSignalBlocker accountBlocker(accountSwitcher_);
        const auto accounts = snapshot.value(QStringLiteral("accounts")).toArray();
        accountSwitcher_->clear();
        for (const auto &value : accounts) {
            const auto account = value.toObject();
            const auto profile = account.value(QStringLiteral("profile")).toObject();
            const QString accountID = account.value(QStringLiteral("id")).toString();
            QString label = profile.value(QStringLiteral("displayName")).toString();
            if (label.isEmpty()) {
                label = profile.value(QStringLiteral("userId")).toString();
            }
            accountSwitcher_->addItem(label, accountID);
            if (accountID == snapshot.value(QStringLiteral("activeAccountId")).toString()) {
                accountSwitcher_->setCurrentIndex(accountSwitcher_->count() - 1);
            }
        }
        accountSwitcher_->setVisible(accounts.size() > 1);
    }
    const auto inviteArray = snapshot.value(QStringLiteral("invites")).toArray();
    const bool hasInvites = !inviteArray.isEmpty();
    inviteLabel_->setVisible(hasInvites);
    invites_->setVisible(hasInvites);
    acceptInviteButton_->setVisible(hasInvites);
    declineInviteButton_->setVisible(hasInvites);
    const QSignalBlocker inviteBlocker(invites_);
    invites_->clear();
    for (const auto &value : inviteArray) {
        const auto invite = value.toObject();
        const QString name = invite.value(QStringLiteral("name")).toString(
            invite.value(QStringLiteral("roomId")).toString());
        auto *item = new QListWidgetItem(name, invites_);
        item->setData(Qt::UserRole, invite.value(QStringLiteral("roomId")).toString());
        item->setToolTip(invite.value(QStringLiteral("topic")).toString());
    }
    acceptInviteButton_->setEnabled(invites_->currentItem() != nullptr);
    declineInviteButton_->setEnabled(invites_->currentItem() != nullptr);
    filterRooms();
}

void MainWindow::filterRooms() {
    if (snapshot_.isEmpty()) {
        return;
    }
    const auto roomArray = snapshot_.value(QStringLiteral("rooms")).toArray();
    const QString scope = roomScope_->currentData().toString();
    const QString query = roomFilter_->text().trimmed();
    const QString selected = currentRoomID_;
    const QSignalBlocker blocker(rooms_);
    rooms_->clear();
    for (const auto &value : roomArray) {
        const auto room = value.toObject();
        const auto name = room.value(QStringLiteral("name")).toString();
        const auto roomID = room.value(QStringLiteral("id")).toString();
        const auto preview = room.value(QStringLiteral("preview")).toString();
        const int unread = room.value(QStringLiteral("unread")).toInt();
        const bool archived = roomIsArchived(room);
        const bool favorite = room.value(QStringLiteral("favorite")).toBool();
        const bool needsReply = room.value(QStringLiteral("needsReply")).toBool();
        const bool pending = roomID == pendingRoomID_;
        if (!query.isEmpty()
            && !name.contains(query, Qt::CaseInsensitive)
            && !roomID.contains(query, Qt::CaseInsensitive)
            && !preview.contains(query, Qt::CaseInsensitive)) {
            continue;
        }
        if (!pending && ((scope == QStringLiteral("archived") && !archived)
            || (scope != QStringLiteral("archived") && archived)
            || (scope == QStringLiteral("unanswered") && !room.value(QStringLiteral("unanswered")).toBool())
            || (scope == QStringLiteral("needs-reply") && !needsReply)
            || (scope == QStringLiteral("favorites") && !favorite))) {
            continue;
        }
        auto *item = new QListWidgetItem(unread > 0
                                             ? QStringLiteral("%1  (%2)").arg(name).arg(unread)
                                             : name,
                                         rooms_);
        item->setData(Qt::UserRole, roomID);
        item->setData(Qt::UserRole + 1, room.toVariantMap());
        item->setToolTip(room.value(QStringLiteral("topic")).toString());
        if (roomID == pendingRoomID_ || roomID == selected) {
            rooms_->setCurrentItem(item);
            if (roomID == pendingRoomID_) {
                pendingRoomID_.clear();
            }
        }
    }
    if (rooms_->currentItem() == nullptr && rooms_->count() > 0) {
        rooms_->setCurrentRow(0);
    }
    const auto *selectedItem = rooms_->currentItem();
    const QString nextRoomID = selectedItem ? selectedItem->data(Qt::UserRole).toString() : QString();
    const bool roomChanged = nextRoomID != selected;
    if (roomChanged) {
        switchRoom(nextRoomID);
    }
    roomTitle_->setText(selectedItem ? selectedItem->text() : QStringLiteral("Select a room"));
    if (roomChanged) {
        messages_->clear();
        if (!currentRoomID_.isEmpty()) {
            loadHistory(currentRoomID_);
        }
    }
    updateActiveRoom(currentRoomID_);
}

void MainWindow::switchRoom(const QString &roomID) {
    if (currentRoomID_ == roomID) {
        return;
    }
    if (!currentRoomID_.isEmpty()) {
        roomDrafts_.insert(currentRoomID_, composer_->toPlainText());
    }
    clearComposeContext();
    currentRoomID_ = roomID;
    composer_->setPlainText(roomDrafts_.take(roomID));
    sendButton_->setEnabled(!roomID.isEmpty() && !composer_->toPlainText().trimmed().isEmpty());
}

void MainWindow::updateActiveRoom(const QString &roomID) {
    if (activeRoomSubscription_ == roomID) {
        return;
    }
    activeRoomSubscription_ = roomID;
    backend_->call(QStringLiteral("SetActiveRoom"), {roomID},
                   [this](QJsonValue, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                       }
                   });
}

void MainWindow::loadHistory(const QString &roomID, qint64 before) {
    const quint64 requestID = ++historyRequestID_;
    historyBefore_ = before;
    backend_->call(QStringLiteral("History"), {roomID, before},
                   [this, roomID, before, requestID](QJsonValue value, const QString &error) {
        if (!error.isEmpty()) {
            if (requestID == historyRequestID_) {
                showError(error);
            }
            return;
        }
        if (requestID != historyRequestID_ || roomID != currentRoomID_ || !value.isObject()) {
            return;
        }
        messages_->clear();
        messagesByID_.clear();
        const auto messageArray = value.toObject().value(QStringLiteral("messages")).toArray();
        QSet<QString> loadedEventIDs;
        QHash<QString, int> threadReplyCounts;
        QHash<QString, QJsonObject> latestThreadReplies;
        for (const auto &entry : messageArray) {
            const auto message = entry.toObject();
            const auto eventID = message.value(QStringLiteral("id")).toString();
            if (!eventID.isEmpty()) {
                loadedEventIDs.insert(eventID);
            }
            const auto rootID = message.value(QStringLiteral("threadRootId")).toString();
            if (!rootID.isEmpty()) {
                threadReplyCounts[rootID] += 1;
                latestThreadReplies.insert(rootID, message);
            }
        }
        for (const auto &entry : messageArray) {
            const auto message = entry.toObject();
            const auto eventID = message.value(QStringLiteral("id")).toString();
            const auto rootID = message.value(QStringLiteral("threadRootId")).toString();
            if (!rootID.isEmpty() && loadedEventIDs.contains(rootID)) {
                continue;
            }
            const auto sender = message.value(QStringLiteral("senderName")).toString(
                message.value(QStringLiteral("sender")).toString());
            const auto body = message.value(QStringLiteral("body")).toString();
            const auto timestamp = QDateTime::fromMSecsSinceEpoch(
                static_cast<qint64>(message.value(QStringLiteral("timestamp")).toDouble()));
            QString display = QStringLiteral("%1  %2\n%3")
                                  .arg(timestamp.toLocalTime().toString(QStringLiteral("HH:mm")),
                                       sender, body);
            const auto reactions = message.value(QStringLiteral("reactions")).toObject();
            if (!reactions.isEmpty()) {
                QStringList reactionLabels;
                for (auto it = reactions.constBegin(); it != reactions.constEnd(); ++it) {
                    reactionLabels.append(QStringLiteral("%1 %2").arg(it.key()).arg(it.value().toInt()));
                }
                display += QStringLiteral("\n") + reactionLabels.join(QStringLiteral("  "));
            }
            const int replyCount = threadReplyCounts.value(eventID);
            if (replyCount > 0) {
                const auto latest = latestThreadReplies.value(eventID);
                const QString latestSender = latest.value(QStringLiteral("senderName")).toString(
                    latest.value(QStringLiteral("sender")).toString());
                display += QStringLiteral("\n\n%1 thread replies · latest: %2: %3")
                               .arg(replyCount)
                               .arg(latestSender, latest.value(QStringLiteral("body")).toString());
            }
            auto *item = new QListWidgetItem(display, messages_);
            item->setData(Qt::UserRole, eventID);
            item->setData(Qt::UserRole + 1, message.toVariantMap());
            messagesByID_.insert(eventID, message);
            const QString mime = message.value(QStringLiteral("mediaMime")).toString();
            if (!eventID.isEmpty() && mime.startsWith(QStringLiteral("image/"))
                && message.value(QStringLiteral("decryptionError")).toString().isEmpty()
                && !message.value(QStringLiteral("redacted")).toBool()) {
                const QString url = media_->mediaUrl(QStringLiteral("matrix"), roomID, eventID);
                QPointer<QListWidget> guardedMessages(messages_);
                media_->fetch(url, [guardedMessages, eventID](bool ok, const QByteArray &data,
                                                               const QString &) {
                    if (!ok || !guardedMessages) {
                        return;
                    }
                    const QPixmap preview = QPixmap::fromImage(QImage::fromData(data));
                    if (preview.isNull()) {
                        return;
                    }
                    for (int index = 0; index < guardedMessages->count(); ++index) {
                        auto *current = guardedMessages->item(index);
                        if (current->data(Qt::UserRole).toString() == eventID) {
                            current->setIcon(QIcon(preview.scaled(96, 72, Qt::KeepAspectRatio,
                                                                  Qt::SmoothTransformation)));
                            guardedMessages->doItemsLayout();
                            break;
                        }
                    }
                });
            }
        }
        messages_->scrollToBottom();
        const auto room = roomByID(roomID);
        const auto eventID = room.value(QStringLiteral("lastEventId")).toString();
        const bool unread = room.value(QStringLiteral("unread")).toInt() > 0
                            || room.value(QStringLiteral("markedUnread")).toBool();
        if (before == 0 && unread && !eventID.isEmpty() && readRequests_.value(roomID) != eventID) {
            readRequests_.insert(roomID, eventID);
            backend_->call(QStringLiteral("MarkRead"), {roomID, eventID},
                           [this, roomID, eventID](QJsonValue, const QString &error) {
                               if (!error.isEmpty()) {
                                   if (readRequests_.value(roomID) == eventID) {
                                       readRequests_.remove(roomID);
                                   }
                                   showError(error);
                               }
                           });
        }
    });
}

void MainWindow::sendMessage() {
    const QString text = composer_->toPlainText().trimmed();
    if (currentRoomID_.isEmpty() || text.isEmpty()) {
        return;
    }
    sendButton_->setEnabled(false);
    const QString method = editEventID_.isEmpty()
                               ? (replyToEventID_.isEmpty() ? QStringLiteral("SendMessage")
                                                            : QStringLiteral("SendReply"))
                               : QStringLiteral("EditMessage");
    QJsonArray params{currentRoomID_, text};
    if (!editEventID_.isEmpty()) {
        params.append(editEventID_);
    } else if (!replyToEventID_.isEmpty()) {
        params.append(replyToEventID_);
    }
    backend_->call(method, params,
                   [this](QJsonValue, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                       } else {
                           composer_->clear();
                           clearComposeContext();
                           loadHistory(currentRoomID_);
                       }
                       sendButton_->setEnabled(!currentRoomID_.isEmpty() &&
                                               !composer_->toPlainText().trimmed().isEmpty());
                   });
}

void MainWindow::attachFile() {
    if (currentRoomID_.isEmpty()) {
        return;
    }
    const QString path = QFileDialog::getOpenFileName(this, QStringLiteral("Attach file"));
    if (path.isEmpty()) {
        return;
    }
    QFile file(path);
    if (!file.open(QIODevice::ReadOnly)) {
        showError(file.errorString());
        return;
    }
    constexpr qint64 maximumAttachmentBytes = 50LL * 1024 * 1024;
    if (file.size() <= 0 || file.size() > maximumAttachmentBytes) {
        showError(file.size() <= 0
                      ? QStringLiteral("The selected file is empty.")
                      : QStringLiteral("Attachments cannot exceed 50 MiB."));
        return;
    }
    const QByteArray data = file.readAll();
    if (data.size() != file.size()) {
        showError(file.errorString().isEmpty()
                      ? QStringLiteral("The selected file could not be read completely.")
                      : file.errorString());
        return;
    }
    const QString roomID = currentRoomID_;
    attachButton_->setEnabled(false);
    statusBar()->showMessage(QStringLiteral("Uploading %1…").arg(QFileInfo(path).fileName()));
    media_->uploadAttachment(roomID, QFileInfo(path).fileName(), data, false, false, 0,
                             [this, roomID](bool ok, const QString &error) {
        attachButton_->setEnabled(true);
        if (!ok) {
            showError(error);
            return;
        }
        statusBar()->showMessage(QStringLiteral("Attachment sent."), 5000);
        if (currentRoomID_ == roomID) {
            loadHistory(roomID);
        }
    });
}

void MainWindow::showMessageContextMenu(const QPoint &position) {
    auto *item = messages_->itemAt(position);
    if (!item) {
        return;
    }
    const QString eventID = item->data(Qt::UserRole).toString();
    const auto message = messagesByID_.value(eventID);
    if (message.isEmpty()) {
        return;
    }
    const bool own = message.value(QStringLiteral("own")).toBool();
    const bool hasTransaction = !message.value(QStringLiteral("transactionId")).toString().isEmpty();
    QMenu menu(this);
    const QAction *const reply = menu.addAction(QStringLiteral("Reply"));
    QAction *const thread = menu.addAction(QStringLiteral("Reply in thread"));
    thread->setEnabled(eventID.startsWith(QLatin1Char('$'))
                       && !message.value(QStringLiteral("sending")).toBool());
    QAction *const reminder = menu.addAction(QStringLiteral("Set reminder…"));
    reminder->setEnabled(eventID.startsWith(QLatin1Char('$'))
                         && !message.value(QStringLiteral("redacted")).toBool());
    const QAction *const react = menu.addAction(QStringLiteral("Add reaction…"));
    const QAction *const copy = menu.addAction(QStringLiteral("Copy text"));
    const QAction *const saveMediaAction =
        !message.value(QStringLiteral("mediaUri")).toString().isEmpty()
            && !message.value(QStringLiteral("redacted")).toBool()
            && message.value(QStringLiteral("decryptionError")).toString().isEmpty()
        ? menu.addAction(QStringLiteral("Save attachment…"))
        : nullptr;
    const QAction *const openMediaAction = saveMediaAction
        ? menu.addAction(QStringLiteral("Open with system app…"))
        : nullptr;
    const QString mediaURI = message.value(QStringLiteral("mediaUri")).toString();
    const QString mediaType = message.value(QStringLiteral("mediaType")).toString();
    const QString mediaMIME = message.value(QStringLiteral("mediaMime")).toString();
    const bool audioAttachment = !mediaURI.isEmpty()
        && (mediaType == QStringLiteral("m.audio") || mediaMIME.startsWith(QStringLiteral("audio/")));
    const QAction *const transcribeAction = audioAttachment
        ? menu.addAction(QStringLiteral("Transcribe with AI…"))
        : nullptr;
    const QAction *const edit = own ? menu.addAction(QStringLiteral("Edit")) : nullptr;
    const QAction *const redact = own ? menu.addAction(QStringLiteral("Delete")) : nullptr;
    const QAction *const retry = hasTransaction && !message.value(QStringLiteral("sendError")).toString().isEmpty()
                                    ? menu.addAction(QStringLiteral("Retry sending"))
                                    : nullptr;
    auto *chosen = menu.exec(messages_->viewport()->mapToGlobal(position));
    const QString body = message.value(QStringLiteral("body")).toString();
    if (chosen == reply) {
        editEventID_.clear();
        replyToEventID_ = eventID;
        composer_->clear();
        setComposeContext(QStringLiteral("Replying to %1: %2")
                              .arg(message.value(QStringLiteral("senderName")).toString(), body));
        composer_->setFocus();
    } else if (chosen == thread) {
        const QString rootID = message.value(QStringLiteral("threadRootId")).toString();
        openThread(rootID.isEmpty() ? eventID : rootID);
    } else if (chosen == reminder) {
        scheduleReminder(eventID);
    } else if (chosen == react) {
        bool accepted = false;
        const QString emoji = QInputDialog::getText(
            this, QStringLiteral("Add reaction"), QStringLiteral("Emoji"),
            QLineEdit::Normal, QStringLiteral("👍"), &accepted).trimmed();
        if (accepted && !emoji.isEmpty()) {
            runMessageAction(QStringLiteral("React"), {currentRoomID_, eventID, emoji});
        }
    } else if (chosen == copy) {
        QGuiApplication::clipboard()->setText(body);
    } else if (chosen == saveMediaAction) {
        saveMedia(message);
    } else if (chosen == openMediaAction) {
        saveMedia(message, true);
    } else if (chosen == transcribeAction) {
        const QString roomID = currentRoomID_;
        QString filename = message.value(QStringLiteral("body")).toString().trimmed();
        if (filename.isEmpty()) {
            filename = QStringLiteral("audio-attachment");
        }
        const QString contentType = mediaMIME.isEmpty() ? QStringLiteral("audio/ogg") : mediaMIME;
        statusBar()->showMessage(QStringLiteral("Transcribing audio…"));
        backend_->call(QStringLiteral("AITranscribeMedia"), {mediaURI, filename, contentType},
                       [this, roomID](QJsonValue value, const QString &error) {
                           if (!error.isEmpty()) {
                               showError(error);
                               return;
                           }
                           const QString transcript = value.toString().trimmed();
                           if (transcript.isEmpty()) {
                               statusBar()->showMessage(QStringLiteral("No speech was detected."), 8000);
                               return;
                           }
                           if (currentRoomID_ != roomID) {
                               statusBar()->showMessage(
                                   QStringLiteral("Transcription is ready, but the active room changed."), 8000);
                               return;
                           }
                           composer_->setPlainText(transcript);
                           composer_->setFocus();
                           statusBar()->showMessage(
                               QStringLiteral("Transcript added to the composer as a draft."), 8000);
                       });
    } else if (chosen == edit) {
        replyToEventID_.clear();
        editEventID_ = eventID;
        composer_->setPlainText(body);
        setComposeContext(QStringLiteral("Editing your message"));
        composer_->setFocus();
    } else if (chosen == redact) {
        if (QMessageBox::question(this, QStringLiteral("Delete message"),
                                  QStringLiteral("Delete this message for everyone?"))
            == QMessageBox::Yes) {
            runMessageAction(QStringLiteral("RedactMessage"), {currentRoomID_, eventID});
        }
    } else if (chosen == retry) {
        runMessageAction(QStringLiteral("RetryMessage"),
                         {message.value(QStringLiteral("transactionId")).toString()});
    }
}

void MainWindow::runMessageAction(const QString &method, const QJsonArray &params) {
    backend_->call(method, params, [this](QJsonValue, const QString &error) {
        if (!error.isEmpty()) {
            showError(error);
            return;
        }
        loadHistory(currentRoomID_);
        loadSnapshot();
    });
}

void MainWindow::setComposeContext(const QString &label) {
    composeContext_->setText(label);
    composeContext_->show();
    cancelComposeContextButton_->show();
    sendButton_->setText(editEventID_.isEmpty() ? QStringLiteral("Send")
                                                : QStringLiteral("Save edit"));
    sendButton_->setEnabled(!composer_->toPlainText().trimmed().isEmpty());
    scheduleMessageButton_->setEnabled(!currentRoomID_.isEmpty() && editEventID_.isEmpty()
                                       && !composer_->toPlainText().trimmed().isEmpty());
}

void MainWindow::clearComposeContext() {
    replyToEventID_.clear();
    editEventID_.clear();
    composeContext_->clear();
    composeContext_->hide();
    cancelComposeContextButton_->hide();
    sendButton_->setText(QStringLiteral("Send"));
    sendButton_->setEnabled(!currentRoomID_.isEmpty() && !composer_->toPlainText().trimmed().isEmpty());
    scheduleMessageButton_->setEnabled(!currentRoomID_.isEmpty()
                                       && !composer_->toPlainText().trimmed().isEmpty());
}

void MainWindow::updateRoomFilter(const QString &filter) {
    Q_UNUSED(filter);
    filterRooms();
}

void MainWindow::showRoomContextMenu(const QPoint &position) {
    auto *item = rooms_->itemAt(position);
    if (!item) {
        return;
    }
    rooms_->setCurrentItem(item);
    const auto room = roomByID(item->data(Qt::UserRole).toString());
    const bool archived = roomIsArchived(room);
    const bool favorite = room.value(QStringLiteral("favorite")).toBool();
    const bool muted = room.value(QStringLiteral("muted")).toBool();
    const bool needsReply = room.value(QStringLiteral("needsReply")).toBool();
    const bool unread = room.value(QStringLiteral("unread")).toInt() > 0
                        || room.value(QStringLiteral("markedUnread")).toBool();

    QMenu menu(this);
    auto *markRead = menu.addAction(QStringLiteral("Mark read"));
    auto *markUnread = menu.addAction(QStringLiteral("Mark unread"));
    auto *markAnswered = menu.addAction(QStringLiteral("Mark answered"));
    auto *favoriteAction = menu.addAction(favorite ? QStringLiteral("Remove from Favorites")
                                                   : QStringLiteral("Add to Favorites"));
    auto *muteAction = menu.addAction(muted ? QStringLiteral("Unmute room")
                                            : QStringLiteral("Mute room"));
    auto *archiveAction = menu.addAction(archived ? QStringLiteral("Restore room")
                                                  : QStringLiteral("Archive room"));
    auto *detailsAction = menu.addAction(QStringLiteral("Room details…"));
    auto *galleryAction = menu.addAction(QStringLiteral("Media gallery…"));
    auto *exportAction = menu.addAction(QStringLiteral("Export chat…"));
    markRead->setEnabled(unread && !room.value(QStringLiteral("lastEventId")).toString().isEmpty());
    markUnread->setEnabled(!unread);
    markAnswered->setEnabled(needsReply);

    auto *chosen = menu.exec(rooms_->viewport()->mapToGlobal(position));
    const QString roomID = room.value(QStringLiteral("id")).toString();
    if (chosen == markRead) {
        runRoomAction(QStringLiteral("MarkRead"),
                      {roomID, room.value(QStringLiteral("lastEventId")).toString()});
    } else if (chosen == markUnread) {
        runRoomAction(QStringLiteral("MarkUnread"), {roomID});
    } else if (chosen == markAnswered) {
        runRoomAction(QStringLiteral("SetRoomUnanswered"), {roomID, false});
    } else if (chosen == favoriteAction) {
        runRoomAction(QStringLiteral("SetBooleanPreference"),
                      {QStringLiteral("room.favorite.") + roomID, !favorite});
    } else if (chosen == muteAction) {
        runRoomAction(QStringLiteral("SetBooleanPreference"),
                      {QStringLiteral("room.muted.") + roomID, !muted});
    } else if (chosen == archiveAction) {
        const auto key = archivePreferenceKey(room);
        const bool archive = !archived;
        auto saveArchive = [this, key, archive] {
            runRoomAction(QStringLiteral("SetBooleanPreference"), {key, archive});
        };
        const QString lastEventID = room.value(QStringLiteral("lastEventId")).toString();
        if (archive && unread && !lastEventID.isEmpty()) {
            backend_->call(QStringLiteral("MarkRead"), {roomID, lastEventID},
                           [this, saveArchive](QJsonValue, const QString &error) {
                               if (!error.isEmpty()) {
                                   showError(error);
                                   return;
                               }
                               saveArchive();
                           });
        } else {
            saveArchive();
        }
    } else if (chosen == detailsAction) {
        showRoomDetails(roomID);
    } else if (chosen == galleryAction) {
        showMediaGallery(roomID);
    } else if (chosen == exportAction) {
        exportRoomChat(roomID);
    }
}

void MainWindow::saveMedia(const QJsonObject &message, bool openAfterSave) {
    const QString mediaURI = message.value(QStringLiteral("mediaUri")).toString();
    if (mediaURI.isEmpty()) {
        return;
    }
    QString filename = message.value(QStringLiteral("body")).toString().trimmed();
    if (filename.isEmpty()) {
        filename = QStringLiteral("matrix-attachment");
    }
    backend_->call(QStringLiteral("SaveMedia"), {mediaURI, filename},
                   [this, openAfterSave](QJsonValue value, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       const QString path = value.toString();
                       if (path.isEmpty()) {
                           statusBar()->showMessage(QStringLiteral("Saving attachment was cancelled."), 5000);
                           return;
                       }
                       if (openAfterSave) {
                           if (!QDesktopServices::openUrl(QUrl::fromLocalFile(path))) {
                               showError(QStringLiteral("The saved attachment could not be opened."));
                           }
                           return;
                       }
                       QMessageBox saved(QMessageBox::Information, QStringLiteral("Attachment saved"),
                                         QStringLiteral("Saved to %1").arg(path),
                                         QMessageBox::Ok | QMessageBox::Open, this);
                       saved.button(QMessageBox::Open)->setText(QStringLiteral("Show in folder"));
                       if (saved.exec() == QMessageBox::Open) {
                           backend_->call(QStringLiteral("RevealFile"), {path},
                                          [this](QJsonValue, const QString &revealError) {
                                              if (!revealError.isEmpty()) {
                                                  showError(revealError);
                                              }
                                          });
                       }
                   });
}

void MainWindow::openMediaPreview(const QString &eventID) {
    const QJsonObject message = messagesByID_.value(eventID);
    const QString mime = message.value(QStringLiteral("mediaMime")).toString();
    if (mime.isEmpty() || !mime.startsWith(QStringLiteral("image/"))
        || message.value(QStringLiteral("redacted")).toBool()
        || !message.value(QStringLiteral("decryptionError")).toString().isEmpty()) {
        return;
    }
    const QString url = media_->mediaUrl(QStringLiteral("matrix"), currentRoomID_, eventID);
    const QPointer<MainWindow> guardedWindow(this);
    media_->fetch(url, [guardedWindow](bool ok, const QByteArray &data, const QString &error) {
        if (!guardedWindow) {
            return;
        }
        if (!ok) {
            guardedWindow->showError(error);
            return;
        }
        const QPixmap image = QPixmap::fromImage(QImage::fromData(data));
        if (image.isNull()) {
            guardedWindow->showError(QStringLiteral("The image could not be decoded."));
            return;
        }
        QDialog dialog(guardedWindow);
        dialog.setWindowTitle(QStringLiteral("Image preview"));
        dialog.resize(900, 680);
        auto *layout = new QVBoxLayout(&dialog);
        auto *preview = new QLabel(&dialog);
        preview->setAlignment(Qt::AlignCenter);
        preview->setPixmap(image.scaled(dialog.size(), Qt::KeepAspectRatio,
                                        Qt::SmoothTransformation));
        layout->addWidget(preview);
        dialog.exec();
    });
}

void MainWindow::showMediaGallery(const QString &roomID) {
    if (roomID.isEmpty()) {
        return;
    }
    auto *dialog = new QDialog(this);
    dialog->setAttribute(Qt::WA_DeleteOnClose);
    dialog->setWindowTitle(QStringLiteral("Media gallery"));
    dialog->resize(680, 520);
    auto *layout = new QVBoxLayout(dialog);
    auto *status = new QLabel(QStringLiteral("Loading room media…"), dialog);
    auto *items = new QListWidget(dialog);
    auto *actions = new QHBoxLayout;
    auto *saveButton = new QPushButton(QStringLiteral("Save attachment…"), dialog);
    auto *closeButton = new QPushButton(QStringLiteral("Close"), dialog);
    saveButton->setEnabled(false);
    actions->addStretch();
    actions->addWidget(saveButton);
    actions->addWidget(closeButton);
    layout->addWidget(status);
    layout->addWidget(items, 1);
    layout->addLayout(actions);

    QPointer<QDialog> guardedDialog(dialog);
    QPointer<QLabel> guardedStatus(status);
    QPointer<QListWidget> guardedItems(items);
    QPointer<QPushButton> guardedSave(saveButton);
    connect(closeButton, &QPushButton::clicked, dialog, &QDialog::close);
    connect(items, &QListWidget::currentItemChanged, dialog,
            [guardedSave](QListWidgetItem *item, QListWidgetItem *) {
                if (guardedSave) {
                    guardedSave->setEnabled(item != nullptr);
                }
            });
    const auto saveSelected = [this, guardedItems] {
        if (!guardedItems || !guardedItems->currentItem()) {
            return;
        }
        const auto json = guardedItems->currentItem()->data(Qt::UserRole).toString().toUtf8();
        const auto document = QJsonDocument::fromJson(json);
        if (!document.isObject()) {
            showError(QStringLiteral("The selected media item is invalid."));
            return;
        }
        saveMedia(document.object());
    };
    connect(saveButton, &QPushButton::clicked, dialog, saveSelected);
    connect(items, &QListWidget::itemDoubleClicked, dialog,
            [saveSelected](QListWidgetItem *) { saveSelected(); });

    auto seen = std::make_shared<QSet<QString>>();
    auto loader = std::make_shared<std::function<void(qint64, qint64)>>();
    const std::weak_ptr<std::function<void(qint64, qint64)>> weakLoader = loader;
    *loader = [this, roomID, guardedDialog, guardedStatus, guardedItems, seen, weakLoader]
              (qint64 before, qint64 previousCursor) {
        if (!guardedDialog || !guardedStatus || !guardedItems) {
            return;
        }
        const auto keepAlive = weakLoader.lock();
        backend_->call(QStringLiteral("History"), {roomID, before},
                       [this, roomID, guardedDialog, guardedStatus, guardedItems, seen,
                        keepAlive, before, previousCursor](QJsonValue value, const QString &error) {
                           if (!guardedDialog || !guardedStatus || !guardedItems) {
                               return;
                           }
                           if (!error.isEmpty()) {
                               guardedStatus->setText(error);
                               return;
                           }
                           if (!value.isObject()) {
                               guardedStatus->setText(QStringLiteral("The backend returned an invalid history page."));
                               return;
                           }
                           const auto page = value.toObject();
                           for (const auto &entry : page.value(QStringLiteral("messages")).toArray()) {
                               const auto message = entry.toObject();
                               const QString mediaURI = message.value(QStringLiteral("mediaUri")).toString();
                               const QString eventID = message.value(QStringLiteral("id")).toString();
                               if (mediaURI.isEmpty() || message.value(QStringLiteral("redacted")).toBool()
                                   || !message.value(QStringLiteral("decryptionError")).toString().isEmpty()
                                   || (!eventID.isEmpty() && seen->contains(eventID))) {
                                   continue;
                               }
                               if (!eventID.isEmpty()) {
                                   seen->insert(eventID);
                               }
                               const QString filename = message.value(QStringLiteral("body")).toString().trimmed();
                               const QString sender = message.value(QStringLiteral("senderName")).toString(
                                   message.value(QStringLiteral("sender")).toString());
                               const qint64 timestamp = static_cast<qint64>(
                                   message.value(QStringLiteral("timestamp")).toDouble());
                               const QString label = QStringLiteral("%1 · %2\n%3")
                                   .arg(filename.isEmpty() ? QStringLiteral("Attachment") : filename,
                                        sender,
                                        timestamp > 0
                                            ? QDateTime::fromMSecsSinceEpoch(timestamp).toLocalTime()
                                                  .toString(QStringLiteral("yyyy-MM-dd HH:mm"))
                                            : QString());
                               auto *item = new QListWidgetItem(label, guardedItems);
                               item->setData(Qt::UserRole,
                                             QString::fromUtf8(QJsonDocument(message).toJson(
                                                 QJsonDocument::Compact)));
                               item->setToolTip(message.value(QStringLiteral("mediaMime")).toString());
                           }
                           const qint64 cursor = static_cast<qint64>(
                               page.value(QStringLiteral("before")).toDouble());
                           const bool more = page.value(QStringLiteral("hasMore")).toBool()
                               && cursor > 0 && (before == 0 || cursor < before)
                               && cursor != previousCursor;
                           if (more) {
                               guardedStatus->setText(
                                   QStringLiteral("Loading room media… %1 items found")
                                       .arg(guardedItems->count()));
                               if (keepAlive) {
                                   (*keepAlive)(cursor, cursor);
                               }
                               return;
                           }
                           guardedStatus->setText(guardedItems->count() == 0
                               ? QStringLiteral("No media attachments in this room.")
                               : QStringLiteral("%1 media attachments").arg(guardedItems->count()));
                       });
    };
    dialog->show();
    (*loader)(0, -1);
}

void MainWindow::exportRoomChat(const QString &roomID) {
    if (roomID.isEmpty()) {
        return;
    }
    const QString directory = QFileDialog::getExistingDirectory(
        this, QStringLiteral("Choose chat export folder"));
    if (directory.isEmpty()) {
        return;
    }
    auto *dialog = new QDialog(this);
    dialog->setAttribute(Qt::WA_DeleteOnClose);
    dialog->setWindowTitle(QStringLiteral("Export chat"));
    dialog->setModal(true);
    auto *layout = new QVBoxLayout(dialog);
    auto *status = new QLabel(QStringLiteral("Preparing chat export…"), dialog);
    auto *cancelButton = new QPushButton(QStringLiteral("Cancel export"), dialog);
    auto *closeButton = new QPushButton(QStringLiteral("Close"), dialog);
    closeButton->setEnabled(false);
    auto *buttons = new QHBoxLayout;
    buttons->addStretch();
    buttons->addWidget(cancelButton);
    buttons->addWidget(closeButton);
    layout->addWidget(status);
    layout->addLayout(buttons);

    QPointer<QDialog> guardedDialog(dialog);
    QPointer<QLabel> guardedStatus(status);
    QPointer<QPushButton> guardedCancel(cancelButton);
    QPointer<QPushButton> guardedClose(closeButton);
    connect(closeButton, &QPushButton::clicked, dialog, &QDialog::close);
    connect(cancelButton, &QPushButton::clicked, dialog, [this, guardedStatus, guardedCancel] {
        if (!guardedStatus || !guardedCancel) {
            return;
        }
        guardedCancel->setEnabled(false);
        guardedStatus->setText(QStringLiteral("Cancelling export…"));
        backend_->call(QStringLiteral("CancelChatExport"), {},
                       [this, guardedStatus](QJsonValue result, const QString &error) {
                           if (!guardedStatus) {
                               return;
                           }
                           if (!error.isEmpty()) {
                               guardedStatus->setText(error);
                           } else if (!result.toBool()) {
                               guardedStatus->setText(QStringLiteral("No export is currently running."));
                           }
                       });
    });
    dialog->show();
    backend_->call(QStringLiteral("ExportRoomChat"), {roomID, directory},
                   [this, guardedDialog, guardedStatus, guardedCancel, guardedClose]
                   (QJsonValue result, const QString &error) {
                       if (!guardedDialog || !guardedStatus || !guardedCancel || !guardedClose) {
                           return;
                       }
                       guardedCancel->setEnabled(false);
                       guardedClose->setEnabled(true);
                       if (!error.isEmpty()) {
                           guardedStatus->setText(error);
                           return;
                       }
                       const auto exportResult = result.toObject();
                       const QString path = exportResult.value(QStringLiteral("path")).toString();
                       guardedStatus->setText(QStringLiteral("Exported %1 messages to %2")
                           .arg(exportResult.value(QStringLiteral("messages")).toInt())
                           .arg(path));
                       statusBar()->showMessage(QStringLiteral("Chat export saved to %1").arg(path), 10000);
                   });
}

void MainWindow::joinRoom() {
    bool accepted = false;
    const QString target = QInputDialog::getText(
        this, QStringLiteral("Join a room"), QStringLiteral("Room alias, ID, or matrix.to link"),
        QLineEdit::Normal, {}, &accepted).trimmed();
    if (!accepted || target.isEmpty()) {
        return;
    }
    joinRoomButton_->setEnabled(false);
    backend_->call(QStringLiteral("JoinRoom"), {target},
                   [this](QJsonValue result, const QString &error) {
                       joinRoomButton_->setEnabled(true);
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       pendingRoomID_ = result.toString();
                       loadSnapshot();
                   });
}

void MainWindow::scheduleMessage() {
    const QString text = composer_->toPlainText().trimmed();
    if (currentRoomID_.isEmpty() || text.isEmpty() || !editEventID_.isEmpty()) {
        return;
    }
    const QString roomID = currentRoomID_;
    const QString replyTo = replyToEventID_;
    const auto room = roomByID(roomID);
    auto *dialog = new QDialog(this);
    dialog->setAttribute(Qt::WA_DeleteOnClose);
    dialog->setModal(true);
    dialog->setWindowTitle(replyTo.isEmpty() ? QStringLiteral("Schedule message")
                                            : QStringLiteral("Schedule reply"));
    auto *layout = new QVBoxLayout(dialog);
    auto *target = new QLabel(QStringLiteral("To %1").arg(
        room.value(QStringLiteral("name")).toString(roomID)), dialog);
    auto *preview = new QLabel(text, dialog);
    preview->setWordWrap(true);
    auto *dueAt = new QDateTimeEdit(QDateTime::currentDateTime().addSecs(300), dialog);
    dueAt->setCalendarPopup(true);
    dueAt->setDisplayFormat(QStringLiteral("yyyy-MM-dd HH:mm"));
    dueAt->setMinimumDateTime(QDateTime::currentDateTime().addSecs(1));
    auto *status = new QLabel(dialog);
    auto *buttons = new QHBoxLayout;
    auto *cancelButton = new QPushButton(QStringLiteral("Cancel"), dialog);
    auto *scheduleButton = new QPushButton(QStringLiteral("Schedule"), dialog);
    buttons->addStretch();
    buttons->addWidget(cancelButton);
    buttons->addWidget(scheduleButton);
    layout->addWidget(target);
    layout->addWidget(preview);
    layout->addWidget(new QLabel(QStringLiteral("Send at"), dialog));
    layout->addWidget(dueAt);
    layout->addWidget(status);
    layout->addLayout(buttons);

    QPointer<QDialog> guardedDialog(dialog);
    QPointer<QDateTimeEdit> guardedDueAt(dueAt);
    QPointer<QLabel> guardedStatus(status);
    QPointer<QPushButton> guardedSchedule(scheduleButton);
    connect(cancelButton, &QPushButton::clicked, dialog, &QDialog::reject);
    connect(scheduleButton, &QPushButton::clicked, dialog,
            [this, roomID, text, replyTo, guardedDialog, guardedDueAt, guardedStatus, guardedSchedule] {
                if (!guardedDialog || !guardedDueAt || !guardedStatus || !guardedSchedule) {
                    return;
                }
                const QDateTime when = guardedDueAt->dateTime();
                if (when <= QDateTime::currentDateTime()) {
                    guardedStatus->setText(QStringLiteral("Choose a time in the future."));
                    return;
                }
                guardedSchedule->setEnabled(false);
                guardedStatus->setText(QStringLiteral("Scheduling…"));
                const QJsonArray params = replyTo.isEmpty()
                    ? QJsonArray{roomID, text, when.toMSecsSinceEpoch()}
                    : QJsonArray{roomID, text, replyTo, when.toMSecsSinceEpoch()};
                backend_->call(replyTo.isEmpty() ? QStringLiteral("ScheduleMessage")
                                                 : QStringLiteral("ScheduleReply"),
                               params, [this, roomID, guardedDialog, guardedStatus, guardedSchedule]
                               (QJsonValue, const QString &error) {
                                   if (!guardedDialog || !guardedStatus || !guardedSchedule) {
                                       return;
                                   }
                                   if (!error.isEmpty()) {
                                       guardedStatus->setText(error);
                                       guardedSchedule->setEnabled(true);
                                       return;
                                   }
                                   roomDrafts_.remove(roomID);
                                   if (currentRoomID_ == roomID) {
                                       composer_->clear();
                                       clearComposeContext();
                                   }
                                   guardedDialog->accept();
                                   statusBar()->showMessage(QStringLiteral("Message scheduled."), 8000);
                               });
            });
    dialog->show();
}

void MainWindow::scheduleReminder(const QString &eventID) {
    if (currentRoomID_.isEmpty() || eventID.isEmpty()) {
        return;
    }
    const QString roomID = currentRoomID_;
    const auto room = roomByID(roomID);
    auto *dialog = new QDialog(this);
    dialog->setAttribute(Qt::WA_DeleteOnClose);
    dialog->setModal(true);
    dialog->setWindowTitle(QStringLiteral("Set reminder"));
    auto *layout = new QVBoxLayout(dialog);
    auto *target = new QLabel(QStringLiteral("Reminder for %1").arg(
        room.value(QStringLiteral("name")).toString(roomID)), dialog);
    auto *note = new QLineEdit(dialog);
    note->setPlaceholderText(QStringLiteral("Optional note"));
    auto *dueAt = new QDateTimeEdit(QDateTime::currentDateTime().addSecs(3600), dialog);
    dueAt->setCalendarPopup(true);
    dueAt->setDisplayFormat(QStringLiteral("yyyy-MM-dd HH:mm"));
    dueAt->setMinimumDateTime(QDateTime::currentDateTime().addSecs(1));
    auto *archive = new QCheckBox(QStringLiteral("Archive this room after setting the reminder"), dialog);
    auto *status = new QLabel(dialog);
    auto *buttons = new QHBoxLayout;
    auto *cancelButton = new QPushButton(QStringLiteral("Cancel"), dialog);
    auto *scheduleButton = new QPushButton(QStringLiteral("Set reminder"), dialog);
    buttons->addStretch();
    buttons->addWidget(cancelButton);
    buttons->addWidget(scheduleButton);
    layout->addWidget(target);
    layout->addWidget(note);
    layout->addWidget(new QLabel(QStringLiteral("Remind me at"), dialog));
    layout->addWidget(dueAt);
    layout->addWidget(archive);
    layout->addWidget(status);
    layout->addLayout(buttons);

    QPointer<QDialog> guardedDialog(dialog);
    QPointer<QLineEdit> guardedNote(note);
    QPointer<QDateTimeEdit> guardedDueAt(dueAt);
    QPointer<QCheckBox> guardedArchive(archive);
    QPointer<QLabel> guardedStatus(status);
    QPointer<QPushButton> guardedSchedule(scheduleButton);
    connect(cancelButton, &QPushButton::clicked, dialog, &QDialog::reject);
    connect(scheduleButton, &QPushButton::clicked, dialog,
            [this, roomID, eventID, guardedDialog, guardedNote, guardedDueAt, guardedArchive,
             guardedStatus, guardedSchedule] {
                if (!guardedDialog || !guardedNote || !guardedDueAt || !guardedArchive
                    || !guardedStatus || !guardedSchedule) {
                    return;
                }
                const QDateTime when = guardedDueAt->dateTime();
                if (when <= QDateTime::currentDateTime()) {
                    guardedStatus->setText(QStringLiteral("Choose a time in the future."));
                    return;
                }
                guardedSchedule->setEnabled(false);
                guardedStatus->setText(QStringLiteral("Setting reminder…"));
                backend_->call(QStringLiteral("ScheduleReminder"),
                               {roomID, eventID, guardedNote->text().trimmed(), when.toMSecsSinceEpoch()},
                               [this, roomID, guardedDialog, guardedArchive, guardedStatus, guardedSchedule]
                               (QJsonValue, const QString &error) {
                                   if (!guardedDialog || !guardedArchive || !guardedStatus || !guardedSchedule) {
                                       return;
                                   }
                                   if (!error.isEmpty()) {
                                       guardedStatus->setText(error);
                                       guardedSchedule->setEnabled(true);
                                       return;
                                   }
                                   const bool archiveRoom = guardedArchive->isChecked();
                                   guardedDialog->accept();
                                   statusBar()->showMessage(QStringLiteral("Reminder scheduled."), 8000);
                                   if (!archiveRoom) {
                                       return;
                                   }
                                   const QString key = archivePreferenceKey(roomByID(roomID));
                                   backend_->call(QStringLiteral("SetBooleanPreference"), {key, true},
                                                  [this](QJsonValue, const QString &archiveError) {
                                                      if (!archiveError.isEmpty()) {
                                                          showError(QStringLiteral("Reminder set, but the room could not be archived: %1")
                                                                        .arg(archiveError));
                                                          return;
                                                      }
                                                      loadSnapshot();
                                                  });
                               });
            });
    dialog->show();
}

void MainWindow::openScheduledJobs() {
    auto *dialog = new QDialog(this);
    dialog->setAttribute(Qt::WA_DeleteOnClose);
    dialog->setModal(true);
    dialog->setWindowTitle(QStringLiteral("Scheduled messages and reminders"));
    dialog->resize(620, 520);
    auto *layout = new QVBoxLayout(dialog);
    auto *status = new QLabel(QStringLiteral("Loading scheduled jobs…"), dialog);
    auto *jobs = new QListWidget(dialog);
    auto *dueAt = new QDateTimeEdit(dialog);
    dueAt->setCalendarPopup(true);
    dueAt->setDisplayFormat(QStringLiteral("yyyy-MM-dd HH:mm"));
    auto *actionRow = new QHBoxLayout;
    auto *saveTimeButton = new QPushButton(QStringLiteral("Save time"), dialog);
    auto *retryButton = new QPushButton(QStringLiteral("Retry"), dialog);
    auto *cancelButton = new QPushButton(QStringLiteral("Cancel job"), dialog);
    auto *dismissButton = new QPushButton(QStringLiteral("Dismiss"), dialog);
    auto *refreshButton = new QPushButton(QStringLiteral("Refresh"), dialog);
    auto *closeButton = new QPushButton(QStringLiteral("Close"), dialog);
    actionRow->addWidget(saveTimeButton);
    actionRow->addWidget(retryButton);
    actionRow->addWidget(cancelButton);
    actionRow->addWidget(dismissButton);
    auto *footer = new QHBoxLayout;
    footer->addWidget(refreshButton);
    footer->addStretch();
    footer->addWidget(closeButton);
    layout->addWidget(status);
    layout->addWidget(jobs, 1);
    layout->addWidget(new QLabel(QStringLiteral("Reschedule to"), dialog));
    layout->addWidget(dueAt);
    layout->addLayout(actionRow);
    layout->addLayout(footer);

    QPointer<QDialog> guardedDialog(dialog);
    QPointer<QLabel> guardedStatus(status);
    QPointer<QListWidget> guardedJobs(jobs);
    QPointer<QDateTimeEdit> guardedDueAt(dueAt);
    QPointer<QPushButton> guardedSaveTime(saveTimeButton);
    QPointer<QPushButton> guardedRetry(retryButton);
    QPointer<QPushButton> guardedCancel(cancelButton);
    QPointer<QPushButton> guardedDismiss(dismissButton);
    const auto updateActions = [guardedDueAt, guardedSaveTime, guardedRetry, guardedCancel, guardedDismiss]
                               (QListWidgetItem *item) {
        if (!guardedDueAt || !guardedSaveTime || !guardedRetry || !guardedCancel || !guardedDismiss) {
            return;
        }
        const QString jobStatus = item ? item->data(Qt::UserRole + 1).toString() : QString();
        const QString kind = item ? item->data(Qt::UserRole + 2).toString() : QString();
        const qint64 time = item ? item->data(Qt::UserRole + 3).toLongLong() : 0;
        const bool editable = jobStatus == QStringLiteral("pending") || jobStatus == QStringLiteral("failed");
        const bool dismissible = jobStatus == QStringLiteral("fired")
                                 || jobStatus == QStringLiteral("sent-late");
        guardedDueAt->setEnabled(editable);
        guardedSaveTime->setEnabled(editable);
        guardedRetry->setEnabled(editable && jobStatus == QStringLiteral("failed")
                                 && kind == QStringLiteral("message"));
        guardedCancel->setEnabled(editable);
        guardedDismiss->setEnabled(dismissible);
        if (time > 0) {
            guardedDueAt->setDateTime(QDateTime::fromMSecsSinceEpoch(time).toLocalTime());
        }
    };
    const auto loadJobs = [this, guardedDialog, guardedStatus, guardedJobs, updateActions] {
        if (!guardedDialog || !guardedStatus || !guardedJobs) {
            return;
        }
        guardedStatus->setText(QStringLiteral("Loading scheduled jobs…"));
        guardedJobs->clear();
        updateActions(nullptr);
        backend_->call(QStringLiteral("ScheduledJobs"), {},
                       [guardedDialog, guardedStatus, guardedJobs, updateActions]
                       (QJsonValue value, const QString &error) {
                           if (!guardedDialog || !guardedStatus || !guardedJobs) {
                               return;
                           }
                           if (!error.isEmpty()) {
                               guardedStatus->setText(error);
                               return;
                           }
                           const auto entries = value.toArray();
                           for (const auto &entry : entries) {
                               const auto job = entry.toObject();
                               const QString id = job.value(QStringLiteral("id")).toString();
                               const QString kind = job.value(QStringLiteral("kind")).toString();
                               const QString jobStatus = job.value(QStringLiteral("status")).toString();
                               const qint64 time = static_cast<qint64>(
                                   job.value(QStringLiteral("dueAt")).toDouble());
                               const QString roomID = job.value(QStringLiteral("roomId")).toString();
                               const QString label = QStringLiteral("%1 · %2\n%3\n%4\n%5")
                                   .arg(kind == QStringLiteral("reminder")
                                            ? QStringLiteral("Reminder")
                                            : QStringLiteral("Scheduled message"),
                                        jobStatus,
                                        QDateTime::fromMSecsSinceEpoch(time).toLocalTime()
                                            .toString(QStringLiteral("yyyy-MM-dd HH:mm")),
                                        roomID,
                                        job.value(QStringLiteral("text")).toString());
                               auto *item = new QListWidgetItem(label, guardedJobs);
                               item->setData(Qt::UserRole, id);
                               item->setData(Qt::UserRole + 1, jobStatus);
                               item->setData(Qt::UserRole + 2, kind);
                               item->setData(Qt::UserRole + 3, time);
                               if (!job.value(QStringLiteral("error")).toString().isEmpty()) {
                                   item->setToolTip(job.value(QStringLiteral("error")).toString());
                               }
                           }
                           guardedStatus->setText(entries.isEmpty()
                               ? QStringLiteral("No scheduled messages or reminders.")
                               : QStringLiteral("%1 scheduled items").arg(entries.size()));
                           updateActions(guardedJobs->currentItem());
                       });
    };
    const auto runJobAction = [this, guardedDialog, guardedStatus, guardedJobs, guardedSaveTime,
                               guardedRetry, guardedCancel, guardedDismiss, loadJobs, updateActions]
                              (const QString &method, const QJsonArray &params) {
        if (!guardedDialog || !guardedStatus || !guardedJobs) {
            return;
        }
        for (const auto &button : {guardedSaveTime, guardedRetry, guardedCancel, guardedDismiss}) {
            if (button) {
                button->setEnabled(false);
            }
        }
        guardedStatus->setText(QStringLiteral("Updating scheduled job…"));
        backend_->call(method, params, [guardedDialog, guardedStatus, guardedJobs, loadJobs, updateActions]
                       (QJsonValue, const QString &error) {
                           if (!guardedDialog || !guardedStatus || !guardedJobs) {
                               return;
                           }
                           if (!error.isEmpty()) {
                               guardedStatus->setText(error);
                               updateActions(guardedJobs->currentItem());
                               return;
                           }
                           loadJobs();
                       });
    };
    connect(jobs, &QListWidget::currentItemChanged, dialog,
            [updateActions](QListWidgetItem *item, QListWidgetItem *) { updateActions(item); });
    connect(refreshButton, &QPushButton::clicked, dialog, loadJobs);
    connect(closeButton, &QPushButton::clicked, dialog, &QDialog::close);
    connect(saveTimeButton, &QPushButton::clicked, dialog,
            [guardedJobs, guardedDueAt, guardedStatus, runJobAction] {
                if (!guardedJobs || !guardedDueAt || !guardedStatus) {
                    return;
                }
                auto *item = guardedJobs->currentItem();
                if (!item) {
                    return;
                }
                const QDateTime when = guardedDueAt->dateTime();
                if (when <= QDateTime::currentDateTime()) {
                    guardedStatus->setText(QStringLiteral("Choose a time in the future."));
                    return;
                }
                runJobAction(QStringLiteral("UpdateScheduledJob"),
                             {item->data(Qt::UserRole).toString(), when.toMSecsSinceEpoch()});
            });
    connect(retryButton, &QPushButton::clicked, dialog,
            [guardedJobs, runJobAction] {
                if (guardedJobs && guardedJobs->currentItem()) {
                    runJobAction(QStringLiteral("RetryScheduledMessage"),
                                 {guardedJobs->currentItem()->data(Qt::UserRole).toString()});
                }
            });
    connect(cancelButton, &QPushButton::clicked, dialog,
            [guardedJobs, runJobAction] {
                if (guardedJobs && guardedJobs->currentItem()) {
                    runJobAction(QStringLiteral("CancelScheduledJob"),
                                 {guardedJobs->currentItem()->data(Qt::UserRole).toString()});
                }
            });
    connect(dismissButton, &QPushButton::clicked, dialog,
            [guardedJobs, runJobAction] {
                if (guardedJobs && guardedJobs->currentItem()) {
                    runJobAction(QStringLiteral("DismissScheduledJob"),
                                 {guardedJobs->currentItem()->data(Qt::UserRole).toString()});
                }
            });
    dialog->show();
    loadJobs();
}

void MainWindow::startDirectChat() {
    bool accepted = false;
    const QString userID = QInputDialog::getText(
        this, QStringLiteral("New direct chat"), QStringLiteral("Matrix user ID"),
        QLineEdit::Normal, {}, &accepted).trimmed();
    if (!accepted || userID.isEmpty()) {
        return;
    }
    directChatButton_->setEnabled(false);
    backend_->call(QStringLiteral("StartDirectChat"), {userID},
                   [this](QJsonValue result, const QString &error) {
                       directChatButton_->setEnabled(true);
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       pendingRoomID_ = result.toString();
                       loadSnapshot();
                   });
}

void MainWindow::createGroupRoom() {
    auto *dialog = new QDialog(this);
    dialog->setAttribute(Qt::WA_DeleteOnClose);
    dialog->setModal(true);
    dialog->setWindowTitle(QStringLiteral("Create a group"));
    auto *layout = new QVBoxLayout(dialog);
    auto *form = new QFormLayout;
    auto *name = new QLineEdit(dialog);
    name->setMaxLength(255);
    auto *topic = new QLineEdit(dialog);
    topic->setMaxLength(1000);
    auto *invitees = new QPlainTextEdit(dialog);
    invitees->setPlaceholderText(QStringLiteral("@name:example.org"));
    invitees->setMaximumHeight(80);
    auto *encrypted = new QCheckBox(QStringLiteral("End-to-end encryption"), dialog);
    encrypted->setChecked(true);
    auto *status = new QLabel(dialog);
    auto *buttons = new QHBoxLayout;
    auto *cancelButton = new QPushButton(QStringLiteral("Cancel"), dialog);
    auto *createButton = new QPushButton(QStringLiteral("Create group"), dialog);
    createButton->setEnabled(false);
    form->addRow(QStringLiteral("Name"), name);
    form->addRow(QStringLiteral("Topic (optional)"), topic);
    form->addRow(QStringLiteral("Invite people (optional)"), invitees);
    layout->addLayout(form);
    layout->addWidget(encrypted);
    layout->addWidget(status);
    buttons->addStretch();
    buttons->addWidget(cancelButton);
    buttons->addWidget(createButton);
    layout->addLayout(buttons);

    QPointer<QDialog> guardedDialog(dialog);
    QPointer<QLineEdit> guardedName(name);
    QPointer<QLineEdit> guardedTopic(topic);
    QPointer<QPlainTextEdit> guardedInvitees(invitees);
    QPointer<QCheckBox> guardedEncrypted(encrypted);
    QPointer<QLabel> guardedStatus(status);
    QPointer<QPushButton> guardedCreate(createButton);
    connect(name, &QLineEdit::textChanged, dialog, [guardedName, guardedCreate] {
        if (guardedName && guardedCreate) {
            guardedCreate->setEnabled(!guardedName->text().trimmed().isEmpty());
        }
    });
    connect(cancelButton, &QPushButton::clicked, dialog, &QDialog::reject);
    connect(createButton, &QPushButton::clicked, dialog,
            [this, guardedDialog, guardedName, guardedTopic, guardedInvitees,
             guardedEncrypted, guardedStatus, guardedCreate] {
                if (!guardedDialog || !guardedName || !guardedTopic || !guardedInvitees
                    || !guardedEncrypted || !guardedStatus || !guardedCreate) {
                    return;
                }
                const QString roomName = guardedName->text().trimmed();
                if (roomName.isEmpty()) {
                    guardedStatus->setText(QStringLiteral("Enter a group name."));
                    return;
                }
                QJsonArray userIDs;
                const auto parsedIDs = guardedInvitees->toPlainText().split(
                    QRegularExpression(QStringLiteral("[,;\\s]+")), Qt::SkipEmptyParts);
                for (const auto &userID : parsedIDs) {
                    userIDs.append(userID.trimmed());
                }
                const QJsonObject request{
                    {QStringLiteral("name"), roomName},
                    {QStringLiteral("topic"), guardedTopic->text().trimmed()},
                    {QStringLiteral("invitees"), userIDs},
                    {QStringLiteral("encrypted"), guardedEncrypted->isChecked()},
                };
                guardedCreate->setEnabled(false);
                guardedStatus->setText(QStringLiteral("Creating group…"));
                backend_->call(QStringLiteral("CreateGroupRoom"), {request},
                               [this, guardedDialog, guardedStatus, guardedCreate]
                               (QJsonValue result, const QString &error) {
                                   if (!guardedDialog || !guardedStatus || !guardedCreate) {
                                       return;
                                   }
                                   if (!error.isEmpty()) {
                                       guardedStatus->setText(error);
                                       guardedCreate->setEnabled(true);
                                       return;
                                   }
                                   pendingRoomID_ = result.toString();
                                   guardedDialog->accept();
                                   loadSnapshot();
                               });
            });
    dialog->show();
    name->setFocus();
}

void MainWindow::showRoomDetails(const QString &roomID) {
    const auto room = roomByID(roomID);
    auto *dialog = new QDialog(this);
    dialog->setAttribute(Qt::WA_DeleteOnClose);
    dialog->setModal(true);
    dialog->setWindowTitle(QStringLiteral("Room details"));
    dialog->resize(520, 460);
    auto *layout = new QVBoxLayout(dialog);
    const QString roomName = room.value(QStringLiteral("name")).toString(roomID);
    auto *heading = new QLabel(QStringLiteral("%1\n%2")
                                   .arg(roomName, room.value(QStringLiteral("topic")).toString()),
                               dialog);
    heading->setWordWrap(true);
    auto *status = new QLabel(QStringLiteral("Loading members…"), dialog);
    auto *members = new QListWidget(dialog);
    auto *inviteeIDs = new QLineEdit(dialog);
    inviteeIDs->setPlaceholderText(QStringLiteral("@name:example.org"));
    auto *actions = new QHBoxLayout;
    auto *inviteButton = new QPushButton(QStringLiteral("Invite"), dialog);
    auto *leaveButton = new QPushButton(QStringLiteral("Leave room"), dialog);
    auto *closeButton = new QPushButton(QStringLiteral("Close"), dialog);
    actions->addWidget(inviteButton);
    actions->addWidget(leaveButton);
    actions->addStretch();
    actions->addWidget(closeButton);
    layout->addWidget(heading);
    layout->addWidget(status);
    layout->addWidget(members, 1);
    layout->addWidget(inviteeIDs);
    layout->addLayout(actions);

    QPointer<QDialog> guardedDialog(dialog);
    QPointer<QLabel> guardedStatus(status);
    QPointer<QListWidget> guardedMembers(members);
    QPointer<QLineEdit> guardedInviteeIDs(inviteeIDs);
    const auto reloadMembers = [this, roomID, guardedDialog, guardedStatus, guardedMembers] {
        if (!guardedDialog || !guardedStatus || !guardedMembers) {
            return;
        }
        guardedStatus->setText(QStringLiteral("Loading members…"));
        backend_->call(QStringLiteral("RoomMembers"), {roomID},
                       [guardedDialog, guardedStatus, guardedMembers]
                       (QJsonValue value, const QString &error) {
                           if (!guardedDialog || !guardedStatus || !guardedMembers) {
                               return;
                           }
                           guardedMembers->clear();
                           if (!error.isEmpty()) {
                               guardedStatus->setText(error);
                               return;
                           }
                           const auto entries = value.toArray();
                           for (const auto &entry : entries) {
                               const auto member = entry.toObject();
                               const QString id = member.value(QStringLiteral("id")).toString();
                               const QString displayName = member.value(QStringLiteral("displayName")).toString();
                               const QString label = displayName.isEmpty()
                                   ? id : QStringLiteral("%1\n%2").arg(displayName, id);
                               new QListWidgetItem(label, guardedMembers);
                           }
                           guardedStatus->setText(QStringLiteral("%1 members").arg(entries.size()));
                       });
    };
    connect(closeButton, &QPushButton::clicked, dialog, &QDialog::close);
    connect(inviteButton, &QPushButton::clicked, dialog,
            [this, roomID, guardedDialog, guardedStatus, guardedInviteeIDs, reloadMembers] {
                if (!guardedDialog || !guardedStatus || !guardedInviteeIDs) {
                    return;
                }
                QJsonArray userIDs;
                const auto parsedIDs = guardedInviteeIDs->text().split(
                    QRegularExpression(QStringLiteral("[,;\\s]+")), Qt::SkipEmptyParts);
                for (const auto &userID : parsedIDs) {
                    userIDs.append(userID.trimmed());
                }
                if (userIDs.isEmpty()) {
                    guardedStatus->setText(QStringLiteral("Enter one or more Matrix user IDs."));
                    return;
                }
                guardedStatus->setText(QStringLiteral("Sending invitations…"));
                backend_->call(QStringLiteral("InviteToRoom"), {roomID, userIDs},
                               [guardedDialog, guardedStatus, guardedInviteeIDs, reloadMembers]
                               (QJsonValue, const QString &error) {
                                   if (!guardedDialog || !guardedStatus || !guardedInviteeIDs) {
                                       return;
                                   }
                                   if (!error.isEmpty()) {
                                       guardedStatus->setText(error);
                                       return;
                                   }
                                   guardedInviteeIDs->clear();
                                   guardedStatus->setText(QStringLiteral("Invitations sent."));
                                   reloadMembers();
                               });
            });
    connect(leaveButton, &QPushButton::clicked, dialog,
            [this, roomID, guardedDialog, guardedStatus] {
                if (!guardedDialog || !guardedStatus) {
                    return;
                }
                if (QMessageBox::question(
                        guardedDialog, QStringLiteral("Leave room"),
                        QStringLiteral("Leave %1?").arg(roomID),
                        QMessageBox::Yes | QMessageBox::No, QMessageBox::No) != QMessageBox::Yes) {
                    return;
                }
                guardedStatus->setText(QStringLiteral("Leaving room…"));
                backend_->call(QStringLiteral("LeaveRoom"), {roomID},
                               [this, roomID, guardedDialog, guardedStatus]
                               (QJsonValue, const QString &error) {
                                   if (!guardedDialog || !guardedStatus) {
                                       return;
                                   }
                                   if (!error.isEmpty()) {
                                       guardedStatus->setText(error);
                                       return;
                                   }
                                   guardedDialog->accept();
                                   if (currentRoomID_ == roomID) {
                                       currentRoomID_.clear();
                                       activeRoomSubscription_.clear();
                                   }
                                   loadSnapshot();
                               });
            });
    dialog->show();
    reloadMembers();
}

void MainWindow::addAccount() {
    bool accepted = false;
    const QString homeserver = QInputDialog::getText(
        this, QStringLiteral("Add Matrix account"), QStringLiteral("Homeserver"),
        QLineEdit::Normal, QStringLiteral("https://matrix.org"), &accepted).trimmed();
    if (!accepted || homeserver.isEmpty()) {
        return;
    }
    const QString username = QInputDialog::getText(
        this, QStringLiteral("Add Matrix account"), QStringLiteral("Username"),
        QLineEdit::Normal, {}, &accepted).trimmed();
    if (!accepted || username.isEmpty()) {
        return;
    }
    const QString password = QInputDialog::getText(
        this, QStringLiteral("Add Matrix account"), QStringLiteral("Password"),
        QLineEdit::Password, {}, &accepted);
    if (!accepted || password.isEmpty()) {
        return;
    }
    addAccountButton_->setEnabled(false);
    backend_->call(QStringLiteral("AddAccount"), {homeserver, username, password},
                   [this](QJsonValue value, const QString &error) {
                       addAccountButton_->setEnabled(true);
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       if (value.isObject()) {
                           applySnapshot(value.toObject());
                       } else {
                           loadSnapshot();
                       }
                   });
}

void MainWindow::switchAccount(const QString &accountID) {
    if (accountID.isEmpty()
        || accountID == snapshot_.value(QStringLiteral("activeAccountId")).toString()) {
        return;
    }
    backend_->call(QStringLiteral("SwitchAccount"), {accountID},
                   [this](QJsonValue value, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           loadSnapshot();
                           return;
                       }
                       if (value.isObject()) {
                           currentRoomID_.clear();
                           activeRoomSubscription_.clear();
                           roomDrafts_.clear();
                           clearComposeContext();
                           applySnapshot(value.toObject());
                       }
                   });
}

void MainWindow::openThread(const QString &rootID) {
    if (currentRoomID_.isEmpty() || rootID.isEmpty()) {
        return;
    }
    const QString roomID = currentRoomID_;
    auto *dialog = new QDialog(this);
    dialog->setAttribute(Qt::WA_DeleteOnClose);
    dialog->setModal(true);
    dialog->setWindowTitle(QStringLiteral("Thread"));
    dialog->resize(600, 520);
    auto *layout = new QVBoxLayout(dialog);
    auto *status = new QLabel(QStringLiteral("Loading thread…"), dialog);
    auto *threadMessages = new QListWidget(dialog);
    threadMessages->setWordWrap(true);
    auto *composer = new QPlainTextEdit(dialog);
    composer->setPlaceholderText(QStringLiteral("Reply in thread"));
    composer->setMaximumHeight(100);
    auto *buttonRow = new QHBoxLayout;
    auto *closeButton = new QPushButton(QStringLiteral("Close"), dialog);
    auto *sendButton = new QPushButton(QStringLiteral("Send reply"), dialog);
    sendButton->setEnabled(false);
    buttonRow->addStretch();
    buttonRow->addWidget(closeButton);
    buttonRow->addWidget(sendButton);
    layout->addWidget(status);
    layout->addWidget(threadMessages, 1);
    layout->addWidget(composer);
    layout->addLayout(buttonRow);

    QPointer<QDialog> guardedDialog(dialog);
    QPointer<QLabel> guardedStatus(status);
    QPointer<QListWidget> guardedMessages(threadMessages);
    QPointer<QPlainTextEdit> guardedComposer(composer);
    QPointer<QPushButton> guardedSendButton(sendButton);
    const auto reloadThread = [this, roomID, rootID, guardedDialog, guardedStatus, guardedMessages] {
        if (!guardedDialog || !guardedStatus || !guardedMessages) {
            return;
        }
        guardedStatus->setText(QStringLiteral("Loading thread…"));
        backend_->call(QStringLiteral("ThreadMessages"), {roomID, rootID},
                       [guardedDialog, guardedStatus, guardedMessages, rootID]
                       (QJsonValue value, const QString &error) {
                           if (!guardedDialog || !guardedStatus || !guardedMessages) {
                               return;
                           }
                           guardedMessages->clear();
                           if (!error.isEmpty()) {
                               guardedStatus->setText(error);
                               return;
                           }
                           const auto entries = value.toArray();
                           bool hasRoot = false;
                           for (const auto &entry : entries) {
                               const auto message = entry.toObject();
                               const QString eventID = message.value(QStringLiteral("id")).toString();
                               hasRoot = hasRoot || eventID == rootID;
                               const QString sender = message.value(QStringLiteral("senderName")).toString(
                                   message.value(QStringLiteral("sender")).toString());
                               const qint64 timestamp = static_cast<qint64>(
                                   message.value(QStringLiteral("timestamp")).toDouble());
                               QString display = QStringLiteral("%1  %2\n%3")
                                   .arg(timestamp > 0
                                            ? QDateTime::fromMSecsSinceEpoch(timestamp).toLocalTime()
                                                  .toString(QStringLiteral("yyyy-MM-dd HH:mm"))
                                            : QString(),
                                        sender, message.value(QStringLiteral("body")).toString());
                               const auto reactions = message.value(QStringLiteral("reactions")).toObject();
                               if (!reactions.isEmpty()) {
                                   QStringList labels;
                                   for (auto it = reactions.constBegin(); it != reactions.constEnd(); ++it) {
                                       labels.append(QStringLiteral("%1 %2").arg(it.key()).arg(it.value().toInt()));
                                   }
                                   display += QStringLiteral("\n") + labels.join(QStringLiteral("  "));
                               }
                               new QListWidgetItem(display, guardedMessages);
                           }
                           const qint64 count = qMax<qint64>(0, entries.size() - (hasRoot ? 1 : 0));
                           guardedStatus->setText(hasRoot
                               ? QStringLiteral("%1 replies").arg(count)
                               : QStringLiteral("Original message unavailable · %1 replies").arg(count));
                           guardedMessages->scrollToBottom();
                       });
    };
    connect(composer, &QPlainTextEdit::textChanged, dialog, [guardedComposer, guardedSendButton] {
        if (guardedComposer && guardedSendButton) {
            guardedSendButton->setEnabled(!guardedComposer->toPlainText().trimmed().isEmpty());
        }
    });
    connect(closeButton, &QPushButton::clicked, dialog, &QDialog::close);
    connect(sendButton, &QPushButton::clicked, dialog,
            [this, roomID, rootID, guardedDialog, guardedStatus, guardedComposer, guardedSendButton,
             reloadThread] {
                if (!guardedDialog || !guardedStatus || !guardedComposer || !guardedSendButton) {
                    return;
                }
                const QString text = guardedComposer->toPlainText().trimmed();
                if (text.isEmpty()) {
                    return;
                }
                guardedSendButton->setEnabled(false);
                guardedStatus->setText(QStringLiteral("Sending thread reply…"));
                backend_->call(QStringLiteral("SendThreadReply"), {roomID, text, rootID},
                               [guardedDialog, guardedStatus, guardedComposer, guardedSendButton,
                                reloadThread, roomID, this]
                               (QJsonValue, const QString &error) {
                                   if (!guardedDialog || !guardedStatus || !guardedComposer
                                       || !guardedSendButton) {
                                       return;
                                   }
                                   if (!error.isEmpty()) {
                                       guardedStatus->setText(error);
                                       guardedSendButton->setEnabled(
                                           !guardedComposer->toPlainText().trimmed().isEmpty());
                                       return;
                                   }
                                   guardedComposer->clear();
                                   guardedStatus->setText(QStringLiteral("Reply sent."));
                                   reloadThread();
                                   if (currentRoomID_ == roomID) {
                                       loadHistory(roomID);
                                   }
                               });
            });
    dialog->show();
    composer->setFocus();
    reloadThread();
}

void MainWindow::showDevices() {
    auto *dialog = new QDialog(this);
    dialog->setAttribute(Qt::WA_DeleteOnClose);
    dialog->setModal(true);
    dialog->setWindowTitle(QStringLiteral("Manage Matrix devices"));
    dialog->resize(520, 400);
    auto *layout = new QVBoxLayout(dialog);
    auto *status = new QLabel(QStringLiteral("Loading devices…"), dialog);
    auto *devices = new QListWidget(dialog);
    auto *revokeButton = new QPushButton(QStringLiteral("Revoke selected device"), dialog);
    revokeButton->setEnabled(false);
    layout->addWidget(status);
    layout->addWidget(devices, 1);
    layout->addWidget(revokeButton);

    QPointer<QDialog> guardedDialog(dialog);
    QPointer<QLabel> guardedStatus(status);
    QPointer<QListWidget> guardedDevices(devices);
    QPointer<QPushButton> guardedRevokeButton(revokeButton);
    connect(devices, &QListWidget::currentItemChanged, dialog,
            [guardedRevokeButton](QListWidgetItem *item, QListWidgetItem *) {
                if (guardedRevokeButton) {
                    guardedRevokeButton->setEnabled(
                        item && !item->data(Qt::UserRole + 1).toBool());
                }
            });
    connect(revokeButton, &QPushButton::clicked, dialog,
            [this, guardedDialog, guardedStatus, guardedDevices, guardedRevokeButton] {
                if (!guardedDialog || !guardedStatus || !guardedDevices || !guardedRevokeButton) {
                    return;
                }
                auto *selected = guardedDevices->currentItem();
                if (!selected || selected->data(Qt::UserRole + 1).toBool()) {
                    return;
                }
                const QString deviceID = selected->data(Qt::UserRole).toString();
                if (QMessageBox::question(
                        guardedDialog, QStringLiteral("Revoke Matrix device"),
                        QStringLiteral("Revoke device %1? It will be signed out.").arg(deviceID),
                        QMessageBox::Yes | QMessageBox::No, QMessageBox::No) != QMessageBox::Yes) {
                    return;
                }
                bool accepted = false;
                const QString password = QInputDialog::getText(
                    guardedDialog, QStringLiteral("Confirm device revocation"),
                    QStringLiteral("Matrix account password"), QLineEdit::Password, {}, &accepted);
                if (!accepted) {
                    return;
                }
                if (password.isEmpty()) {
                    guardedStatus->setText(QStringLiteral("A non-empty account password is required."));
                    return;
                }
                guardedRevokeButton->setEnabled(false);
                guardedStatus->setText(QStringLiteral("Revoking device…"));
                backend_->call(QStringLiteral("RevokeDevice"), {deviceID, password},
                               [guardedDialog, guardedStatus, guardedDevices, guardedRevokeButton, deviceID]
                               (QJsonValue, const QString &error) {
                                   if (!guardedDialog || !guardedStatus || !guardedDevices
                                       || !guardedRevokeButton) {
                                       return;
                                   }
                                   if (!error.isEmpty()) {
                                       guardedStatus->setText(error);
                                       const auto *selectedItem = guardedDevices->currentItem();
                                       guardedRevokeButton->setEnabled(
                                           selectedItem && !selectedItem->data(Qt::UserRole + 1).toBool());
                                       return;
                                   }
                                   for (int index = 0; index < guardedDevices->count(); ++index) {
                                       auto *item = guardedDevices->item(index);
                                       if (item->data(Qt::UserRole).toString() == deviceID) {
                                           delete guardedDevices->takeItem(index);
                                           break;
                                       }
                                   }
                                   guardedStatus->setText(QStringLiteral("Device revoked."));
                                   const auto *selectedItem = guardedDevices->currentItem();
                                   guardedRevokeButton->setEnabled(
                                       selectedItem && !selectedItem->data(Qt::UserRole + 1).toBool());
                               });
            });
    backend_->call(QStringLiteral("Devices"), {},
                   [guardedDialog, guardedStatus, guardedDevices, guardedRevokeButton]
                   (QJsonValue value, const QString &error) {
                       if (!guardedDialog || !guardedStatus || !guardedDevices || !guardedRevokeButton) {
                           return;
                       }
                       if (!error.isEmpty()) {
                           guardedStatus->setText(error);
                           return;
                       }
                       const auto devicesArray = value.toArray();
                       for (const auto &entry : devicesArray) {
                           const auto device = entry.toObject();
                           const QString id = device.value(QStringLiteral("id")).toString();
                           const QString name = device.value(QStringLiteral("displayName")).toString();
                           QString label = name.isEmpty() ? QStringLiteral("Unnamed device") : name;
                           label += device.value(QStringLiteral("current")).toBool()
                               ? QStringLiteral(" (this device)") : QString();
                           QStringList details;
                           const qint64 lastSeen = static_cast<qint64>(
                               device.value(QStringLiteral("lastSeenAt")).toDouble());
                           if (lastSeen > 0) {
                               details.append(QStringLiteral("Last seen: %1").arg(
                                   QDateTime::fromMSecsSinceEpoch(lastSeen).toLocalTime()
                                       .toString(QStringLiteral("yyyy-MM-dd HH:mm"))));
                           } else {
                               details.append(QStringLiteral("Last seen: unknown"));
                           }
                           const QString ip = device.value(QStringLiteral("lastSeenIp")).toString();
                           if (!ip.isEmpty()) {
                               details.append(QStringLiteral("IP: %1").arg(ip));
                           }
                           auto *item = new QListWidgetItem(
                               QStringLiteral("%1\n%2\nDevice ID: %3")
                                   .arg(label, details.join(QStringLiteral(" · ")), id),
                               guardedDevices);
                           item->setData(Qt::UserRole, id);
                           item->setData(Qt::UserRole + 1, device.value(QStringLiteral("current")));
                       }
                       guardedStatus->setText(devicesArray.isEmpty()
                           ? QStringLiteral("No Matrix devices were returned.")
                           : QStringLiteral("%1 devices").arg(devicesArray.size()));
                       const auto *selected = guardedDevices->currentItem();
                       guardedRevokeButton->setEnabled(
                           selected && !selected->data(Qt::UserRole + 1).toBool());
                   });
    dialog->show();
}

void MainWindow::searchMessages() {
    auto *dialog = new QDialog(this);
    dialog->setAttribute(Qt::WA_DeleteOnClose);
    dialog->setWindowTitle(QStringLiteral("Search messages"));
    dialog->resize(640, 480);
    auto *layout = new QVBoxLayout(dialog);
    auto *query = new QLineEdit(dialog);
    query->setPlaceholderText(QStringLiteral("Search current account's local history"));
    auto *sender = new QLineEdit(dialog);
    sender->setPlaceholderText(QStringLiteral("Filter by Matrix user ID (optional)"));
    auto *searchButton = new QPushButton(QStringLiteral("Search"), dialog);
    auto *loadMoreButton = new QPushButton(QStringLiteral("Load more"), dialog);
    loadMoreButton->setEnabled(false);
    auto *status = new QLabel(dialog);
    auto *results = new QListWidget(dialog);
    layout->addWidget(query);
    layout->addWidget(sender);
    layout->addWidget(searchButton);
    layout->addWidget(loadMoreButton);
    layout->addWidget(status);
    layout->addWidget(results, 1);
    connect(query, &QLineEdit::returnPressed, searchButton, &QPushButton::click);

    QPointer<QDialog> guardedDialog(dialog);
    QPointer<QLineEdit> guardedQuery(query);
    QPointer<QLineEdit> guardedSender(sender);
    QPointer<QLabel> guardedStatus(status);
    QPointer<QListWidget> guardedResults(results);
    QPointer<QPushButton> guardedSearchButton(searchButton);
    QPointer<QPushButton> guardedLoadMoreButton(loadMoreButton);
    auto nextBatch = std::make_shared<QString>();
    auto lastQuery = std::make_shared<QString>();
    auto lastSender = std::make_shared<QString>();
    const auto requestSearch = [this, guardedDialog, guardedStatus, guardedResults,
                                guardedSearchButton, guardedLoadMoreButton, nextBatch]
                               (const QString &text, const QString &senderID,
                                const QString &batch, bool clearResults) {
        if (!guardedDialog || !guardedStatus || !guardedResults
            || !guardedSearchButton || !guardedLoadMoreButton) {
            return;
        }
        guardedSearchButton->setEnabled(false);
        guardedLoadMoreButton->setEnabled(false);
        if (clearResults) {
            guardedResults->clear();
            *nextBatch = QString();
        }
        guardedStatus->setText(QStringLiteral("Searching local history…"));
        const QJsonObject request{
            {QStringLiteral("query"), text},
            {QStringLiteral("roomID"), QString()},
            {QStringLiteral("sender"), senderID},
            {QStringLiteral("minTimestamp"), 0},
            {QStringLiteral("maxTimestamp"), 0},
            {QStringLiteral("limit"), 50},
            {QStringLiteral("nextBatch"), batch},
        };
        backend_->call(QStringLiteral("SearchMessages"), {request},
                       [this, guardedDialog, guardedStatus, guardedResults, guardedSearchButton,
                        guardedLoadMoreButton, nextBatch]
                       (QJsonValue value, const QString &error) {
                           if (!guardedDialog || !guardedStatus || !guardedResults
                               || !guardedSearchButton || !guardedLoadMoreButton) {
                               return;
                           }
                           guardedSearchButton->setEnabled(true);
                           if (!error.isEmpty()) {
                               guardedLoadMoreButton->setEnabled(!nextBatch->isEmpty());
                               guardedStatus->setText(error);
                               return;
                           }
                           const auto page = value.toObject();
                           const auto entries = page.value(QStringLiteral("results")).toArray();
                           for (const auto &entry : entries) {
                               const auto result = entry.toObject();
                               const auto message = result.value(QStringLiteral("message")).toObject();
                               const auto room = roomByID(result.value(QStringLiteral("roomID")).toString());
                               const QString roomName = room.value(QStringLiteral("name")).toString(
                                   result.value(QStringLiteral("roomID")).toString());
                               const QString senderName = message.value(QStringLiteral("senderName")).toString(
                                   message.value(QStringLiteral("sender")).toString());
                               auto *item = new QListWidgetItem(
                                   QStringLiteral("%1 — %2: %3").arg(roomName, senderName,
                                       message.value(QStringLiteral("body")).toString()),
                                   guardedResults);
                               item->setData(Qt::UserRole,
                                             QString::fromUtf8(QJsonDocument(result).toJson(QJsonDocument::Compact)));
                           }
                           *nextBatch = page.value(QStringLiteral("nextBatch")).toString();
                           guardedLoadMoreButton->setEnabled(!nextBatch->isEmpty());
                           guardedStatus->setText(guardedResults->count() == 0
                               ? QStringLiteral("No matching messages in local history.")
                               : QStringLiteral("%1 results").arg(guardedResults->count()));
                       });
    };
    connect(searchButton, &QPushButton::clicked, dialog,
            [guardedQuery, guardedSender, guardedStatus, lastQuery, lastSender, requestSearch] {
                if (!guardedQuery || !guardedSender || !guardedStatus) {
                    return;
                }
                *lastQuery = guardedQuery->text().trimmed();
                *lastSender = guardedSender->text().trimmed();
                if (lastQuery->isEmpty()) {
                    guardedStatus->setText(QStringLiteral("Enter a search term."));
                    return;
                }
                requestSearch(*lastQuery, *lastSender, QString(), true);
            });
    connect(loadMoreButton, &QPushButton::clicked, dialog,
            [nextBatch, lastQuery, lastSender, requestSearch] {
                if (!nextBatch->isEmpty()) {
                    requestSearch(*lastQuery, *lastSender, *nextBatch, false);
                }
            });
    connect(results, &QListWidget::itemDoubleClicked, dialog,
            [this, guardedDialog](QListWidgetItem *item) {
                if (!guardedDialog || !item) {
                    return;
                }
                const auto document = QJsonDocument::fromJson(item->data(Qt::UserRole).toString().toUtf8());
                if (!document.isObject()) {
                    showError(QStringLiteral("The selected search result is invalid."));
                    return;
                }
                const auto result = document.object();
                const QString roomID = result.value(QStringLiteral("roomID")).toString();
                const auto message = result.value(QStringLiteral("message")).toObject();
                const auto room = roomByID(roomID);
                roomFilter_->clear();
                roomScope_->setCurrentIndex(roomScope_->findData(
                    roomIsArchived(room) ? QStringLiteral("archived") : QStringLiteral("all")));
                bool roomFound = false;
                for (int index = 0; index < rooms_->count(); ++index) {
                    auto *roomItem = rooms_->item(index);
                    if (roomItem->data(Qt::UserRole).toString() == roomID) {
                        rooms_->setCurrentItem(roomItem);
                        roomFound = true;
                        break;
                    }
                }
                if (!roomFound) {
                    showError(QStringLiteral("The room for this search result is no longer available."));
                    guardedDialog->close();
                    return;
                }
                const qint64 cursor = static_cast<qint64>(
                    message.value(QStringLiteral("timelineCursor")).toDouble());
                loadHistory(roomID, cursor > 0 ? cursor + 1 : 0);
                guardedDialog->close();
            });
    dialog->show();
    query->setFocus();
}

void MainWindow::runRoomAction(const QString &method, const QJsonArray &params) {
    if (method == QStringLiteral("MarkUnread") && !params.isEmpty()) {
        readRequests_.remove(params.at(0).toString());
    }
    backend_->call(method, params, [this](QJsonValue, const QString &error) {
        if (!error.isEmpty()) {
            showError(error);
            return;
        }
        loadSnapshot();
    });
}

QJsonObject MainWindow::roomByID(const QString &roomID) const {
    for (const auto &value : snapshot_.value(QStringLiteral("rooms")).toArray()) {
        const auto room = value.toObject();
        if (room.value(QStringLiteral("id")).toString() == roomID) {
            return room;
        }
    }
    return {};
}

bool MainWindow::roomIsArchived(const QJsonObject &room) const {
    return preferences_.value(archivePreferenceKey(room)).toBool();
}

QString MainWindow::archivePreferenceKey(const QJsonObject &room) const {
    QString accountID = room.value(QStringLiteral("accountId")).toString();
    if (accountID.isEmpty()) {
        accountID = snapshot_.value(QStringLiteral("activeAccountId")).toString();
    }
    if (accountID.isEmpty()) {
        accountID = QStringLiteral("primary");
    }
    return QStringLiteral("room.archived.%1.%2")
        .arg(accountID, room.value(QStringLiteral("id")).toString());
}

void MainWindow::showError(const QString &message) {
    if (message.isEmpty()) {
        return;
    }
    statusBar()->showMessage(message, 10000);
}

// ---- Backend call wrappers ----

void MainWindow::callSnapshot() {
    backend_->call(QStringLiteral("Snapshot"), {},
                   [this](QJsonValue result, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       if (result.isObject()) {
                           applySnapshot(result.toObject());
                       }
                   });
}

void MainWindow::callLogin(const QString &homeserver, const QString &username, const QString &password) {
    backend_->call(QStringLiteral("Login"), {homeserver, username, password},
                   [this](QJsonValue, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       loadSnapshot();
                   });
}

void MainWindow::callVerify(const QString &recoveryKey) {
    backend_->call(QStringLiteral("Verify"), {recoveryKey},
                   [this](QJsonValue, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       loadSnapshot();
                   });
}

void MainWindow::callLogout() {
    backend_->call(QStringLiteral("Logout"), {},
                   [this](QJsonValue, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       loadSnapshot();
                   });
}

void MainWindow::callAcceptInvite(const QString &roomID) {
    backend_->call(QStringLiteral("AcceptInvite"), {roomID},
                   [this](QJsonValue result, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       loadSnapshot();
                   });
}

void MainWindow::callDeclineInvite(const QString &roomID) {
    backend_->call(QStringLiteral("DeclineInvite"), {roomID},
                   [this](QJsonValue, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       loadSnapshot();
                   });
}

void MainWindow::callSwitchAccount(const QString &accountID) {
    backend_->call(QStringLiteral("SwitchAccount"), {accountID},
                   [this](QJsonValue result, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           loadSnapshot();
                           return;
                       }
                       if (result.isObject()) {
                           currentRoomID_.clear();
                           activeRoomSubscription_.clear();
                           roomDrafts_.clear();
                           clearComposeContext();
                           applySnapshot(result.toObject());
                       }
                   });
}

void MainWindow::callAddAccount(const QString &homeserver, const QString &username, const QString &password) {
    backend_->call(QStringLiteral("AddAccount"), {homeserver, username, password},
                   [this](QJsonValue result, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       if (result.isObject()) {
                           applySnapshot(result.toObject());
                       } else {
                           loadSnapshot();
                       }
                   });
}

void MainWindow::callJoinRoom(const QString &target) {
    backend_->call(QStringLiteral("JoinRoom"), {target},
                   [this](QJsonValue result, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       if (result.isString() && !result.toString().isEmpty()) {
                           pendingRoomID_ = result.toString();
                       }
                       loadSnapshot();
                   });
}

void MainWindow::callStartDirectChat(const QString &userID) {
    backend_->call(QStringLiteral("StartDirectChat"), {userID},
                   [this](QJsonValue result, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       if (result.isString()) {
                           pendingRoomID_ = result.toString();
                       }
                       loadSnapshot();
                   });
}

void MainWindow::callCreateGroupRoom(const QJsonObject &request) {
    QJsonArray params;
    params.append(request);
    backend_->call(QStringLiteral("CreateGroupRoom"), params,
                   [this](QJsonValue result, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       if (result.isString()) {
                           pendingRoomID_ = result.toString();
                       }
                       loadSnapshot();
                   });
}

void MainWindow::callLeaveRoom(const QString &roomID) {
    backend_->call(QStringLiteral("LeaveRoom"), {roomID},
                   [this, roomID](QJsonValue, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       if (currentRoomID_ == roomID) {
                           currentRoomID_.clear();
                           activeRoomSubscription_.clear();
                       }
                       loadSnapshot();
                   });
}

void MainWindow::callSetActiveRoom(const QString &roomID) {
    backend_->call(QStringLiteral("SetActiveRoom"), {roomID},
                   [this](QJsonValue, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                       }
                   });
}

void MainWindow::callHistory(const QString &roomID, qint64 before) {
    backend_->call(QStringLiteral("History"), {roomID, before},
                   [this, roomID, before](QJsonValue result, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       if (result.isObject()) {
                           const auto page = result.toObject();
                           const auto messages = page.value(QStringLiteral("messages")).toArray();
                           messages_->clear();
                           messagesByID_.clear();
                           for (const auto &entry : messages) {
                               const auto message = entry.toObject();
                               const auto eventID = message.value(QStringLiteral("id")).toString();
                               if (!eventID.isEmpty()) {
                                   messagesByID_.insert(eventID, message);
                               }
                               const auto sender = message.value(QStringLiteral("senderName")).toString(
                                   message.value(QStringLiteral("sender")).toString());
                               const auto body = message.value(QStringLiteral("body")).toString();
                               const auto timestamp = QDateTime::fromMSecsSinceEpoch(
                                   static_cast<qint64>(message.value(QStringLiteral("timestamp")).toDouble()));
                               QString display = QStringLiteral("%1  %2\n%3")
                                   .arg(timestamp.toLocalTime().toString(QStringLiteral("HH:mm")),
                                        sender, body);
                               auto *item = new QListWidgetItem(display, messages_);
                               item->setData(Qt::UserRole, eventID);
                               item->setData(Qt::UserRole + 1, message.toVariantMap());
                           }
                           messages_->scrollToBottom();
                       }
                   });
}

void MainWindow::callMarkRead(const QString &roomID, const QString &eventID) {
    backend_->call(QStringLiteral("MarkRead"), {roomID, eventID},
                   [this, roomID, eventID](QJsonValue, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       readRequests_.insert(roomID, eventID);
                   });
}

void MainWindow::callMarkUnread(const QString &roomID) {
    backend_->call(QStringLiteral("MarkUnread"), {roomID},
                   [this](QJsonValue, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       loadSnapshot();
                   });
}

void MainWindow::callSendMessage(const QString &roomID, const QString &text) {
    backend_->call(QStringLiteral("SendMessage"), {roomID, text},
                   [this](QJsonValue, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       loadHistory(currentRoomID_);
                       loadSnapshot();
                   });
}

void MainWindow::callSendMessageWithMentions(const QString &roomID, const QString &text, const QStringList &userIDs) {
    QJsonArray params;
    params.append(roomID);
    params.append(text);
    QJsonArray userArray;
    for (const auto &uid : userIDs) {
        userArray.append(uid);
    }
    params.append(userArray);
    backend_->call(QStringLiteral("SendMessageWithMentions"), params,
                   [this](QJsonValue, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       loadHistory(currentRoomID_);
                       loadSnapshot();
                   });
}

void MainWindow::callSendReply(const QString &roomID, const QString &text, const QString &replyTo) {
    backend_->call(QStringLiteral("SendReply"), {roomID, text, replyTo},
                   [this](QJsonValue, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       loadHistory(currentRoomID_);
                       loadSnapshot();
                   });
}

void MainWindow::callThreadMessages(const QString &roomID, const QString &rootID) {
    backend_->call(QStringLiteral("ThreadMessages"), {roomID, rootID},
                   [this](QJsonValue result, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       if (result.isArray()) {
                           const auto entries = result.toArray();
                           for (const auto &entry : entries) {
                               const auto message = entry.toObject();
                               const auto eventID = message.value(QStringLiteral("id")).toString();
                               if (!eventID.isEmpty()) {
                                   messagesByID_.insert(eventID, message);
                               }
                           }
                       }
                   });
}

void MainWindow::callSendThreadReply(const QString &roomID, const QString &text, const QString &rootID) {
    backend_->call(QStringLiteral("SendThreadReply"), {roomID, text, rootID},
                   [this](QJsonValue, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       loadHistory(currentRoomID_);
                       loadSnapshot();
                   });
}

void MainWindow::callEditMessage(const QString &roomID, const QString &text, const QString &eventID) {
    backend_->call(QStringLiteral("EditMessage"), {roomID, text, eventID},
                   [this](QJsonValue, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       clearComposeContext();
                       loadHistory(currentRoomID_);
                       loadSnapshot();
                   });
}

void MainWindow::callReact(const QString &roomID, const QString &eventID, const QString &emoji) {
    backend_->call(QStringLiteral("React"), {roomID, eventID, emoji},
                   [this](QJsonValue, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       loadHistory(currentRoomID_);
                       loadSnapshot();
                   });
}

void MainWindow::callRemoveReaction(const QString &roomID, const QString &eventID, const QString &emoji) {
    backend_->call(QStringLiteral("RemoveReaction"), {roomID, eventID, emoji},
                   [this](QJsonValue, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       loadHistory(currentRoomID_);
                       loadSnapshot();
                   });
}

void MainWindow::callRedactMessage(const QString &roomID, const QString &eventID) {
    backend_->call(QStringLiteral("RedactMessage"), {roomID, eventID},
                   [this](QJsonValue, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       loadHistory(currentRoomID_);
                       loadSnapshot();
                   });
}

void MainWindow::callRetryMessage(const QString &transactionID) {
    backend_->call(QStringLiteral("RetryMessage"), {transactionID},
                   [this](QJsonValue, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       loadHistory(currentRoomID_);
                       loadSnapshot();
                   });
}

void MainWindow::callSetTyping(const QString &roomID, qint64 timeoutMilliseconds) {
    backend_->call(QStringLiteral("SetTyping"), {roomID, timeoutMilliseconds},
                   [this](QJsonValue, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                       }
                   });
}

void MainWindow::callSetBooleanPreference(const QString &key, bool value) {
    backend_->call(QStringLiteral("SetBooleanPreference"), {key, value},
                   [this](QJsonValue, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       loadSnapshot();
                   });
}

void MainWindow::callSetStringPreference(const QString &key, const QString &value) {
    backend_->call(QStringLiteral("SetStringPreference"), {key, value},
                   [this](QJsonValue, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       loadSnapshot();
                   });
}

void MainWindow::callSetStringPreferences(const QJsonObject &values) {
    QJsonArray params;
    params.append(values);
    backend_->call(QStringLiteral("SetStringPreferences"), params,
                   [this](QJsonValue, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       loadSnapshot();
                   });
}

void MainWindow::callDevices() {
    backend_->call(QStringLiteral("Devices"), {},
                   [this](QJsonValue result, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       if (result.isArray()) {
                           const auto devices = result.toArray();
                           for (const auto &entry : devices) {
                               const auto device = entry.toObject();
                               // Devices dialog handles its own Devices call
                           }
                       }
                   });
}

void MainWindow::callRevokeDevice(const QString &deviceID, const QString &password) {
    backend_->call(QStringLiteral("RevokeDevice"), {deviceID, password},
                   [this](QJsonValue, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       loadSnapshot();
                   });
}

void MainWindow::callRoomMembers(const QString &roomID) {
    backend_->call(QStringLiteral("RoomMembers"), {roomID},
                   [this](QJsonValue result, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       // Room details dialog handles its own RoomMembers call
                   });
}

void MainWindow::callInviteToRoom(const QString &roomID, const QStringList &userIDs) {
    QJsonArray params;
    params.append(roomID);
    QJsonArray userArray;
    for (const auto &uid : userIDs) {
        userArray.append(uid);
    }
    params.append(userArray);
    backend_->call(QStringLiteral("InviteToRoom"), params,
                   [this](QJsonValue, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       loadSnapshot();
                   });
}

void MainWindow::callSearchMessages(const QString &query, const QString &roomID, const QString &sender,
                                    qint64 minTs, qint64 maxTs, int limit, const QString &nextBatch) {
    QJsonObject request;
    request[QStringLiteral("query")] = query;
    request[QStringLiteral("roomID")] = roomID;
    request[QStringLiteral("sender")] = sender;
    request[QStringLiteral("minTimestamp")] = minTs;
    request[QStringLiteral("maxTimestamp")] = maxTs;
    request[QStringLiteral("limit")] = limit;
    request[QStringLiteral("nextBatch")] = nextBatch;
    QJsonArray params;
    params.append(request);
    backend_->call(QStringLiteral("SearchMessages"), params,
                   [this](QJsonValue result, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       if (result.isObject()) {
                           const auto page = result.toObject();
                           const auto results = page.value(QStringLiteral("results")).toArray();
                           for (const auto &entry : results) {
                               const auto item = entry.toObject();
                               const auto roomID = item.value(QStringLiteral("roomID")).toString();
                               const auto message = item.value(QStringLiteral("message")).toObject();
                               // Search dialog handles its own results display
                           }
                       }
                   });
}

void MainWindow::callURLPreview(const QString &link) {
    backend_->call(QStringLiteral("URLPreview"), {link},
                   [this](QJsonValue result, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       if (result.isObject()) {
                           const auto preview = result.toObject();
                           // URL preview result handled by caller
                       }
                   });
}

void MainWindow::callOpenExternalURL(const QString &url) {
    backend_->call(QStringLiteral("OpenExternalURL"), {url},
                   [this](QJsonValue, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                       }
                   });
}

void MainWindow::callRevealFile(const QString &path) {
    backend_->call(QStringLiteral("RevealFile"), {path},
                   [this](QJsonValue, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                       }
                   });
}

void MainWindow::callSaveMedia(const QString &mxc, const QString &filename) {
    backend_->call(QStringLiteral("SaveMedia"), {mxc, filename},
                   [this](QJsonValue result, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       if (result.isString() && !result.toString().isEmpty()) {
                           statusBar()->showMessage(QStringLiteral("Saved to %1").arg(result.toString()), 8000);
                       }
                   });
}

void MainWindow::callExportRoomChat(const QString &roomID, const QString &parentDirectory) {
    backend_->call(QStringLiteral("ExportRoomChat"), {roomID, parentDirectory},
                   [this](QJsonValue result, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       if (result.isObject()) {
                           const auto res = result.toObject();
                           const auto path = res.value(QStringLiteral("path")).toString();
                           const auto messages = res.value(QStringLiteral("messages")).toInt();
                           statusBar()->showMessage(
                               QStringLiteral("Exported %1 messages to %2").arg(messages).arg(path), 10000);
                       }
                   });
}

void MainWindow::callCancelChatExport() {
    backend_->call(QStringLiteral("CancelChatExport"), {},
                   [this](QJsonValue result, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       const bool cancelled = result.isBool() && result.toBool();
                       statusBar()->showMessage(
                           cancelled ? QStringLiteral("Chat export cancelled.")
                                     : QStringLiteral("No chat export running."), 8000);
                   });
}

void MainWindow::callExportRecentMessagesForAllChats(const QString &parentDirectory, int limit,
                                                     const QJsonObject &options) {
    QJsonArray params;
    params.append(parentDirectory);
    params.append(limit);
    params.append(options);
    backend_->call(QStringLiteral("ExportRecentMessagesForAllChats"), params,
                   [this](QJsonValue result, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       if (result.isObject()) {
                           const auto res = result.toObject();
                           const auto chats = res.value(QStringLiteral("chats")).toInt();
                           const auto messages = res.value(QStringLiteral("messages")).toInt();
                           const auto failed = res.value(QStringLiteral("failed")).toInt();
                           const auto cancelled = res.value(QStringLiteral("cancelled")).toBool();
                           statusBar()->showMessage(
                               QStringLiteral("Bulk export: %1 chats, %2 messages, %3 failed%4")
                                   .arg(chats).arg(messages).arg(failed)
                                   .arg(cancelled ? QStringLiteral(" (cancelled)") : QString()), 10000);
                       }
                   });
}

void MainWindow::callScheduledJobs() {
    backend_->call(QStringLiteral("ScheduledJobs"), {},
                   [this](QJsonValue result, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       if (result.isArray()) {
                           const auto jobs = result.toArray();
                           // Scheduled jobs dialog handles its own display
                       }
                   });
}

void MainWindow::callScheduleMessage(const QString &roomID, const QString &text, qint64 dueAt) {
    backend_->call(QStringLiteral("ScheduleMessage"), {roomID, text, dueAt},
                   [this](QJsonValue, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       loadSnapshot();
                   });
}

void MainWindow::callScheduleReply(const QString &roomID, const QString &text, const QString &replyTo, qint64 dueAt) {
    backend_->call(QStringLiteral("ScheduleReply"), {roomID, text, replyTo, dueAt},
                   [this](QJsonValue, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       loadSnapshot();
                   });
}

void MainWindow::callScheduleReminder(const QString &roomID, const QString &eventID, const QString &text, qint64 dueAt) {
    backend_->call(QStringLiteral("ScheduleReminder"), {roomID, eventID, text, dueAt},
                   [this](QJsonValue, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       loadSnapshot();
                   });
}

void MainWindow::callUpdateScheduledJob(const QString &id, qint64 dueAt) {
    backend_->call(QStringLiteral("UpdateScheduledJob"), {id, dueAt},
                   [this](QJsonValue, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       loadSnapshot();
                   });
}

void MainWindow::callCancelScheduledJob(const QString &id) {
    backend_->call(QStringLiteral("CancelScheduledJob"), {id},
                   [this](QJsonValue, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       loadSnapshot();
                   });
}

void MainWindow::callRetryScheduledMessage(const QString &id) {
    backend_->call(QStringLiteral("RetryScheduledMessage"), {id},
                   [this](QJsonValue, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       loadSnapshot();
                   });
}

void MainWindow::callDismissScheduledJob(const QString &id) {
    backend_->call(QStringLiteral("DismissScheduledJob"), {id},
                   [this](QJsonValue, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       loadSnapshot();
                   });
}

void MainWindow::callAIComplete(const QJsonArray &messages, const QString &requestID, double temperature, int maxTokens) {
    QJsonArray params;
    params.append(messages);
    params.append(requestID);
    params.append(temperature);
    params.append(maxTokens);
    backend_->call(QStringLiteral("AIComplete"), params,
                   [this](QJsonValue result, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       if (result.isString()) {
                           // AI result handled by caller
                       }
                   });
}

void MainWindow::callAICancel(const QString &requestID) {
    backend_->call(QStringLiteral("AICancel"), {requestID},
                   [this](QJsonValue result, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       const bool cancelled = result.isBool() && result.toBool();
                       statusBar()->showMessage(
                           cancelled ? QStringLiteral("AI request cancelled.") : QStringLiteral("No AI request running."), 8000);
                   });
}

void MainWindow::callAISuggestReplies(const QString &roomID, const QString &requestID) {
    backend_->call(QStringLiteral("AISuggestReplies"), {roomID, requestID},
                   [this](QJsonValue result, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       if (result.isObject()) {
                           const auto replies = result.toObject();
                           // AI suggestions handled by caller
                       }
                   });
}

void MainWindow::callAIGenerateReplyDraft(const QString &roomID, const QString &requestID) {
    backend_->call(QStringLiteral("AIGenerateReplyDraft"), {roomID, requestID},
                   [this](QJsonValue result, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       if (result.isString()) {
                           const auto draft = result.toString();
                           if (!draft.isEmpty() && !currentRoomID_.isEmpty()) {
                               composer_->setPlainText(draft);
                               setComposeContext(QStringLiteral("AI-generated reply draft"));
                           }
                       }
                   });
}

void MainWindow::callAIDetectChatLanguage(const QString &roomID, const QString &requestID) {
    backend_->call(QStringLiteral("AIDetectChatLanguage"), {roomID, requestID},
                   [this](QJsonValue result, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       if (result.isString()) {
                           const auto lang = result.toString();
                           statusBar()->showMessage(QStringLiteral("Detected language: %1").arg(lang), 8000);
                       }
                   });
}

void MainWindow::callAITranscribeMedia(const QString &mxcURI, const QString &filename, const QString &contentType) {
    backend_->call(QStringLiteral("AITranscribeMedia"), {mxcURI, filename, contentType},
                   [this](QJsonValue result, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       if (result.isString()) {
                           const auto transcription = result.toString();
                           statusBar()->showMessage(QStringLiteral("Transcription: %1").arg(transcription), 10000);
                       }
                   });
}

void MainWindow::callTestAIEndpoint() {
    backend_->call(QStringLiteral("TestAIEndpoint"), {},
                   [this](QJsonValue, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(QStringLiteral("AI endpoint test failed: %1").arg(error));
                           return;
                       }
                       statusBar()->showMessage(QStringLiteral("AI endpoint is reachable."), 8000);
                   });
}

void MainWindow::callCheckMessageTone(const QJsonArray &messages) {
    QJsonArray params;
    params.append(messages);
    backend_->call(QStringLiteral("CheckMessageTone"), params,
                   [this](QJsonValue result, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       if (result.isString()) {
                           const auto tone = result.toString();
                           statusBar()->showMessage(QStringLiteral("Message tone: %1").arg(tone), 8000);
                       }
                   });
}

void MainWindow::callAIFeatureDefaults() {
    backend_->call(QStringLiteral("AIFeatureDefaults"), {},
                   [this](QJsonValue result, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       if (result.isArray()) {
                           const auto features = result.toArray();
                           // AI feature defaults handled by caller
                       }
                   });
}

void MainWindow::callLanguageTutorAnalyze(const QString &text, const QString &mode, const QString &learning,
                                          const QString &explanation, const QString &requestID) {
    backend_->call(QStringLiteral("Analyze"), {text, mode, learning, explanation, requestID},
                   [this](QJsonValue result, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       if (result.isObject()) {
                           const auto analysis = result.toObject();
                           // Language tutor analysis handled by caller
                       }
                   });
}

void MainWindow::callListLocalAIChats() {
    backend_->call(QStringLiteral("ListLocalAIChats"), {},
                   [this](QJsonValue result, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       if (result.isArray()) {
                           const auto chats = result.toArray();
                           // Local AI chat list handled by caller
                       }
                   });
}

void MainWindow::callCreateLocalAIChat(const QString &agentID, const QString &kind) {
    backend_->call(QStringLiteral("CreateLocalAIChat"), {agentID, kind},
                   [this](QJsonValue result, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       if (result.isObject()) {
                           // New local AI chat created
                       }
                   });
}

void MainWindow::callDeleteLocalAIChat(const QString &chatID) {
    backend_->call(QStringLiteral("DeleteLocalAIChat"), {chatID},
                   [this](QJsonValue, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       loadSnapshot();
                   });
}

void MainWindow::callLoadLocalAIChatMessages(const QString &chatID) {
    backend_->call(QStringLiteral("LoadLocalAIChatMessages"), {chatID},
                   [this](QJsonValue result, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       if (result.isArray()) {
                           const auto messages = result.toArray();
                           // Local AI chat messages handled by caller
                       }
                   });
}

void MainWindow::callAppendLocalAIChatMessage(const QString &chatID, const QJsonObject &message) {
    QJsonArray params;
    params.append(chatID);
    params.append(message);
    backend_->call(QStringLiteral("AppendLocalAIChatMessage"), params,
                   [this](QJsonValue result, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       if (result.isObject()) {
                           // Message appended
                       }
                   });
}

void MainWindow::callTruncateLocalAIChat(const QString &chatID, int fromSeq) {
    backend_->call(QStringLiteral("TruncateLocalAIChat"), {chatID, fromSeq},
                   [this](QJsonValue, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                   });
}

void MainWindow::callRenameLocalAIChat(const QString &chatID, const QString &title) {
    backend_->call(QStringLiteral("RenameLocalAIChat"), {chatID, title},
                   [this](QJsonValue, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                   });
}

void MainWindow::callSetLocalAIChatAgent(const QString &chatID, const QString &agentID) {
    backend_->call(QStringLiteral("SetLocalAIChatAgent"), {chatID, agentID},
                   [this](QJsonValue, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                   });
}

void MainWindow::callSetLocalAIChatFolder(const QString &chatID, const QString &folderID) {
    backend_->call(QStringLiteral("SetLocalAIChatFolder"), {chatID, folderID},
                   [this](QJsonValue, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                   });
}

void MainWindow::callListLocalAIChatFolders() {
    backend_->call(QStringLiteral("ListLocalAIChatFolders"), {},
                   [this](QJsonValue result, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       if (result.isArray()) {
                           const auto folders = result.toArray();
                           // Local AI chat folders handled by caller
                       }
                   });
}

void MainWindow::callCreateLocalAIChatFolder(const QString &name) {
    backend_->call(QStringLiteral("CreateLocalAIChatFolder"), {name},
                   [this](QJsonValue result, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       if (result.isObject()) {
                           // Folder created
                       }
                   });
}

void MainWindow::callRenameLocalAIChatFolder(const QString &folderID, const QString &name) {
    backend_->call(QStringLiteral("RenameLocalAIChatFolder"), {folderID, name},
                   [this](QJsonValue, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                   });
}

void MainWindow::callDeleteLocalAIChatFolder(const QString &folderID) {
    backend_->call(QStringLiteral("DeleteLocalAIChatFolder"), {folderID},
                   [this](QJsonValue, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                   });
}

void MainWindow::callExportLocalAIChat(const QString &filename, const QString &content) {
    backend_->call(QStringLiteral("ExportLocalAIChat"), {filename, content},
                   [this](QJsonValue result, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       if (result.isString() && !result.toString().isEmpty()) {
                           statusBar()->showMessage(QStringLiteral("Exported to %1").arg(result.toString()), 8000);
                       }
                   });
}

void MainWindow::callLocalAIChatGenerateImage(const QString &chatID, const QString &prompt, const QString &requestID) {
    backend_->call(QStringLiteral("LocalAIChatGenerateImage"), {chatID, prompt, requestID},
                   [this](QJsonValue result, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       if (result.isArray()) {
                           // Image generated and added to chat
                       }
                   });
}

void MainWindow::callGenerateRoomImage(const QString &prompt, const QString &requestID) {
    backend_->call(QStringLiteral("GenerateRoomImage"), {prompt, requestID},
                   [this](QJsonValue result, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       if (result.isString()) {
                           const auto imageData = result.toString();
                           // Generated image data handled by caller
                       }
                   });
}

void MainWindow::callDataLocation() {
    backend_->call(QStringLiteral("DataLocation"), {},
                   [this](QJsonValue result, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       if (result.isObject()) {
                           const auto loc = result.toObject();
                           const auto dataDir = loc.value(QStringLiteral("dataDir")).toString();
                           const auto defaultDir = loc.value(QStringLiteral("defaultDir")).toString();
                           const auto mediaCacheDir = loc.value(QStringLiteral("mediaCacheDir")).toString();
                           statusBar()->showMessage(
                               QStringLiteral("Data: %1 | Media: %2").arg(dataDir).arg(mediaCacheDir), 10000);
                       }
                   });
}

void MainWindow::callChooseDataFolder() {
    backend_->call(QStringLiteral("ChooseDataFolder"), {},
                   [this](QJsonValue result, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       if (result.isString()) {
                           const auto folder = result.toString();
                           if (!folder.isEmpty()) {
                               callSetDataFolder(folder);
                           }
                       }
                   });
}

void MainWindow::callSetDataFolder(const QString &path) {
    backend_->call(QStringLiteral("SetDataFolder"), {path},
                   [this](QJsonValue result, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       if (result.isObject()) {
                           statusBar()->showMessage(QStringLiteral("Data folder will move on restart."), 8000);
                       }
                   });
}

void MainWindow::callUseDefaultDataFolder() {
    backend_->call(QStringLiteral("UseDefaultDataFolder"), {},
                   [this](QJsonValue result, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       if (result.isObject()) {
                           statusBar()->showMessage(QStringLiteral("Using default data folder."), 8000);
                       }
                   });
}

void MainWindow::callRestartApp() {
    backend_->call(QStringLiteral("RestartApp"), {},
                   [this](QJsonValue, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       close();
                   });
}

void MainWindow::callCheckForUpdates() {
    backend_->call(QStringLiteral("CheckForUpdates"), {},
                   [this](QJsonValue result, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       if (result.isObject()) {
                           const auto status = result.toObject();
                           const auto available = status.value(QStringLiteral("updateAvailable")).toBool();
                           const auto latest = status.value(QStringLiteral("latestVersion")).toString();
                           const auto message = status.value(QStringLiteral("message")).toString();
                           if (available) {
                               statusBar()->showMessage(
                                   QStringLiteral("Update available: %1 - %2").arg(latest).arg(message), 10000);
                           } else {
                               statusBar()->showMessage(message, 8000);
                           }
                       }
                   });
}

void MainWindow::callAppVersion() {
    backend_->call(QStringLiteral("AppVersion"), {},
                   [this](QJsonValue result, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       if (result.isString()) {
                           statusBar()->showMessage(QStringLiteral("Version: %1").arg(result.toString()), 8000);
                       }
                   });
}

void MainWindow::callAppBuildInfo() {
    backend_->call(QStringLiteral("AppBuildInfo"), {},
                   [this](QJsonValue result, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       if (result.isObject()) {
                           const auto info = result.toObject();
                           const auto commit = info.value(QStringLiteral("commit")).toString();
                           const auto buildDate = info.value(QStringLiteral("buildDate")).toString();
                           statusBar()->showMessage(
                               QStringLiteral("Commit: %1 | Built: %2").arg(commit).arg(buildDate), 8000);
                       }
                   });
}

void MainWindow::callStorageUsage() {
    backend_->call(QStringLiteral("StorageUsage"), {},
                   [this](QJsonValue result, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       if (result.isObject()) {
                           const auto usage = result.toObject();
                           const qint64 database = static_cast<qint64>(
                               usage.value(QStringLiteral("databaseBytes")).toDouble());
                           const qint64 wal = static_cast<qint64>(
                               usage.value(QStringLiteral("walBytes")).toDouble());
                           statusBar()->showMessage(
                               QStringLiteral("Database: %1 bytes · WAL: %2 bytes").arg(database).arg(wal), 8000);
                       }
                   });
}

void MainWindow::callRoomStorageUsage(const QString &roomID) {
    backend_->call(QStringLiteral("RoomStorageUsage"), {},
                   [this, roomID](QJsonValue result, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       if (result.isArray()) {
                           qint64 textBytes = 0;
                           qint64 mediaBytes = 0;
                           int messages = 0;
                           for (const auto &entry : result.toArray()) {
                               const auto usage = entry.toObject();
                               if (!roomID.isEmpty()
                                   && usage.value(QStringLiteral("roomId")).toString() != roomID) {
                                   continue;
                               }
                               textBytes += static_cast<qint64>(
                                   usage.value(QStringLiteral("textBytes")).toDouble());
                               mediaBytes += static_cast<qint64>(
                                   usage.value(QStringLiteral("mediaBytes")).toDouble());
                               messages += usage.value(QStringLiteral("messages")).toInt();
                           }
                           statusBar()->showMessage(
                               QStringLiteral("Room storage: %1 messages · %2 text bytes · %3 media bytes")
                                   .arg(messages).arg(textBytes).arg(mediaBytes), 8000);
                       }
                   });
}

void MainWindow::callMediaCacheUsage() {
    backend_->call(QStringLiteral("MediaCacheUsage"), {},
                   [this](QJsonValue result, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       if (result.isObject()) {
                           const auto usage = result.toObject();
                           const auto bytes = static_cast<qint64>(
                               usage.value(QStringLiteral("bytes")).toDouble());
                           const int files = usage.value(QStringLiteral("files")).toInt();
                           statusBar()->showMessage(
                               QStringLiteral("Media cache: %1 bytes across %2 files").arg(bytes).arg(files), 8000);
                       }
                   });
}

void MainWindow::callClearCachedMedia() {
    backend_->call(QStringLiteral("ClearCachedMedia"), {QJsonObject{}},
                   [this](QJsonValue, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       statusBar()->showMessage(QStringLiteral("Cached media cleared."), 8000);
                   });
}

void MainWindow::callClearMediaCache() {
    backend_->call(QStringLiteral("ClearMediaCache"), {},
                   [this](QJsonValue, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       statusBar()->showMessage(QStringLiteral("Media cache cleared."), 8000);
                   });
}

void MainWindow::callNativeNotificationsSupported() {
    backend_->call(QStringLiteral("NativeNotificationsSupported"), {},
                   [this](QJsonValue result, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       const bool supported = result.isBool() && result.toBool();
                       statusBar()->showMessage(
                           supported ? QStringLiteral("Native notifications supported.")
                                     : QStringLiteral("Native notifications not supported."), 8000);
                   });
}

void MainWindow::callNotificationPermission() {
    backend_->call(QStringLiteral("NotificationPermission"), {},
                   [this](QJsonValue result, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       if (result.isString()) {
                           statusBar()->showMessage(
                               QStringLiteral("Notification permission: %1").arg(result.toString()), 8000);
                       }
                   });
}

void MainWindow::callRequestNotificationPermission() {
    backend_->call(QStringLiteral("RequestNotificationPermission"), {},
                   [this](QJsonValue result, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       if (result.isString()) {
                           statusBar()->showMessage(
                               QStringLiteral("Notification permission: %1").arg(result.toString()), 8000);
                       }
                   });
}

void MainWindow::callOpenNotificationSettings() {
    backend_->call(QStringLiteral("OpenNotificationSettings"), {},
                   [this](QJsonValue, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                       }
                   });
}

void MainWindow::callSendNotification(const QJsonObject &alert) {
    QJsonArray params;
    params.append(alert);
    backend_->call(QStringLiteral("SendNotification"), params,
                   [this](QJsonValue result, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       const bool sent = result.isBool() && result.toBool();
                       statusBar()->showMessage(
                           sent ? QStringLiteral("Notification sent.") : QStringLiteral("Notification not sent."), 8000);
                   });
}

void MainWindow::callSubscribeToRoom(const QString &roomID) {
    backend_->call(QStringLiteral("SubscribeToRoom"), {roomID},
                   [this](QJsonValue, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       loadSnapshot();
                   });
}

void MainWindow::callUnsubscribeFromRoom(const QString &roomID) {
    backend_->call(QStringLiteral("UnsubscribeFromRoom"), {roomID},
                   [this](QJsonValue, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                           return;
                       }
                       loadSnapshot();
                   });
}

void MainWindow::callUpdateVisibleRange(const QString &listKey, int startIndex, int endIndex) {
    backend_->call(QStringLiteral("UpdateVisibleRange"), {listKey, startIndex, endIndex},
                   [this](QJsonValue, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                       }
                   });
}

void MainWindow::callSetMenuState(const QString &state) {
    backend_->call(QStringLiteral("SetMenuState"), {state},
                   [this](QJsonValue, const QString &error) {
                       if (!error.isEmpty()) {
                           showError(error);
                       }
                   });
}

// ---- UI action helpers ----

void MainWindow::showPreferences() {
    auto *dialog = new QDialog(this);
    dialog->setAttribute(Qt::WA_DeleteOnClose);
    dialog->setModal(true);
    dialog->setWindowTitle(QStringLiteral("Settings"));
    dialog->resize(700, 500);
    auto *layout = new QVBoxLayout(dialog);

    auto *tabs = new QTabWidget(dialog);

    // Appearance tab
    auto *appearance = new QWidget(tabs);
    auto *appLayout = new QFormLayout(appearance);
    auto *themeCombo = new QComboBox(appearance);
    themeCombo->addItems({QStringLiteral("System default"), QStringLiteral("Light"), QStringLiteral("Dark"),
                          QStringLiteral("VS Code"), QStringLiteral("OLED black"), QStringLiteral("Bosco"),
                          QStringLiteral("Rosa"), QStringLiteral("Dracula"), QStringLiteral("Midnight"),
                          QStringLiteral("Slate"), QStringLiteral("Solarized"), QStringLiteral("Sepia")});
    appLayout->addRow(QStringLiteral("Theme"), themeCombo);

    auto *fontSizeCombo = new QComboBox(appearance);
    fontSizeCombo->addItems({QStringLiteral("Small"), QStringLiteral("Medium"), QStringLiteral("Large")});
    appLayout->addRow(QStringLiteral("Font size"), fontSizeCombo);

    auto *zoomCombo = new QComboBox(appearance);
    zoomCombo->addItems({QStringLiteral("75"), QStringLiteral("80"), QStringLiteral("85"), QStringLiteral("90"),
                         QStringLiteral("95"), QStringLiteral("100"), QStringLiteral("105"), QStringLiteral("110"),
                         QStringLiteral("115"), QStringLiteral("120"), QStringLiteral("125")});
    appLayout->addRow(QStringLiteral("Zoom"), zoomCombo);

    auto *compactCheck = new QCheckBox(QStringLiteral("Compact chat list"), appearance);
    appLayout->addRow(compactCheck);

    auto *roomPreviewsCheck = new QCheckBox(QStringLiteral("Show room previews"), appearance);
    appLayout->addRow(roomPreviewsCheck);

    auto *showTimestampsCheck = new QCheckBox(QStringLiteral("Show timestamps"), appearance);
    appLayout->addRow(showTimestampsCheck);

    tabs->addTab(appearance, QStringLiteral("Appearance"));

    // Notifications tab
    auto *notifications = new QWidget(tabs);
    auto *notifLayout = new QFormLayout(notifications);
    auto *notifEnabled = new QCheckBox(QStringLiteral("Enable notifications"), notifications);
    notifLayout->addRow(notifEnabled);
    auto *notifDirect = new QCheckBox(QStringLiteral("Direct messages"), notifications);
    notifLayout->addRow(notifDirect);
    auto *notifMentions = new QCheckBox(QStringLiteral("Mentions"), notifications);
    notifLayout->addRow(notifMentions);
    auto *notifSound = new QCheckBox(QStringLiteral("Sound"), notifications);
    notifLayout->addRow(notifSound);
    auto *notificationSupport = new QLabel(QStringLiteral("Checking notification support…"), notifications);
    notificationSupport->setWordWrap(true);
    notifLayout->addRow(QStringLiteral("Desktop delivery"), notificationSupport);
    tabs->addTab(notifications, QStringLiteral("Notifications"));

    // AI tab
    auto *aiTab = new QWidget(tabs);
    auto *aiLayout = new QFormLayout(aiTab);
    auto *aiEndpoint = new QLineEdit(aiTab);
    aiEndpoint->setPlaceholderText(QStringLiteral("http://localhost:8080"));
    aiLayout->addRow(QStringLiteral("AI endpoint"), aiEndpoint);
    auto *aiModel = new QLineEdit(aiTab);
    aiModel->setPlaceholderText(QStringLiteral("Model name"));
    aiLayout->addRow(QStringLiteral("AI model"), aiModel);
    auto *testAIButton = new QPushButton(QStringLiteral("Test endpoint"), aiTab);
    aiLayout->addRow(testAIButton);
    tabs->addTab(aiTab, QStringLiteral("AI"));

    // Data tab
    auto *dataTab = new QWidget(tabs);
    auto *dataLayout = new QFormLayout(dataTab);
    auto *dataLocationLabel = new QLabel(dataTab);
    dataLayout->addRow(QStringLiteral("Data location"), dataLocationLabel);
    auto *storageUsageLabel = new QLabel(QStringLiteral("Loading storage usage…"), dataTab);
    storageUsageLabel->setWordWrap(true);
    dataLayout->addRow(QStringLiteral("Storage usage"), storageUsageLabel);
    auto *refreshStorageButton = new QPushButton(QStringLiteral("Refresh storage usage"), dataTab);
    dataLayout->addRow(refreshStorageButton);
    auto *chooseDataButton = new QPushButton(QStringLiteral("Choose data folder…"), dataTab);
    dataLayout->addRow(chooseDataButton);
    auto *useDefaultButton = new QPushButton(QStringLiteral("Use default folder"), dataTab);
    dataLayout->addRow(useDefaultButton);
    auto *clearCacheButton = new QPushButton(QStringLiteral("Clear media cache"), dataTab);
    dataLayout->addRow(clearCacheButton);
    auto *optimizeDatabaseButton = new QPushButton(QStringLiteral("Optimize database"), dataTab);
    dataLayout->addRow(optimizeDatabaseButton);
    tabs->addTab(dataTab, QStringLiteral("Data"));

    // About tab
    auto *aboutTab = new QWidget(tabs);
    auto *aboutLayout = new QFormLayout(aboutTab);
    auto *versionLabel = new QLabel(aboutTab);
    aboutLayout->addRow(QStringLiteral("Version"), versionLabel);
    auto *checkUpdatesButton = new QPushButton(QStringLiteral("Check for updates"), aboutTab);
    aboutLayout->addRow(checkUpdatesButton);
    tabs->addTab(aboutTab, QStringLiteral("About"));
    const QPointer<QLabel> guardedDataLocation(dataLocationLabel);
    const QPointer<QLabel> guardedStorageUsage(storageUsageLabel);
    const QPointer<QLabel> guardedNotificationSupport(notificationSupport);
    const QPointer<QLabel> guardedVersion(versionLabel);

    themeCombo->setCurrentText(preferences_.value(QStringLiteral("appearance.theme"))
                                   .toString(QStringLiteral("System default")));
    fontSizeCombo->setCurrentText(preferences_.value(QStringLiteral("appearance.font_size"))
                                      .toString(QStringLiteral("Medium")));
    zoomCombo->setCurrentText(QString::number(
        preferences_.value(QStringLiteral("appearance.zoom")).toDouble(100)));
    compactCheck->setChecked(preferences_.value(QStringLiteral("sidebar.compact_chat_list")).toBool());
    roomPreviewsCheck->setChecked(
        preferences_.value(QStringLiteral("sidebar.show_previews")).toBool(true));
    showTimestampsCheck->setChecked(
        preferences_.value(QStringLiteral("appearance.show_timestamps")).toBool(true));
    notifEnabled->setChecked(preferences_.value(QStringLiteral("notifications.enabled")).toBool(true));
    notifDirect->setChecked(preferences_.value(QStringLiteral("notifications.direct")).toBool(true));
    notifMentions->setChecked(preferences_.value(QStringLiteral("notifications.mentions")).toBool(true));
    notifSound->setChecked(preferences_.value(QStringLiteral("notifications.sound")).toBool());
    aiEndpoint->setText(preferences_.value(QStringLiteral("ai.endpoint")).toString());
    aiModel->setText(preferences_.value(QStringLiteral("ai.model")).toString());
    backend_->call(QStringLiteral("DataLocation"), {},
                   [guardedDataLocation](QJsonValue result, const QString &error) {
                       if (!guardedDataLocation) {
                           return;
                       }
                       if (!error.isEmpty()) {
                           guardedDataLocation->setText(error);
                           return;
                       }
                       const auto location = result.toObject();
                       guardedDataLocation->setText(location.value(QStringLiteral("dataDir")).toString());
                       guardedDataLocation->setToolTip(
                           QStringLiteral("Media cache: %1")
                               .arg(location.value(QStringLiteral("mediaCacheDir")).toString()));
                   });
    backend_->call(QStringLiteral("AppVersion"), {},
                   [guardedVersion](QJsonValue result, const QString &error) {
                       if (!guardedVersion) {
                           return;
                       }
                       if (error.isEmpty()) {
                           guardedVersion->setText(result.toString());
                       } else {
                           guardedVersion->setText(error);
                       }
                   });
    backend_->call(QStringLiteral("NativeNotificationsSupported"), {},
                   [guardedNotificationSupport](QJsonValue result, const QString &error) {
                       if (!guardedNotificationSupport) {
                           return;
                       }
                       if (!error.isEmpty()) {
                           guardedNotificationSupport->setText(error);
                       } else {
                           guardedNotificationSupport->setText(result.toBool()
                               ? QStringLiteral("Native notifications are available.")
                               : QStringLiteral("Native notifications are not yet supported by the Qt backend."));
                       }
                   });
    const auto refreshStorage = [this, guardedStorageUsage] {
        if (!guardedStorageUsage) {
            return;
        }
        guardedStorageUsage->setText(QStringLiteral("Loading storage usage…"));
        backend_->call(QStringLiteral("StorageUsage"), {},
                       [this, guardedStorageUsage](QJsonValue databaseValue, const QString &databaseError) {
                           if (!guardedStorageUsage) {
                               return;
                           }
                           if (!databaseError.isEmpty()) {
                               guardedStorageUsage->setText(databaseError);
                               return;
                           }
                           const auto database = databaseValue.toObject();
                           const qint64 dbBytes = static_cast<qint64>(
                               database.value(QStringLiteral("databaseBytes")).toDouble());
                           const qint64 walBytes = static_cast<qint64>(
                               database.value(QStringLiteral("walBytes")).toDouble());
                           backend_->call(QStringLiteral("MediaCacheUsage"), {},
                               [guardedStorageUsage, dbBytes, walBytes]
                               (QJsonValue mediaValue, const QString &mediaError) {
                                   if (!guardedStorageUsage) {
                                       return;
                                   }
                                   if (!mediaError.isEmpty()) {
                                       guardedStorageUsage->setText(mediaError);
                                       return;
                                   }
                                   const auto media = mediaValue.toObject();
                                   const qint64 mediaBytes = static_cast<qint64>(
                                       media.value(QStringLiteral("bytes")).toDouble());
                                   const int mediaFiles = media.value(QStringLiteral("files")).toInt();
                                   guardedStorageUsage->setText(
                                       QStringLiteral("Database %1 bytes · WAL %2 bytes · Cached media %3 bytes (%4 files)")
                                           .arg(dbBytes).arg(walBytes).arg(mediaBytes).arg(mediaFiles));
                               });
                       });
    };
    refreshStorage();

    // Connect buttons
    const auto saveStringPreference = [this](const QString &key, const QString &value) {
        backend_->call(QStringLiteral("SetStringPreference"), {key, value},
                       [this](QJsonValue, const QString &error) {
                           if (!error.isEmpty()) {
                               showError(error);
                           } else {
                               loadSnapshot();
                           }
                       });
    };
    const auto saveBooleanPreference = [this](const QString &key, bool value) {
        backend_->call(QStringLiteral("SetBooleanPreference"), {key, value},
                       [this](QJsonValue, const QString &error) {
                           if (!error.isEmpty()) {
                               showError(error);
                           } else {
                               loadSnapshot();
                           }
                       });
    };
    connect(themeCombo, &QComboBox::currentTextChanged, dialog,
            [saveStringPreference](const QString &value) {
                saveStringPreference(QStringLiteral("appearance.theme"), value);
            });
    connect(fontSizeCombo, &QComboBox::currentTextChanged, dialog,
            [saveStringPreference](const QString &value) {
                saveStringPreference(QStringLiteral("appearance.font_size"), value);
            });
    connect(zoomCombo, &QComboBox::currentTextChanged, dialog,
            [saveStringPreference](const QString &value) {
                saveStringPreference(QStringLiteral("appearance.zoom"), value);
            });
    connect(compactCheck, &QCheckBox::toggled, dialog,
            [saveBooleanPreference](bool value) {
                saveBooleanPreference(QStringLiteral("sidebar.compact_chat_list"), value);
            });
    connect(roomPreviewsCheck, &QCheckBox::toggled, dialog,
            [saveBooleanPreference](bool value) {
                saveBooleanPreference(QStringLiteral("sidebar.show_previews"), value);
            });
    connect(showTimestampsCheck, &QCheckBox::toggled, dialog,
            [saveBooleanPreference](bool value) {
                saveBooleanPreference(QStringLiteral("appearance.show_timestamps"), value);
            });
    connect(notifEnabled, &QCheckBox::toggled, dialog,
            [saveBooleanPreference](bool value) {
                saveBooleanPreference(QStringLiteral("notifications.enabled"), value);
            });
    connect(notifDirect, &QCheckBox::toggled, dialog,
            [saveBooleanPreference](bool value) {
                saveBooleanPreference(QStringLiteral("notifications.direct"), value);
            });
    connect(notifMentions, &QCheckBox::toggled, dialog,
            [saveBooleanPreference](bool value) {
                saveBooleanPreference(QStringLiteral("notifications.mentions"), value);
            });
    connect(notifSound, &QCheckBox::toggled, dialog,
            [saveBooleanPreference](bool value) {
                saveBooleanPreference(QStringLiteral("notifications.sound"), value);
            });
    connect(aiEndpoint, &QLineEdit::editingFinished, dialog,
            [aiEndpoint, saveStringPreference] {
                saveStringPreference(QStringLiteral("ai.endpoint"), aiEndpoint->text().trimmed());
            });
    connect(aiModel, &QLineEdit::editingFinished, dialog,
            [aiModel, saveStringPreference] {
                saveStringPreference(QStringLiteral("ai.model"), aiModel->text().trimmed());
            });
    connect(testAIButton, &QPushButton::clicked, this, [this] {
        callTestAIEndpoint();
    });
    connect(chooseDataButton, &QPushButton::clicked, dialog, [this] {
        const QString path = QFileDialog::getExistingDirectory(this, QStringLiteral("Choose data folder"));
        if (path.isEmpty()) {
            return;
        }
        backend_->call(QStringLiteral("SetDataFolder"), {path},
                       [this](QJsonValue, const QString &error) {
                           if (!error.isEmpty()) {
                               showError(error);
                               return;
                           }
                           QMessageBox::information(this, QStringLiteral("Data folder"),
                               QStringLiteral("The data folder will be changed after restarting Pinger."));
                       });
    });
    connect(useDefaultButton, &QPushButton::clicked, this, &MainWindow::callUseDefaultDataFolder);
    connect(clearCacheButton, &QPushButton::clicked, dialog, [this] {
        if (QMessageBox::question(this, QStringLiteral("Clear media cache"),
                                  QStringLiteral("Remove all cached media? Messages will remain, but media may need to be downloaded again."))
            != QMessageBox::Yes) {
            return;
        }
        callClearMediaCache();
    });
    connect(refreshStorageButton, &QPushButton::clicked, dialog, refreshStorage);
    connect(optimizeDatabaseButton, &QPushButton::clicked, dialog, [this] {
        if (QMessageBox::question(this, QStringLiteral("Optimize database"),
                                  QStringLiteral("Optimize the active account database now?"))
            != QMessageBox::Yes) {
            return;
        }
        backend_->call(QStringLiteral("OptimizeDatabase"), {},
                       [this](QJsonValue, const QString &error) {
                           if (!error.isEmpty()) {
                               showError(error);
                           } else {
                               statusBar()->showMessage(QStringLiteral("Database optimized."), 8000);
                           }
                       });
    });
    connect(checkUpdatesButton, &QPushButton::clicked, this, &MainWindow::callCheckForUpdates);

    auto *buttonBox = new QDialogButtonBox(QDialogButtonBox::Close, dialog);
    layout->addWidget(tabs);
    layout->addWidget(buttonBox);
    connect(buttonBox, &QDialogButtonBox::rejected, dialog, &QDialog::reject);

    dialog->exec();
}

void MainWindow::showAIDialog() {
    auto *dialog = new QDialog(this);
    dialog->setAttribute(Qt::WA_DeleteOnClose);
    dialog->setModal(true);
    dialog->setWindowTitle(QStringLiteral("AI Features"));
    dialog->resize(600, 400);
    auto *layout = new QVBoxLayout(dialog);

    auto *list = new QListWidget(dialog);
    list->addItem(QStringLiteral("Ask AI"));
    list->addItem(QStringLiteral("Suggest replies"));
    list->addItem(QStringLiteral("Generate reply draft"));
    list->addItem(QStringLiteral("Detect chat language"));
    list->addItem(QStringLiteral("Analyze draft tone"));
    list->addItem(QStringLiteral("Transcribe selected audio"));
    list->addItem(QStringLiteral("Generate room image"));
    auto *status = new QLabel(QStringLiteral("Choose an AI action."), dialog);
    status->setWordWrap(true);
    auto *runButton = new QPushButton(QStringLiteral("Run"), dialog);
    runButton->setEnabled(false);
    layout->addWidget(list);
    layout->addWidget(status);

    auto *buttonBox = new QDialogButtonBox(QDialogButtonBox::Close, dialog);
    buttonBox->addButton(runButton, QDialogButtonBox::ActionRole);
    layout->addWidget(buttonBox);
    connect(buttonBox, &QDialogButtonBox::rejected, dialog, &QDialog::reject);
    connect(list, &QListWidget::currentRowChanged, runButton, [runButton](int row) {
        runButton->setEnabled(row >= 0);
    });
    connect(runButton, &QPushButton::clicked, dialog, [this, dialog, list, status, runButton] {
        const int action = list->currentRow();
        if (action < 0) {
            return;
        }
        const QString roomID = currentRoomID_;
        const QString requestID = QUuid::createUuid().toString(QUuid::WithoutBraces);
        runButton->setEnabled(false);
        status->setText(QStringLiteral("Working…"));
        if (action == 0) {
            bool accepted = false;
            const QString prompt = QInputDialog::getMultiLineText(
                dialog, QStringLiteral("Ask AI"), QStringLiteral("Question"), {}, &accepted).trimmed();
            if (!accepted || prompt.isEmpty()) {
                status->setText(QStringLiteral("Choose an AI action."));
                runButton->setEnabled(true);
                return;
            }
            const QJsonArray messages{QJsonObject{
                {QStringLiteral("role"), QStringLiteral("user")},
                {QStringLiteral("content"), prompt},
            }};
            backend_->call(QStringLiteral("AIComplete"),
                           {messages, requestID, 0.7, 1000},
                           [this, status, runButton](QJsonValue value, const QString &error) {
                               if (!status || !runButton) {
                                   return;
                               }
                               runButton->setEnabled(true);
                               if (!error.isEmpty()) {
                                   status->setText(error);
                                   return;
                               }
                               status->setText(value.toString());
                           });
        } else if (action == 1 || action == 2) {
            if (roomID.isEmpty()) {
                status->setText(QStringLiteral("Select a room first."));
                runButton->setEnabled(true);
                return;
            }
            const QString method = action == 1
                ? QStringLiteral("AISuggestReplies")
                : QStringLiteral("AIGenerateReplyDraft");
            backend_->call(method, {roomID, requestID},
                           [this, dialog, status, runButton, roomID, action]
                           (QJsonValue value, const QString &error) {
                               if (!status || !runButton) {
                                   return;
                               }
                               runButton->setEnabled(true);
                               if (!error.isEmpty()) {
                                   status->setText(error);
                                   return;
                               }
                               if (currentRoomID_ != roomID) {
                                   status->setText(QStringLiteral("The active room changed."));
                                   return;
                               }
                               if (action == 2) {
                                   const QString draft = value.toString().trimmed();
                                   if (draft.isEmpty()) {
                                       status->setText(QStringLiteral("The AI returned an empty draft."));
                                       return;
                                   }
                                   composer_->setPlainText(draft);
                                   setComposeContext(QStringLiteral("AI-generated reply draft"));
                                   status->setText(QStringLiteral("Draft added to the composer."));
                                   return;
                               }
                               const auto suggestions = value.toObject()
                                   .value(QStringLiteral("suggestions")).toArray();
                               QStringList choices;
                               for (const auto &entry : suggestions) {
                                   const auto suggestion = entry.toObject();
                                   const QString text = suggestion.value(QStringLiteral("text")).toString().trimmed();
                                   if (!text.isEmpty()) {
                                       choices.append(QStringLiteral("%1: %2")
                                           .arg(suggestion.value(QStringLiteral("tone")).toString(), text));
                                   }
                               }
                               if (choices.isEmpty()) {
                                   status->setText(QStringLiteral("The AI returned no reply suggestions."));
                                   return;
                               }
                               bool accepted = false;
                               const QString selected = QInputDialog::getItem(
                                   dialog, QStringLiteral("Suggested replies"),
                                   QStringLiteral("Choose a reply draft"), choices, 0, false, &accepted);
                               if (!accepted) {
                                   status->setText(QStringLiteral("Suggestions were not added."));
                                   return;
                               }
                               const qsizetype separator = selected.indexOf(QStringLiteral(": "));
                               composer_->setPlainText(separator >= 0 ? selected.mid(separator + 2) : selected);
                               clearComposeContext();
                               status->setText(QStringLiteral("Reply added to the composer as a draft."));
                           });
        } else if (action == 3) {
            if (roomID.isEmpty()) {
                status->setText(QStringLiteral("Select a room first."));
                runButton->setEnabled(true);
                return;
            }
            backend_->call(QStringLiteral("AIDetectChatLanguage"), {roomID, requestID},
                           [status, runButton](QJsonValue value, const QString &error) {
                               if (!status || !runButton) {
                                   return;
                               }
                               runButton->setEnabled(true);
                               status->setText(error.isEmpty()
                                   ? QStringLiteral("Detected language: %1").arg(value.toString())
                                   : error);
                           });
        } else if (action == 4) {
            const QString draft = composer_->toPlainText().trimmed();
            if (draft.isEmpty()) {
                status->setText(QStringLiteral("Write a draft in the composer first."));
                runButton->setEnabled(true);
                return;
            }
            backend_->call(QStringLiteral("CheckMessageTone"),
                           {QJsonArray{QJsonObject{
                               {QStringLiteral("role"), QStringLiteral("user")},
                               {QStringLiteral("content"), draft},
                           }}},
                           [status, runButton](QJsonValue value, const QString &error) {
                               if (!status || !runButton) {
                                   return;
                               }
                               runButton->setEnabled(true);
                               status->setText(error.isEmpty()
                                   ? value.toString()
                                   : error);
                           });
        } else if (action == 5) {
            auto *item = messages_->currentItem();
            const auto message = item
                ? messagesByID_.value(item->data(Qt::UserRole).toString())
                : QJsonObject{};
            const QString mediaURI = message.value(QStringLiteral("mediaUri")).toString();
            if (mediaURI.isEmpty()) {
                status->setText(QStringLiteral("Select an audio message in the timeline first."));
                runButton->setEnabled(true);
                return;
            }
            const QString filename = message.value(QStringLiteral("body")).toString();
            const QString contentType = message.value(QStringLiteral("mediaMime")).toString();
            backend_->call(QStringLiteral("AITranscribeMedia"),
                           {mediaURI, filename, contentType},
                           [this, roomID, status, runButton](QJsonValue value, const QString &error) {
                               if (!status || !runButton) {
                                   return;
                               }
                               runButton->setEnabled(true);
                               if (!error.isEmpty()) {
                                   status->setText(error);
                               } else if (roomID != currentRoomID_) {
                                   status->setText(QStringLiteral("The active room changed."));
                               } else {
                                   const QString transcript = value.toString().trimmed();
                                   composer_->setPlainText(transcript);
                                   composer_->setFocus();
                                   status->setText(QStringLiteral("Transcript added to the composer as a draft."));
                               }
                           });
        } else {
            bool accepted = false;
            const QString prompt = QInputDialog::getMultiLineText(
                dialog, QStringLiteral("Generate room image"), QStringLiteral("Describe the image"), {},
                &accepted).trimmed();
            if (!accepted || prompt.isEmpty()) {
                status->setText(QStringLiteral("Choose an AI action."));
                runButton->setEnabled(true);
                return;
            }
            if (roomID.isEmpty()) {
                status->setText(QStringLiteral("Select a room first."));
                runButton->setEnabled(true);
                return;
            }
            backend_->call(QStringLiteral("GenerateRoomImage"), {prompt, requestID},
                           [this, dialog, status, runButton, roomID]
                           (QJsonValue value, const QString &error) {
                               if (!status || !runButton) {
                                   return;
                               }
                               runButton->setEnabled(true);
                               if (!error.isEmpty()) {
                                   status->setText(error);
                                   return;
                               }
                               if (currentRoomID_ != roomID) {
                                   status->setText(QStringLiteral("The active room changed."));
                                   return;
                               }
                               const QByteArray encoded = value.toString().toLatin1();
                               QPixmap image;
                               if (!image.loadFromData(QByteArray::fromBase64(encoded))) {
                                   status->setText(QStringLiteral("The generated image could not be previewed."));
                                   return;
                               }
                               QDialog preview(dialog);
                               preview.setWindowTitle(QStringLiteral("Review generated image"));
                               auto *previewLayout = new QVBoxLayout(&preview);
                               auto *imageLabel = new QLabel(&preview);
                               imageLabel->setAlignment(Qt::AlignCenter);
                               imageLabel->setPixmap(image.scaled(640, 480, Qt::KeepAspectRatio,
                                                                   Qt::SmoothTransformation));
                               auto *buttons = new QDialogButtonBox(
                                   QDialogButtonBox::Yes | QDialogButtonBox::No, &preview);
                               buttons->button(QDialogButtonBox::Yes)->setText(QStringLiteral("Send to room"));
                               buttons->button(QDialogButtonBox::No)->setText(QStringLiteral("Discard"));
                               previewLayout->addWidget(imageLabel);
                               previewLayout->addWidget(buttons);
                               connect(buttons, &QDialogButtonBox::accepted, &preview, &QDialog::accept);
                               connect(buttons, &QDialogButtonBox::rejected, &preview, &QDialog::reject);
                               if (preview.exec() != QDialog::Accepted) {
                                   status->setText(QStringLiteral("Generated image discarded."));
                                   return;
                               }
                               if (currentRoomID_ != roomID) {
                                   status->setText(QStringLiteral("The active room changed; image was not sent."));
                                   return;
                               }
                               backend_->call(QStringLiteral("SendRoomImage"), {roomID, QString::fromLatin1(encoded)},
                                              [status](QJsonValue, const QString &sendError) {
                                                  if (status) {
                                                      status->setText(sendError.isEmpty()
                                                          ? QStringLiteral("Image sent.")
                                                          : sendError);
                                                  }
                                              });
                           });
        }
    });

    dialog->exec();
}

void MainWindow::showScheduledDialog() {
    auto *dialog = new QDialog(this);
    dialog->setAttribute(Qt::WA_DeleteOnClose);
    dialog->setModal(true);
    dialog->setWindowTitle(QStringLiteral("Scheduled Messages"));
    dialog->resize(600, 400);
    auto *layout = new QVBoxLayout(dialog);

    auto *list = new QListWidget(dialog);
    layout->addWidget(list);

    auto *buttonLayout = new QHBoxLayout;
    auto *refreshButton = new QPushButton(QStringLiteral("Refresh"), dialog);
    auto *closeButton = new QPushButton(QStringLiteral("Close"), dialog);
    buttonLayout->addStretch();
    buttonLayout->addWidget(refreshButton);
    buttonLayout->addWidget(closeButton);

    layout->addLayout(buttonLayout);

    connect(refreshButton, &QPushButton::clicked, this, &MainWindow::callScheduledJobs);
    connect(closeButton, &QPushButton::clicked, dialog, &QDialog::reject);

    callScheduledJobs();

    dialog->exec();
}

void MainWindow::showLocalAIChatDialog() {
    LocalAIChatDialog dialog(backend_, QString(), this);
    dialog.exec();
}

void MainWindow::showExportDialog() {
    auto *dialog = new QDialog(this);
    dialog->setAttribute(Qt::WA_DeleteOnClose);
    dialog->setModal(true);
    dialog->setWindowTitle(QStringLiteral("Export Chats"));
    dialog->resize(500, 300);
    auto *layout = new QVBoxLayout(dialog);

    auto *roomCombo = new QComboBox(dialog);
    layout->addWidget(new QLabel(QStringLiteral("Select room to export:"), dialog));
    layout->addWidget(roomCombo);

    auto *exportButton = new QPushButton(QStringLiteral("Export room chat…"), dialog);
    auto *bulkButton = new QPushButton(QStringLiteral("Export all chats…"), dialog);
    auto *closeButton = new QPushButton(QStringLiteral("Close"), dialog);
    layout->addWidget(exportButton);
    layout->addWidget(bulkButton);
    layout->addWidget(closeButton);

    connect(closeButton, &QPushButton::clicked, dialog, &QDialog::reject);

    // Populate rooms
    const auto rooms = snapshot_.value(QStringLiteral("rooms")).toArray();
    for (const auto &entry : rooms) {
        const auto room = entry.toObject();
        const auto roomID = room.value(QStringLiteral("id")).toString();
        const auto name = room.value(QStringLiteral("name")).toString(roomID);
        roomCombo->addItem(name, roomID);
    }

    connect(exportButton, &QPushButton::clicked, this, [this, roomCombo] {
        const auto roomID = roomCombo->currentData().toString();
        if (roomID.isEmpty()) return;
        bool ok = false;
        auto dir = QFileDialog::getExistingDirectory(this, QStringLiteral("Select export folder"));
        if (!dir.isEmpty()) {
            callExportRoomChat(roomID, dir);
        }
    });

    connect(bulkButton, &QPushButton::clicked, this, [this] {
        bool ok = false;
        auto dir = QFileDialog::getExistingDirectory(this, QStringLiteral("Select export folder"));
        if (!dir.isEmpty()) {
            QJsonObject options;
            options[QStringLiteral("privateChats")] = true;
            options[QStringLiteral("groupChats")] = true;
            options[QStringLiteral("myMessages")] = true;
            options[QStringLiteral("theirMessages")] = true;
            options[QStringLiteral("deletedMessages")] = false;
            callExportRecentMessagesForAllChats(dir, 1000, options);
        }
    });

    dialog->exec();
}
