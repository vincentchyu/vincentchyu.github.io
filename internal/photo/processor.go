package photo

import (
	"bytes"
	"cmp"
	"crypto/md5"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"sync"

	"github.com/vincentchyu/vincentchyu.github.io/internal/imaging"
	"github.com/vincentchyu/vincentchyu.github.io/internal/storage"
	"github.com/vincentchyu/vincentchyu.github.io/pkg/config"
)

// Configuration
const (
	ProjectRoot = "../" // Assuming script is run from scripts/ directory
	ImgDir      = "web/photography/gallery_images"
	OutputFile  = LegacyGalleryPath

	// Path prefixes
	WebPhotographyPrefix = "web/photography/"

	// File extensions
	ExtJPG  = ".jpg"
	ExtJPEG = ".jpeg"
	ExtPNG  = ".png"
	ExtWebP = ".webp"

	// Date formats
	DateFormatYMD     = "%s-%s-%s"
	DateFormatDefault = "%s-01-01"
	DefaultMonth      = "01"
	DefaultDay        = "01"

	// Concurrency
	MaxConcurrency = 10
)

// Photo represents a single photo entry
type Photo struct {
	Filename  string         `json:"filename"`
	Path      string         `json:"path"`
	Thumbnail string         `json:"thumbnail"`
	Alt       string         `json:"alt"`
	Year      string         `json:"year"`
	Month     string         `json:"month"`
	Date      string         `json:"date"` // YYYY-MM-DD for sorting
	Width     int            `json:"width,omitempty"`
	Height    int            `json:"height,omitempty"`
	Exif      map[string]any `json:"exif,omitempty"`    // Complete EXIF data
	Hash      string         `json:"hash,omitempty"`    // File hash for caching
	Timestamp int64          `json:"-"`                 // Timestamp for sorting
	IsHidden  bool           `json:"is_hidden"`         // is_hidden
	Subject   []string       `json:"Subject,omitempty"` // Custom tags
}

// YearAlbum represents a collection of photos for a specific year
type YearAlbum struct {
	Year   string  `json:"year"`
	Photos []Photo `json:"photos"`
}

// PhotoProcessor handles the processing of photos
type PhotoProcessor struct {
	RootDir        string
	ImgDirPath     string
	Publishers     *storage.PublisherRegistry
	Layout         storage.ObjectLayout
	ExistingPhotos map[string]Photo // Key: Filename
	NewPhotos      []Photo
	Mutex          sync.Mutex
	DateRegex      *regexp.Regexp
}

// NewPhotoProcessor creates a new PhotoProcessor
func NewPhotoProcessor() (*PhotoProcessor, error) {
	rootDir, err := config.ResolveRootDir("")
	if err != nil {
		return nil, fmt.Errorf("resolve root dir: %w", err)
	}

	return NewPhotoProcessorWithRoot(rootDir)
}

func NewPhotoProcessorWithRoot(rootDir string) (*PhotoProcessor, error) {
	if rootDir == "" {
		var err error
		rootDir, err = config.ResolveRootDir("")
		if err != nil {
			return nil, fmt.Errorf("resolve root dir: %w", err)
		}
	}

	publishers := storage.LoadPublisherRegistryFromEnv()
	for _, provider := range storage.RequiredProviders {
		if err := publishers.LoadError(provider); err != nil {
			log.Printf("⚠ Warning: %s configuration load failed: %v\n", provider, err)
		} else if publishers.IsConfigured(provider) {
			log.Printf("✓ %s client initialized successfully\n", strings.ToUpper(string(provider)))
		}
	}

	return &PhotoProcessor{
		RootDir:        rootDir,
		ImgDirPath:     filepath.Join(rootDir, ImgDir),
		Publishers:     publishers,
		Layout:         publishers.Layout(),
		ExistingPhotos: make(map[string]Photo),
		DateRegex:      regexp.MustCompile(`DSC_(\d{4})-(\d{2})-(\d{2})`),
	}, nil
}

