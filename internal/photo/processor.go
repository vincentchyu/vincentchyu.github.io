package photo

import (
	"bytes"
	"crypto/md5"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/vincentchyu/vincentchyu.github.io/internal/imaging"
	"github.com/vincentchyu/vincentchyu.github.io/internal/storage"
)

// Configuration
const (
	ProjectRoot = "../" // Assuming script is run from scripts/ directory
	ImgDir      = "web/photography/gallery_images"
	OutputFile  = "web/photography/photos.json"

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
	Filename  string                 `json:"filename"`
	Path      string                 `json:"path"`
	Thumbnail string                 `json:"thumbnail"`
	Alt       string                 `json:"alt"`
	Year      string                 `json:"year"`
	Month     string                 `json:"month"`
	Date      string                 `json:"date"` // YYYY-MM-DD for sorting
	Width     int                    `json:"width,omitempty"`
	Height    int                    `json:"height,omitempty"`
	Exif      map[string]interface{} `json:"exif,omitempty"`    // Complete EXIF data
	Hash      string                 `json:"hash,omitempty"`    // File hash for caching
	Timestamp int64                  `json:"-"`                 // Timestamp for sorting
	IsHidden  bool                   `json:"is_hidden"`         // is_hidden
	Subject   []string               `json:"Subject,omitempty"` // Custom tags
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
	R2Client       *storage.R2Client
	ThumbnailBase  string
	ExistingPhotos map[string]Photo // Key: Filename
	NewPhotos      []Photo
	Mutex          sync.Mutex
	DateRegex      *regexp.Regexp
}

// NewPhotoProcessor creates a new PhotoProcessor
func NewPhotoProcessor() (*PhotoProcessor, error) {
	rootDir, err := os.Getwd()
	if err != nil {
		return nil, fmt.Errorf("error getting current working directory: %w", err)
	}

	// Initialize R2 client
	var r2Client *storage.R2Client
	var thumbnailBase string

	r2Config, err := storage.LoadR2Config()
	if err != nil {
		log.Printf("⚠ Warning: R2 configuration load failed: %v\n", err)
		log.Println("Using default/empty configuration...")
	} else {
		thumbnailBase = fmt.Sprintf(
			"%s/%s%s",
			strings.TrimRight(r2Config.CDNUrl, "/"),
			r2Config.BasePrefix,
			r2Config.ThumbnailPrefix,
		)
		r2Client, err = storage.NewR2Client(r2Config)
		if err != nil {
			log.Printf("⚠ Warning: Failed to create R2 client: %v\n", err)
		} else {
			log.Println("✓ R2 client initialized successfully")
		}
	}

	return &PhotoProcessor{
		RootDir:        rootDir,
		ImgDirPath:     filepath.Join(rootDir, ImgDir),
		R2Client:       r2Client,
		ThumbnailBase:  thumbnailBase,
		ExistingPhotos: make(map[string]Photo),
		DateRegex:      regexp.MustCompile(`DSC_(\d{4})-(\d{2})-(\d{2})`),
	}, nil
}

