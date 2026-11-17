#include "chatitemdelegate.h"

#include <QDateTime>
#include <QFontMetrics>
#include <QImage>
#include <QJsonObject>
#include <QLinearGradient>
#include <QPaintDevice>
#include <QPainterPath>
#include <QPainter>
#include <QRegularExpression>
#include <QVariantMap>
#include <QVector>

#include <cmath>

namespace {

const QColor kSurface(QStringLiteral("#1C2B40"));
const QColor kSent(QStringLiteral("#A74765"));
const QColor kSentHighlight(QStringLiteral("#B55472"));
const QColor kReceived(QStringLiteral("#18263A"));
const QColor kBubbleBorder(QStringLiteral("#344963"));
const QColor kPrimary(QStringLiteral("#EAF1FC"));
const QColor kSecondary(QStringLiteral("#9AABC2"));
const QColor kAccent(QStringLiteral("#D67593"));

QJsonObject objectData(const QModelIndex &index, int role) {
    return QJsonObject::fromVariantMap(index.data(role).toMap());
}

// True when the previous message is from the same author and side, so the sender header can be omitted.
bool continuesSender(const QModelIndex &index) {
    const QModelIndex previous = index.sibling(index.row() - 1, index.column());
    if (!previous.isValid()) {
        return false;
    }
    const QJsonObject current = objectData(index, Qt::UserRole + 1);
    const QJsonObject before = objectData(previous, Qt::UserRole + 1);
    const QString author = current.value(QStringLiteral("sender")).toString();
    return !author.isEmpty()
        && author == before.value(QStringLiteral("sender")).toString()
        && current.value(QStringLiteral("own")).toBool() == before.value(QStringLiteral("own")).toBool();
}

QString initials(const QString &name) {
    const QStringList words = name.trimmed().split(
        QRegularExpression(QStringLiteral("[\\s_.@-]+")), Qt::SkipEmptyParts);
    if (words.isEmpty()) {
        return QStringLiteral("?");
    }
    QString result = words.first().left(1).toUpper();
    if (words.size() > 1) {
        result += words.at(1).left(1).toUpper();
    }
    return result;
}

QString timeLabel(qint64 milliseconds) {
    if (milliseconds <= 0) {
        return {};
    }
    return QDateTime::fromMSecsSinceEpoch(milliseconds).toLocalTime()
        .toString(QStringLiteral("HH:mm"));
}

int wrappedHeight(const QFont &font, const QString &text, int width) {
    if (text.isEmpty()) {
        return 0;
    }
    const QFontMetrics metrics(font);
    return metrics.boundingRect(QRect(0, 0, qMax(80, width), 10000),
                                Qt::TextWordWrap, text).height();
}

int naturalTextWidth(const QFont &font, const QString &text) {
    const QFontMetrics metrics(font);
    int width = 0;
    for (const QString &line : text.split(QLatin1Char('\n'))) {
        width = qMax(width, metrics.horizontalAdvance(line));
    }
    return width;
}

QImage gaussianBlur(const QImage &source, qreal sigma) {
    const QImage input = source.convertToFormat(QImage::Format_ARGB32_Premultiplied);
    if (input.isNull()) {
        return {};
    }
    const int radius = qMax(1, static_cast<int>(std::ceil(sigma * 3.0)));
    QVector<qreal> kernel(radius * 2 + 1);
    qreal kernelTotal = 0.0;
    for (int offset = -radius; offset <= radius; ++offset) {
        const qreal weight = std::exp(-(offset * offset) / (2.0 * sigma * sigma));
        kernel[offset + radius] = weight;
        kernelTotal += weight;
    }
    for (qreal &weight : kernel) {
        weight /= kernelTotal;
    }

    QImage horizontal(input.size(), QImage::Format_ARGB32_Premultiplied);
    QImage blurred(input.size(), QImage::Format_ARGB32_Premultiplied);
    const int width = input.width();
    const int height = input.height();
    for (int y = 0; y < height; ++y) {
        const auto *sourceLine = reinterpret_cast<const QRgb *>(input.constScanLine(y));
        auto *targetLine = reinterpret_cast<QRgb *>(horizontal.scanLine(y));
        for (int x = 0; x < width; ++x) {
            qreal red = 0.0;
            qreal green = 0.0;
            qreal blue = 0.0;
            qreal alpha = 0.0;
            for (int offset = -radius; offset <= radius; ++offset) {
                const QRgb pixel = sourceLine[qBound(0, x + offset, width - 1)];
                const qreal weight = kernel[offset + radius];
                red += qRed(pixel) * weight;
                green += qGreen(pixel) * weight;
                blue += qBlue(pixel) * weight;
                alpha += qAlpha(pixel) * weight;
            }
            targetLine[x] = qRgba(qRound(red), qRound(green), qRound(blue), qRound(alpha));
        }
    }
    for (int y = 0; y < height; ++y) {
        auto *targetLine = reinterpret_cast<QRgb *>(blurred.scanLine(y));
        for (int x = 0; x < width; ++x) {
            qreal red = 0.0;
            qreal green = 0.0;
            qreal blue = 0.0;
            qreal alpha = 0.0;
            for (int offset = -radius; offset <= radius; ++offset) {
                const auto *sourceLine = reinterpret_cast<const QRgb *>(
                    horizontal.constScanLine(qBound(0, y + offset, height - 1)));
                const QRgb pixel = sourceLine[x];
                const qreal weight = kernel[offset + radius];
                red += qRed(pixel) * weight;
                green += qGreen(pixel) * weight;
                blue += qBlue(pixel) * weight;
                alpha += qAlpha(pixel) * weight;
            }
            targetLine[x] = qRgba(qRound(red), qRound(green), qRound(blue), qRound(alpha));
        }
    }
    return blurred;
}

template <typename Draw>
void drawBlurred(QPainter *painter, const QRect &rect, Draw draw) {
    if (rect.width() <= 0 || rect.height() <= 0) {
        return;
    }
    const qreal dpr = qMax<qreal>(1.0, painter->device()->devicePixelRatioF());
    QImage image(qMax(1, qRound(rect.width() * dpr)),
                 qMax(1, qRound(rect.height() * dpr)),
                 QImage::Format_ARGB32_Premultiplied);
    image.setDevicePixelRatio(dpr);
    image.fill(Qt::transparent);
    {
        QPainter imagePainter(&image);
        imagePainter.setRenderHints(painter->renderHints());
        draw(&imagePainter, QRect(QPoint(), rect.size()));
    }
    const int reduction = qMax(2, qRound(2.0 * dpr));
    const QSize reducedSize(qMax(1, image.width() / reduction),
                            qMax(1, image.height() / reduction));
    QImage reduced = image.scaled(reducedSize, Qt::IgnoreAspectRatio, Qt::SmoothTransformation);
    reduced.setDevicePixelRatio(1.0);
    const QImage blurredReduced = gaussianBlur(reduced, 8.0 * dpr / reduction);
    QImage blurred = blurredReduced.scaled(image.size(), Qt::IgnoreAspectRatio,
                                           Qt::SmoothTransformation);
    blurred.setDevicePixelRatio(dpr);
    painter->drawImage(rect.topLeft(), blurred);
}

void drawBlurredText(QPainter *painter, const QRect &rect, const QString &text,
                     const QFont &font, const QColor &color, int flags) {
    if (text.isEmpty()) {
        return;
    }
    drawBlurred(painter, rect, [&text, &font, &color, flags](QPainter *target, const QRect &localRect) {
        target->setFont(font);
        target->setPen(color);
        target->drawText(localRect, flags, text);
    });
}

void drawBlurredPixmap(QPainter *painter, const QRect &rect, const QPixmap &pixmap) {
    if (pixmap.isNull()) {
        return;
    }
    drawBlurred(painter, rect, [&pixmap](QPainter *target, const QRect &localRect) {
        target->drawPixmap(localRect, pixmap);
    });
}

} // namespace

