package matrix

import (
	"context"
	"errors"
	"fmt"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"mychat/logging"
	"time"
)

// reconnectDelay returns the exponential backoff delay for a 1-based attempt
// number, capped at reconnectMaxDelay. It doubles the initial delay on every
// attempt: 1s, 2s, 4s, … 30s.
func reconnectDelay(attempt int) time.Duration {
	if attempt < 1 {
		attempt = 1
	}
	delay := reconnectInitialDelay << (attempt - 1)
	if delay <= 0 || delay > reconnectMaxDelay {
		return reconnectMaxDelay
	}
	return delay
}

func (c *Client) Events() <-chan Update {
	return c.events
}

func (c *Client) WaitForCache(ctx context.Context) error {
	if c.cacheReady == nil {
		return nil
	}
	select {
	case <-c.cacheReady:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	case <-c.done:
		return errors.New("Matrix client is closed")
	}
}

func (c *Client) SyncReady() bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.syncReady
}

func (c *Client) ConnectionState() ConnectionState {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.connectionState
}

func (c *Client) Start(ctx context.Context) error {
	ctx, finish, err := c.beginOperation(ctx)
	if err != nil {
		return err
	}
	defer finish()
	if err = c.WaitForCache(ctx); err != nil {
		return err
	}
	return c.startEngine(ctx)
}

// StartWithRetry starts sync and retries transient failures with exponential
// backoff, publishing Offline state between attempts. It returns nil once
// sync has started or when ctx is cancelled.
func (c *Client) StartWithRetry(ctx context.Context) error {
	logger := logging.For("matrix-sync")
	for attempt := 1; ; attempt++ {
		startedAt := time.Now()
		if err := c.Start(ctx); err == nil {
			logger.Debug().Int("attempt", attempt).Dur("duration_ms", time.Since(startedAt)).Msg("sync started")
			return nil
		} else if ctxErr := ctx.Err(); ctxErr != nil {
			return ctxErr
		} else if attempt > 8 {
			return fmt.Errorf("start Matrix sync after %d attempts: %w", attempt-1, err)
		}
		delay := reconnectDelay(attempt)
		logger.Debug().Int("attempt", attempt).Dur("duration_ms", time.Since(startedAt)).Dur("retry_delay_ms", delay).Msg("sync startup retry")
		timer := time.NewTimer(delay)
		select {
		case <-ctx.Done():
			timer.Stop()
			return ctx.Err()
		case <-c.done:
			timer.Stop()
			return errors.New("Matrix client is closed")
		case <-timer.C:
		}
	}
}

// LastReconnectDelay exposes the backoff delay for tests/UI diagnostics.
func LastReconnectDelay(attempt int) time.Duration { return reconnectDelay(attempt) }

func (c *Client) startEngine(ctx context.Context) error {
	c.startMu.Lock()
	defer c.startMu.Unlock()
	if c.started {
		return nil
	}
	c.mu.Lock()
	c.connectionState = StateConnecting
	c.mu.Unlock()
	if err := c.attachSlidingSync(); err != nil {
		c.engine.Client.Log.Error().Err(err).Msg("Failed to configure Matrix Sliding Sync")
		c.mu.Lock()
		c.connectionState = StateOffline
		c.mu.Unlock()
		return fmt.Errorf("configure Sliding Sync: %w", err)
	}
	if err := c.attachVerification(); err != nil {
		c.engine.Client.Log.Warn().Err(err).Msg("Emoji session verification is unavailable")
	}
	// Start initializes the gomuks client and launches its Matrix sync loop.
	if err := c.engine.Start(ctx); err != nil {
		c.engine.Client.Log.Error().Err(err).Msg("Failed to start Matrix sync engine")
		c.mu.Lock()
		c.connectionState = StateOffline
		c.mu.Unlock()
		return err
	}
	c.started = true
	c.publish(nil, "")
	return nil
}

func (c *Client) Close() {
	c.closeOnce.Do(func() {
		c.lifecycleMu.Lock()
		c.closed = true
		c.lifecycleCancel()
		close(c.done)
		c.lifecycleMu.Unlock()
		c.operations.Wait()
		c.engine.Stop()
	})
}

func (c *Client) beginOperation(parent context.Context) (context.Context, func(), error) {
	c.lifecycleMu.Lock()
	defer c.lifecycleMu.Unlock()
	if c.closed {
		return nil, nil, errors.New("Matrix client is closed")
	}
	c.operations.Add(1)
	ctx, cancel := context.WithCancel(parent)
	stop := context.AfterFunc(c.lifecycleCtx, cancel)
	return ctx, func() {
		stop()
		cancel()
		c.operations.Done()
	}, nil
}
