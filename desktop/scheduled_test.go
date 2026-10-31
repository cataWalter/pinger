package desktop

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestScheduledJobStorePersistsAndRecoversInterruptedSend(t *testing.T) {
	path := filepath.Join(t.TempDir(), "data", "scheduled-jobs.json")
	store, err := newScheduledJobStore(path)
	if err != nil {
		t.Fatalf("create scheduled job store: %v", err)
	}

	dueAt := time.Now().Add(time.Hour).UnixMilli()
	job, err := store.scheduleMessage(primaryAccountID, "!room:example.org", "send later", dueAt)
	if err != nil {
		t.Fatalf("schedule message: %v", err)
	}
	fileInfo, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat scheduled jobs file: %v", err)
	}
	if fileInfo.Mode().Perm() != 0o600 {
		t.Fatalf("scheduled jobs permissions = %04o, want 0600", fileInfo.Mode().Perm())
	}

	claimed, err := store.claimDue(scheduledMessageKind, dueAt)
	if err != nil || len(claimed) != 1 || claimed[0].Status != scheduledSending {
		t.Fatalf("claim due message = %+v, %v", claimed, err)
	}

	reopened, err := newScheduledJobStore(path)
	if err != nil {
		t.Fatalf("reopen scheduled job store: %v", err)
	}
	jobs := reopened.list()
	if len(jobs) != 1 || jobs[0].ID != job.ID || jobs[0].Text != "send later" || jobs[0].Status != scheduledFailed {
		t.Fatalf("recovered scheduled jobs = %+v", jobs)
	}
	if !strings.Contains(jobs[0].Error, "Check the room") {
		t.Fatalf("recovered error = %q, want duplicate-send warning", jobs[0].Error)
	}
}

func TestScheduledJobStoreReschedulesCancelsAndFiresReminders(t *testing.T) {
	store, err := newScheduledJobStore(filepath.Join(t.TempDir(), "scheduled-jobs.json"))
	if err != nil {
		t.Fatalf("create scheduled job store: %v", err)
	}

	message, err := store.scheduleMessage(primaryAccountID, "!room:example.org", "change this", time.Now().Add(time.Hour).UnixMilli())
	if err != nil {
		t.Fatal(err)
	}
	newDueAt := time.Now().Add(2 * time.Hour).UnixMilli()
	if err = store.update(message.ID, newDueAt); err != nil {
		t.Fatalf("reschedule message: %v", err)
	}
	if err = store.cancel(message.ID); err != nil {
		t.Fatalf("cancel message: %v", err)
	}
	if jobs := store.list(); len(jobs) != 0 {
		t.Fatalf("cancelled message remained in pending list: %+v", jobs)
	}

	reminder, err := store.scheduleReminder(primaryAccountID, "!room:example.org", "$event", "Follow up", time.Now().Add(time.Hour).UnixMilli())
	if err != nil {
		t.Fatal(err)
	}
	claimed, err := store.claimDue(scheduledReminderKind, reminder.DueAt)
	if err != nil || len(claimed) != 1 || claimed[0].Status != scheduledFired {
		t.Fatalf("claim reminder = %+v, %v", claimed, err)
	}
	if err = store.dismiss(reminder.ID); err != nil {
		t.Fatalf("dismiss reminder: %v", err)
	}
	if jobs := store.list(); len(jobs) != 0 {
		t.Fatalf("dismissed reminder remained in active list: %+v", jobs)
	}
}

