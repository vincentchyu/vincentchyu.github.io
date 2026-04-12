package admin

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/vincentchyu/vincentchyu.github.io/internal/photo"
	"github.com/vincentchyu/vincentchyu.github.io/internal/storage"
)

// AdminServer manages the photo admin HTTP server
type AdminServer struct {
	rootDir      string
	photosPath   string
	imagesDir    string
	galleryStore *photo.GalleryStore
	mu           sync.RWMutex
	rebuildTask  *RebuildTask
	rebuildMutex sync.Mutex
	R2Client     *storage.R2Client
}

// RebuildTask tracks the status of a rebuild operation
type RebuildTask struct {
	Status    string    `json:"status"` // "idle", "running", "completed", "failed"
	Progress  int       `json:"progress"`
	Message   string    `json:"message"`
	StartTime time.Time `json:"start_time,omitempty"`
	EndTime   time.Time `json:"end_time,omitempty"`
	Logs      []string  `json:"logs"`
}

// PhotoUpdateRequest represents a photo metadata update request
type PhotoUpdateRequest struct {
	Alt      *string  `json:"alt,omitempty"`
	IsHidden *bool    `json:"is_hidden,omitempty"`
	Subject  []string `json:"Subject,omitempty"`
}

// BatchUpdateRequest represents a batch update request
type BatchUpdateRequest struct {
	Filenames []string           `json:"filenames"`
	Updates   PhotoUpdateRequest `json:"updates"`
}

// NewAdminServer creates a new admin server instance
func NewAdminServer() (*AdminServer, error) {
	rootDir, err := os.Getwd()
	if err != nil {
		return nil, fmt.Errorf("failed to get working directory: %w", err)
	}

	// Initialize R2 client
	var r2Client *storage.R2Client
	r2Config, err := storage.LoadR2Config()
	if err != nil {
		log.Printf("⚠ Warning: R2 configuration load failed: %v\n", err)
	} else {
		r2Client, err = storage.NewR2Client(r2Config)
		if err != nil {
			log.Printf("⚠ Warning: Failed to create R2 client: %v\n", err)
		} else {
			log.Println("✓ R2 client initialized successfully")
		}
	}

	return &AdminServer{
		rootDir:      rootDir,
		photosPath:   filepath.Join(rootDir, photo.LegacyGalleryPath),
		imagesDir:    filepath.Join(rootDir, photo.ImgDir),
		galleryStore: photo.NewGalleryStore(rootDir, r2Client),
		rebuildTask: &RebuildTask{
			Status: "idle",
			Logs:   []string{},
		},
		R2Client: r2Client,
	}, nil
}

// StartAdminServer starts the HTTP server
func StartAdminServer(addr string) error {
	server, err := NewAdminServer()
	if err != nil {
		return err
	}

	mux := http.NewServeMux()

	// API routes
	mux.HandleFunc("/api/photos", loggingMiddleware(server.handlePhotos))
	mux.HandleFunc("/api/photos/", loggingMiddleware(server.handlePhotoResource)) // Renamed from handlePhotoUpdate
	mux.HandleFunc("/api/photos/batch", loggingMiddleware(server.handleBatchUpdate))
	mux.HandleFunc("/api/photos/upload", loggingMiddleware(server.handlePhotoUpload))
	mux.HandleFunc("/api/rebuild", loggingMiddleware(server.handleRebuild))
	mux.HandleFunc("/api/rebuild/status", loggingMiddleware(server.handleRebuildStatus))
	mux.HandleFunc("/api/images/", loggingMiddleware(server.handleImageServe))
	mux.HandleFunc("/api/proxy", loggingMiddleware(server.handleProxy))

	// Static files
	webAdminDir := filepath.Join(server.rootDir, "web", "admin")
	mux.Handle("/", http.FileServer(http.Dir(webAdminDir)))

	log.Printf("🚀 照片管理服务器启动在 http://localhost%s\n", addr)
	log.Printf("📁 项目根目录: %s\n", server.rootDir)
	log.Printf("📸 照片目录: %s\n", server.imagesDir)
	log.Printf("📄 旧导出文件: %s\n", server.photosPath)
	log.Printf("📄 新清单文件: %s\n", filepath.Join(server.rootDir, photo.GalleryManifestPathName))

	return http.ListenAndServe(addr, mux)
}

