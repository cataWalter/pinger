#include "localaichatdialog.h"

#include "backendclient.h"
#include "chatitemdelegate.h"
#include "qtutil.h"
#include "stylesheet.h"

#include <QComboBox>
#include <QDialogButtonBox>
#include <QFile>
#include <QFileDialog>
#include <QFileInfo>
#include <QFormLayout>
#include <QHBoxLayout>
#include <QIcon>
#include <QImage>
#include <QInputDialog>
#include <QJsonArray>
#include <QJsonDocument>
#include <QLabel>
#include <QLineEdit>
#include <QListWidget>
#include <QListWidgetItem>
#include <QMessageBox>
#include <QPixmap>
#include <QPlainTextEdit>
#include <QPushButton>
#include <QSignalBlocker>
#include <QTextStream>
#include <QUuid>
#include <QVBoxLayout>

LocalAIChatDialog::LocalAIChatDialog(BackendClient *backend, const QString &defaultAgentId,
                                     QWidget *parent, bool contentBlur)
    : QDialog(parent), backend_(backend), defaultAgentId_(defaultAgentId) {
    setWindowTitle(QStringLiteral("Private model chat"));
    resize(900, 660);
    buildUi();
    if (contentBlur) {
        auto *chatListDelegate = new PrivacyBlurDelegate(chatList_);
        chatListDelegate->setContentBlur(true);
        chatList_->setItemDelegate(chatListDelegate);
        auto *transcriptDelegate = new PrivacyBlurDelegate(transcript_);
        transcriptDelegate->setContentBlur(true);
        transcript_->setItemDelegate(transcriptDelegate);
        chatList_->setMouseTracking(true);
        chatList_->viewport()->setMouseTracking(true);
        transcript_->setMouseTracking(true);
        transcript_->viewport()->setMouseTracking(true);
    }
    configureListViews(this);
    loadFolders();
    loadChats();

    connect(backend_, &BackendClient::eventReceived, this,
            [this](const QString &event, const QJsonValue &data) {
        if (!data.isObject()) {
            return;
        }
        const QJsonObject object = data.toObject();
        const QString requestId = qtutil::stringValue(object, "requestId");
        if (requestId != activeRequest_ || requestId.isEmpty()) {
            return;
        }
        if (event == QStringLiteral("local-ai:stream")) {
            streamingText_ += qtutil::stringValue(object, "text");
            setStatus(QStringLiteral("Streaming reply… (%1 characters)").arg(streamingText_.size()));
            return;
        }
        if (event == QStringLiteral("local-ai:image-progress")) {
            const QString stage = qtutil::stringValue(object, "stage");
            const int step = qtutil::intValue(object, "step");
            const int total = qtutil::intValue(object, "totalSteps");
            setStatus(total > 0 ? QStringLiteral("Generating image: %1/%2")
                                    .arg(step)
                                    .arg(total)
                                : QStringLiteral("Generating image (%1)").arg(stage));
        }
    });
}

