//go:build !(darwin && private_mac_apis)

package desktop

import "github.com/wailsapp/wails/v3/pkg/application"

// Without private_mac_apis the webview stays opaque, which would hide the glass, so the window keeps its normal backdrop.
const macWindowBackdrop = application.MacBackdropNormal
