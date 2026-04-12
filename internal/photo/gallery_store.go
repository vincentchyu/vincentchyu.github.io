package photo

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/vincentchyu/vincentchyu.github.io/internal/storage"
)

const (
	GalleryWebRoot          = "web/photography"
	GalleryDataDir          = "web/photography/data"
	GalleryYearsDir         = "web/photography/data/photos"
	GalleryManifestPathName = "web/photography/data/photos-manifest.json"
	LegacyGalleryPath       = "web/photography/photos.json"
	GalleryRemoteDataPrefix = "pages/"

	GalleryManifestVersion = "1"

	GalleryManifestKVKey = "cache:photos:manifest"
	GalleryYearKVPrefix  = "cache:photos:year:"
)

// GalleryMonthSummary summarizes the visible layout of a month in a year shard.
type GalleryMonthSummary struct {
	Month string `json:"month"`
	Count int    `json:"count"`
	Cover string `json:"cover,omitempty"`
}

// GalleryYearSummary summarizes a year shard in the public manifest.
type GalleryYearSummary struct {
	Year      string                `json:"year"`
	Count     int                   `json:"count"`
	UpdatedAt string                `json:"updated_at,omitempty"`
	Cover     string                `json:"cover,omitempty"`
	Path      string                `json:"path"`
	Months    []GalleryMonthSummary `json:"months,omitempty"`
}

// GalleryManifest is the small entrypoint loaded by the public photography page.
type GalleryManifest struct {
	Version     string               `json:"version"`
	GeneratedAt string               `json:"generated_at"`
	Years       []GalleryYearSummary `json:"years"`
}

// GalleryStore reads and writes the sharded photography dataset.
type GalleryStore struct {
	RootDir  string
	R2Client *storage.R2Client
}

// NewGalleryStore builds a store rooted at the current workspace.
func NewGalleryStore(rootDir string, r2Client *storage.R2Client) *GalleryStore {
	return &GalleryStore{
		RootDir:  rootDir,
		R2Client: r2Client,
	}
}

func (s *GalleryStore) manifestLocalPath() string {
	return filepath.Join(s.RootDir, GalleryManifestPathName)
}

func (s *GalleryStore) yearLocalPath(year string) string {
	return filepath.Join(s.RootDir, GalleryYearsDir, year+".json")
}

func (s *GalleryStore) legacyLocalPath() string {
	return filepath.Join(s.RootDir, LegacyGalleryPath)
}

func (s *GalleryStore) manifestPublicPath() string {
	return filepath.ToSlash(filepath.Join(GalleryRemoteDataPrefix, "photos-manifest.json"))
}

func (s *GalleryStore) yearPublicPath(year string) string {
	return filepath.ToSlash(filepath.Join(GalleryRemoteDataPrefix, "photos", year+".json"))
}

func (s *GalleryStore) manifestR2Key() string {
	return filepath.ToSlash(filepath.Join(GalleryRemoteDataPrefix, "photos-manifest.json"))
}

func (s *GalleryStore) yearR2Key(year string) string {
	return filepath.ToSlash(filepath.Join(GalleryRemoteDataPrefix, "photos", year+".json"))
}

func (s *GalleryStore) legacyR2Key() string {
	if s.R2Client == nil {
		return ""
	}
	return fmt.Sprintf("%sphotos.json", s.R2Client.Config.BasePrefix)
}

func (s *GalleryStore) yearKVKey(year string) string {
	return GalleryYearKVPrefix + year
}

func (s *GalleryStore) manifestKVKey() string {
	return GalleryManifestKVKey
}

// LoadAlbums loads the current dataset from the sharded manifest, falling back to the legacy aggregate.
func (s *GalleryStore) LoadAlbums() ([]YearAlbum, *GalleryManifest, error) {
	if manifest, albums, err := s.loadFromManifest(); err == nil {
		return albums, &manifest, nil
	}

	albums, err := s.loadFromLegacy()
	if err != nil {
		return nil, nil, err
	}

	manifest := buildManifest(albums)
	return albums, &manifest, nil
}

