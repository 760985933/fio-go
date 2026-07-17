package parser

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"

	"fio-go/internal/models"
)

var logRe = regexp.MustCompile(`^(\d+)_([^_]+)_([A-Za-z]+)_iodepth(\d+)_(.*)$`)

func parseLogBase(base string) (int, string, string, int, string, bool) {
	m := logRe.FindStringSubmatch(base)
	if len(m) < 6 {
		return 0, "", "", 0, "", false
	}
	idx, _ := strconv.Atoi(m[1])
	bs := strings.ToLower(m[2])
	rw := strings.ToLower(m[3])
	iodepth, _ := strconv.Atoi(m[4])
	suffix := strings.ToLower(m[5])

	var metric string
	if strings.Contains(suffix, "iops") || strings.HasPrefix(suffix, "iops") {
		metric = "iops"
	} else if strings.Contains(suffix, "bw") || strings.HasPrefix(suffix, "bw") {
		metric = "bw"
	} else if strings.Contains(suffix, "clat") {
		metric = "clat"
	} else if strings.Contains(suffix, "slat") {
		metric = "slat"
	} else if strings.Contains(suffix, "lat") || strings.HasPrefix(suffix, "lat") {
		metric = "lat"
	}

	if metric == "" {
		return 0, "", "", 0, "", false
	}
	return idx, bs, rw, iodepth, metric, true
}

func readLogPairs(path string) [][]float64 {
	f, err := os.Open(path)
	if err != nil {
		return nil
	}
	defer f.Close()

	var pairs [][]float64
	scanner := bufio.NewScanner(f)
	reSplit := regexp.MustCompile(`[,\s]+`)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		parts := reSplit.Split(line, -1)
		if len(parts) < 2 {
			continue
		}
		t, err1 := strconv.ParseFloat(parts[0], 64)
		v, err2 := strconv.ParseFloat(parts[1], 64)
		if err1 == nil && err2 == nil {
			pairs = append(pairs, []float64{t, v})
		}
	}
	return pairs
}

func BSToBytes(bs string) int {
	bs = strings.ToLower(bs)
	var multiplier int = 1
	var numStr string
	if strings.HasSuffix(bs, "k") {
		multiplier = 1024
		numStr = bs[:len(bs)-1]
	} else if strings.HasSuffix(bs, "m") {
		multiplier = 1024 * 1024
		numStr = bs[:len(bs)-1]
	} else if strings.HasSuffix(bs, "g") {
		multiplier = 1024 * 1024 * 1024
		numStr = bs[:len(bs)-1]
	} else {
		numStr = bs
	}
	num, err := strconv.Atoi(numStr)
	if err != nil {
		return 0
	}
	return num * multiplier
}

func RWRank(rw string) int {
	mapping := map[string]int{
		"read":      10,
		"write":     20,
		"randread":  30,
		"randwrite": 40,
		"rw":        50,
		"readwrite": 50,
		"randrw":    60,
	}
	if rank, ok := mapping[strings.ToLower(rw)]; ok {
		return rank
	}
	return 100
}

func BuildChartGroups(dataDir string) []models.ChartGroup {
	type groupKey struct {
		Idx     int
		BS      string
		RW      string
		IODepth int
	}

	groupsMap := make(map[groupKey]map[string]map[string][][]float64)

	entries, err := os.ReadDir(dataDir)
	if err != nil {
		return nil
	}

	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		hostName := entry.Name()
		hostDir := filepath.Join(dataDir, hostName)
		logsDir := filepath.Join(hostDir, "logs")

		logEntries, err := os.ReadDir(logsDir)
		if err != nil {
			continue
		}

		for _, logEntry := range logEntries {
			if logEntry.IsDir() {
				continue
			}
			fpath := filepath.Join(logsDir, logEntry.Name())
			idx, bs, rw, iodepth, metric, ok := parseLogBase(logEntry.Name())
			if !ok {
				continue
			}

			pairs := readLogPairs(fpath)
			if len(pairs) == 0 {
				continue
			}

			for i := range pairs {
				if metric == "bw" {
					pairs[i][1] /= 1024.0
				} else if metric == "lat" || metric == "clat" || metric == "slat" {
					pairs[i][1] /= 1000000.0
				}
			}

			key := groupKey{Idx: idx, BS: bs, RW: rw, IODepth: iodepth}
			if groupsMap[key] == nil {
				groupsMap[key] = map[string]map[string][][]float64{
					"iops": {}, "bw": {}, "lat": {}, "clat": {}, "slat": {},
				}
			}
			if groupsMap[key][metric] == nil {
				groupsMap[key][metric] = make(map[string][][]float64)
			}
			groupsMap[key][metric][hostName] = pairs
		}
	}

	var out []models.ChartGroup
	for k, metrics := range groupsMap {
		out = append(out, models.ChartGroup{
			Label:   fmt.Sprintf("%d_%s_%s_iodepth%d", k.Idx, k.BS, k.RW, k.IODepth),
			Idx:     k.Idx,
			BS:      k.BS,
			RW:      k.RW,
			IODepth: k.IODepth,
			Metrics: metrics,
			BSBytes: BSToBytes(k.BS),
			RWRank:  RWRank(k.RW),
		})
	}
	return out
}