// handlePhotos handles GET /api/photos
func (s *AdminServer) handlePhotos(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	s.mu.RLock()
	defer s.mu.RUnlock()

	albums, _, err := s.galleryStore.LoadAlbums()
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to read gallery data: %v", err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(albums)
}

// handlePhotoResource handles operations on specific photos (PUT, DELETE)
func (s *AdminServer) handlePhotoResource(w http.ResponseWriter, r *http.Request) {
	// Extract filename from path
	trimmed := strings.TrimPrefix(r.URL.Path, "/api/photos/")
	if trimmed == "" {
		http.Error(w, "Filename is required", http.StatusBadRequest)
		return
	}

	year, filename := splitPhotoResourcePath(trimmed)
	if filename == "" {
		http.Error(w, "Filename is required", http.StatusBadRequest)
		return
	}

	switch r.Method {
	case http.MethodPut:
		s.handlePhotoUpdate(w, r, year, filename)
	case http.MethodDelete:
		s.handlePhotoDelete(w, r, year, filename)
	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

func splitPhotoResourcePath(path string) (year, filename string) {
	parts := strings.Split(path, "/")
	if len(parts) >= 2 && len(parts[0]) == 4 {
		return parts[0], strings.Join(parts[1:], "/")
	}
	return "", path
}

// handlePhotoUpdate handles PUT /api/photos/:filename
func (s *AdminServer) handlePhotoUpdate(w http.ResponseWriter, r *http.Request, year, filename string) {
	var req PhotoUpdateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, fmt.Sprintf("Invalid request body: %v", err), http.StatusBadRequest)
		return
	}

	if err := s.updatePhoto(year, filename, req); err != nil {
		http.Error(w, fmt.Sprintf("Failed to update photo: %v", err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "success"})
}

// handlePhotoDelete handles DELETE /api/photos/:filename
func (s *AdminServer) handlePhotoDelete(w http.ResponseWriter, r *http.Request, year, filename string) {
	if err := s.deletePhoto(year, filename); err != nil {
		http.Error(w, fmt.Sprintf("Failed to delete photo: %v", err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "success"})
}

// handleBatchUpdate handles POST /api/photos/batch
func (s *AdminServer) handleBatchUpdate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req BatchUpdateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, fmt.Sprintf("Invalid request body: %v", err), http.StatusBadRequest)
		return
	}

	if err := s.updatePhotosBatch(req); err != nil {
		http.Error(w, fmt.Sprintf("Failed to update photos: %v", err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "success"})
}

// handleRebuild handles POST /api/rebuild
func (s *AdminServer) handleRebuild(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	s.rebuildMutex.Lock()
	if s.rebuildTask.Status == "running" {
		s.rebuildMutex.Unlock()
		http.Error(w, "Rebuild is already running", http.StatusConflict)
		return
	}

	// Reset rebuild task
	s.rebuildTask = &RebuildTask{
		Status:    "running",
		Progress:  0,
		Message:   "Starting rebuild...",
		StartTime: time.Now(),
		Logs:      []string{"🚀 开始重建照片库..."},
	}
	s.rebuildMutex.Unlock()

	// Run rebuild in background
	go s.runRebuild()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "started"})
}

// handleRebuildStatus handles GET /api/rebuild/status
func (s *AdminServer) handleRebuildStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	s.rebuildMutex.Lock()
	task := *s.rebuildTask
	s.rebuildMutex.Unlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(task)
}

// handleImageServe handles GET /api/images/:year/:filename
func (s *AdminServer) handleImageServe(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Extract path: /api/images/2025/DSC_xxx.jpg -> 2025/DSC_xxx.jpg
	imagePath := strings.TrimPrefix(r.URL.Path, "/api/images/")
	fullPath := filepath.Join(s.imagesDir, imagePath)

	// Security check: ensure path is within images directory
	absPath, err := filepath.Abs(fullPath)
	if err != nil || !strings.HasPrefix(absPath, s.imagesDir) {
		http.Error(w, "Invalid path", http.StatusBadRequest)
		return
	}

	// Serve the image with strong caching (1 day)
	w.Header().Set("Cache-Control", "public, max-age=86400")
	http.ServeFile(w, r, fullPath)
}

