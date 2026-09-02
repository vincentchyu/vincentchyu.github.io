package neodb

import (
	"time"
)

type ShelfResponse struct {
	Data  []Record `json:"data"`
	Pages int      `json:"pages,omitempty"`
	Count int      `json:"count,omitempty"`
}

type Item struct {
	UUID           string           `json:"uuid"`
	Title          string           `json:"title"`
	LocalizedTitle []LocalizedTitle `json:"localized_title,omitempty"`
	Cover          string           `json:"cover_image_url"`
	Category       string           `json:"category"`
	Brief          string           `json:"-,omitempty"`
	URL            string           `json:"url,omitempty"`
	Rating         float64          `json:"rating,omitempty"`
	ReleaseDate    string           `json:"release_date,omitempty"`
}

type Record struct {
	Item        Item   `json:"item"`
	CreatedTime string `json:"created_time"`
	CommentText string `json:"comment_text,omitempty"` // 个人短评
	RatingGrade int    `json:"rating_grade,omitempty"` // 个人评分
	ShelfType   string `json:"-"`
	Visibility  int    `json:"-"`
	PostID      int64  `json:"-"`
}
type LocalizedTitle struct {
	Lang string `json:"lang"`
	Text string `json:"text"`
}

type itemDetail struct {
	ReleaseDate string `json:"release_date"`
	Year        int    `json:"year"`
	PubYear     int    `json:"pub_year"`
	PubMonth    int    `json:"pub_month"`
}

type T struct {
	Data []struct {
		ShelfType  string `json:"shelf_type"`
		Visibility int    `json:"visibility"`
		PostId     int64  `json:"post_id"`
		Item       struct {
			Type           string `json:"type"`
			Title          string `json:"title"`
			Description    string `json:"description"`
			LocalizedTitle []struct {
				Lang string `json:"lang"`
				Text string `json:"text"`
			} `json:"localized_title"`
			LocalizedDescription []struct {
				Lang string `json:"lang"`
				Text string `json:"text"`
			} `json:"localized_description"`
			CoverImageUrl      string      `json:"cover_image_url"`
			Rating             float64     `json:"rating"`
			RatingCount        int         `json:"rating_count"`
			RatingDistribution []int       `json:"rating_distribution"`
			Tags               any         `json:"tags"`
			Brief              string      `json:"brief"`
			Id                 string      `json:"id"`
			Uuid               string      `json:"uuid"`
			Url                string      `json:"url"`
			ApiUrl             string      `json:"api_url"`
			Category           string      `json:"category"`
			ParentUuid         any         `json:"parent_uuid"`
			DisplayTitle       string      `json:"display_title"`
			ExternalResources  []struct {
				Url string `json:"url"`
			} `json:"external_resources"`
			Credits []struct {
				Role          string  `json:"role"`
				Name          string  `json:"name"`
				CharacterName string  `json:"character_name"`
				PersonUrl     *string `json:"person_url"`
			} `json:"credits"`
		} `json:"item"`
		CreatedTime time.Time `json:"created_time"`
		CommentText *string   `json:"comment_text"`
		RatingGrade *int      `json:"rating_grade"`
		Tags        []string  `json:"tags"`
	} `json:"data"`
	Pages int `json:"pages"`
	Count int `json:"count"`
}
