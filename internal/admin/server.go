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
	"github.com/vincentchyu/vincentchyu.github.io/pkg/config"
)

// AdminServer manages the photo admin HTTP server
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
	rootDir, err := config.ResolveRootDir("")
	if err != nil {
		return nil, fmt.Errorf("resolve root dir: %w", err)
	}

	return NewAdminServerWithRoot(rootDir)
}

func NewAdminServerWithRoot(rootDir string) (*AdminServer, error) {
	paths := config.NewPaths(rootDir)
	publishers := storage.LoadPublisherRegistryFromEnv()
	galleryStore := photo.NewGalleryStore(rootDir, publishers)

	server := &AdminServer{
		rootDir:      rootDir,
		photosPath:   filepath.Join(rootDir, photo.LegacyGalleryPath),
		imagesDir:    paths.ImagesDir,
		galleryStore: galleryStore,
		publishers:   publishers,
		rebuildTask: &RebuildTask{
			Status: "idle",
			Logs:   []string{},
		},
	}
	server.service = NewPhotoAdminService(rootDir, paths.ImagesDir, galleryStore, publishers, photo.GetExifExtractor())

	return server, nil
}

// StartAdminServer starts the HTTP server
func StartAdminServer(addr string) error {
	rootDir, err := config.ResolveRootDir("")
	if err != nil {
		return err
	}

	return StartAdminServerWithRoot(addr, rootDir)
}

func StartAdminServerWithRoot(addr string, rootDir string) error {
	server, err := NewAdminServerWithRoot(rootDir)
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
	mux.HandleFunc("/api/gallery-source", loggingMiddleware(server.handleGallerySource))
	mux.HandleFunc("/api/images/", loggingMiddleware(server.handleImageServe))
	mux.HandleFunc("/api/proxy", loggingMiddleware(server.handleProxy))

	// Static files
	webAdminDir := config.NewPaths(server.rootDir).AdminDir
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

	w.Header().Set("Content-Type", "application/json")

	if shouldReturnPhotoPage(r) {
		pageReq, err := parsePhotoPageRequest(r)
		if err != nil {
			http.Error(w, fmt.Sprintf("Invalid paging parameters: %v", err), http.StatusBadRequest)
			return
		}

		page, err := s.service.ListPhotosPage(pageReq)
		if err != nil {
			http.Error(w, fmt.Sprintf("Failed to read gallery data: %v", err), http.StatusInternalServerError)
			return
		}

		json.NewEncoder(w).Encode(page)
		return
	}

	albums, err := s.service.ListAlbums()
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to read gallery data: %v", err), http.StatusInternalServerError)
		return
	}

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

func shouldReturnPhotoPage(r *http.Request) bool {
	query := r.URL.Query()
	if query.Get("format") == "page" {
		return true
	}

	keys := []string{"cursor", "limit", "search", "year", "status"}
	for _, key := range keys {
		if query.Get(key) != "" {
			return true
		}
	}
	return false
}

func parsePhotoPageRequest(r *http.Request) (ListPhotosPageRequest, error) {
	query := r.URL.Query()
	req := ListPhotosPageRequest{
		Cursor: query.Get("cursor"),
		Search: query.Get("search"),
		Year:   query.Get("year"),
		Status: query.Get("status"),
	}

	if limitStr := query.Get("limit"); limitStr != "" {
		limit, err := strconv.Atoi(limitStr)
		if err != nil {
			return ListPhotosPageRequest{}, err
		}
		req.Limit = limit
	}

	return req, nil
}

// handlePhotoUpdate handles PUT /api/photos/:filename
func (s *AdminServer) handlePhotoUpdate(w http.ResponseWriter, r *http.Request, year, filename string) {
	var req PhotoUpdateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, fmt.Sprintf("Invalid request body: %v", err), http.StatusBadRequest)
		return
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	if err := s.service.UpdatePhoto(year, filename, req); err != nil {
		http.Error(w, fmt.Sprintf("Failed to update photo: %v", err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "success"})
}

// handlePhotoDelete handles DELETE /api/photos/:filename
func (s *AdminServer) handlePhotoDelete(w http.ResponseWriter, r *http.Request, year, filename string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if err := s.service.DeletePhoto(year, filename); err != nil {
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

	s.mu.Lock()
	defer s.mu.Unlock()

	if err := s.service.UpdatePhotosBatch(req); err != nil {
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

	force := r.URL.Query().Get("force") == "true"

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
	go s.runRebuild(force)

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

func (s *AdminServer) handleGallerySource(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		s.handleGallerySourceGet(w, r)
	case http.MethodPut:
		s.handleGallerySourceUpdate(w, r)
	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *AdminServer) handleGallerySourceGet(w http.ResponseWriter, r *http.Request) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	response, err := s.service.GetGallerySource()
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to load gallery source: %v", err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

func (s *AdminServer) handleGallerySourceUpdate(w http.ResponseWriter, r *http.Request) {
	var req GallerySourceUpdateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, fmt.Sprintf("Invalid request body: %v", err), http.StatusBadRequest)
		return
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	response, err := s.service.UpdateGallerySource(req)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to update gallery source: %v", err), http.StatusBadRequest)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
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
func (s *AdminServer) runRebuild(force bool) {
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

	s.addLog("📸 调用照片重建服务...")
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
	err := s.service.RebuildGallery(logChan, force)
	close(logChan)

	// Wait for logging to finish
	logWg.Wait()

	if err != nil {
		s.rebuildMutex.Lock()
		s.rebuildTask.Status = "failed"
		s.rebuildTask.Progress = 100
		s.rebuildTask.Message = fmt.Sprintf("Rebuild failed: %v", err)
		s.rebuildTask.EndTime = time.Now()
		s.rebuildTask.Logs = append(s.rebuildTask.Logs, fmt.Sprintf("❌ 重建失败: %v", err))
		s.rebuildMutex.Unlock()
		return
	}

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
	year := s.service.ExtractYearFromFile(file, header.Filename)

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

	s.mu.Lock()
	processedPhoto, err := s.service.ProcessUploadedPhoto(targetPath, year, header.Filename)
	s.mu.Unlock()
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