func (s *GalleryStore) loadFromManifest() (GalleryManifest, []YearAlbum, error) {
	data, err := os.ReadFile(s.manifestLocalPath())
	if err != nil {
		return GalleryManifest{}, nil, err
	}

	var manifest GalleryManifest
	if err := json.Unmarshal(data, &manifest); err != nil {
		return GalleryManifest{}, nil, err
	}

	if len(manifest.Years) == 0 {
		return manifest, []YearAlbum{}, nil
	}

	albums := make([]YearAlbum, 0, len(manifest.Years))
	for _, yearSummary := range manifest.Years {
		album, err := s.loadYearAlbum(yearSummary.Year)
		if err != nil {
			return GalleryManifest{}, nil, err
		}
		albums = append(albums, album)
	}

	sortAlbums(albums)
	return manifest, albums, nil
}

// LoadYearAlbum loads a single year shard, falling back to the legacy export if needed.
func (s *GalleryStore) LoadYearAlbum(year string) (YearAlbum, error) {
	if album, err := s.loadYearAlbum(year); err == nil {
		return album, nil
	}

	albums, err := s.loadFromLegacy()
	if err != nil {
		return YearAlbum{}, err
	}

	for _, album := range albums {
		if album.Year == year {
			return album, nil
		}
	}

	return YearAlbum{Year: year}, fmt.Errorf("year not found: %s", year)
}

func (s *GalleryStore) loadYearAlbum(year string) (YearAlbum, error) {
	data, err := os.ReadFile(s.yearLocalPath(year))
	if err != nil {
		return YearAlbum{}, err
	}

	var album YearAlbum
	if err := json.Unmarshal(data, &album); err != nil {
		return YearAlbum{}, err
	}

	if album.Year == "" {
		album.Year = year
	}

	normalizeYearAlbum(&album)
	return album, nil
}

func (s *GalleryStore) loadFromLegacy() ([]YearAlbum, error) {
	data, err := os.ReadFile(s.legacyLocalPath())
	if err != nil {
		return nil, err
	}

	var albums []YearAlbum
	if err := json.Unmarshal(data, &albums); err != nil {
		return nil, err
	}

	normalizeAlbums(albums)
	return albums, nil
}

// SaveFull writes all shards, refreshes the manifest and publishes the dataset.
func (s *GalleryStore) SaveFull(albums []YearAlbum) (GalleryManifest, error) {
	normalizeAlbums(albums)

	if err := os.MkdirAll(filepath.Join(s.RootDir, GalleryYearsDir), 0o755); err != nil {
		return GalleryManifest{}, err
	}

	manifest := buildManifest(albums)
	if err := s.writeAlbums(albums); err != nil {
		return GalleryManifest{}, err
	}
	if err := s.writeManifest(manifest); err != nil {
		return GalleryManifest{}, err
	}
	if err := s.uploadManifestAndAlbums(manifest, albums); err != nil {
		return GalleryManifest{}, err
	}

	return manifest, nil
}

// UpsertPhoto updates or inserts one photo inside its year shard and refreshes the manifest.
func (s *GalleryStore) UpsertPhoto(photo Photo) (GalleryManifest, error) {
	if photo.Year == "" {
		photo.Year = time.Now().Format("2006")
	}

	album, err := s.loadYearAlbumIfExists(photo.Year)
	if err != nil {
		return GalleryManifest{}, err
	}

	replaced := false
	for i := range album.Photos {
		if album.Photos[i].Filename == photo.Filename {
			album.Photos[i] = photo
			replaced = true
			break
		}
	}
	if !replaced {
		album.Photos = append(album.Photos, photo)
	}

	normalizeYearAlbum(&album)
	if err := s.writeAlbum(album); err != nil {
		return GalleryManifest{}, err
	}

	manifest, err := s.loadManifestForMutation()
	if err != nil {
		return GalleryManifest{}, err
	}
	manifest = upsertManifestYear(manifest, album)
	if err := s.writeManifest(manifest); err != nil {
		return GalleryManifest{}, err
	}
	if err := s.uploadYear(album); err != nil {
		return GalleryManifest{}, err
	}
	if err := s.uploadManifest(manifest); err != nil {
		return GalleryManifest{}, err
	}

	return manifest, nil
}

