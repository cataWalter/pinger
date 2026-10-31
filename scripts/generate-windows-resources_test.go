package main

import (
	"debug/pe"
	"encoding/binary"
	"os"
	"path/filepath"
	"testing"
)

func resourceIDExists(data []byte, resourceType, resourceID uint32) bool {
	entryCount := func(offset int) int {
		return int(binary.LittleEndian.Uint16(data[offset+12:])) + int(binary.LittleEndian.Uint16(data[offset+14:]))
	}
	for index := 0; index < entryCount(0); index++ {
		entry := 16 + index*8
		if binary.LittleEndian.Uint32(data[entry:]) != resourceType {
			continue
		}
		directory := int(binary.LittleEndian.Uint32(data[entry+4:]) & 0x7fffffff)
		for child := 0; child < entryCount(directory); child++ {
			if binary.LittleEndian.Uint32(data[directory+16+child*8:]) == resourceID {
				return true
			}
		}
	}
	return false
}

func TestWindowsResourcesMatchNativeIconLoader(test *testing.T) {
	for architecture, machine := range map[string]uint16{
		"amd64": pe.IMAGE_FILE_MACHINE_AMD64,
		"arm64": pe.IMAGE_FILE_MACHINE_ARM64,
		"386":   pe.IMAGE_FILE_MACHINE_I386,
	} {
		test.Run(architecture, func(subtest *testing.T) {
			output := filepath.Join(subtest.TempDir(), "icon.syso")
			if err := generateWindowsResources(architecture, "../build/windows/icon.ico", "../build/windows/pinger.exe.manifest", output); err != nil {
				subtest.Fatal(err)
			}
			object, err := pe.Open(output)
			if err != nil {
				subtest.Fatal(err)
			}
			defer object.Close()
			if object.Machine != machine {
				subtest.Fatalf("machine = %x, want %x", object.Machine, machine)
			}
			section := object.Section(".rsrc")
			if section == nil {
				subtest.Fatal("missing Windows resource section")
			}
			data, err := section.Data()
			if err != nil {
				subtest.Fatal(err)
			}
			if !resourceIDExists(data, 14, windowsApplicationIconID) {
				subtest.Fatal("missing application icon 32512 expected by Wails")
			}
			if resourceIDExists(data, 14, 3) {
				subtest.Fatal("icon uses resource type 3 as its ID instead of application icon 32512")
			}
			if !resourceIDExists(data, 24, 1) {
				subtest.Fatal("missing application manifest")
			}
		})
	}
}

func TestWindowsResourcesRejectUnsupportedArchitecture(test *testing.T) {
	output := filepath.Join(test.TempDir(), "invalid.syso")
	if err := generateWindowsResources("unsupported", "", "", output); err == nil {
		test.Fatal("unsupported architecture accepted")
	}
	if _, err := os.Stat(output); !os.IsNotExist(err) {
		test.Fatalf("invalid architecture created an output: %v", err)
	}
}
