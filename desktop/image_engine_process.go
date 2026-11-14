package desktop

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"
)

// stopLocked kills the process and clears its state. The caller must hold the mutex.
func (e *imageEngine) stopLocked() {
	e.stopIdleLocked()
	if e.cmd != nil {
		_ = killImageEngineTree(e.cmd.Process.Pid)
	}
	removeImageEngineRecord(e.stateFile)
	e.cmd = nil
	e.baseURL = ""
	e.exited = nil
	e.logs = nil
	e.epoch++
}

// killRun stops the process started as epoch, when it is still the current one.
func (e *imageEngine) killRun(epoch uint64) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.epoch == epoch {
		e.stopLocked()
	}
}

// stop kills the engine process if it is running. The app calls it at shutdown.
func (e *imageEngine) stop() {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.stopLocked()
}

// running reports whether the engine process is alive.
func (e *imageEngine) running() bool {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.isRunningLocked()
}

// processID returns the PID of the engine process, or zero when none is running.
func (e *imageEngine) processID() int {
	e.mu.Lock()
	defer e.mu.Unlock()
	if !e.isRunningLocked() {
		return 0
	}
	return e.cmd.Process.Pid
}

// sampleParams returns the sampler settings for one job, or nil when every sampler setting is left to the engine.
func (s imageSettings) sampleParams() *imageSampleParams {
	if s.Steps == 0 && s.CFGScale == 0 && s.SampleMethod == "" {
		return nil
	}
	params := &imageSampleParams{SampleMethod: s.SampleMethod, SampleSteps: s.Steps}
	if s.CFGScale > 0 {
		params.Guidance = &imageGuidance{TxtCFG: s.CFGScale}
	}
	return params
}

// validateImageSettings checks that the configured binary and model exist before a process is started.
func validateImageSettings(settings imageSettings) error {
	if settings.BinaryPath == "" || settings.ModelPath == "" {
		return errImageEngineNotConfigured
	}
	if _, err := os.Stat(settings.BinaryPath); err != nil {
		return fmt.Errorf("image engine binary: %w", err)
	}
	if _, err := os.Stat(settings.ModelPath); err != nil {
		return fmt.Errorf("image model: %w", err)
	}
	if settings.Width <= 0 || settings.Height <= 0 {
		return errors.New("image size must be positive")
	}
	return nil
}

// waitForImageEngine polls the model status until the engine reports ready. It fails when the model errors, the process exits, or startup takes too long.
func waitForImageEngine(ctx context.Context, run imageEngineRun) error {
	timeout := time.NewTimer(imageEngineStartTimeout)
	defer timeout.Stop()
	ticker := time.NewTicker(imageEngineStartPoll)
	defer ticker.Stop()
	for {
		var status imageEngineModelStatus
		// Transient errors and 503 while the model loads are expected, so they only mean "try again".
		if _, err := imageEngineDo(ctx, http.MethodGet, run.baseURL+"/sdcpp/v1/models/status", nil, &status); err == nil {
			switch status.State {
			case "ready":
				return nil
			case "error":
				return run.failure("image model failed to load")
			}
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-run.exited:
			return run.failure("image engine stopped during startup")
		case <-timeout.C:
			return run.failure("image engine did not load the model in time")
		case <-ticker.C:
		}
	}
}

// submitImageJob queues a generation and returns the job ID.
func submitImageJob(ctx context.Context, baseURL string, request imageGenerationRequest) (string, error) {
	body, err := json.Marshal(request)
	if err != nil {
		return "", fmt.Errorf("encode image request: %w", err)
	}
	var accepted struct {
		ID string `json:"id"`
	}
	if _, err := imageEngineDo(ctx, http.MethodPost, baseURL+"/sdcpp/v1/img_gen", bytes.NewReader(body), &accepted); err != nil {
		return "", fmt.Errorf("submit image job: %w", err)
	}
	if accepted.ID == "" {
		return "", errors.New("image engine accepted a job without an id")
	}
	return accepted.ID, nil
}