void LocalAIChatDialog::buildUi() {
    auto *layout = new QHBoxLayout(this);
    auto *sidebar = new QWidget(this);
    sidebar->setMaximumWidth(310);
    sidebar->setMinimumWidth(240);
    auto *sidebarLayout = new QVBoxLayout(sidebar);
    auto *topButtons = new QHBoxLayout;
    auto *newChat = new QPushButton(QStringLiteral("New"), sidebar);
    auto *rename = new QPushButton(QStringLiteral("Rename"), sidebar);
    auto *remove = new QPushButton(QStringLiteral("Delete"), sidebar);
    topButtons->addWidget(newChat);
    topButtons->addWidget(rename);
    topButtons->addWidget(remove);
    sidebarLayout->addLayout(topButtons);

    folderFilter_ = new QComboBox(sidebar);
    sidebarLayout->addWidget(folderFilter_);
    connect(folderFilter_, qOverload<int>(&QComboBox::currentIndexChanged), this, [this](int) {
        loadChats();
    });

    chatList_ = new QListWidget(sidebar);
    sidebarLayout->addWidget(chatList_, 1);

    folders_ = new QListWidget(sidebar);
    folders_->setMaximumHeight(140);
    sidebarLayout->addWidget(new QLabel(QStringLiteral("Folders"), sidebar));
    sidebarLayout->addWidget(folders_);
    auto *folderButtons = new QHBoxLayout;
    auto *newFolder = new QPushButton(QStringLiteral("New folder"), sidebar);
    auto *renameFolder = new QPushButton(QStringLiteral("Rename"), sidebar);
    auto *deleteFolder = new QPushButton(QStringLiteral("Delete"), sidebar);
    auto *move = new QPushButton(QStringLiteral("Move chat"), sidebar);
    folderButtons->addWidget(newFolder);
    folderButtons->addWidget(renameFolder);
    folderButtons->addWidget(deleteFolder);
    folderButtons->addWidget(move);
    sidebarLayout->addLayout(folderButtons);
    auto *exportButton = new QPushButton(QStringLiteral("Export chat…"), sidebar);
    sidebarLayout->addWidget(exportButton);
    layout->addWidget(sidebar);

    auto *conversation = new QWidget(this);
    auto *conversationLayout = new QVBoxLayout(conversation);
    transcript_ = new QListWidget(conversation);
    transcript_->setWordWrap(true);
    conversationLayout->addWidget(transcript_, 1);

    auto *composerRow = new QHBoxLayout;
    attachButton_ = new QPushButton(QStringLiteral("Attach image…"), conversation);
    composer_ = new QPlainTextEdit(conversation);
    composer_->setPlaceholderText(QStringLiteral("Message the local model"));
    composer_->setMaximumHeight(120);
    composerRow->addWidget(composer_, 1);
    conversationLayout->addLayout(composerRow);

    auto *buttons = new QHBoxLayout;
    sendButton_ = new QPushButton(QStringLiteral("Send"), conversation);
    stopButton_ = new QPushButton(QStringLiteral("Stop"), conversation);
    stopButton_->setEnabled(false);
    buttons->addWidget(attachButton_);
    buttons->addStretch();
    buttons->addWidget(stopButton_);
    buttons->addWidget(sendButton_);
    conversationLayout->addLayout(buttons);

    auto *imageRow = new QHBoxLayout;
    imagePrompt_ = new QLineEdit(conversation);
    imagePrompt_->setPlaceholderText(QStringLiteral("Describe an image to generate"));
    imageButton_ = new QPushButton(QStringLiteral("Generate image"), conversation);
    imageRow->addWidget(imagePrompt_, 1);
    imageRow->addWidget(imageButton_);
    conversationLayout->addLayout(imageRow);

    status_ = new QLabel(conversation);
    status_->setWordWrap(true);
    conversationLayout->addWidget(status_);
    layout->addWidget(conversation, 1);

    connect(newChat, &QPushButton::clicked, this, &LocalAIChatDialog::newChat);
    connect(rename, &QPushButton::clicked, this, &LocalAIChatDialog::renameChat);
    connect(remove, &QPushButton::clicked, this, &LocalAIChatDialog::deleteChat);
    connect(exportButton, &QPushButton::clicked, this, &LocalAIChatDialog::exportChat);
    connect(newFolder, &QPushButton::clicked, this, &LocalAIChatDialog::createFolder);
    connect(renameFolder, &QPushButton::clicked, this, &LocalAIChatDialog::renameFolder);
    connect(deleteFolder, &QPushButton::clicked, this, &LocalAIChatDialog::deleteFolder);
    connect(move, &QPushButton::clicked, this, &LocalAIChatDialog::moveSelectedChat);
    connect(attachButton_, &QPushButton::clicked, this, &LocalAIChatDialog::attachImages);
    connect(sendButton_, &QPushButton::clicked, this, &LocalAIChatDialog::send);
    connect(stopButton_, &QPushButton::clicked, this, &LocalAIChatDialog::stop);
    connect(imageButton_, &QPushButton::clicked, this, &LocalAIChatDialog::generateImage);
    connect(chatList_, &QListWidget::currentItemChanged, this, [this](QListWidgetItem *item) {
        if (item) {
            selectChat(item->data(Qt::UserRole).toString());
        }
    });
}

