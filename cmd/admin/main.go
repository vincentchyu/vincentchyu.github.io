package main

import (
	"log"

	"github.com/vincentchyu/vincentchyu.github.io/internal/admin"
	_ "github.com/vincentchyu/vincentchyu.github.io/pkg/config"
)

func main() {
	log.Println("🚀 启动照片管理服务器...")
	if err := admin.StartAdminServer(":3002"); err != nil {
		log.Fatalf("Server error: %v", err)
	}
}
