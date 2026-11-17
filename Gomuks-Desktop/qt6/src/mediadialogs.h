#pragma once

#include <QByteArray>
#include <QDialog>
#include <QString>
#include <QTemporaryDir>

#include <functional>

class QAudioInput;
class QAudioOutput;
class QCamera;
class QLabel;
class QMediaCaptureSession;
class QMediaPlayer;
class QMediaRecorder;
class QPushButton;
class QSlider;
class QVideoWidget;
class QPermission;

class RecordingDialog final : public QDialog {
    Q_OBJECT

public:
    enum class Kind { VoiceNote, VideoMessage };

    RecordingDialog(Kind kind, const QString &preferredAudioInput, QWidget *parent = nullptr);
    ~RecordingDialog() override;

    // Valid after the dialog is accepted. The file is deleted when the dialog is destroyed.
    QString recordedPath() const;
    qint64 durationMs() const;

protected:
    void done(int result) override;

private:
    void requestAccess(const QPermission &permission, const QString &deniedMessage,
                       std::function<void()> granted);
    void accessGranted();
    void accessDenied(const QString &message);
    void startRecording();
    void stopAndWait();
    void updateControls();

    Kind kind_;
    QTemporaryDir tempDir_;
    QString outputPath_;
    qint64 durationMs_ = 0;
    qint64 maxDurationMs_ = 0;
    bool ready_ = false;

    QMediaCaptureSession *session_ = nullptr;
    QAudioInput *audioInput_ = nullptr;
    QCamera *camera_ = nullptr;
    QMediaRecorder *recorder_ = nullptr;
    QVideoWidget *preview_ = nullptr;
    QLabel *timeLabel_ = nullptr;
    QLabel *statusLabel_ = nullptr;
    QPushButton *recordButton_ = nullptr;
    QPushButton *sendButton_ = nullptr;
};

class MediaPlayerDialog final : public QDialog {
    Q_OBJECT

public:
    MediaPlayerDialog(const QString &title, const QString &mime, const QByteArray &data,
                      QWidget *parent = nullptr);
    ~MediaPlayerDialog() override;

private:
    void updateTimeLabel();

    QTemporaryDir tempDir_;
    QMediaPlayer *player_ = nullptr;
    QAudioOutput *audioOutput_ = nullptr;
    QPushButton *playButton_ = nullptr;
    QSlider *positionSlider_ = nullptr;
    QLabel *timeLabel_ = nullptr;
    QLabel *statusLabel_ = nullptr;
};
