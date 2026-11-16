#pragma once

#include <QHash>
#include <QIcon>
#include <functional>
#include <QJsonArray>
#include <QJsonObject>
#include <QMainWindow>
#include <QPoint>
#include <QString>

class BackendClient;
class MediaClient;
class QCloseEvent;
class QKeyEvent;
class QMenu;
class QSystemTrayIcon;
class QComboBox;
class QDialog;
class QLineEdit;
class QLabel;
class QListWidget;
class QPlainTextEdit;
class QPushButton;
class QStackedWidget;
class QTimer;
class QWidget;

class MainWindow final : public QMainWindow {
    Q_OBJECT

public:
    explicit MainWindow(BackendClient *backend, QWidget *parent = nullptr);

protected:
    void closeEvent(QCloseEvent *event) override;
    void keyPressEvent(QKeyEvent *event) override;

private:
    void buildLoginPage();
    void buildVerificationPage();
    void buildChatPage();
    void loadSnapshot();
    void applySnapshot(const QJsonObject &snapshot);
    void filterRooms();
    void switchRoom(const QString &roomID);
    void updateActiveRoom(const QString &roomID);
    void loadHistory(const QString &roomID, qint64 before = 0);
    void sendMessage();
    void attachFile();
    void showMessageContextMenu(const QPoint &position);
    void runMessageAction(const QString &method, const QJsonArray &params);
    void openMediaPreview(const QString &eventID);
    void setComposeContext(const QString &label);
    void clearComposeContext();
    void updateRoomFilter(const QString &filter);
    void showRoomContextMenu(const QPoint &position);
    void showMediaGallery(const QString &roomID);
    void exportRoomChat(const QString &roomID);
    void saveMedia(const QJsonObject &message, bool openAfterSave = false);
    void joinRoom();
    void scheduleMessage();
    void scheduleReminder(const QString &eventID);
    void openScheduledJobs();
    void startDirectChat();
    void createGroupRoom();
    void showRoomDetails(const QString &roomID);
    void addAccount();
    void showDevices();
    void switchAccount(const QString &accountID);
    void searchMessages();
    void openThread(const QString &rootID);
    void runRoomAction(const QString &method, const QJsonArray &params);
    QJsonObject roomByID(const QString &roomID) const;
    bool roomIsArchived(const QJsonObject &room) const;
    QString archivePreferenceKey(const QJsonObject &room) const;
    void showError(const QString &message);
    void showPreferences();
    void showAIDialog();
    void showScheduledDialog();
    void showLocalAIChatDialog();
    void showExportDialog();
    void updateTrayIcon();
    void showQuickSwitcher();
    bool handleApplicationKey(QKeyEvent *event);
    void selectRoomByOffset(int direction, bool needsReplyOnly = false);
    void applyRoomShortcut(const QString &key);

