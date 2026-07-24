package parser

import (
	"encoding/json"
	"fmt"
	"io/ioutil"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"fio-go/internal/models"
)

type FioJob map[string]interface{}
type FioResult struct {
	FioVersion string   `json:"fio version"`
	Jobs       []FioJob `json:"jobs"`
}

func ExtractIPFromPath(fpath string) string {
	re := regexp.MustCompile(`(\d{1,3}(?:\.\d{1,3}){3})`)
	m := re.FindStringSubmatch(fpath)
	if len(m) > 1 {
		return m[1]
	}
	return "unknown"
}

func parseValueFloat(val interface{}) float64 {
	switch v := val.(type) {
	case float64:
		return v
	case int:
		return float64(v)
	case int64:
		return float64(v)
	case string:
		f, _ := strconv.ParseFloat(v, 64)
		return f
	case map[string]interface{}:
		// Sometimes wrapped
		return 0
	default:
		return 0
	}
}

func parseValueInt(val interface{}) int {
	switch v := val.(type) {
	case float64:
		return int(v)
	case string:
		i, _ := strconv.Atoi(v)
		return i
	default:
		return 0
	}
}

func ClatMeanUS(job FioJob) (float64, float64) {
	readMap, _ := job["read"].(map[string]interface{})
	writeMap, _ := job["write"].(map[string]interface{})

	var r, w float64

	if readMap != nil {
		if clatNs, ok := readMap["clat_ns"].(map[string]interface{}); ok {
			r = parseValueFloat(clatNs["mean"]) / 1000.0
		} else if clat, ok := readMap["clat"].(map[string]interface{}); ok {
			r = parseValueFloat(clat["mean"])
		}
	}

	if writeMap != nil {
		if clatNs, ok := writeMap["clat_ns"].(map[string]interface{}); ok {
			w = parseValueFloat(clatNs["mean"]) / 1000.0
		} else if clat, ok := writeMap["clat"].(map[string]interface{}); ok {
			w = parseValueFloat(clat["mean"])
		}
	}

	return r, w
}

func ExtractBS(job FioJob) string {
	if jobname, ok := job["jobname"].(string); ok {
		re := regexp.MustCompile(`(?i)(\d+[kKmM])`)
		m := re.FindStringSubmatch(jobname)
		if len(m) > 1 {
			return strings.ToLower(m[1])
		}
	}
	if opts, ok := job["job options"].(map[string]interface{}); ok {
		if bs, ok := opts["bs"]; ok {
			return strings.ToLower(fmt.Sprintf("%v", bs))
		}
	}
	return "unknown"
}

func ExtractRW(job FioJob) string {
	if opts, ok := job["job options"].(map[string]interface{}); ok {
		if rw, ok := opts["rw"]; ok {
			return strings.ToLower(fmt.Sprintf("%v", rw))
		}
	}
	if jobname, ok := job["jobname"].(string); ok {
		re := regexp.MustCompile(`(?i)_(readwrite|randrw|randread|randwrite|read|write)_`)
		m := re.FindStringSubmatch(jobname)
		if len(m) > 1 {
			return strings.ToLower(m[1])
		}
	}
	return "unknown"
}

func ExtractIODepth(job FioJob) int {
	if opts, ok := job["job options"].(map[string]interface{}); ok {
		if idp, ok := opts["iodepth"]; ok {
			return parseValueInt(idp)
		}
	}
	if jobname, ok := job["jobname"].(string); ok {
		re := regexp.MustCompile(`(?i)iodepth(\d+)`)
		m := re.FindStringSubmatch(jobname)
		if len(m) > 1 {
			i, _ := strconv.Atoi(m[1])
			return i
		}
	}
	return 0
}

func ExtractNumJobs(job FioJob) int {
	if opts, ok := job["job options"].(map[string]interface{}); ok {
		if nj, ok := opts["numjobs"]; ok {
			return parseValueInt(nj)
		}
	}
	if jobname, ok := job["jobname"].(string); ok {
		re := regexp.MustCompile(`(?i)numjobs(\d+)`)
		m := re.FindStringSubmatch(jobname)
		if len(m) > 1 {
			i, _ := strconv.Atoi(m[1])
			return i
		}
	}
	return 0
}

