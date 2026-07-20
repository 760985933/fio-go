package iperf

import (
	"fmt"
	"html"
	"os"
	"sort"
	"strings"
	"time"
)

func GenerateIperfHTML(results []*IperfResult, outPath string) error {
	if len(results) == 0 {
		return fmt.Errorf("no results to generate report")
	}

	ts := time.Now().Format("2006-01-02 15:04:05")

	var summaryRows []string
	for _, r := range results {
		for _, s := range r.Streams {
			if len(s.Intervals) > 0 {
				last := s.Intervals[len(s.Intervals)-1]
				avgBW := calculateAvgBandwidth(s.Intervals)
				maxBW := calculateMaxBandwidth(s.Intervals)
				summaryRows = append(summaryRows, fmt.Sprintf(
					`<tr><td>%s</td><td>%d</td><td>%.2f</td><td>%.2f</td><td>%d</td><td>%.3f</td></tr>`,
					html.EscapeString(r.Host),
					s.StreamID,
					avgBW/1e6,
					maxBW/1e6,
					last.Retransmits,
					last.JitterMs,
				))
			}
		}
	}

	var chartDataStrings []string
	for _, r := range results {
		for _, s := range r.Streams {
			var points []string
			for _, iv := range s.Intervals {
				points = append(points, fmt.Sprintf("[%.2f,%.2f]", iv.Timestamp, iv.BitsPerSecond/1e6))
			}
			chartDataStrings = append(chartDataStrings, fmt.Sprintf(
				`{name:'%s Stream %d',type:'line',smooth:true,data:[%s]}`,
				html.EscapeString(r.Host), s.StreamID, strings.Join(points, ","),
			))
		}
	}

	var jitterDataStrings []string
	for _, r := range results {
		for _, s := range r.Streams {
			var points []string
			for _, iv := range s.Intervals {
				if iv.JitterMs > 0 {
					points = append(points, fmt.Sprintf("[%.2f,%.3f]", iv.Timestamp, iv.JitterMs))
				}
			}
			if len(points) > 0 {
				jitterDataStrings = append(jitterDataStrings, fmt.Sprintf(
					`{name:'%s Stream %d',type:'line',smooth:true,data:[%s]}`,
					html.EscapeString(r.Host), s.StreamID, strings.Join(points, ","),
				))
			}
		}
	}

	var retransmitDataStrings []string
	for _, r := range results {
		for _, s := range r.Streams {
			var points []string
			for _, iv := range s.Intervals {
				points = append(points, fmt.Sprintf("[%.2f,%d]", iv.Timestamp, iv.Retransmits))
			}
			retransmitDataStrings = append(retransmitDataStrings, fmt.Sprintf(
				`{name:'%s Stream %d',type:'bar',data:[%s]}`,
				html.EscapeString(r.Host), s.StreamID, strings.Join(points, ","),
			))
		}
	}

	summaryTable := ""
	if len(summaryRows) > 0 {
		summaryTable = fmt.Sprintf(`
<div style="margin-bottom:24px;">
<h3 style="font-size:15px;color:#374151;margin-bottom:12px;">测试汇总</h3>
<table style="width:100%%;border-collapse:collapse;font-size:13px;">
<thead><tr style="background:#f3f4f6;">
<th style="padding:8px 12px;text-align:left;border:1px solid #e5e7eb;">主机</th>
<th style="padding:8px 12px;text-align:left;border:1px solid #e5e7eb;">流ID</th>
<th style="padding:8px 12px;text-align:right;border:1px solid #e5e7eb;">平均带宽(Mbps)</th>
<th style="padding:8px 12px;text-align:right;border:1px solid #e5e7eb;">峰值带宽(Mbps)</th>
<th style="padding:8px 12px;text-align:right;border:1px solid #e5e7eb;">重传数</th>
<th style="padding:8px 12px;text-align:right;border:1px solid #e5e7eb;">抖动(ms)</th>
</tr></thead>
<tbody>%s</tbody>
</table>
</div>`, strings.Join(summaryRows, "\n"))
	}

	echartsJS := ""
	echartPath := "output/echarts.min.js"
	if _, err := os.Stat(echartPath); err == nil {
		data, _ := os.ReadFile(echartPath)
		echartsJS = string(data)
	}

	htmlContent := fmt.Sprintf(`<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>iperf3 性能测试报告</title>
<script>%s</script>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f9fafb; color: #111827; padding: 24px; }
.report-header { background: white; border-radius: 12px; padding: 24px 32px; margin-bottom: 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
.report-header h1 { font-size: 22px; font-weight: 700; margin-bottom: 8px; }
.report-meta { font-size: 13px; color: #6b7280; }
.chart-card { background: white; border-radius: 12px; padding: 20px 24px; margin-bottom: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
.chart-card h3 { font-size: 15px; color: #374151; margin-bottom: 12px; }
.chart-container { width: 100%; height: 350px; }
</style>
</head>
<body>
<div class="report-header">
<h1>iperf3 性能测试报告</h1>
<div class="report-meta">
<span>生成时间: %s</span>
</div>
</div>
%s
<div class="chart-card">
<h3>带宽时序图 (Mbps)</h3>
<div id="bandwidthChart" class="chart-container"></div>
</div>
<div class="chart-card">
<h3>抖动时序图 (ms)</h3>
<div id="jitterChart" class="chart-container"></div>
</div>
<div class="chart-card">
<h3>重传数时序图</h3>
<div id="retransmitChart" class="chart-container"></div>
</div>
<script>
(function(){
var bwChart = echarts.init(document.getElementById('bandwidthChart'));
bwChart.setOption({
tooltip:{trigger:'axis'},
legend:{type:'scroll',bottom:0},
grid:{left:60,right:30,top:30,bottom:50},
xAxis:{type:'time'},
yAxis:{type:'value',name:'Mbps'},
series:[%s]
});
var jitChart = echarts.init(document.getElementById('jitterChart'));
jitChart.setOption({
tooltip:{trigger:'axis'},
legend:{type:'scroll',bottom:0},
grid:{left:60,right:30,top:30,bottom:50},
xAxis:{type:'time'},
yAxis:{type:'value',name:'ms'},
series:[%s]
});
var retChart = echarts.init(document.getElementById('retransmitChart'));
retChart.setOption({
tooltip:{trigger:'axis'},
legend:{type:'scroll',bottom:0},
grid:{left:60,right:30,top:30,bottom:50},
xAxis:{type:'time'},
yAxis:{type:'value',name:'Retransmits'},
series:[%s]
});
window.addEventListener('resize',function(){bwChart.resize();jitChart.resize();retChart.resize();});
})();
</script>
</body>
</html>`, echartsJS, ts, summaryTable,
		strings.Join(chartDataStrings, ",\n"),
		strings.Join(jitterDataStrings, ",\n"),
		strings.Join(retransmitDataStrings, ",\n"),
	)

	return os.WriteFile(outPath, []byte(htmlContent), 0644)
}

func calculateAvgBandwidth(intervals []IperfInterval) float64 {
	if len(intervals) == 0 {
		return 0
	}
	total := 0.0
	for _, iv := range intervals {
		total += iv.BitsPerSecond
	}
	return total / float64(len(intervals))
}

func calculateMaxBandwidth(intervals []IperfInterval) float64 {
	if len(intervals) == 0 {
		return 0
	}
	max := 0.0
	for _, iv := range intervals {
		if iv.BitsPerSecond > max {
			max = iv.BitsPerSecond
		}
	}
	return max
}

func CollectAndSortResults(taskDir string, hosts []string) []*IperfResult {
	results, _ := CollectResults(taskDir, hosts)
	sort.Slice(results, func(i, j int) bool {
		return results[i].Host < results[j].Host
	})
	return results
}

func MergeIntervalData(results []*IperfResult) map[string][]IperfInterval {
	merged := make(map[string][]IperfInterval)
	for _, r := range results {
		for _, s := range r.Streams {
			key := fmt.Sprintf("%s-stream%d", r.Host, s.StreamID)
			merged[key] = append(merged[key], s.Intervals...)
		}
	}
	return merged
}