    // ---- Backend call wrappers (part 1) ----
    void callSnapshot();
    void callLogin(const QString &homeserver, const QString &username, const QString &password);
    void callVerify(const QString &recoveryKey);
    void callLogout();
    void callAcceptInvite(const QString &roomID);
    void callDeclineInvite(const QString &roomID);
    void callSwitchAccount(const QString &accountID);
    void callAddAccount(const QString &homeserver, const QString &username, const QString &password);
    void callJoinRoom(const QString &target);
    void callStartDirectChat(const QString &userID);
    void callCreateGroupRoom(const QJsonObject &request);
    void callLeaveRoom(const QString &roomID);
    void callSetActiveRoom(const QString &roomID);
    void callHistory(const QString &roomID, qint64 before);
    void callMarkRead(const QString &roomID, const QString &eventID);
    void callMarkUnread(const QString &roomID);
    void callSendMessage(const QString &roomID, const QString &text);
    void callSendMessageWithMentions(const QString &roomID, const QString &text, const QStringList &userIDs);
    void callSendReply(const QString &roomID, const QString &text, const QString &replyTo);
    void callThreadMessages(const QString &roomID, const QString &rootID);
    void callSendThreadReply(const QString &roomID, const QString &text, const QString &rootID);
    void callEditMessage(const QString &roomID, const QString &text, const QString &eventID);
    void callReact(const QString &roomID, const QString &eventID, const QString &emoji);
    void callRemoveReaction(const QString &roomID, const QString &eventID, const QString &emoji);
    void callRedactMessage(const QString &roomID, const QString &eventID);
    void callRetryMessage(const QString &transactionID);
    void callSetTyping(const QString &roomID, qint64 timeoutMilliseconds);
    void callSetBooleanPreference(const QString &key, bool value);
    void callSetStringPreference(const QString &key, const QString &value);
    void callSetStringPreferences(const QJsonObject &values);
    void callDevices();
    void callRevokeDevice(const QString &deviceID, const QString &password);
    void callRoomMembers(const QString &roomID);
    void callInviteToRoom(const QString &roomID, const QStringList &userIDs);
    void callSearchMessages(const QString &query, const QString &roomID, const QString &sender,
                            qint64 minTs, qint64 maxTs, int limit, const QString &nextBatch);
    void callURLPreview(const QString &link);
    void callOpenExternalURL(const QString &url);
    void callRevealFile(const QString &path);
    void callSaveMedia(const QString &mxc, const QString &filename);
    void callExportRoomChat(const QString &roomID, const QString &parentDirectory);
    void callCancelChatExport();
    void callExportRecentMessagesForAllChats(const QString &parentDirectory, int limit,
                                             const QJsonObject &options);
    void callScheduledJobs();
    void callScheduleMessage(const QString &roomID, const QString &text, qint64 dueAt);
    void callScheduleReply(const QString &roomID, const QString &text, const QString &replyTo, qint64 dueAt);
    void callScheduleReminder(const QString &roomID, const QString &eventID, const QString &text, qint64 dueAt);
    void callUpdateScheduledJob(const QString &id, qint64 dueAt);
    void callCancelScheduledJob(const QString &id);
    void callRetryScheduledMessage(const QString &id);
    void callDismissScheduledJob(const QString &id);
    void callAIComplete(const QJsonArray &messages, const QString &requestID, double temperature, int maxTokens);
    void callAICancel(const QString &requestID);
    void callAISuggestReplies(const QString &roomID, const QString &requestID);
    void callAIGenerateReplyDraft(const QString &roomID, const QString &requestID);
    void callAIDetectChatLanguage(const QString &roomID, const QString &requestID);
    void callAITranscribeMedia(const QString &mxcURI, const QString &filename, const QString &contentType);
    void callTestAIEndpoint();
    void callCheckMessageTone(const QJsonArray &messages);
    void callAIFeatureDefaults();
    void callLanguageTutorAnalyze(const QString &text, const QString &mode, const QString &learning,
                                  const QString &explanation, const QString &requestID);
    void callListLocalAIChats();
    void callCreateLocalAIChat(const QString &agentID, const QString &kind);
    void callDeleteLocalAIChat(const QString &chatID);
    void callLoadLocalAIChatMessages(const QString &chatID);
    void callAppendLocalAIChatMessage(const QString &chatID, const QJsonObject &message);
    void callTruncateLocalAIChat(const QString &chatID, int fromSeq);
    void callRenameLocalAIChat(const QString &chatID, const QString &title);
    void callSetLocalAIChatAgent(const QString &chatID, const QString &agentID);
    void callSetLocalAIChatFolder(const QString &chatID, const QString &folderID);
    void callListLocalAIChatFolders();
    void callCreateLocalAIChatFolder(const QString &name);
    void callRenameLocalAIChatFolder(const QString &folderID, const QString &name);
    void callDeleteLocalAIChatFolder(const QString &folderID);
    void callExportLocalAIChat(const QString &filename, const QString &content);
    void callLocalAIChatGenerateImage(const QString &chatID, const QString &prompt, const QString &requestID);
    void callGenerateRoomImage(const QString &prompt, const QString &requestID);
    void callDataLocation();
    void callChooseDataFolder();
    void callSetDataFolder(const QString &path);
    void callUseDefaultDataFolder();
    void callRestartApp();
    void callCheckForUpdates();
    void callAppVersion();
    void callAppBuildInfo();
    void callStorageUsage();
    void callRoomStorageUsage(const QString &roomID);
    void callMediaCacheUsage();
    void callClearCachedMedia();
    void callClearMediaCache();
    void callNativeNotificationsSupported();
    void callNotificationPermission();
    void callRequestNotificationPermission();
    void callOpenNotificationSettings();
    void callSendNotification(const QJsonObject &alert);
    void callSubscribeToRoom(const QString &roomID);
    void callUnsubscribeFromRoom(const QString &roomID);
    void callUpdateVisibleRange(const QString &listKey, int startIndex, int endIndex);
    void callSetMenuState(const QString &state);

