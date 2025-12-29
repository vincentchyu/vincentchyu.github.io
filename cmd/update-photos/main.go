package main

import (
	"github.com/vincentchyu/vincentchyu.github.io/internal/photo"
	_ "github.com/vincentchyu/vincentchyu.github.io/pkg/config"
)

func main() {
	photo.UpdatePhotosHandler(nil)
}
