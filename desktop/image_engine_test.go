package desktop

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

const (
	imageEngineTestServerEnv = "MYCHAT_IMAGE_ENGINE_TEST_SERVER"
	testImagePNG             = "iVBORw0KGgo="
)

// TestMain lets the test binary act as the fake sd-server. The engine launches it as a real child process, so process start, readiness, and kill run for real.
func TestMain(m *testing.M) {
	if os.Getenv(imageEngineTestServerEnv) == "1" {
		os.Exit(serveImageEngineTestServer(os.Args[1:]))
	}
	os.Exit(m.Run())
}

// imageEngineTestServer implements the sd-server routes the engine uses.
type imageEngineTestServer struct {
	mu          sync.Mutex
	statusCalls int
	nextJob     int
	jobs        map[string]*imageEngineTestJob
}

// imageEngineTestJob drives the fake job by prompt: "fail" fails, "stall" generates until cancelled, anything else completes after one generating poll.
type imageEngineTestJob struct {
	prompt    string
	polls     int
	cancelled bool
}

func serveImageEngineTestServer(args []string) int {
	port := ""
	for index := 0; index+1 < len(args); index++ {
		if args[index] == "--listen-port" {
			port = args[index+1]
		}
	}
	if port == "" {
		return 2
	}
	listener, err := net.Listen("tcp", "127.0.0.1:"+port)
	if err != nil {
		return 1
	}
	fake := &imageEngineTestServer{jobs: make(map[string]*imageEngineTestJob)}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /sdcpp/v1/models/status", fake.handleStatus)
	mux.HandleFunc("POST /sdcpp/v1/img_gen", fake.handleSubmit)
	mux.HandleFunc("GET /sdcpp/v1/jobs/{id}", fake.handleJob)
	mux.HandleFunc("POST /sdcpp/v1/jobs/{id}/cancel", fake.handleCancel)
	_ = http.Serve(listener, mux)
	return 1
}

// handleStatus reports loading twice before ready, so the engine's readiness wait runs.
func (s *imageEngineTestServer) handleStatus(w http.ResponseWriter, _ *http.Request) {
	s.mu.Lock()
	s.statusCalls++
	state := "ready"
	if s.statusCalls <= 2 {
		state = "loading"
	}
	s.mu.Unlock()
	writeImageEngineTestJSON(w, http.StatusOK, map[string]string{"state": state})
}

func (s *imageEngineTestServer) handleSubmit(w http.ResponseWriter, r *http.Request) {
	var request imageGenerationRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		writeImageEngineTestJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	s.mu.Lock()
	s.nextJob++
	id := "job-" + strconv.Itoa(s.nextJob)
	s.jobs[id] = &imageEngineTestJob{prompt: request.Prompt}
	s.mu.Unlock()
	writeImageEngineTestJSON(w, http.StatusAccepted, map[string]string{"id": id, "status": "queued", "poll_url": "/sdcpp/v1/jobs/" + id})
}

func (s *imageEngineTestServer) handleJob(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	job, ok := s.jobs[r.PathValue("id")]
	if !ok {
		writeImageEngineTestJSON(w, http.StatusNotFound, map[string]string{"error": "unknown job"})
		return
	}
	job.polls++
	switch {
	case job.cancelled:
		writeImageEngineTestJSON(w, http.StatusOK, map[string]any{"status": "cancelled", "error": map[string]string{"code": "cancelled", "message": "job was cancelled"}})
	case job.prompt == "fail":
		writeImageEngineTestJSON(w, http.StatusOK, map[string]any{"status": "failed", "error": map[string]string{"code": "generation_failed", "message": "fake failure"}})
	case job.prompt == "stall":
		writeImageEngineTestJSON(w, http.StatusOK, map[string]any{"status": "generating", "preview": map[string]any{"step": 1, "total_steps": 20, "b64_json": testImagePNG}})
	case job.polls == 1:
		writeImageEngineTestJSON(w, http.StatusOK, map[string]any{"status": "generating", "preview": map[string]any{"step": 1, "total_steps": 2, "b64_json": testImagePNG}})
	default:
		writeImageEngineTestJSON(w, http.StatusOK, map[string]any{"status": "completed", "result": map[string]any{"output_format": "png", "images": []map[string]string{{"b64_json": testImagePNG}}}})
	}
}

func (s *imageEngineTestServer) handleCancel(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	job, ok := s.jobs[r.PathValue("id")]
	if !ok {
		writeImageEngineTestJSON(w, http.StatusNotFound, map[string]string{"error": "unknown job"})
		return
	}
	job.cancelled = true
	writeImageEngineTestJSON(w, http.StatusOK, map[string]bool{"cancel_requested": true})
}

func writeImageEngineTestJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

