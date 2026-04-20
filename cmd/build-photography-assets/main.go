package main

import (
	"bytes"
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"

	"github.com/tdewolff/minify/v2"
	"github.com/tdewolff/minify/v2/js"

	"github.com/vincentchyu/vincentchyu.github.io/pkg/config"
)

var galleryBundleInputs = []string{
	"web/photography/js/gallery.metadata.js",
	"web/photography/js/gallery.thumbnail.js",
	"web/photography/js/gallery.data.js",
	"web/photography/js/gallery.lightbox.js",
	"web/photography/js/gallery.timeline.js",
	"web/photography/js/gallery.layout.js",
	"web/photography/js/gallery.loader.js",
	"web/photography/js/gallery.js",
}

func main() {
	checkOnly := flag.Bool("check", false, "verify the checked-in gallery bundle is up to date")
	flag.Parse()

	rootDir, err := config.ResolveRootDir("")
	if err != nil {
		log.Fatal(err)
	}

	outputPath := filepath.Join(rootDir, "web/photography/dist/gallery.bundle.min.js")
	bundle, err := buildGalleryBundle(rootDir, galleryBundleInputs)
	if err != nil {
		log.Fatal(err)
	}

	if *checkOnly {
		existing, err := os.ReadFile(outputPath)
		if err != nil {
			log.Fatalf("read existing bundle: %v", err)
		}

		if !bytes.Equal(existing, bundle) {
			log.Fatalf("%s is stale; run `go run ./cmd/build-photography-assets` and commit the regenerated bundle", outputPath)
		}

		log.Printf("Verified %s is up to date (%d bytes)\n", outputPath, len(bundle))
		return
	}

	if err := os.MkdirAll(filepath.Dir(outputPath), 0o755); err != nil {
		log.Fatal(err)
	}

	if err := os.WriteFile(outputPath, bundle, 0o644); err != nil {
		log.Fatal(err)
	}

	log.Printf("Built %s (%d bytes)\n", outputPath, len(bundle))
}

func buildGalleryBundle(rootDir string, inputs []string) ([]byte, error) {
	var source bytes.Buffer

	for _, input := range inputs {
		absolutePath := filepath.Join(rootDir, filepath.FromSlash(input))
		content, err := os.ReadFile(absolutePath)
		if err != nil {
			return nil, fmt.Errorf("read %s: %w", input, err)
		}

		source.WriteString(";\n")
		source.Write(content)
		source.WriteString("\n")
	}

	minifier := minify.New()
	minifier.AddFunc("text/javascript", js.Minify)

	minified, err := minifier.Bytes("text/javascript", source.Bytes())
	if err != nil {
		return nil, fmt.Errorf("minify gallery bundle: %w", err)
	}

	return []byte(strings.TrimSpace(string(minified)) + "\n"), nil
}