// handleProxy proxies requests to external URLs with specific Referer
func (s *AdminServer) handleProxy(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	targetURL := r.URL.Query().Get("url")
	if targetURL == "" {
		http.Error(w, "Missing url parameter", http.StatusBadRequest)
		return
	}

	// Create request
	req, err := http.NewRequest("GET", targetURL, nil)
	if err != nil {
		http.Error(w, "Invalid URL", http.StatusBadRequest)
		return
	}

	// Set Referer to bypass hotlink protection
	req.Header.Set("Referer", "https://vincent.chyu.org")
	// Use a standard browser User-Agent to avoid potential WAF filtering
	req.Header.Set("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")

	// Perform request
	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		log.Printf("❌ Proxy error fetching %s: %v", targetURL, err)
		http.Error(w, fmt.Sprintf("Failed to fetch upstream: %v", err), http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	// Copy headers (Content-Type, Content-Length, etc.)
	for k, v := range resp.Header {
		w.Header()[k] = v
	}

	// Set status code
	w.WriteHeader(resp.StatusCode)

	// Stream body
	io.Copy(w, resp.Body)
}

// updatePhoto updates a single photo's metadata in the matching year shard.
func (s *AdminServer) updatePhoto(year, filename string, req PhotoUpdateRequest) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if year != "" {
		album, err := s.galleryStore.LoadYearAlbum(year)
		if err != nil {
			return fmt.Errorf("failed to load year shard: %w", err)
		}

		found := false
		var updated photo.Photo
		for i := range album.Photos {
			if album.Photos[i].Filename != filename {
				continue
			}
			updated, _ = applyPhotoUpdate(&album.Photos[i], req)
			found = true
			break
		}
		if !found {
			return fmt.Errorf("photo not found: %s", filename)
		}

		if _, err := s.galleryStore.UpsertPhoto(updated); err != nil {
			return fmt.Errorf("failed to persist photo update: %w", err)
		}
		return nil
	}

	albums, _, err := s.galleryStore.LoadAlbums()
	if err != nil {
		return fmt.Errorf("failed to load gallery data: %w", err)
	}

	found := false
	for i := range albums {
		for j := range albums[i].Photos {
			if albums[i].Photos[j].Filename != filename {
				continue
			}
			if req.Alt != nil {
				albums[i].Photos[j].Alt = *req.Alt
			}
			if req.IsHidden != nil {
				albums[i].Photos[j].IsHidden = *req.IsHidden
			}
			if req.Subject != nil {
				albums[i].Photos[j].Subject = req.Subject
			}
			found = true
			break
		}
		if found {
			break
		}
	}

	if !found {
		return fmt.Errorf("photo not found: %s", filename)
	}

	if _, err := s.galleryStore.SaveFull(albums); err != nil {
		return fmt.Errorf("failed to persist gallery data: %w", err)
	}
	return nil
}

// updatePhotosBatch updates multiple photos in one pass and rewrites the sharded dataset once.
func (s *AdminServer) updatePhotosBatch(req BatchUpdateRequest) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	albums, _, err := s.galleryStore.LoadAlbums()
	if err != nil {
		return fmt.Errorf("failed to load gallery data: %w", err)
	}

	updatedCount := 0
	for _, filename := range req.Filenames {
		for i := range albums {
			for j := range albums[i].Photos {
				if albums[i].Photos[j].Filename != filename {
					continue
				}
				if req.Updates.Alt != nil {
					albums[i].Photos[j].Alt = *req.Updates.Alt
				}
				if req.Updates.IsHidden != nil {
					albums[i].Photos[j].IsHidden = *req.Updates.IsHidden
				}
				if req.Updates.Subject != nil {
					albums[i].Photos[j].Subject = req.Updates.Subject
				}
				updatedCount++
				goto nextFilename
			}
		}
	nextFilename:
	}

	if updatedCount == 0 {
		return fmt.Errorf("no matching photos found")
	}

	if _, err := s.galleryStore.SaveFull(albums); err != nil {
		return fmt.Errorf("failed to persist gallery data: %w", err)
	}
	return nil
}

