package desktop

import (
	"context"
	"errors"
	"fmt"
	"mychat/matrix"
	"time"
)

func (s *AppService) SearchMessages(request MessageSearchRequest) (MessageSearchPage, error) {
	client, err := s.requireClient()
	if err != nil {
		return MessageSearchPage{}, err
	}
	page, err := client.SearchMessages(s.ctx, matrix.SearchRequest{
		Query:        request.Query,
		RoomID:       request.RoomID,
		Sender:       request.Sender,
		MinTimestamp: request.MinTimestamp,
		MaxTimestamp: request.MaxTimestamp,
		Limit:        request.Limit,
		NextBatch:    request.NextBatch,
	})
	if err != nil {
		return MessageSearchPage{}, err
	}
	results := make([]MessageSearchResult, 0, len(page.Results))
	for _, result := range page.Results {
		mapped := mapMessages([]matrix.Message{result.Message})
		if len(mapped) > 0 {
			results = append(results, MessageSearchResult{RoomID: result.RoomID, Message: mapped[0]})
		}
	}
	return MessageSearchPage{Results: results, NextBatch: page.NextBatch}, nil
}

func (s *AppService) ScheduleMessage(roomID, text string, dueAt int64) (ScheduledJob, error) {
	if err := s.validateScheduledRoom(roomID); err != nil {
		return ScheduledJob{}, err
	}
	return s.scheduled.scheduleMessage(s.currentAccountID(), roomID, text, dueAt)
}

func (s *AppService) ScheduleReply(roomID, text, replyToEventID string, dueAt int64) (ScheduledJob, error) {
	if err := s.validateScheduledRoom(roomID); err != nil {
		return ScheduledJob{}, err
	}
	return s.scheduled.scheduleReply(s.currentAccountID(), roomID, text, replyToEventID, dueAt)
}

func (s *AppService) ScheduleReminder(roomID, eventID, text string, dueAt int64) (ScheduledJob, error) {
	if err := s.validateScheduledRoom(roomID); err != nil {
		return ScheduledJob{}, err
	}
	return s.scheduled.scheduleReminder(s.currentAccountID(), roomID, eventID, text, dueAt)
}

func (s *AppService) ScheduledJobs() []ScheduledJob {
	if s.scheduled == nil {
		return []ScheduledJob{}
	}
	return s.scheduled.listForAccount(s.currentAccountID())
}

func (s *AppService) UpdateScheduledJob(id string, dueAt int64) error {
	if s.scheduled == nil {
		return errors.New("scheduled jobs are unavailable")
	}
	return s.scheduled.update(id, dueAt)
}

func (s *AppService) CancelScheduledJob(id string) error {
	if s.scheduled == nil {
		return errors.New("scheduled jobs are unavailable")
	}
	return s.scheduled.cancel(id)
}

func (s *AppService) RetryScheduledMessage(id string) error {
	if s.scheduled == nil {
		return errors.New("scheduled jobs are unavailable")
	}
	return s.scheduled.retryMessage(id, time.Now().UnixMilli())
}

func (s *AppService) DismissScheduledJob(id string) error {
	if s.scheduled == nil {
		return errors.New("scheduled jobs are unavailable")
	}
	return s.scheduled.dismiss(id)
}

func (s *AppService) validateScheduledRoom(roomID string) error {
	if s.scheduled == nil {
		return errors.New("scheduled jobs are unavailable")
	}
	if roomID == "" {
		return errors.New("select a room first")
	}
	client, err := s.requireClient()
	if err != nil {
		return err
	}
	for _, room := range client.Rooms() {
		if room.ID == roomID {
			return nil
		}
	}
	return errors.New("scheduled job room was not found")
}

