package main

import (
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
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
        groupedRows, err := report.GenerateExcel(res, excelPath)
        if err != nil {
                fmt.Printf("[WARN] Failed to generate Excel: %v\n", err)
        } else {
                fmt.Printf("[INFO] Excel summary generated: %s\n", excelPath)
        }

	// 3. Build chart groups from logs
	chartGroups := parser.BuildChartGroups(*dataDir)
	fmt.Printf("[INFO] Found %d chart groups from logs\n", len(chartGroups))

	// 4. Generate HTML
        htmlPath := filepath.Join(*reportDir, "fio_report.html")
        if err := report.GenerateHTML(chartGroups, res.SystemTexts, groupedRows, htmlPath); err != nil {
                fmt.Printf("[WARN] Failed to generate HTML: %v\n", err)
        } else {
                fmt.Printf("[INFO] HTML report generated: %s\n", htmlPath)
        }

        // 5. Download echarts.min.js for offline viewing
        echartsPath := filepath.Join(*reportDir, "echarts.min.js")
        if err := downloadEcharts(echartsPath); err != nil {
                fmt.Printf("[WARN] Failed to fetch echarts.min.js: %v\n", err)
        } else {
                fmt.Printf("[INFO] Downloaded echarts.min.js to %s\n", echartsPath)
        }
}

func downloadEcharts(destPath string) error {
        if _, err := os.Stat(destPath); err == nil {
                return nil // already exists
        }
        
        resp, err := http.Get("https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js")
        if err != nil {
                return err
        }
        defer resp.Body.Close()

        out, err := os.Create(destPath)
        if err != nil {
                return err
        }
        defer out.Close()

        _, err = io.Copy(out, resp.Body)
        return err
}
