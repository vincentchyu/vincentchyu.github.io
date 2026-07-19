package admin

import (
	"sync"
	"time"

	"github.com/vincentchyu/vincentchyu.github.io/internal/photo"
	"github.com/vincentchyu/vincentchyu.github.io/internal/storage"
)

// AdminServer manages the photo admin HTTP server.
type AdminServer struct {
	rootDir      string
	photosPath   string
	imagesDir    string
	galleryStore *photo.GalleryStore
	service      *PhotoAdminService
	publishers   *storage.PublisherRegistry
	mu           sync.RWMutex
	rebuildTask  *RebuildTask
	rebuildMutex sync.Mutex
}

// RebuildTask tracks the status of a rebuild operation.
type RebuildTask struct {
	Status    string    `json:"status"` // "idle", "running", "completed", "failed"
	Progress  int       `json:"progress"`
	Message   string    `json:"message"`
	StartTime time.Time `json:"start_time,omitempty"`
	EndTime   time.Time `json:"end_time,omitempty"`
	Logs      []string  `json:"logs"`
}

// PhotoUpdateRequest represents a photo metadata update request.
type PhotoUpdateRequest struct {
	Alt      *string  `json:"alt,omitempty"`
	IsHidden *bool    `json:"is_hidden,omitempty"`
	Subject  []string `json:"Subject,omitempty"`
}

// BatchUpdateRequest represents a batch update request.
type BatchUpdateRequest struct {
	Filenames []string           `json:"filenames"`
	Updates   PhotoUpdateRequest `json:"updates"`
}

type ListPhotosPageRequest struct {
	Cursor string
	Limit  int
	Search string
	Year   string
	Status string
}

type PhotoListItem struct {
	Filename   string          `json:"filename"`
	Path       string          `json:"path"`
	Thumbnail  string          `json:"thumbnail"`
	Alt        string          `json:"alt"`
	Year       string          `json:"year"`
	Month      string          `json:"month"`
	Date       string          `json:"date"`
	Width      int             `json:"width,omitempty"`
	Height     int             `json:"height,omitempty"`
	IsHidden   bool            `json:"is_hidden"`
	Subject    []string        `json:"Subject,omitempty"`
	SourceURLs PhotoSourceURLs `json:"source_urls"`
}

type PhotoListPage struct {
	Items       []PhotoListItem `json:"items"`
	NextCursor  string          `json:"next_cursor,omitempty"`
	HasMore     bool            `json:"has_more"`
	TotalCount  int             `json:"total_count"`
	HiddenCount int             `json:"hidden_count"`
	Years       []string        `json:"years"`
}

type PhotoSourceURL struct {
	Path      string `json:"path"`
	Thumbnail string `json:"thumbnail"`
}

type PhotoSourceURLs struct {
	R2  PhotoSourceURL `json:"r2"`
	TOS PhotoSourceURL `json:"tos"`
}

type GallerySourceResponse struct {
	Config   photo.GallerySourceConfig   `json:"config"`
	Statuses []photo.GallerySourceStatus `json:"statuses"`
}

type GallerySourceUpdateRequest struct {
	ActiveSource photo.GallerySource `json:"active_source"`
}
