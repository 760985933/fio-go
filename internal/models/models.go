package models

import (
	"os"
	"path/filepath"
)

// DataBaseDir 返回应用数据根目录 ~/.nettopo_test
func DataBaseDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return "."
	}
	return filepath.Join(home, ".nettopo_test")
}

type NodeMetric struct {
	IP              string
	RW              string
	IODepth         int
	ReadIOPS        float64
	WriteIOPS       float64
	ReadBW          float64 // KiB/s
	WriteBW         float64 // KiB/s
	ReadClatMeanUS  float64
	WriteClatMeanUS float64
	ReadClatP50     float64
	ReadClatP95     float64
	ReadClatP99     float64
	ReadClatP999    float64
	ReadClatMin     float64
	ReadClatMax     float64
	WriteClatP50    float64
	WriteClatP95    float64
	WriteClatP99    float64
	WriteClatP999   float64
	WriteClatMin    float64
	WriteClatMax    float64
}

type GroupedMetric struct {
	BS         string
	Jobname    string
	RW         string
	IODepth    int
	Numjobs    int
	ReadIOPS   float64
	WriteIOPS  float64
	ReadBWMB   float64 // MB/s
	WriteBWMB  float64 // MB/s
	ReadLatMS  float64 // ms
	WriteLatMS float64 // ms
}

type Perf struct {
	Jobname   string
	IOPSR     float64
	BWR       float64
	ClatR     float64
	ClatRMin  float64
	ClatRMax  float64
	ClatR99   float64
	ClatRDist map[string]float64
	IOPSW     float64
	BWW       float64
	ClatW     float64
	ClatWMin  float64
	ClatWMax  float64
	ClatW99   float64
	ClatWDist map[string]float64
	Info      map[string]string
}

type ChartGroup struct {
	Label   string
	Idx     int
	BS      string
	RW      string
	IODepth int
	Metrics map[string]map[string][][]float64
	BSBytes int
	RWRank  int
}

type ClatDistEntry struct {
	Edge  float64 `json:"edge"`
	Count float64 `json:"count"`
}

type HostClatData struct {
	IP        string           `json:"ip"`
	ReadP50   float64          `json:"readP50"`
	ReadP95   float64          `json:"readP95"`
	ReadP99   float64          `json:"readP99"`
	ReadP999  float64          `json:"readP999"`
	ReadMin   float64          `json:"readMin"`
	ReadMax   float64          `json:"readMax"`
	WriteP50  float64          `json:"writeP50"`
	WriteP95  float64          `json:"writeP95"`
	WriteP99  float64          `json:"writeP99"`
	WriteP999 float64          `json:"writeP999"`
	WriteMin  float64          `json:"writeMin"`
	WriteMax  float64          `json:"writeMax"`
	ReadDist  []ClatDistEntry  `json:"readDist"`
	WriteDist []ClatDistEntry  `json:"writeDist"`
}
