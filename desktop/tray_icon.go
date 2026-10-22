package desktop

import (
	"bytes"
	_ "embed"
	"fmt"
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

func linuxTrayIcons() (trayIconVariants, error) {
	source, err := png.Decode(bytes.NewReader(baseTrayIcon))
	if err != nil {
		return trayIconVariants{}, fmt.Errorf("decode base tray icon: %w", err)
	}
	bounds := source.Bounds()
	markBounds := image.Rectangle{Min: bounds.Max, Max: bounds.Min}
	for y := bounds.Min.Y; y < bounds.Max.Y; y++ {
		for x := bounds.Min.X; x < bounds.Max.X; x++ {
			pixel := color.NRGBAModel.Convert(source.At(x, y)).(color.NRGBA)
			if !isTrayMarkPixel(pixel) {
				continue
			}
			if x < markBounds.Min.X {
				markBounds.Min.X = x
			}
			if y < markBounds.Min.Y {
				markBounds.Min.Y = y
			}
			if x+1 > markBounds.Max.X {
				markBounds.Max.X = x + 1
			}
			if y+1 > markBounds.Max.Y {
				markBounds.Max.Y = y + 1
			}
		}
	}
	if markBounds.Empty() {
		return trayIconVariants{}, fmt.Errorf("base tray icon has no gold mark")
	}

	const iconSize = 64
	const padding = 10
	contentSize := iconSize - padding*2
	markWidth, markHeight := contentSize, contentSize
	if markBounds.Dx() > markBounds.Dy() {
		markHeight = max(1, markBounds.Dy()*contentSize/markBounds.Dx())
	} else {
		markWidth = max(1, markBounds.Dx()*contentSize/markBounds.Dy())
	}
	icon := image.NewNRGBA(image.Rect(0, 0, iconSize, iconSize))
	offsetX, offsetY := (iconSize-markWidth)/2, (iconSize-markHeight)/2
	for y := 0; y < markHeight; y++ {
		for x := 0; x < markWidth; x++ {
			sourceX := markBounds.Min.X + x*markBounds.Dx()/markWidth
			sourceY := markBounds.Min.Y + y*markBounds.Dy()/markHeight
			pixel := color.NRGBAModel.Convert(source.At(sourceX, sourceY)).(color.NRGBA)
			if isTrayMarkPixel(pixel) {
				icon.SetNRGBA(offsetX+x, offsetY+y, pixel)
			}
		}
	}
	normal := encodeTrayIcon(icon)
	unread := trayIconWithUnreadBadge(icon)
	return trayIconVariants{normal: normal, unread: unread, darkMode: normal, darkModeUnread: unread}, nil
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
	centerX := bounds.Min.X + bounds.Dx()*27/32
	centerY := bounds.Min.Y + bounds.Dy()*11/64
	radius := min(bounds.Dx(), bounds.Dy()) * 18 / 256
	if radius < 3 {
		radius = 3
	}
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
