package matrix

import (
	"container/list"
	"context"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"maunium.net/go/mautrix"
)

const (
	maxPreviewURLLength      = 2048
	maxPreviewTitleLength    = 300
	maxPreviewDescLength     = 600
	maxPreviewSiteNameLength = 100
	maxPreviewImageDimension = 10000
	urlPreviewCacheSize      = 256
	urlPreviewTTL            = time.Hour
	urlPreviewMissTTL        = 5 * time.Minute
	urlPreviewTimeout        = 15 * time.Second
)

// LinkPreview is a sanitized OpenGraph summary fetched by the homeserver.
type LinkPreview struct {
	URL         string
	Title       string
	Description string
	SiteName    string
	Image       string
	ImageWidth  int
	ImageHeight int
}

type urlPreviewEntry struct {
	key     string
	preview *LinkPreview
	expires time.Time
}

// urlPreviewCache is a bounded LRU; nil previews record misses so they are not refetched.
type urlPreviewCache struct {
	mu      sync.Mutex
	entries map[string]*list.Element
	order   list.List
}

func (cache *urlPreviewCache) get(key string, now time.Time) (*LinkPreview, bool) {
	cache.mu.Lock()
	defer cache.mu.Unlock()
	element, ok := cache.entries[key]
	if !ok {
		return nil, false
	}
	entry := element.Value.(*urlPreviewEntry)
	if !now.Before(entry.expires) {
		cache.order.Remove(element)
		delete(cache.entries, key)
		return nil, false
	}
	cache.order.MoveToFront(element)
	return entry.preview, true
}

func (cache *urlPreviewCache) put(key string, preview *LinkPreview, expires time.Time) {
	cache.mu.Lock()
	defer cache.mu.Unlock()
	if cache.entries == nil {
		cache.entries = make(map[string]*list.Element)
	}
	if element, ok := cache.entries[key]; ok {
		element.Value = &urlPreviewEntry{key: key, preview: preview, expires: expires}
		cache.order.MoveToFront(element)
		return
	}
	cache.entries[key] = cache.order.PushFront(&urlPreviewEntry{key: key, preview: preview, expires: expires})
	for cache.order.Len() > urlPreviewCacheSize {
		oldest := cache.order.Back()
		cache.order.Remove(oldest)
		delete(cache.entries, oldest.Value.(*urlPreviewEntry).key)
	}
}

func normalizePreviewURL(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" || len(raw) > maxPreviewURLLength {
		return "", errors.New("invalid link")
	}
	parsed, err := url.Parse(raw)
	if err != nil {
		return "", errors.New("invalid link")
	}
	parsed.Scheme = strings.ToLower(parsed.Scheme)
	if (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Hostname() == "" || parsed.User != nil {
		return "", errors.New("only http and https links can be previewed")
	}
	parsed.Fragment = ""
	parsed.RawFragment = ""
	return parsed.String(), nil
}

func truncateRunes(value string, limit int) string {
	value = strings.Join(strings.Fields(value), " ")
	if utf8.RuneCountInString(value) <= limit {
		return value
	}
	runes := []rune(value)
	return strings.TrimSpace(string(runes[:limit-1])) + "…"
}

func clampDimension(value int) int {
	if value <= 0 || value > maxPreviewImageDimension {
		return 0
	}
	return value
}

func sanitizeLinkPreview(requestURL string, response *mautrix.RespPreviewURL) *LinkPreview {
	if response == nil {
		return nil
	}
	preview := &LinkPreview{
		// The requested URL is shown and opened; og:url could point to a different site.
		URL:         requestURL,
		Title:       truncateRunes(response.Title, maxPreviewTitleLength),
		Description: truncateRunes(response.Description, maxPreviewDescLength),
		SiteName:    truncateRunes(response.SiteName, maxPreviewSiteNameLength),
	}
	if preview.Title == "" && preview.Description == "" {
		return nil
	}
	if image, err := response.ImageURL.Parse(); err == nil && image.IsValid() {
		preview.Image = image.String()
		preview.ImageWidth = clampDimension(int(response.ImageWidth))
		preview.ImageHeight = clampDimension(int(response.ImageHeight))
	}
	return preview
}

func fetchURLPreview(ctx context.Context, cli *mautrix.Client, cache *urlPreviewCache, rawURL string, now time.Time) (*LinkPreview, error) {
	previewURL, err := normalizePreviewURL(rawURL)
	if err != nil {
		return nil, err
	}
	if preview, ok := cache.get(previewURL, now); ok {
		return preview, nil
	}
	ctx, cancel := context.WithTimeout(ctx, urlPreviewTimeout)
	defer cancel()
	response, err := cli.GetURLPreview(ctx, previewURL)
	if err != nil {
		var httpErr mautrix.HTTPError
		if errors.As(err, &httpErr) && httpErr.Response != nil {
			// The homeserver answered (no preview, disabled, rate limited); remember the miss briefly.
			cache.put(previewURL, nil, now.Add(urlPreviewMissTTL))
			return nil, nil
		}
		return nil, fmt.Errorf("fetch link preview: %w", err)
	}
	preview := sanitizeLinkPreview(previewURL, response)
	ttl := urlPreviewTTL
	if preview == nil {
		ttl = urlPreviewMissTTL
	}
	cache.put(previewURL, preview, now.Add(ttl))
	return preview, nil
}

// URLPreview asks the homeserver for a link preview. It returns nil when none is available.
func (c *Client) URLPreview(ctx context.Context, rawURL string) (*LinkPreview, error) {
	ctx, finish, err := c.beginOperation(ctx)
	if err != nil {
		return nil, err
	}
	defer finish()
	return fetchURLPreview(ctx, c.engine.Client, &c.urlPreviews, rawURL, time.Now())
}
