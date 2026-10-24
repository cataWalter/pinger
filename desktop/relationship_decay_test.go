package desktop

import (
	"testing"
	"time"
)

func TestRelationshipDecayThresholds(t *testing.T) {
	for _, test := range []struct {
		tier      string
		threshold time.Duration
		eligible  bool
	}{
		{tier: "VIP", threshold: 7 * 24 * time.Hour, eligible: true},
		{tier: "CLOSE_FRIEND", threshold: 14 * 24 * time.Hour, eligible: true},
		{tier: "CASUAL", threshold: 30 * 24 * time.Hour, eligible: true},
		{tier: "CLIENT", threshold: 10 * 24 * time.Hour, eligible: true},
		{tier: "NONE", eligible: false},
		{tier: "unknown", eligible: false},
	} {
		threshold, eligible := relationshipDecayThreshold(test.tier)
		if threshold != test.threshold || eligible != test.eligible {
			t.Errorf("relationshipDecayThreshold(%q) = %v, %v; want %v, %v", test.tier, threshold, eligible, test.threshold, test.eligible)
		}
	}
}

func TestRelationshipDecayAlertCooldownAndSnooze(t *testing.T) {
	now := time.Date(2026, 10, 21, 12, 0, 0, 0, time.UTC)
	contact := RelationshipDecayContact{
		LastDecayAlertTimestamp: now.Add(-6 * 24 * time.Hour).UnixMilli(),
	}
	if !relationshipDecayAlertActive(contact, now) {
		t.Fatal("recent unsnoozed alert should be active")
	}
	contact.LastDecayAlertTimestamp = now.Add(-relationshipDecayCooldown).UnixMilli()
	if relationshipDecayAlertActive(contact, now) {
		t.Fatal("alert at the cooldown boundary should not be active")
	}
	contact.LastDecayAlertTimestamp = now.UnixMilli()
	contact.SnoozedUntil = now.Add(time.Hour).UnixMilli()
	if relationshipDecayAlertActive(contact, now) {
		t.Fatal("snoozed alert should not be active")
	}
}
