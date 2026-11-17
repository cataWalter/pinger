package desktop

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"mychat/matrix"
	"mychat/notifications"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
)

func RunQtBackend(client *matrix.Client, dataDir, defaultDataDir, preferencesPath, mediaCacheDir string) error {
	return runQtBackend(client, dataDir, defaultDataDir, preferencesPath, mediaCacheDir, os.Stdin, os.Stdout)
}

func runQtBackend(client *matrix.Client, dataDir, defaultDataDir, preferencesPath, mediaCacheDir string, input io.Reader, output io.Writer) error {
	sharedPreferences, err := openSharedPreferences(dataDir, preferencesPath)
	if err != nil {
		return err
	}
	scheduledJobs, err := newScheduledJobStore(filepath.Join(filepath.Dir(preferencesPath), "scheduled-jobs.json"))
	if err != nil {
		_ = sharedPreferences.Close()
		return fmt.Errorf("open scheduled jobs: %w", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	notifier := qtNotifier{}
	service := &AppService{
		client:            client,
		dataDir:           dataDir,
		defaultDataDir:    defaultDataDir,
		sharedPreferences: sharedPreferences,
		notifier:          notifier,
		ctx:               ctx,
		cancel:            cancel,
		scheduled:         scheduledJobs,
	}
	service.imageEngine.stateFile = imageEngineRecordPath(defaultDataDir)
	if reapErr := reapOrphanedImageEngine(service.imageEngine.stateFile); reapErr != nil {
		log.Printf("reap orphaned image engine: %v", reapErr)
	}
	if err = service.initializeAccounts(dataDir, mediaCacheDir); err != nil {
		cancel()
		_ = sharedPreferences.Close()
		client.Close()
		return fmt.Errorf("initialize Matrix accounts: %w", err)
	}

	ipc := &backendIPC{
		service: service,
		tutor:   NewLanguageTutorService(service),
		output:  output,
	}
	service.quit = func() {
		ipc.emit("quit", nil)
		cancel()
	}
	service.openURL = openExternalURL
	service.revealFile = revealFile
	service.chooseDataFolder = func() (string, error) {
		return "", errors.New("choose a data folder using the Qt client")
	}
	service.chooseDownloadFolder = func() (string, error) {
		return "", errors.New("choose a download folder using the Qt client")
	}
	service.chooseSavePath = func(string, string) (string, error) {
		return "", errors.New("choose a save path using the Qt client")
	}
	service.setMenuBarIcon = func(bool) {}
	service.menuStateChanged = func(MenuState) {}
	service.menuAccountsChanged = func() {}

	mediaAssets := newMediaAssetHandler(service)
	var mediaServer *http.Server
	if listener, listenErr := net.Listen("tcp", "127.0.0.1:0"); listenErr == nil {
		mediaServer = &http.Server{Handler: mediaAssets}
		go func() {
			if serveErr := mediaServer.Serve(listener); serveErr != nil && serveErr != http.ErrServerClosed {
				log.Printf("serve Qt media assets: %v", serveErr)
			}
		}()
		ipc.emit("media-ready", map[string]any{"url": "http://" + listener.Addr().String()})
	} else {
		log.Printf("start Qt media server: %v", listenErr)
	}

	shutdown := newShutdown(service)
	defer shutdown()
	if mediaServer != nil {
		defer func() { _ = mediaServer.Close() }()
	}
	ipc.startEvents()
	service.startScheduledJobWorker()
	service.startSync()

	if err := ipc.serve(input); err != nil {
		cancel()
		return err
	}
	cancel()
	return nil
}

type qtNotifier struct{}

func (qtNotifier) Supported() bool {
	return false
}

func (qtNotifier) Permission() string {
	return "unsupported"
}

func (qtNotifier) RequestPermission() (string, error) {
	return "unsupported", nil
}

func (qtNotifier) Send(notifications.Message) error {
	return errors.New("native notifications are unavailable in the Qt client")
}

func validateExternalURL(raw string) (string, error) {
	target, err := url.ParseRequestURI(raw)
	if err != nil || (target.Scheme != "https" && target.Scheme != "http" && target.Scheme != "mailto") {
		return "", fmt.Errorf("unsupported external URL %q", raw)
	}
	return target.String(), nil
}

func openExternalURL(raw string) error {
	target, err := validateExternalURL(raw)
	if err != nil {
		return err
	}
	var command *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		command = exec.Command("open", target)
	case "windows":
		command = exec.Command("rundll32", "url.dll,FileProtocolHandler", target)
	default:
		command = exec.Command("xdg-open", target)
	}
	if output, err := command.CombinedOutput(); err != nil {
		return fmt.Errorf("open external URL: %w: %s", err, strings.TrimSpace(string(output)))
	}
	return nil
}

func revealFile(path string) error {
	var command *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		command = exec.Command("open", "-R", path)
	case "windows":
		command = exec.Command("explorer", "/select,"+path)
	default:
		command = exec.Command("xdg-open", filepath.Dir(path))
	}
	if output, err := command.CombinedOutput(); err != nil {
		return fmt.Errorf("reveal file: %w: %s", err, strings.TrimSpace(string(output)))
	}
	return nil
}
