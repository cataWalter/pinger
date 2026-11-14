package desktop

import (
	"context"
	"errors"
	"log"
	"mychat/logging"
	"mychat/matrix"
	"net/http"
	"os"
	"time"
)

// notificationAvatarFile writes the sender avatar to a temp file for a native alert.
// It returns an empty path when no avatar can be used; the alert is still sent without it.
// The returned cleanup removes the temp file and must run after the alert is sent.
func (s *AppService) notificationAvatarFile(accountID, mxc string) (string, func()) {
	noop := func() {}
	if accountID == "" || mxc == "" {
		return "", noop
	}
	client := s.accountClientsSnapshot()[accountID]
	if client == nil {
		return "", noop
	}
	ctx, cancel := context.WithTimeout(context.Background(), notificationAvatarTimeout)
	defer cancel()
	data, err := client.DownloadAvatar(ctx, mxc)
	if err != nil {
		logging.For("service").Warn().Err(err).Msg("could not load sender avatar for notification")
		return "", noop
	}
	ext := notificationAvatarExtension(data)
	if ext == "" || len(data) > notificationAvatarMaxBytes {
		return "", noop
	}
	file, err := os.CreateTemp("", "pinger-avatar-*"+ext)
	if err != nil {
		logging.For("service").Warn().Err(err).Msg("could not create sender avatar file for notification")
		return "", noop
	}
	path := file.Name()
	cleanup := func() { _ = os.Remove(path) }
	_, writeErr := file.Write(data)
	if err = errors.Join(writeErr, file.Close()); err != nil {
		cleanup()
		logging.For("service").Warn().Err(err).Msg("could not write sender avatar file for notification")
		return "", noop
	}
	return path, cleanup
}

// notificationAvatarExtension returns the file extension for image types native alerts accept, or an empty string.
func notificationAvatarExtension(data []byte) string {
	switch http.DetectContentType(data) {
	case "image/png":
		return ".png"
	case "image/jpeg":
		return ".jpg"
	case "image/gif":
		return ".gif"
	default:
		return ""
	}
}

// ensureNotificationPermission prompts once so alerts work without flipping the settings toggle.
func (s *AppService) ensureNotificationPermission() (bool, error) {
	s.permissionMu.Lock()
	defer s.permissionMu.Unlock()
	if s.notifier.Permission() == "granted" {
		return true, nil
	}
	permission, err := s.notifier.RequestPermission()
	return permission == "granted", err
}

func (s *AppService) Logout() error {
	accountID := s.currentAccountID()
	client := s.currentClient()
	if err := client.Logout(s.ctx); err != nil {
		return err
	}
	clients := s.accountClientsSnapshot()
	s.accountMu.RLock()
	registry := s.accountRegistry
	s.accountMu.RUnlock()
	if registry != nil {
		for _, account := range registry.All() {
			nextClient := clients[account.ID]
			if account.ID == accountID || nextClient == nil || !nextClient.IsLoggedIn() {
				continue
			}
			if err := registry.SetActive(account.ID); err != nil {
				return err
			}
			s.setActiveAccount(account.ID, nextClient)
			return nil
		}
	}
	if s.quit != nil {
		s.quit()
	}
	return nil
}

func (s *AppService) startEventPump(emit func(Update)) {
	s.accountMu.Lock()
	s.emitUpdate = emit
	s.accountMu.Unlock()
	for accountID, client := range s.accountClientsSnapshot() {
		s.startAccountEventPump(accountID, client)
	}
}

func (s *AppService) startSync() {
	for accountID, client := range s.accountClientsSnapshot() {
		s.startAccountSync(accountID, client)
	}
}

func (s *AppService) startAccountSync(accountID string, client *matrix.Client) {
	s.accountMu.Lock()
	if s.accountSyncStarted == nil {
		s.accountSyncStarted = make(map[string]bool)
	}
	if s.accountSyncStarted[accountID] || !client.IsLoggedIn() || s.ctx.Err() != nil {
		s.accountMu.Unlock()
		return
	}
	s.accountSyncStarted[accountID] = true
	s.workers.Add(1)
	s.accountMu.Unlock()
	go func() {
		defer s.workers.Done()
		if err := client.StartWithRetry(s.ctx); err != nil && s.ctx.Err() == nil && s.currentAccountID() == accountID {
			s.accountMu.RLock()
			emit := s.emitUpdate
			s.accountMu.RUnlock()
			if emit != nil {
				emit(Update{Error: err.Error(), ConnectionState: string(matrix.StateOffline)})
			}
		}
	}()
}