RoomListDelegate::RoomListDelegate(QObject *parent) : QStyledItemDelegate(parent) {}

void RoomListDelegate::setContentBlur(bool enabled) {
    if (contentBlur_ == enabled) {
        return;
    }
    contentBlur_ = enabled;
    emit sizeHintChanged(QModelIndex());
}

QSize RoomListDelegate::sizeHint(const QStyleOptionViewItem &option,
                                 const QModelIndex &) const {
    return QSize(option.rect.width(), 60);
}

void RoomListDelegate::paint(QPainter *painter, const QStyleOptionViewItem &option,
                             const QModelIndex &index) const {
    const QJsonObject room = objectData(index, Qt::UserRole + 1);
    const QString name = room.value(QStringLiteral("name")).toString(index.data().toString());
    const QString preview = room.value(QStringLiteral("preview")).toString().simplified();
    const int unread = room.value(QStringLiteral("unread")).toInt();
    const int mentions = room.value(QStringLiteral("mentions")).toInt();
    const qint64 lastEventAt = static_cast<qint64>(
        room.value(QStringLiteral("lastEventAt")).toDouble());
    const QRect row = option.rect.adjusted(6, 1, -6, -1);
    const bool selected = option.state.testFlag(QStyle::State_Selected);
    const bool hovered = option.state.testFlag(QStyle::State_MouseOver);
    const bool blurred = contentBlur_ && !hovered
        && !option.state.testFlag(QStyle::State_HasFocus);

    painter->save();
    painter->setRenderHint(QPainter::Antialiasing, true);
    painter->setRenderHint(QPainter::SmoothPixmapTransform, true);
    if (selected || hovered) {
        painter->setPen(Qt::NoPen);
        painter->setBrush(selected ? kSurface : QColor(QStringLiteral("#142238")));
        painter->drawRoundedRect(row, 11, 11);
    }
    if (selected) {
        painter->setPen(Qt::NoPen);
        painter->setBrush(kAccent);
        painter->drawRoundedRect(QRect(row.left(), row.top() + 12, 3, row.height() - 24), 1.5, 1.5);
    }

    const QRect avatar(row.left() + 10, row.center().y() - 19, 38, 38);
    const uint hash = qHash(name);
    const QColor avatarColor = blurred ? QColor(QStringLiteral("#65758C"))
        : QColor::fromHsv(static_cast<int>(hash % 360), 105, 150);
    const QIcon avatarIcon = qvariant_cast<QIcon>(index.data(Qt::DecorationRole));
    if (!avatarIcon.isNull()) {
        painter->save();
        QPainterPath clip;
        clip.addEllipse(avatar);
        painter->setClipPath(clip);
        const QPixmap pixmap = avatarIcon.pixmap(avatar.size(), painter->device()->devicePixelRatioF());
        if (blurred) {
            drawBlurredPixmap(painter, avatar, pixmap);
        } else {
            painter->drawPixmap(avatar, pixmap);
        }
        painter->restore();
    } else {
        painter->setPen(Qt::NoPen);
        painter->setBrush(avatarColor);
        painter->drawEllipse(avatar);
        QFont avatarFont = option.font;
        avatarFont.setBold(true);
        avatarFont.setPixelSize(14);
        if (blurred) {
            drawBlurredText(painter, avatar, initials(name), avatarFont, Qt::white, Qt::AlignCenter);
        } else {
            painter->setFont(avatarFont);
            painter->setPen(Qt::white);
            painter->drawText(avatar, Qt::AlignCenter, initials(name));
        }
    }

    const int textLeft = avatar.right() + 12;
    const int timeWidth = 48;
    const QRect timeRect(row.right() - timeWidth - 8, row.top() + 9, timeWidth, 16);
    QFont small = option.font;
    small.setPixelSize(11);
    painter->setFont(small);
    painter->setPen(kSecondary);
    painter->drawText(timeRect, Qt::AlignRight | Qt::AlignVCenter, timeLabel(lastEventAt));

    const int badgeWidth = unread > 0 ? qMax(22, qMin(42, QString::number(unread).size() * 8 + 14)) : 0;
    const int rightInset = unread > 0 ? badgeWidth + 18 : 10;
    const int nameRightInset = qMax(rightInset, lastEventAt > 0 ? timeWidth + 8 : 10);
    const QRect nameRect(textLeft, row.top() + 9,
                         qMax(0, row.right() - textLeft - nameRightInset), 22);
    QFont nameFont = option.font;
    nameFont.setBold(true);
    nameFont.setPixelSize(14);
    const QString elidedName = QFontMetrics(nameFont).elidedText(name, Qt::ElideRight, nameRect.width());
    if (blurred) {
        drawBlurredText(painter, nameRect, elidedName, nameFont, kPrimary,
                        Qt::AlignLeft | Qt::AlignVCenter);
    } else {
        painter->setFont(nameFont);
        painter->setPen(kPrimary);
        painter->drawText(nameRect, Qt::AlignLeft | Qt::AlignVCenter, elidedName);
    }

    const QRect previewRect(textLeft, row.top() + 35,
                            qMax(30, row.right() - textLeft - rightInset), 18);
    const QString elidedPreview = QFontMetrics(small).elidedText(
        preview, Qt::ElideRight, previewRect.width());
    if (blurred) {
        drawBlurredText(painter, previewRect, elidedPreview, small, kSecondary,
                        Qt::AlignLeft | Qt::AlignVCenter);
    } else {
        painter->setFont(small);
        painter->setPen(kSecondary);
        painter->drawText(previewRect, Qt::AlignLeft | Qt::AlignVCenter, elidedPreview);
    }

    if (unread > 0) {
        const QString label = mentions > 0 ? QStringLiteral("%1").arg(mentions)
                                            : QString::number(unread);
        const int width = qMax(22, qMin(42, label.size() * 8 + 14));
        const QRect badge(row.right() - width - 8, row.bottom() - 24, width, 18);
        painter->setPen(Qt::NoPen);
        painter->setBrush(kAccent);
        painter->drawRoundedRect(badge, 9, 9);
        QFont badgeFont = small;
        badgeFont.setBold(true);
        painter->setFont(badgeFont);
        painter->setPen(Qt::white);
        painter->drawText(badge, Qt::AlignCenter, label);
    }
    painter->restore();
}

