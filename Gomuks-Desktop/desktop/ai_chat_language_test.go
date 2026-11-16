package desktop

import (
	sharedpreferences "mychat/preferences"
	"testing"
)

func TestParseChatLanguage(t *testing.T) {
	names := sharedpreferences.LanguageLookupFromPreferences(nil)
	tests := []struct {
		name     string
		response string
		want     string
		wantErr  bool
	}{
		{name: "supported code", response: `{"language":"es"}`, want: "es"},
		{name: "case and spaces are normalized", response: `{"language":" ES "}`, want: "es"},
		{name: "unsupported code is ignored", response: `{"language":"xx"}`, want: ""},
		{name: "blank language is ignored", response: `{"language":""}`, want: ""},
		{name: "invalid JSON is an error", response: `not json`, wantErr: true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := parseChatLanguage(test.response, names)
			if (err != nil) != test.wantErr {
				t.Fatalf("parseChatLanguage() error = %v, wantErr %v", err, test.wantErr)
			}
			if got != test.want {
				t.Fatalf("parseChatLanguage() = %q, want %q", got, test.want)
			}
		})
	}
}
