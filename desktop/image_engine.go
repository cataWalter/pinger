package desktop

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// imageEngineModelFlag makes sd-server load the checkpoint at startup. Confirm it with `sd-server -h` for the installed build.
const imageEngineModelFlag = "-m"

const (
	imageEngineDefaultIdle   = 3 * time.Minute
	imageEngineDefaultSize   = 512
	imageEngineStartTimeout  = 3 * time.Minute
	imageEngineStartPoll     = 250 * time.Millisecond
	imageEngineJobPoll       = 500 * time.Millisecond
	imageEngineJobTimeout    = 15 * time.Minute
	imageEngineCancelTimeout = 30 * time.Second
	imageEngineResponseBytes = 32 << 20
	imageEngineLogBytes      = 4 << 10
)

var (
	errImageEngineNotConfigured = errors.New("set the image engine binary and model in Settings")
	errImageEngineBusy          = errors.New("an image is already being generated")
)

// imageSettings holds the image generation preferences used for one request.
// Steps, CFGScale, and SampleMethod are zero or empty when unset, and the engine's own defaults apply.
type imageSettings struct {
	BinaryPath     string
	ModelPath      string
	IdleTimeout    time.Duration
	Width          int
	Height         int
	Steps          int
	CFGScale       float64
	SampleMethod   string
	NegativePrompt string
}

// imageEngineProgress is one progress update. Stage is "starting" while the engine loads, then "generating" with a step count and an optional base64 PNG preview.
type imageEngineProgress struct {
	Stage      string
	Step       int
	TotalSteps int
	Preview    string
}

// imageGenerationRequest is the body of POST /sdcpp/v1/img_gen.
type imageGenerationRequest struct {
	Prompt          string             `json:"prompt"`
	NegativePrompt  string             `json:"negative_prompt,omitempty"`
	Width           int                `json:"width"`
	Height          int                `json:"height"`
	BatchCount      int                `json:"batch_count"`
	OutputFormat    string             `json:"output_format"`
	Preview         string             `json:"preview"`
	PreviewInterval int                `json:"preview_interval"`
	SampleParams    *imageSampleParams `json:"sample_params,omitempty"`
}

// imageSampleParams is the sample_params object of an image job. Unset fields are omitted so the engine's defaults apply.
type imageSampleParams struct {
	SampleMethod string         `json:"sample_method,omitempty"`
	SampleSteps  int            `json:"sample_steps,omitempty"`
	Guidance     *imageGuidance `json:"guidance,omitempty"`
}

// imageGuidance is the guidance object inside imageSampleParams.
type imageGuidance struct {
	TxtCFG float64 `json:"txt_cfg"`
}

// imageEngineModelStatus is the reply of GET /sdcpp/v1/models/status. Only the state is read.
type imageEngineModelStatus struct {
	State string `json:"state"`
}

// imageEngineJob is the reply of GET /sdcpp/v1/jobs/{id}.
type imageEngineJob struct {
	Status  string `json:"status"`
	Preview *struct {
		Step       int    `json:"step"`
		TotalSteps int    `json:"total_steps"`
		B64JSON    string `json:"b64_json"`
	} `json:"preview"`
	Result *struct {
		Images []struct {
			B64JSON string `json:"b64_json"`
		} `json:"images"`
	} `json:"result"`
	Error *struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
}

// imageEngineRun describes the process a generation runs against.
type imageEngineRun struct {
	baseURL string
	exited  <-chan struct{}
	logs    *imageEngineLog
	epoch   uint64
}

// imageEngine runs sd-server as a child process on demand. The first generation starts it, later generations reuse it, and it stops after the idle timeout so the model's memory is released.
// Only one generation runs at a time, and the process is never stopped while a generation is using it.
type imageEngine struct {
	busy atomic.Bool

	mu        sync.Mutex
	binary    string
	model     string
	cmd       *exec.Cmd
	baseURL   string
	exited    chan struct{}
	logs      *imageEngineLog
	epoch     uint64
	idleSeq   uint64
	idleTimer *time.Timer
}

// generate runs one image job for prompt and returns the PNG as base64. Progress is reported through progress when it is set.
// When ctx ends, the remote job is cancelled and generate returns the context error.
func (e *imageEngine) generate(ctx context.Context, settings imageSettings, prompt string, progress func(imageEngineProgress)) (string, error) {
	if err := validateImageSettings(settings); err != nil {
		return "", err
	}
	if !e.busy.CompareAndSwap(false, true) {
		return "", errImageEngineBusy
	}
	defer e.finishJob(settings.IdleTimeout)

	ctx, cancel := context.WithTimeout(ctx, imageEngineJobTimeout)
	defer cancel()
	report := func(update imageEngineProgress) {
		if progress != nil {
			progress(update)
		}
	}

	report(imageEngineProgress{Stage: "starting"})
	run, err := e.start(settings)
	if err != nil {
		return "", err
	}
	if err := waitForImageEngine(ctx, run); err != nil {
		e.killRun(run.epoch)
		return "", err
	}
	jobID, err := submitImageJob(ctx, run.baseURL, imageGenerationRequest{
		Prompt:          prompt,
		NegativePrompt:  settings.NegativePrompt,
		Width:           settings.Width,
		Height:          settings.Height,
		BatchCount:      1,
		OutputFormat:    "png",
		Preview:         "proj",
		PreviewInterval: 1,
		SampleParams:    settings.sampleParams(),
	})
	if err != nil {
		if ctxErr := ctx.Err(); ctxErr != nil {
			return "", ctxErr
		}
		return "", err
	}
	return waitForImageJob(ctx, run, jobID, report)
}

