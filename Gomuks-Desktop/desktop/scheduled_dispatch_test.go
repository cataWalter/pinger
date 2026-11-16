package desktop

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestScheduledMessagesDispatchThroughOwningAccount(t *testing.T) {
	store, err := newScheduledJobStore(filepath.Join(t.TempDir(), "scheduled-jobs.json"))
	if err != nil {
		t.Fatal(err)
	}
	dueAt := time.Now().Add(time.Hour).UnixMilli()
	if _, err = store.scheduleMessage(primaryAccountID, "!room:example.org", "primary send", dueAt); err != nil {
		t.Fatal(err)
	}
	if _, err = store.scheduleMessage("account-2", "!room:example.org", "secondary send", dueAt); err != nil {
		t.Fatal(err)
	}
	primarySender := &scheduledSenderProbe{}
	secondarySender := &scheduledSenderProbe{}

	if err = dispatchDueScheduledMessagesForAccount(context.Background(), store, primaryAccountID, primarySender, dueAt); err != nil {
		t.Fatal(err)
	}
	if primarySender.messageCalls != 1 || secondarySender.messageCalls != 0 {
		t.Fatalf("primary dispatch counts = primary:%d secondary:%d", primarySender.messageCalls, secondarySender.messageCalls)
	}
	if err = dispatchDueScheduledMessagesForAccount(context.Background(), store, "account-2", secondarySender, dueAt); err != nil {
		t.Fatal(err)
	}
	if primarySender.messageCalls != 1 || secondarySender.messageCalls != 1 {
		t.Fatalf("account dispatch counts = primary:%d secondary:%d", primarySender.messageCalls, secondarySender.messageCalls)
	}
}

func TestScheduledJobWithoutAccountIDBelongsToPrimaryAccount(t *testing.T) {
	path := filepath.Join(t.TempDir(), "scheduled-jobs.json")
	legacy := `[{"id":"legacy-job","kind":"message","roomId":"!room:example.org","text":"legacy send","dueAt":4102444800000,"createdAt":1,"status":"pending","error":""}]`
	if err := os.WriteFile(path, []byte(legacy), 0o600); err != nil {
		t.Fatal(err)
	}
	store, err := newScheduledJobStore(path)
	if err != nil {
		t.Fatal(err)
	}
	jobs := store.listForAccount(primaryAccountID)
	if len(jobs) != 1 || jobs[0].AccountID != primaryAccountID {
		t.Fatalf("migrated legacy jobs = %+v", jobs)
	}
}

type scheduledSenderProbe struct {
	messageCalls  int
	replyCalls    int
	replyTo       string
	transactionID string
	complete      func() error
}

func (s *scheduledSenderProbe) SendScheduledMessage(_ context.Context, _, _, replyTo, transactionID string, onQueued func(string) error) error {
	s.transactionID = transactionID
	if replyTo != "" {
		s.replyCalls++
		s.replyTo = replyTo
	} else {
		s.messageCalls++
	}
	if transactionID == "" {
		transactionID = "scheduled-txn"
	}
	if onQueued != nil {
		if err := onQueued(transactionID); err != nil {
			return err
		}
	}
	if s.complete != nil {
		return s.complete()
	}
	return nil
}

