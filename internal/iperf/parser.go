package iperf

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

type iperf3JSONRaw struct {
	End       *iperf3EndRaw   `json:"end"`
	Start     *iperf3StartRaw `json:"start"`
	Intervals []struct {
		Streams []iperf3StreamRaw `json:"streams"`
		Sum     *iperf3SumRaw     `json:"sum"`
	} `json:"intervals"`
}

type iperf3StartRaw struct {
	Version   string                 `json:"version"`
	Host      string                 `json:"host"`
	OtherInfo map[string]interface{} `json:"-"`
}

type iperf3EndRaw struct {
	Time     string            `json:"time"`
	Duration float64           `json:"duration"`
	Streams  []iperf3StreamRaw `json:"streams"`
	SumSent  *iperf3SumRaw     `json:"sum_sent"`
	Sum      *iperf3SumRaw     `json:"sum"`
	CPU      *iperf3CPURaw     `json:"cpu_utilization_percent"`
}

type iperf3StreamRaw struct {
	Start         float64 `json:"start"`
	End           float64 `json:"end"`
	Seconds       float64 `json:"seconds"`
	Bytes         float64 `json:"bytes"`
	BitsPerSecond float64 `json:"bits_per_second"`
	JitterMs      float64 `json:"jitter_ms"`
	LostPackets   int     `json:"lost_packets"`
	TotalPackets  int     `json:"total_packets"`
	Retransmits   int     `json:"retransmits"`
}

type iperf3SumRaw struct {
	Start         float64 `json:"start"`
	End           float64 `json:"end"`
	Seconds       float64 `json:"seconds"`
	Bytes         float64 `json:"bytes"`
	BitsPerSecond float64 `json:"bits_per_second"`
	Retransmits   int     `json:"retransmits"`
}

type iperf3CPURaw struct {
	HostTotal    float64 `json:"host_total"`
	HostUser     float64 `json:"host_user"`
	HostSystem   float64 `json:"host_system"`
	RemoteTotal  float64 `json:"remote_total"`
	RemoteUser   float64 `json:"remote_user"`
	RemoteSystem float64 `json:"remote_system"`
}

func ParseIntervalLine(jsonLine string) ([]IperfInterval, error) {
	jsonLine = strings.TrimSpace(jsonLine)
	if jsonLine == "" {
		return nil, nil
	}

	// iperf3 --json-stream 输出为事件流：{"event":"interval","data":{"streams":[...],"sum":{...}}}
	var evt struct {
		Event string `json:"event"`
		Data  struct {
			Streams []iperf3StreamRaw `json:"streams"`
			Sum     *iperf3SumRaw     `json:"sum"`
		} `json:"data"`
	}
	if err := json.Unmarshal([]byte(jsonLine), &evt); err != nil {
		return nil, fmt.Errorf("failed to parse iperf3 interval JSON: %v", err)
	}

	// 兼容旧格式（部分 iperf3 版本/参数下为 {"intervals":[{"streams":[...],"sum":{...}}]}）
	if evt.Event == "" {
		var legacy struct {
			Intervals []struct {
				Streams []iperf3StreamRaw `json:"streams"`
				Sum     *iperf3SumRaw     `json:"sum"`
			} `json:"intervals"`
		}
		if err := json.Unmarshal([]byte(jsonLine), &legacy); err != nil {
			return nil, fmt.Errorf("failed to parse iperf3 interval JSON: %v", err)
		}
		var out []IperfInterval
		for _, interval := range legacy.Intervals {
			out = append(out, buildIntervalsFromData(interval.Streams, interval.Sum)...)
		}
		return out, nil
	}

	if evt.Event != "interval" {
		return nil, nil
	}
	return buildIntervalsFromData(evt.Data.Streams, evt.Data.Sum), nil
}

// buildIntervalsFromData 把一次 interval 的 streams（逐流）与 sum（汇总）转成 IperfInterval 列表。
func buildIntervalsFromData(streams []iperf3StreamRaw, sum *iperf3SumRaw) []IperfInterval {
	var intervals []IperfInterval
	if sum != nil {
		intervals = append(intervals, IperfInterval{
			Timestamp:     sum.Start,
			StreamID:      -1,
			Duration:      sum.Seconds,
			Bytes:         sum.Bytes,
			BitsPerSecond: sum.BitsPerSecond,
			Retransmits:   sum.Retransmits,
		})
	}
	for streamIdx, stream := range streams {
		intervals = append(intervals, IperfInterval{
			Timestamp:     stream.Start,
			StreamID:      streamIdx,
			Duration:      stream.Seconds,
			Bytes:         stream.Bytes,
			BitsPerSecond: stream.BitsPerSecond,
			JitterMs:      stream.JitterMs,
			LostPackets:   stream.LostPackets,
			TotalPackets:  stream.TotalPackets,
			Retransmits:   stream.Retransmits,
		})
	}
	return intervals
}