QString LocalAIChatDialog::newRequestId() {
    return QUuid::createUuid().toString(QUuid::WithoutBraces);
}

void LocalAIChatDialog::call(const QString &method, const QJsonArray &params,
                             const std::function<void(const QJsonValue &, const QString &)> &completion) {
    if (!backend_) {
        completion({}, QStringLiteral("The backend is not available."));
        return;
    }
    backend_->call(this, method, params, completion);
}

void LocalAIChatDialog::setStatus(const QString &text) {
    if (status_) {
        status_->setText(text);
    }
}

void LocalAIChatDialog::loadFolders() {
    if (!backend_) {
        return;
    }
    call(QStringLiteral("ListLocalAIChatFolders"), {},
         [this](QJsonValue value, const QString &error) {
        if (!folders_ || !folderFilter_) {
            return;
        }
        const QSignalBlocker folderBlocker(folders_);
        const QSignalBlocker filterBlocker(folderFilter_);
        const QString selected = currentFolderId_;
        folders_->clear();
        folderFilter_->clear();
        folderFilter_->addItem(QStringLiteral("All chats"), QString());
        folderFilter_->addItem(QStringLiteral("Unfiled"), QStringLiteral("__unfiled__"));
        if (!error.isEmpty()) {
            setStatus(error);
            return;
        }
        for (const QJsonValue &entry : value.toArray()) {
            const QJsonObject folder = entry.toObject();
            const QString id = qtutil::stringValue(folder, "id");
            const QString name = qtutil::stringValue(folder, "name");
            folders_->addItem(name);
            folders_->item(folders_->count() - 1)->setData(Qt::UserRole, id);
            folderFilter_->addItem(name, id);
        }
        int index = folderFilter_->findData(selected);
        if (index < 0) {
            index = 0;
        }
        folderFilter_->setCurrentIndex(index);
    });
}

void LocalAIChatDialog::loadChats() {
    if (!backend_) {
        return;
    }
    call(QStringLiteral("ListLocalAIChats"), {},
         [this](QJsonValue value, const QString &error) {
        if (!chatList_) {
            return;
        }
        chatList_->clear();
        if (!error.isEmpty()) {
            setStatus(error);
            return;
        }
        const QString filter = folderFilter_ ? folderFilter_->currentData().toString() : QString();
        const QJsonArray chats = value.toArray();
        int visible = 0;
        for (const QJsonValue &entry : chats) {
            const QJsonObject chat = entry.toObject();
            const QString folderId = qtutil::stringValue(chat, "folderId");
            if (filter == QStringLiteral("__unfiled__") && !folderId.isEmpty()) {
                continue;
            }
            if (!filter.isEmpty() && filter != QStringLiteral("__unfiled__") && folderId != filter) {
                continue;
            }
            QString title = qtutil::stringValue(chat, "title");
            if (title.isEmpty()) {
                title = QStringLiteral("New chat");
            }
            auto *item = new QListWidgetItem(title, chatList_);
            item->setData(Qt::UserRole, qtutil::stringValue(chat, "id"));
            item->setData(Qt::UserRole + 1, folderId);
            item->setToolTip(qtutil::stringValue(chat, "preview"));
            if (qtutil::boolValue(chat, "unanswered")) {
                item->setText(QStringLiteral("● %1").arg(title));
            }
            ++visible;
        }
        if (chatList_->count() == 0) {
            setStatus(QStringLiteral("No chats yet. Create one with New."));
        } else if (visible > 0) {
            bool selected = false;
            if (!currentChatId_.isEmpty()) {
                for (int index = 0; index < chatList_->count(); ++index) {
                    if (chatList_->item(index)->data(Qt::UserRole).toString() == currentChatId_) {
                        chatList_->setCurrentRow(index);
                        selected = true;
                        break;
                    }
                }
            }
            if (!selected) {
                chatList_->setCurrentRow(0);
            }
        }
    });
}

void LocalAIChatDialog::selectChat(const QString &chatId) {
    if (chatId.isEmpty() || chatId == currentChatId_) {
        return;
    }
    if (!activeRequest_.isEmpty()) {
        call(QStringLiteral("AICancel"), {activeRequest_}, [](QJsonValue, const QString &) {});
    }
    currentChatId_ = chatId;
    pendingImages_.clear();
    composer_->clear();
    messages_.clear();
    loadMessages();
}