// waitForImageJob polls jobID until it completes, fails, or is cancelled, and returns the base64 PNG.
// Progress is reported when the step changes. When ctx ends first, the job is cancelled on the engine.
func waitForImageJob(ctx context.Context, run imageEngineRun, jobID string, report func(imageEngineProgress)) (string, error) {
	jobURL := run.baseURL + "/sdcpp/v1/jobs/" + url.PathEscape(jobID)
	ticker := time.NewTicker(imageEngineJobPoll)
	defer ticker.Stop()
	lastStep := -1
	for {
		if ctxErr := ctx.Err(); ctxErr != nil {
			return "", cancelImageJob(run, jobURL, ctxErr)
		}
		var job imageEngineJob
		if _, err := imageEngineDo(ctx, http.MethodGet, jobURL, nil, &job); err != nil {
			if ctxErr := ctx.Err(); ctxErr != nil {
				return "", cancelImageJob(run, jobURL, ctxErr)
			}
			return "", fmt.Errorf("poll image job: %w", err)
		}
		switch job.Status {
		case "completed":
			if job.Result == nil || len(job.Result.Images) == 0 || job.Result.Images[0].B64JSON == "" {
				return "", errors.New("image engine finished without an image")
			}
			return job.Result.Images[0].B64JSON, nil
		case "failed":
			return "", imageJobError(job)
		case "cancelled":
			return "", context.Canceled
		case "generating":
			update := imageEngineProgress{Stage: "generating"}
			if job.Preview != nil {
				update.Step = job.Preview.Step
				update.TotalSteps = job.Preview.TotalSteps
				update.Preview = job.Preview.B64JSON
			}
			if update.Step != lastStep {
				lastStep = update.Step
				report(update)
			}
		}
		select {
		case <-ctx.Done():
		case <-run.exited:
			return "", run.failure("image engine stopped while generating")
		case <-ticker.C:
		}
	}
}

// cancelImageJob asks the engine to stop the job and waits briefly for a terminal state.
// sd-server cancels between sampling steps, so the job can stay generating for a moment. The reason is returned either way.
func cancelImageJob(run imageEngineRun, jobURL string, reason error) error {
	ctx, cancel := context.WithTimeout(context.Background(), imageEngineCancelTimeout)
	defer cancel()
	_, _ = imageEngineDo(ctx, http.MethodPost, jobURL+"/cancel", nil, nil)
	ticker := time.NewTicker(imageEngineJobPoll)
	defer ticker.Stop()
	for {
		var job imageEngineJob
		if _, err := imageEngineDo(ctx, http.MethodGet, jobURL, nil, &job); err == nil {
			switch job.Status {
			case "cancelled", "completed", "failed":
				return reason
			}
		}
		select {
		case <-ctx.Done():
			return reason
		case <-run.exited:
			return reason
		case <-ticker.C:
		}
	}
}

// imageJobError turns a failed job into an error that names the engine's message.
func imageJobError(job imageEngineJob) error {
	if job.Error != nil && job.Error.Message != "" {
		return fmt.Errorf("image generation failed: %s", job.Error.Message)
	}
	return errors.New("image generation failed")
}

// imageEngineDo sends one request to the local engine. A non-2xx status is an error. When out is set, a JSON reply is decoded into it.
func imageEngineDo(ctx context.Context, method, target string, body io.Reader, out any) (int, error) {
	request, err := http.NewRequestWithContext(ctx, method, target, body)
	if err != nil {
		return 0, err
	}
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	response, err := aiLocalHTTPClient.Do(request)
	if err != nil {
		return 0, err
	}
	defer func() { _ = response.Body.Close() }()
	raw, err := io.ReadAll(io.LimitReader(response.Body, imageEngineResponseBytes))
	if err != nil {
		return response.StatusCode, fmt.Errorf("read image engine reply: %w", err)
	}
	if response.StatusCode < 200 || response.StatusCode > 299 {
		detail := strings.TrimSpace(string(raw[:min(len(raw), 200)]))
		return response.StatusCode, fmt.Errorf("image engine returned %d: %s", response.StatusCode, detail)
	}
	if out != nil && len(raw) > 0 {
		if err := json.Unmarshal(raw, out); err != nil {
			return response.StatusCode, fmt.Errorf("decode image engine reply: %w", err)
		}
	}
	return response.StatusCode, nil
}

// failure returns message with the last line of engine output, which usually says why the engine failed.
func (r imageEngineRun) failure(message string) error {
	if detail := r.logs.lastLine(); detail != "" {
		return fmt.Errorf("%s: %s", message, detail)
	}
	return errors.New(message)
}

// imageEngineLog keeps the end of the engine's output so failures can report the cause.
type imageEngineLog struct {
	mu   sync.Mutex
	tail []byte
}

// Write keeps the last imageEngineLogBytes of output.
func (l *imageEngineLog) Write(data []byte) (int, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.tail = append(l.tail, data...)
	if extra := len(l.tail) - imageEngineLogBytes; extra > 0 {
		l.tail = append([]byte(nil), l.tail[extra:]...)
	}
	return len(data), nil
}
