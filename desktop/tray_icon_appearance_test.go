package desktop

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"testing"
)

func TestTrayIconVariantFollowsThemeMode(t *testing.T) {
	tests := []struct {
		theme      string
		systemDark bool
		wantDark   bool
	}{
		{theme: "Light", systemDark: true, wantDark: false},
		{theme: "Bosco", systemDark: true, wantDark: false},
		{theme: "Rosa", systemDark: true, wantDark: false},
		{theme: "Solarized", systemDark: true, wantDark: false},
		{theme: "Sepia", systemDark: true, wantDark: false},
		{theme: "Dark", systemDark: false, wantDark: true},
		{theme: "VS Code", systemDark: false, wantDark: true},
		{theme: "OLED black", systemDark: false, wantDark: true},
		{theme: "Dracula", systemDark: false, wantDark: true},
		{theme: "Midnight", systemDark: false, wantDark: true},
		{theme: "Slate", systemDark: false, wantDark: true},
		{theme: "System default", systemDark: true, wantDark: true},
		{theme: "System default", systemDark: false, wantDark: false},
	}
	for _, test := range tests {
		t.Run(test.theme, func(t *testing.T) {
			if got := trayIconUsesDarkVariant(test.theme, test.systemDark); got != test.wantDark {
				t.Fatalf("trayIconUsesDarkVariant(%q, %v) = %v, want %v", test.theme, test.systemDark, got, test.wantDark)
			}
		})
	}
}

func TestTrayIconsUseTransparentBlackAndWhiteMarks(t *testing.T) {
	icons := trayIcons()
	decode := func(name string, data []byte) image.Image {
		t.Helper()
		icon, err := png.Decode(bytes.NewReader(data))
		if err != nil {
			t.Fatalf("decode %s tray icon: %v", name, err)
		}
		return icon
	}
	light := decode("light", icons.normal)
	dark := decode("dark", icons.darkMode)
	lightUnread := decode("unread light", icons.unread)
	darkUnread := decode("unread dark", icons.darkModeUnread)

	visiblePixels := 0
	for y := light.Bounds().Min.Y; y < light.Bounds().Max.Y; y++ {
		for x := light.Bounds().Min.X; x < light.Bounds().Max.X; x++ {
			lightPixel := color.NRGBAModel.Convert(light.At(x, y)).(color.NRGBA)
			darkPixel := color.NRGBAModel.Convert(dark.At(x, y)).(color.NRGBA)
			if lightPixel.A == 0 {
				if darkPixel.A != 0 {
					t.Fatalf("dark icon has an opaque background pixel at (%d, %d)", x, y)
				}
				continue
			}
			visiblePixels++
			if darkPixel.A != lightPixel.A {
				t.Fatalf("theme variants have different mark opacity at (%d, %d)", x, y)
			}
			if lightPixel.R != 0 || lightPixel.G != 0 || lightPixel.B != 0 {
				t.Fatalf("light mark pixel = %+v, want black", lightPixel)
			}
			if darkPixel.R < 220 || darkPixel.G < 220 || darkPixel.B < 220 {
				t.Fatalf("dark mark pixel = %+v, want white", darkPixel)
			}
		}
	}
	if visiblePixels == 0 {
		t.Fatal("tray mark is not visible")
	}
	if light.Bounds() != dark.Bounds() {
		t.Fatalf("theme variant dimensions differ: light=%v dark=%v", light.Bounds(), dark.Bounds())
	}

	for name, icon := range map[string]image.Image{"unread light": lightUnread, "unread dark": darkUnread} {
		badge := color.NRGBAModel.Convert(icon.At(216, 44)).(color.NRGBA)
		if badge.R < 220 || badge.G > 100 || badge.B > 100 {
			t.Fatalf("%s badge pixel = %+v, want red", name, badge)
		}
	}
}
