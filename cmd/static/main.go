package main

import (
	"log"
	"net/http"
	"os"
)

func main() {
	// Get current working directory
	cwd, err := os.Getwd()
	if err != nil {
		log.Fatal(err)
	}

	// Serve files from the current directory
	fs := http.FileServer(http.Dir(cwd))
	http.Handle("/", fs)

	port := "3003"
	log.Printf("Starting local server at http://localhost:%s\n", port)
	log.Printf("Serving files from: %s\n", cwd)
	log.Println("Press Ctrl+C to stop")

	err = http.ListenAndServe(":"+port, nil)
	if err != nil {
		log.Fatal(err)
	}
}
