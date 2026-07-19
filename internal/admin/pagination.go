package admin

import "strconv"

func decodeCursor(cursor string) (int, error) {
	if cursor == "" {
		return 0, nil
	}
	return strconv.Atoi(cursor)
}

func encodeCursor(offset int) string {
	return strconv.Itoa(offset)
}
