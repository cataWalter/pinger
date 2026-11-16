package main

import (
	"flag"
	"fmt"
	"os"
	"runtime"

	"github.com/tc-hib/winres"
)

const windowsApplicationIconID = 32512

func generateWindowsResources(architecture, iconPath, manifestPath, outputPath string) error {
	targetArch, supported := map[string]winres.Arch{
		"amd64": winres.ArchAMD64,
		"arm64": winres.ArchARM64,
		"386":   winres.ArchI386,
	}[architecture]
	if !supported {
		return fmt.Errorf("unsupported Windows architecture %q", architecture)
	}
	iconFile, err := os.Open(iconPath)
	if err != nil {
		return err
	}
	icon, loadErr := winres.LoadICO(iconFile)
	closeErr := iconFile.Close()
	if loadErr != nil {
		return loadErr
	}
	if closeErr != nil {
		return closeErr
	}
	manifestData, err := os.ReadFile(manifestPath)
	if err != nil {
		return err
	}
	manifest, err := winres.AppManifestFromXML(manifestData)
	if err != nil {
		return err
	}
	resources := winres.ResourceSet{}
	if err = resources.SetIcon(winres.ID(windowsApplicationIconID), icon); err != nil {
		return err
	}
	resources.SetManifest(manifest)
	output, err := os.Create(outputPath)
	if err != nil {
		return err
	}
	writeErr := resources.WriteObject(output, targetArch)
	closeErr = output.Close()
	if writeErr != nil {
		return writeErr
	}
	return closeErr
}

func main() {
	architecture := flag.String("arch", runtime.GOARCH, "Target Windows architecture")
	iconPath := flag.String("icon", "build/windows/icon.ico", "Application ICO path")
	manifestPath := flag.String("manifest", "build/windows/pinger.exe.manifest", "Application manifest path")
	outputPath := flag.String("out", "", "Output .syso path")
	flag.Parse()
	if *outputPath == "" {
		*outputPath = "rsrc_windows_" + *architecture + ".syso"
	}
	if err := generateWindowsResources(*architecture, *iconPath, *manifestPath, *outputPath); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