// LoadExistingMetadata loads existing photos.json
func (p *PhotoProcessor) LoadExistingMetadata() ([]byte, error) {
	var content []byte
	outputFilePath := filepath.Join(p.RootDir, OutputFile)
	if _, err := os.Stat(outputFilePath); err == nil {
		content, err = os.ReadFile(outputFilePath)
		if err != nil {
			return nil, err
		}

		var albums []YearAlbum
		if err := json.Unmarshal(content, &albums); err == nil {
			for _, album := range albums {
				for _, photo := range album.Photos {
					// Restore Timestamp from Exif if available
					if val, ok := photo.Exif["DateTimeOriginal"]; ok {
						if dateStr, ok := val.(string); ok {
							if t, err := time.Parse("2006:01:02 15:04:05", dateStr); err == nil {
								photo.Timestamp = t.Unix()
							}
						}
					}
					p.ExistingPhotos[photo.Filename] = photo
				}
			}
			log.Printf("🟢 Loaded existing metadata for %d photos.\n", len(p.ExistingPhotos))
		}
	}
	return content, nil
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

// processPhoto processes a single photo
func (p *PhotoProcessor) processPhoto(path string, yearDirName string) (Photo, error) {
	filename := filepath.Base(path)
	filenameNoExt := strings.TrimSuffix(filename, filepath.Ext(filename))

	// Calculate hash
	hash, err := calculateFileHash(path)
	if err != nil {
		return Photo{}, fmt.Errorf("failed to calculate hash: %w", err)
	}

	// Check if photo exists and hash matches
	if existing, ok := p.ExistingPhotos[filename]; ok {
		if existing.Hash == hash {
			// Photo hasn't changed, return existing data with all custom fields preserved
			// fmt.Printf("Skipping unchanged photo: %s\n", filename)
			return existing, nil
		}
	}

	// New or modified photo
	log.Printf("🟢 Processing %s...\n", filename)

	relPath, _ := filepath.Rel(p.RootDir, path)
	webPath := strings.ReplaceAll(relPath, "\\", "/")
	if after, ok := strings.CutPrefix(webPath, WebPhotographyPrefix); ok {
		webPath = after
	}

	var finalPath, finalThumbnail string

	// R2 Upload Logic
	if p.R2Client != nil {
		// 1. Upload Original
		originalKey := fmt.Sprintf("%s%s%s", p.R2Client.Config.BasePrefix, p.R2Client.Config.OriginalPrefix, filename)
		// We could check existence, but since hash changed or it's new, we should probably upload
		// Or we can check if it exists to avoid re-uploading if only local metadata changed?
		// For simplicity/safety, if hash changed, we upload.

		if err := p.R2Client.UploadFile(path, originalKey, "public, max-age=31536000"); err != nil {
			log.Printf("❌ Failed to upload original %s: %v\n", filename, err)
			finalPath = webPath
			return Photo{}, fmt.Errorf("failed to upload original %s: %w", filename, err)
		} else {
			finalPath = p.R2Client.GetCDNUrl(originalKey)
		}

		// 2. Upload Thumbnail
		thumbnailKey := fmt.Sprintf(
			"%s%s%s%s", p.R2Client.Config.BasePrefix, p.R2Client.Config.ThumbnailPrefix, filenameNoExt, ExtWebP,
		)
		thumbnailData, err := imaging.GenerateThumbnail(path, imaging.DefaultThumbnailConfig())
		if err != nil {
			log.Printf("❌ Failed to generate thumbnail for %s: %v\n", filename, err)
			finalThumbnail = p.ThumbnailBase + filenameNoExt + ".webp"
			return Photo{}, fmt.Errorf("failed to upload thumbnail %s: %w", filename, err)
		} else {
			if err := p.R2Client.UploadBytes(
				thumbnailData, thumbnailKey, "image/webp", "public, max-age=31536000",
			); err != nil {
				log.Printf("❌ Failed to upload thumbnail for %s: %v\n", filename, err)
				finalThumbnail = p.ThumbnailBase + filenameNoExt + ".webp"
			} else {
				finalThumbnail = p.R2Client.GetCDNUrl(thumbnailKey)
			}
		}
	} else {
		finalPath = webPath
		finalThumbnail = p.ThumbnailBase + filenameNoExt + ".webp"
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
		Path:      finalPath,
		Thumbnail: finalThumbnail,
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
	if subj, ok := exifData["Subject"].([]interface{}); ok {
		for _, s := range subj {
			if str, ok := s.(string); ok {
				photo.Subject = append(photo.Subject, str)
			}
		}
	} else if subj, ok := exifData["Subject"].(string); ok {
		// Sometimes it's a single string
		photo.Subject = []string{subj}
	} else if kw, ok := exifData["Keywords"].([]interface{}); ok {
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

// UpdatePhotosHandler processes all photos
func UpdatePhotosHandler(logChan chan<- string) {
	// Helper for logging
	logMsg := func(format string, v ...interface{}) {
		msg := fmt.Sprintf(format, v...)
		log.Println(msg) // Keep stdout logging
		if logChan != nil {
			logChan <- msg
		}
	}

	processor, err := NewPhotoProcessor()
	if err != nil {
		logMsg("Error initializing processor: %v", err)
		os.Exit(1)
	}
	var existingContent []byte

	if existingContent, err = processor.LoadExistingMetadata(); err != nil {
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
		logMsg("Error reading image directory: %v", err)
		os.Exit(1)
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
	numWorkers := MaxConcurrency
	if len(jobs) < numWorkers {
		numWorkers = len(jobs)
	}

	logMsg("🟢 Starting %d workers for %d photos...", numWorkers, len(jobs))

	for i := 0; i < numWorkers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for job := range jobsChan {
				photo, err := processor.processPhoto(job.Path, job.YearDir)
				if err != nil {
					logMsg("Error processing %s: %v", filepath.Base(job.Path), err)
					continue
				}

				// 全部清空
				if false {
				} else {
					resultsChan <- photo
				}
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
		sort.Slice(
			photos, func(i, j int) bool {
				if photos[i].Date != photos[j].Date {
					return photos[i].Date > photos[j].Date
				}
				if photos[i].Timestamp != photos[j].Timestamp {
					return photos[i].Timestamp > photos[j].Timestamp
				}
				return photos[i].Filename > photos[j].Filename
			},
		)
		newAlbums = append(newAlbums, YearAlbum{Year: year, Photos: photos})
	}

	// Sort albums by year desc
	sort.Slice(
		newAlbums, func(i, j int) bool {
			return newAlbums[i].Year > newAlbums[j].Year
		},
	)

	// Identify deleted photos
	if processor.R2Client != nil {
		newPhotosMap := make(map[string]bool)
		for _, p := range allPhotos {
			newPhotosMap[p.Filename] = true
		}

		var keysToDelete []string
		for filename := range processor.ExistingPhotos {
			if !newPhotosMap[filename] {
				logMsg("Marking for deletion: %s", filename)
				// Add original and thumbnail to delete list
				keysToDelete = append(
					keysToDelete,
					fmt.Sprintf(
						"%s%s%s", processor.R2Client.Config.BasePrefix, processor.R2Client.Config.OriginalPrefix,
						filename,
					),
					fmt.Sprintf(
						"%s%s%s%s", processor.R2Client.Config.BasePrefix, processor.R2Client.Config.ThumbnailPrefix,
						strings.TrimSuffix(filename, filepath.Ext(filename)), ExtWebP,
					),
				)
			}
		}

		if len(keysToDelete) > 0 {
			logMsg("🟢 Deleting %d orphaned files from R2...", len(keysToDelete))
			if err := processor.R2Client.DeleteObjects(keysToDelete); err != nil {
				logMsg("Error deleting objects: %v", err)
			} else {
				logMsg("✓ Successfully deleted orphaned files.")
			}
		}
	}

	// Write output
	jsonData, err := json.Marshal(newAlbums)
	if err != nil {
		logMsg("Error marshaling JSON: %v", err)
		os.Exit(1)
	}

	outputFilePath := filepath.Join(processor.RootDir, OutputFile)

	// Check if content changed (ignoring order if possible, but simple byte check is fast)
	// Since we re-generated everything, byte comparison might fail if order changed slightly or timestamps
	// But we should write anyway if we processed updates.

	err = os.WriteFile(outputFilePath, jsonData, 0644)
	if err != nil {
		logMsg("Error writing output file: %v", err)
		os.Exit(1)
	}

	// Create backup of existing file if it exists
	if len(existingContent) > 0 {
		backupPath := outputFilePath + "." + time.Now().Format("20060102_150405") + ".bak"
		if err := os.WriteFile(backupPath, existingContent, 0644); err != nil {
			logMsg("Warning: Could not create backup of %s: %v", outputFilePath, err)
		} else {
			logMsg("✓ Backup created: %s", backupPath)
		}
	}

	// Check if content has changed
	if JSONEqual(existingContent, jsonData) {
		logMsg("✓ photos.json has not changed. Skipping backup, file write, and R2 upload.")
		return
	}

	// Upload photos.json to R2
	if processor.R2Client != nil {
		jsonKey := fmt.Sprintf("%sphotos.json", processor.R2Client.Config.BasePrefix)
		if err := processor.R2Client.UploadBytes(
			jsonData, jsonKey, "application/json", "no-cache",
		); err != nil {
			logMsg("❌ Failed to upload photos.json: %v", err)
		} else {
			logMsg("✓ Uploaded photos.json to R2")
		}
	}

	if storage.CFCli != nil {
		key := fmt.Sprintf("cache:photos:%s", "jsonValue")
		err := storage.CfKvSetValue(fmt.Sprintf("cache:photos:%s", "jsonValue"), string(jsonData), 86400)
		if err != nil {
			logMsg("❌Error setting value for %s: %v", outputFilePath, err)
		} else {
			logMsg("✓ Uploaded photos.json to KV[%s]", key)
		}
	}

	logMsg("Successfully updated photos.json with %d photos.", len(allPhotos))
}

// JSONEqual compares two JSON byte slices for equality, ignoring whitespace and key order
func JSONEqual(a, b []byte) bool {
	var j1, j2 interface{}
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