func ParseResultFile(filePath string) (*IperfResult, error) {
	data, err := os.ReadFile(filePath)
	if err != nil {
		return nil, fmt.Errorf("failed to read file %s: %v", filePath, err)
	}

	result := &IperfResult{}

	decoder := json.NewDecoder(strings.NewReader(string(data)))

	for decoder.More() {
		// 兼容两种格式：
		//  1) --json-stream 事件流：{"event":"start|interval|end","data":{...}}
		//  2) 旧版单次 JSON 报告：{"start":{...},"end":{...},"intervals":[{...}]}
		var obj struct {
			Event string `json:"event"`
			Data  struct {
				Version string            `json:"version"`
				Streams []iperf3StreamRaw `json:"streams"`
				SumSent *iperf3SumRaw     `json:"sum_sent"`
				Sum     *iperf3SumRaw     `json:"sum"`
				CPU     *iperf3CPURaw     `json:"cpu_utilization_percent"`
			} `json:"data"`
			Start     *iperf3StartRaw `json:"start"`
			End       *iperf3EndRaw   `json:"end"`
			Intervals []struct {
				Streams []iperf3StreamRaw `json:"streams"`
				Sum     *iperf3SumRaw     `json:"sum"`
			} `json:"intervals"`
		}
		if err := decoder.Decode(&obj); err != nil {
			break
		}

		if obj.Event != "" {
			switch obj.Event {
			case "start":
				if obj.Data.Version != "" {
					result.Version = obj.Data.Version
				}
			case "interval":
				appendStreamIntervals(result, obj.Data.Streams)
			case "end":
				// end 事件给出的是累计值（start=0），不再作为时序点追加，仅取 CPU 信息
				if obj.Data.CPU != nil {
					setCPU(result, obj.Data.CPU.HostUser, obj.Data.CPU.HostSystem)
				}
			}
			continue
		}

		// 旧版单次 JSON 报告
		if obj.Start != nil && obj.Start.Version != "" {
			result.Version = obj.Start.Version
		}
		if obj.End != nil {
			for _, stream := range obj.End.Streams {
				idx := len(result.Streams)
				result.Streams = append(result.Streams, StreamResult{
					StreamID: idx,
					Intervals: []IperfInterval{{
						Timestamp:     stream.Start,
						StreamID:      idx,
						Duration:      stream.Seconds,
						Bytes:         stream.Bytes,
						BitsPerSecond: stream.BitsPerSecond,
						JitterMs:      stream.JitterMs,
						LostPackets:   stream.LostPackets,
						TotalPackets:  stream.TotalPackets,
						Retransmits:   stream.Retransmits,
					}},
				})
			}
			if obj.End.CPU != nil {
				setCPU(result, obj.End.CPU.HostUser, obj.End.CPU.HostSystem)
			}
			continue
		}
		for _, interval := range obj.Intervals {
			appendStreamIntervals(result, interval.Streams)
		}
	}

	return result, nil
}

func appendStreamIntervals(result *IperfResult, streams []iperf3StreamRaw) {
	for streamIdx, stream := range streams {
		for len(result.Streams) <= streamIdx {
			result.Streams = append(result.Streams, StreamResult{
				StreamID:  len(result.Streams),
				Intervals: []IperfInterval{},
			})
		}
		result.Streams[streamIdx].Intervals = append(result.Streams[streamIdx].Intervals, IperfInterval{
			Timestamp:     stream.Start,
			StreamID:      streamIdx,
			Duration:      stream.Seconds,
			Bytes:         stream.Bytes,
			BitsPerSecond: stream.BitsPerSecond,
			JitterMs:      stream.JitterMs,
			LostPackets:   stream.LostPackets,
			TotalPackets:  stream.TotalPackets,
			Retransmits:   stream.Retransmits,
		})
	}
}

func setCPU(result *IperfResult, user, sys float64) {
	for i := range result.Streams {
		if len(result.Streams[i].Intervals) > 0 {
			last := len(result.Streams[i].Intervals) - 1
			result.Streams[i].Intervals[last].CPUUser = user
			result.Streams[i].Intervals[last].CPUSys = sys
		}
	}
}

func CollectResults(taskDir string, hosts []string) ([]*IperfResult, error) {
	var results []*IperfResult

	for _, hostDir := range hosts {
		dataDir := filepath.Join(taskDir, hostDir, "data")
		entries, err := os.ReadDir(dataDir)
		if err != nil {
			continue
		}

		for _, entry := range entries {
			if entry.IsDir() {
				continue
			}
			name := entry.Name()
			if strings.HasSuffix(name, ".json") || strings.HasSuffix(name, ".log") {
				fullPath := filepath.Join(dataDir, name)
				result, err := ParseResultFile(fullPath)
				if err != nil {
					continue
				}
				result.Host = hostDir
				results = append(results, result)
			}
		}
	}

	return results, nil
}
