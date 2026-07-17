package parser

import (
	"testing"
)

func TestParseLogBase(t *testing.T) {
	tests := []struct {
		input       string
		wantIdx     int
		wantBs      string
		wantRw      string
		wantIodepth int
		wantMetric  string
		wantOk      bool
	}{
		{"1_4k_randread_iodepth32_clat.1.log", 1, "4k", "randread", 32, "clat", true},
		{"2_1M_write_iodepth1_bw.log", 2, "1m", "write", 1, "bw", true},
		{"invalid_log_name", 0, "", "", 0, "", false},
		{"3_8k_read_iodepth16_iops.2.log", 3, "8k", "read", 16, "iops", true},
	}

	for _, tt := range tests {
		idx, bs, rw, iodepth, metric, ok := parseLogBase(tt.input)
		if idx != tt.wantIdx || bs != tt.wantBs || rw != tt.wantRw || iodepth != tt.wantIodepth || metric != tt.wantMetric || ok != tt.wantOk {
			t.Errorf("parseLogBase(%q) = %d, %s, %s, %d, %s, %v; want %d, %s, %s, %d, %s, %v",
				tt.input, idx, bs, rw, iodepth, metric, ok,
				tt.wantIdx, tt.wantBs, tt.wantRw, tt.wantIodepth, tt.wantMetric, tt.wantOk)
		}
	}
}

func TestBSToBytes(t *testing.T) {
	tests := []struct {
		input string
		want  int
	}{
		{"4k", 4096},
		{"1M", 1048576},
		{"1g", 1073741824},
		{"512", 512},
		{"invalid", 0},
	}

	for _, tt := range tests {
		if got := BSToBytes(tt.input); got != tt.want {
			t.Errorf("BSToBytes(%q) = %d; want %d", tt.input, got, tt.want)
		}
	}
}

func TestRWRank(t *testing.T) {
	if got := RWRank("read"); got != 10 {
		t.Errorf("RWRank(read) = %d; want 10", got)
	}
	if got := RWRank("randwrite"); got != 40 {
		t.Errorf("RWRank(randwrite) = %d; want 40", got)
	}
	if got := RWRank("unknown"); got != 100 {
		t.Errorf("RWRank(unknown) = %d; want 100", got)
	}
}

func TestExtractIPFromPath(t *testing.T) {
	if got := ExtractIPFromPath("/data/192.168.1.100/logs"); got != "192.168.1.100" {
		t.Errorf("ExtractIPFromPath() = %s; want 192.168.1.100", got)
	}
	if got := ExtractIPFromPath("/data/host/logs"); got != "unknown" {
		t.Errorf("ExtractIPFromPath() = %s; want unknown", got)
	}
}

func TestParseValueFloat(t *testing.T) {
	if got := parseValueFloat(10.5); got != 10.5 {
		t.Errorf("parseValueFloat(10.5) = %f; want 10.5", got)
	}
	if got := parseValueFloat("20.1"); got != 20.1 {
		t.Errorf("parseValueFloat(\"20.1\") = %f; want 20.1", got)
	}
	if got := parseValueFloat("invalid"); got != 0 {
		t.Errorf("parseValueFloat(\"invalid\") = %f; want 0", got)
	}
}

func TestParseValueInt(t *testing.T) {
	if got := parseValueInt(10.5); got != 10 {
		t.Errorf("parseValueInt(10.5) = %d; want 10", got)
	}
	if got := parseValueInt("20"); got != 20 {
		t.Errorf("parseValueInt(\"20\") = %d; want 20", got)
	}
}

func TestExtractBS(t *testing.T) {
	job1 := FioJob{"jobname": "test_4k_read"}
	if got := ExtractBS(job1); got != "4k" {
		t.Errorf("ExtractBS(job1) = %s; want 4k", got)
	}

	job2 := FioJob{"job options": map[string]interface{}{"bs": "8M"}}
	if got := ExtractBS(job2); got != "8m" {
		t.Errorf("ExtractBS(job2) = %s; want 8m", got)
	}
}

func TestExtractRW(t *testing.T) {
	job1 := FioJob{"jobname": "test_randwrite_4k"}
	if got := ExtractRW(job1); got != "randwrite" {
		t.Errorf("ExtractRW(job1) = %s; want randwrite", got)
	}

	job2 := FioJob{"job options": map[string]interface{}{"rw": "read"}}
	if got := ExtractRW(job2); got != "read" {
		t.Errorf("ExtractRW(job2) = %s; want read", got)
	}
}

func TestExtractIODepth(t *testing.T) {
	job1 := FioJob{"jobname": "test_4k_read_iodepth32"}
	if got := ExtractIODepth(job1); got != 32 {
		t.Errorf("ExtractIODepth(job1) = %d; want 32", got)
	}

	job2 := FioJob{"job options": map[string]interface{}{"iodepth": "64"}}
	if got := ExtractIODepth(job2); got != 64 {
		t.Errorf("ExtractIODepth(job2) = %d; want 64", got)
	}
}