func TestScheduledJobStoreKeepsLateSendVisibleUntilDismissed(t *testing.T) {
	store, err := newScheduledJobStore(filepath.Join(t.TempDir(), "scheduled-jobs.json"))
	if err != nil {
		t.Fatalf("create scheduled job store: %v", err)
	}
	dueAt := time.Now().Add(time.Hour).UnixMilli()
	job, err := store.scheduleMessage(primaryAccountID, "!room:example.org", "send later", dueAt)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = store.claimDue(scheduledMessageKind, dueAt); err != nil {
		t.Fatal(err)
	}
	if err = store.finishMessage(job.ID, nil, dueAt+11_000, dueAt+11_000); err != nil {
		t.Fatalf("finish delayed message: %v", err)
	}
	jobs := store.list()
	if len(jobs) != 1 || jobs[0].Status != scheduledSentLate {
		t.Fatalf("late send list = %+v", jobs)
	}
	if err = store.dismiss(job.ID); err != nil {
		t.Fatalf("dismiss delayed send: %v", err)
	}
	if jobs = store.list(); len(jobs) != 0 {
		t.Fatalf("dismissed late send remained in list: %+v", jobs)
	}
}

func TestWeeklyScheduledMessageRepeatsAtSameLocalWeekdayAndTime(t *testing.T) {
	store, err := newScheduledJobStore(filepath.Join(t.TempDir(), "scheduled-jobs.json"))
	if err != nil {
		t.Fatal(err)
	}

	due := time.Now().Add(2 * time.Hour).Truncate(time.Minute)
	job, err := store.scheduleRecurringMessage(primaryAccountID, "!room:example.org", "weekly update", due.UnixMilli())
	if err != nil {
		t.Fatalf("schedule recurring message: %v", err)
	}
	if !job.RepeatWeekly || job.RepeatWeekday != int(due.In(time.Local).Weekday()) ||
		job.RepeatHour != due.In(time.Local).Hour() || job.RepeatMinute != due.In(time.Local).Minute() {
		t.Fatalf("recurrence fields = %+v, want weekly at %s", job, due.In(time.Local).Format("Monday 15:04"))
	}

	claimed, err := store.claimDueForAccount(scheduledMessageKind, job.DueAt, primaryAccountID)
	if err != nil || len(claimed) != 1 || claimed[0].Status != scheduledSending {
		t.Fatalf("claim recurring message = %+v, %v", claimed, err)
	}
	finishedAt := job.DueAt + 5_000
	if err = store.finishMessage(job.ID, nil, job.DueAt, finishedAt); err != nil {
		t.Fatalf("finish recurring message: %v", err)
	}

	jobs := store.listForAccount(primaryAccountID)
	if len(jobs) != 1 {
		t.Fatalf("recurring jobs after send = %+v, want series retained", jobs)
	}
	next := time.UnixMilli(jobs[0].DueAt).In(time.Local)
	if jobs[0].Status != scheduledPending || !jobs[0].RepeatWeekly ||
		next.Weekday() != time.Weekday(job.RepeatWeekday) ||
		next.Hour() != job.RepeatHour || next.Minute() != job.RepeatMinute ||
		!next.After(time.UnixMilli(finishedAt).In(time.Local)) {
		t.Fatalf("next recurring job = %+v (%s), want next future matching weekday and time", jobs[0], next)
	}

	reopened, err := newScheduledJobStore(store.path)
	if err != nil {
		t.Fatalf("reopen recurring job store: %v", err)
	}
	persisted := reopened.list()
	if len(persisted) != 1 || !persisted[0].RepeatWeekly || persisted[0].RepeatWeekday != job.RepeatWeekday ||
		persisted[0].RepeatHour != job.RepeatHour || persisted[0].RepeatMinute != job.RepeatMinute {
		t.Fatalf("persisted recurring job = %+v", persisted)
	}
}

