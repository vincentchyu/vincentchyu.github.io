package scripts

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/joho/godotenv"
)

func init() {
	// Try to load .env file from current directory or scripts directory
	envPaths := []string{
		".env",
		"scripts/.env",
		filepath.Join(
			os.Getenv("HOME"), "Developer/code/go_code/src/github.com/vincenty1ung/vincenty1ung.github.io/scripts/.env",
		),
	}

	var err error
	for _, path := range envPaths {
		err = godotenv.Load(path)
		if err == nil {
			fmt.Printf("✓ Loaded .env from: %s\n", path)
			break
		}
	}

	if err != nil {
		panic(err)
	}
}
