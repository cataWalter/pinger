#pragma once

#include <QByteArray>
#include <QDialog>
#include <QJsonArray>
#include <QJsonObject>
#include <QJsonValue>
#include <QList>
#include <QString>
#include <QVector>

#include <functional>

class BackendClient;
class QComboBox;
class QLabel;
class QLineEdit;
class QListWidget;
class QPlainTextEdit;
class QPushButton;

class LocalAIChatDialog final : public QDialog {
    Q_OBJECT

public:
    LocalAIChatDialog(BackendClient *backend, const QString &defaultAgentId,
                      QWidget *parent = nullptr, bool contentBlur = false);

private:
    void buildUi();
    void loadChats();
    void loadFolders();
    void selectChat(const QString &chatId);
    void loadMessages();
    void appendMessage(const QJsonObject &message);
    void newChat();
    void renameChat();
    void deleteChat();
    void exportChat();
    void createFolder();
    void renameFolder();
    void deleteFolder();
    void moveSelectedChat();
    void attachImages();
    void send();
    void stop();
    void generateImage();
    void setStatus(const QString &text);
    void call(const QString &method, const QJsonArray &params,
              const std::function<void(const QJsonValue &, const QString &)> &completion);
    QJsonObject messageObject(const QString &role, const QString &content,
                              const QJsonArray &attachments) const;
    QString newRequestId();

    BackendClient *backend_ = nullptr;
    QString defaultAgentId_;
    QListWidget *chatList_ = nullptr;
    QComboBox *folderFilter_ = nullptr;
    QListWidget *folders_ = nullptr;
    QListWidget *transcript_ = nullptr;
    QPlainTextEdit *composer_ = nullptr;
    QLineEdit *imagePrompt_ = nullptr;
    QLabel *status_ = nullptr;
    QPushButton *sendButton_ = nullptr;
    QPushButton *stopButton_ = nullptr;
    QPushButton *imageButton_ = nullptr;
    QPushButton *attachButton_ = nullptr;
    QString currentChatId_;
    QString currentFolderId_;
    QVector<QJsonObject> messages_;
    QVector<QJsonObject> pendingImages_;
    QString activeRequest_;
    QString streamingText_;
    quint64 messageLoadRequest_ = 0;
};