func TestScheduledMessageWaitsForDeliveryAndPersistsFailedTransaction(t *testing.T) {
	path := filepath.Join(t.TempDir(), "scheduled-jobs.json")
	store, err := newScheduledJobStore(path)
	if err != nil {
		t.Fatal(err)
	}
	dueAt := time.Now().Add(time.Hour).UnixMilli()
	job, err := store.scheduleMessage(primaryAccountID, "!room:example.org", "hello", dueAt)
	if err != nil {
		t.Fatal(err)
	}
	sender := &scheduledSenderProbe{complete: func() error {
		reopened, openErr := newScheduledJobStore(path)
		if openErr != nil {
			t.Fatal(openErr)
		}
		jobs := store.list()
		if len(jobs) != 1 || jobs[0].Status != scheduledSending || jobs[0].TransactionID != "scheduled-txn" {
			t.Fatalf("job completed before delivery: %+v", jobs)
		}
		if restored := reopened.list(); len(restored) != 1 || restored[0].TransactionID != "scheduled-txn" {
			t.Fatalf("delivery transaction not persisted: %+v", restored)
		}
		return context.DeadlineExceeded
	}}
	if err = dispatchDueScheduledMessagesForAccount(context.Background(), store, primaryAccountID, sender, dueAt); err != nil {
		t.Fatal(err)
	}
	jobs := store.list()
	if len(jobs) != 1 || jobs[0].ID != job.ID || jobs[0].Status != scheduledFailed || jobs[0].TransactionID != "scheduled-txn" {
		t.Fatalf("failed delivery not retained for retry: %+v", jobs)
	}
	if err = store.retryMessage(job.ID, dueAt); err != nil {
		t.Fatal(err)
	}
	sender.complete = nil
	if err = dispatchDueScheduledMessagesForAccount(context.Background(), store, primaryAccountID, sender, dueAt); err != nil {
		t.Fatal(err)
	}
	if sender.transactionID != "scheduled-txn" {
		t.Fatalf("retry transaction = %q, want original transaction", sender.transactionID)
	}
}

func TestScheduledCompletionPersistenceRecoversWithoutResending(t *testing.T) {
	for _, test := range []struct {
		name    string
		repeat  bool
		sendErr error
		status  string
	}{
		{name: "delivered", status: scheduledSent},
		{name: "failed", sendErr: context.DeadlineExceeded, status: scheduledFailed},
		{name: "recurring", repeat: true, status: scheduledPending},
	} {
		t.Run(test.name, func(t *testing.T) {
			directory := t.TempDir()
			path := filepath.Join(directory, "scheduled-jobs.json")
			store, err := newScheduledJobStore(path)
			if err != nil {
				t.Fatal(err)
			}
			dueAt := time.Now().Add(time.Hour).UnixMilli()
			job, err := store.create(scheduledMessageKind, primaryAccountID, "!room:example.org", "hello", "", "", dueAt, test.repeat)
			if err != nil {
				t.Fatal(err)
			}
			dueAt = time.Now().Add(-time.Second).UnixMilli()
			store.jobs[0].DueAt = dueAt
			blocker := filepath.Join(directory, "not-a-directory")
			if err = os.WriteFile(blocker, []byte("blocked"), 0o600); err != nil {
				t.Fatal(err)
			}
			sender := &scheduledSenderProbe{complete: func() error {
				store.path = filepath.Join(blocker, "scheduled-jobs.json")
				return test.sendErr
			}}
			if err = dispatchDueScheduledMessagesForAccount(context.Background(), store, primaryAccountID, sender, dueAt); err != nil {
				t.Fatal(err)
			}
			if store.jobs[0].Status != test.status || !store.completionPersistencePending {
				t.Fatalf("completion was lost after save failure: %+v", store.jobs)
			}
			if err = store.flushPendingCompletions(); err == nil {
				t.Fatal("completion flush unexpectedly succeeded while storage was blocked")
			}
			store.path = path
			service := &AppService{ctx: context.Background(), scheduled: store}
			service.processDueScheduledJobs()
			if store.completionPersistencePending {
				t.Fatal("scheduler did not retry completion persistence")
			}
			if err = dispatchDueScheduledMessagesForAccount(context.Background(), store, primaryAccountID, sender, dueAt); err != nil {
				t.Fatal(err)
			}
			if sender.messageCalls != 1 {
				t.Fatalf("completion persistence resent message %d times", sender.messageCalls)
			}
			reopened, err := newScheduledJobStore(path)
			if err != nil {
				t.Fatal(err)
			}
			if len(reopened.jobs) != 1 || reopened.jobs[0].ID != job.ID || reopened.jobs[0].Status != test.status {
				t.Fatalf("recovered completion = %+v", reopened.jobs)
			}
		})
	}
}
