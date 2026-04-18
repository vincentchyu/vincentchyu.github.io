package main

import (
	"log"

	"github.com/vincentchyu/vincentchyu.github.io/internal/photo"
	"github.com/vincentchyu/vincentchyu.github.io/pkg/config"
)

func main() {
	rootDir, err := config.ResolveRootDir("")
	if err != nil {
		log.Fatalf("Resolve root dir error: %v", err)
	}

	if err := photo.RunUpdatePhotosWithRoot(rootDir, nil, false); err != nil {
		log.Fatalf("Update photos error: %v", err)
	}
}
