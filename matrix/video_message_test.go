package matrix

import (
	"context"
	"testing"
	"time"
)

func TestVideoMessageMIMEType(t *testing.T) {
	tests := []struct {
		name     string
		sniffed  string
		filename string
		want     string
		wantErr  bool
	}{
		{name: "sniffed WebM", sniffed: "video/webm", filename: "clip.webm", want: "video/webm"},
		{name: "sniffed MP4", sniffed: "video/mp4", filename: "clip.mp4", want: "video/mp4"},
		{name: "isom MP4 by extension", sniffed: "application/octet-stream", filename: "video-message.mp4", want: "video/mp4"},
		{name: "upper-case extension", sniffed: "application/octet-stream", filename: "CLIP.MP4", want: "video/mp4"},
		{name: "unsupported container", sniffed: "application/octet-stream", filename: "clip.mov", wantErr: true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := videoMessageMIMEType(test.sniffed, test.filename)
			if (err != nil) != test.wantErr {
				t.Fatalf("error = %v, wantErr %t", err, test.wantErr)
			}
			if got != test.want {
				t.Fatalf("MIME type = %q, want %q", got, test.want)
			}
		})
	}
}

func TestSendVideoMessageRejectsInvalidDuration(t *testing.T) {
	client := &Client{}
	for _, duration := range []int64{0, -1, int64((3*time.Minute)/time.Millisecond) + 1} {
		if err := client.SendVideoMessage(context.Background(), "!room:example.org", "clip.webm", []byte("video"), duration); err == nil {
			t.Fatalf("duration %d was accepted", duration)
		}
	}
}
