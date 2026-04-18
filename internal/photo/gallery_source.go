package photo

import (
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/vincentchyu/vincentchyu.github.io/internal/storage"
)

const GallerySourcePathName = "web/photography/data/gallery-source.json"

type GallerySource string

const (
	GallerySourceTOS GallerySource = "tos"
	GallerySourceR2  GallerySource = "r2"
)

type GallerySourceEntry struct {
	PublicBase string `json:"public_base"`
}

type GallerySourceConfig struct {
	Version      string                               `json:"version"`
	ActiveSource GallerySource                        `json:"active_source"`
	Sources      map[GallerySource]GallerySourceEntry `json:"sources"`
	UpdatedAt    string                               `json:"updated_at"`
}

type GallerySourceStatus struct {
	Provider   GallerySource `json:"provider"`
	Configured bool          `json:"configured"`
	PublicBase string        `json:"public_base"`
	Healthy    bool          `json:"healthy"`
	Error      string        `json:"error,omitempty"`
}

func defaultGallerySourceConfig(registry *storage.PublisherRegistry) GallerySourceConfig {
	cfg := GallerySourceConfig{
		Version:      "1",
		ActiveSource: GallerySourceTOS,
		Sources:      map[GallerySource]GallerySourceEntry{},
		UpdatedAt:    time.Now().UTC().Format(time.RFC3339),
	}

	for _, provider := range []struct {
		source   GallerySource
		provider storage.Provider
	}{
		{source: GallerySourceR2, provider: storage.ProviderR2},
		{source: GallerySourceTOS, provider: storage.ProviderTOS},
	} {
		publicBase := ""
		if registry != nil && registry.IsConfigured(provider.provider) {
			publicBase = registry.Publisher(provider.provider).BaseURL()
		}
		cfg.Sources[provider.source] = GallerySourceEntry{PublicBase: publicBase}
	}

	return cfg
}

func trimTrailingSlash(value string) string {
	for len(value) > 0 && value[len(value)-1] == '/' {
		value = value[:len(value)-1]
	}
	return value
}

func (s *GalleryStore) sourceConfigLocalPath() string {
	return filepath.Join(s.RootDir, GallerySourcePathName)
}

func (s *GalleryStore) LoadSourceConfig() (GallerySourceConfig, error) {
	data, err := os.ReadFile(s.sourceConfigLocalPath())
	if err != nil {
		if os.IsNotExist(err) {
			return defaultGallerySourceConfig(s.Publishers), nil
		}
		return GallerySourceConfig{}, err
	}

	var cfg GallerySourceConfig
	if err := json.Unmarshal(data, &cfg); err != nil {
		return GallerySourceConfig{}, err
	}

	if cfg.Version == "" {
		cfg.Version = "1"
	}
	if cfg.ActiveSource == "" {
		cfg.ActiveSource = GallerySourceTOS
	}
	if cfg.Sources == nil {
		cfg.Sources = map[GallerySource]GallerySourceEntry{}
	}

	defaults := defaultGallerySourceConfig(s.Publishers)
	for provider, entry := range defaults.Sources {
		if _, ok := cfg.Sources[provider]; !ok {
			cfg.Sources[provider] = entry
		}
	}

	return cfg, nil
}

func (s *GalleryStore) SaveSourceConfig(cfg GallerySourceConfig) error {
	if cfg.Version == "" {
		cfg.Version = "1"
	}
	if cfg.ActiveSource == "" {
		cfg.ActiveSource = GallerySourceTOS
	}
	if cfg.Sources == nil {
		cfg.Sources = map[GallerySource]GallerySourceEntry{}
	}
	cfg.UpdatedAt = time.Now().UTC().Format(time.RFC3339)

	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}

	if err := os.MkdirAll(filepath.Dir(s.sourceConfigLocalPath()), 0o755); err != nil {
		return err
	}
	if err := os.WriteFile(s.sourceConfigLocalPath(), data, 0o644); err != nil {
		return err
	}

	if s.Publishers != nil {
		if err := s.Publishers.UploadBytesToAll(
			data, s.Publishers.Layout().SourceConfigKey(), "application/json", GalleryDataCacheControl,
		); err != nil {
			return err
		}
	}

	return nil
}

