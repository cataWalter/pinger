//go:build darwin && private_mac_apis

package desktop

import "github.com/wailsapp/wails/v3/pkg/application"

// Liquid Glass needs Wails' private_mac_apis build, which makes the webview transparent. Apps built with it cannot ship through the Mac App Store.
const macWindowBackdrop = application.MacBackdropLiquidGlass