func TestWeeklyScheduledMessageFailurePausesUntilRetryOrCancel(t *testing.T) {
	store, err := newScheduledJobStore(filepath.Join(t.TempDir(), "scheduled-jobs.json"))
	if err != nil {
		t.Fatal(err)
	}
	dueAt := time.Now().Add(time.Hour).UnixMilli()
	job, err := store.scheduleRecurringMessage(primaryAccountID, "!room:example.org", "weekly update", dueAt)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = store.claimDue(scheduledMessageKind, dueAt); err != nil {
		t.Fatal(err)
	}
	if err = store.finishMessage(job.ID, context.DeadlineExceeded, dueAt, dueAt+1_000); err != nil {
		t.Fatal(err)
	}
	failed := store.list()
	if len(failed) != 1 || failed[0].Status != scheduledFailed || !failed[0].RepeatWeekly || failed[0].DueAt != dueAt {
		t.Fatalf("failed recurring job = %+v, want paused series", failed)
	}
	if err = store.cancel(job.ID); err != nil {
		t.Fatalf("cancel failed recurring job: %v", err)
	}
	if jobs := store.list(); len(jobs) != 0 {
		t.Fatalf("cancelled recurring series remained listed: %+v", jobs)
	}
}

func TestScheduledReplyPersistsTargetAndDispatchesAsReply(t *testing.T) {
	path := filepath.Join(t.TempDir(), "scheduled-jobs.json")
	store, err := newScheduledJobStore(path)
	if err != nil {
		t.Fatalf("create scheduled job store: %v", err)
	}
	job, err := store.scheduleReply(primaryAccountID, "!room:example.org", "follow up", "$quoted-event", time.Now().Add(time.Hour).UnixMilli())
	if err != nil {
		t.Fatalf("schedule reply: %v", err)
	}
	reopened, err := newScheduledJobStore(path)
	if err != nil {
		t.Fatalf("reopen scheduled job store: %v", err)
	}
	jobs := reopened.list()
	if len(jobs) != 1 || jobs[0].ReplyToEventID != "$quoted-event" {
		t.Fatalf("persisted reply target = %+v", jobs)
	}

	sender := &scheduledSenderProbe{}
	if err = dispatchScheduledMessage(context.Background(), sender, jobs[0]); err != nil {
		t.Fatalf("dispatch scheduled reply: %v", err)
	}
	if sender.replyCalls != 1 || sender.messageCalls != 0 || sender.replyTo != "$quoted-event" {
		t.Fatalf("reply dispatch = %+v", sender)
	}
	if err = dispatchScheduledMessage(context.Background(), sender, ScheduledJob{RoomID: job.RoomID, Text: "legacy send"}); err != nil {
		t.Fatalf("dispatch legacy scheduled message: %v", err)
	}
	if sender.messageCalls != 1 || sender.replyCalls != 1 {
		t.Fatalf("legacy dispatch = %+v", sender)
	}
}

func TestScheduledJobsAreScopedToTheirAccount(t *testing.T) {
	store, err := newScheduledJobStore(filepath.Join(t.TempDir(), "scheduled-jobs.json"))
	if err != nil {
		t.Fatal(err)
	}
	dueAt := time.Now().Add(time.Hour).UnixMilli()
	primaryJob, err := store.scheduleMessage(primaryAccountID, "!room:example.org", "primary send", dueAt)
	if err != nil {
		t.Fatal(err)
	}
	secondaryJob, err := store.scheduleMessage("account-2", "!room:example.org", "secondary send", dueAt)
	if err != nil {
		t.Fatal(err)
	}

	primaryJobs, err := store.claimDueForAccount(scheduledMessageKind, dueAt, primaryAccountID)
	if err != nil || len(primaryJobs) != 1 || primaryJobs[0].ID != primaryJob.ID {
		t.Fatalf("primary account claimed jobs = %+v, %v", primaryJobs, err)
	}
	secondaryJobs, err := store.claimDueForAccount(scheduledMessageKind, dueAt, "account-2")
	if err != nil || len(secondaryJobs) != 1 || secondaryJobs[0].ID != secondaryJob.ID {
		t.Fatalf("secondary account claimed jobs = %+v, %v", secondaryJobs, err)
	}
	if jobs := store.listForAccount(primaryAccountID); len(jobs) != 1 || jobs[0].ID != primaryJob.ID {
		t.Fatalf("primary account job list = %+v", jobs)
	}
}

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
