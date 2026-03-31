package main

import (
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"

	"fio-go/parser"
	"fio-go/report"
)

func main() {
	dataDir := flag.String("data", "./data", "Local data root directory")
	reportDir := flag.String("output-dir", "./性能测试报告", "Output report directory")
	flag.Parse()

	// Handle args like the shell script
	args := flag.Args()
	if len(args) >= 1 {
		*dataDir = args[0]
	}
	if len(args) >= 2 {
		*reportDir = args[1]
	}

	fmt.Printf("[INFO] Data directory: %s\n", *dataDir)
	fmt.Printf("[INFO] Report directory: %s\n", *reportDir)

	if err := os.MkdirAll(*reportDir, 0755); err != nil {
		log.Fatalf("Failed to create report dir: %v", err)
	}

	// 1. Parse JSON files
	res, err := parser.AnalyzeJSONFiles(*dataDir)
	if err != nil {
		log.Fatalf("Error parsing JSON: %v", err)
	}
	fmt.Printf("[INFO] JSON analysis complete. Total: %d, OK: %d, Failed: %d\n", res.FilesTotal, res.FilesOK, res.FilesFailed)

	// 2. Generate Excel
	excelPath := filepath.Join(*reportDir, "fio_summary.xlsx")
	if envPath := os.Getenv("FIO_SUMMARY_XLSX"); envPath != "" {
		excelPath = envPath
	}
	if err := report.GenerateExcel(res, excelPath); err != nil {
		fmt.Printf("[WARN] Failed to generate Excel: %v\n", err)
	} else {
		fmt.Printf("[INFO] Excel summary generated: %s\n", excelPath)
	}

	// 3. Build chart groups from logs
	chartGroups := parser.BuildChartGroups(*dataDir)
	fmt.Printf("[INFO] Found %d chart groups from logs\n", len(chartGroups))

	// 4. Generate HTML
	htmlPath := filepath.Join(*reportDir, "fio_report.html")
	if err := report.GenerateHTML(chartGroups, res.SystemTexts, htmlPath); err != nil {
		fmt.Printf("[WARN] Failed to generate HTML: %v\n", err)
	} else {
		fmt.Printf("[INFO] HTML report generated: %s\n", htmlPath)
	}
}
