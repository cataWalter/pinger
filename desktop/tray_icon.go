package desktop

import (
	"bytes"
	_ "embed"
	"fmt"
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

func linuxTrayIcons() (trayIconVariants, error) {
	source, err := png.Decode(bytes.NewReader(baseTrayIcon))
	if err != nil {
		return trayIconVariants{}, fmt.Errorf("decode Linux tray icon: %w", err)
	}

	bounds := source.Bounds()
	minX, minY, maxX, maxY := bounds.Max.X, bounds.Max.Y, -1, -1
	for y := bounds.Min.Y; y < bounds.Max.Y; y++ {
		for x := bounds.Min.X; x < bounds.Max.X; x++ {
			if isTrayMarkPixel(color.NRGBAModel.Convert(source.At(x, y)).(color.NRGBA)) {
				minX, minY = min(minX, x), min(minY, y)
				maxX, maxY = max(maxX, x), max(maxY, y)
			}
		}
	}
	if maxX < minX || maxY < minY {
		return trayIconVariants{}, fmt.Errorf("find gold mark in Linux tray icon")
	}

	markWidth, markHeight := maxX-minX+1, maxY-minY+1
	side := max(markWidth, markHeight) + max(8, max(markWidth, markHeight)/6)
	crop := image.Rect(
		(minX+maxX+1-side)/2,
		(minY+maxY+1-side)/2,
		(minX+maxX+1-side)/2+side,
		(minY+maxY+1-side)/2+side,
	)
	mark := image.NewNRGBA(image.Rect(0, 0, side, side))
	for y := 0; y < side; y++ {
		for x := 0; x < side; x++ {
			pixel := color.NRGBAModel.Convert(source.At(crop.Min.X+x, crop.Min.Y+y)).(color.NRGBA)
			if isTrayMarkPixel(pixel) {
				mark.SetNRGBA(x, y, pixel)
			}
		}
	}

	return trayIconVariants{
		normal:         encodeTrayIcon(mark),
		unread:         trayIconWithUnreadBadge(mark),
		darkMode:       encodeTrayIcon(mark),
		darkModeUnread: trayIconWithUnreadBadge(mark),
	}, nil
}

func isTrayMarkPixel(pixel color.NRGBA) bool {
	return pixel.A > 0 && pixel.R > 150 && pixel.G > 60 &&
		int(pixel.R) > int(pixel.G) && int(pixel.G) > int(pixel.B)*2
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
	centerX := bounds.Min.X + bounds.Dx()*27/32
	centerY := bounds.Min.Y + bounds.Dy()*11/64
	radius := min(bounds.Dx(), bounds.Dy()) * 9 / 128
	for y := centerY - radius; y <= centerY+radius; y++ {
		for x := centerX - radius; x <= centerX+radius; x++ {
			dx, dy := x-centerX, y-centerY
			if dx*dx+dy*dy <= radius*radius {
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
