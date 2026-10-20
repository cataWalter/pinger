package desktop

import (
	"bytes"
	_ "embed"
	"image"
	"image/color"
	"image/draw"
	"image/png"
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

	darkMode := recolorTrayIconForDarkMode(source)
	return trayIconVariants{
		normal:         baseTrayIcon,
		unread:         trayIconWithUnreadBadge(source),
		darkMode:       encodeTrayIcon(darkMode),
		darkModeUnread: trayIconWithUnreadBadge(darkMode),
	}
}

func recolorTrayIconForDarkMode(source image.Image) *image.NRGBA {
	bounds := source.Bounds()
	darkMode := image.NewNRGBA(bounds)
	for y := bounds.Min.Y; y < bounds.Max.Y; y++ {
		for x := bounds.Min.X; x < bounds.Max.X; x++ {
			pixel := color.NRGBAModel.Convert(source.At(x, y)).(color.NRGBA)
			if pixel.A > 0 && pixel.R <= 24 && pixel.G <= 24 && pixel.B <= 24 {
				pixel.R, pixel.G, pixel.B = 245, 247, 245
			}
			darkMode.SetNRGBA(x, y, pixel)
		}
	}
	return darkMode
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
