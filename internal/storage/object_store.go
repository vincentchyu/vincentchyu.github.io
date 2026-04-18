package storage

import (
	"fmt"
	"path"
	"strings"
)

type Provider string

const (
	ProviderR2  Provider = "r2"
	ProviderTOS Provider = "tos"
)

var RequiredProviders = []Provider{ProviderR2, ProviderTOS}

type ObjectLayout struct {
	BasePrefix      string
	OriginalPrefix  string
	ThumbnailPrefix string
}

func DefaultObjectLayout() ObjectLayout {
	return ObjectLayout{
		BasePrefix:      normalizePrefix("pages/"),
		OriginalPrefix:  normalizePrefix("originals/"),
		ThumbnailPrefix: normalizePrefix("thumbnails/"),
	}
}

func (l ObjectLayout) OriginalKey(filename string) string {
	return joinObjectKey(l.BasePrefix, l.OriginalPrefix, filename)
}

func (l ObjectLayout) ThumbnailKey(filenameNoExt string) string {
	return joinObjectKey(l.BasePrefix, l.ThumbnailPrefix, filenameNoExt+".webp")
}

func (l ObjectLayout) ManifestKey() string {
	return joinObjectKey(l.BasePrefix, "photos-manifest.json")
}

func (l ObjectLayout) YearKey(year string) string {
	return joinObjectKey(l.BasePrefix, "photos", year+".json")
}

func (l ObjectLayout) SourceConfigKey() string {
	return joinObjectKey(l.BasePrefix, "gallery-source.json")
}

type ObjectPublisher interface {
	Provider() Provider
	BaseURL() string
	UploadFile(localPath, key, cacheControl string) error
	UploadBytes(data []byte, key, contentType, cacheControl string) error
	DeleteObject(key string) error
	DeleteObjects(keys []string) error
	PublicURL(key string) string
	HeadObject(key string) error
}

type PublisherRegistry struct {
	layout     ObjectLayout
	byProvider map[Provider]ObjectPublisher
	loadErrors map[Provider]error
}

func NewPublisherRegistryForTest(
	layout ObjectLayout,
	byProvider map[Provider]ObjectPublisher,
	loadErrors map[Provider]error,
) *PublisherRegistry {
	if byProvider == nil {
		byProvider = map[Provider]ObjectPublisher{}
	}
	if loadErrors == nil {
		loadErrors = map[Provider]error{}
	}
	return &PublisherRegistry{
		layout:     layout,
		byProvider: byProvider,
		loadErrors: loadErrors,
	}
}

type PublisherLoadResult struct {
	Registry *PublisherRegistry
}

func LoadPublisherRegistryFromEnv() *PublisherRegistry {
	loadErrors := make(map[Provider]error)

	r2Config, r2Err := LoadR2Config()
	if r2Err != nil {
		loadErrors[ProviderR2] = r2Err
	}

	tosConfig, tosErr := LoadTOSConfig()
	if tosErr != nil {
		loadErrors[ProviderTOS] = tosErr
	}

	layout, layoutErr := ResolveObjectLayout(r2Config, tosConfig)
	if layoutErr != nil {
		loadErrors[ProviderR2] = layoutErr
		loadErrors[ProviderTOS] = layoutErr
		return &PublisherRegistry{
			layout:     DefaultObjectLayout(),
			byProvider: map[Provider]ObjectPublisher{},
			loadErrors: loadErrors,
		}
	}

	byProvider := make(map[Provider]ObjectPublisher)
	if r2Config != nil {
		client, err := NewR2Client(r2Config)
		if err != nil {
			loadErrors[ProviderR2] = err
		} else {
			byProvider[ProviderR2] = client
		}
	}
	if tosConfig != nil {
		client, err := NewTOSClient(tosConfig)
		if err != nil {
			loadErrors[ProviderTOS] = err
		} else {
			byProvider[ProviderTOS] = client
		}
	}

	return &PublisherRegistry{
		layout:     layout,
		byProvider: byProvider,
		loadErrors: loadErrors,
	}
}

func (r *PublisherRegistry) Layout() ObjectLayout {
	if r == nil {
		return DefaultObjectLayout()
	}
	return r.layout
}

func (r *PublisherRegistry) Providers() []Provider {
	if r == nil {
		return nil
	}
	providers := make([]Provider, 0, len(r.byProvider))
	for _, provider := range RequiredProviders {
		if _, ok := r.byProvider[provider]; ok {
			providers = append(providers, provider)
		}
	}
	return providers
}

func (r *PublisherRegistry) Publisher(provider Provider) ObjectPublisher {
	if r == nil {
		return nil
	}
	return r.byProvider[provider]
}

