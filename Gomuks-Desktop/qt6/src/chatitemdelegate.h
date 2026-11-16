#pragma once

#include <QStyledItemDelegate>

class RoomListDelegate final : public QStyledItemDelegate {
    Q_OBJECT

public:
    explicit RoomListDelegate(QObject *parent = nullptr);
    QSize sizeHint(const QStyleOptionViewItem &option,
                   const QModelIndex &index) const override;
    void paint(QPainter *painter, const QStyleOptionViewItem &option,
               const QModelIndex &index) const override;
};

class MessageBubbleDelegate final : public QStyledItemDelegate {
    Q_OBJECT

public:
    explicit MessageBubbleDelegate(QObject *parent = nullptr);
    QSize sizeHint(const QStyleOptionViewItem &option,
                   const QModelIndex &index) const override;
    void paint(QPainter *painter, const QStyleOptionViewItem &option,
               const QModelIndex &index) const override;
};
