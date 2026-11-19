package desktop

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"time"
)

func nextWeeklyOccurrence(after int64, weekday, hour, minute int) int64 {
	now := time.UnixMilli(after).In(time.Local)
	daysUntil := (weekday - int(now.Weekday()) + 7) % 7
	for week := 0; week < 3; week++ {
		candidate := time.Date(
			now.Year(), now.Month(), now.Day()+daysUntil+week*7,
			hour, minute, 0, 0, time.Local,
		)
		if candidate.Weekday() == time.Weekday(weekday) &&
			candidate.Hour() == hour && candidate.Minute() == minute &&
			candidate.After(now) {
			return candidate.UnixMilli()
		}
	}
	return now.AddDate(0, 0, 7).UnixMilli()
}

func (s *scheduledJobStore) update(id string, dueAt int64) error {
	if dueAt <= time.Now().UnixMilli() {
		return errors.New("scheduled time must be in the future")
	}
	return s.updateJob(id, func(job *ScheduledJob) error {
		if job.Status != scheduledPending && job.Status != scheduledFailed {
			return errors.New("only pending or failed jobs can be rescheduled")
		}
		job.DueAt = dueAt
		if job.RepeatWeekly {
			scheduleAt := time.UnixMilli(dueAt).In(time.Local)
			job.RepeatWeekday = int(scheduleAt.Weekday())
			job.RepeatHour = scheduleAt.Hour()
			job.RepeatMinute = scheduleAt.Minute()
		}
		job.Status = scheduledPending
		job.Error = ""
		return nil
	})
}

func (s *scheduledJobStore) cancel(id string) error {
	return s.updateJob(id, func(job *ScheduledJob) error {
		if job.Status != scheduledPending && job.Status != scheduledFailed {
			return errors.New("only pending or failed jobs can be cancelled")
		}
		job.Status = scheduledCancelled
		job.Error = ""
		return nil
	})
}

func (s *scheduledJobStore) retryMessage(id string, now int64) error {
	return s.updateJob(id, func(job *ScheduledJob) error {
		if job.Kind != scheduledMessageKind || job.Status != scheduledFailed {
			return errors.New("only failed scheduled messages can be retried")
		}
		job.DueAt = now
		job.Status = scheduledPending
		job.Error = ""
		return nil
	})
}

func (s *scheduledJobStore) dismiss(id string) error {
	return s.updateJob(id, func(job *ScheduledJob) error {
		if job.Status == scheduledFired && job.Kind == scheduledReminderKind {
			job.Status = scheduledDismissed
			return nil
		}
		if job.Status == scheduledSentLate && job.Kind == scheduledMessageKind {
			job.Status = scheduledDismissed
			return nil
		}
		return errors.New("only fired reminders or delayed sends can be dismissed")
	})
}

func (s *scheduledJobStore) updateJob(id string, update func(*ScheduledJob) error) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for index := range s.jobs {
		job := &s.jobs[index]
		if job.ID != id {
			continue
		}
		previous := *job
		if err := update(job); err != nil {
			return err
		}
		if err := s.saveLocked(); err != nil {
			*job = previous
			return err
		}
		return nil
	}
	return errors.New("scheduled job not found")
}

func (s *scheduledJobStore) keepOnlyAccount(accountID string) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	kept := make([]ScheduledJob, 0, len(s.jobs))
	for _, job := range s.jobs {
		owner := job.AccountID
		if owner == "" {
			owner = primaryAccountID
		}
		if owner == accountID {
			kept = append(kept, job)
		}
	}
	removed := len(s.jobs) - len(kept)
	if removed == 0 {
		return 0, nil
	}
	previous := s.jobs
	s.jobs = kept
	if err := s.saveLocked(); err != nil {
		s.jobs = previous
		return 0, err
	}
	return removed, nil
}

func (s *scheduledJobStore) saveLocked() error {
	contents, err := json.Marshal(s.jobs)
	if err != nil {
		return fmt.Errorf("encode scheduled jobs: %w", err)
	}
	directory := filepath.Dir(s.path)
	if err = os.MkdirAll(directory, 0o700); err != nil {
		return fmt.Errorf("create scheduled jobs directory: %w", err)
	}
	if runtime.GOOS != "windows" {
		if err = os.Chmod(directory, 0o700); err != nil {
			return fmt.Errorf("secure scheduled jobs directory: %w", err)
		}
	}
	temporary, err := os.CreateTemp(directory, ".gomuks-scheduled-*")
	if err != nil {
		return fmt.Errorf("create temporary scheduled jobs file: %w", err)
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err = temporary.Chmod(0o600); err == nil {
		var written int
		written, err = temporary.Write(append(contents, '\n'))
		if err == nil && written != len(contents)+1 {
			err = errors.New("short write")
		}
	}
	if err == nil {
		err = temporary.Sync()
	}
	if closeErr := temporary.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		return fmt.Errorf("write scheduled jobs: %w", err)
	}
	if err = os.Rename(temporaryPath, s.path); err != nil {
		return fmt.Errorf("replace scheduled jobs file: %w", err)
	}
	if runtime.GOOS == "windows" {
		return nil
	}
	directoryFile, err := os.Open(directory)
	if err != nil {
		return fmt.Errorf("open scheduled jobs directory: %w", err)
	}
	if err = directoryFile.Sync(); err != nil {
		_ = directoryFile.Close()
		return fmt.Errorf("sync scheduled jobs directory: %w", err)
	}
	if err = directoryFile.Close(); err != nil {
		return fmt.Errorf("close scheduled jobs directory: %w", err)
	}
	return nil
}
