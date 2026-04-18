package photo

import (
	"fmt"
	"os"
	"path/filepath"
	"time"
)

type LegacyGalleryReader interface {
	LoadAlbums() ([]YearAlbum, error)
	LoadYearAlbum(year string) (YearAlbum, error)
}

type GalleryPublisher interface {
	PublishManifestAndAlbums(manifest GalleryManifest, albums []YearAlbum) error
	PublishManifest(manifest GalleryManifest) error
	PublishYear(album YearAlbum) error
	DeleteYear(year string) error
}

type GalleryRepository interface {
	LoadAlbums() ([]YearAlbum, *GalleryManifest, error)
	LoadYearAlbum(year string) (YearAlbum, error)
	SaveFull(albums []YearAlbum) (GalleryManifest, error)
	UpsertPhoto(photo Photo) (GalleryManifest, error)
	DeletePhoto(year, filename string) (GalleryManifest, error)
}

type galleryLegacyReader struct {
	store *GalleryStore
}

func (r *galleryLegacyReader) LoadAlbums() ([]YearAlbum, error) {
	return r.store.loadFromLegacy()
}

func (r *galleryLegacyReader) LoadYearAlbum(year string) (YearAlbum, error) {
	albums, err := r.store.loadFromLegacy()
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

type galleryPublisher struct {
	store *GalleryStore
}

func (p *galleryPublisher) PublishManifestAndAlbums(manifest GalleryManifest, albums []YearAlbum) error {
	return p.store.uploadManifestAndAlbums(manifest, albums)
}

func (p *galleryPublisher) PublishManifest(manifest GalleryManifest) error {
	return p.store.uploadManifest(manifest)
}

func (p *galleryPublisher) PublishYear(album YearAlbum) error {
	return p.store.uploadYear(album)
}

func (p *galleryPublisher) DeleteYear(year string) error {
	return p.store.deleteYearR2(year)
}

type galleryRepository struct {
	store *GalleryStore
}

func (r *galleryRepository) LoadAlbums() ([]YearAlbum, *GalleryManifest, error) {
	if manifest, albums, err := r.store.loadFromManifest(); err == nil {
		return albums, &manifest, nil
	}

	albums, err := r.store.legacyReader.LoadAlbums()
	if err != nil {
		return nil, nil, err
	}

	manifest := buildManifest(albums)
	return albums, &manifest, nil
}

func (r *galleryRepository) LoadYearAlbum(year string) (YearAlbum, error) {
	if album, err := r.store.loadYearAlbum(year); err == nil {
		return album, nil
	}

	return r.store.legacyReader.LoadYearAlbum(year)
}

func (r *galleryRepository) SaveFull(albums []YearAlbum) (GalleryManifest, error) {
	normalizeAlbums(albums)

	if err := os.MkdirAll(filepath.Join(r.store.RootDir, GalleryYearsDir), 0o755); err != nil {
		return GalleryManifest{}, err
	}

	manifest := buildManifest(albums)
	if err := r.store.writeAlbums(albums); err != nil {
		return GalleryManifest{}, err
	}
	if err := r.store.writeManifest(manifest); err != nil {
		return GalleryManifest{}, err
	}
	if err := r.store.publisher.PublishManifestAndAlbums(manifest, albums); err != nil {
		return GalleryManifest{}, err
	}
	if err := r.store.EnsureSourceConfigPublished(); err != nil {
		return GalleryManifest{}, err
	}

	return manifest, nil
}

func (r *galleryRepository) UpsertPhoto(photo Photo) (GalleryManifest, error) {
	if photo.Year == "" {
		photo.Year = time.Now().Format("2006")
	}

	album, err := r.store.loadYearAlbumIfExists(photo.Year)
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
	if err := r.store.writeAlbum(album); err != nil {
		return GalleryManifest{}, err
	}

	manifest, err := r.store.loadManifestForMutation()
	if err != nil {
		return GalleryManifest{}, err
	}
	manifest = upsertManifestYear(manifest, album)
	if err := r.store.writeManifest(manifest); err != nil {
		return GalleryManifest{}, err
	}
	if err := r.store.publisher.PublishYear(album); err != nil {
		return GalleryManifest{}, err
	}
	if err := r.store.publisher.PublishManifest(manifest); err != nil {
		return GalleryManifest{}, err
	}
	if err := r.store.EnsureSourceConfigPublished(); err != nil {
		return GalleryManifest{}, err
	}

	return manifest, nil
}

func (r *galleryRepository) DeletePhoto(year, filename string) (GalleryManifest, error) {
	if year == "" {
		return GalleryManifest{}, fmt.Errorf("year is required for delete")
	}

	album, err := r.store.loadYearAlbumIfExists(year)
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

	manifest, err := r.store.loadManifestForMutation()
	if err != nil {
		return GalleryManifest{}, err
	}

	if len(album.Photos) == 0 {
		if err := r.store.deleteAlbumFiles(year); err != nil {
			return GalleryManifest{}, err
		}
		manifest = removeManifestYear(manifest, year)
		if err := r.store.publisher.DeleteYear(year); err != nil {
			return GalleryManifest{}, err
		}
	} else {
		if err := r.store.writeAlbum(album); err != nil {
			return GalleryManifest{}, err
		}
		manifest = upsertManifestYear(manifest, album)
		if err := r.store.publisher.PublishYear(album); err != nil {
			return GalleryManifest{}, err
		}
	}

	if err := r.store.writeManifest(manifest); err != nil {
		return GalleryManifest{}, err
	}
	if err := r.store.publisher.PublishManifest(manifest); err != nil {
		return GalleryManifest{}, err
	}
	if err := r.store.EnsureSourceConfigPublished(); err != nil {
		return GalleryManifest{}, err
	}

	return manifest, nil
}