func (s *AppService) startScheduledJobWorker() {
	if s.scheduled == nil || s.currentClient() == nil {
		return
	}
	s.workers.Add(1)
	go func() {
		defer s.workers.Done()
		ticker := time.NewTicker(time.Second)
		defer ticker.Stop()
		s.processDueScheduledJobs()
		for {
			select {
			case <-s.ctx.Done():
				return
			case <-ticker.C:
				s.processDueScheduledJobs()
			}
		}
	}()
}

type scheduledMessageSender interface {
	SendScheduledMessage(context.Context, string, string, string, string, func(string) error) error
}

func dispatchScheduledMessage(ctx context.Context, sender scheduledMessageSender, job ScheduledJob) error {
	return sender.SendScheduledMessage(ctx, job.RoomID, job.Text, job.ReplyToEventID, job.TransactionID, nil)
}

func dispatchDueScheduledMessagesForAccount(ctx context.Context, store *scheduledJobStore, accountID string, sender scheduledMessageSender, now int64) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	jobs, err := store.claimDueForAccount(scheduledMessageKind, now, accountID)
	if err != nil {
		return err
	}
	for _, job := range jobs {
		startedAt := time.Now().UnixMilli()
		sendCtx, cancel := context.WithTimeout(ctx, 2*time.Minute)
		sendErr := sender.SendScheduledMessage(sendCtx, job.RoomID, job.Text, job.ReplyToEventID, job.TransactionID, func(transactionID string) error {
			return store.recordTransaction(job.ID, transactionID)
		})
		cancel()
		if finishErr := store.finishMessage(job.ID, sendErr, startedAt, time.Now().UnixMilli()); finishErr != nil {
			log.Printf("finish scheduled message %s: %v", job.ID, finishErr)
		}
	}
	return nil
}

func (s *AppService) processDueScheduledJobs() {
	if s.scheduled == nil || s.ctx.Err() != nil {
		return
	}
	if err := s.scheduled.flushPendingCompletions(); err != nil {
		log.Printf("persist scheduled message completions: %v", err)
	}
	now := time.Now().UnixMilli()
	for accountID, client := range s.accountClientsSnapshot() {
		if !client.IsLoggedIn() || client.ConnectionState() != matrix.StateConnected {
			continue
		}
		s.workers.Add(1)
		go func() {
			defer s.workers.Done()
			if err := dispatchDueScheduledMessagesForAccount(s.ctx, s.scheduled, accountID, client, now); err != nil && s.ctx.Err() == nil {
				log.Printf("claim scheduled messages for account %s: %v", accountID, err)
			}
		}()
	}
	reminders, err := s.scheduled.claimDue(scheduledReminderKind, now)
	if err != nil {
		log.Printf("claim scheduled reminders: %v", err)
		return
	}
	for _, reminder := range reminders {
		if s.emitReminder != nil {
			s.emitReminder(reminder)
		}
	}
}

func (s *AppService) close() {
	s.cancel()
	s.imageEngine.stop()
	s.workers.Wait()
	if s.scheduled != nil {
		if err := s.scheduled.flushPendingCompletions(); err != nil {
			log.Printf("persist scheduled message completions on shutdown: %v", err)
		}
	}
	if s.preferencesUnsubscribe != nil {
		s.preferencesUnsubscribe()
		s.preferencesUnsubscribe = nil
	}
	if s.sharedPreferences != nil {
		if err := s.sharedPreferences.Close(); err != nil {
			log.Printf("close shared preferences: %v", err)
		}
	}
}

func mapRooms(rooms []matrix.Room) []Room {
	mapped := make([]Room, 0, len(rooms))
	for _, room := range rooms {
		mapped = append(mapped, Room{
			ID:              room.ID,
			Name:            room.Name,
			Topic:           room.Topic,
			Avatar:          room.Avatar,
			Preview:         room.Preview,
			LastSeen:        room.LastSeen.UnixMilli(),
			Direct:          room.Direct,
			Favorite:        room.Favorite,
			Muted:           room.Muted,
			Unread:          room.Unread,
			MarkedUnread:    room.MarkedUnread,
			Mentions:        room.Mentions,
			Unanswered:      room.Unanswered,
			NeedsReply:      room.NeedsReply,
			LastEventID:     room.LastEventID,
			LastEventSender: room.LastEventSender,
			LastEventAt:     room.LastEventAt.UnixMilli(),
			Bridge:          room.Bridge,
		})
	}
	return mapped
}