// newImageEngineTestSettings points the engine at the test binary, which acts as sd-server through TestMain.
func newImageEngineTestSettings(t *testing.T, idle time.Duration) imageSettings {
	t.Helper()
	t.Setenv(imageEngineTestServerEnv, "1")
	binary, err := filepath.Abs(os.Args[0])
	if err != nil {
		t.Fatalf("resolve test binary: %v", err)
	}
	model := filepath.Join(t.TempDir(), "model.safetensors")
	if err := os.WriteFile(model, []byte("test model"), 0o600); err != nil {
		t.Fatalf("write test model: %v", err)
	}
	return imageSettings{BinaryPath: binary, ModelPath: model, IdleTimeout: idle, Width: 512, Height: 512}
}

func TestImageEngineGeneratesImageAndReportsProgress(t *testing.T) {
	settings := newImageEngineTestSettings(t, time.Minute)
	engine := &imageEngine{}
	defer engine.stop()

	var updates []imageEngineProgress
	image, err := engine.generate(context.Background(), settings, "ok", func(update imageEngineProgress) {
		updates = append(updates, update)
	})
	if err != nil {
		t.Fatalf("generate() error = %v", err)
	}
	if image != testImagePNG {
		t.Fatalf("image = %q, want %q", image, testImagePNG)
	}
	if len(updates) != 2 || updates[0].Stage != "starting" || updates[1].Stage != "generating" || updates[1].Step != 1 || updates[1].TotalSteps != 2 {
		t.Fatalf("progress = %+v, want starting then generating at step 1 of 2", updates)
	}
	if !engine.running() {
		t.Fatal("engine stopped right after a job; want it kept warm for the idle timeout")
	}
	engine.stop()
	if engine.running() {
		t.Fatal("stop() left the engine running")
	}
}

func TestImageEngineReusesProcessAndStopsWhenIdle(t *testing.T) {
	settings := newImageEngineTestSettings(t, time.Second)
	engine := &imageEngine{}
	defer engine.stop()

	if _, err := engine.generate(context.Background(), settings, "ok", nil); err != nil {
		t.Fatalf("first generate() error = %v", err)
	}
	first := engine.processID()
	if first == 0 {
		t.Fatal("no engine process after the first generation")
	}
	if _, err := engine.generate(context.Background(), settings, "ok", nil); err != nil {
		t.Fatalf("second generate() error = %v", err)
	}
	if second := engine.processID(); second != first {
		t.Fatalf("process ID changed from %d to %d, want the running engine reused", first, second)
	}
	deadline := time.Now().Add(10 * time.Second)
	for engine.running() {
		if time.Now().After(deadline) {
			t.Fatal("engine was still running after the idle timeout")
		}
		time.Sleep(50 * time.Millisecond)
	}
}

func TestImageEngineCancelStopsRemoteJob(t *testing.T) {
	settings := newImageEngineTestSettings(t, time.Minute)
	engine := &imageEngine{}
	defer engine.stop()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	started := time.Now()
	_, err := engine.generate(ctx, settings, "stall", func(update imageEngineProgress) {
		if update.Stage == "generating" {
			cancel()
		}
	})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("generate() error = %v, want context.Canceled", err)
	}
	// Without a cancel request the job never reports cancelled, so the engine would wait out the full cancel timeout.
	if elapsed := time.Since(started); elapsed >= imageEngineCancelTimeout/2 {
		t.Fatalf("cancel took %s, want the engine to see the cancelled job promptly", elapsed)
	}
}

func TestImageEngineReportsFailedJob(t *testing.T) {
	settings := newImageEngineTestSettings(t, time.Minute)
	engine := &imageEngine{}
	defer engine.stop()

	_, err := engine.generate(context.Background(), settings, "fail", nil)
	if err == nil || !strings.Contains(err.Error(), "fake failure") {
		t.Fatalf("generate() error = %v, want the engine failure message", err)
	}
}

func TestImageEngineRejectsSecondGenerationWhileBusy(t *testing.T) {
	settings := newImageEngineTestSettings(t, time.Minute)
	engine := &imageEngine{}
	defer engine.stop()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	started := make(chan struct{})
	var startedOnce sync.Once
	done := make(chan error, 1)
	go func() {
		_, err := engine.generate(ctx, settings, "stall", func(update imageEngineProgress) {
			if update.Stage == "generating" {
				startedOnce.Do(func() { close(started) })
			}
		})
		done <- err
	}()
	select {
	case <-started:
	case <-time.After(20 * time.Second):
		t.Fatal("first generation did not start")
	}
	if _, err := engine.generate(context.Background(), settings, "ok", nil); !errors.Is(err, errImageEngineBusy) {
		t.Fatalf("second generate() error = %v, want errImageEngineBusy", err)
	}
	cancel()
	if err := <-done; !errors.Is(err, context.Canceled) {
		t.Fatalf("first generate() error = %v, want context.Canceled", err)
	}
}