// DeletePhoto removes a photo from the given year shard and refreshes the manifest.
func (s *GalleryStore) DeletePhoto(year, filename string) (GalleryManifest, error) {
	if year == "" {
		return GalleryManifest{}, fmt.Errorf("year is required for delete")
	}

	album, err := s.loadYearAlbumIfExists(year)
	if err != nil {
		return GalleryManifest{}, err
	}

	newPhotos := make([]Photo, 0, len(album.Photos))
	removed := false
	for _, p := range album.Photos {
		if p.Filename == filename {
			removed = true
			continue
		}
		newPhotos = append(newPhotos, p)
	}
	if !removed {
		return GalleryManifest{}, fmt.Errorf("photo not found: %s", filename)
	}

	album.Photos = newPhotos
	normalizeYearAlbum(&album)

	manifest, err := s.loadManifestForMutation()
	if err != nil {
		return GalleryManifest{}, err
	}

	if len(album.Photos) == 0 {
		if err := s.deleteAlbumFiles(year); err != nil {
			return GalleryManifest{}, err
		}
		manifest = removeManifestYear(manifest, year)
		if err := s.deleteYearR2(year); err != nil {
			return GalleryManifest{}, err
		}
	} else {
		if err := s.writeAlbum(album); err != nil {
			return GalleryManifest{}, err
		}
		manifest = upsertManifestYear(manifest, album)
		if err := s.uploadYear(album); err != nil {
			return GalleryManifest{}, err
		}
	}

	if err := s.writeManifest(manifest); err != nil {
		return GalleryManifest{}, err
	}
	if err := s.uploadManifest(manifest); err != nil {
		return GalleryManifest{}, err
	}

	return manifest, nil
}

func (s *GalleryStore) loadManifestForMutation() (GalleryManifest, error) {
	data, err := os.ReadFile(s.manifestLocalPath())
	if err != nil {
		albums, loadErr := s.loadFromLegacy()
		if loadErr != nil {
			return GalleryManifest{}, err
		}
		return buildManifest(albums), nil
	}

	var manifest GalleryManifest
	if err := json.Unmarshal(data, &manifest); err != nil {
		return GalleryManifest{}, err
	}
	return manifest, nil
}

func (s *GalleryStore) loadYearAlbumIfExists(year string) (YearAlbum, error) {
	if _, err := os.Stat(s.yearLocalPath(year)); err == nil {
		return s.loadYearAlbum(year)
	}

	albums, err := s.loadFromLegacy()
	if err != nil {
		return YearAlbum{Year: year}, nil
	}

	for _, album := range albums {
		if album.Year == year {
			return album, nil
		}
	}

	return YearAlbum{Year: year}, nil
}

func (s *GalleryStore) writeAlbums(albums []YearAlbum) error {
	for _, album := range albums {
		if err := s.writeAlbum(album); err != nil {
			return err
		}
	}
	return nil
}

func (s *GalleryStore) writeAlbum(album YearAlbum) error {
	path := s.yearLocalPath(album.Year)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}

	data, err := json.MarshalIndent(album, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0o644)
}