PrivacyBlurDelegate::PrivacyBlurDelegate(QObject *parent) : QStyledItemDelegate(parent) {}

void PrivacyBlurDelegate::setContentBlur(bool enabled) {
    if (contentBlur_ == enabled) {
        return;
    }
    contentBlur_ = enabled;
    emit sizeHintChanged(QModelIndex());
}

void PrivacyBlurDelegate::paint(QPainter *painter, const QStyleOptionViewItem &option,
                                const QModelIndex &index) const {
    const bool blurred = contentBlur_
        && !option.state.testFlag(QStyle::State_MouseOver)
        && !option.state.testFlag(QStyle::State_HasFocus);
    if (!blurred) {
        QStyledItemDelegate::paint(painter, option, index);
        return;
    }
    drawBlurred(painter, option.rect,
                [this, &option, &index](QPainter *target, const QRect &localRect) {
        QStyleOptionViewItem localOption(option);
        localOption.rect = localRect;
        QStyledItemDelegate::paint(target, localOption, index);
    });
}

MessageBubbleDelegate::MessageBubbleDelegate(QObject *parent)
    : QStyledItemDelegate(parent) {}

void MessageBubbleDelegate::setShowSenderNames(bool show) {
    if (showSenderNames_ == show) {
        return;
    }
    showSenderNames_ = show;
    emit sizeHintChanged(QModelIndex());
}

