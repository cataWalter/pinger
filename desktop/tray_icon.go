package desktop

import (
	"bytes"
	_ "embed"
	"image"
	"image/color"
	"image/png"
	"math"
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
	mark := color.NRGBA{R: 228, G: 184, B: 78, A: 255}
	badge := color.NRGBA{R: 224, G: 59, B: 67, A: 255}
	normal := renderPingTrayIcon(64, mark, nil)
	unread := renderPingTrayIcon(64, mark, &badge)
	return trayIconVariants{normal: normal, unread: unread, darkMode: normal, darkModeUnread: unread}, nil
}

func macOSTrayIcons() trayIconVariants {
	mark := color.NRGBA{A: 255}
	normal := renderPingTrayIcon(44, mark, nil)
	unread := renderPingTrayIcon(44, mark, &mark)
	return trayIconVariants{normal: normal, unread: unread, darkMode: normal, darkModeUnread: unread}
}

func renderPingTrayIcon(size int, mark color.NRGBA, badge *color.NRGBA) []byte {
	const samples = 4
	icon := image.NewNRGBA(image.Rect(0, 0, size, size))
	scale := 44 / float64(size)
	for y := 0; y < size; y++ {
		for x := 0; x < size; x++ {
			markCoverage, badgeCoverage := 0, 0
			for sampleY := 0; sampleY < samples; sampleY++ {
				for sampleX := 0; sampleX < samples; sampleX++ {
					pointX := (float64(x) + (float64(sampleX)+0.5)/samples) * scale
					pointY := (float64(y) + (float64(sampleY)+0.5)/samples) * scale
					if badge != nil {
						badgeDistance := math.Hypot(pointX-35, pointY-9)
						if badgeDistance < 6 {
							if badgeDistance <= 4 {
								badgeCoverage++
							}
							continue
						}
					}
					distance := math.Hypot(pointX-22, pointY-22)
					if distance <= 2.5 || (distance >= 8 && distance <= 10) || (distance >= 15 && distance <= 17) {
						markCoverage++
					}
				}
			}
			tint := mark
			if badgeCoverage > 0 {
				tint = *badge
			}
			tint.A = uint8((markCoverage + badgeCoverage) * 255 / (samples * samples))
			icon.SetNRGBA(x, y, tint)
		}
	}
	return encodeTrayIcon(icon)
}

func trayIcons() trayIconVariants {
	light := color.NRGBA{A: 255}
	dark := color.NRGBA{R: 245, G: 247, B: 245, A: 255}
	badge := color.NRGBA{R: 224, G: 59, B: 67, A: 255}
	return trayIconVariants{
		normal:         renderPingTrayIcon(64, light, nil),
		unread:         renderPingTrayIcon(64, light, &badge),
		darkMode:       renderPingTrayIcon(64, dark, nil),
		darkModeUnread: renderPingTrayIcon(64, dark, &badge),
	}
}

func trayIconUsesDarkVariant(_ string, systemDark bool) bool {
	return systemDark
}

func isTrayMarkPixel(pixel color.NRGBA) bool {
	return pixel.A > 0 && pixel.R > pixel.G && pixel.G > 0 && int(pixel.G)*2 >= int(pixel.R) && int(pixel.B)*2 < int(pixel.G)
}

func encodeTrayIcon(icon image.Image) []byte {
	var output bytes.Buffer
	if err := png.Encode(&output, icon); err != nil {
		return baseTrayIcon
	}
	return output.Bytes()
}
