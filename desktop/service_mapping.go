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
	var rooms []Room
	if !update.RoomsOmitted {
		rooms = mapRoomsWithPreferences(update.Rooms, preferences)
	}
	newMessages := mapMessageItems(update.NewMessages)
	editedMessages := mapMessageItems(update.EditedMessages)
	var redactedEventIDs []RedactionItem
	if len(update.RedactedEventIDs) > 0 {
		redactedEventIDs = make([]RedactionItem, 0, len(update.RedactedEventIDs))
		for _, item := range update.RedactedEventIDs {
			redactedEventIDs = append(redactedEventIDs, RedactionItem{
				RoomID:     item.RoomID,
				EventID:    item.EventID,
				RedactedBy: item.RedactedBy,
			})
		}
	}
	var reactionDeltas []ReactionDeltaItem
	if len(update.ReactionDeltas) > 0 {
		reactionDeltas = make([]ReactionDeltaItem, 0, len(update.ReactionDeltas))
		for _, item := range update.ReactionDeltas {
			reactionDeltas = append(reactionDeltas, ReactionDeltaItem{
				RoomID:    item.RoomID,
				EventID:   item.EventID,
				Reactions: cloneReactionCounts(item.Reactions),
				Reacted:   cloneReactionFlags(item.Reacted),
			})
		}
	}
	var readReceipts []ReadReceiptItem
	if len(update.ReadReceipts) > 0 {
		readReceipts = make([]ReadReceiptItem, 0, len(update.ReadReceipts))
		for _, item := range update.ReadReceipts {
			readReceipts = append(readReceipts, ReadReceiptItem{
				RoomID:    item.RoomID,
				EventID:   item.EventID,
				UserID:    item.UserID,
				Timestamp: item.Timestamp,
			})
		}
	}
	var typingUpdates []TypingItem
	if len(update.TypingUpdates) > 0 {
		typingUpdates = make([]TypingItem, 0, len(update.TypingUpdates))
		for _, item := range update.TypingUpdates {
			typingUpdates = append(typingUpdates, TypingItem{
				RoomID:  item.RoomID,
				UserIDs: append([]string(nil), item.UserIDs...),
			})
		}
	}
	return Update{
		Rooms:                 rooms,
		RoomsOmitted:          update.RoomsOmitted,
		Invites:               mapInvites(update.Invites),
		SlidingSyncListCounts: update.SlidingSyncListCounts,
		ChangedRoomID:         update.ChangedRoomID,
		TimelineChangedRoomID: update.TimelineChangedRoomID,
		NewMessages:           newMessages,
		EditedMessages:        editedMessages,
		RedactedEventIDs:      redactedEventIDs,
		ReactionDeltas:        reactionDeltas,
		ReadReceipts:          readReceipts,
		TypingUpdates:         typingUpdates,
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
