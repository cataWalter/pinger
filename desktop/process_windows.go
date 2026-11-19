//go:build windows

package desktop

import (
	"os/exec"
	"syscall"
	"unsafe"
)

const (
	createNoWindow                 = 0x08000000
	processQueryLimitedInformation = 0x1000
	maxExtendedPathLength          = 32768
)

var procQueryFullProcessImageName = syscall.NewLazyDLL("kernel32.dll").NewProc("QueryFullProcessImageNameW")

// hideChildConsole keeps console children such as ffmpeg and sd-server from opening a console window.
func hideChildConsole(command *exec.Cmd) {
	command.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: createNoWindow}
}

// processCommand returns the executable path of pid. Windows has no ps command, so the image path is queried instead.
func processCommand(pid int) (string, bool) {
	if pid <= 0 {
		return "", false
	}
	handle, err := syscall.OpenProcess(processQueryLimitedInformation, false, uint32(pid))
	if err != nil {
		return "", false
	}
	defer syscall.CloseHandle(handle)
	buffer := make([]uint16, maxExtendedPathLength)
	size := uint32(len(buffer))
	ok, _, _ := procQueryFullProcessImageName.Call(uintptr(handle), 0, uintptr(unsafe.Pointer(&buffer[0])), uintptr(unsafe.Pointer(&size)))
	if ok == 0 {
		return "", false
	}
	name := syscall.UTF16ToString(buffer[:size])
	return name, name != ""
}
