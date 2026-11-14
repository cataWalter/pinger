package matrix

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"go.mau.fi/gomuks/pkg/hicli/database"
	"go.mau.fi/gomuks/pkg/hicli/jsoncmd"
	"go.mau.fi/util/jsontime"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"maunium.net/go/mautrix/id"
	"strings"
	"time"
)

func localSearchParams(request SearchRequest) (*jsoncmd.SearchParams, error) {
	query := strings.TrimSpace(request.Query)
	if query == "" {
		return nil, errors.New("message search query is empty")
	}
	limit := request.Limit
	if limit < 1 || limit > 100 {
		limit = 50
	}
	params := &jsoncmd.SearchParams{
		SearchTerm: query,
		Limit:      limit,
		SortByTime: true,
		NextBatch:  request.NextBatch,
	}
	if request.RoomID != "" {
		params.RoomIDs = []id.RoomID{id.RoomID(request.RoomID)}
	}
	if request.Sender != "" {
		params.Senders = []id.UserID{id.UserID(request.Sender)}
	}
	if request.MinTimestamp > 0 {
		params.MinTimestamp = jsontime.UnixMilli{Time: time.UnixMilli(request.MinTimestamp)}
	}
	if request.MaxTimestamp > 0 {
		params.MaxTimestamp = jsontime.UnixMilli{Time: time.UnixMilli(request.MaxTimestamp)}
	}
	return params, nil
}

func (c *Client) SearchMessages(ctx context.Context, request SearchRequest) (SearchPage, error) {
	params, err := localSearchParams(request)
	if err != nil {
		return SearchPage{}, err
	}
	ctx, finish, err := c.beginOperation(ctx)
	if err != nil {
		return SearchPage{}, err
	}
	defer finish()
	response, err := c.engine.SearchLocal(ctx, params)
	if err != nil {
		return SearchPage{}, fmt.Errorf("search local Matrix history: %w", err)
	}
	results := make([]SearchResult, 0, len(response.Events))
	profileMessages := make(map[string][]Message)
	profileResultIndexes := make(map[string][]int)
	for _, eventResult := range response.Events {
		if message, ok := messageFromEvent(eventResult); ok {
			roomID := eventResult.RoomID.String()
			var timelineCursor database.TimelineRowID
			cursorErr := c.engine.DB.Timeline.GetDB().QueryRow(ctx,
				"SELECT rowid FROM timeline WHERE room_id = ? AND event_rowid = ?",
				eventResult.RoomID, eventResult.RowID,
			).Scan(&timelineCursor)
			if cursorErr != nil && !errors.Is(cursorErr, sql.ErrNoRows) {
				return SearchPage{}, fmt.Errorf("find searched message in room timeline: %w", cursorErr)
			}
			message.TimelineCursor = int64(timelineCursor)
			profileMessages[roomID] = append(profileMessages[roomID], message)
			profileResultIndexes[roomID] = append(profileResultIndexes[roomID], len(results))
			results = append(results, SearchResult{RoomID: roomID, Message: message})
		}
	}
	for roomID, messages := range profileMessages {
		c.populateMessageProfiles(ctx, roomID, messages)
		for index, message := range messages {
			results[profileResultIndexes[roomID][index]].Message = message
		}
	}
	return SearchPage{Results: results, NextBatch: response.NextBatch}, nil
}
