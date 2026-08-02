package neodb

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"time"
)

var defaultCategories = []string{"book", "movie", "tv", "music", "game", "podcast"}

type Updater struct {
	client     *Client
	categories []string
	dataDir    string
}

type UpdaterOption func(*updaterConfig) error

type updaterConfig struct {
	httpClient *http.Client
	categories []string
	dataDir    string
}

func NewUpdater(rootDir string, token string, opts ...UpdaterOption) (*Updater, error) {
	if rootDir == "" {
		return nil, fmt.Errorf("root dir is empty")
	}
	if token == "" {
		return nil, fmt.Errorf("token is empty")
	}

	cfg := updaterConfig{
		httpClient: &http.Client{
			Transport: &http.Transport{
				// Proxy: http.ProxyFromEnvironment,
			},
			Timeout: 15 * time.Second,
		},
		categories: append([]string(nil), defaultCategories...),
		dataDir:    filepath.Join(rootDir, "web", "media", "data"),
	}
	for _, opt := range opts {
		if err := opt(&cfg); err != nil {
			return nil, err
		}
	}

	return &Updater{
		client:     NewClient(cfg.httpClient, token),
		categories: cfg.categories,
		dataDir:    cfg.dataDir,
	}, nil
}

func WithHTTPClient(httpClient *http.Client) UpdaterOption {
	return func(cfg *updaterConfig) error {
		if httpClient == nil {
			return fmt.Errorf("http client is nil")
		}
		cfg.httpClient = httpClient
		return nil
	}
}

func WithCategories(categories []string) UpdaterOption {
	return func(cfg *updaterConfig) error {
		if len(categories) == 0 {
			return fmt.Errorf("categories is empty")
		}
		cfg.categories = append([]string(nil), categories...)
		return nil
	}
}

func WithDataDir(dataDir string) UpdaterOption {
	return func(cfg *updaterConfig) error {
		if dataDir == "" {
			return fmt.Errorf("data dir is empty")
		}
		cfg.dataDir = dataDir
		return nil
	}
}

func (u *Updater) Run() error {
	if err := os.MkdirAll(u.dataDir, 0755); err != nil {
		return fmt.Errorf("create data directory: %w", err)
	}

	for _, category := range u.categories {
		log.Printf("Fetching category: %s...", category)
		records, err := u.client.FetchAllRecords(category)
		if err != nil {
			log.Printf("Error fetching category %s: %v", category, err)
			continue
		}
		existingRecords, err := u.readCategory(category)
		if err != nil {
			log.Printf("  ⚠ %s cache skipped: %v", category, err)
		}
		if cached := applyCachedReleaseDates(records, existingRecords); cached > 0 {
			log.Printf("  Reused %d cached release dates", cached)
		}
		u.client.EnrichReleaseDates(category, records)

		if err := u.writeCategory(category, records); err != nil {
			log.Printf("Error writing category %s: %v", category, err)
			continue
		}
		log.Printf("✓ Category %s: fetched %d records, saved to %s", category, len(records), u.categoryPath(category))
	}

	return nil
}

func (u *Updater) readCategory(category string) ([]Record, error) {
	fileData, err := os.ReadFile(u.categoryPath(category))
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("read existing category: %w", err)
	}

	var records []Record
	if err := json.Unmarshal(fileData, &records); err != nil {
		return nil, fmt.Errorf("unmarshal existing category: %w", err)
	}
	return records, nil
}

func applyCachedReleaseDates(records []Record, cachedRecords []Record) int {
	if len(records) == 0 || len(cachedRecords) == 0 {
		return 0
	}

	releaseDatesByUUID := make(map[string]string, len(cachedRecords))
	for _, record := range cachedRecords {
		if record.Item.UUID == "" || record.Item.ReleaseDate == "" {
			continue
		}
		releaseDatesByUUID[record.Item.UUID] = record.Item.ReleaseDate
	}

	applied := 0
	for i := range records {
		if records[i].Item.UUID == "" || records[i].Item.ReleaseDate != "" {
			continue
		}
		releaseDate := releaseDatesByUUID[records[i].Item.UUID]
		if releaseDate == "" {
			continue
		}
		records[i].Item.ReleaseDate = releaseDate
		applied++
	}
	return applied
}

func (u *Updater) writeCategory(category string, records []Record) error {
	fileData, err := json.MarshalIndent(records, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal data: %w", err)
	}

	if err := os.WriteFile(u.categoryPath(category), fileData, 0644); err != nil {
		return fmt.Errorf("write file: %w", err)
	}
	return nil
}

func (u *Updater) categoryPath(category string) string {
	return filepath.Join(u.dataDir, fmt.Sprintf("%s.json", category))
}
