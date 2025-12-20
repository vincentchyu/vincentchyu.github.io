package scripts

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
)

const R2RequestTimeout = 360 * time.Second

// R2Config holds the configuration for Cloudflare R2
type R2Config struct {
	Endpoint        string
	Bucket          string
	Region          string
	AccessKeyID     string
	SecretAccessKey string
	CDNUrl          string
	BasePrefix      string // e.g., "photos/"
	OriginalPrefix  string // e.g., "originals/"
	ThumbnailPrefix string // e.g., "thumbnails/"
}

// R2Client wraps the S3 client for R2 operations
type R2Client struct {
	client *s3.Client
	config R2Config
}

// LoadR2Config loads R2 configuration from .env file
func LoadR2Config() (*R2Config, error) {
	// Read configuration from environment variables
	config := &R2Config{
		Endpoint:        getEnv("NUXT_PROVIDER_S3_ENDPOINT", "R2_ENDPOINT"),
		Bucket:          getEnv("NUXT_PROVIDER_S3_BUCKET", "R2_BUCKET"),
		Region:          getEnv("NUXT_PROVIDER_S3_REGION", "R2_REGION"),
		AccessKeyID:     getEnv("NUXT_PROVIDER_S3_ACCESS_KEY_ID", "R2_ACCESS_KEY_ID"),
		SecretAccessKey: getEnv("NUXT_PROVIDER_S3_SECRET_ACCESS_KEY", "R2_SECRET_ACCESS_KEY"),
		CDNUrl:          getEnv("NUXT_PROVIDER_S3_CDN_URL", "R2_CDN_URL"),
		BasePrefix:      getEnvWithDefault("photos/", "NUXT_PROVIDER_S3_BASE_PREFIX", "R2_BASE_PREFIX"),
		OriginalPrefix:  getEnvWithDefault("originals/", "NUXT_PROVIDER_S3_ORIGINAL_PREFIX", "R2_ORIGINAL_PREFIX"),
		ThumbnailPrefix: getEnvWithDefault(
			"thumbnails/", "NUXT_PROVIDER_S3_PREFIX_THUMBNAIL_BASE", "R2_THUMBNAIL_PREFIX",
		),
	}

	// Validate required fields
	if config.Endpoint == "" || config.Bucket == "" || config.AccessKeyID == "" || config.SecretAccessKey == "" {
		return nil, fmt.Errorf("missing required R2 configuration")
	}

	return config, nil
}

// getEnv tries multiple environment variable names and returns the first non-empty value
func getEnv(names ...string) string {
	for _, name := range names {
		if value := os.Getenv(name); value != "" {
			return value
		}
	}
	return ""
}

// getEnvWithDefault tries multiple environment variable names and returns the first non-empty value, or default
func getEnvWithDefault(defaultValue string, names ...string) string {
	for _, name := range names {
		if value := os.Getenv(name); value != "" {
			return value
		}
	}
	return defaultValue
}

// NewR2Client creates a new R2 client
func NewR2Client(config *R2Config) (*R2Client, error) {
	// Create custom endpoint resolver
	customResolver := aws.EndpointResolverWithOptionsFunc(
		func(service, region string, options ...interface{}) (aws.Endpoint, error) {
			return aws.Endpoint{
				URL:               config.Endpoint,
				SigningRegion:     config.Region,
				HostnameImmutable: true,
			}, nil
		},
	)

	// Create AWS config
	cfg := aws.Config{
		Region:                      config.Region,
		EndpointResolverWithOptions: customResolver,
		Credentials: credentials.NewStaticCredentialsProvider(
			config.AccessKeyID,
			config.SecretAccessKey,
			"",
		),
	}

	// Create S3 client
	client := s3.NewFromConfig(cfg)

	return &R2Client{
		client: client,
		config: *config,
	}, nil
}

// CheckFileExists checks if a file exists in R2
func (r *R2Client) CheckFileExists(key string) bool {
	ctx, cancel := context.WithTimeout(context.Background(), R2RequestTimeout)
	defer cancel()

	_, err := r.client.HeadObject(
		ctx, &s3.HeadObjectInput{
			Bucket: aws.String(r.config.Bucket),
			Key:    aws.String(key),
		},
	)
	return err == nil
}

