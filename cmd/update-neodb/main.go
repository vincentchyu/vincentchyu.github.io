package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/vincentchyu/vincentchyu.github.io/pkg/config"
)

// NeoDBShelfResponse 代表 NeoDB shelf 的响应结构
type NeoDBShelfResponse struct {
	Data  []NeoDBRecord `json:"data"`
	Pages int           `json:"pages,omitempty"`
	Count int           `json:"count,omitempty"`
}

type NeoDBItem struct {
	UUID     string `json:"uuid"`
	Title    string `json:"title"`
	Cover    string `json:"cover_image_url"`
	Category string `json:"category"`
	Brief    string `json:"brief,omitempty"`
	URL      string `json:"url,omitempty"` // 只会得到album/0sehgbzUoxl2ioViKOih7r 拼接 https://neodb.social/album/0sehgbzUoxl2ioViKOih7r 就可以访问
	// https://neodb.social/m/item/doubanmusic/2024/08/08/33fea182-b928-4b37-be36-7207b0ef133d.jpg
	Rating float64 `json:"rating,omitempty"`
}

type NeoDBRecord struct {
	Item        NeoDBItem `json:"item"`
	CreatedTime string    `json:"created_time"`
	Comment     string    `json:"comment,omitempty"`
	Rating      float64   `json:"rating,omitempty"` // 个人评分
}

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

	categories := []string{"book", "movie", "tv", "music", "game", "podcast"}
	dataDir := filepath.Join(rootDir, "web", "media", "data")
	if err := os.MkdirAll(dataDir, 0755); err != nil {
		log.Fatalf("Failed to create data directory: %v", err)
	}

	client := &http.Client{Timeout: 15 * time.Second}

	for _, cat := range categories {
		log.Printf("Fetching category: %s...", cat)
		records, err := fetchAllRecords(client, token, cat)
		if err != nil {
			log.Printf("Error fetching category %s: %v", cat, err)
			continue
		}
		records = normalizeRecords(records)

		outputPath := filepath.Join(dataDir, fmt.Sprintf("%s.json", cat))
		fileData, err := json.MarshalIndent(records, "", "  ")
		if err != nil {
			log.Printf("Error marshalling %s data: %v", cat, err)
			continue
		}

		if err := os.WriteFile(outputPath, fileData, 0644); err != nil {
			log.Printf("Error writing file %s: %v", outputPath, err)
		} else {
			log.Printf("✓ Category %s: fetched %d records, saved to %s", cat, len(records), outputPath)
		}
	}
}

func fetchAllRecords(client *http.Client, token string, category string) ([]NeoDBRecord, error) {
	allRecords := make([]NeoDBRecord, 0)
	page := 1

	for {
		url := fmt.Sprintf("https://neodb.social/api/me/shelf/complete?category=%s&page=%d", category, page)
		req, err := http.NewRequest("GET", url, nil)
		if err != nil {
			return nil, err
		}

		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("Accept", "application/json")
		req.Header.Set("User-Agent", "vincentchyu-github-pages-neodb-fetcher/1.0")

		resp, err := client.Do(req)
		if err != nil {
			return nil, err
		}

		if resp.StatusCode != http.StatusOK {
			bodyBytes, _ := io.ReadAll(resp.Body)
			resp.Body.Close()
			return nil, fmt.Errorf("HTTP error %d: %s", resp.StatusCode, string(bodyBytes))
		}

		var shelfResp NeoDBShelfResponse
		if err := json.NewDecoder(resp.Body).Decode(&shelfResp); err != nil {
			resp.Body.Close()
			return nil, err
		}
		resp.Body.Close()

		if len(shelfResp.Data) == 0 {
			break
		}

		allRecords = append(allRecords, normalizeRecords(shelfResp.Data)...)
		log.Printf("  Page %d: fetched %d items", page, len(shelfResp.Data))

		if shelfResp.Pages > 0 && page >= shelfResp.Pages {
			break
		}
		if shelfResp.Pages == 0 && len(shelfResp.Data) < 20 {
			break
		}

		page++
		time.Sleep(500 * time.Millisecond) // Be polite to the API
	}

	return allRecords, nil
}

func normalizeRecords(records []NeoDBRecord) []NeoDBRecord {
	if records == nil {
		return []NeoDBRecord{}
	}
	for i := range records {
		records[i].Item.URL = normalizeNeoDBURL(records[i].Item.URL)
	}
	return records
}

func normalizeNeoDBURL(url string) string {
	if url == "" {
		return ""
	}
	if strings.HasPrefix(url, "http://") || strings.HasPrefix(url, "https://") {
		return url
	}
	if url[0] == '/' {
		return url
	}
	return "/" + url
}