func ParseFioJSON(fpath string) (*FioResult, error) {
	data, err := ioutil.ReadFile(fpath)
	if err != nil {
		return nil, err
	}
	content := string(data)
	start := strings.Index(content, "{")
	end := strings.LastIndex(content, "}")
	if start != -1 && end != -1 {
		content = content[start : end+1]
	}
	var res FioResult
	err = json.Unmarshal([]byte(content), &res)
	if err != nil {
		return nil, err
	}
	return &res, nil
}

type AnalysisResult struct {
	FilesTotal  int
	FilesOK     int
	FilesFailed int
	Aggregated  map[string]map[string]map[string]models.NodeMetric
	SystemTexts map[string]string
	NumJobsMap  map[string]int
	ClatAnalysis map[string]map[string]*models.HostClatData
}

func (res *AnalysisResult) AggregatedToGroupedRows() []models.GroupedMetric {
	var bsKeys []string
	for k := range res.Aggregated {
		bsKeys = append(bsKeys, k)
	}
	sort.Slice(bsKeys, func(i, j int) bool {
		return BSToBytes(bsKeys[i]) < BSToBytes(bsKeys[j])
	})

	var groupedRows []models.GroupedMetric

	for _, bs := range bsKeys {
		jobMap := res.Aggregated[bs]
		jobKeys := make([]string, 0, len(jobMap))
		for j := range jobMap {
			jobKeys = append(jobKeys, j)
		}
		sort.Slice(jobKeys, func(i, j int) bool {
			var rw1, rw2 string
			for _, n := range jobMap[jobKeys[i]] {
				rw1 = n.RW
				break
			}
			for _, n := range jobMap[jobKeys[j]] {
				rw2 = n.RW
				break
			}
			r1 := RWRank(rw1)
			r2 := RWRank(rw2)
			if r1 == r2 {
				return jobKeys[i] < jobKeys[j]
			}
			return r1 < r2
		})

		for _, jobname := range jobKeys {
			ipMap := jobMap[jobname]
			var nodes []models.NodeMetric
			for _, metric := range ipMap {
				nodes = append(nodes, metric)
			}
			if len(nodes) == 0 {
				continue
			}

			var rIopsSum, wIopsSum, rBwSum, wBwSum, rLatSum, wLatSum float64
			rw := nodes[0].RW
			iodepth := nodes[0].IODepth

			for _, n := range nodes {
				rIopsSum += n.ReadIOPS
				wIopsSum += n.WriteIOPS
				rBwSum += n.ReadBW
				wBwSum += n.WriteBW
				rLatSum += n.ReadClatMeanUS * n.ReadIOPS
				wLatSum += n.WriteClatMeanUS * n.WriteIOPS
			}

			rLatAvg := 0.0
			if rIopsSum > 0 {
				rLatAvg = rLatSum / rIopsSum
			}
			wLatAvg := 0.0
			if wIopsSum > 0 {
				wLatAvg = wLatSum / wIopsSum
			}

			nj := res.NumJobsMap[MakeNumJobsKey(bs, strings.ToLower(rw), iodepth)]
			if nj == 0 {
				nj = ExtractNumJobs(FioJob{"jobname": jobname})
			}

			groupedRows = append(groupedRows, models.GroupedMetric{
				BS: bs, Jobname: jobname, RW: rw, IODepth: iodepth, Numjobs: nj,
				ReadIOPS: rIopsSum, WriteIOPS: wIopsSum,
				ReadBWMB: rBwSum / 1024.0, WriteBWMB: wBwSum / 1024.0,
				ReadLatMS: rLatAvg / 1000.0, WriteLatMS: wLatAvg / 1000.0,
			})
		}
	}
	return groupedRows
}

func MakeNumJobsKey(bs, rw string, iodepth int) string {
        return fmt.Sprintf("%s|%s|%d", bs, rw, iodepth)
}

