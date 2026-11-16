#include "aitoolsdialog.h"

#include "backendclient.h"
#include "qtutil.h"
#include "stylesheet.h"

#include <QByteArray>
#include <QComboBox>
#include <QFormLayout>
#include <QHBoxLayout>
#include <QImage>
#include <QJsonArray>
#include <QJsonDocument>
#include <QLabel>
#include <QLineEdit>
#include <QListWidget>
#include <QMessageBox>
#include <QPixmap>
#include <QPlainTextEdit>
#include <QPushButton>
#include <QTabWidget>
#include <QTextEdit>
#include <QTextCursor>
#include <QUuid>
#include <QVBoxLayout>

AIToolsDialog::AIToolsDialog(BackendClient *backend, MediaClient *media, const QString &roomId,
                             const QString &roomName, QPlainTextEdit *composer, QWidget *parent)
    : QDialog(parent), backend_(backend), media_(media), roomId_(roomId), roomName_(roomName),
      composer_(composer) {
    setWindowTitle(QStringLiteral("AI tools — %1").arg(roomName_));
    resize(720, 620);
    auto *layout = new QVBoxLayout(this);
    tabs_ = new QTabWidget(this);
    layout->addWidget(tabs_, 1);
    buildSuggestions();
    buildTutor();
    buildImage();
    buildTone();
    buildTranscription();

    auto *footer = new QHBoxLayout;
    auto *close = new QPushButton(QStringLiteral("Close"), this);
    footer->addStretch();
    footer->addWidget(close);
    layout->addLayout(footer);
    connect(close, &QPushButton::clicked, this, &QDialog::accept);
    configureListViews(this);

    connect(backend_, &BackendClient::eventReceived, this,
            [this](const QString &event, const QJsonValue &data) {
        if (event != QStringLiteral("ai:stream") || !data.isObject()) {
            return;
        }
        const QJsonObject object = data.toObject();
        if (qtutil::stringValue(object, "requestId") != activeRequest_) {
            return;
        }
        if (tutorResult_ && object.value(QStringLiteral("reset")).toBool()) {
            tutorResult_->clear();
        }
        if (tutorResult_) {
            tutorResult_->moveCursor(QTextCursor::End);
            tutorResult_->insertPlainText(qtutil::stringValue(object, "text"));
        }
    });
}

QString AIToolsDialog::requestId(const QString &prefix) {
    return prefix + QUuid::createUuid().toString(QUuid::WithoutBraces);
}

void AIToolsDialog::run(const QString &method, const QJsonArray &params,
                        const std::function<void(const QJsonValue &, const QString &)> &completion) {
    if (!backend_) {
        completion({}, QStringLiteral("The backend is not available."));
        return;
    }
    backend_->call(this, method, params, completion);
}

void AIToolsDialog::buildSuggestions() {
    auto *page = new QWidget(this);
    auto *layout = new QVBoxLayout(page);
    auto *buttons = new QHBoxLayout;
    suggestButton_ = new QPushButton(QStringLiteral("Suggest replies"), page);
    draftButton_ = new QPushButton(QStringLiteral("Draft a reply"), page);
    languageButton_ = new QPushButton(QStringLiteral("Detect chat language"), page);
    buttons->addWidget(suggestButton_);
    buttons->addWidget(draftButton_);
    buttons->addWidget(languageButton_);
    buttons->addStretch();
    layout->addLayout(buttons);
    suggestions_ = new QListWidget(page);
    suggestions_->setWordWrap(true);
    layout->addWidget(suggestions_, 1);
    suggestionStatus_ = new QLabel(page);
    suggestionStatus_->setWordWrap(true);
    layout->addWidget(suggestionStatus_);
    connect(suggestButton_, &QPushButton::clicked, this, &AIToolsDialog::suggestReplies);
    connect(draftButton_, &QPushButton::clicked, this, &AIToolsDialog::generateDraft);
    connect(languageButton_, &QPushButton::clicked, this, &AIToolsDialog::detectLanguage);
    connect(suggestions_, &QListWidget::itemDoubleClicked, this, [this](QListWidgetItem *item) {
        if (item && composer_) {
            composer_->setPlainText(item->data(Qt::UserRole).toString());
        }
    });
    tabs_->addTab(page, QStringLiteral("Suggestions"));
}

