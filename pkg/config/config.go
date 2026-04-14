package config

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sync"

	"github.com/joho/godotenv"
)

var (
	loadEnvOnce sync.Once
	loadEnvErr  error
)

func init() {
	_ = LoadEnv()
}

func LoadEnv() error {
	// Try to load .env file from current directory or scripts directory
	loadEnvOnce.Do(func() {
		envPaths := []string{
			".env",
			"scripts/.env",
			filepath.Join(
				os.Getenv("HOME"), "Developer/code/go_code/src/github.com/vincenty1ung/vincenty1ung.github.io/scripts/.env",
			),
		}

		for _, path := range envPaths {
			loadEnvErr = godotenv.Load(path)
			if loadEnvErr == nil {
				log.Printf("✓ Loaded .env from: %s\n", path)
				return
			}
		}

		if loadEnvErr != nil {
			log.Printf("⚠ Warning: no .env file loaded: %v\n", loadEnvErr)
		}
	})

	return loadEnvErr
}

type Paths struct {
	RootDir        string
	PhotographyDir string
	ImagesDir      string
	AdminDir       string
}

func ResolveRootDir(start string) (string, error) {
	if start == "" {
		cwd, err := os.Getwd()
		if err != nil {
			return "", err
		}
		start = cwd
	}

	current, err := filepath.Abs(start)
	if err != nil {
		return "", err
	}

	for {
		if fileExists(filepath.Join(current, "go.mod")) && fileExists(filepath.Join(current, "AGENTS.md")) {
			return current, nil
		}

		parent := filepath.Dir(current)
		if parent == current {
			return "", fmt.Errorf("failed to resolve repository root from %s", start)
		}
		current = parent
	}
}

func NewPaths(rootDir string) Paths {
	return Paths{
		RootDir:        rootDir,
		PhotographyDir: filepath.Join(rootDir, "web", "photography"),
		ImagesDir:      filepath.Join(rootDir, "web", "photography", "gallery_images"),
		AdminDir:       filepath.Join(rootDir, "web", "admin"),
	}
}

func fileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}
