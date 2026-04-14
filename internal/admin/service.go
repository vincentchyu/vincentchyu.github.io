package admin

import (
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/vincentchyu/vincentchyu.github.io/internal/photo"
	"github.com/vincentchyu/vincentchyu.github.io/internal/storage"
)

type galleryStore interface {
	LoadAlbums() ([]photo.YearAlbum, *photo.GalleryManifest, error)
	LoadYearAlbum(year string) (photo.YearAlbum, error)
	SaveFull(albums []photo.YearAlbum) (photo.GalleryManifest, error)
	UpsertPhoto(photo photo.Photo) (photo.GalleryManifest, error)
	DeletePhoto(year, filename string) (photo.GalleryManifest, error)
}

type PhotoAdminService struct {
	rootDir   string
	imagesDir string
	store     galleryStore
	r2Client  *storage.R2Client
	extractor photo.ExifExtractor
}

type ListPhotosPageRequest struct {
	Cursor string
	Limit  int
	Search string
	Year   string
	Status string
}

type PhotoListItem struct {
	Filename  string   `json:"filename"`
	Path      string   `json:"path"`
	Thumbnail string   `json:"thumbnail"`
	Alt       string   `json:"alt"`
	Year      string   `json:"year"`
	Month     string   `json:"month"`
	Date      string   `json:"date"`
	Width     int      `json:"width,omitempty"`
	Height    int      `json:"height,omitempty"`
	IsHidden  bool     `json:"is_hidden"`
	Subject   []string `json:"Subject,omitempty"`
}

type PhotoListPage struct {
	Items       []PhotoListItem `json:"items"`
	NextCursor  string          `json:"next_cursor,omitempty"`
	HasMore     bool            `json:"has_more"`
	TotalCount  int             `json:"total_count"`
	HiddenCount int             `json:"hidden_count"`
	Years       []string        `json:"years"`
}

func NewPhotoAdminService(
	rootDir string,
	imagesDir string,
	store galleryStore,
	r2Client *storage.R2Client,
	extractor photo.ExifExtractor,
) *PhotoAdminService {
	if extractor == nil {
		extractor = photo.GetExifExtractor()
	}

	return &PhotoAdminService{
		rootDir:   rootDir,
		imagesDir: imagesDir,
		store:     store,
		r2Client:  r2Client,
		extractor: extractor,
	}
}

func (s *PhotoAdminService) ListAlbums() ([]photo.YearAlbum, error) {
	albums, _, err := s.store.LoadAlbums()
	return albums, err
}

func (s *PhotoAdminService) ListPhotosPage(req ListPhotosPageRequest) (PhotoListPage, error) {
	albums, _, err := s.store.LoadAlbums()
	if err != nil {
		return PhotoListPage{}, err
	}

	years := collectYears(albums)
	filtered := make([]photo.Photo, 0)
	searchTerm := strings.ToLower(strings.TrimSpace(req.Search))

	for _, album := range albums {
		for _, item := range album.Photos {
			if !matchesPhotoFilters(item, searchTerm, req.Year, req.Status) {
				continue
			}
			filtered = append(filtered, item)
		}
	}

	limit := req.Limit
	if limit <= 0 {
		limit = 120
	}
	if limit > 300 {
		limit = 300
	}

	offset, err := decodeCursor(req.Cursor)
	if err != nil {
		return PhotoListPage{}, fmt.Errorf("invalid cursor: %w", err)
	}
	if offset < 0 {
		offset = 0
	}
	if offset > len(filtered) {
		offset = len(filtered)
	}

	end := offset + limit
	if end > len(filtered) {
		end = len(filtered)
	}

	items := make([]PhotoListItem, 0, end-offset)
	for _, item := range filtered[offset:end] {
		items = append(items, toPhotoListItem(item))
	}

	page := PhotoListPage{
		Items:       items,
		HasMore:     end < len(filtered),
		TotalCount:  len(filtered),
		HiddenCount: countHiddenPhotos(filtered),
		Years:       years,
	}
	if page.HasMore {
		page.NextCursor = encodeCursor(end)
	}

	return page, nil
}

func (s *PhotoAdminService) UpdatePhoto(year, filename string, req PhotoUpdateRequest) error {
	if year != "" {
		album, err := s.store.LoadYearAlbum(year)
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

		if _, err := s.store.UpsertPhoto(updated); err != nil {
			return fmt.Errorf("failed to persist photo update: %w", err)
		}
		return nil
	}

	albums, _, err := s.store.LoadAlbums()
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

	if _, err := s.store.SaveFull(albums); err != nil {
		return fmt.Errorf("failed to persist gallery data: %w", err)
	}
	return nil
}