void AIToolsDialog::suggestReplies() {
    if (roomId_.isEmpty()) {
        suggestionStatus_->setText(QStringLiteral("Choose a room first."));
        return;
    }
    suggestButton_->setEnabled(false);
    draftButton_->setEnabled(false);
    languageButton_->setEnabled(false);
    suggestionStatus_->setText(QStringLiteral("Generating suggestions…"));
    const QString id = requestId(QStringLiteral("suggest-"));
    activeRequest_ = id;
    run(QStringLiteral("AISuggestReplies"), {roomId_, id},
        [this](QJsonValue value, const QString &error) {
        suggestButton_->setEnabled(true);
        draftButton_->setEnabled(true);
        languageButton_->setEnabled(true);
        suggestions_->clear();
        if (!error.isEmpty()) {
            suggestionStatus_->setText(error);
            return;
        }
        const QJsonObject result = value.toObject();
        const QString language = qtutil::stringValue(result, "language");
        const QJsonArray replies = result.value(QStringLiteral("suggestions")).toArray();
        for (const QJsonValue &entry : replies) {
            const QJsonObject reply = entry.toObject();
            const QString tone = qtutil::stringValue(reply, "tone");
            const QString text = qtutil::stringValue(reply, "text");
            const QString translation = qtutil::stringValue(reply, "translation");
            auto *item = new QListWidgetItem(
                QStringLiteral("%1\n%2%3")
                    .arg(tone, text,
                         translation.isEmpty() ? QString() : QStringLiteral("\n%1").arg(translation)),
                suggestions_);
            item->setData(Qt::UserRole, text);
        }
        suggestionStatus_->setText(language.isEmpty()
                                       ? QStringLiteral("Suggestions are ready. Double-click one to use it.")
                                       : QStringLiteral("Suggestions in %1. Double-click one to use it.")
                                             .arg(language));
    });
}

void AIToolsDialog::generateDraft() {
    if (roomId_.isEmpty()) {
        suggestionStatus_->setText(QStringLiteral("Choose a room first."));
        return;
    }
    draftButton_->setEnabled(false);
    suggestButton_->setEnabled(false);
    languageButton_->setEnabled(false);
    suggestionStatus_->setText(QStringLiteral("Drafting a reply…"));
    const QString id = requestId(QStringLiteral("draft-"));
    activeRequest_ = id;
    run(QStringLiteral("AIGenerateReplyDraft"), {roomId_, id},
        [this](QJsonValue value, const QString &error) {
        draftButton_->setEnabled(true);
        suggestButton_->setEnabled(true);
        languageButton_->setEnabled(true);
        if (!error.isEmpty()) {
            suggestionStatus_->setText(error);
            return;
        }
        if (composer_) {
            composer_->setPlainText(value.toString());
        }
        suggestionStatus_->setText(QStringLiteral("Draft placed in the composer."));
    });
}

void AIToolsDialog::detectLanguage() {
    if (roomId_.isEmpty()) {
        suggestionStatus_->setText(QStringLiteral("Choose a room first."));
        return;
    }
    languageButton_->setEnabled(false);
    suggestButton_->setEnabled(false);
    draftButton_->setEnabled(false);
    suggestionStatus_->setText(QStringLiteral("Detecting language…"));
    const QString id = requestId(QStringLiteral("language-"));
    activeRequest_ = id;
    run(QStringLiteral("AIDetectChatLanguage"), {roomId_, id},
        [this](QJsonValue value, const QString &error) {
        languageButton_->setEnabled(true);
        suggestButton_->setEnabled(true);
        draftButton_->setEnabled(true);
        if (!error.isEmpty()) {
            suggestionStatus_->setText(error);
            return;
        }
        const QString code = value.toString();
        suggestionStatus_->setText(code.isEmpty()
                                       ? QStringLiteral("The chat language could not be detected.")
                                       : QStringLiteral("Detected language: %1").arg(code));
    });
}

void AIToolsDialog::buildTutor() {
    auto *page = new QWidget(this);
    auto *layout = new QVBoxLayout(page);
    tutorText_ = new QPlainTextEdit(page);
    tutorText_->setPlaceholderText(QStringLiteral("Text to analyze (defaults to the composer draft)"));
    tutorText_->setMaximumHeight(110);
    layout->addWidget(tutorText_);
    auto *buttons = new QHBoxLayout;
    auto *analyze = new QPushButton(QStringLiteral("Analyze draft"), page);
    buttons->addWidget(analyze);
    buttons->addStretch();
    layout->addLayout(buttons);
    tutorResult_ = new QPlainTextEdit(page);
    tutorResult_->setReadOnly(true);
    layout->addWidget(tutorResult_, 1);
    tutorStatus_ = new QLabel(page);
    tutorStatus_->setWordWrap(true);
    layout->addWidget(tutorStatus_);
    connect(analyze, &QPushButton::clicked, this, &AIToolsDialog::analyzeDraft);
    tabs_->addTab(page, QStringLiteral("Language Tutor"));
}

