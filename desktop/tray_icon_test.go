package desktop

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"testing"
)

func TestTrayIconsPreserveOfficialMarkAndUnreadBadge(t *testing.T) {
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
	unreadLight := decode("unread light", icons.unread)
	unreadDark := decode("unread dark", icons.darkModeUnread)
	lightSilhouette := color.NRGBAModel.Convert(light.At(180, 180)).(color.NRGBA)
	darkSilhouette := color.NRGBAModel.Convert(dark.At(180, 180)).(color.NRGBA)
	if lightSilhouette.R > 24 || lightSilhouette.G > 24 || lightSilhouette.B > 24 {
		t.Fatalf("light silhouette pixel = %+v, want black", lightSilhouette)
	}
	if darkSilhouette.R < 220 || darkSilhouette.G < 220 || darkSilhouette.B < 220 {
		t.Fatalf("dark silhouette pixel = %+v, want light", darkSilhouette)
	}

	goldPixels := 0
	for y := light.Bounds().Min.Y; y < light.Bounds().Max.Y; y++ {
		for x := light.Bounds().Min.X; x < light.Bounds().Max.X; x++ {
			lightPixel := color.NRGBAModel.Convert(light.At(x, y)).(color.NRGBA)
			if lightPixel.A == 0 || lightPixel.R < 220 || lightPixel.G < 150 || lightPixel.B > 80 {
				continue
			}
			goldPixels++
			darkPixel := color.NRGBAModel.Convert(dark.At(x, y)).(color.NRGBA)
			if darkPixel != lightPixel {
				t.Fatalf("dark variant changed official gold pixel at (%d, %d): light=%+v dark=%+v", x, y, lightPixel, darkPixel)
			}
		}
	}
	if goldPixels == 0 {
		t.Fatal("official gold mark was not found in the light tray icon")
	}

	for name, icon := range map[string]image.Image{"unread light": unreadLight, "unread dark": unreadDark} {
		badge := color.NRGBAModel.Convert(icon.At(216, 44)).(color.NRGBA)
		if badge.R < 220 || badge.G > 100 || badge.B > 100 {
			t.Fatalf("%s badge pixel = %+v, want red", name, badge)
		}
	}
}

func TestLinuxTrayIconsUseCompactTransparentMark(t *testing.T) {
	icons, err := linuxTrayIcons()
	if err != nil {
		t.Fatalf("prepare Linux tray icons: %v", err)
	}
	icon, err := png.Decode(bytes.NewReader(icons.normal))
	if err != nil {
		t.Fatalf("decode Linux tray icon: %v", err)
	}
	bounds := icon.Bounds()
	if bounds.Dx() >= 128 || bounds.Dy() >= 128 {
		t.Fatalf("Linux tray icon dimensions = %v, want compact mark smaller than 128px", bounds)
	}

	goldPixels, transparentPixels := 0, 0
	for y := bounds.Min.Y; y < bounds.Max.Y; y++ {
		for x := bounds.Min.X; x < bounds.Max.X; x++ {
			pixel := color.NRGBAModel.Convert(icon.At(x, y)).(color.NRGBA)
			if pixel.A == 0 {
				transparentPixels++
			}
			if isTrayMarkPixel(pixel) {
				goldPixels++
			}
		}
	}
	if goldPixels == 0 || transparentPixels == 0 {
		t.Fatalf("Linux tray icon has %d gold pixels and %d transparent pixels; want a gold mark with transparent background", goldPixels, transparentPixels)
	}

	unread, err := png.Decode(bytes.NewReader(icons.unread))
	if err != nil {
		t.Fatalf("decode unread Linux tray icon: %v", err)
	}
	badge := color.NRGBAModel.Convert(unread.At(bounds.Dx()*27/32, bounds.Dy()*11/64)).(color.NRGBA)
	if badge.R < 220 || badge.G > 100 || badge.B > 100 {
		t.Fatalf("Linux unread badge pixel = %+v, want red", badge)
	}
}
