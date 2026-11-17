#include "mediadialogs.h"

#include <QAudioDevice>
#include <QAudioInput>
#include <QAudioOutput>
#include <QCamera>
#include <QCameraDevice>
#include <QCoreApplication>
#include <QDateTime>
#include <QEventLoop>
#include <QFile>
#include <QHBoxLayout>
#include <QLabel>
#include <QMediaCaptureSession>
#include <QMediaDevices>
#include <QMediaFormat>
#include <QMediaPlayer>
#include <QMediaRecorder>
#include <QMimeDatabase>
#include <QPermissions>
#include <QPushButton>
#include <QSlider>
#include <QTimer>
#include <QUrl>
#include <QVBoxLayout>
#include <QVideoWidget>

namespace {

constexpr qint64 maximumVoiceNoteMs = 4 * 60 * 1000;
constexpr qint64 maximumVideoMessageMs = 3 * 60 * 1000;

QString formatDuration(qint64 milliseconds) {
    const qint64 seconds = milliseconds / 1000;
    return QStringLiteral("%1:%2").arg(seconds / 60).arg(seconds % 60, 2, 10, QLatin1Char('0'));
}

QAudioDevice chooseAudioInput(const QString &preferred) {
    if (!preferred.isEmpty() && preferred != QStringLiteral("default")) {
        for (const QAudioDevice &device : QMediaDevices::audioInputs()) {
            if (device.description() == preferred || QString::fromUtf8(device.id()) == preferred) {
                return device;
            }
        }
    }
    return QMediaDevices::defaultAudioInput();
}

}

RecordingDialog::RecordingDialog(Kind kind, const QString &preferredAudioInput, QWidget *parent)
    : QDialog(parent),
      kind_(kind),
      maxDurationMs_(kind == Kind::VideoMessage ? maximumVideoMessageMs : maximumVoiceNoteMs) {
    const bool video = kind == Kind::VideoMessage;
    setWindowTitle(video ? QStringLiteral("Record video message") : QStringLiteral("Record voice note"));
    auto *layout = new QVBoxLayout(this);

    session_ = new QMediaCaptureSession(this);
    recorder_ = new QMediaRecorder(this);
    session_->setRecorder(recorder_);

    QMediaFormat format;
    if (video) {
        format.setFileFormat(QMediaFormat::MPEG4);
        format.setVideoCodec(QMediaFormat::VideoCodec::H264);
        format.setAudioCodec(QMediaFormat::AudioCodec::AAC);
    } else {
        format.setFileFormat(QMediaFormat::Mpeg4Audio);
        format.setAudioCodec(QMediaFormat::AudioCodec::AAC);
    }
    recorder_->setMediaFormat(format);

    audioInput_ = new QAudioInput(this);
    audioInput_->setDevice(chooseAudioInput(preferredAudioInput));
    session_->setAudioInput(audioInput_);

    if (video) {
        camera_ = new QCamera(QMediaDevices::defaultVideoInput(), this);
        session_->setCamera(camera_);
        preview_ = new QVideoWidget(this);
        preview_->setMinimumSize(480, 270);
        session_->setVideoOutput(preview_);
        layout->addWidget(preview_, 1);
    }

    statusLabel_ = new QLabel(this);
    statusLabel_->setWordWrap(true);
    timeLabel_ = new QLabel(formatDuration(0), this);
    recordButton_ = new QPushButton(QStringLiteral("Record"), this);
    recordButton_->setEnabled(false);
    sendButton_ = new QPushButton(QStringLiteral("Send"), this);
    sendButton_->setEnabled(false);
    sendButton_->setDefault(true);
    auto *cancelButton = new QPushButton(QStringLiteral("Cancel"), this);

    auto *controls = new QHBoxLayout;
    controls->addWidget(recordButton_);
    controls->addWidget(timeLabel_);
    controls->addStretch(1);
    controls->addWidget(cancelButton);
    controls->addWidget(sendButton_);
    layout->addWidget(statusLabel_);
    layout->addLayout(controls);

    connect(recordButton_, &QPushButton::clicked, this, [this] {
        if (recorder_->recorderState() == QMediaRecorder::RecordingState) {
            recorder_->stop();
        } else {
            startRecording();
        }
    });
    connect(sendButton_, &QPushButton::clicked, this, &QDialog::accept);
    connect(cancelButton, &QPushButton::clicked, this, &QDialog::reject);
    connect(recorder_, &QMediaRecorder::recorderStateChanged, this,
            [this](QMediaRecorder::RecorderState state) {
                if (state == QMediaRecorder::StoppedState && !outputPath_.isEmpty()) {
                    const QString actual = recorder_->actualLocation().toLocalFile();
                    if (!actual.isEmpty()) {
                        outputPath_ = actual;
                    }
                    durationMs_ = recorder_->duration();
                    timeLabel_->setText(formatDuration(durationMs_));
                }
                updateControls();
            });
    connect(recorder_, &QMediaRecorder::durationChanged, this, [this](qint64 milliseconds) {
        timeLabel_->setText(formatDuration(milliseconds));
        if (recorder_->recorderState() == QMediaRecorder::RecordingState && milliseconds >= maxDurationMs_) {
            recorder_->stop();
        }
    });
    connect(recorder_, &QMediaRecorder::errorOccurred, this,
            [this](QMediaRecorder::Error, const QString &message) {
                statusLabel_->setText(message);
            });

    if (!tempDir_.isValid()) {
        accessDenied(QStringLiteral("Could not create a temporary folder for the recording."));
        return;
    }
    if (audioInput_->device().isNull()) {
        accessDenied(QStringLiteral("No microphone is available."));
        return;
    }
    if (video && camera_->cameraDevice().isNull()) {
        accessDenied(QStringLiteral("No camera is available."));
        return;
    }
    statusLabel_->setText(QStringLiteral("Requesting microphone access…"));
    requestAccess(QMicrophonePermission(),
                  QStringLiteral("Microphone access is denied. Allow Pinger in your system privacy settings."),
                  [this, video] {
                      if (video) {
                          statusLabel_->setText(QStringLiteral("Requesting camera access…"));
                          requestAccess(QCameraPermission(),
                                        QStringLiteral("Camera access is denied. Allow Pinger in your system privacy settings."),
                                        [this] { accessGranted(); });
                      } else {
                          accessGranted();
                      }
                  });
}

