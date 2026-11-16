package desktop

import (
	"context"
	"errors"
	"fmt"
	"os/exec"
	"strconv"
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
	stateFile string
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
	configureImageEngineProcess(command)
	if err := command.Start(); err != nil {
		return imageEngineRun{}, fmt.Errorf("start image engine: %w", err)
	}
	e.recordLocked(command.Process.Pid, settings.BinaryPath)
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