void AIToolsDialog::analyzeDraft() {
    QString text = tutorText_->toPlainText().trimmed();
    if (text.isEmpty() && composer_) {
        text = composer_->toPlainText().trimmed();
    }
    if (text.isEmpty()) {
        tutorStatus_->setText(QStringLiteral("Enter some text to analyze."));
        return;
    }
    tutorStatus_->setText(QStringLiteral("Analyzing…"));
    const QString id = requestId(QStringLiteral("tutor-"));
    activeRequest_ = id;
    run(QStringLiteral("Analyze"), {text, QStringLiteral("draft"), QString(), QString(), id},
        [this](QJsonValue value, const QString &error) {
        if (!error.isEmpty()) {
            tutorStatus_->setText(error);
            return;
        }
        const QJsonObject analysis = value.toObject();
        QString output = QStringLiteral("Detected: %1\n\nCorrected:\n%2\n\nTranslation:\n%3")
                             .arg(qtutil::stringValue(analysis, "detected_language"),
                                  qtutil::stringValue(analysis, "corrected_text"),
                                  qtutil::stringValue(analysis, "translation"));
        const QJsonArray notes = analysis.value(QStringLiteral("grammar_notes")).toArray();
        if (!notes.isEmpty()) {
            output += QStringLiteral("\n\nGrammar notes:");
            for (const QJsonValue &note : notes) {
                output += QStringLiteral("\n• %1").arg(note.toString());
            }
        }
        const QJsonArray vocabulary = analysis.value(QStringLiteral("vocabulary")).toArray();
        if (!vocabulary.isEmpty()) {
            output += QStringLiteral("\n\nVocabulary:");
            for (const QJsonValue &entry : vocabulary) {
                const QJsonObject item = entry.toObject();
                output += QStringLiteral("\n• %1 — %2").arg(qtutil::stringValue(item, "term"),
                                                           qtutil::stringValue(item, "meaning"));
            }
        }
        tutorResult_->setPlainText(output);
        const QString insert = qtutil::stringValue(analysis, "text_to_insert");
        if (!insert.isEmpty() && composer_) {
            composer_->setPlainText(insert);
        }
        tutorStatus_->setText(QStringLiteral("Analysis complete."));
    });
}

void AIToolsDialog::buildImage() {
    auto *page = new QWidget(this);
    auto *layout = new QVBoxLayout(page);
    imagePrompt_ = new QLineEdit(page);
    imagePrompt_->setPlaceholderText(QStringLiteral("Describe the image to generate"));
    layout->addWidget(imagePrompt_);
    auto *buttons = new QHBoxLayout;
    imageButton_ = new QPushButton(QStringLiteral("Generate image"), page);
    auto *send = new QPushButton(QStringLiteral("Send to room"), page);
    buttons->addWidget(imageButton_);
    buttons->addWidget(send);
    buttons->addStretch();
    layout->addLayout(buttons);
    imagePreview_ = new QLabel(page);
    imagePreview_->setAlignment(Qt::AlignCenter);
    imagePreview_->setMinimumHeight(260);
    imagePreview_->setText(QStringLiteral("No generated image"));
    layout->addWidget(imagePreview_, 1);
    imageStatus_ = new QLabel(page);
    imageStatus_->setWordWrap(true);
    layout->addWidget(imageStatus_);
    connect(imageButton_, &QPushButton::clicked, this, &AIToolsDialog::generateImage);
    connect(send, &QPushButton::clicked, this, &AIToolsDialog::sendGeneratedImage);
    tabs_->addTab(page, QStringLiteral("Image"));
}

void AIToolsDialog::generateImage() {
    const QString prompt = imagePrompt_->text().trimmed();
    if (prompt.isEmpty()) {
        imageStatus_->setText(QStringLiteral("Describe the image first."));
        return;
    }
    imageButton_->setEnabled(false);
    imageStatus_->setText(QStringLiteral("Generating image…"));
    const QString id = requestId(QStringLiteral("image-"));
    activeRequest_ = id;
    run(QStringLiteral("GenerateRoomImage"), {prompt, id},
        [this](QJsonValue value, const QString &error) {
        imageButton_->setEnabled(true);
        if (!error.isEmpty()) {
            imageStatus_->setText(error);
            return;
        }
        generatedImage_ = QByteArray::fromBase64(value.toString().toLatin1());
        const QPixmap pixmap = QPixmap::fromImage(
            QImage::fromData(generatedImage_, "PNG"));
        if (pixmap.isNull()) {
            imageStatus_->setText(QStringLiteral("The model returned an invalid image."));
            return;
        }
        imagePreview_->setPixmap(pixmap.scaled(520, 360, Qt::KeepAspectRatio,
                                               Qt::SmoothTransformation));
        imageStatus_->setText(QStringLiteral("Image generated. Review it, then send it to the room."));
    });
}

