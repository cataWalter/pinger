package desktop

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

const testLocalAIChatPNG = "iVBORw0KGgo="

func TestLocalAIChatEncodesOllamaImagesAsBase64(t *testing.T) {
	messages := []AIMessage{{Role: "user", Content: "What is this?", Images: []AIImage{{MediaType: "image/png", Data: testLocalAIChatPNG}}}}
	body, requestPath, err := encodeAICompletionRequest(GhostwriterProviderOllama, "llava", messages, aiCompletionOptions{Chat: true}, false)
	if err != nil {
		t.Fatalf("encodeAICompletionRequest() error = %v", err)
	}
	if requestPath != "/api/chat" {
		t.Fatalf("path = %q", requestPath)
	}
	var request struct {
		Messages []struct {
			Content string   `json:"content"`
			Images  []string `json:"images"`
		} `json:"messages"`
	}
	if err := json.Unmarshal(body, &request); err != nil {
		t.Fatal(err)
	}
	if len(request.Messages) != 1 || request.Messages[0].Content != "What is this?" || len(request.Messages[0].Images) != 1 || request.Messages[0].Images[0] != testLocalAIChatPNG {
		t.Fatalf("ollama messages = %+v", request.Messages)
	}
}

func TestLocalAIChatEncodesOpenAIImagesAsDataURLs(t *testing.T) {
	messages := []AIMessage{
		{Role: "user", Content: "Describe it", Images: []AIImage{{MediaType: "image/png", Data: testLocalAIChatPNG}}},
		{Role: "assistant", Content: "A square."},
		{Role: "user", Content: "Thanks"},
	}
	body, requestPath, err := encodeAICompletionRequest(GhostwriterProviderOpenAICompatible, "local-model", messages, aiCompletionOptions{Chat: true}, false)
	if err != nil {
		t.Fatalf("encodeAICompletionRequest() error = %v", err)
	}
	if requestPath != "/v1/chat/completions" {
		t.Fatalf("path = %q", requestPath)
	}
	var request struct {
		Messages []struct {
			Role    string `json:"role"`
			Content any    `json:"content"`
		} `json:"messages"`
	}
	if err := json.Unmarshal(body, &request); err != nil {
		t.Fatal(err)
	}
	parts, ok := request.Messages[0].Content.([]any)
	if !ok || len(parts) != 2 {
		t.Fatalf("content = %#v, want two content parts", request.Messages[0].Content)
	}
	imagePart, ok := parts[1].(map[string]any)
	if !ok || imagePart["type"] != "image_url" {
		t.Fatalf("image part = %#v", parts[1])
	}
	imageURL, ok := imagePart["image_url"].(map[string]any)
	if !ok || imageURL["url"] != "data:image/png;base64,"+testLocalAIChatPNG {
		t.Fatalf("image_url = %#v", imagePart["image_url"])
	}
	if request.Messages[1].Content != "A square." || request.Messages[2].Content != "Thanks" {
		t.Fatalf("text-only messages = %+v", request.Messages)
	}
}

func TestLocalAIChatRejectsImagesOutsideChatRequests(t *testing.T) {
	messages := []AIMessage{{Role: "user", Content: "Describe", Images: []AIImage{{MediaType: "image/png", Data: testLocalAIChatPNG}}}}
	for _, provider := range []GhostwriterProvider{GhostwriterProviderOllama, GhostwriterProviderOpenAICompatible} {
		if _, _, err := encodeAICompletionRequest(provider, "model", messages, aiCompletionOptions{Chat: false}, false); err == nil {
			t.Errorf("provider %v accepted images for a non-chat request", provider)
		}
	}
}

func TestValidateLocalAIChatImageRules(t *testing.T) {
	if size, err := validateLocalAIChatImage(AIImage{MediaType: "image/png", Data: testLocalAIChatPNG}); err != nil || size != 8 {
		t.Fatalf("valid image size = %d, err = %v", size, err)
	}
	oversized := strings.Repeat("A", 4*((localAIChatImageBytes/3)+2))
	for _, image := range []AIImage{
		{MediaType: "image/svg+xml", Data: testLocalAIChatPNG},
		{MediaType: "image/bmp", Data: testLocalAIChatPNG},
		{MediaType: "image/png", Data: "not base64!"},
		{MediaType: "image/png", Data: oversized},
	} {
		if _, err := validateLocalAIChatImage(image); err == nil {
			t.Errorf("validateLocalAIChatImage(%q) accepted invalid image", image.MediaType)
		}
	}
}

func TestValidateLocalAIChatMessagesImageRules(t *testing.T) {
	image := AIImage{MediaType: "image/png", Data: testLocalAIChatPNG}
	imageOnly := []AIMessage{{Role: "user", Images: []AIImage{image}}}
	if err := validateLocalAIChatMessages(imageOnly); err != nil {
		t.Fatalf("image-only user message rejected: %v", err)
	}
	tooMany := make([]AIImage, localAIChatImageLimit+1)
	for index := range tooMany {
		tooMany[index] = image
	}
	for _, messages := range [][]AIMessage{
		{{Role: "user", Content: "Hi", Images: tooMany}},
		{{Role: "user", Content: "Hi"}, {Role: "assistant", Content: "Reply", Images: []AIImage{image}}, {Role: "user", Content: "Next"}},
		{{Role: "user", Content: "   ", Images: nil}},
	} {
		if err := validateLocalAIChatMessages(messages); err == nil {
			t.Errorf("validateLocalAIChatMessages(%+v) accepted invalid images", messages)
		}
	}
}

func TestAIRunRegistryCancelStopsRunningRequest(t *testing.T) {
	var runs aiRunRegistry
	ctx, release := runs.begin(context.Background(), "request-1")
	defer release()
	if !runs.cancel("request-1") {
		t.Fatal("cancel did not find the running request")
	}
	select {
	case <-ctx.Done():
	default:
		t.Fatal("request context was not cancelled")
	}
	if runs.cancel("missing") {
		t.Fatal("cancel reported a missing request as running")
	}
}

func TestAIRunRegistryReleaseUnregistersRequest(t *testing.T) {
	var runs aiRunRegistry
	_, release := runs.begin(context.Background(), "request-2")
	release()
	if runs.cancel("request-2") {
		t.Fatal("released request is still cancellable")
	}
}

func TestAICancelReportsMissingRequest(t *testing.T) {
	service := &AppService{}
	if service.AICancel("never-started") {
		t.Fatal("AICancel reported a request that never started")
	}
}
