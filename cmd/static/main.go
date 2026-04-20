package main

import (
	"bytes"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/vincentchyu/vincentchyu.github.io/pkg/config"
)

func main() {
	rootDir, err := config.ResolveRootDir("")
	if err != nil {
		log.Fatal(err)
	}

	http.HandleFunc(
		"/", func(w http.ResponseWriter, r *http.Request) {
			serveStaticWithLocalTag(w, r, rootDir)
		},
	)

	port := "3000"
	log.Printf("Starting local server at http://localhost:%s\n", port)
	log.Printf("Serving files from: %s\n", rootDir)
	log.Println("Press Ctrl+C to stop")

	err = http.ListenAndServe(":"+port, nil)
	if err != nil {
		log.Fatal(err)
	}
}

/*
const localGalleryModeScript = `<script>
window.__PHOTO_GALLERY_DATA_MODE__ = "remote";
</script>
`
*/
const localGalleryModeScript = `<script>
window.__PHOTO_GALLERY_DATA_MODE__ = "local";
</script>
`

const localGallerySourceScripts = `<script src="/web/photography/js/gallery.metadata.js"></script>
<script src="/web/photography/js/gallery.thumbnail.js"></script>
<script src="/web/photography/js/gallery.data.js"></script>
<script src="/web/photography/js/gallery.lightbox.js"></script>
<script src="/web/photography/js/gallery.timeline.js"></script>
<script src="/web/photography/js/gallery.layout.js"></script>
<script src="/web/photography/js/gallery.loader.js"></script>
<script src="/web/photography/js/gallery.js"></script>`

var galleryBundleScriptPattern = regexp.MustCompile(
	`<script\s+src="/web/photography/dist/gallery\.bundle\.min\.js(?:\?[^"]*)?"></script>`,
)

func serveStaticWithLocalTag(w http.ResponseWriter, r *http.Request, root string) {
	requestPath := filepath.Clean("/" + r.URL.Path)
	if requestPath == "/" {
		requestPath = "/index.html"
	}

	localPath := filepath.Join(root, filepath.FromSlash(strings.TrimPrefix(requestPath, "/")))
	info, err := os.Stat(localPath)
	if err != nil {
		http.NotFound(w, r)
		return
	}

	if info.IsDir() {
		if !strings.HasSuffix(r.URL.Path, "/") {
			http.Redirect(w, r, r.URL.Path+"/", http.StatusMovedPermanently)
			return
		}
		localPath = filepath.Join(localPath, "index.html")
		info, err = os.Stat(localPath)
		if err != nil || info.IsDir() {
			http.NotFound(w, r)
			return
		}
	}

	if strings.EqualFold(filepath.Ext(localPath), ".html") {
		serveHTMLWithLocalTag(w, localPath)
		return
	}

	http.ServeFile(w, r, localPath)
}

func serveHTMLWithLocalTag(w http.ResponseWriter, path string) {
	data, err := os.ReadFile(path)
	if err != nil {
		http.Error(w, "Failed to read file", http.StatusInternalServerError)
		return
	}

	injected := injectLocalGalleryMode(data)
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(injected)
}

func injectLocalGalleryMode(html []byte) []byte {
	marker := []byte("</head>")
	snippet := []byte(localGalleryModeScript)
	body := html

	if idx := bytes.Index(bytes.ToLower(body), marker); idx >= 0 {
		body = append(body[:idx], append(snippet, body[idx:]...)...)
	} else {
		body = append(snippet, body...)
	}

	return galleryBundleScriptPattern.ReplaceAll(body, []byte(localGallerySourceScripts))
}
