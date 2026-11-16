package matrix

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/rs/zerolog"
	"io"
	"maunium.net/go/mautrix"
	"net/http"
	"net/url"
	"strings"
)

func (m *SlidingSyncManager) roundTrip(request *http.Request, base http.RoundTripper) (*http.Response, error) {
	if m.slidingUnsupported.Load() {
		return m.legacySync(request, base)
	}
	requestContext, cancel := context.WithCancelCause(request.Context())
	requestID := m.requestID.Add(1)
	m.requestMu.Lock()
	m.requestCancel = cancel
	m.requestMu.Unlock()
	defer func() {
		cancel(nil)
		m.requestMu.Lock()
		if m.requestID.Load() == requestID {
			m.requestCancel = nil
		}
		m.requestMu.Unlock()
	}()

	pos := request.URL.Query().Get("since")
	for attempt := 0; attempt < 2; attempt++ {
		slidingRequest, err := m.newRequest(requestContext, request, base, pos)
		if err != nil {
			return nil, err
		}
		if requestContext.Err() != nil {
			break
		}
		response, err := base.RoundTrip(slidingRequest)
		if err != nil {
			if context.Cause(requestContext) == errSlidingSyncRequestChanged {
				return m.emptySyncResponse(request, pos), nil
			}
			if !errors.Is(err, context.Canceled) {
				m.log.Error().Err(err).Str("endpoint", slidingRequest.URL.Path).Msg("Sliding Sync transport failed")
			}
			return nil, err
		}
		if response.StatusCode >= http.StatusBadRequest {
			body, readErr := readSlidingSyncBody(response.Body)
			_ = response.Body.Close()
			unsupported := unsupportedSlidingSyncEndpoint(response.StatusCode, body)
			logLevel := zerolog.ErrorLevel
			if unsupported {
				logLevel = zerolog.WarnLevel
			}
			m.log.WithLevel(logLevel).
				Int("status_code", response.StatusCode).
				Str("endpoint", slidingRequest.URL.Path).
				Str("response_body", string(body[:min(len(body), slidingSyncLogBodyLimit)])).
				Bool("response_body_truncated", len(body) > slidingSyncLogBodyLimit).
				Bool("legacy_fallback", unsupported).
				Err(readErr).
				Msg("Sliding Sync endpoint rejected sync request")
			if unsupported {
				m.slidingUnsupported.Store(true)
				return m.legacySync(request, base)
			}
			if readErr != nil {
				return slidingSyncErrorResponse(request, http.StatusBadGateway, readErr.Error()), nil
			}
			if attempt == 0 && pos != "" && invalidSlidingSyncPosition(response.StatusCode, body) {
				m.positionReset.Store(true)
				m.state.ResetPosition()
				pos = ""
				continue
			}
			response.Body = io.NopCloser(bytes.NewReader(body))
			response.ContentLength = int64(len(body))
			response.Request = request
			return response, nil
		}
		return m.translateResponse(request, response)
	}
	if context.Cause(requestContext) == errSlidingSyncRequestChanged {
		return m.emptySyncResponse(request, pos), nil
	}
	if err := requestContext.Err(); err != nil {
		return nil, err
	}
	return slidingSyncErrorResponse(request, http.StatusBadGateway, "Sliding Sync request did not complete"), nil
}

func (m *SlidingSyncManager) newRequest(ctx context.Context, original *http.Request, _ http.RoundTripper, pos string) (*http.Request, error) {
	timelineLimit := m.config.TimelineLimit
	requiredState := m.config.ListRequiredState
	if pos == "" {
		timelineLimit = m.config.InitialTimelineLimit
	}
	slidingRequest := m.state.Request(m.connID, int(m.config.RequestTimeout.Milliseconds()), timelineLimit)
	slidingRequest.Pos = pos
	for listKey, list := range slidingRequest.Lists {
		list.RequiredState = cloneSlidingSyncState(requiredState)
		slidingRequest.Lists[listKey] = list
	}
	for roomID, subscription := range slidingRequest.RoomSubscriptions {
		if subscription.RequiredState == nil {
			subscription.RequiredState = cloneSlidingSyncState(m.config.RoomRequiredState)
		}
		if subscription.TimelineLimit <= 0 {
			subscription.TimelineLimit = m.config.RoomTimelineLimit
		}
		slidingRequest.RoomSubscriptions[roomID] = subscription
	}
	body, err := json.Marshal(slidingRequest)
	if err != nil {
		return nil, fmt.Errorf("encode Sliding Sync request: %w", err)
	}
	endpoint, err := url.Parse(m.endpoint)
	if err != nil {
		return nil, fmt.Errorf("parse Sliding Sync endpoint: %w", err)
	}
	newRequest, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint.String(), bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("create Sliding Sync request: %w", err)
	}
	newRequest.Header = original.Header.Clone()
	newRequest.Header.Set("Content-Type", "application/json")
	newRequest.Header.Set("Accept", "application/json")
	newRequest.ContentLength = int64(len(body))
	return newRequest, nil
}

