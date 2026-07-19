package neodb

import (
	"fmt"
	"strings"
)

func normalizeRecords(records []Record) []Record {
	if records == nil {
		return []Record{}
	}
	for i := range records {
		records[i].Item.URL = normalizeURL(records[i].Item.URL)
	}
	return records
}

func normalizeURL(url string) string {
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

func (d itemDetail) releaseDate() string {
	if d.ReleaseDate != "" {
		return d.ReleaseDate
	}
	if d.Year > 0 {
		return fmt.Sprintf("%04d", d.Year)
	}
	if d.PubYear > 0 && d.PubMonth > 0 {
		return fmt.Sprintf("%04d-%02d", d.PubYear, d.PubMonth)
	}
	if d.PubYear > 0 {
		return fmt.Sprintf("%04d", d.PubYear)
	}
	return ""
}
