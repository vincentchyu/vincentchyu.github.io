package neodb

type ShelfResponse struct {
	Data  []Record `json:"data"`
	Pages int      `json:"pages,omitempty"`
	Count int      `json:"count,omitempty"`
}

type Item struct {
	UUID        string  `json:"uuid"`
	Title       string  `json:"title"`
	Cover       string  `json:"cover_image_url"`
	Category    string  `json:"category"`
	Brief       string  `json:"brief,omitempty"`
	URL         string  `json:"url,omitempty"`
	Rating      float64 `json:"rating,omitempty"`
	ReleaseDate string  `json:"release_date,omitempty"`
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

type itemDetail struct {
	ReleaseDate string `json:"release_date"`
	Year        int    `json:"year"`
	PubYear     int    `json:"pub_year"`
	PubMonth    int    `json:"pub_month"`
}
