#include "animations.h"

#include <QAbstractAnimation>
#include <QEasingCurve>
#include <QGraphicsOpacityEffect>
#include <QPointer>
#include <QPropertyAnimation>
#include <QScrollBar>
#include <QTimer>

void fadeIn(QWidget *widget, int durationMs) {
    if (!widget) {
        return;
    }
    // Cancel any fade still running so its finished handler cannot strip the new effect.
    delete widget->findChild<QPropertyAnimation *>(QStringLiteral("fadeIn"));
    auto *effect = new QGraphicsOpacityEffect(widget);
    effect->setOpacity(0.0);
    widget->setGraphicsEffect(effect);

    auto *animation = new QPropertyAnimation(effect, "opacity", widget);
    animation->setObjectName(QStringLiteral("fadeIn"));
    animation->setDuration(durationMs);
    animation->setStartValue(0.0);
    animation->setEndValue(1.0);
    animation->setEasingCurve(QEasingCurve::OutCubic);
    QObject::connect(animation, &QPropertyAnimation::finished, widget, [widget] {
        widget->setGraphicsEffect(nullptr);
    });
    animation->start(QAbstractAnimation::DeleteWhenStopped);
}

void smoothScrollToBottom(QAbstractItemView *view, int durationMs) {
    if (!view) {
        return;
    }
    QPointer<QAbstractItemView> guard(view);
    // Defer so the list has laid out the new rows and the scroll range is current.
    QTimer::singleShot(0, view, [guard, durationMs] {
        if (!guard) {
            return;
        }
        guard->doItemsLayout();
        QScrollBar *bar = guard->verticalScrollBar();
        if (auto *previous = bar->findChild<QPropertyAnimation *>(QStringLiteral("scrollToBottom"))) {
            previous->stop();
            delete previous;
        }
        if (durationMs <= 0) {
            bar->setValue(bar->maximum());
            return;
        }
        auto *animation = new QPropertyAnimation(bar, "value", bar);
        animation->setObjectName(QStringLiteral("scrollToBottom"));
        animation->setDuration(durationMs);
        animation->setStartValue(bar->value());
        animation->setEndValue(bar->maximum());
        animation->setEasingCurve(QEasingCurve::OutCubic);
        QObject::connect(bar, &QScrollBar::rangeChanged, animation,
                         [animation](int, int maximum) {
            if (animation->state() == QAbstractAnimation::Running) {
                animation->setEndValue(maximum);
            }
        });
        QObject::connect(animation, &QPropertyAnimation::finished,
                         animation, &QObject::deleteLater);
        QObject::connect(animation, &QPropertyAnimation::finished, guard,
                         [guard] {
            QTimer::singleShot(0, guard, [guard] {
                if (!guard) {
                    return;
                }
                guard->doItemsLayout();
                QScrollBar *currentBar = guard->verticalScrollBar();
                currentBar->setValue(currentBar->maximum());
            });
        });
        animation->start();
    });
}
