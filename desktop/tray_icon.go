package desktop

import (
	"bytes"
	_ "embed"
	"image"
	"image/color"
	"image/draw"
	"image/png"
	"strings"
)

//go:embed tray.png
var baseTrayIcon []byte

type trayIconVariants struct {
	normal         []byte
	unread         []byte
	darkMode       []byte
	darkModeUnread []byte
}

func trayIcons() trayIconVariants {
	source, err := png.Decode(bytes.NewReader(baseTrayIcon))
	if err != nil {
		return trayIconVariants{
			normal:         baseTrayIcon,
			unread:         baseTrayIcon,
			darkMode:       baseTrayIcon,
			darkModeUnread: baseTrayIcon,
		}
	}

	lightMode := recolorTrayIconForLightMode(source)
	darkMode := recolorTrayIconForDarkMode(source)
	return trayIconVariants{
		normal:         encodeTrayIcon(lightMode),
		unread:         trayIconWithUnreadBadge(lightMode),
		darkMode:       encodeTrayIcon(darkMode),
		darkModeUnread: trayIconWithUnreadBadge(darkMode),
	}
}

func trayIconUsesDarkVariant(theme string, systemDark bool) bool {
	switch strings.ToLower(strings.TrimSpace(theme)) {
	case "light", "bosco", "rosa", "solarized", "sepia":
		return false
	case "dark", "vs code", "oled black", "dracula", "midnight", "slate":
		return true
	default:
		return systemDark
	}
}

func recolorTrayIconForLightMode(source image.Image) *image.NRGBA {
	return recolorTrayIcon(source, color.NRGBA{A: 255})
}

func recolorTrayIconForDarkMode(source image.Image) *image.NRGBA {
	return recolorTrayIcon(source, color.NRGBA{R: 245, G: 247, B: 245, A: 255})
}

func recolorTrayIcon(source image.Image, tint color.NRGBA) *image.NRGBA {
	bounds := source.Bounds()
	icon := image.NewNRGBA(bounds)
	for y := bounds.Min.Y; y < bounds.Max.Y; y++ {
		for x := bounds.Min.X; x < bounds.Max.X; x++ {
			pixel := color.NRGBAModel.Convert(source.At(x, y)).(color.NRGBA)
			if !isTrayMarkPixel(pixel) {
				continue
			}
			tint.A = pixel.R
			icon.SetNRGBA(x, y, tint)
		}
	}
	return icon
}

func isTrayMarkPixel(pixel color.NRGBA) bool {
	return pixel.A > 0 && pixel.R > pixel.G && pixel.G > 0 && pixel.G*2 >= pixel.R && pixel.B*2 < pixel.G
}

func trayIconWithUnreadBadge(source image.Image) []byte {
	bounds := source.Bounds()
	badged := image.NewRGBA(bounds)
	draw.Draw(badged, bounds, source, bounds.Min, draw.Src)
	centerX, centerY := bounds.Min.X+bounds.Dx()-40, bounds.Min.Y+44
	for y := centerY - 18; y <= centerY+18; y++ {
		for x := centerX - 18; x <= centerX+18; x++ {
			dx, dy := x-centerX, y-centerY
			if dx*dx+dy*dy <= 18*18 {
				badged.Set(x, y, color.NRGBA{R: 239, G: 68, B: 68, A: 255})
			}
		}
	}

	return encodeTrayIcon(badged)
}

func encodeTrayIcon(icon image.Image) []byte {
	var output bytes.Buffer
	if err := png.Encode(&output, icon); err != nil {
		return baseTrayIcon
	}
	return output.Bytes()
}
