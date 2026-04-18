package storage

import (
	"errors"
	"strings"
	"testing"
)

type stubPublisher struct {
	provider           Provider
	uploadBytesCalls   int
	deleteObjectsCalls int
}

func (s *stubPublisher) Provider() Provider {
	return s.provider
}

func (s *stubPublisher) BaseURL() string {
	return "https://example.com"
}

func (s *stubPublisher) UploadFile(localPath, key, cacheControl string) error {
	return nil
}

func (s *stubPublisher) UploadBytes(data []byte, key, contentType, cacheControl string) error {
	s.uploadBytesCalls++
	return nil
}

func (s *stubPublisher) DeleteObject(key string) error {
	return nil
}

func (s *stubPublisher) DeleteObjects(keys []string) error {
	s.deleteObjectsCalls++
	return nil
}

func (s *stubPublisher) PublicURL(key string) string {
	return s.BaseURL() + "/" + strings.TrimLeft(key, "/")
}

func (s *stubPublisher) HeadObject(key string) error {
	return nil
}

func TestDefaultObjectLayoutKeys(t *testing.T) {
	layout := DefaultObjectLayout()

	if got := layout.ManifestKey(); got != "pages/photos-manifest.json" {
		t.Fatalf("unexpected manifest key: %s", got)
	}
	if got := layout.YearKey("2026"); got != "pages/photos/2026.json" {
		t.Fatalf("unexpected year key: %s", got)
	}
	if got := layout.OriginalKey("DSC_001.jpg"); got != "pages/originals/DSC_001.jpg" {
		t.Fatalf("unexpected original key: %s", got)
	}
	if got := layout.ThumbnailKey("DSC_001"); got != "pages/thumbnails/DSC_001.webp" {
		t.Fatalf("unexpected thumbnail key: %s", got)
	}
}

func TestResolveObjectLayoutRejectsMismatchedPrefixes(t *testing.T) {
	_, err := ResolveObjectLayout(
		&R2Config{
			BasePrefix:      "pages/",
			OriginalPrefix:  "originals/",
			ThumbnailPrefix: "thumbnails/",
		},
		&TOSConfig{
			BasePrefix:      "assets/",
			OriginalPrefix:  "originals/",
			ThumbnailPrefix: "thumbnails/",
		},
	)
	if err == nil {
		t.Fatal("expected mismatched layout error")
	}
}

func TestPublisherPublicURLs(t *testing.T) {
	r2Client := &R2Client{
		Config: R2Config{
			CDNUrl: "https://cdn.example.com",
		},
	}
	if got := r2Client.PublicURL("pages/photos-manifest.json"); got != "https://cdn.example.com/pages/photos-manifest.json" {
		t.Fatalf("unexpected r2 public url: %s", got)
	}

	tosClient := &TOSClient{
		Config: TOSConfig{
			PublicBaseURL: "https://photography.tos-cn-guangzhou.volces.com",
		},
	}
	if got := tosClient.PublicURL("pages/photos-manifest.json"); got != "https://photography.tos-cn-guangzhou.volces.com/pages/photos-manifest.json" {
		t.Fatalf("unexpected tos public url: %s", got)
	}
}

func TestUploadBytesToAllRequiresAllProviders(t *testing.T) {
	r2Publisher := &stubPublisher{provider: ProviderR2}
	registry := &PublisherRegistry{
		layout: DefaultObjectLayout(),
		byProvider: map[Provider]ObjectPublisher{
			ProviderR2: r2Publisher,
		},
		loadErrors: map[Provider]error{
			ProviderTOS: errors.New("missing required TOS configuration"),
		},
	}

	err := registry.UploadBytesToAll([]byte("manifest"), "pages/photos-manifest.json", "application/json", "")
	if err == nil {
		t.Fatal("expected upload to fail when a required provider is missing")
	}
	if !strings.Contains(err.Error(), "tos") {
		t.Fatalf("expected missing provider error to mention TOS, got %v", err)
	}
	if r2Publisher.uploadBytesCalls != 0 {
		t.Fatalf("expected fail-fast before partial upload, got %d upload calls", r2Publisher.uploadBytesCalls)
	}
}

func TestDeleteObjectsFromAllRequiresAllProviders(t *testing.T) {
	r2Publisher := &stubPublisher{provider: ProviderR2}
	registry := &PublisherRegistry{
		layout: DefaultObjectLayout(),
		byProvider: map[Provider]ObjectPublisher{
			ProviderR2: r2Publisher,
		},
		loadErrors: map[Provider]error{
			ProviderTOS: errors.New("missing required TOS configuration"),
		},
	}

	err := registry.DeleteObjectsFromAll([]string{"pages/originals/DSC_001.jpg"})
	if err == nil {
		t.Fatal("expected delete to fail when a required provider is missing")
	}
	if !strings.Contains(err.Error(), "tos") {
		t.Fatalf("expected missing provider error to mention TOS, got %v", err)
	}
	if r2Publisher.deleteObjectsCalls != 0 {
		t.Fatalf("expected fail-fast before partial delete, got %d delete calls", r2Publisher.deleteObjectsCalls)
	}
}

func TestUploadBytesToAllCallsAllPublishers(t *testing.T) {
	r2Publisher := &stubPublisher{provider: ProviderR2}
	tosPublisher := &stubPublisher{provider: ProviderTOS}
	registry := &PublisherRegistry{
		layout: DefaultObjectLayout(),
		byProvider: map[Provider]ObjectPublisher{
			ProviderR2:  r2Publisher,
			ProviderTOS: tosPublisher,
		},
		loadErrors: map[Provider]error{},
	}

	if err := registry.UploadBytesToAll([]byte("manifest"), "pages/photos-manifest.json", "application/json", ""); err != nil {
		t.Fatalf("UploadBytesToAll returned error: %v", err)
	}
	if r2Publisher.uploadBytesCalls != 1 || tosPublisher.uploadBytesCalls != 1 {
		t.Fatalf(
			"expected both publishers to receive upload, got r2=%d tos=%d",
			r2Publisher.uploadBytesCalls,
			tosPublisher.uploadBytesCalls,
		)
	}
}