// start returns a running engine for settings. It starts a new process when none is running or the model or binary changed.
// The mutex is held only while the process is launched, never while waiting for the model to load.
func (e *imageEngine) start(settings imageSettings) (imageEngineRun, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.isRunningLocked() && e.binary == settings.BinaryPath && e.model == settings.ModelPath {
		e.stopIdleLocked()
		return e.runLocked(), nil
	}
	e.stopLocked()

	port, err := freeLoopbackPort()
	if err != nil {
		return imageEngineRun{}, fmt.Errorf("reserve image engine port: %w", err)
	}
	logs := &imageEngineLog{}
	// Batched CFG produces blank images with the Realistic Vision checkpoint on Metal.
	command := exec.Command(settings.BinaryPath, "--listen-ip", "127.0.0.1", "--listen-port", strconv.Itoa(port), "--batched-cfg", "off", imageEngineModelFlag, settings.ModelPath)
	command.Stdout = logs
	command.Stderr = logs
	if err := command.Start(); err != nil {
		return imageEngineRun{}, fmt.Errorf("start image engine: %w", err)
	}
	exited := make(chan struct{})
	go func() {
		_ = command.Wait()
		close(exited)
	}()
	e.cmd = command
	e.binary = settings.BinaryPath
	e.model = settings.ModelPath
	e.baseURL = "http://127.0.0.1:" + strconv.Itoa(port)
	e.exited = exited
	e.logs = logs
	e.epoch++
	return e.runLocked(), nil
}

// runLocked describes the current process. The caller must hold the mutex.
func (e *imageEngine) runLocked() imageEngineRun {
	return imageEngineRun{baseURL: e.baseURL, exited: e.exited, logs: e.logs, epoch: e.epoch}
}

// finishJob releases the busy flag and, when the process is still running, restarts the idle timer.
func (e *imageEngine) finishJob(idle time.Duration) {
	e.busy.Store(false)
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.isRunningLocked() {
		e.armIdleLocked(idle)
	}
}

// armIdleLocked replaces the idle timer. When it fires with no generation running, the process is stopped.
// The caller must hold the mutex.
func (e *imageEngine) armIdleLocked(idle time.Duration) {
	e.stopIdleLocked()
	seq := e.idleSeq
	e.idleTimer = time.AfterFunc(idle, func() { e.stopIdle(seq) })
}

// stopIdleLocked cancels the idle timer and invalidates any callback that already fired. The caller must hold the mutex.
func (e *imageEngine) stopIdleLocked() {
	e.idleSeq++
	if e.idleTimer != nil {
		e.idleTimer.Stop()
		e.idleTimer = nil
	}
}

// stopIdle stops the process when its idle timer is still current and no generation is running.
func (e *imageEngine) stopIdle(seq uint64) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if seq != e.idleSeq || e.busy.Load() {
		return
	}
	e.stopLocked()
}

// isRunningLocked reports whether the process is alive. The caller must hold the mutex.
func (e *imageEngine) isRunningLocked() bool {
	if e.cmd == nil {
		return false
	}
	select {
	case <-e.exited:
		return false
	default:
		return true
	}
}

// stopLocked kills the process and clears its state. The caller must hold the mutex.
func (e *imageEngine) stopLocked() {
	e.stopIdleLocked()
	if e.cmd != nil {
		_ = e.cmd.Process.Kill()
	}
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
	response, err := ghostwriterHTTPClient.Do(request)
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

// lastLine returns the last non-empty line of output, or an empty string.
func (l *imageEngineLog) lastLine() string {
	if l == nil {
		return ""
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	lines := strings.Split(strings.TrimSpace(string(l.tail)), "\n")
	return strings.TrimSpace(lines[len(lines)-1])
}

// freeLoopbackPort asks the OS for an unused loopback port.
func freeLoopbackPort() (int, error) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, err
	}
	defer func() { _ = listener.Close() }()
	return listener.Addr().(*net.TCPAddr).Port, nil
}

// imageSettingsFromPreferences reads the image generation preferences. An unset or invalid value uses the default.
// Sampling values that are unset stay zero, so the engine's own defaults apply.
func imageSettingsFromPreferences(preferences map[string]any) (imageSettings, error) {
	settings := imageSettings{
		BinaryPath:     strings.TrimSpace(stringPreference(preferences, "ai.image.binary_path", "")),
		ModelPath:      strings.TrimSpace(stringPreference(preferences, "ai.image.model_path", "")),
		IdleTimeout:    imageEngineDefaultIdle,
		Width:          imageEngineDefaultSize,
		Height:         imageEngineDefaultSize,
		SampleMethod:   strings.TrimSpace(stringPreference(preferences, "ai.image.sampler", "")),
		NegativePrompt: strings.TrimSpace(stringPreference(preferences, "ai.image.negative_prompt", "")),
	}
	if minutes, err := strconv.Atoi(stringPreference(preferences, "ai.image.idle_minutes", "")); err == nil && minutes > 0 {
		settings.IdleTimeout = time.Duration(minutes) * time.Minute
	}
	if steps, err := strconv.Atoi(stringPreference(preferences, "ai.image.steps", "")); err == nil && steps > 0 {
		settings.Steps = steps
	}
	if scale, err := strconv.ParseFloat(stringPreference(preferences, "ai.image.cfg_scale", ""), 64); err == nil && scale > 0 {
		settings.CFGScale = scale
	}
	if widthText, heightText, found := strings.Cut(stringPreference(preferences, "ai.image.size", ""), "x"); found {
		width, widthErr := strconv.Atoi(widthText)
		height, heightErr := strconv.Atoi(heightText)
		if widthErr == nil && heightErr == nil && width > 0 && height > 0 {
			settings.Width = width
			settings.Height = height
		}
	}
	if settings.BinaryPath == "" || settings.ModelPath == "" {
		return imageSettings{}, errImageEngineNotConfigured
	}
	return settings, nil
}