func (m *SlidingSyncManager) translateResponse(request *http.Request, response *http.Response) (*http.Response, error) {
	body, err := readSlidingSyncBody(response.Body)
	_ = response.Body.Close()
	if err != nil {
		return slidingSyncErrorResponse(request, http.StatusBadGateway, err.Error()), nil
	}
	var slidingResponse SlidingSyncResponse
	if err = json.Unmarshal(body, &slidingResponse); err != nil {
		return slidingSyncErrorResponse(request, http.StatusBadGateway, "decode Sliding Sync response: "+err.Error()), nil
	}
	if slidingResponse.Pos == "" {
		return slidingSyncErrorResponse(request, http.StatusBadGateway, "Sliding Sync response has no position token"), nil
	}
	syncBody, err := json.Marshal(slidingResponse.ToSyncResponse())
	if err != nil {
		return slidingSyncErrorResponse(request, http.StatusBadGateway, "encode adapted sync response: "+err.Error()), nil
	}
	m.state.Apply(slidingResponse)
	return slidingSyncHTTPResponse(request, response.Header, syncBody), nil
}

func readSlidingSyncBody(body io.Reader) ([]byte, error) {
	data, err := io.ReadAll(io.LimitReader(body, slidingSyncResponseLimit+1))
	if err != nil {
		return nil, fmt.Errorf("read Sliding Sync response: %w", err)
	}
	if len(data) > slidingSyncResponseLimit {
		return nil, fmt.Errorf("Sliding Sync response exceeds %d bytes", slidingSyncResponseLimit)
	}
	return data, nil
}

func unsupportedSlidingSyncEndpoint(statusCode int, body []byte) bool {
	if statusCode == http.StatusNotFound || statusCode == http.StatusMethodNotAllowed || statusCode == http.StatusNotImplemented {
		return true
	}
	if statusCode != http.StatusBadRequest {
		return false
	}
	var apiError struct {
		ErrCode string `json:"errcode"`
	}
	if json.Unmarshal(body, &apiError) != nil {
		return false
	}
	code := strings.ToUpper(apiError.ErrCode)
	return code == "M_UNRECOGNIZED" || code == "M_NOT_FOUND"
}

func invalidSlidingSyncPosition(statusCode int, body []byte) bool {
	if statusCode != http.StatusBadRequest && statusCode != http.StatusConflict && statusCode != http.StatusGone {
		return false
	}
	var apiError struct {
		ErrCode string `json:"errcode"`
		Error   string `json:"error"`
	}
	if json.Unmarshal(body, &apiError) != nil {
		return false
	}
	code := strings.ToUpper(apiError.ErrCode)
	description := strings.ToLower(apiError.Error)
	if code == "M_UNKNOWN_POS" || code == "M_INVALID_POS" {
		return true
	}
	return (code == "M_UNKNOWN" || code == "M_INVALID_PARAM") &&
		(strings.Contains(description, "position") || strings.Contains(description, "pos ") || strings.Contains(description, "token"))
}

// legacySync forwards a standard /sync request. A stored token can come from Sliding Sync,
// which standard sync rejects, so a rejected token restarts from an initial sync.
func (m *SlidingSyncManager) legacySync(request *http.Request, base http.RoundTripper) (*http.Response, error) {
	response, err := base.RoundTrip(request)
	if err != nil || response.StatusCode != http.StatusBadRequest || request.URL.Query().Get("since") == "" {
		return response, err
	}
	_ = response.Body.Close()
	fresh := request.Clone(request.Context())
	query := fresh.URL.Query()
	query.Del("since")
	fresh.URL.RawQuery = query.Encode()
	m.positionReset.Store(true)
	return base.RoundTrip(fresh)
}

func (m *SlidingSyncManager) emptySyncResponse(request *http.Request, pos string) *http.Response {
	body, _ := json.Marshal(&mautrix.RespSync{NextBatch: pos})
	return slidingSyncHTTPResponse(request, make(http.Header), body)
}

func slidingSyncHTTPResponse(request *http.Request, headers http.Header, body []byte) *http.Response {
	responseHeaders := headers.Clone()
	responseHeaders.Del("Content-Encoding")
	responseHeaders.Del("Content-Length")
	responseHeaders.Set("Content-Type", "application/json")
	return &http.Response{
		Status:        "200 OK",
		StatusCode:    http.StatusOK,
		Proto:         "HTTP/1.1",
		ProtoMajor:    1,
		ProtoMinor:    1,
		Header:        responseHeaders,
		Body:          io.NopCloser(bytes.NewReader(body)),
		ContentLength: int64(len(body)),
		Request:       request,
	}
}

func slidingSyncErrorResponse(request *http.Request, statusCode int, message string) *http.Response {
	body, _ := json.Marshal(map[string]string{"errcode": "M_UNKNOWN", "error": message})
	return &http.Response{
		Status:        fmt.Sprintf("%d %s", statusCode, http.StatusText(statusCode)),
		StatusCode:    statusCode,
		Proto:         "HTTP/1.1",
		ProtoMajor:    1,
		ProtoMinor:    1,
		Header:        http.Header{"Content-Type": []string{"application/json"}},
		Body:          io.NopCloser(bytes.NewReader(body)),
		ContentLength: int64(len(body)),
		Request:       request,
	}
}

type slidingSyncSyncer struct {
	inner   mautrix.Syncer
	manager *SlidingSyncManager
}

func (syncer slidingSyncSyncer) ProcessResponse(ctx context.Context, response *mautrix.RespSync, since string) error {
	if syncer.manager.positionReset.Swap(false) {
		since = ""
	}
	err := syncer.inner.ProcessResponse(ctx, response, since)
	if err == nil {
		syncer.manager.syncFailures.Store(0)
	}
	return err
}
