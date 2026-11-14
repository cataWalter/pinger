package matrix

import (
	"context"
	"maunium.net/go/mautrix"
	"maunium.net/go/mautrix/id"
	"time"
)

func (syncer slidingSyncSyncer) OnFailedSync(response *mautrix.RespSync, err error) (time.Duration, error) {
	_, syncErr := syncer.inner.OnFailedSync(response, err)
	if syncErr != nil {
		return 0, syncErr
	}
	attempt := syncer.manager.syncFailures.Add(1)
	return reconnectDelay(int(attempt)), nil
}

func (syncer slidingSyncSyncer) GetFilterJSON(userID id.UserID) *mautrix.Filter {
	return syncer.inner.GetFilterJSON(userID)
}

type slidingSyncStore struct {
	inner mautrix.SyncStore
}

func (store slidingSyncStore) SaveFilterID(ctx context.Context, userID id.UserID, filterID string) error {
	return store.inner.SaveFilterID(ctx, userID, filterID)
}

func (store slidingSyncStore) LoadFilterID(ctx context.Context, userID id.UserID) (string, error) {
	return store.inner.LoadFilterID(ctx, userID)
}

func (store slidingSyncStore) SaveNextBatch(ctx context.Context, userID id.UserID, nextBatch string) error {
	return store.inner.SaveNextBatch(ctx, userID, nextBatch)
}

func (store slidingSyncStore) LoadNextBatch(ctx context.Context, userID id.UserID) (string, error) {
	return store.inner.LoadNextBatch(ctx, userID)
}
