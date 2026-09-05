package main

import (
	"fmt"
	"path/filepath"

	"github.com/vincentchyu/vincentchyu.github.io/internal/track"
)

func main() {
	files := []string{
		"/Users/vincent/.config/gpx/skateboarding-中国-广东-晚上滑板-20250831.gpx",
	}

	for _, f := range files {
		_, manifest, _, err := track.ParseGPXFile(f)
		if err != nil {
			fmt.Printf("Error parsing %s: %v\n", f, err)
			continue
		}

		fmt.Printf("File: %s\n", filepath.Base(f))
		fmt.Printf("  Distance: %.2f km\n", manifest.DistanceKm)
		fmt.Printf("  Avg Speed: %.2f km/h\n", manifest.AvgSpeedKmh)
		fmt.Printf("  Ele Gain: %.2f m\n", manifest.ElevationGainM)
		fmt.Printf("  Avg HR: %d\n", manifest.AvgHeartRate)
		fmt.Printf("  Max HR: %d\n", manifest.MaxHeartRate)
		fmt.Printf("  City: %s\n", manifest.City)
		fmt.Println("---")
	}
}