// deletePhoto deletes a photo from its year shard, R2, and the local filesystem.
func (s *AdminServer) deletePhoto(year, filename string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	var targetPhoto photo.Photo
	if year == "" {
		foundYear, foundPhoto, err := s.findPhotoLocation(filename)
		if err != nil {
			return err
		}
		year = foundYear
		targetPhoto = foundPhoto
	} else {
		album, err := s.galleryStore.LoadYearAlbum(year)
		if err != nil {
			return fmt.Errorf("failed to load year shard: %w", err)
		}

		found := false
		for _, p := range album.Photos {
			if p.Filename == filename {
				targetPhoto = p
				found = true
				break
			}
		}
		if !found {
			return fmt.Errorf("photo not found: %s", filename)
		}
	}

	if _, err := s.galleryStore.DeletePhoto(year, filename); err != nil {
		return fmt.Errorf("failed to update gallery data: %w", err)
	}

	if s.R2Client != nil {
		var keysToDelete []string
		keysToDelete = append(
			keysToDelete,
			fmt.Sprintf("%s%s%s", s.R2Client.Config.BasePrefix, s.R2Client.Config.OriginalPrefix, filename),
		)

		filenameNoExt := strings.TrimSuffix(filename, filepath.Ext(filename))
		keysToDelete = append(
			keysToDelete,
			fmt.Sprintf("%s%s%s%s", s.R2Client.Config.BasePrefix, s.R2Client.Config.ThumbnailPrefix, filenameNoExt, photo.ExtWebP),
		)

		log.Printf("🟢 Deleting files from R2 for %s...\n", filename)
		if err := s.R2Client.DeleteObjects(keysToDelete); err != nil {
			log.Printf("Error deleting objects from R2: %v", err)
		} else {
			log.Printf("✓ Deleted files from R2")
		}
	}

	if targetPhoto.Year != "" {
		localPath := filepath.Join(s.imagesDir, targetPhoto.Year, filename)
		log.Printf("Deleting local file: %s\n", localPath)
		if err := os.Remove(localPath); err != nil && !os.IsNotExist(err) {
			log.Printf("Error deleting local file: %v", err)
		}
	}

	return nil
}

func (s *AdminServer) findPhotoLocation(filename string) (string, photo.Photo, error) {
	albums, _, err := s.galleryStore.LoadAlbums()
	if err != nil {
		return "", photo.Photo{}, err
	}

	for _, album := range albums {
		for _, p := range album.Photos {
			if p.Filename == filename {
				return album.Year, p, nil
			}
		}
	}

	return "", photo.Photo{}, fmt.Errorf("photo not found: %s", filename)
}

func applyPhotoUpdate(existing *photo.Photo, req PhotoUpdateRequest) (photo.Photo, bool) {
	if existing == nil {
		return photo.Photo{}, false
	}

	updated := *existing
	if req.Alt != nil {
		updated.Alt = *req.Alt
	}
	if req.IsHidden != nil {
		updated.IsHidden = *req.IsHidden
	}
	if req.Subject != nil {
		updated.Subject = req.Subject
	}
	return updated, true
}

// runRebuild executes the rebuild process
func (s *AdminServer) runRebuild() {
	defer func() {
		if r := recover(); r != nil {
			s.rebuildMutex.Lock()
			s.rebuildTask.Status = "failed"
			s.rebuildTask.Message = fmt.Sprintf("Rebuild panicked: %v", r)
			s.rebuildTask.EndTime = time.Now()
			s.rebuildTask.Logs = append(s.rebuildTask.Logs, fmt.Sprintf("❌ 重建失败: %v", r))
			s.rebuildMutex.Unlock()
		}
	}()

	s.addLog("📸 调用 photo.UpdatePhotosHandler...")
	s.updateProgress(10, "Processing photos...")

	// Create a channel for logs
	// Buffer it slightly to avoid blocking the processor too much
	logChan := make(chan string, 100)

	// Consume logs in a goroutine
	var logWg sync.WaitGroup
	logWg.Add(1)
	go func() {
		defer logWg.Done()
		for msg := range logChan {
			s.addLog(msg)
		}
	}()

	// Run the update
	photo.UpdatePhotosHandler(logChan)
	close(logChan)

	// Wait for logging to finish
	logWg.Wait()

	s.rebuildMutex.Lock()
	s.rebuildTask.Status = "completed"
	s.rebuildTask.Progress = 100
	s.rebuildTask.Message = "Rebuild completed successfully"
	s.rebuildTask.EndTime = time.Now()
	s.rebuildTask.Logs = append(s.rebuildTask.Logs, "✅ 重建完成！")
	s.rebuildMutex.Unlock()
}