void LocalAIChatDialog::loadMessages() {
    if (!backend_ || currentChatId_.isEmpty()) {
        return;
    }
    const QString chatID = currentChatId_;
    const quint64 requestID = ++messageLoadRequest_;
    call(QStringLiteral("LoadLocalAIChatMessages"), {currentChatId_},
         [this, chatID, requestID](QJsonValue value, const QString &error) {
        if (requestID != messageLoadRequest_ || chatID != currentChatId_) {
            return;
        }
        transcript_->clear();
        messages_.clear();
        if (!error.isEmpty()) {
            setStatus(error);
            return;
        }
        for (const QJsonValue &entry : value.toArray()) {
            appendMessage(entry.toObject());
        }
        if (messages_.isEmpty()) {
            setStatus(QStringLiteral("Ask the local model anything."));
        } else {
            setStatus(QStringLiteral("%1 messages").arg(messages_.size()));
        }
        transcript_->scrollToBottom();
    });
}

QJsonObject LocalAIChatDialog::messageObject(const QString &role, const QString &content,
                                             const QJsonArray &attachments) const {
    QJsonObject object{
        {QStringLiteral("role"), role},
        {QStringLiteral("content"), content},
        {QStringLiteral("status"), QStringLiteral("complete")},
        {QStringLiteral("attachments"), attachments},
    };
    return object;
}

void LocalAIChatDialog::appendMessage(const QJsonObject &message) {
    messages_.append(message);
    const QString role = qtutil::stringValue(message, "role");
    const QString content = qtutil::stringValue(message, "content");
    const QString status = qtutil::stringValue(message, "status");
    QString label = role == QStringLiteral("user") ? QStringLiteral("You") : QStringLiteral("Assistant");
    if (status == QStringLiteral("stopped")) {
        label += QStringLiteral(" (stopped)");
    }
    auto *item = new QListWidgetItem(QStringLiteral("%1\n%2").arg(label, content), transcript_);
    item->setData(Qt::UserRole, role);
    const QJsonArray attachments = message.value(QStringLiteral("attachments")).toArray();
    for (const QJsonValue &entry : attachments) {
        const QJsonObject attachment = entry.toObject();
        if (qtutil::stringValue(attachment, "kind") != QStringLiteral("image")) {
            continue;
        }
        const QByteArray data = QByteArray::fromBase64(
            qtutil::stringValue(attachment, "data").toLatin1());
        const QPixmap pixmap = QPixmap::fromImage(QImage::fromData(data));
        if (!pixmap.isNull()) {
            item->setIcon(QIcon(pixmap.scaled(96, 96, Qt::KeepAspectRatio,
                                              Qt::SmoothTransformation)));
        }
        break;
    }
}

void LocalAIChatDialog::newChat() {
    call(QStringLiteral("CreateLocalAIChat"),
         {defaultAgentId_, QStringLiteral("chat")},
         [this](QJsonValue value, const QString &error) {
        if (!error.isEmpty()) {
            setStatus(error);
            return;
        }
        currentChatId_ = qtutil::stringValue(value.toObject(), "id");
        currentFolderId_.clear();
        composer_->clear();
        messages_.clear();
        transcript_->clear();
        loadChats();
        loadMessages();
    });
}

void LocalAIChatDialog::renameChat() {
    if (currentChatId_.isEmpty()) {
        return;
    }
    bool accepted = false;
    const QString title = QInputDialog::getText(
        this, QStringLiteral("Rename chat"), QStringLiteral("Chat title"), QLineEdit::Normal,
        chatList_->currentItem() ? chatList_->currentItem()->text() : QString(), &accepted)
                              .trimmed();
    if (!accepted || title.isEmpty()) {
        return;
    }
    call(QStringLiteral("RenameLocalAIChat"), {currentChatId_, title},
         [this](QJsonValue, const QString &error) {
        setStatus(error.isEmpty() ? QStringLiteral("Chat renamed.") : error);
        loadChats();
    });
}