void MessageBubbleDelegate::setContentBlur(bool enabled) {
    if (contentBlur_ == enabled) {
        return;
    }
    contentBlur_ = enabled;
    emit sizeHintChanged(QModelIndex());
}

QSize MessageBubbleDelegate::sizeHint(const QStyleOptionViewItem &option,
                                      const QModelIndex &index) const {
    const QJsonObject message = objectData(index, Qt::UserRole + 1);
    const QString body = message.value(QStringLiteral("body")).toString(index.data().toString());
    const QString quote = message.value(QStringLiteral("replyToPreview")).toString();
    const bool own = message.value(QStringLiteral("own")).toBool();
    QFont bodyFont = option.font;
    bodyFont.setPixelSize(14);
    QFont metaFont = option.font;
    metaFont.setPixelSize(12);
    const QString sender = message.value(QStringLiteral("senderName")).toString(
        message.value(QStringLiteral("sender")).toString());
    const bool showSender = showSenderNames_ && !own && !continuesSender(index)
        && !sender.isEmpty();
    const int avatarSpace = showSender ? 38 : 0;
    const int available = qMax(180, option.rect.width() - 20 - avatarSpace);
    int contentWidth = qMax(naturalTextWidth(bodyFont, body),
                            naturalTextWidth(metaFont, quote));
    contentWidth = qMax(contentWidth, naturalTextWidth(metaFont, sender));
    if (index.data(Qt::DecorationRole).canConvert<QIcon>()) {
        contentWidth = qMax(contentWidth, 160);
    }
    const int bubbleWidth = qMin(660, qMax(150, qMin(available, contentWidth + 34)));
    const int textWidth = qMax(80, bubbleWidth - 36);
    const int headerHeight = showSender ? 18 : 0;
    int height = headerHeight + wrappedHeight(bodyFont, body, textWidth) + 12
        + wrappedHeight(metaFont, quote, textWidth) + (quote.isEmpty() ? 0 : 28) + 18;
    if (index.data(Qt::DecorationRole).canConvert<QIcon>()) {
        height += 100;
    }
    if (!message.value(QStringLiteral("sendError")).toString().isEmpty()) {
        height += 18;
    }
    return QSize(option.rect.width(), qMax(68, height + 12));
}

