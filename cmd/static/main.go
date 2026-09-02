package main

import (
	"bytes"
	"cmp"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/vincentchyu/vincentchyu.github.io/pkg/config"
)

func main() {
	rootDir, err := config.ResolveRootDir("")
	if err != nil {
		log.Fatal(err)
	}

	token := cmp.Or(os.Getenv("THUNDERFOREST_API_TOKEN"), os.Getenv("THUNDERFORESR_API_TOKEN"))
	if token != "" {
		log.Println("✓ Thunderforest tile proxy enabled")
	} else {
		log.Println("⚠ Warning: THUNDERFOREST_API_TOKEN not found in .env, tile requests may fail")
	}

	http.HandleFunc("/api/tiles/", func(w http.ResponseWriter, r *http.Request) {
		handleTileProxy(w, r, token)
	})

	http.HandleFunc(
		"/", func(w http.ResponseWriter, r *http.Request) {
			serveStaticWithLocalTag(w, r, rootDir)
		},
	)

	port := cmp.Or(os.Getenv("PORT"), "3000")
	log.Printf("Starting local server at http://localhost:%s\n", port)
	log.Printf("Serving files from: %s\n", rootDir)
	log.Println("Press Ctrl+C to stop")

	err = http.ListenAndServe(":"+port, nil)
	if err != nil {
		log.Fatal(err)
	}
}

var tileClient = createTileClient()

func createTileClient() *http.Client {
	proxyURLStr := cmp.Or(
		os.Getenv("https_proxy"),
		os.Getenv("HTTPS_PROXY"),
		os.Getenv("http_proxy"),
		os.Getenv("HTTP_PROXY"),
		os.Getenv("all_proxy"),
	)

	transport := &http.Transport{
		Proxy: http.ProxyFromEnvironment,
	}

	if proxyURLStr != "" {
		if parsed, err := url.Parse(proxyURLStr); err == nil {
			transport.Proxy = http.ProxyURL(parsed)
			log.Printf("✓ Tile proxy using network proxy: %s\n", proxyURLStr)
		}
	} else {
		// 尝试自动检测常见本地 Clash 端口
		if clashURL, err := url.Parse("http://127.0.0.1:7897"); err == nil {
			transport.Proxy = func(req *http.Request) (*url.URL, error) {
				// 先尝试环境变量，若无则使用本地 Clash 端口
				if p, err := http.ProxyFromEnvironment(req); err == nil && p != nil {
					return p, nil
				}
				return clashURL, nil
			}
			log.Println("✓ Tile proxy fallback to local Clash proxy: http://127.0.0.1:7897")
		}
	}

	return &http.Client{
		Timeout:   15 * time.Second,
		Transport: transport,
	}
}

func handleTileProxy(w http.ResponseWriter, r *http.Request, token string) {
	if token == "" {
		http.Error(w, "THUNDERFOREST_API_TOKEN is not configured", http.StatusBadGateway)
		return
	}

	tileSubpath := strings.TrimPrefix(r.URL.Path, "/api/tiles/")
	tileSubpath = strings.TrimPrefix(tileSubpath, "/")
	if tileSubpath == "" {
		http.Error(w, "Invalid tile path", http.StatusBadRequest)
		return
	}

	targetURL := fmt.Sprintf("https://tile.thunderforest.com/%s?apikey=%s", tileSubpath, url.QueryEscape(token))

	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, targetURL, nil)
	if err != nil {
		http.Error(w, "Failed to create upstream request", http.StatusInternalServerError)
		return
	}

	req.Header.Set("User-Agent", "VincentChyuFootprint/1.0")

	resp, err := tileClient.Do(req)
	if err != nil {
		http.Error(w, fmt.Sprintf("Upstream tile request failed: %v", err), http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	for k, vv := range resp.Header {
		for _, v := range vv {
			w.Header().Add(k, v)
		}
	}
	w.Header().Set("Cache-Control", "public, max-age=86400")
	w.WriteHeader(resp.StatusCode)
	_, _ = io.Copy(w, resp.Body)
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
