package iperf

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

type iperf3JSONRaw struct {
	End      *iperf3EndRaw   `json:"end"`
	Start    *iperf3StartRaw `json:"start"`
	Intervals []struct {
		Streams []iperf3StreamRaw `json:"streams"`
		Sum     *iperf3SumRaw     `json:"sum"`
	} `json:"intervals"`
}

type iperf3StartRaw struct {
	Version  string                 `json:"version"`
	Host     string                 `json:"host"`
	OtherInfo map[string]interface{} `json:"-"`
}

type iperf3EndRaw struct {
	Time     string                `json:"time"`
	Duration float64               `json:"duration"`
	Streams  []iperf3StreamRaw     `json:"streams"`
	SumSent  *iperf3SumRaw         `json:"sum_sent"`
	Sum      *iperf3SumRaw         `json:"sum"`
	CPU      *iperf3CPURaw         `json:"cpu_utilization_percent"`
}

type iperf3StreamRaw struct {
	Start    float64 `json:"start"`
	End      float64 `json:"end"`
	Seconds  float64 `json:"seconds"`
	Bytes    float64 `json:"bytes"`
	BitsPerSecond float64 `json:"bits_per_second"`
	JitterMs float64 `json:"jitter_ms"`
	LostPackets int   `json:"lost_packets"`
	TotalPackets int `json:"total_packets"`
	Retransmits  int `json:"retransmits"`
}

type iperf3SumRaw struct {
	Start    float64 `json:"start"`
	End      float64 `json:"end"`
	Seconds  float64 `json:"seconds"`
	Bytes    float64 `json:"bytes"`
	BitsPerSecond float64 `json:"bits_per_second"`
	Retransmits  int     `json:"retransmits"`
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

	var raw struct {
		Intervals []struct {
			Streams []iperf3StreamRaw `json:"streams"`
			Sum     *iperf3SumRaw     `json:"sum"`
		} `json:"intervals"`
	}

	if err := json.Unmarshal([]byte(jsonLine), &raw); err != nil {
		return nil, fmt.Errorf("failed to parse iperf3 interval JSON: %v", err)
	}

	var intervals []IperfInterval
	for _, interval := range raw.Intervals {
		if interval.Sum != nil {
			intervals = append(intervals, IperfInterval{
				Timestamp:     interval.Sum.Start,
				StreamID:      -1,
				Duration:      interval.Sum.Seconds,
				Bytes:         interval.Sum.Bytes,
				BitsPerSecond: interval.Sum.BitsPerSecond,
				Retransmits:   interval.Sum.Retransmits,
			})
		}
		for streamIdx, stream := range interval.Streams {
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
	}
	return intervals, nil
}

func ParseResultFile(filePath string) (*IperfResult, error) {
	data, err := os.ReadFile(filePath)
	if err != nil {
		return nil, fmt.Errorf("failed to read file %s: %v", filePath, err)
	}

	result := &IperfResult{}

	decoder := json.NewDecoder(strings.NewReader(string(data)))

	for decoder.More() {
		var raw iperf3JSONRaw
		if err := decoder.Decode(&raw); err != nil {
			break
		}

		if raw.Start != nil && raw.Start.Version != "" {
			result.Version = raw.Start.Version
		}

		if raw.End != nil {
			for _, stream := range raw.End.Streams {
				streamIdx := len(result.Streams)
				result.Streams = append(result.Streams, StreamResult{
					StreamID: streamIdx,
					Intervals: []IperfInterval{{
						Timestamp:     stream.Start,
						StreamID:      streamIdx,
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

			if raw.End.CPU != nil {
				cpuUser := raw.End.CPU.HostUser
				cpuSys := raw.End.CPU.HostSystem
				for i := range result.Streams {
					if len(result.Streams[i].Intervals) > 0 {
						last := len(result.Streams[i].Intervals) - 1
						result.Streams[i].Intervals[last].CPUUser = cpuUser
						result.Streams[i].Intervals[last].CPUSys = cpuSys
					}
				}
			}
			continue
		}

		for _, interval := range raw.Intervals {
			for streamIdx, stream := range interval.Streams {
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
	}

	return result, nil
}

func CollectResults(taskDir string, hosts []string) ([]*IperfResult, error) {
	var results []*IperfResult

	for _, hostDir := range hosts {
		dataDir := filepath.Join(taskDir, "data")
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
