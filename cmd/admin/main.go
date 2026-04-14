package main

import (
	"log"

	"github.com/vincentchyu/vincentchyu.github.io/internal/admin"
	"github.com/vincentchyu/vincentchyu.github.io/pkg/config"
)

func main() {
	rootDir, err := config.ResolveRootDir("")
	if err != nil {
		log.Fatalf("Resolve root dir error: %v", err)
	}

	log.Println("🚀 启动照片管理服务器...")
	if err := admin.StartAdminServerWithRoot(":3002", rootDir); err != nil {
		log.Fatalf("Server error: %v", err)
	}
}
