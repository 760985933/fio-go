package parser

import (
	"fmt"
	"sort"
	"strconv"
	"strings"

	"fio-go/internal/models"
)

func extractClatPercentiles(readMap, writeMap map[string]interface{}) (readP, writeP [6]float64) {
	if readMap != nil {
		var pctMap map[string]interface{}
		var isNs bool
		if clatNs, ok := readMap["clat_ns"].(map[string]interface{}); ok {
			pctMap, _ = clatNs["percentile"].(map[string]interface{})
			readP[4] = parseValueFloat(clatNs["min"]) / 1000.0
			readP[5] = parseValueFloat(clatNs["max"]) / 1000.0
			isNs = true
		} else if clat, ok := readMap["clat"].(map[string]interface{}); ok {
			pctMap, _ = clat["percentile"].(map[string]interface{})
			readP[4] = parseValueFloat(clat["min"])
			readP[5] = parseValueFloat(clat["max"])
		}
		if pctMap != nil {
			divisor := 1.0
			if isNs {
				divisor = 1000.0
			}
			if v, ok := pctMap["50.000000"]; ok {
				readP[0] = parseValueFloat(v) / divisor
			}
			if v, ok := pctMap["95.000000"]; ok {
				readP[1] = parseValueFloat(v) / divisor
			}
			if v, ok := pctMap["99.000000"]; ok {
				readP[2] = parseValueFloat(v) / divisor
			}
			if v, ok := pctMap["99.990000"]; ok {
				readP[3] = parseValueFloat(v) / divisor
			}
		}
	}

	if writeMap != nil {
		var pctMap map[string]interface{}
		var isNs bool
		if clatNs, ok := writeMap["clat_ns"].(map[string]interface{}); ok {
			pctMap, _ = clatNs["percentile"].(map[string]interface{})
			writeP[4] = parseValueFloat(clatNs["min"]) / 1000.0
			writeP[5] = parseValueFloat(clatNs["max"]) / 1000.0
			isNs = true
		} else if clat, ok := writeMap["clat"].(map[string]interface{}); ok {
			pctMap, _ = clat["percentile"].(map[string]interface{})
			writeP[4] = parseValueFloat(clat["min"])
			writeP[5] = parseValueFloat(clat["max"])
		}
		if pctMap != nil {
			divisor := 1.0
			if isNs {
				divisor = 1000.0
			}
			if v, ok := pctMap["50.000000"]; ok {
				writeP[0] = parseValueFloat(v) / divisor
			}
			if v, ok := pctMap["95.000000"]; ok {
				writeP[1] = parseValueFloat(v) / divisor
			}
			if v, ok := pctMap["99.000000"]; ok {
				writeP[2] = parseValueFloat(v) / divisor
			}
			if v, ok := pctMap["99.990000"]; ok {
				writeP[3] = parseValueFloat(v) / divisor
			}
		}
	}
	return
}

func parseClatDistFromMap(dirMap map[string]interface{}) []models.ClatDistEntry {
	var distMap map[string]interface{}

	if clatNs, ok := dirMap["clat_ns"].(map[string]interface{}); ok {
		distMap, _ = clatNs["bins"].(map[string]interface{})
		if distMap == nil {
			distMap, _ = clatNs["dist"].(map[string]interface{})
		}
	} else if clat, ok := dirMap["clat"].(map[string]interface{}); ok {
		distMap, _ = clat["bins"].(map[string]interface{})
		if distMap == nil {
			distMap, _ = clat["dist"].(map[string]interface{})
		}
	}

	if distMap == nil {
		return nil
	}

	isNs := false
	if _, ok := dirMap["clat_ns"]; ok {
		isNs = true
	}

	type kv struct {
		edge float64
		val  float64
	}
	var entries []kv

	for k, v := range distMap {
		val := parseValueFloat(v)
		if val <= 0 {
			continue
		}
		edgeStr := strings.TrimPrefix(k, "bin_edge_")
		edge, err := strconv.ParseFloat(edgeStr, 64)
		if err != nil {
			continue
		}
		entries = append(entries, kv{edge: edge, val: val})
	}

	sort.Slice(entries, func(i, j int) bool {
		return entries[i].edge < entries[j].edge
	})

	var result []models.ClatDistEntry
	for _, e := range entries {
		edgeUS := e.edge
		if isNs {
			edgeUS = e.edge / 1000.0
		}
		result = append(result, models.ClatDistEntry{Edge: edgeUS, Count: e.val})
	}
	return result
}