func AnalyzeJSONFiles(dataRoot string) (*AnalysisResult, error) {
	res := &AnalysisResult{
		Aggregated:   make(map[string]map[string]map[string]models.NodeMetric),
		SystemTexts:  make(map[string]string),
		NumJobsMap:   make(map[string]int),
		ClatAnalysis: make(map[string]map[string]*models.HostClatData),
	}

	err := filepath.Walk(dataRoot, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}
		if info.IsDir() {
			return nil
		}
		fname := info.Name()

		lowerFname := strings.ToLower(fname)
		if lowerFname == "system.txt" || strings.HasPrefix(lowerFname, "system_") || strings.HasPrefix(lowerFname, "_system") {
			data, _ := ioutil.ReadFile(path)
			ip := ExtractIPFromPath(path)
			if ip == "unknown" {
				ip = filepath.Base(filepath.Dir(path))
			}
			res.SystemTexts[ip] = string(data)
			return nil
		}

		isJson := strings.HasSuffix(lowerFname, ".json") && lowerFname != "system.json" && !strings.HasPrefix(lowerFname, "_system") && !strings.HasPrefix(lowerFname, "system_")
		isTxt := strings.HasSuffix(lowerFname, ".txt") && lowerFname != "system.txt" && !strings.HasSuffix(lowerFname, ".txt.txt") && !strings.HasPrefix(lowerFname, "_system") && !strings.HasPrefix(lowerFname, "system_")

		if !isJson && !isTxt {
			return nil
		}

		res.FilesTotal++
		fioRes, err := ParseFioJSON(path)
		if err != nil {
			res.FilesFailed++
			return nil
		}
		res.FilesOK++

		for i, job := range fioRes.Jobs {
			jobname := fmt.Sprintf("job_%d", i+1)
			if jn, ok := job["jobname"].(string); ok {
				jobname = jn
			}
			readMap, _ := job["read"].(map[string]interface{})
			writeMap, _ := job["write"].(map[string]interface{})

			rIops := parseValueFloat(readMap["iops"])
			wIops := parseValueFloat(writeMap["iops"])
			rBw := parseValueFloat(readMap["bw"])
			wBw := parseValueFloat(writeMap["bw"])
		rClat, wClat := ClatMeanUS(job)

		bs := ExtractBS(job)
		rw := ExtractRW(job)
		iodepth := ExtractIODepth(job)
		nj := ExtractNumJobs(job)

		if bs != "unknown" && rw != "unknown" && iodepth > 0 && nj > 0 {
			res.NumJobsMap[MakeNumJobsKey(bs, rw, iodepth)] = nj
		}

		ip := ExtractIPFromPath(path)

		rP, wP := extractClatPercentiles(readMap, writeMap)

		metric := models.NodeMetric{
			IP:              ip,
			RW:              rw,
			IODepth:         iodepth,
			ReadIOPS:        rIops,
			WriteIOPS:       wIops,
			ReadBW:          rBw,
			WriteBW:         wBw,
			ReadClatMeanUS:  rClat,
			WriteClatMeanUS: wClat,
			ReadClatP50:     rP[0],
			ReadClatP95:     rP[1],
			ReadClatP99:     rP[2],
			ReadClatP999:    rP[3],
			ReadClatMin:     rP[4],
			ReadClatMax:     rP[5],
			WriteClatP50:    wP[0],
			WriteClatP95:    wP[1],
			WriteClatP99:    wP[2],
			WriteClatP999:   wP[3],
			WriteClatMin:    wP[4],
			WriteClatMax:    wP[5],
		}

			if res.Aggregated[bs] == nil {
				res.Aggregated[bs] = make(map[string]map[string]models.NodeMetric)
			}
			if res.Aggregated[bs][jobname] == nil {
				res.Aggregated[bs][jobname] = make(map[string]models.NodeMetric)
			}
			res.Aggregated[bs][jobname][ip] = metric

		clatData := ExtractClatAnalysis(fioRes, ip)
		mergeClatAnalysis(res.ClatAnalysis, clatData)
		}

		return nil
	})

	return res, err
}