void MessageBubbleDelegate::paint(QPainter *painter, const QStyleOptionViewItem &option,
                                  const QModelIndex &index) const {
    const QJsonObject message = objectData(index, Qt::UserRole + 1);
    const bool own = message.value(QStringLiteral("own")).toBool();
    const QString body = message.value(QStringLiteral("body")).toString(index.data().toString());
    const QString quote = message.value(QStringLiteral("replyToPreview")).toString();
    const QString quoteSender = message.value(QStringLiteral("replyToSender")).toString();
    const QString sender = message.value(QStringLiteral("senderName")).toString(
        message.value(QStringLiteral("sender")).toString());
    const QString error = message.value(QStringLiteral("sendError")).toString();
    const QString timestamp = timeLabel(static_cast<qint64>(
        message.value(QStringLiteral("timestamp")).toDouble()));
    const bool blurred = contentBlur_
        && !option.state.testFlag(QStyle::State_MouseOver)
        && !option.state.testFlag(QStyle::State_HasFocus);

    QFont bodyFont = option.font;
    bodyFont.setPixelSize(14);
    QFont senderFont = option.font;
    senderFont.setPixelSize(12);
    senderFont.setBold(true);
    QFont metaFont = option.font;
    metaFont.setPixelSize(11);
    const QIcon mediaIcon = qvariant_cast<QIcon>(index.data(Qt::DecorationRole));

    const QRect row = option.rect.adjusted(10, 5, -10, -5);
    const bool continued = showSenderNames_ && continuesSender(index);
    const bool showSender = showSenderNames_ && !own && !continued && !sender.isEmpty();
    const int avatarSpace = showSender ? 38 : 0;
    const int availableWidth = qMax(180, row.width() - avatarSpace);
    int contentWidth = qMax(naturalTextWidth(bodyFont, body),
                            naturalTextWidth(metaFont, quote));
    contentWidth = qMax(contentWidth, naturalTextWidth(senderFont, sender));
    if (!mediaIcon.isNull()) {
        contentWidth = qMax(contentWidth, 160);
    }
    const int bubbleWidth = qMin(660, qMax(150, qMin(availableWidth, contentWidth + 34)));
    const int bubbleX = own ? row.right() - bubbleWidth : row.left() + avatarSpace;
    QRect bubble(bubbleX, row.top(), bubbleWidth, row.height());

    const int innerWidth = qMax(80, bubble.width() - 36);
    const int senderHeight = showSender ? 18 : 0;
    const int quoteHeight = quote.isEmpty() ? 0 : 34;
    const int bodyHeight = wrappedHeight(bodyFont, body, innerWidth);
    const int mediaHeight = mediaIcon.isNull() ? 0 : 92;
    const int errorHeight = error.isEmpty() ? 0 : 17;
    const int contentHeight = 12 + senderHeight + quoteHeight
        + qMax(18, bodyHeight) + (mediaHeight > 0 ? mediaHeight + 8 : 0)
        + 8 + errorHeight + 16;
    bubble.setHeight(qMin(row.height(), qMax(54, contentHeight)));

    painter->save();
    painter->setRenderHint(QPainter::Antialiasing, true);
    painter->setRenderHint(QPainter::SmoothPixmapTransform, true);
    if (own) {
        painter->setPen(Qt::NoPen);
        QLinearGradient sentGradient(bubble.topLeft(), bubble.bottomLeft());
        sentGradient.setColorAt(0, kSentHighlight);
        sentGradient.setColorAt(1, kSent);
        painter->setBrush(sentGradient);
    } else {
        painter->setPen(QPen(kBubbleBorder, 1));
        painter->setBrush(kReceived);
    }
    painter->drawRoundedRect(bubble, 14, 14);

    int y = bubble.top() + (continued ? 8 : 10);
    if (showSender) {
        const QIcon avatarIcon = qvariant_cast<QIcon>(index.data(Qt::UserRole + 2));
        const QRect avatarRect(row.left(), bubble.top() + 1, 30, 30);
        if (!avatarIcon.isNull()) {
            painter->save();
            QPainterPath clip;
            clip.addEllipse(avatarRect);
            painter->setClipPath(clip);
            const QPixmap pixmap = avatarIcon.pixmap(avatarRect.size(),
                                                     painter->device()->devicePixelRatioF());
            if (blurred) {
                drawBlurredPixmap(painter, avatarRect, pixmap);
            } else {
                painter->drawPixmap(avatarRect, pixmap);
            }
            painter->restore();
        } else {
            const uint hash = qHash(sender);
            painter->setPen(Qt::NoPen);
            painter->setBrush(blurred ? QColor(QStringLiteral("#65758C"))
                                      : QColor::fromHsv(static_cast<int>(hash % 360), 100, 145));
            painter->drawEllipse(avatarRect);
            QFont avatarFont = option.font;
            avatarFont.setBold(true);
            avatarFont.setPixelSize(11);
            if (blurred) {
                drawBlurredText(painter, avatarRect, initials(sender), avatarFont,
                                Qt::white, Qt::AlignCenter);
            } else {
                painter->setFont(avatarFont);
                painter->setPen(Qt::white);
                painter->drawText(avatarRect, Qt::AlignCenter, initials(sender));
            }
        }
        const QRect senderRect(bubble.left() + 16, y, innerWidth, 18);
        const QString elidedSender = QFontMetrics(senderFont).elidedText(
            sender, Qt::ElideRight, innerWidth);
        const QColor senderColor(QStringLiteral("#D98AA2"));
        if (blurred) {
            drawBlurredText(painter, senderRect, elidedSender, senderFont, senderColor,
                            Qt::AlignLeft | Qt::AlignVCenter);
        } else {
            painter->setFont(senderFont);
            painter->setPen(senderColor);
            painter->drawText(senderRect, Qt::AlignLeft | Qt::AlignVCenter, elidedSender);
        }
        y += senderHeight;
    }
    if (!quote.isEmpty()) {
        const QRect quoteRect(bubble.left() + 14, y, innerWidth + 4, 30);
        painter->setPen(Qt::NoPen);
        painter->setBrush(QColor(255, 255, 255, 24));
        painter->drawRoundedRect(quoteRect, 6, 6);
        painter->setBrush(kAccent);
        painter->drawRoundedRect(QRect(quoteRect.left(), quoteRect.top(), 3, quoteRect.height()), 1, 1);
        painter->setFont(metaFont);
        painter->setPen(kPrimary);
        const QString replyText = quoteSender.isEmpty() ? quote
            : QStringLiteral("%1: %2").arg(quoteSender, quote);
        const QRect quoteTextRect = quoteRect.adjusted(9, 2, -5, -2);
        const QString elidedReply = QFontMetrics(metaFont).elidedText(
            replyText, Qt::ElideRight, quoteRect.width() - 14);
        if (blurred) {
            drawBlurredText(painter, quoteTextRect, elidedReply, metaFont, kPrimary,
                            Qt::AlignLeft | Qt::AlignVCenter);
        } else {
            painter->drawText(quoteTextRect, Qt::AlignLeft | Qt::AlignVCenter, elidedReply);
        }
        y += quoteHeight;
    }

    const QRect textRect(bubble.left() + 16, y, innerWidth, qMax(18, bodyHeight));
    if (blurred) {
        drawBlurredText(painter, textRect, body, bodyFont, kPrimary,
                        Qt::AlignLeft | Qt::AlignTop | Qt::TextWordWrap);
    } else {
        painter->setFont(bodyFont);
        painter->setPen(kPrimary);
        painter->drawText(textRect, Qt::AlignLeft | Qt::AlignTop | Qt::TextWordWrap, body);
    }
    if (!mediaIcon.isNull()) {
        const qreal dpr = painter->device()->devicePixelRatioF();
        QPixmap preview = mediaIcon.pixmap(QSize(160, 88), dpr);
        preview.setDevicePixelRatio(dpr);
        if (!preview.isNull()) {
            const QSize logicalSize = preview.deviceIndependentSize().toSize();
            const QRect previewRect(bubble.left() + 16, y + bodyHeight + 6,
                                    logicalSize.width(), logicalSize.height());
            if (blurred) {
                drawBlurredPixmap(painter, previewRect, preview);
            } else {
                painter->drawPixmap(previewRect.topLeft(), preview);
            }
        }
    }

    painter->setFont(metaFont);
    painter->setPen(kSecondary);
    if (!error.isEmpty()) {
        painter->setPen(QColor(QStringLiteral("#F87171")));
        painter->drawText(QRect(bubble.left() + 16, bubble.bottom() - 32, innerWidth, 16),
                          Qt::AlignLeft | Qt::AlignVCenter, error);
    }
    painter->setPen(kSecondary);
    painter->drawText(QRect(bubble.left() + 12, bubble.bottom() - 21,
                            bubble.width() - 24, 14),
                      Qt::AlignRight | Qt::AlignVCenter,
                      message.value(QStringLiteral("edited")).toBool()
                          ? QStringLiteral("edited · %1").arg(timestamp) : timestamp);
    painter->restore();
}