// LoadExistingMetadata loads the current gallery dataset so unchanged photos can preserve metadata.
// The bool return value indicates whether the sharded manifest exists.
func (p *PhotoProcessor) LoadExistingMetadata() ([]YearAlbum, bool, error) {
	store := NewGalleryStore(p.RootDir, nil)

	albums, _, err := store.LoadAlbums()
	if err != nil {
		return nil, false, err
	}

	hasShardedSource := false
	if _, _, manifestErr := store.loadFromManifest(); manifestErr == nil {
		hasShardedSource = true
	}

	for _, album := range albums {
		for _, photo := range album.Photos {
			p.ExistingPhotos[photo.Filename] = photo
		}
	}
	log.Printf("🟢 Loaded existing metadata for %d photos.\n", len(p.ExistingPhotos))

	return albums, hasShardedSource, nil
}

// calculateFileHash calculates MD5 hash of a file
func calculateFileHash(filePath string) (string, error) {
	file, err := os.Open(filePath)
	if err != nil {
		return "", err
	}
	defer func(file *os.File) {
		err := file.Close()
		if err != nil {
			log.Println("Failed to close file.")
		}
	}(file)

	hash := md5.New()
	if _, err := io.Copy(hash, file); err != nil {
		return "", err
	}

	return fmt.Sprintf("%x", hash.Sum(nil)), nil
}

// processPhoto processes a single photo.
func (p *PhotoProcessor) processPhoto(path string, yearDirName string, force bool) (Photo, error) {
	filename := filepath.Base(path)
	filenameNoExt := strings.TrimSuffix(filename, filepath.Ext(filename))

	// Calculate hash
	hash, err := calculateFileHash(path)
	if err != nil {
		return Photo{}, fmt.Errorf("failed to calculate hash: %w", err)
	}

	// Skip unchanged photos unless the caller explicitly requests a full rebuild.
	if !force {
		if existing, ok := p.ExistingPhotos[filename]; ok {
			if existing.Hash == hash {
				return existing, nil
			}
		}
	}

	// New or modified photo
	log.Printf("🟢 Processing %s...\n", filename)

	originalKey := p.Layout.OriginalKey(filename)
	thumbnailKey := p.Layout.ThumbnailKey(filenameNoExt)

	thumbnailData, err := imaging.GenerateThumbnail(path, imaging.DefaultThumbnailConfig())
	if err != nil {
		log.Printf("❌ Failed to generate thumbnail for %s: %v\n", filename, err)
		return Photo{}, fmt.Errorf("failed to generate thumbnail %s: %w", filename, err)
	}

	if p.Publishers != nil {
		if err := p.Publishers.UploadFileToAll(path, originalKey, "public, max-age=31536000"); err != nil {
			log.Printf("❌ Failed to upload original %s: %v\n", filename, err)
			return Photo{}, fmt.Errorf("failed to upload original %s: %w", filename, err)
		}
		if err := p.Publishers.UploadBytesToAll(
			thumbnailData, thumbnailKey, "image/webp", "public, max-age=31536000",
		); err != nil {
			log.Printf("❌ Failed to upload thumbnail for %s: %v\n", filename, err)
			return Photo{}, fmt.Errorf("failed to upload thumbnail %s: %w", filename, err)
		}
	}

	// Extract EXIF using configured extractor
	exifData, width, height, dateTaken, err := GetExifExtractor().Extract(path)

	var photoYear, month, dateStr string
	var timestamp int64

	if err == nil && !dateTaken.IsZero() {
		photoYear = fmt.Sprintf("%04d", dateTaken.Year())
		month = fmt.Sprintf("%02d", dateTaken.Month())
		dateStr = dateTaken.Format("2006-01-02")
		timestamp = dateTaken.Unix()
	} else {
		// Fallback to filename
		matches := p.DateRegex.FindStringSubmatch(filename)
		if len(matches) >= 4 {
			photoYear = matches[1]
			month = matches[2]
			dateStr = fmt.Sprintf(DateFormatYMD, matches[1], matches[2], matches[3])
		} else {
			photoYear = yearDirName
			month = DefaultMonth
			dateStr = fmt.Sprintf(DateFormatDefault, yearDirName)
		}
		if err != nil {
			log.Printf("⚠ EXIF extraction failed for %s: %v\n", filename, err)
		}
	}

	// Create Photo struct
	photo := Photo{
		Filename:  filename,
		Path:      originalKey,
		Thumbnail: thumbnailKey,
		Alt:       "", // Preserve alt if exists?
		Year:      photoYear,
		Month:     month,
		Date:      dateStr,
		Width:     width,
		Height:    height,
		Exif:      exifData,
		Hash:      hash,
		Timestamp: timestamp,
	}

	// Extract tags from EXIF Subject if available
	if subj, ok := exifData["Subject"].([]any); ok {
		for _, s := range subj {
			if str, ok := s.(string); ok {
				photo.Subject = append(photo.Subject, str)
			}
		}
	} else if subj, ok := exifData["Subject"].(string); ok {
		// Sometimes it's a single string
		photo.Subject = []string{subj}
	} else if kw, ok := exifData["Keywords"].([]any); ok {
		for _, k := range kw {
			if str, ok := k.(string); ok {
				photo.Subject = append(photo.Subject, str)
			}
		}
	} else if kw, ok := exifData["Keywords"].(string); ok {
		photo.Subject = []string{kw}
	}

	// Preserve custom fields from existing photo if available
	if existing, ok := p.ExistingPhotos[filename]; ok {
		photo.Alt = existing.Alt
		photo.IsHidden = existing.IsHidden
		// If photo has no tags from EXIF, preserve existing tags
		if len(photo.Subject) == 0 {
			photo.Subject = existing.Subject
		}
	}

	return photo, nil
}

