package matrix

import (
	"context"
	"errors"
	"fmt"
	"go.mau.fi/gomuks/pkg/hicli/database"
	"go.mau.fi/gomuks/pkg/hicli/jsoncmd"
	"go.mau.fi/util/dbutil"
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
	keys := make([]searchEventKey, 0, len(response.Events))
	for _, eventResult := range response.Events {
		keys = append(keys, searchEventKey{roomID: eventResult.RoomID, eventRowID: eventResult.RowID})
	}
	cursors, err := searchTimelineCursors(ctx, c.engine.DB.Timeline.GetDB(), keys)
	if err != nil {
		return SearchPage{}, fmt.Errorf("find searched messages in room timelines: %w", err)
	}
	results := make([]SearchResult, 0, len(response.Events))
	profileMessages := make(map[string][]Message)
	profileResultIndexes := make(map[string][]int)
	for _, eventResult := range response.Events {
		if message, ok := messageFromEvent(eventResult); ok {
			roomID := eventResult.RoomID.String()
			message.TimelineCursor = int64(cursors[searchEventKey{roomID: eventResult.RoomID, eventRowID: eventResult.RowID}])
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

type searchEventKey struct {
	roomID     id.RoomID
	eventRowID database.EventRowID
}

func searchTimelineCursors(ctx context.Context, db *dbutil.Database, keys []searchEventKey) (map[searchEventKey]database.TimelineRowID, error) {
	if len(keys) == 0 {
		return nil, nil
	}
	args := make([]any, 0, len(keys)*2)
	for _, key := range keys {
		args = append(args, key.roomID, key.eventRowID)
	}
	values := strings.Repeat("(?, ?),", len(keys)-1) + "(?, ?)"
	rows, err := db.Query(ctx, `WITH matches(room_id, event_rowid) AS (VALUES `+values+`)
		SELECT timeline.room_id, timeline.event_rowid, timeline.rowid
		FROM matches JOIN timeline USING (room_id, event_rowid)`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	cursors := make(map[searchEventKey]database.TimelineRowID, len(keys))
	for rows.Next() {
		var key searchEventKey
		var cursor database.TimelineRowID
		if err = rows.Scan(&key.roomID, &key.eventRowID, &cursor); err != nil {
			return nil, err
		}
		cursors[key] = cursor
	}
	return cursors, rows.Err()
}
