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
	LoadSourceConfig() (photo.GallerySourceConfig, error)
	SaveSourceConfig(cfg photo.GallerySourceConfig) error
	BuildSourceStatuses(manifest photo.GalleryManifest) []photo.GallerySourceStatus
	ValidateSourceHealth(source photo.GallerySource, manifest photo.GalleryManifest) error
	ResolvePublicURL(source photo.GallerySource, asset string) string
}

type PhotoAdminService struct {
	rootDir    string
	imagesDir  string
	store      galleryStore
	publishers *storage.PublisherRegistry
	extractor  photo.ExifExtractor
}

func NewPhotoAdminService(
	rootDir string,
	imagesDir string,
	store galleryStore,
	publishers *storage.PublisherRegistry,
	extractor photo.ExifExtractor,
) *PhotoAdminService {
	if extractor == nil {
		extractor = photo.GetExifExtractor()
	}

	return &PhotoAdminService{
		rootDir:    rootDir,
		imagesDir:  imagesDir,
		store:      store,
		publishers: publishers,
		extractor:  extractor,
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

	sourceConfig, err := s.store.LoadSourceConfig()
	if err != nil {
		return PhotoListPage{}, fmt.Errorf("load gallery source config: %w", err)
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
		items = append(items, s.toPhotoListItem(item, sourceConfig.ActiveSource))
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

	if s.publishers != nil {
		filenameNoExt := strings.TrimSuffix(filename, filepath.Ext(filename))
		keysToDelete := []string{
			s.publishers.Layout().OriginalKey(filename),
			s.publishers.Layout().ThumbnailKey(filenameNoExt),
		}

		log.Printf("🟢 Deleting files from remote storage for %s...\n", filename)
		if err := s.publishers.DeleteObjectsFromAll(keysToDelete); err != nil {
			log.Printf("Error deleting remote objects: %v", err)
		} else {
			log.Printf("✓ Deleted files from remote storage")
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

func (s *PhotoAdminService) RebuildGallery(logChan chan<- string, force bool) error {
	return photo.RunUpdatePhotosWithRoot(s.rootDir, logChan, force)
}

func (s *PhotoAdminService) GetGallerySource() (GallerySourceResponse, error) {
	config, err := s.store.LoadSourceConfig()
	if err != nil {
		return GallerySourceResponse{}, err
	}

	_, manifest, err := s.store.LoadAlbums()
	if err != nil {
		return GallerySourceResponse{}, err
	}

	response := GallerySourceResponse{
		Config: config,
	}
	if manifest != nil {
		response.Statuses = s.store.BuildSourceStatuses(*manifest)
		for i := range response.Statuses {
			if response.Statuses[i].PublicBase == "" {
				response.Statuses[i].PublicBase = config.Sources[response.Statuses[i].Provider].PublicBase
			}
		}
	}
	return response, nil
}

func (s *PhotoAdminService) UpdateGallerySource(req GallerySourceUpdateRequest) (GallerySourceResponse, error) {
	if req.ActiveSource != photo.GallerySourceR2 && req.ActiveSource != photo.GallerySourceTOS {
		return GallerySourceResponse{}, fmt.Errorf("unsupported source: %s", req.ActiveSource)
	}

	_, manifest, err := s.store.LoadAlbums()
	if err != nil {
		return GallerySourceResponse{}, err
	}
	if manifest == nil {
		manifest = &photo.GalleryManifest{}
	}
	if err := s.store.ValidateSourceHealth(req.ActiveSource, *manifest); err != nil {
		return GallerySourceResponse{}, err
	}

	cfg, err := s.store.LoadSourceConfig()
	if err != nil {
		return GallerySourceResponse{}, err
	}
	cfg.ActiveSource = req.ActiveSource
	if err := s.store.SaveSourceConfig(cfg); err != nil {
		return GallerySourceResponse{}, err
	}

	return s.GetGallerySource()
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
	if s.publishers != nil {
		processor.Publishers = s.publishers
		processor.Layout = s.publishers.Layout()
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

func (s *PhotoAdminService) toPhotoListItem(item photo.Photo, activeSource photo.GallerySource) PhotoListItem {
	sourceURLs := PhotoSourceURLs{
		R2: PhotoSourceURL{
			Path:      s.store.ResolvePublicURL(photo.GallerySourceR2, item.Path),
			Thumbnail: s.store.ResolvePublicURL(photo.GallerySourceR2, item.Thumbnail),
		},
		TOS: PhotoSourceURL{
			Path:      s.store.ResolvePublicURL(photo.GallerySourceTOS, item.Path),
			Thumbnail: s.store.ResolvePublicURL(photo.GallerySourceTOS, item.Thumbnail),
		},
	}

	resolvedPath := item.Path
	resolvedThumbnail := item.Thumbnail
	switch activeSource {
	case photo.GallerySourceR2:
		resolvedPath = sourceURLs.R2.Path
		resolvedThumbnail = sourceURLs.R2.Thumbnail
	case photo.GallerySourceTOS:
		resolvedPath = sourceURLs.TOS.Path
		resolvedThumbnail = sourceURLs.TOS.Thumbnail
	}

	return PhotoListItem{
		Filename:   item.Filename,
		Path:       resolvedPath,
		Thumbnail:  resolvedThumbnail,
		Alt:        item.Alt,
		Year:       item.Year,
		Month:      item.Month,
		Date:       item.Date,
		Width:      item.Width,
		Height:     item.Height,
		IsHidden:   item.IsHidden,
		Subject:    item.Subject,
		SourceURLs: sourceURLs,
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