void LocalAIChatDialog::deleteChat() {
    if (currentChatId_.isEmpty()) {
        return;
    }
    if (QMessageBox::question(this, QStringLiteral("Delete chat"),
                              QStringLiteral("Delete this chat and all of its messages?"))
        != QMessageBox::Yes) {
        return;
    }
    call(QStringLiteral("DeleteLocalAIChat"), {currentChatId_},
         [this](QJsonValue, const QString &error) {
        if (!error.isEmpty()) {
            setStatus(error);
            return;
        }
        currentChatId_.clear();
        messages_.clear();
        transcript_->clear();
        loadChats();
        setStatus(QStringLiteral("Chat deleted."));
    });
}

void LocalAIChatDialog::exportChat() {
    if (messages_.isEmpty()) {
        setStatus(QStringLiteral("There is nothing to export."));
        return;
    }
    QString text;
    QTextStream stream(&text);
    for (const QJsonObject &message : messages_) {
        stream << (qtutil::stringValue(message, "role") == QStringLiteral("user") ? "You" : "Assistant")
               << ":\n"
               << qtutil::stringValue(message, "content") << "\n\n";
        const QJsonArray attachments = message.value(QStringLiteral("attachments")).toArray();
        for (const QJsonValue &entry : attachments) {
            const QJsonObject attachment = entry.toObject();
            stream << "[Attachment: " << qtutil::stringValue(attachment, "name") << "]\n";
        }
    }
    const QString path = QFileDialog::getSaveFileName(
        this, QStringLiteral("Export chat"), QStringLiteral("local-ai-chat.txt"));
    if (path.isEmpty()) {
        return;
    }
    QFile file(path);
    if (!file.open(QIODevice::WriteOnly | QIODevice::Truncate)) {
        setStatus(file.errorString());
        return;
    }
    file.write(text.toUtf8());
    file.close();
    setStatus(QStringLiteral("Chat exported to %1").arg(path));
}

void LocalAIChatDialog::createFolder() {
    bool accepted = false;
    const QString name = QInputDialog::getText(
        this, QStringLiteral("New folder"), QStringLiteral("Folder name"), QLineEdit::Normal,
        {}, &accepted).trimmed();
    if (!accepted || name.isEmpty()) {
        return;
    }
    call(QStringLiteral("CreateLocalAIChatFolder"), {name},
         [this](QJsonValue, const QString &error) {
        setStatus(error.isEmpty() ? QStringLiteral("Folder created.") : error);
        loadFolders();
    });
}

void LocalAIChatDialog::renameFolder() {
    auto *item = folders_ ? folders_->currentItem() : nullptr;
    if (!item) {
        return;
    }
    bool accepted = false;
    const QString name = QInputDialog::getText(
        this, QStringLiteral("Rename folder"), QStringLiteral("Folder name"), QLineEdit::Normal,
        item->text(), &accepted).trimmed();
    if (!accepted || name.isEmpty()) {
        return;
    }
    call(QStringLiteral("RenameLocalAIChatFolder"),
         {item->data(Qt::UserRole).toString(), name},
         [this](QJsonValue, const QString &error) {
        setStatus(error.isEmpty() ? QStringLiteral("Folder renamed.") : error);
        loadFolders();
        loadChats();
    });
}

void LocalAIChatDialog::deleteFolder() {
    auto *item = folders_ ? folders_->currentItem() : nullptr;
    if (!item) {
        return;
    }
    if (QMessageBox::question(this, QStringLiteral("Delete folder"),
                              QStringLiteral("Delete this folder? Its chats become unfiled."))
        != QMessageBox::Yes) {
        return;
    }
    call(QStringLiteral("DeleteLocalAIChatFolder"), {item->data(Qt::UserRole).toString()},
         [this](QJsonValue, const QString &error) {
        setStatus(error.isEmpty() ? QStringLiteral("Folder deleted.") : error);
        loadFolders();
        loadChats();
    });
}

