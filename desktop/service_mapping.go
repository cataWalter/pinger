package desktop

import (
	"mychat/matrix"
	sharedpreferences "mychat/preferences"
)

func mapInvites(invites []matrix.Invite) []Invite {
	mapped := make([]Invite, 0, len(invites))
	for _, invite := range invites {
		invitedAt := int64(0)
		if !invite.InvitedAt.IsZero() {
			invitedAt = invite.InvitedAt.UnixMilli()
		}
		mapped = append(mapped, Invite{
			RoomID:      invite.RoomID,
			Name:        invite.Name,
			Topic:       invite.Topic,
			Avatar:      invite.Avatar,
			Inviter:     invite.Inviter,
			InviterName: invite.InviterName,
			Direct:      invite.Direct,
			InvitedAt:   invitedAt,
		})
	}
	return mapped
}

// tagRooms sets the owning account on each room in place.
func tagRooms(rooms []Room, accountID string) {
	for i := range rooms {
		rooms[i].AccountID = accountID
	}
}

func tagNotifications(notifications []Notification, accountID string) {
	for i := range notifications {
		notifications[i].AccountID = accountID
	}
}

func mapRoomsWithPreferences(rooms []matrix.Room, preferences map[string]any) []Room {
	mapped := mapRooms(rooms)
	for i := range mapped {
		mapped[i].Favorite, _ = preferences["room.favorite."+mapped[i].ID].(bool)
		mapped[i].Muted, _ = preferences["room.muted."+mapped[i].ID].(bool)
	}
	return mapped
}

func mapMessages(messages []matrix.Message) []Message {
	mapped := make([]Message, 0, len(messages))
	for _, message := range messages {
		seenAt := int64(0)
		if !message.SeenAt.IsZero() {
			seenAt = message.SeenAt.UnixMilli()
		}
		mapped = append(mapped, Message{
			ID:              message.ID,
			TransactionID:   message.TransactionID,
			Sender:          message.Sender,
			SenderName:      message.SenderName,
			Avatar:          message.Avatar,
			Body:            message.Body,
			FormattedBody:   message.FormattedBody,
			ReplyToEventID:  message.ReplyToEventID,
			ReplyToSender:   message.ReplyToSender,
			ReplyToPreview:  message.ReplyToPreview,
			ThreadRootID:    message.ThreadRootID,
			Timestamp:       message.Timestamp.UnixMilli(),
			SeenAt:          seenAt,
			TimelineCursor:  message.TimelineCursor,
			Sending:         message.Sending,
			SendError:       message.SendError,
			Own:             message.Own,
			Reactions:       message.Reactions,
			Reacted:         message.Reacted,
			MediaURI:        message.MediaURI,
			MediaType:       message.MediaType,
			MediaMIME:       message.MediaMIME,
			MediaSize:       message.MediaSize,
			MediaWidth:      message.MediaWidth,
			MediaHeight:     message.MediaHeight,
			MediaDurationMs: message.MediaDurationMs,
			Encrypted:       message.Encrypted,
			DecryptionError: message.DecryptionError,
			Edited:          message.Edited,
			EditHistory:     message.EditHistory,
			Redacted:        message.Redacted,
		})
	}
	return mapped
}

func mapUpdate(update matrix.Update, preferences map[string]any) Update {
	notifications := make([]Notification, 0, len(update.Notifications))
	for _, notification := range update.Notifications {
		if !sharedpreferences.NotificationAllowed(preferences, notification.RoomID, notification.Category) {
			continue
		}
		notifications = append(notifications, Notification{
			RoomID:       notification.RoomID,
			Room:         notification.Room,
			Sender:       notification.Sender,
			SenderAvatar: notification.SenderAvatar,
			Body:         notification.Body,
			Mention:      notification.Mention,
			Category:     notification.Category,
		})
	}
	return Update{
		Rooms:                 mapRoomsWithPreferences(update.Rooms, preferences),
		Invites:               mapInvites(update.Invites),
		SlidingSyncListCounts: update.SlidingSyncListCounts,
		ChangedRoomID:         update.ChangedRoomID,
		TimelineChangedRoomID: update.TimelineChangedRoomID,
		TypingUsers:           update.TypingUsers,
		Notifications:         notifications,
		NewIncomingMessage:    update.NewIncomingMessage,
		Error:                 update.Error,
		InitialSyncComplete:   update.InitialSyncComplete,
		NeedsVerification:     update.NeedsVerification,
		Verification:          mapVerification(update.Verification),
		ConnectionState:       string(update.ConnectionState),
	}
}