func (s *GalleryStore) EnsureSourceConfigPublished() error {
	cfg, err := s.LoadSourceConfig()
	if err != nil {
		return err
	}
	return s.SaveSourceConfig(cfg)
}

func (s *GalleryStore) BuildSourceStatuses(manifest GalleryManifest) []GallerySourceStatus {
	statuses := make([]GallerySourceStatus, 0, 2)
	layout := storage.DefaultObjectLayout()
	if s.Publishers != nil {
		layout = s.Publishers.Layout()
	}
	sampleKey := sampleObjectKey(manifest, layout)

	for _, item := range []struct {
		source   GallerySource
		provider storage.Provider
	}{
		{source: GallerySourceTOS, provider: storage.ProviderTOS},
		{source: GallerySourceR2, provider: storage.ProviderR2},
	} {
		status := GallerySourceStatus{
			Provider:   item.source,
			Configured: s.Publishers != nil && s.Publishers.IsConfigured(item.provider),
		}
		if s.Publishers != nil && s.Publishers.IsConfigured(item.provider) {
			status.PublicBase = s.Publishers.Publisher(item.provider).BaseURL()
		}

		if !status.Configured {
			if s.Publishers != nil {
				if err := s.Publishers.LoadError(item.provider); err != nil {
					status.Error = err.Error()
				}
			} else {
				status.Error = "publisher registry is not initialized"
			}
			statuses = append(statuses, status)
			continue
		}

		publisher := s.Publishers.Publisher(item.provider)
		if err := publisher.HeadObject(layout.ManifestKey()); err != nil {
			status.Error = err.Error()
		} else if sampleKey != "" {
			if err := publisher.HeadObject(sampleKey); err != nil {
				status.Error = err.Error()
			}
		}
		status.Healthy = status.Error == ""
		statuses = append(statuses, status)
	}

	return statuses
}

func (s *GalleryStore) ValidateSourceHealth(source GallerySource, manifest GalleryManifest) error {
	if s.Publishers == nil {
		return fmt.Errorf("publisher registry is not initialized")
	}

	var provider storage.Provider
	switch source {
	case GallerySourceTOS:
		provider = storage.ProviderTOS
	case GallerySourceR2:
		provider = storage.ProviderR2
	default:
		return fmt.Errorf("unsupported gallery source: %s", source)
	}

	publisher := s.Publishers.Publisher(provider)
	if publisher == nil {
		if err := s.Publishers.LoadError(provider); err != nil {
			return err
		}
		return fmt.Errorf("%s publisher is not configured", source)
	}

	if err := publisher.HeadObject(s.Publishers.Layout().ManifestKey()); err != nil {
		return err
	}
	if sampleKey := sampleObjectKey(manifest, s.Publishers.Layout()); sampleKey != "" {
		if err := publisher.HeadObject(sampleKey); err != nil {
			return err
		}
	}
	return nil
}

func (s *GalleryStore) ResolvePublicURL(source GallerySource, asset string) string {
	if asset == "" {
		return ""
	}
	if parsed, err := url.Parse(asset); err == nil && parsed.IsAbs() {
		return asset
	}
	if s.Publishers == nil {
		return ""
	}

	var provider storage.Provider
	switch source {
	case GallerySourceTOS:
		provider = storage.ProviderTOS
	case GallerySourceR2:
		provider = storage.ProviderR2
	default:
		return ""
	}

	publisher := s.Publishers.Publisher(provider)
	if publisher == nil {
		return ""
	}
	return publisher.PublicURL(asset)
}

func sampleObjectKey(manifest GalleryManifest, layout storage.ObjectLayout) string {
	if len(manifest.Years) == 0 {
		return ""
	}
	return normalizeGalleryAssetKey(manifest.Years[0].Cover, layout)
}

func normalizeGalleryAssetKey(asset string, layout storage.ObjectLayout) string {
	asset = strings.TrimSpace(asset)
	if asset == "" {
		return ""
	}

	parsed, err := url.Parse(asset)
	if err == nil && parsed.IsAbs() {
		key := strings.TrimLeft(parsed.Path, "/")
		if key == "" {
			return ""
		}
		if layout.BasePrefix == "" || strings.HasPrefix(key, layout.BasePrefix) {
			return key
		}
		return ""
	}

	return strings.TrimLeft(asset, "/")
}