void LocalAIChatDialog::moveSelectedChat() {
    if (currentChatId_.isEmpty()) {
        return;
    }
    QStringList options{QStringLiteral("Unfiled")};
    for (int index = 0; index < folders_->count(); ++index) {
        options.append(folders_->item(index)->text());
    }
    bool accepted = false;
    const QString choice = QInputDialog::getItem(
        this, QStringLiteral("Move chat"), QStringLiteral("Folder"), options, 0, false, &accepted);
    if (!accepted) {
        return;
    }
    QString folderId;
    if (choice != QStringLiteral("Unfiled")) {
        for (int index = 0; index < folders_->count(); ++index) {
            if (folders_->item(index)->text() == choice) {
                folderId = folders_->item(index)->data(Qt::UserRole).toString();
                break;
            }
        }
    }
    call(QStringLiteral("SetLocalAIChatFolder"), {currentChatId_, folderId},
         [this](QJsonValue, const QString &error) {
        setStatus(error.isEmpty() ? QStringLiteral("Chat moved.") : error);
        loadChats();
    });
}

void LocalAIChatDialog::attachImages() {
    const QStringList paths = QFileDialog::getOpenFileNames(
        this, QStringLiteral("Attach images"), QString(),
        QStringLiteral("Images (*.png *.jpg *.jpeg *.gif *.webp)"));
    for (const QString &path : paths) {
        if (pendingImages_.size() >= 4) {
            setStatus(QStringLiteral("A message can include at most four images."));
            break;
        }
        QFile file(path);
        if (!file.open(QIODevice::ReadOnly)) {
            setStatus(file.errorString());
            continue;
        }
        const QByteArray data = file.readAll();
        const QImage image = QImage::fromData(data);
        if (image.isNull()) {
            setStatus(QStringLiteral("%1 is not a supported image.").arg(path));
            continue;
        }
        const QString suffix = QFileInfo(path).suffix().toLower();
        QString mediaType = QStringLiteral("image/png");
        if (suffix == QStringLiteral("jpg") || suffix == QStringLiteral("jpeg")) {
            mediaType = QStringLiteral("image/jpeg");
        } else if (suffix == QStringLiteral("gif")) {
            mediaType = QStringLiteral("image/gif");
        } else if (suffix == QStringLiteral("webp")) {
            mediaType = QStringLiteral("image/webp");
        }
        pendingImages_.append(QJsonObject{
            {QStringLiteral("name"), QFileInfo(path).fileName()},
            {QStringLiteral("kind"), QStringLiteral("image")},
            {QStringLiteral("mediaType"), mediaType},
            {QStringLiteral("size"), static_cast<double>(data.size())},
            {QStringLiteral("data"), QString::fromLatin1(data.toBase64())},
        });
    }
    if (!pendingImages_.isEmpty()) {
        setStatus(QStringLiteral("%1 image(s) attached.").arg(pendingImages_.size()));
    }
}