    BackendClient *backend_;
    MediaClient *media_ = nullptr;
    QStackedWidget *pages_ = nullptr;
    QWidget *loginPage_ = nullptr;
    QWidget *verificationPage_ = nullptr;
    QWidget *chatPage_ = nullptr;
    QLineEdit *homeserver_ = nullptr;
    QLineEdit *username_ = nullptr;
    QLineEdit *password_ = nullptr;
    QLineEdit *recoveryKey_ = nullptr;
    QLineEdit *roomFilter_ = nullptr;
    QComboBox *roomScope_ = nullptr;
    QLabel *inviteLabel_ = nullptr;
    QListWidget *rooms_ = nullptr;
    QListWidget *invites_ = nullptr;
    QListWidget *messages_ = nullptr;
    QPlainTextEdit *composer_ = nullptr;
    QLabel *roomTitle_ = nullptr;
    QLabel *composeContext_ = nullptr;
    QPushButton *loginButton_ = nullptr;
    QPushButton *verifyButton_ = nullptr;
    QPushButton *logoutButton_ = nullptr;
    QPushButton *joinRoomButton_ = nullptr;
    QPushButton *directChatButton_ = nullptr;
    QPushButton *createGroupButton_ = nullptr;
    QPushButton *scheduledJobsButton_ = nullptr;
    QPushButton *preferencesButton_ = nullptr;
    QPushButton *aiButton_ = nullptr;
    QPushButton *localAIButton_ = nullptr;
    QPushButton *exportButton_ = nullptr;
    QPushButton *searchMessagesButton_ = nullptr;
    QPushButton *sendButton_ = nullptr;
    QPushButton *attachButton_ = nullptr;
    QPushButton *scheduleMessageButton_ = nullptr;
    QPushButton *cancelComposeContextButton_ = nullptr;
    QPushButton *acceptInviteButton_ = nullptr;
    QPushButton *declineInviteButton_ = nullptr;
    QPushButton *addAccountButton_ = nullptr;
    QPushButton *devicesButton_ = nullptr;
    QComboBox *accountSwitcher_ = nullptr;
    QSystemTrayIcon *trayIcon_ = nullptr;
    QMenu *trayMenu_ = nullptr;
    QJsonObject snapshot_;
    QJsonObject preferences_;
    QString currentRoomID_;
    QString replyToEventID_;
    QString editEventID_;
    QString activeRoomSubscription_;
    QString pendingRoomID_;
    QString pendingNotificationRoomID_;
    QString pendingNotificationAccountID_;
    QHash<QString, QJsonObject> messagesByID_;
    QHash<QString, QString> readRequests_;
    QHash<QString, QString> roomDrafts_;
    quint64 historyRequestID_ = 0;
    qint64 historyBefore_ = 0;
    QTimer *refreshTimer_ = nullptr;
    bool initialWindowStateApplied_ = false;
};
