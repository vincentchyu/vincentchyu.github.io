package main

import (
	"bytes"
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
	rootDir, err := config.ResolveRootDir("")
	if err != nil {
		log.Fatal(err)
	}

	outputPath := filepath.Join(rootDir, "web/photography/dist/gallery.bundle.min.js")
	bundle, err := buildGalleryBundle(rootDir, galleryBundleInputs)
	if err != nil {
		log.Fatal(err)
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
