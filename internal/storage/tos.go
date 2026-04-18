package storage

import (
	"bytes"
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/volcengine/ve-tos-golang-sdk/v2/tos"
	"github.com/volcengine/ve-tos-golang-sdk/v2/tos/enum"
)

const TOSRequestTimeout = 360 * time.Second

type TOSConfig struct {
	Endpoint        string
	Bucket          string
	Region          string
	AccessKeyID     string
	SecretAccessKey string
	PublicBaseURL   string
	BasePrefix      string
	OriginalPrefix  string
	ThumbnailPrefix string
}

type TOSClient struct {
	client *tos.ClientV2
	Config TOSConfig
}

func LoadTOSConfig() (*TOSConfig, error) {
	config := &TOSConfig{
		Endpoint:        getEnv("TOS_ENDPOINT"),
		Bucket:          getEnv("TOS_BUCKET"),
		Region:          getEnv("TOS_REGION"),
		AccessKeyID:     getEnv("TOS_ACCESS_KEY_ID"),
		SecretAccessKey: getEnv("TOS_SECRET_ACCESS_KEY"),
		PublicBaseURL:   getEnv("TOS_PUBLIC_BASE_URL"),
		BasePrefix:      getEnvWithDefault("pages/", "TOS_BASE_PREFIX"),
		OriginalPrefix:  getEnvWithDefault("originals/", "TOS_ORIGINAL_PREFIX"),
		ThumbnailPrefix: getEnvWithDefault("thumbnails/", "TOS_THUMBNAIL_PREFIX"),
	}

	if config.Endpoint == "" || config.Bucket == "" || config.Region == "" || config.AccessKeyID == "" ||
		config.SecretAccessKey == "" || config.PublicBaseURL == "" {
		return nil, fmt.Errorf("missing required TOS configuration")
	}

	return config, nil
}

func NewTOSClient(config *TOSConfig) (*TOSClient, error) {
	client, err := tos.NewClientV2(
		config.Endpoint,
		tos.WithRegion(config.Region),
		tos.WithCredentials(tos.NewStaticCredentials(config.AccessKeyID, config.SecretAccessKey)),
		tos.WithMaxRetryCount(3),
	)
	if err != nil {
		return nil, fmt.Errorf("create TOS client: %w", err)
	}

	return &TOSClient{
		client: client,
		Config: *config,
	}, nil
}

func (t *TOSClient) Provider() Provider {
	return ProviderTOS
}

func (t *TOSClient) BaseURL() string {
	return strings.TrimRight(t.Config.PublicBaseURL, "/")
}

func (t *TOSClient) UploadFile(localPath, key, cacheControl string) error {
	ctx, cancel := context.WithTimeout(context.Background(), TOSRequestTimeout)
	defer cancel()

	input := &tos.PutObjectFromFileInput{
		PutObjectBasicInput: tos.PutObjectBasicInput{
			Bucket:       t.Config.Bucket,
			Key:          key,
			ContentType:  getContentType(localPath),
			CacheControl: cacheControl,
			ACL:          enum.ACLPublicRead,
		},
		FilePath: localPath,
	}

	if _, err := t.client.PutObjectFromFile(ctx, input); err != nil {
		return fmt.Errorf("failed to upload file to TOS: %w", err)
	}

	return nil
}

func (t *TOSClient) UploadBytes(data []byte, key, contentType, cacheControl string) error {
	ctx, cancel := context.WithTimeout(context.Background(), TOSRequestTimeout)
	defer cancel()

	input := &tos.PutObjectV2Input{
		PutObjectBasicInput: tos.PutObjectBasicInput{
			Bucket:        t.Config.Bucket,
			Key:           key,
			ContentType:   contentType,
			CacheControl:  cacheControl,
			ContentLength: int64(len(data)),
			ACL:           enum.ACLPublicRead,
		},
		Content: bytes.NewReader(data),
	}

	if _, err := t.client.PutObjectV2(ctx, input); err != nil {
		return fmt.Errorf("failed to upload bytes to TOS: %w", err)
	}

	return nil
}

func (t *TOSClient) DeleteObject(key string) error {
	ctx, cancel := context.WithTimeout(context.Background(), TOSRequestTimeout)
	defer cancel()

	if _, err := t.client.DeleteObjectV2(
		ctx, &tos.DeleteObjectV2Input{
			Bucket: t.Config.Bucket,
			Key:    key,
		},
	); err != nil {
		return fmt.Errorf("failed to delete object from TOS: %w", err)
	}

	return nil
}

func (t *TOSClient) DeleteObjects(keys []string) error {
	if len(keys) == 0 {
		return nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), TOSRequestTimeout)
	defer cancel()

	objects := make([]tos.ObjectTobeDeleted, 0, len(keys))
	for _, key := range keys {
		objects = append(objects, tos.ObjectTobeDeleted{Key: key})
	}

	if _, err := t.client.DeleteMultiObjects(
		ctx, &tos.DeleteMultiObjectsInput{
			Bucket:  t.Config.Bucket,
			Objects: objects,
			Quiet:   true,
		},
	); err != nil {
		return fmt.Errorf("failed to delete objects from TOS: %w", err)
	}

	return nil
}

func (t *TOSClient) PublicURL(key string) string {
	return t.BaseURL() + "/" + strings.TrimLeft(key, "/")
}

func (t *TOSClient) HeadObject(key string) error {
	ctx, cancel := context.WithTimeout(context.Background(), TOSRequestTimeout)
	defer cancel()

	if _, err := t.client.HeadObjectV2(
		ctx, &tos.HeadObjectV2Input{
			Bucket: t.Config.Bucket,
			Key:    key,
		},
	); err != nil {
		return fmt.Errorf("head object %s on TOS: %w", key, err)
	}

	return nil
}
