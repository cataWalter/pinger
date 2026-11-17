package matrix

import "testing"

func TestVoiceNoteMIMEType(t *testing.T) {
	tests := []struct {
		name     string
		sniffed  string
		filename string
		want     string
		wantErr  bool
	}{
		{name: "sniffed audio", sniffed: "audio/wave", filename: "voice.wav", want: "audio/wave"},
		{name: "M4A by extension", sniffed: "application/octet-stream", filename: "voice-note.m4a", want: "audio/mp4"},
		{name: "Ogg container", sniffed: "application/ogg", filename: "voice.ogg", want: "audio/ogg"},
		{name: "upper-case extension", sniffed: "application/octet-stream", filename: "VOICE.M4A", want: "audio/mp4"},
		{name: "image is not a voice note", sniffed: "image/png", filename: "voice.m4a", wantErr: true},
		{name: "unknown extension", sniffed: "application/octet-stream", filename: "voice.bin", wantErr: true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := voiceNoteMIMEType(test.sniffed, test.filename)
			if (err != nil) != test.wantErr {
				t.Fatalf("error = %v, wantErr %t", err, test.wantErr)
			}
			if got != test.want {
				t.Fatalf("MIME type = %q, want %q", got, test.want)
			}
		})
	}
}
