package neodb

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"time"
)

const (
	baseURL   = "https://neodb.social/api"
	userAgent = "vincentchyu-github-pages-neodb-fetcher/1.0"
)

type Client struct {
	httpClient *http.Client
	token      string
}

func NewClient(httpClient *http.Client, token string) *Client {
	return &Client{
		httpClient: httpClient,
		token:      token,
	}
}

func (c *Client) FetchAllRecords(category string) ([]Record, error) {
	allRecords := make([]Record, 0)
	page := 1

	for {
		shelfResp, err := c.fetchShelfPage(category, page)
		if err != nil {
			return nil, err
		}
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
		time.Sleep(500 * time.Millisecond)
	}

	return allRecords, nil
}

func (c *Client) EnrichReleaseDates(category string, records []Record) {
	if len(records) == 0 {
		return
	}

	endpoint, ok := detailEndpoint(category)
	if !ok {
		return
	}

	for i := range records {
		if records[i].Item.ReleaseDate != "" || records[i].Item.UUID == "" {
			continue
		}

		releaseDate, err := c.fetchReleaseDate(endpoint, records[i].Item.UUID)
		if err != nil {
			log.Printf("  ⚠ %s %s release date skipped: %v", category, records[i].Item.UUID, err)
			continue
		}
		records[i].Item.ReleaseDate = releaseDate
		time.Sleep(200 * time.Millisecond)
	}
}

func (c *Client) fetchShelfPage(category string, page int) (ShelfResponse, error) {
	url := fmt.Sprintf("%s/me/shelf/complete?category=%s&page=%d", baseURL, category, page)
	req, err := c.newRequest(url)
	if err != nil {
		return ShelfResponse{}, err
	}

	var shelfResp ShelfResponse
	if err := c.doJSON(req, &shelfResp); err != nil {
		return ShelfResponse{}, err
	}
	return shelfResp, nil
}

func (c *Client) fetchReleaseDate(endpoint string, uuid string) (string, error) {
	url := fmt.Sprintf("%s/%s/%s", baseURL, endpoint, uuid)
	req, err := c.newRequest(url)
	if err != nil {
		return "", err
	}

	var detail itemDetail
	if err := c.doJSON(req, &detail); err != nil {
		return "", err
	}
	return detail.releaseDate(), nil
}

func (c *Client) newRequest(url string) (*http.Request, error) {
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, err
	}

	req.Header.Set("Authorization", "Bearer "+c.token)
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", userAgent)
	return req, nil
}

func (c *Client) doJSON(req *http.Request, target any) error {
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("HTTP error %d: %s", resp.StatusCode, string(bodyBytes))
	}

	return json.NewDecoder(resp.Body).Decode(target)
}

func detailEndpoint(category string) (string, bool) {
	switch category {
	case "music":
		return "album", true
	case "book", "movie", "tv", "game":
		return category, true
	default:
		return "", false
	}
}
