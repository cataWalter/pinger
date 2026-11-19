package main

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
)

const (
	goToolchain     = "go1.26.11"
	defaultVitePort = "9245"
)

func main() {
	err := runDev()
	if err == nil {
		return
	}
	var exitErr *exec.ExitError
	if errors.As(err, &exitErr) && exitErr.ExitCode() > 0 {
		os.Exit(exitErr.ExitCode())
	}
	fmt.Fprintln(os.Stderr, err)
	os.Exit(1)
}

func runDev() error {
	cwd, err := os.Getwd()
	if err != nil {
		return err
	}
	repoRoot, err := findRepoRoot(cwd)
	if err != nil {
		return err
	}
	nodeDirs, err := nodeBinDirs()
	if err != nil {
		return err
	}
	wails, err := findWails()
	if err != nil {
		return err
	}

	port := os.Getenv("WAILS_VITE_PORT")
	if port == "" {
		port = defaultVitePort
	}
	pathDirs := append(nodeDirs, filepath.Dir(wails))
	env := append(os.Environ(), "GOTOOLCHAIN="+goToolchain, "WAILS_VITE_PORT="+port)
	if runtime.GOOS == "windows" {
		mingwBin := filepath.Join(repoRoot, "tools", "msys64", "ucrt64", "bin")
		if fileExists(filepath.Join(mingwBin, "gcc.exe")) {
			pathDirs = append(pathDirs, mingwBin)
			env = append(env, "CC=gcc")
		}
	}
	env = append(env, "PATH="+joinPath(pathDirs, os.Getenv("PATH")))

	cmd := exec.Command(wails, "dev", "-config", devConfigPath(runtime.GOOS), "-port", port)
	cmd.Dir = repoRoot
	cmd.Env = env
	cmd.Stdin = os.Stdin
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("could not start Wails dev mode: %w", err)
	}

	// Ctrl+C is delivered to the Wails child through the shared terminal process group, so only SIGTERM is relayed.
	signals := make(chan os.Signal, 1)
	signal.Notify(signals, os.Interrupt, syscall.SIGTERM)
	defer signal.Stop(signals)
	go func() {
		for sig := range signals {
			if sig == syscall.SIGTERM {
				_ = cmd.Process.Signal(sig)
			}
		}
	}()
	return cmd.Wait()
}

func devConfigPath(goos string) string {
	switch goos {
	case "darwin":
		return "./build/darwin/dev-config.yml"
	case "windows":
		return "./build/windows/dev-config.yml"
	default:
		return "./build/config.yml"
	}
}

func findRepoRoot(start string) (string, error) {
	dir := start
	for {
		if fileExists(filepath.Join(dir, "go.mod")) && fileExists(filepath.Join(dir, "build", "config.yml")) {
			return dir, nil
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return "", errors.New("could not find the Pinger repository root; run this from inside the repository")
		}
		dir = parent
	}
}

// nodeBinDirs returns extra PATH directories needed for both node and npm to resolve.
// Homebrew may link node without npm, so on macOS the node keg's bin directory is the fallback.
func nodeBinDirs() ([]string, error) {
	var missing []string
	for _, name := range []string{"node", "npm"} {
		if _, err := exec.LookPath(name); err != nil {
			missing = append(missing, name)
		}
	}
	if len(missing) == 0 {
		return nil, nil
	}
	if runtime.GOOS == "darwin" {
		if out, err := exec.Command("brew", "--prefix", "node").Output(); err == nil {
			bin := filepath.Join(strings.TrimSpace(string(out)), "bin")
			if fileExists(filepath.Join(bin, "node")) && fileExists(filepath.Join(bin, "npm")) {
				return []string{bin}, nil
			}
		}
	}
	return nil, fmt.Errorf("%s not found. Install Node.js (it includes npm) with `brew install node` or add its bin directory to PATH.", strings.Join(missing, " and "))
}

func findWails() (string, error) {
	if path, err := exec.LookPath("wails3"); err == nil {
		return path, nil
	}
	name := "wails3"
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	for _, dir := range goBinDirs() {
		candidate := filepath.Join(dir, name)
		if fileExists(candidate) {
			return candidate, nil
		}
	}
	return "", errors.New("Wails CLI not found. Install the project-pinned version with:\n  go install github.com/wailsapp/wails/v3/cmd/wails3@v3.0.0-beta.30")
}

func goBinDirs() []string {
	if gobin := goEnv("GOBIN"); gobin != "" {
		return []string{gobin}
	}
	var dirs []string
	for _, gopath := range filepath.SplitList(goEnv("GOPATH")) {
		dirs = append(dirs, filepath.Join(gopath, "bin"))
	}
	return dirs
}

func goEnv(key string) string {
	out, err := exec.Command("go", "env", key).Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

func joinPath(dirs []string, current string) string {
	var parts []string
	for _, dir := range dirs {
		if dir != "" {
			parts = append(parts, dir)
		}
	}
	if current != "" {
		parts = append(parts, current)
	}
	return strings.Join(parts, string(os.PathListSeparator))
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}
