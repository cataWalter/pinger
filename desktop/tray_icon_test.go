package desktop

import (
	"bytes"
	"image/color"
	"image/png"
	"testing"
)

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
	badge := color.NRGBAModel.Convert(unread.At(bounds.Dx()*35/44, bounds.Dy()*9/44)).(color.NRGBA)
	if badge.R < 220 || badge.G > 100 || badge.B > 100 {
		t.Fatalf("Linux unread badge pixel = %+v, want red", badge)
	}
}