RecordingDialog::~RecordingDialog() {
    stopAndWait();
}

QString RecordingDialog::recordedPath() const {
    return outputPath_;
}

qint64 RecordingDialog::durationMs() const {
    return durationMs_;
}

void RecordingDialog::done(int result) {
    stopAndWait();
    QDialog::done(result);
}

void RecordingDialog::requestAccess(const QPermission &permission, const QString &deniedMessage,
                                    std::function<void()> granted) {
    switch (qApp->checkPermission(permission)) {
    case Qt::PermissionStatus::Granted:
        granted();
        return;
    case Qt::PermissionStatus::Denied:
        accessDenied(deniedMessage);
        return;
    case Qt::PermissionStatus::Undetermined:
        break;
    }
    qApp->requestPermission(permission, this,
                            [this, deniedMessage, granted = std::move(granted)](const QPermission &result) {
                                            if (result.status() == Qt::PermissionStatus::Granted) {
                                                granted();
                                            } else {
                                                accessDenied(deniedMessage);
                                            }
                                        });
}

void RecordingDialog::accessGranted() {
    ready_ = true;
    if (camera_) {
        camera_->start();
    }
    statusLabel_->setText(QStringLiteral("Press Record to start."));
    updateControls();
}

void RecordingDialog::accessDenied(const QString &message) {
    statusLabel_->setText(message);
    updateControls();
}

void RecordingDialog::startRecording() {
    const bool video = kind_ == Kind::VideoMessage;
    const QString name = QStringLiteral("%1-%2.%3")
                             .arg(video ? QStringLiteral("video-message") : QStringLiteral("voice-message"),
                                  QDateTime::currentDateTime().toString(QStringLiteral("yyyyMMdd-HHmmss")),
                                  video ? QStringLiteral("mp4") : QStringLiteral("m4a"));
    outputPath_ = tempDir_.filePath(name);
    durationMs_ = 0;
    statusLabel_->clear();
    recorder_->setOutputLocation(QUrl::fromLocalFile(outputPath_));
    recorder_->record();
}

