package matrix

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"maunium.net/go/mautrix"
	"maunium.net/go/mautrix/id"
)

func TestNormalizePreviewURL(t *testing.T) {
	tests := []struct {
		raw     string
		want    string
		wantErr bool
	}{
		{raw: " https://Example.org/a?b=c#frag ", want: "https://Example.org/a?b=c"},
		{raw: "HTTP://example.org", want: "http://example.org"},
		{raw: "ftp://example.org/file", wantErr: true},
		{raw: "javascript:alert(1)", wantErr: true},
		{raw: "https://user:secret@example.org/", wantErr: true},
		{raw: "https:///path-only", wantErr: true},
		{raw: "", wantErr: true},
		{raw: "https://example.org/" + strings.Repeat("a", maxPreviewURLLength), wantErr: true},
	}
	for _, test := range tests {
		got, err := normalizePreviewURL(test.raw)
		if (err != nil) != test.wantErr || got != test.want {
			t.Errorf("normalizePreviewURL(%q) = %q, %v; want %q, error %t", test.raw, got, err, test.want, test.wantErr)
		}
	}
}

func TestSanitizeLinkPreview(t *testing.T) {
	response := &mautrix.RespPreviewURL{
		CanonicalURL: "https://phishing.example/",
		Title:        "  A   title\n with spacing ",
		Description:  strings.Repeat("d", maxPreviewDescLength+10),
		SiteName:     "Example",
		ImageURL:     "mxc://example.org/image",
		ImageWidth:   640,
		ImageHeight:  maxPreviewImageDimension + 1,
	}
	preview := sanitizeLinkPreview("https://example.org/post", response)
	if preview == nil {
		t.Fatal("sanitizeLinkPreview() = nil")
	}
	if preview.URL != "https://example.org/post" || preview.Title != "A title with spacing" || preview.SiteName != "Example" {
		t.Fatalf("preview = %+v", preview)
	}
	if got := len([]rune(preview.Description)); got != maxPreviewDescLength || !strings.HasSuffix(preview.Description, "…") {
		t.Fatalf("description length = %d, want truncated to %d", got, maxPreviewDescLength)
	}
	if preview.Image != "mxc://example.org/image" || preview.ImageWidth != 640 || preview.ImageHeight != 0 {
		t.Fatalf("image = %q %dx%d", preview.Image, preview.ImageWidth, preview.ImageHeight)
	}

	response.ImageURL = "https://example.org/image.png"
	if preview = sanitizeLinkPreview("https://example.org/post", response); preview.Image != "" {
		t.Fatalf("non-mxc image kept: %q", preview.Image)
	}
	if sanitizeLinkPreview("https://example.org/", &mautrix.RespPreviewURL{SiteName: "Only a site"}) != nil {
		t.Fatal("preview without title or description should be dropped")
	}
}

func TestURLPreviewCacheEvictsLeastRecentlyUsed(t *testing.T) {
	var cache urlPreviewCache
	now := time.Unix(1000, 0)
	for i := range urlPreviewCacheSize {
		cache.put(fmt.Sprintf("https://example.org/%d", i), &LinkPreview{Title: "t"}, now.Add(time.Hour))
	}
	if _, ok := cache.get("https://example.org/0", now); !ok {
		t.Fatal("first entry missing before eviction")
	}
	cache.put("https://example.org/new", nil, now.Add(time.Hour))
	if _, ok := cache.get("https://example.org/0", now); !ok {
		t.Fatal("recently used entry was evicted")
	}
	if _, ok := cache.get("https://example.org/1", now); ok {
		t.Fatal("least recently used entry was kept")
	}
	if preview, ok := cache.get("https://example.org/new", now); !ok || preview != nil {
		t.Fatalf("cached miss = %v, %t", preview, ok)
	}
	if _, ok := cache.get("https://example.org/new", now.Add(2*time.Hour)); ok {
		t.Fatal("expired entry returned")
	}
}

func TestFetchURLPreviewCachesHitsAndMisses(t *testing.T) {
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		if r.URL.Path != "/_matrix/client/v1/media/preview_url" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Query().Get("url") {
		case "https://example.org/post":
			_, _ = w.Write([]byte(`{"og:title":"Post","og:description":"About it","og:image":"mxc://example.org/img","og:image:width":"320"}`))
		default:
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte(`{"errcode":"M_NOT_FOUND","error":"no preview"}`))
		}
	}))
	defer server.Close()
	cli, err := mautrix.NewClient(server.URL, id.UserID("@me:example.org"), "token")
	if err != nil {
		t.Fatal(err)
	}
	var cache urlPreviewCache
	now := time.Unix(1000, 0)

	for range 2 {
		preview, err := fetchURLPreview(context.Background(), cli, &cache, "https://example.org/post#section", now)
		if err != nil || preview == nil || preview.Title != "Post" || preview.ImageWidth != 320 {
			t.Fatalf("fetchURLPreview() = %+v, %v", preview, err)
		}
	}
	if got := requests.Load(); got != 1 {
		t.Fatalf("requests after cached hit = %d, want 1", got)
	}

	for range 2 {
		preview, err := fetchURLPreview(context.Background(), cli, &cache, "https://example.org/missing", now)
		if err != nil || preview != nil {
			t.Fatalf("missing preview = %+v, %v", preview, err)
		}
	}
	if got := requests.Load(); got != 2 {
		t.Fatalf("requests after cached miss = %d, want 2", got)
	}
	if _, err = fetchURLPreview(context.Background(), cli, &cache, "file:///etc/passwd", now); err == nil {
		t.Fatal("non-http link was sent to the homeserver")
	}
	if got := requests.Load(); got != 2 {
		t.Fatalf("requests after rejected link = %d, want 2", got)
	}
}