func (s *GalleryStore) deleteAlbumFiles(year string) error {
	path := s.yearLocalPath(year)
	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

func (s *GalleryStore) writeManifest(manifest GalleryManifest) error {
	if err := os.MkdirAll(filepath.Dir(s.manifestLocalPath()), 0o755); err != nil {
		return err
	}

	data, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(s.manifestLocalPath(), data, 0o644)
}

func (s *GalleryStore) writeLegacyExport(albums []YearAlbum) error {
	data, err := json.MarshalIndent(albums, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(s.legacyLocalPath(), data, 0o644)
}

func (s *GalleryStore) uploadManifestAndAlbums(manifest GalleryManifest, albums []YearAlbum) error {
	if err := s.uploadManifest(manifest); err != nil {
		return err
	}
	for _, album := range albums {
		if err := s.uploadYear(album); err != nil {
			return err
		}
	}
	return nil
}

func (s *GalleryStore) uploadManifestAndYear(manifest GalleryManifest, album YearAlbum) error {
	if err := s.uploadManifest(manifest); err != nil {
		return err
	}
	return s.uploadYear(album)
}

func (s *GalleryStore) uploadManifest(manifest GalleryManifest) error {
	data, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return err
	}
	if s.R2Client != nil {
		if err := s.R2Client.UploadBytes(data, s.manifestR2Key(), "application/json", "no-cache"); err != nil {
			return err
		}
	}

	if storage.CFCli != nil {
		if err := storage.CfKvSetValue(s.manifestKVKey(), string(data), 86400); err != nil {
			return err
		}
	}

	return nil
}

func (s *GalleryStore) uploadYear(album YearAlbum) error {
	data, err := json.MarshalIndent(album, "", "  ")
	if err != nil {
		return err
	}
	if s.R2Client != nil {
		if err := s.R2Client.UploadBytes(data, s.yearR2Key(album.Year), "application/json", "no-cache"); err != nil {
			return err
		}
	}

	if storage.CFCli != nil {
		if err := storage.CfKvSetValue(s.yearKVKey(album.Year), string(data), 86400); err != nil {
			return err
		}
	}

	return nil
}

func (s *GalleryStore) deleteYearR2(year string) error {
	if s.R2Client == nil {
		return nil
	}

	return s.R2Client.DeleteObject(s.yearR2Key(year))
}

func buildManifest(albums []YearAlbum) GalleryManifest {
	normalizeAlbums(albums)

	manifest := GalleryManifest{
		Version:     GalleryManifestVersion,
		GeneratedAt: time.Now().UTC().Format(time.RFC3339),
		Years:       make([]GalleryYearSummary, 0, len(albums)),
	}

	for _, album := range albums {
		manifest.Years = append(manifest.Years, buildYearSummary(album))
	}

	return manifest
}

func buildYearSummary(album YearAlbum) GalleryYearSummary {
	summary := GalleryYearSummary{
		Year:  album.Year,
		Count: len(album.Photos),
		Path:  publicYearPath(album.Year),
	}

	if len(album.Photos) > 0 {
		summary.Cover = firstNonEmptyThumbnail(album.Photos)
		summary.UpdatedAt = mostRecentPhotoTime(album.Photos).UTC().Format(time.RFC3339)
		summary.Months = buildMonthSummaries(album.Photos)
	}

	return summary
}

func upsertManifestYear(manifest GalleryManifest, album YearAlbum) GalleryManifest {
	manifest.Version = GalleryManifestVersion
	manifest.GeneratedAt = time.Now().UTC().Format(time.RFC3339)

	replaced := false
	for i := range manifest.Years {
		if manifest.Years[i].Year == album.Year {
			manifest.Years[i] = buildYearSummary(album)
			replaced = true
			break
		}
	}
	if !replaced {
		manifest.Years = append(manifest.Years, buildYearSummary(album))
	}

	sort.Slice(manifest.Years, func(i, j int) bool {
		return manifest.Years[i].Year > manifest.Years[j].Year
	})
	return manifest
}

func removeManifestYear(manifest GalleryManifest, year string) GalleryManifest {
	next := make([]GalleryYearSummary, 0, len(manifest.Years))
	for _, entry := range manifest.Years {
		if entry.Year == year {
			continue
		}
		next = append(next, entry)
	}
	manifest.Version = GalleryManifestVersion
	manifest.GeneratedAt = time.Now().UTC().Format(time.RFC3339)
	manifest.Years = next
	return manifest
}

func buildMonthSummaries(photos []Photo) []GalleryMonthSummary {
	type monthBucket struct {
		count int
		cover string
	}

	buckets := make(map[string]*monthBucket)
	order := make([]string, 0)
	for _, photo := range photos {
		month := photo.Month
		if month == "" {
			month = "01"
		}
		bucket, ok := buckets[month]
		if !ok {
			bucket = &monthBucket{}
			buckets[month] = bucket
			order = append(order, month)
		}
		bucket.count++
		if bucket.cover == "" {
			bucket.cover = firstPhotoThumbnail(photo)
		}
	}

	sort.Slice(order, func(i, j int) bool {
		return order[i] > order[j]
	})

	summaries := make([]GalleryMonthSummary, 0, len(order))
	for _, month := range order {
		bucket := buckets[month]
		summaries = append(summaries, GalleryMonthSummary{
			Month: month,
			Count: bucket.count,
			Cover: bucket.cover,
		})
	}
	return summaries
}

func firstPhotoThumbnail(photo Photo) string {
	if photo.Thumbnail != "" {
		return photo.Thumbnail
	}
	return photo.Path
}

func firstNonEmptyThumbnail(photos []Photo) string {
	for _, photo := range photos {
		if thumb := firstPhotoThumbnail(photo); thumb != "" {
			return thumb
		}
	}
	return ""
}

func mostRecentPhotoTime(photos []Photo) time.Time {
	if len(photos) == 0 {
		return time.Now()
	}

	best := photos[0]
	bestTime := photoSortTime(best)
	for _, p := range photos[1:] {
		if t := photoSortTime(p); t.After(bestTime) {
			best = p
			bestTime = t
		}
	}
	_ = best
	return bestTime
}

func photoSortTime(photo Photo) time.Time {
	if photo.Timestamp > 0 {
		return time.Unix(photo.Timestamp, 0)
	}

	if exifTime, ok := photo.Exif["DateTimeOriginal"].(string); ok {
		if t, err := time.Parse("2006:01:02 15:04:05", exifTime); err == nil {
			return t
		}
	}

	if parsed, err := time.Parse("2006-01-02", photo.Date); err == nil {
		return parsed
	}

	return time.Time{}
}

func normalizeAlbums(albums []YearAlbum) {
	for i := range albums {
		normalizeYearAlbum(&albums[i])
	}
	sortAlbums(albums)
}

func normalizeYearAlbum(album *YearAlbum) {
	if album == nil {
		return
	}

	for i := range album.Photos {
		restorePhotoState(&album.Photos[i])
	}
	sortPhotos(album.Photos)
}

func sortAlbums(albums []YearAlbum) {
	sort.Slice(albums, func(i, j int) bool {
		return albums[i].Year > albums[j].Year
	})
}

func sortPhotos(photos []Photo) {
	sort.Slice(photos, func(i, j int) bool {
		if photos[i].Date != photos[j].Date {
			return photos[i].Date > photos[j].Date
		}
		if photos[i].Timestamp != photos[j].Timestamp {
			return photos[i].Timestamp > photos[j].Timestamp
		}
		return photos[i].Filename > photos[j].Filename
	})
}

func restorePhotoState(photo *Photo) {
	if photo == nil {
		return
	}

	if photo.Timestamp > 0 {
		return
	}

	if exifTime, ok := photo.Exif["DateTimeOriginal"].(string); ok {
		if t, err := time.Parse("2006:01:02 15:04:05", exifTime); err == nil {
			photo.Timestamp = t.Unix()
			return
		}
	}

	if parsed, err := time.Parse("2006-01-02", photo.Date); err == nil {
		photo.Timestamp = parsed.Unix()
	}
}

func publicYearPath(year string) string {
	return filepath.ToSlash(filepath.Join(GalleryRemoteDataPrefix, "photos", year+".json"))
}

func albumsEqual(a, b []YearAlbum) bool {
	left, err := json.Marshal(a)
	if err != nil {
		return false
	}
	right, err := json.Marshal(b)
	if err != nil {
		return false
	}
	return strings.TrimSpace(string(left)) == strings.TrimSpace(string(right))
}