func (r *PublisherRegistry) LoadError(provider Provider) error {
	if r == nil {
		return fmt.Errorf("publisher registry is nil")
	}
	return r.loadErrors[provider]
}

func (r *PublisherRegistry) IsConfigured(provider Provider) bool {
	return r != nil && r.byProvider[provider] != nil
}

func (r *PublisherRegistry) UploadFileToAll(localPath, key, cacheControl string) error {
	if err := r.ensureRequiredProvidersConfigured(); err != nil {
		return err
	}
	for _, provider := range RequiredProviders {
		publisher := r.Publisher(provider)
		if err := publisher.UploadFile(localPath, key, cacheControl); err != nil {
			return fmt.Errorf("upload file to %s: %w", provider, err)
		}
	}
	return nil
}

func (r *PublisherRegistry) UploadBytesToAll(data []byte, key, contentType, cacheControl string) error {
	if err := r.ensureRequiredProvidersConfigured(); err != nil {
		return err
	}
	for _, provider := range RequiredProviders {
		publisher := r.Publisher(provider)
		if err := publisher.UploadBytes(data, key, contentType, cacheControl); err != nil {
			return fmt.Errorf("upload bytes to %s: %w", provider, err)
		}
	}
	return nil
}

func (r *PublisherRegistry) DeleteObjectFromAll(key string) error {
	if err := r.ensureRequiredProvidersConfigured(); err != nil {
		return err
	}
	for _, provider := range RequiredProviders {
		publisher := r.Publisher(provider)
		if err := publisher.DeleteObject(key); err != nil {
			return fmt.Errorf("delete object from %s: %w", provider, err)
		}
	}
	return nil
}

func (r *PublisherRegistry) DeleteObjectsFromAll(keys []string) error {
	if err := r.ensureRequiredProvidersConfigured(); err != nil {
		return err
	}
	for _, provider := range RequiredProviders {
		publisher := r.Publisher(provider)
		if err := publisher.DeleteObjects(keys); err != nil {
			return fmt.Errorf("delete objects from %s: %w", provider, err)
		}
	}
	return nil
}

func (r *PublisherRegistry) PublicURL(provider Provider, key string) string {
	publisher := r.Publisher(provider)
	if publisher == nil {
		return ""
	}
	return publisher.PublicURL(key)
}

func (r *PublisherRegistry) ensureRequiredProvidersConfigured() error {
	if r == nil {
		return fmt.Errorf("publisher registry is nil")
	}

	missing := make([]string, 0, len(RequiredProviders))
	for _, provider := range RequiredProviders {
		if r.Publisher(provider) != nil {
			continue
		}

		if err := r.LoadError(provider); err != nil {
			missing = append(missing, fmt.Sprintf("%s (%v)", provider, err))
			continue
		}
		missing = append(missing, string(provider))
	}

	if len(missing) > 0 {
		return fmt.Errorf("required object publishers are not configured: %s", strings.Join(missing, ", "))
	}

	return nil
}

func ResolveObjectLayout(r2Config *R2Config, tosConfig *TOSConfig) (ObjectLayout, error) {
	layout := DefaultObjectLayout()
	hasR2Layout := false

	if r2Config != nil {
		layout.BasePrefix = normalizePrefix(r2Config.BasePrefix)
		layout.OriginalPrefix = normalizePrefix(r2Config.OriginalPrefix)
		layout.ThumbnailPrefix = normalizePrefix(r2Config.ThumbnailPrefix)
		hasR2Layout = true
	}

	if tosConfig == nil {
		return layout, nil
	}

	tosLayout := ObjectLayout{
		BasePrefix:      normalizePrefix(tosConfig.BasePrefix),
		OriginalPrefix:  normalizePrefix(tosConfig.OriginalPrefix),
		ThumbnailPrefix: normalizePrefix(tosConfig.ThumbnailPrefix),
	}

	if hasR2Layout && layout != tosLayout {
		return ObjectLayout{}, fmt.Errorf(
			"R2 and TOS object layout must match for neutral JSON: r2=%+v tos=%+v", layout, tosLayout,
		)
	}

	return tosLayout, nil
}

func joinObjectKey(parts ...string) string {
	cleaned := make([]string, 0, len(parts))
	for i, part := range parts {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		if i == 0 {
			part = strings.Trim(part, "/")
		} else {
			part = strings.Trim(part, "/")
		}
		if part == "" {
			continue
		}
		cleaned = append(cleaned, part)
	}
	return path.Clean(strings.Join(cleaned, "/"))
}

func normalizePrefix(prefix string) string {
	trimmed := strings.TrimSpace(prefix)
	if trimmed == "" {
		return ""
	}
	trimmed = strings.Trim(trimmed, "/")
	if trimmed == "" {
		return ""
	}
	return trimmed + "/"
}
