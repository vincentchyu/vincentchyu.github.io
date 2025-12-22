package scripts

import (
	"bytes"
	"fmt"
	"image"
	_ "image/gif"
	"image/jpeg"
	_ "image/png"
	"os"

	"github.com/chai2010/webp"
	"golang.org/x/image/draw"
)

// ThumbnailConfig holds configuration for thumbnail generation
type ThumbnailConfig struct {
	MaxWidth int
	Quality  int // 1-100 for JPEG/WebP
}

// DefaultThumbnailConfig returns the default thumbnail configuration
func DefaultThumbnailConfig() ThumbnailConfig {
	return ThumbnailConfig{
		MaxWidth: 800,
		Quality:  85,
	}
}

// GenerateThumbnail generates a WebP thumbnail from an image file
func GenerateThumbnail(imagePath string, config ThumbnailConfig) ([]byte, error) {
	// Read the image file
	file, err := os.Open(imagePath)
	if err != nil {
		return nil, fmt.Errorf("failed to open image: %w", err)
	}
	defer file.Close()

	// Decode the image
	img, _, err := image.Decode(file)
	if err != nil {
		return nil, fmt.Errorf("failed to decode image: %w", err)
	}

	// Get original dimensions
	bounds := img.Bounds()
	width := bounds.Dx()
	height := bounds.Dy()

	// Calculate new dimensions maintaining aspect ratio
	newWidth := config.MaxWidth
	newHeight := height * newWidth / width

	// If image is already smaller, don't upscale
	if width <= config.MaxWidth {
		newWidth = width
		newHeight = height
	}

	// Create a new image with the target dimensions
	dst := image.NewRGBA(image.Rect(0, 0, newWidth, newHeight))

	// Resize using high-quality interpolation
	draw.CatmullRom.Scale(dst, dst.Bounds(), img, img.Bounds(), draw.Over, nil)

	// Encode to WebP
	var buf bytes.Buffer

	// WebP encoding options
	options := &webp.Options{
		Lossless: false,
		Quality:  float32(config.Quality),
	}

	err = webp.Encode(&buf, dst, options)
	if err != nil {
		return nil, fmt.Errorf("failed to encode WebP thumbnail: %w", err)
	}

	return buf.Bytes(), nil
}

// GenerateThumbnailJPEG generates a JPEG thumbnail (fallback option)
func GenerateThumbnailJPEG(imagePath string, config ThumbnailConfig) ([]byte, error) {
	// Read the image file
	file, err := os.Open(imagePath)
	if err != nil {
		return nil, fmt.Errorf("failed to open image: %w", err)
	}
	defer file.Close()

	// Decode the image
	img, _, err := image.Decode(file)
	if err != nil {
		return nil, fmt.Errorf("failed to decode image: %w", err)
	}

	// Get original dimensions
	bounds := img.Bounds()
	width := bounds.Dx()
	height := bounds.Dy()

	// Calculate new dimensions maintaining aspect ratio
	newWidth := config.MaxWidth
	newHeight := height * newWidth / width

	// If image is already smaller, don't upscale
	if width <= config.MaxWidth {
		newWidth = width
		newHeight = height
	}

	// Create a new image with the target dimensions
	dst := image.NewRGBA(image.Rect(0, 0, newWidth, newHeight))

	// Resize using high-quality interpolation
	draw.CatmullRom.Scale(dst, dst.Bounds(), img, img.Bounds(), draw.Over, nil)

	// Encode to JPEG
	var buf bytes.Buffer
	err = jpeg.Encode(&buf, dst, &jpeg.Options{Quality: config.Quality})
	if err != nil {
		return nil, fmt.Errorf("failed to encode JPEG thumbnail: %w", err)
	}

	return buf.Bytes(), nil
}

// CompressImage checks if the image at the given path is larger than 10MB.
// If so, it resizes/compresses it and returns the new data and content type.
// If not, it returns nil, empty string, and nil error.
func CompressImage(localPath string) ([]byte, string, error) {
	// 10MB limit
	const MaxSize = 10 * 1024 * 1024

	info, err := os.Stat(localPath)
	if err != nil {
		return nil, "", err
	}

	if info.Size() <= MaxSize {
		return nil, "", nil
	}

	// Open file
	file, err := os.Open(localPath)
	if err != nil {
		return nil, "", err
	}
	defer file.Close()

	// Decode
	img, _, err := image.Decode(file)
	if err != nil {
		return nil, "", fmt.Errorf("decode failed: %w", err)
	}

	bounds := img.Bounds()
	width := bounds.Dx()
	height := bounds.Dy()

	// Target constraints
	// Keep 5000px as a safe limit for "zoomed in" high quality while saving space.
	// 5000px is usually enough for even 5K screens.
	const MaxDimension = 5000

	newWidth, newHeight := width, height

	if width > MaxDimension || height > MaxDimension {
		ratio := float64(width) / float64(height)
		if width > height {
			newWidth = MaxDimension
			newHeight = int(float64(MaxDimension) / ratio)
		} else {
			newHeight = MaxDimension
			newWidth = int(float64(MaxDimension) * ratio)
		}
	}

	// Resize if dimensions changed
	var dst image.Image
	if newWidth != width || newHeight != height {
		tmp := image.NewRGBA(image.Rect(0, 0, newWidth, newHeight))
		draw.CatmullRom.Scale(tmp, tmp.Bounds(), img, bounds, draw.Over, nil)
		dst = tmp
	} else {
		dst = img
	}

	// Encode to JPEG
	var buf bytes.Buffer
	// Quality 85 is standard "high quality" for web
	err = jpeg.Encode(&buf, dst, &jpeg.Options{Quality: 85})
	if err != nil {
		return nil, "", err
	}

	// Check if we actually saved space
	if int64(buf.Len()) >= info.Size() {
		// If somehow we made it bigger or same (rare if original was raw/png, possible if already optimzed jpeg),
		// return nil to keep original
		return nil, "", nil
	}

	return buf.Bytes(), "image/jpeg", nil
}
