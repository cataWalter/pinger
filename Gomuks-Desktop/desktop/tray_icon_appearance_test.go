package desktop

import (
	"bytes"
	"image"
	"image/color"
	"image/draw"
	"image/png"
	"os"
	"path/filepath"
	"testing"
)

func TestMacOSTrayIconsAreCompactTemplates(t *testing.T) {
	icons := macOSTrayIcons()
	if !bytes.Equal(icons.normal, icons.darkMode) || !bytes.Equal(icons.unread, icons.darkModeUnread) {
		t.Fatal("macOS templates must let the system tint both appearances")
	}
	for name, data := range map[string][]byte{"normal": icons.normal, "unread": icons.unread} {
		t.Run(name, func(t *testing.T) {
			icon, err := png.Decode(bytes.NewReader(data))
			if err != nil {
				t.Fatal(err)
			}
			bounds := icon.Bounds()
			if bounds != image.Rect(0, 0, 44, 44) {
				t.Fatalf("template bounds = %v, want 44px Retina artwork", bounds)
			}
			visibleBounds := image.Rect(44, 44, 0, 0)
			antialiased := false
			for y := 0; y < 44; y++ {
				for x := 0; x < 44; x++ {
					pixel := color.NRGBAModel.Convert(icon.At(x, y)).(color.NRGBA)
					if pixel.A == 0 {
						continue
					}
					if pixel.R != 0 || pixel.G != 0 || pixel.B != 0 {
						t.Fatalf("template pixel at (%d, %d) has color %+v", x, y, pixel)
					}
					if x == 0 || y == 0 || x == 43 || y == 43 {
						t.Fatalf("template touches the canvas edge at (%d, %d)", x, y)
					}
					antialiased = antialiased || pixel.A < 255
					visibleBounds.Min.X = min(visibleBounds.Min.X, x)
					visibleBounds.Min.Y = min(visibleBounds.Min.Y, y)
					visibleBounds.Max.X = max(visibleBounds.Max.X, x+1)
					visibleBounds.Max.Y = max(visibleBounds.Max.Y, y+1)
				}
			}
			if visibleBounds.Dx() < 32 || visibleBounds.Dy() < 32 || !antialiased {
				t.Fatalf("template is too small or has jagged edges: bounds=%v antialiased=%v", visibleBounds, antialiased)
			}
			badge := color.NRGBAModel.Convert(icon.At(35, 9)).(color.NRGBA)
			if (name == "unread" && badge.A != 255) || (name == "normal" && badge.A != 0) {
				t.Fatalf("%s badge pixel = %+v", name, badge)
			}
			if directory := os.Getenv("PINGER_TRAY_PREVIEW_DIR"); directory != "" {
				if err := os.MkdirAll(directory, 0o700); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(filepath.Join(directory, "pinger-tray-"+name+".png"), data, 0o600); err != nil {
					t.Fatal(err)
				}
				preview := image.NewNRGBA(image.Rect(0, 0, 132, 64))
				for index, background := range []color.NRGBA{{R: 248, G: 248, B: 248, A: 255}, {R: 32, G: 32, B: 32, A: 255}} {
					offset := index * 66
					tint := color.NRGBA{A: 255}
					if index == 1 {
						tint = color.NRGBA{R: 245, G: 245, B: 245, A: 255}
					}
					draw.Draw(preview, image.Rect(offset, 0, offset+66, 64), image.NewUniform(background), image.Point{}, draw.Src)
					draw.DrawMask(preview, image.Rect(offset+11, 10, offset+55, 54), image.NewUniform(tint), image.Point{}, icon, image.Point{}, draw.Over)
				}
				if err := os.WriteFile(filepath.Join(directory, "pinger-tray-"+name+"-preview.png"), encodeTrayIcon(preview), 0o600); err != nil {
					t.Fatal(err)
				}
			}
		})
	}
}

func TestTrayIconVariantFollowsSystemAppearance(t *testing.T) {
	tests := []struct {
		theme      string
		systemDark bool
		wantDark   bool
	}{
		{theme: "Light", systemDark: true, wantDark: true},
		{theme: "Bosco", systemDark: true, wantDark: true},
		{theme: "Rosa", systemDark: true, wantDark: true},
		{theme: "Solarized", systemDark: true, wantDark: true},
		{theme: "Sepia", systemDark: true, wantDark: true},
		{theme: "Dark", systemDark: false, wantDark: false},
		{theme: "VS Code", systemDark: false, wantDark: false},
		{theme: "OLED black", systemDark: false, wantDark: false},
		{theme: "Dracula", systemDark: false, wantDark: false},
		{theme: "Midnight", systemDark: false, wantDark: false},
		{theme: "Slate", systemDark: false, wantDark: false},
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
		badge := color.NRGBAModel.Convert(icon.At(icon.Bounds().Dx()*35/44, icon.Bounds().Dy()*9/44)).(color.NRGBA)
		if badge.R < 220 || badge.G > 100 || badge.B > 100 {
			t.Fatalf("%s badge pixel = %+v, want red", name, badge)
		}
	}
}

func TestPlatformTrayIconsHaveCompactAntialiasedGeometry(t *testing.T) {
	linux, err := linuxTrayIcons()
	if err != nil {
		t.Fatal(err)
	}
	for platform, variants := range map[string]trayIconVariants{"windows": trayIcons(), "linux": linux} {
		for name, data := range map[string][]byte{"normal": variants.normal, "unread": variants.unread, "dark": variants.darkMode, "dark unread": variants.darkModeUnread} {
			t.Run(platform+"/"+name, func(t *testing.T) {
				icon, err := png.Decode(bytes.NewReader(data))
				if err != nil {
					t.Fatal(err)
				}
				if icon.Bounds() != image.Rect(0, 0, 64, 64) {
					t.Fatalf("bounds = %v, want 64px high-DPI artwork", icon.Bounds())
				}
				visibleBounds := image.Rect(64, 64, 0, 0)
				antialiased := false
				for y := 0; y < 64; y++ {
					for x := 0; x < 64; x++ {
						pixel := color.NRGBAModel.Convert(icon.At(x, y)).(color.NRGBA)
						if pixel.A == 0 {
							continue
						}
						if x == 0 || y == 0 || x == 63 || y == 63 {
							t.Fatalf("artwork touches the edge at (%d, %d)", x, y)
						}
						antialiased = antialiased || pixel.A < 255
						visibleBounds.Min.X = min(visibleBounds.Min.X, x)
						visibleBounds.Min.Y = min(visibleBounds.Min.Y, y)
						visibleBounds.Max.X = max(visibleBounds.Max.X, x+1)
						visibleBounds.Max.Y = max(visibleBounds.Max.Y, y+1)
					}
				}
				if visibleBounds.Dx() < 48 || visibleBounds.Dy() < 48 || !antialiased {
					t.Fatalf("undersized or jagged artwork: bounds=%v antialiased=%v", visibleBounds, antialiased)
				}
				if name == "unread" || name == "dark unread" {
					halo := color.NRGBAModel.Convert(icon.At(35*64/44, 14*64/44)).(color.NRGBA)
					if halo.A != 0 {
						t.Fatalf("unread badge halo is not transparent: %+v", halo)
					}
				}
			})
		}
		if bytes.Equal(variants.normal, variants.unread) {
			t.Fatalf("%s unread state has no visible change", platform)
		}
	}
}
