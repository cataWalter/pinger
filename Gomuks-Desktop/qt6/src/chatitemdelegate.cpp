#include "chatitemdelegate.h"

#include <QDateTime>
#include <QFontMetrics>
#include <QJsonObject>
#include <QPainter>
#include <QRegularExpression>
#include <QVariantMap>

namespace {

const QColor kSurface(QStringLiteral("#22262E"));
const QColor kSent(QStringLiteral("#2B5278"));
const QColor kReceived(QStringLiteral("#1E2229"));
const QColor kPrimary(QStringLiteral("#F3F4F6"));
const QColor kSecondary(QStringLiteral("#8E95A2"));
const QColor kAccent(QStringLiteral("#3B82F6"));

QJsonObject objectData(const QModelIndex &index, int role) {
    return QJsonObject::fromVariantMap(index.data(role).toMap());
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

} // namespace

RoomListDelegate::RoomListDelegate(QObject *parent) : QStyledItemDelegate(parent) {}

QSize RoomListDelegate::sizeHint(const QStyleOptionViewItem &option,
                                 const QModelIndex &) const {
    return QSize(option.rect.width(), 68);
}

void RoomListDelegate::paint(QPainter *painter, const QStyleOptionViewItem &option,
                             const QModelIndex &index) const {
    const QJsonObject room = objectData(index, Qt::UserRole + 1);
    const QString name = room.value(QStringLiteral("name")).toString(index.data().toString());
    const QString preview = room.value(QStringLiteral("preview")).toString();
    const int unread = room.value(QStringLiteral("unread")).toInt();
    const int mentions = room.value(QStringLiteral("mentions")).toInt();
    const qint64 lastEventAt = static_cast<qint64>(
        room.value(QStringLiteral("lastEventAt")).toDouble());
    const QRect row = option.rect.adjusted(8, 2, -8, -2);
    const bool selected = option.state.testFlag(QStyle::State_Selected);
    const bool hovered = option.state.testFlag(QStyle::State_MouseOver);

    painter->save();
    painter->setRenderHint(QPainter::Antialiasing, true);
    painter->setRenderHint(QPainter::SmoothPixmapTransform, true);
    if (selected || hovered) {
        painter->setPen(Qt::NoPen);
        painter->setBrush(selected ? kSurface : QColor(QStringLiteral("#1D2026")));
        painter->drawRoundedRect(row, 10, 10);
    }

    const QRect avatar(row.left() + 8, row.center().y() - 22, 44, 44);
    const uint hash = qHash(name);
    const QColor avatarColor = QColor::fromHsv(static_cast<int>(hash % 360), 112, 174);
    painter->setPen(Qt::NoPen);
    painter->setBrush(avatarColor);
    painter->drawEllipse(avatar);
    QFont avatarFont = option.font;
    avatarFont.setBold(true);
    avatarFont.setPixelSize(15);
    painter->setFont(avatarFont);
    painter->setPen(Qt::white);
    painter->drawText(avatar, Qt::AlignCenter, initials(name));

    const int textLeft = avatar.right() + 12;
    const int timeWidth = 48;
    const QRect timeRect(textLeft, row.top() + 11,
                         qMin(timeWidth, qMax(0, row.right() - textLeft - 8)), 16);
    QFont small = option.font;
    small.setPixelSize(11);
    painter->setFont(small);
    painter->setPen(kSecondary);
    painter->drawText(timeRect, Qt::AlignRight | Qt::AlignVCenter, timeLabel(lastEventAt));

    const int badgeWidth = unread > 0 ? qMax(22, qMin(42, QString::number(unread).size() * 8 + 14)) : 0;
    const int rightInset = unread > 0 ? badgeWidth + 18 : 10;
    const QRect nameRect(textLeft, row.top() + 9,
                         qMax(40, row.right() - textLeft - rightInset), 22);
    QFont nameFont = option.font;
    nameFont.setBold(true);
    nameFont.setPixelSize(14);
    painter->setFont(nameFont);
    painter->setPen(kPrimary);
    painter->drawText(nameRect, Qt::AlignLeft | Qt::AlignVCenter,
                      painter->fontMetrics().elidedText(name, Qt::ElideRight, nameRect.width()));

    const QRect previewRect(textLeft, row.top() + 35,
                            qMax(30, row.right() - textLeft - rightInset), 18);
    painter->setFont(small);
    painter->setPen(kSecondary);
    painter->drawText(previewRect, Qt::AlignLeft | Qt::AlignVCenter,
                      painter->fontMetrics().elidedText(preview, Qt::ElideRight,
                                                        previewRect.width()));

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

MessageBubbleDelegate::MessageBubbleDelegate(QObject *parent)
    : QStyledItemDelegate(parent) {}

QSize MessageBubbleDelegate::sizeHint(const QStyleOptionViewItem &option,
                                      const QModelIndex &index) const {
    const QJsonObject message = objectData(index, Qt::UserRole + 1);
    const QString body = message.value(QStringLiteral("body")).toString(index.data().toString());
    const QString quote = message.value(QStringLiteral("replyToPreview")).toString();
    const int available = qMax(220, option.rect.width());
    const int bubbleWidth = qMin(620, qMax(220, available * 68 / 100));
    const int textWidth = bubbleWidth - 36;
    QFont bodyFont = option.font;
    bodyFont.setPixelSize(14);
    QFont metaFont = option.font;
    metaFont.setPixelSize(12);
    int height = 18 + wrappedHeight(bodyFont, body, textWidth) + 12
        + wrappedHeight(metaFont, quote, textWidth) + (quote.isEmpty() ? 0 : 28) + 18;
    if (index.data(Qt::DecorationRole).canConvert<QIcon>()) {
        height += 100;
    }
    if (!message.value(QStringLiteral("sendError")).toString().isEmpty()) {
        height += 18;
    }
    return QSize(option.rect.width(), qMax(78, height + 12));
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

    const QRect row = option.rect.adjusted(10, 5, -10, -5);
    const int bubbleWidth = qMin(620, qMax(220, row.width() * 68 / 100));
    const int bubbleX = own ? row.right() - bubbleWidth : row.left();
    QRect bubble(bubbleX, row.top(), bubbleWidth, row.height());

    QFont bodyFont = option.font;
    bodyFont.setPixelSize(14);
    QFont senderFont = option.font;
    senderFont.setPixelSize(12);
    senderFont.setBold(true);
    QFont metaFont = option.font;
    metaFont.setPixelSize(11);
    const int innerWidth = bubble.width() - 36;
    const int senderHeight = own ? 0 : 18;
    const int quoteHeight = quote.isEmpty() ? 0 : 34;
    const int bodyHeight = wrappedHeight(bodyFont, body, innerWidth);
    const QIcon mediaIcon = qvariant_cast<QIcon>(index.data(Qt::DecorationRole));
    const int mediaHeight = mediaIcon.isNull() ? 0 : 92;
    const int errorHeight = error.isEmpty() ? 0 : 17;
    const int contentHeight = 12 + senderHeight + quoteHeight
        + qMax(18, bodyHeight) + (mediaHeight > 0 ? mediaHeight + 8 : 0)
        + 8 + errorHeight + 16;
    bubble.setHeight(qMin(row.height(), qMax(64, contentHeight)));

    painter->save();
    painter->setRenderHint(QPainter::Antialiasing, true);
    painter->setRenderHint(QPainter::SmoothPixmapTransform, true);
    painter->setPen(Qt::NoPen);
    painter->setBrush(own ? kSent : kReceived);
    painter->drawRoundedRect(bubble, 14, 14);

    int y = bubble.top() + 10;
    if (!own && !sender.isEmpty()) {
        painter->setFont(senderFont);
        painter->setPen(QColor(QStringLiteral("#8DB8E8")));
        painter->drawText(QRect(bubble.left() + 16, y, innerWidth, 18),
                          Qt::AlignLeft | Qt::AlignVCenter,
                          painter->fontMetrics().elidedText(sender, Qt::ElideRight, innerWidth));
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
        painter->drawText(quoteRect.adjusted(9, 2, -5, -2),
                          Qt::AlignLeft | Qt::AlignVCenter,
                          painter->fontMetrics().elidedText(replyText, Qt::ElideRight,
                                                            quoteRect.width() - 14));
        y += quoteHeight;
    }

    painter->setFont(bodyFont);
    painter->setPen(kPrimary);
    const QRect textRect(bubble.left() + 16, y, innerWidth, qMax(18, bodyHeight));
    painter->drawText(textRect, Qt::AlignLeft | Qt::AlignTop | Qt::TextWordWrap, body);
    if (!mediaIcon.isNull()) {
        const QPixmap preview = mediaIcon.pixmap(QSize(160, 88))
                                    .scaled(160, 88, Qt::KeepAspectRatio,
                                            Qt::SmoothTransformation);
        if (!preview.isNull()) {
            painter->drawPixmap(bubble.left() + 16, y + bodyHeight + 6, preview);
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
