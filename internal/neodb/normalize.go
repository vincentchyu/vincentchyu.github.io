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
		records[i].Item.Title = normalizeTitle(records[i].Item.Title, records[i].Item.LocalizedTitle)
		records[i].Item.LocalizedTitle = nil
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
func normalizeTitle(title string, localizedTitles []LocalizedTitle) string {
	/*
							{
		                        "lang": "zh-tw",
		                        "text": "天譴"
		                    },
		                    {
		                        "lang": "zh-cn",
		                        "text": "阿基尔，上帝的愤怒"
		                    },
		                    {
		                        "lang": "zh",
		                        "text": "阿基尔，上帝的愤怒"
		                    },
		                    {
		                        "lang": "zh-hk",
		                        "text": "天譴"
		                    },
		                    {
		                        "lang": "zh-hans",
		                        "text": "阿基尔，上帝的愤怒"
		                    },
		                    {
		                        "lang": "zh-hant",
		                        "text": "天譴"
		                    },
	*/
	var (
		langPriorityList = []string{
			"zh-cn",
			"zh-hans",
			"zh",
			"zh-hant",
			"zh-tw",
			"zh-hk",
		}
	)

	if len(localizedTitles) == 0 {
		return title
	}
	m := make(map[string]string, len(localizedTitles))
	for _, localizedTitle := range localizedTitles {
		m[localizedTitle.Lang] = localizedTitle.Text
	}
	for _, p := range langPriorityList {
		if text, ok := m[p]; ok {
			return text
		}
	}
	return title
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
