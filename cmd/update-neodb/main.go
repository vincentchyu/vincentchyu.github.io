package main

import (
	"log"
	"os"

	"github.com/vincentchyu/vincentchyu.github.io/internal/neodb"
	"github.com/vincentchyu/vincentchyu.github.io/pkg/config"
)

func main() {
	rootDir, err := config.ResolveRootDir("")
	if err != nil {
		log.Fatalf("Resolve root dir error: %v", err)
	}

	token := os.Getenv("NEODB_API_TOKEN")
	if token == "" {
		log.Println("⚠ Warning: NEODB_API_TOKEN is empty. Skipping NeoDB fetch.")
		return
	}

	updater, err := neodb.NewUpdater(rootDir, token)
	if err != nil {
		log.Fatalf("Create NeoDB updater error: %v", err)
	}
	if err := updater.Run(); err != nil {
		log.Fatalf("Update NeoDB data error: %v", err)
	}
}