void RecordingDialog::stopAndWait() {
    if (recorder_->recorderState() != QMediaRecorder::RecordingState) {
        return;
    }
    QEventLoop loop;
    connect(recorder_, &QMediaRecorder::recorderStateChanged, &loop,
            [&loop](QMediaRecorder::RecorderState state) {
                if (state == QMediaRecorder::StoppedState) {
                    loop.quit();
                }
            });
    QTimer::singleShot(5000, &loop, &QEventLoop::quit);
    recorder_->stop();
    loop.exec();
}

void RecordingDialog::updateControls() {
    const bool recording = recorder_->recorderState() == QMediaRecorder::RecordingState;
    const bool hasRecording = !recording && durationMs_ > 0 && !outputPath_.isEmpty();
    recordButton_->setText(recording ? QStringLiteral("Stop")
                                     : (hasRecording ? QStringLiteral("Record again") : QStringLiteral("Record")));
    recordButton_->setEnabled(ready_ || recording);
    sendButton_->setEnabled(hasRecording);
}

MediaPlayerDialog::MediaPlayerDialog(const QString &title, const QString &mime, const QByteArray &data,
                                     QWidget *parent)
    : QDialog(parent) {
    setWindowTitle(title);
    resize(640, 480);
    const bool video = mime.startsWith(QStringLiteral("video/"));
    auto *layout = new QVBoxLayout(this);

    player_ = new QMediaPlayer(this);
    audioOutput_ = new QAudioOutput(this);
    player_->setAudioOutput(audioOutput_);
    if (video) {
        auto *videoWidget = new QVideoWidget(this);
        videoWidget->setMinimumSize(480, 270);
        player_->setVideoOutput(videoWidget);
        layout->addWidget(videoWidget, 1);
    }

    statusLabel_ = new QLabel(this);
    statusLabel_->setWordWrap(true);
    playButton_ = new QPushButton(QStringLiteral("Play"), this);
    positionSlider_ = new QSlider(Qt::Horizontal, this);
    timeLabel_ = new QLabel(QStringLiteral("0:00 / 0:00"), this);

    auto *controls = new QHBoxLayout;
    controls->addWidget(playButton_);
    controls->addWidget(positionSlider_, 1);
    controls->addWidget(timeLabel_);
    layout->addWidget(statusLabel_);
    layout->addLayout(controls);

    connect(playButton_, &QPushButton::clicked, this, [this] {
        if (player_->playbackState() == QMediaPlayer::PlayingState) {
            player_->pause();
        } else {
            player_->play();
        }
    });
    connect(player_, &QMediaPlayer::playbackStateChanged, this,
            [this](QMediaPlayer::PlaybackState state) {
                playButton_->setText(state == QMediaPlayer::PlayingState ? QStringLiteral("Pause")
                                                                         : QStringLiteral("Play"));
            });
    connect(player_, &QMediaPlayer::positionChanged, this, [this](qint64 position) {
        positionSlider_->setValue(static_cast<int>(position));
        updateTimeLabel();
    });
    connect(player_, &QMediaPlayer::durationChanged, this, [this](qint64 duration) {
        positionSlider_->setRange(0, static_cast<int>(duration));
        updateTimeLabel();
    });
    connect(positionSlider_, &QSlider::sliderMoved, player_, [this](int position) {
        player_->setPosition(position);
    });
    connect(player_, &QMediaPlayer::errorOccurred, this,
            [this](QMediaPlayer::Error, const QString &message) {
                statusLabel_->setText(message);
            });

    const QString suffix = QMimeDatabase().mimeTypeForName(mime).preferredSuffix();
    const QString path = tempDir_.filePath(
        QStringLiteral("media.%1").arg(suffix.isEmpty() ? QStringLiteral("bin") : suffix));
    QFile file(path);
    const bool written = tempDir_.isValid() && file.open(QIODevice::WriteOnly)
        && file.write(data) == data.size();
    file.close();
    if (!written) {
        statusLabel_->setText(QStringLiteral("The media could not be prepared for playback."));
        playButton_->setEnabled(false);
        return;
    }
    player_->setSource(QUrl::fromLocalFile(path));
    player_->play();
}

MediaPlayerDialog::~MediaPlayerDialog() {
    player_->stop();
}

void MediaPlayerDialog::updateTimeLabel() {
    timeLabel_->setText(QStringLiteral("%1 / %2")
                            .arg(formatDuration(player_->position()), formatDuration(player_->duration())));
}