func extractClatDist(readMap, writeMap map[string]interface{}) (readDist, writeDist []models.ClatDistEntry) {
	if readMap != nil {
		readDist = parseClatDistFromMap(readMap)
	}
	if writeMap != nil {
		writeDist = parseClatDistFromMap(writeMap)
	}
	return
}

func ExtractClatAnalysis(fioResult *FioResult, ip string) map[string]map[string]*models.HostClatData {
	result := make(map[string]map[string]*models.HostClatData)

	for i, job := range fioResult.Jobs {
		bs := ExtractBS(job)
		jobname := fmt.Sprintf("job_%d", i+1)
		if jn, ok := job["jobname"].(string); ok {
			jobname = jn
		}

		readMap, _ := job["read"].(map[string]interface{})
		writeMap, _ := job["write"].(map[string]interface{})

		rP, wP := extractClatPercentiles(readMap, writeMap)
		readDist, writeDist := extractClatDist(readMap, writeMap)

		if result[bs] == nil {
			result[bs] = make(map[string]*models.HostClatData)
		}
		if result[bs][jobname] == nil {
			result[bs][jobname] = &models.HostClatData{IP: ip}
		}
		result[bs][jobname].ReadP50 = rP[0]
		result[bs][jobname].ReadP95 = rP[1]
		result[bs][jobname].ReadP99 = rP[2]
		result[bs][jobname].ReadP999 = rP[3]
		result[bs][jobname].ReadMin = rP[4]
		result[bs][jobname].ReadMax = rP[5]
		result[bs][jobname].WriteP50 = wP[0]
		result[bs][jobname].WriteP95 = wP[1]
		result[bs][jobname].WriteP99 = wP[2]
		result[bs][jobname].WriteP999 = wP[3]
		result[bs][jobname].WriteMin = wP[4]
		result[bs][jobname].WriteMax = wP[5]
		result[bs][jobname].ReadDist = readDist
		result[bs][jobname].WriteDist = writeDist
	}

	return result
}

func mergeClatAnalysis(dst, src map[string]map[string]*models.HostClatData) {
	for bs, jobMap := range src {
		if dst[bs] == nil {
			dst[bs] = make(map[string]*models.HostClatData)
		}
		for jobname, srcData := range jobMap {
			if dst[bs][jobname] == nil {
				dst[bs][jobname] = srcData
			} else {
				dstData := dst[bs][jobname]
				if dstData.ReadP50 == 0 && srcData.ReadP50 > 0 {
					dstData.ReadP50 = srcData.ReadP50
				}
				if dstData.ReadP95 == 0 && srcData.ReadP95 > 0 {
					dstData.ReadP95 = srcData.ReadP95
				}
				if dstData.ReadP99 == 0 && srcData.ReadP99 > 0 {
					dstData.ReadP99 = srcData.ReadP99
				}
				if dstData.ReadP999 == 0 && srcData.ReadP999 > 0 {
					dstData.ReadP999 = srcData.ReadP999
				}
				if dstData.ReadMin == 0 && srcData.ReadMin > 0 {
					dstData.ReadMin = srcData.ReadMin
				}
				if dstData.ReadMax == 0 && srcData.ReadMax > 0 {
					dstData.ReadMax = srcData.ReadMax
				}
				if dstData.WriteP50 == 0 && srcData.WriteP50 > 0 {
					dstData.WriteP50 = srcData.WriteP50
				}
				if dstData.WriteP95 == 0 && srcData.WriteP95 > 0 {
					dstData.WriteP95 = srcData.WriteP95
				}
				if dstData.WriteP99 == 0 && srcData.WriteP99 > 0 {
					dstData.WriteP99 = srcData.WriteP99
				}
				if dstData.WriteP999 == 0 && srcData.WriteP999 > 0 {
					dstData.WriteP999 = srcData.WriteP999
				}
				if dstData.WriteMin == 0 && srcData.WriteMin > 0 {
					dstData.WriteMin = srcData.WriteMin
				}
				if dstData.WriteMax == 0 && srcData.WriteMax > 0 {
					dstData.WriteMax = srcData.WriteMax
				}
				if len(dstData.ReadDist) == 0 && len(srcData.ReadDist) > 0 {
					dstData.ReadDist = srcData.ReadDist
				}
				if len(dstData.WriteDist) == 0 && len(srcData.WriteDist) > 0 {
					dstData.WriteDist = srcData.WriteDist
				}
			}
		}
	}
}