func (s *AppService) RoomMembers(roomID string) ([]Member, error) {
	client, err := s.requireClient()
	if err != nil {
		return nil, err
	}
	members, err := client.RoomMembers(s.ctx, roomID)
	if err != nil {
		return nil, err
	}
	mapped := make([]Member, 0, len(members))
	for _, member := range members {
		mapped = append(mapped, Member{ID: member.ID, DisplayName: member.DisplayName})
	}
	return mapped, nil
}

func (s *AppService) LeaveRoom(roomID string) error {
	client, err := s.requireClient()
	if err != nil {
		return err
	}
	return client.LeaveRoom(s.ctx, roomID)
}

func (s *AppService) StartDirectChat(userID string) (string, error) {
	client := s.currentClient()
	if client == nil {
		return "", errors.New("no Matrix account is active")
	}
	return client.StartDirectChat(s.ctx, userID)
}

var errNoActiveAccount = errors.New("no Matrix account is active")

func (s *AppService) AcceptInvite(roomID string) (string, error) {
	client := s.currentClient()
	if client == nil {
		return "", errNoActiveAccount
	}
	return client.AcceptInvite(s.ctx, roomID)
}

func (s *AppService) DeclineInvite(roomID string) error {
	client := s.currentClient()
	if client == nil {
		return errNoActiveAccount
	}
	return client.DeclineInvite(s.ctx, roomID)
}

func (s *AppService) InviteToRoom(roomID string, userIDs []string) error {
	client := s.currentClient()
	if client == nil {
		return errNoActiveAccount
	}
	return client.InviteUsers(s.ctx, roomID, userIDs)
}

// URLPreview returns the homeserver's preview of an http(s) link, or nil when there is none.
func (s *AppService) URLPreview(link string) (*LinkPreview, error) {
	client := s.currentClient()
	if client == nil {
		return nil, errNoActiveAccount
	}
	preview, err := client.URLPreview(s.ctx, link)
	if err != nil || preview == nil {
		return nil, err
	}
	return &LinkPreview{
		URL:         preview.URL,
		Title:       preview.Title,
		Description: preview.Description,
		SiteName:    preview.SiteName,
		Image:       preview.Image,
		ImageWidth:  preview.ImageWidth,
		ImageHeight: preview.ImageHeight,
	}, nil
}

func (s *AppService) Devices() ([]Device, error) {
	client, err := s.requireClient()
	if err != nil {
		return nil, err
	}
	devices, err := client.Devices(s.ctx)
	if err != nil {
		return nil, err
	}
	mapped := make([]Device, 0, len(devices))
	for _, device := range devices {
		lastSeenAt := int64(0)
		if !device.LastSeenAt.IsZero() {
			lastSeenAt = device.LastSeenAt.UnixMilli()
		}
		mapped = append(mapped, Device{
			ID:          device.ID,
			DisplayName: device.DisplayName,
			LastSeenIP:  device.LastSeenIP,
			LastSeenAt:  lastSeenAt,
			Current:     device.Current,
		})
	}
	return mapped, nil
}

func (s *AppService) RevokeDevice(deviceID, password string) error {
	client, err := s.requireClient()
	if err != nil {
		return err
	}
	return client.RevokeDevice(s.ctx, deviceID, password)
}

func (s *AppService) sendAttachment(ctx context.Context, roomID, filename string, data []byte, voiceNote, videoMessage bool, durationMilliseconds int64) error {
	if int64(len(data)) > maxAttachmentSize {
		return fmt.Errorf("attachment exceeds the 50 MiB limit")
	}
	client := s.currentClient()
	if client == nil {
		return errors.New("Matrix account unavailable")
	}
	if voiceNote && videoMessage {
		return errors.New("attachment cannot be both a voice note and a video message")
	}
	if voiceNote {
		return client.SendVoiceNote(ctx, roomID, filename, data, durationMilliseconds)
	}
	if videoMessage {
		return client.SendVideoMessage(ctx, roomID, filename, data, durationMilliseconds)
	}
	return client.SendAttachment(ctx, roomID, filename, data)
}