void AIToolsDialog::sendGeneratedImage() {
    if (generatedImage_.isEmpty() || roomId_.isEmpty()) {
        imageStatus_->setText(QStringLiteral("Generate an image first."));
        return;
    }
    run(QStringLiteral("SendRoomImage"), {roomId_, QString::fromLatin1(generatedImage_.toBase64())},
        [this](QJsonValue, const QString &error) {
        imageStatus_->setText(error.isEmpty() ? QStringLiteral("Image sent.")
                                              : error);
    });
}

void AIToolsDialog::buildTone() {
    auto *page = new QWidget(this);
    auto *layout = new QVBoxLayout(page);
    toneText_ = new QPlainTextEdit(page);
    toneText_->setPlaceholderText(QStringLiteral("Text to check (defaults to the composer draft)"));
    toneText_->setMaximumHeight(120);
    layout->addWidget(toneText_);
    toneButton_ = new QPushButton(QStringLiteral("Check tone"), page);
    layout->addWidget(toneButton_);
    toneStatus_ = new QLabel(page);
    toneStatus_->setWordWrap(true);
    layout->addWidget(toneStatus_);
    layout->addStretch();
    connect(toneButton_, &QPushButton::clicked, this, &AIToolsDialog::checkTone);
    tabs_->addTab(page, QStringLiteral("Tone guard"));
}

void AIToolsDialog::checkTone() {
    QString text = toneText_->toPlainText().trimmed();
    if (text.isEmpty() && composer_) {
        text = composer_->toPlainText().trimmed();
    }
    if (text.isEmpty()) {
        toneStatus_->setText(QStringLiteral("Enter some text to check."));
        return;
    }
    toneStatus_->setText(QStringLiteral("Checking…"));
    toneButton_->setEnabled(false);
    const QJsonObject message{
        {QStringLiteral("role"), QStringLiteral("user")},
        {QStringLiteral("content"), text},
    };
    run(QStringLiteral("CheckMessageTone"), {QJsonArray{message}},
        [this](QJsonValue value, const QString &error) {
        toneButton_->setEnabled(true);
        toneStatus_->setText(error.isEmpty() ? value.toString() : error);
    });
}

void AIToolsDialog::buildTranscription() {
    auto *page = new QWidget(this);
    auto *layout = new QVBoxLayout(page);
    auto *form = new QFormLayout;
    audioMxc_ = new QLineEdit(page);
    audioMxc_->setPlaceholderText(QStringLiteral("mxc://server/media-id"));
    audioFilename_ = new QLineEdit(page);
    audioFilename_->setPlaceholderText(QStringLiteral("voice.ogg"));
    form->addRow(QStringLiteral("Audio MXC URI"), audioMxc_);
    form->addRow(QStringLiteral("Filename"), audioFilename_);
    layout->addLayout(form);
    transcribeButton_ = new QPushButton(QStringLiteral("Transcribe audio"), page);
    layout->addWidget(transcribeButton_);
    audioStatus_ = new QLabel(page);
    audioStatus_->setWordWrap(true);
    layout->addWidget(audioStatus_);
    layout->addStretch();
    connect(transcribeButton_, &QPushButton::clicked, this, &AIToolsDialog::transcribe);
    tabs_->addTab(page, QStringLiteral("Transcription"));
}

void AIToolsDialog::transcribe() {
    const QString mxc = audioMxc_->text().trimmed();
    if (mxc.isEmpty()) {
        audioStatus_->setText(QStringLiteral("Enter the audio MXC URI."));
        return;
    }
    transcribeButton_->setEnabled(false);
    audioStatus_->setText(QStringLiteral("Transcribing…"));
    const QString filename = audioFilename_->text().trimmed().isEmpty()
                                 ? QStringLiteral("voice.ogg")
                                 : audioFilename_->text().trimmed();
    run(QStringLiteral("AITranscribeMedia"), {mxc, filename, QStringLiteral("audio/ogg")},
        [this](QJsonValue value, const QString &error) {
        transcribeButton_->setEnabled(true);
        audioStatus_->setText(error.isEmpty() ? value.toString() : error);
    });
}
