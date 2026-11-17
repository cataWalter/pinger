#pragma once

#include <QStyledItemDelegate>

class RoomListDelegate final : public QStyledItemDelegate {
    Q_OBJECT

public:
    explicit RoomListDelegate(QObject *parent = nullptr);
    void setContentBlur(bool enabled);
    QSize sizeHint(const QStyleOptionViewItem &option,
                   const QModelIndex &index) const override;
    void paint(QPainter *painter, const QStyleOptionViewItem &option,
               const QModelIndex &index) const override;

private:
    bool contentBlur_ = false;
};

class PrivacyBlurDelegate final : public QStyledItemDelegate {
public:
    explicit PrivacyBlurDelegate(QObject *parent = nullptr);
    void setContentBlur(bool enabled);
    void paint(QPainter *painter, const QStyleOptionViewItem &option,
               const QModelIndex &index) const override;

private:
    bool contentBlur_ = false;
};

class MessageBubbleDelegate final : public QStyledItemDelegate {
    Q_OBJECT

public:
    explicit MessageBubbleDelegate(QObject *parent = nullptr);
    void setShowSenderNames(bool show);
    void setContentBlur(bool enabled);
    QSize sizeHint(const QStyleOptionViewItem &option,
                   const QModelIndex &index) const override;
    void paint(QPainter *painter, const QStyleOptionViewItem &option,
               const QModelIndex &index) const override;

private:
    bool showSenderNames_ = true;
    bool contentBlur_ = false;
};
