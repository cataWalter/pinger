package desktop

import (
	"database/sql"
	"path/filepath"
	"reflect"
	"testing"
	"time"
)

func TestRelationshipHealthStoreCreatesDossierCache(t *testing.T) {
	store, err := openRelationshipHealthStore(filepath.Join(t.TempDir(), "relationship-health.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.close()

	contactID, err := store.ensureContact("!dossier:example.org", "Dossier")
	if err != nil {
		t.Fatal(err)
	}
	columns := make(map[string]bool)
	rows, err := store.db.Query(`PRAGMA table_info(dossier_cache)`)
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var cid, notNull, primaryKey int
		var name, columnType string
		var defaultValue sql.NullString
		if err := rows.Scan(&cid, &name, &columnType, &notNull, &defaultValue, &primaryKey); err != nil {
			_ = rows.Close()
			t.Fatal(err)
		}
		columns[name] = true
	}
	if err := rows.Close(); err != nil {
		t.Fatal(err)
	}
	for _, column := range []string{"contact_id", "key_facts", "last_recap", "unresolved_commitments", "last_analyzed_message_id", "updated_at"} {
		if !columns[column] {
			t.Errorf("dossier_cache is missing column %q", column)
		}
	}
	var linkedContact string
	if err := store.db.QueryRow(`INSERT INTO dossier_cache(contact_id) VALUES (?) RETURNING contact_id`, contactID).Scan(&linkedContact); err != nil {
		t.Fatalf("dossier_cache does not accept an existing contact: %v", err)
	}
	if linkedContact != contactID {
		t.Fatalf("dossier cache contact = %q, want %q", linkedContact, contactID)
	}
	if _, err := store.db.Exec(`DELETE FROM contacts WHERE contact_id = ?`, contactID); err != nil {
		t.Fatal(err)
	}
	var cacheCount int
	if err := store.db.QueryRow(`SELECT COUNT(*) FROM dossier_cache WHERE contact_id = ?`, contactID).Scan(&cacheCount); err != nil {
		t.Fatal(err)
	}
	if cacheCount != 0 {
		t.Fatal("dossier cache row was not removed with its contact")
	}
}

func TestRelationshipHealthStoreRoundTripsDossierCache(t *testing.T) {
	store, err := openRelationshipHealthStore(filepath.Join(t.TempDir(), "relationship-health.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.close()

	contactID, err := store.ensureContact("!dossier:example.org", "Dossier")
	if err != nil {
		t.Fatal(err)
	}
	expected := contactDossierCache{
		ContactID: contactID, KeyFacts: []string{"Location: Berlin"}, LastRecap: "Caught up about the move. Agreed to meet next week.",
		UnresolvedCommitments: []string{"Send the apartment listing"}, LastAnalyzedMessageID: "$latest",
		LastAnalyzedMessageTimestamp: 1_792_600_000_000, UpdatedAt: 1_792_600_000_000,
	}
	if err := store.saveContactDossier(expected); err != nil {
		t.Fatal(err)
	}
	actual, found, err := store.readContactDossier(contactID)
	if err != nil {
		t.Fatal(err)
	}
	if !found {
		t.Fatal("saved dossier cache was not found")
	}
	if !reflect.DeepEqual(actual, expected) {
		t.Fatalf("round-tripped dossier = %+v, want %+v", actual, expected)
	}
}

func TestRelationshipHealthStoreLinksAndUnlinksRooms(t *testing.T) {
	store, err := openRelationshipHealthStore(filepath.Join(t.TempDir(), "relationship-health.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.close()

	firstID, err := store.ensureContact("!first:example.org", "Alice")
	if err != nil {
		t.Fatal(err)
	}
	secondID, err := store.ensureContact("!second:example.org", "Alice on Telegram")
	if err != nil {
		t.Fatal(err)
	}
	if firstID == secondID {
		t.Fatal("unlinked rooms share a contact ID")
	}
	if err := store.saveContactDossier(contactDossierCache{
		ContactID: firstID, KeyFacts: []string{"Programming language: Rust"}, LastRecap: "Earlier recap.",
		UnresolvedCommitments: []string{"Send a code sample"}, LastAnalyzedMessageID: "$first", UpdatedAt: 100,
	}); err != nil {
		t.Fatal(err)
	}
	if err := store.saveContactDossier(contactDossierCache{
		ContactID: secondID, KeyFacts: []string{"Location: Berlin"}, LastRecap: "Later recap.",
		UnresolvedCommitments: []string{"Share the apartment listing"}, LastAnalyzedMessageID: "$second", UpdatedAt: 200,
	}); err != nil {
		t.Fatal(err)
	}
	if err := store.linkRooms("!first:example.org", "!second:example.org"); err != nil {
		t.Fatal(err)
	}
	linkedID, err := store.ensureContact("!first:example.org", "")
	if err != nil {
		t.Fatal(err)
	}
	secondLinkedID, err := store.ensureContact("!second:example.org", "")
	if err != nil {
		t.Fatal(err)
	}
	if linkedID != secondLinkedID {
		t.Fatal("linkRooms did not merge the contacts")
	}
	rooms, err := store.linkedRooms(linkedID)
	if err != nil || len(rooms) != 2 {
		t.Fatalf("linked rooms = %v, error = %v", rooms, err)
	}
	mergedDossier, found, err := store.readContactDossier(linkedID)
	if err != nil || !found {
		t.Fatalf("read merged dossier = %+v, found = %v, error = %v", mergedDossier, found, err)
	}
	if !reflect.DeepEqual(mergedDossier.KeyFacts, []string{"Programming language: Rust", "Location: Berlin"}) {
		t.Fatalf("merged dossier facts = %#v", mergedDossier.KeyFacts)
	}
	if mergedDossier.LastRecap != "Later recap." || mergedDossier.LastAnalyzedMessageID != "$second" {
		t.Fatalf("merged dossier did not keep its newer recap/checkpoint: %+v", mergedDossier)
	}
	if !reflect.DeepEqual(mergedDossier.UnresolvedCommitments, []string{"Send a code sample", "Share the apartment listing"}) {
		t.Fatalf("merged dossier commitments = %#v", mergedDossier.UnresolvedCommitments)
	}

	if err := store.unlinkRoom("!first:example.org", "Alice"); err != nil {
		t.Fatal(err)
	}
	unlinkedID, err := store.ensureContact("!first:example.org", "")
	if err != nil {
		t.Fatal(err)
	}
	remainingID, err := store.ensureContact("!second:example.org", "")
	if err != nil {
		t.Fatal(err)
	}
	if unlinkedID == remainingID {
		t.Fatal("unlinkRoom left the rooms in the same contact")
	}
	for _, contactID := range []string{unlinkedID, remainingID} {
		if _, found, err := store.readContactDossier(contactID); err != nil || found {
			t.Fatalf("split contact %s retained an ambiguous dossier: found = %v, error = %v", contactID, found, err)
		}
	}
}

func TestRelationshipHealthStorePersistsDailyHistory(t *testing.T) {
	store, err := openRelationshipHealthStore(filepath.Join(t.TempDir(), "relationship-health.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.close()

	contactID, err := store.ensureContact("!room:example.org", "Contact")
	if err != nil {
		t.Fatal(err)
	}
	updatedAt := time.Date(2026, 10, 21, 12, 0, 0, 0, time.UTC).UnixMilli()
	row := relationshipHealthRow{
		ContactID:              contactID,
		WindowDate:             "2026-10-21",
		SentimentScore:         -0.45,
		Status:                 "TENSE",
		DetectedFrictionPoints: []string{"short replies after missed deadline"},
		Trend:                  "DETERIORATING",
		Reasoning:              "The last exchange became abrupt.",
		LastAnalyzedRoomID:     "!room:example.org",
		LastAnalyzedMessageID:  "$latest",
		UpdatedAt:              updatedAt,
	}
	if err := store.saveHealth(row); err != nil {
		t.Fatal(err)
	}
	rows, err := store.recentHealth(contactID, 28)
	if err != nil || len(rows) != 1 {
		t.Fatalf("recentHealth() returned %d rows, error = %v", len(rows), err)
	}
	if rows[0].SentimentScore != row.SentimentScore || rows[0].Status != row.Status || rows[0].DetectedFrictionPoints[0] != row.DetectedFrictionPoints[0] {
		t.Fatalf("stored row = %+v", rows[0])
	}
	checkpoint, err := store.checkpoint(contactID)
	if err != nil || checkpoint.MessageID != "$latest" || checkpoint.RoomID != row.LastAnalyzedRoomID {
		t.Fatalf("checkpoint = %+v, error = %v", checkpoint, err)
	}
}

func TestRelationshipHealthStoreEnforcesForeignKeyAndScoreRange(t *testing.T) {
	store, err := openRelationshipHealthStore(filepath.Join(t.TempDir(), "relationship-health.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.close()

	_, err = store.db.Exec(`
		INSERT INTO relationship_health (
			contact_id, window_date, sentiment_score, status, detected_friction_points, trend, updated_at
		) VALUES ('missing-contact', '2026-10-21', 0, 'NEUTRAL', '[]', 'STABLE', 1)
	`)
	if err == nil {
		t.Fatal("relationship_health accepted a row without a contact")
	}

	contactID, err := store.ensureContact("!room:example.org", "Contact")
	if err != nil {
		t.Fatal(err)
	}
	if err := store.saveHealth(relationshipHealthRow{ContactID: contactID, WindowDate: "2026-10-21", SentimentScore: 1.1, Status: "WARM", Trend: "STABLE"}); err == nil {
		t.Fatal("saveHealth accepted a score outside [-1, 1]")
	}
}