void LocalAIChatDialog::send() {
    if (currentChatId_.isEmpty() || !activeRequest_.isEmpty()) {
        return;
    }
    const QString chatID = currentChatId_;
    const QString text = composer_->toPlainText().trimmed();
    if (text.isEmpty() && pendingImages_.isEmpty()) {
        return;
    }
    QJsonArray attachments;
    for (const QJsonObject &image : pendingImages_) {
        attachments.append(image);
    }
    const QJsonObject user = messageObject(QStringLiteral("user"), text, attachments);
    QJsonArray requestMessages;
    auto appendTurn = [&requestMessages](const QJsonObject &message) {
        QJsonObject turn{
            {QStringLiteral("role"), qtutil::stringValue(message, "role")},
            {QStringLiteral("content"), qtutil::stringValue(message, "content")},
        };
        QJsonArray images;
        for (const QJsonValue &entry : message.value(QStringLiteral("attachments")).toArray()) {
            const QJsonObject attachment = entry.toObject();
            if (qtutil::stringValue(attachment, "kind") == QStringLiteral("image")) {
                images.append(QJsonObject{
                    {QStringLiteral("mediaType"), qtutil::stringValue(attachment, "mediaType")},
                    {QStringLiteral("data"), qtutil::stringValue(attachment, "data")},
                });
            }
        }
        if (!images.isEmpty()) {
            turn.insert(QStringLiteral("images"), images);
        }
        requestMessages.append(turn);
    };
    for (const QJsonObject &message : messages_) {
        appendTurn(message);
    }
    appendTurn(user);
    sendButton_->setEnabled(false);
    attachButton_->setEnabled(false);
    setStatus(QStringLiteral("Saving message…"));
    call(QStringLiteral("AppendLocalAIChatMessage"), {chatID, user},
         [this, user, chatID, requestMessages](QJsonValue value, const QString &error) {
        if (!error.isEmpty()) {
            sendButton_->setEnabled(true);
            attachButton_->setEnabled(true);
            if (currentChatId_ == chatID) {
                setStatus(error);
            }
            return;
        }
        if (currentChatId_ == chatID) {
            appendMessage(value.isObject() ? value.toObject() : user);
            composer_->clear();
            pendingImages_.clear();
        }
        const QString requestId = newRequestId();
        activeRequest_ = requestId;
        streamingText_.clear();
        stopButton_->setEnabled(true);
        setStatus(QStringLiteral("Thinking…"));
        const QJsonObject request{
            {QStringLiteral("messages"), requestMessages},
            {QStringLiteral("requestId"), requestId},
        };
        call(QStringLiteral("LocalAIChat"), {request},
             [this, requestId, chatID](QJsonValue value, const QString &error) {
            stopButton_->setEnabled(false);
            sendButton_->setEnabled(true);
            attachButton_->setEnabled(true);
            activeRequest_.clear();
            QString reply = value.toString();
            if (!error.isEmpty()) {
                if (error.contains(QStringLiteral("stopped"), Qt::CaseInsensitive)) {
                    reply = streamingText_.isEmpty() ? QStringLiteral("Stopped") : streamingText_;
                } else {
                    if (currentChatId_ == chatID) {
                        setStatus(error);
                    }
                    return;
                }
            }
            if (reply.trimmed().isEmpty()) {
                reply = QStringLiteral("(The model returned an empty reply.)");
            }
            const QJsonObject assistant = messageObject(QStringLiteral("assistant"), reply, {});
            call(QStringLiteral("AppendLocalAIChatMessage"),
                 {chatID, assistant},
                 [this, chatID](QJsonValue, const QString &saveError) {
                if (saveError.isEmpty()) {
                    if (currentChatId_ == chatID) {
                        loadMessages();
                    }
                    call(QStringLiteral("GenerateLocalAIChatTitle"), {chatID},
                         [](QJsonValue, const QString &) {});
                    loadChats();
                } else if (currentChatId_ == chatID) {
                    setStatus(saveError);
                }
            });
        });
    });
}

void LocalAIChatDialog::stop() {
    if (activeRequest_.isEmpty()) {
        return;
    }
    call(QStringLiteral("AICancel"), {activeRequest_},
         [this](QJsonValue, const QString &error) {
        if (!error.isEmpty()) {
            setStatus(error);
        }
    });
    stopButton_->setEnabled(false);
    setStatus(QStringLiteral("Stopping…"));
}

void LocalAIChatDialog::generateImage() {
    if (currentChatId_.isEmpty()) {
        return;
    }
    const QString prompt = imagePrompt_->text().trimmed();
    if (prompt.isEmpty()) {
        setStatus(QStringLiteral("Describe the image first."));
        return;
    }
    const QString chatID = currentChatId_;
    const QString requestId = newRequestId();
    activeRequest_ = requestId;
    imageButton_->setEnabled(false);
    setStatus(QStringLiteral("Generating image…"));
    call(QStringLiteral("LocalAIChatGenerateImage"), {chatID, prompt, requestId},
         [this, chatID](QJsonValue value, const QString &error) {
        activeRequest_.clear();
        imageButton_->setEnabled(true);
        if (!error.isEmpty()) {
            if (currentChatId_ == chatID) {
                setStatus(error);
            }
            return;
        }
        if (currentChatId_ == chatID) {
            setStatus(QStringLiteral("Image generated."));
        }
        if (value.isArray() && currentChatId_ == chatID) {
            transcript_->clear();
            messages_.clear();
            for (const QJsonValue &entry : value.toArray()) {
                appendMessage(entry.toObject());
            }
        }
        loadChats();
    });
}