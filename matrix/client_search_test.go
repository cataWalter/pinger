package matrix

import (
	"path/filepath"
	"testing"

	"go.mau.fi/gomuks/pkg/hicli/database"
	"go.mau.fi/util/dbutil"
)

func searchTestDatabase(t testing.TB) *dbutil.Database {
	t.Helper()
	db, err := dbutil.NewWithDialect(filepath.Join(t.TempDir(), "search.db"), "sqlite3-fk-wal")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if _, err = db.Exec(t.Context(), `CREATE TABLE timeline (
		rowid INTEGER PRIMARY KEY, room_id TEXT NOT NULL, event_rowid INTEGER UNIQUE NOT NULL
	)`); err != nil {
		t.Fatal(err)
	}
	return db
}

func TestSearchTimelineCursorsPreserveRoomAndMissingEvents(t *testing.T) {
	db := searchTestDatabase(t)
	if _, err := db.Exec(t.Context(), `INSERT INTO timeline VALUES (-12, '!first', 3), (15, '!second', 4)`); err != nil {
		t.Fatal(err)
	}
	first := searchEventKey{roomID: "!first", eventRowID: 3}
	second := searchEventKey{roomID: "!second", eventRowID: 4}
	wrongRoom := searchEventKey{roomID: "!first", eventRowID: 4}
	missing := searchEventKey{roomID: "!second", eventRowID: 5}
	cursors, err := searchTimelineCursors(t.Context(), db, []searchEventKey{first, second, wrongRoom, missing})
	if err != nil {
		t.Fatal(err)
	}
	if len(cursors) != 2 || cursors[first] != -12 || cursors[second] != 15 || cursors[wrongRoom] != 0 || cursors[missing] != 0 {
		t.Fatalf("unexpected timeline cursors: %v", cursors)
	}
}

func BenchmarkSearchTimelineCursors(b *testing.B) {
	db := searchTestDatabase(b)
	keys := make([]searchEventKey, 50)
	for index := range keys {
		rowID := database.EventRowID(index + 1)
		keys[index] = searchEventKey{roomID: "!room", eventRowID: rowID}
		if _, err := db.Exec(b.Context(), `INSERT INTO timeline VALUES (?, ?, ?)`, rowID, keys[index].roomID, rowID); err != nil {
			b.Fatal(err)
		}
	}
	b.Run("per result", func(b *testing.B) {
		for b.Loop() {
			for _, key := range keys {
				var cursor database.TimelineRowID
				if err := db.QueryRow(b.Context(), `SELECT rowid FROM timeline WHERE room_id = ? AND event_rowid = ?`, key.roomID, key.eventRowID).Scan(&cursor); err != nil {
					b.Fatal(err)
				}
			}
		}
	})
	b.Run("per page", func(b *testing.B) {
		for b.Loop() {
			if _, err := searchTimelineCursors(b.Context(), db, keys); err != nil {
				b.Fatal(err)
			}
		}
	})
}
