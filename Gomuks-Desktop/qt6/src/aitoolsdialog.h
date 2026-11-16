#pragma once

#include <QDialog>
#include <QJsonArray>
#include <QJsonValue>
#include <QString>

#include <functional>

class BackendClient;
class MediaClient;
class QLabel;
class QLineEdit;
class QListWidget;
class QPlainTextEdit;
class QPushButton;
class QTabWidget;

class AIToolsDialog final : public QDialog {
    Q_OBJECT

public:
    AIToolsDialog(BackendClient *backend, MediaClient *media, const QString &roomId,
                  const QString &roomName, QPlainTextEdit *composer, QWidget *parent = nullptr);

private:
    void buildSuggestions();
    void buildTutor();
    void buildImage();
    void buildTone();
    void buildTranscription();
    void suggestReplies();
    void generateDraft();
    void detectLanguage();
    void analyzeDraft();
    void generateImage();
    void sendGeneratedImage();
    void checkTone();
    void transcribe();
    void run(const QString &method, const QJsonArray &params,
             const std::function<void(const QJsonValue &, const QString &)> &completion);
    QString requestId(const QString &prefix);

    BackendClient *backend_ = nullptr;
    MediaClient *media_ = nullptr;
    QString roomId_;
    QString roomName_;
    QPlainTextEdit *composer_ = nullptr;
    QListWidget *suggestions_ = nullptr;
    QLabel *suggestionStatus_ = nullptr;
    QPlainTextEdit *tutorText_ = nullptr;
    QLabel *tutorStatus_ = nullptr;
    QPlainTextEdit *tutorResult_ = nullptr;
    QLineEdit *imagePrompt_ = nullptr;
    QLabel *imageStatus_ = nullptr;
    QLabel *imagePreview_ = nullptr;
    QByteArray generatedImage_;
    QPlainTextEdit *toneText_ = nullptr;
    QLabel *toneStatus_ = nullptr;
    QLineEdit *audioMxc_ = nullptr;
    QLineEdit *audioFilename_ = nullptr;
    QLabel *audioStatus_ = nullptr;
    QTabWidget *tabs_ = nullptr;
    QPushButton *suggestButton_ = nullptr;
    QPushButton *draftButton_ = nullptr;
    QPushButton *languageButton_ = nullptr;
    QPushButton *imageButton_ = nullptr;
    QPushButton *toneButton_ = nullptr;
    QPushButton *transcribeButton_ = nullptr;
    QString activeRequest_;
};