package iperf

import "fio-go/internal/executor"

type IperfConfig struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Protocol   string `json:"protocol"`
	Bandwidth  string `json:"bandwidth"`
	Duration   int    `json:"duration"`
	Parallel   int    `json:"parallel"`
	BlockSize  string `json:"blockSize"`
	WindowSize string `json:"windowSize"`
	Reverse    bool   `json:"reverse"`
	Bidir      bool   `json:"bidir"`
	ExtraFlags string `json:"extraFlags"`
}

type IperfTask struct {
	ID          string              `json:"id"`
	Name        string              `json:"name"`
	Config      IperfConfig         `json:"config"`
	ServerHost  executor.HostConfig `json:"serverHost"`
	ClientHosts []executor.HostConfig `json:"clientHosts"`
	Status      string              `json:"status"`
	CreatedAt   string              `json:"createdAt"`
	StartedAt   string              `json:"startedAt,omitempty"`
	FinishedAt  string              `json:"finishedAt,omitempty"`
}

type IperfInterval struct {
	Timestamp     float64 `json:"timestamp"`
	StreamID      int     `json:"streamID"`
	Duration      float64 `json:"duration"`
	Bytes         float64 `json:"bytes"`
	BitsPerSecond float64 `json:"bitsPerSecond"`
	JitterMs      float64 `json:"jitterMs"`
	LostPackets   int     `json:"lostPackets"`
	TotalPackets  int     `json:"totalPackets"`
	Retransmits   int     `json:"retransmits"`
	CPUUser       float64 `json:"cpuUser"`
	CPUSys        float64 `json:"cpuSys"`
}

type IperfResult struct {
	TaskID  string         `json:"taskId"`
	Host    string         `json:"host"`
	EndTime float64        `json:"endTime"`
	Version string         `json:"version"`
	Streams []StreamResult `json:"streams"`
}

type StreamResult struct {
	StreamID  int              `json:"streamID"`
	Intervals []IperfInterval `json:"intervals"`
}

type IperfAnalysisSummary struct {
	TaskID       string `json:"taskId"`
	TaskName     string `json:"taskName"`
	ServerHost   string `json:"serverHost"`
	ClientCount  int    `json:"clientCount"`
	Status       string `json:"status"`
	HasData      bool   `json:"hasData"`
	HasReport    bool   `json:"hasReport"`
	CreatedAt    string `json:"createdAt"`
	AvgBandwidth float64 `json:"avgBandwidth"`
	MaxBandwidth float64 `json:"maxBandwidth"`
}