// UploadFile uploads a file to R2
func (r *R2Client) UploadFile(localPath, key, cacheControl string) error {
	ctx, cancel := context.WithTimeout(context.Background(), R2RequestTimeout)
	defer cancel()

	// Read file
	fileData, err := os.ReadFile(localPath)
	if err != nil {
		return fmt.Errorf("failed to read file: %w", err)
	}

	// Determine content type
	contentType := getContentType(localPath)

	// Upload to R2
	input := &s3.PutObjectInput{
		Bucket:      aws.String(r.config.Bucket),
		Key:         aws.String(key),
		Body:        bytes.NewReader(fileData),
		ContentType: aws.String(contentType),
	}

	if cacheControl != "" {
		input.CacheControl = aws.String(cacheControl)
	}

	_, err = r.client.PutObject(ctx, input)

	if err != nil {
		return fmt.Errorf("failed to upload to R2: %w", err)
	}

	return nil
}

// UploadBytes uploads byte data to R2
func (r *R2Client) UploadBytes(data []byte, key, contentType, cacheControl string) error {
	ctx, cancel := context.WithTimeout(context.Background(), R2RequestTimeout)
	defer cancel()

	input := &s3.PutObjectInput{
		Bucket:      aws.String(r.config.Bucket),
		Key:         aws.String(key),
		Body:        bytes.NewReader(data),
		ContentType: aws.String(contentType),
	}

	if cacheControl != "" {
		input.CacheControl = aws.String(cacheControl)
	}

	_, err := r.client.PutObject(ctx, input)

	if err != nil {
		return fmt.Errorf("failed to upload to R2: %w", err)
	}

	return nil
}

// DeleteObject del data to R2
func (r *R2Client) DeleteObject(key string) error {
	ctx, cancel := context.WithTimeout(context.Background(), R2RequestTimeout)
	defer cancel()

	_, err := r.client.DeleteObject(
		ctx, &s3.DeleteObjectInput{
			Bucket:                    aws.String(r.config.Bucket),
			Key:                       aws.String(key),
			BypassGovernanceRetention: nil,
			ExpectedBucketOwner:       nil,
			IfMatch:                   nil,
			IfMatchLastModifiedTime:   nil,
			IfMatchSize:               nil,
			MFA:                       nil,
			RequestPayer:              "",
			VersionId:                 nil,
		},
	)
	// res.DeleteMarker

	if err != nil {
		return fmt.Errorf("failed to delete object to R2: %w", err)
	}

	return nil
}

// DeleteObjects deletes multiple objects from R2 in a batch
func (r *R2Client) DeleteObjects(keys []string) error {
	if len(keys) == 0 {
		return nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), R2RequestTimeout)
	defer cancel()

	var objects []types.ObjectIdentifier
	for _, key := range keys {
		objects = append(
			objects, types.ObjectIdentifier{
				Key: aws.String(key),
			},
		)
	}

	// S3 batch delete limit is 1000
	batchSize := 1000
	for i := 0; i < len(objects); i += batchSize {
		end := i + batchSize
		if end > len(objects) {
			end = len(objects)
		}

		batch := objects[i:end]
		_, err := r.client.DeleteObjects(
			ctx, &s3.DeleteObjectsInput{
				Bucket: aws.String(r.config.Bucket),
				Delete: &types.Delete{
					Objects: batch,
					Quiet:   aws.Bool(true),
				},
			},
		)

		if err != nil {
			return fmt.Errorf("failed to delete batch objects from R2: %w", err)
		}
	}

	return nil
}

// GetCDNUrl returns the CDN URL for a given key
func (r *R2Client) GetCDNUrl(key string) string {
	if r.config.CDNUrl != "" {
		return fmt.Sprintf("%s/%s", r.config.CDNUrl, key)
	}
	// Fallback to direct R2 URL
	return fmt.Sprintf("%s/%s/%s", r.config.Endpoint, r.config.Bucket, key)
}

// getContentType determines the content type based on file extension
func getContentType(filename string) string {
	ext := strings.ToLower(filepath.Ext(filename))
	switch ext {
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".png":
		return "image/png"
	case ".webp":
		return "image/webp"
	case ".gif":
		return "image/gif"
	case ".heic", ".heif":
		return "image/heic"
	case ".avif":
		return "image/avif"
	case ".tiff", ".tif":
		return "image/tiff"
	case ".bmp":
		return "image/bmp"
	case ".svg":
		return "image/svg+xml"
	case ".ico":
		return "image/x-icon"
	case ".raw", ".arw", ".cr2", ".cr3", ".nef", ".dng", ".orf", ".rw2":
		return "image/x-dcraw" // Generic RAW type, or application/octet-stream
	default:
		return "application/octet-stream"
	}
}