func (s *PhotoAdminService) UpdatePhotosBatch(req BatchUpdateRequest) error {
	albums, _, err := s.store.LoadAlbums()
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

	if _, err := s.store.SaveFull(albums); err != nil {
		return fmt.Errorf("failed to persist gallery data: %w", err)
	}
	return nil
}

func (s *PhotoAdminService) DeletePhoto(year, filename string) error {
	var targetPhoto photo.Photo
	if year == "" {
		foundYear, foundPhoto, err := s.findPhotoLocation(filename)
		if err != nil {
			return err
		}
		year = foundYear
		targetPhoto = foundPhoto
	} else {
		album, err := s.store.LoadYearAlbum(year)
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

	if _, err := s.store.DeletePhoto(year, filename); err != nil {
		return fmt.Errorf("failed to update gallery data: %w", err)
	}

	if s.r2Client != nil {
		keysToDelete := []string{
			fmt.Sprintf("%s%s%s", s.r2Client.Config.BasePrefix, s.r2Client.Config.OriginalPrefix, filename),
		}

		filenameNoExt := strings.TrimSuffix(filename, filepath.Ext(filename))
		keysToDelete = append(
			keysToDelete,
			fmt.Sprintf("%s%s%s%s", s.r2Client.Config.BasePrefix, s.r2Client.Config.ThumbnailPrefix, filenameNoExt, photo.ExtWebP),
		)

		log.Printf("🟢 Deleting files from R2 for %s...\n", filename)
		if err := s.r2Client.DeleteObjects(keysToDelete); err != nil {
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

func (s *PhotoAdminService) RebuildGallery(logChan chan<- string) error {
	return photo.RunUpdatePhotosWithRoot(s.rootDir, logChan)
}

func (s *PhotoAdminService) ExtractYearFromFile(file io.ReadSeeker, filename string) string {
	tmpFile, err := os.CreateTemp("", "upload-*.jpg")
	if err == nil {
		defer os.Remove(tmpFile.Name())
		defer tmpFile.Close()

		file.Seek(0, 0)
		io.Copy(tmpFile, file)
		tmpFile.Sync()

		_, _, _, dateTaken, err := s.extractor.Extract(tmpFile.Name())
		if err == nil && !dateTaken.IsZero() {
			return fmt.Sprintf("%04d", dateTaken.Year())
		}
	}

	if strings.HasPrefix(filename, "DSC_") && len(filename) > 13 {
		yearStr := filename[4:8]
		if _, err := strconv.Atoi(yearStr); err == nil {
			return yearStr
		}
	}

	return fmt.Sprintf("%04d", time.Now().Year())
}

func (s *PhotoAdminService) ProcessUploadedPhoto(targetPath, year, filename string) (photo.Photo, error) {
	processor, err := photo.NewPhotoProcessorWithRoot(s.rootDir)
	if err != nil {
		return photo.Photo{}, err
	}
	if s.r2Client != nil {
		processor.R2Client = s.r2Client
	}

	albums, _, err := s.store.LoadAlbums()
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

	if _, err := s.store.UpsertPhoto(processedPhoto); err != nil {
		return processedPhoto, err
	}

	log.Printf("✓ Uploaded and indexed photo: %s", filename)
	return processedPhoto, nil
}

func matchesPhotoFilters(item photo.Photo, searchTerm, year, status string) bool {
	if searchTerm != "" && !strings.Contains(strings.ToLower(item.Filename), searchTerm) {
		return false
	}
	if year != "" && item.Year != year {
		return false
	}

	switch status {
	case "hidden":
		return item.IsHidden
	case "visible":
		return !item.IsHidden
	default:
		return true
	}
}

func toPhotoListItem(item photo.Photo) PhotoListItem {
	return PhotoListItem{
		Filename:  item.Filename,
		Path:      item.Path,
		Thumbnail: item.Thumbnail,
		Alt:       item.Alt,
		Year:      item.Year,
		Month:     item.Month,
		Date:      item.Date,
		Width:     item.Width,
		Height:    item.Height,
		IsHidden:  item.IsHidden,
		Subject:   item.Subject,
	}
}

func countHiddenPhotos(items []photo.Photo) int {
	count := 0
	for _, item := range items {
		if item.IsHidden {
			count++
		}
	}
	return count
}

func collectYears(albums []photo.YearAlbum) []string {
	years := make([]string, 0, len(albums))
	for _, album := range albums {
		if album.Year == "" {
			continue
		}
		years = append(years, album.Year)
	}
	return years
}

func decodeCursor(cursor string) (int, error) {
	if cursor == "" {
		return 0, nil
	}
	return strconv.Atoi(cursor)
}

func encodeCursor(offset int) string {
	return strconv.Itoa(offset)
}

func (s *PhotoAdminService) findPhotoLocation(filename string) (string, photo.Photo, error) {
	albums, _, err := s.store.LoadAlbums()
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