// ProcessPhoto processes a single photo and is safe to call from other packages.
func (p *PhotoProcessor) ProcessPhoto(path string, yearDirName string) (Photo, error) {
	return p.processPhoto(path, yearDirName, false)
}

// RunUpdatePhotosWithRoot processes all photos and returns an error to the caller.
func RunUpdatePhotosWithRoot(rootDir string, logChan chan<- string, force bool) error {
	// Helper for logging
	logMsg := func(format string, v ...any) {
		msg := fmt.Sprintf(format, v...)
		log.Println(msg) // Keep stdout logging
		if logChan != nil {
			logChan <- msg
		}
	}

	processor, err := NewPhotoProcessorWithRoot(rootDir)
	if err != nil {
		return fmt.Errorf("initialize processor: %w", err)
	}
	store := NewGalleryStore(processor.RootDir, processor.Publishers)
	var existingAlbums []YearAlbum
	var hasShardedSource bool

	if existingAlbums, hasShardedSource, err = processor.LoadExistingMetadata(); err != nil {
		logMsg("Warning: Failed to load existing metadata: %v", err)
	}

	// Collect all image files
	type Job struct {
		Path    string
		YearDir string
	}
	var jobs []Job

	entries, err := os.ReadDir(processor.ImgDirPath)
	if err != nil {
		return fmt.Errorf("read image directory: %w", err)
	}

	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		yearDir := filepath.Join(processor.ImgDirPath, entry.Name())

		err := filepath.WalkDir(
			yearDir, func(path string, d fs.DirEntry, err error) error {
				if err != nil || d.IsDir() {
					return err
				}
				ext := strings.ToLower(filepath.Ext(d.Name()))
				if ext == ExtJPG || ext == ExtJPEG || ext == ExtPNG || ext == ExtWebP {
					jobs = append(jobs, Job{Path: path, YearDir: entry.Name()})
				}
				return nil
			},
		)
		if err != nil {
			logMsg("Error walking directory %s: %v", yearDir, err)
		}
	}

	// Worker Pool
	jobsChan := make(chan Job, len(jobs))
	resultsChan := make(chan Photo, len(jobs))
	var wg sync.WaitGroup

	// Start workers
	numWorkers := min(MaxConcurrency, len(jobs))

	logMsg("🟢 Starting %d workers for %d photos...", numWorkers, len(jobs))

	for range numWorkers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for job := range jobsChan {
				photo, err := processor.processPhoto(job.Path, job.YearDir, force)
				if err != nil {
					logMsg("Error processing %s: %v", filepath.Base(job.Path), err)
					continue
				}

				resultsChan <- photo
			}
		}()
	}

	// Send jobs
	for _, job := range jobs {
		jobsChan <- job
	}
	close(jobsChan)
	logMsg("✓ 任务分发完成")

	// Wait for workers
	wg.Wait()
	logMsg("✓ 任务已经结束")
	close(resultsChan)

	// Collect results
	var allPhotos []Photo
	for photo := range resultsChan {
		allPhotos = append(allPhotos, photo)
	}

	// Organize into albums
	albumsMap := make(map[string][]Photo)
	for _, p := range allPhotos {
		albumsMap[p.Year] = append(albumsMap[p.Year], p)
	}

	var newAlbums []YearAlbum
	for year, photos := range albumsMap {
		// Sort photos by date desc, then timestamp desc, then filename desc
		slices.SortFunc(
			photos, func(a, b Photo) int {
				if a.Date != b.Date {
					return cmp.Compare(b.Date, a.Date)
				}
				if a.Timestamp != b.Timestamp {
					return cmp.Compare(b.Timestamp, a.Timestamp)
				}
				return cmp.Compare(b.Filename, a.Filename)
			},
		)
		newAlbums = append(newAlbums, YearAlbum{Year: year, Photos: photos})
	}

	// Sort albums by year desc
	slices.SortFunc(
		newAlbums, func(a, b YearAlbum) int {
			return cmp.Compare(b.Year, a.Year)
		},
	)

	if !force && hasShardedSource && albumsEqual(existingAlbums, newAlbums) {
		logMsg("✓ Gallery dataset has not changed. Skipping shard writes and uploads.")
		return nil
	}

	manifest, err := store.SaveFull(newAlbums)
	if err != nil {
		return fmt.Errorf("write gallery dataset: %w", err)
	}

	logMsg("✓ Manifest updated with %d years.", len(manifest.Years))
	logMsg("Successfully updated sharded gallery dataset with %d photos.", len(allPhotos))
	return nil
}