// addLog adds a log entry to the rebuild task
func (s *AdminServer) addLog(message string) {
	s.rebuildMutex.Lock()
	s.rebuildTask.Logs = append(s.rebuildTask.Logs, message)
	s.rebuildMutex.Unlock()
}

// updateProgress updates the rebuild progress
func (s *AdminServer) updateProgress(progress int, message string) {
	s.rebuildMutex.Lock()
	s.rebuildTask.Progress = progress
	s.rebuildTask.Message = message
	s.rebuildMutex.Unlock()
}

// handlePhotoUpload handles POST /api/photos/upload
func (s *AdminServer) handlePhotoUpload(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Parse multipart form (max 100MB)
	err := r.ParseMultipartForm(100 << 20)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to parse form: %v", err), http.StatusBadRequest)
		return
	}

	file, header, err := r.FormFile("photo")
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to get file: %v", err), http.StatusBadRequest)
		return
	}
	defer file.Close()

	// Extract year from EXIF or use current year
	year := s.extractYearFromFile(file, header.Filename)

	// Reset file pointer
	file.Seek(0, 0)

	// Create target directory
	targetDir := filepath.Join(s.imagesDir, year)
	if err := os.MkdirAll(targetDir, 0755); err != nil {
		http.Error(w, fmt.Sprintf("Failed to create directory: %v", err), http.StatusInternalServerError)
		return
	}

	// Save file
	targetPath := filepath.Join(targetDir, header.Filename)
	dst, err := os.Create(targetPath)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to create file: %v", err), http.StatusInternalServerError)
		return
	}
	defer dst.Close()

	if _, err := io.Copy(dst, file); err != nil {
		http.Error(w, fmt.Sprintf("Failed to save file: %v", err), http.StatusInternalServerError)
		return
	}

	processedPhoto, err := s.processUploadedPhoto(targetPath, year, header.Filename)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to process uploaded photo: %v", err), http.StatusInternalServerError)
		return
	}

	// Return success response
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(
		map[string]string{
			"status":   "success",
			"filename": header.Filename,
			"year":     year,
			"date":     processedPhoto.Date,
		},
	)
}

func (s *AdminServer) processUploadedPhoto(targetPath, year, filename string) (photo.Photo, error) {
	processor, err := photo.NewPhotoProcessor()
	if err != nil {
		return photo.Photo{}, err
	}
	if s.R2Client != nil {
		processor.R2Client = s.R2Client
	}

	albums, _, err := s.galleryStore.LoadAlbums()
	if err == nil {
		for _, album := range albums {
			for _, item := range album.Photos {
				processor.ExistingPhotos[item.Filename] = item
			}
		}
	}

	processedPhoto, err := processor.ProcessPhoto(targetPath, year)
	if err != nil {
		return photo.Photo{}, err
	}

	if _, err := s.galleryStore.UpsertPhoto(processedPhoto); err != nil {
		return processedPhoto, err
	}

	log.Printf("✓ Uploaded and indexed photo: %s", filename)
	return processedPhoto, nil
}

// extractYearFromFile extracts year from EXIF or filename
func (s *AdminServer) extractYearFromFile(file io.ReadSeeker, filename string) string {
	// Try to create a temporary file for EXIF extraction
	tmpFile, err := os.CreateTemp("", "upload-*.jpg")
	if err == nil {
		defer os.Remove(tmpFile.Name())
		defer tmpFile.Close()

		// Copy to temp file
		file.Seek(0, 0)
		io.Copy(tmpFile, file)
		tmpFile.Sync()

		// Extract EXIF
		_, _, _, dateTaken, err := photo.GetExifExtractor().Extract(tmpFile.Name())
		if err == nil && !dateTaken.IsZero() {
			return fmt.Sprintf("%04d", dateTaken.Year())
		}
	}

	// Fallback: try to extract from filename (DSC_YYYY-MM-DD_*.jpg)
	if strings.HasPrefix(filename, "DSC_") && len(filename) > 13 {
		yearStr := filename[4:8]
		if _, err := strconv.Atoi(yearStr); err == nil {
			return yearStr
		}
	}

	// Default to current year
	return fmt.Sprintf("%04d", time.Now().Year())
}