// UpdatePhotosHandler processes all photos.
func UpdatePhotosHandler(logChan chan<- string) {
	if err := RunUpdatePhotosWithRoot("", logChan, false); err != nil {
		log.Println(err)
		os.Exit(1)
	}
}

// JSONEqual compares two JSON byte slices for equality, ignoring whitespace and key order
func JSONEqual(a, b []byte) bool {
	var j1, j2 any
	if err := json.Unmarshal(a, &j1); err != nil {
		return false
	}
	if err := json.Unmarshal(b, &j2); err != nil {
		return false
	}

	// Re-marshal to ensure consistent formatting (e.g. sorted keys, no whitespace)
	// Use MarshalIndent for readability in diffs
	m1, err := json.MarshalIndent(j1, "", "  ")
	if err != nil {
		return false
	}
	m2, err := json.MarshalIndent(j2, "", "  ")
	if err != nil {
		return false
	}

	if !bytes.Equal(m1, m2) {
		log.Println("⚠️ JSON content differs. Writing to files for comparison...")
		_ = os.WriteFile("photos_old.json", m1, 0644)
		_ = os.WriteFile("photos_new.json", m2, 0644)
		log.Println("👉 Please compare 'photos_old.json' and 'photos_new.json' to see the differences.")
		return false
	}

	return true
}
