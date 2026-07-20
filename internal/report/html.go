package report

import (
	"encoding/json"
	"html"
	"os"
	"sort"
	"strings"
	"time"

	"fio-go/internal/models"
)

func GenerateHTML(groups []models.ChartGroup, systemTexts map[string]string, groupedRows []models.GroupedMetric, outPath string, startedAt ...string) error {
	ts := time.Now().Format("2006-01-02 15:04:05")

	var testStart, testEnd string
	if len(startedAt) > 0 {
		testStart = startedAt[0]
	}
	if len(startedAt) > 1 {
		testEnd = startedAt[1]
	}

	metaLine := "<p>生成时间: " + ts + "</p>"
	if testStart != "" {
		metaLine += "<p>测试开始时间: " + html.EscapeString(testStart) + "</p>"
	}
	if testEnd != "" {
		metaLine += "<p>测试结束时间: " + html.EscapeString(testEnd) + "</p>"
	}

	if groups == nil {
		groups = []models.ChartGroup{}
	}
	jsGroups, _ := json.Marshal(groups)

	sysHtml := ""
	if len(systemTexts) > 0 {
		var ips []string
		for ip := range systemTexts {
			ips = append(ips, ip)
		}
		sort.Strings(ips)

		var cards []string
		for _, ip := range ips {
			txt := html.EscapeString(systemTexts[ip])
			lineCount := strings.Count(txt, "\n") + 1
			if lineCount > 12 {
				cards = append(cards, "<details style='border:1px solid #e5e7eb;border-radius:8px;background:#f9fafb;padding:12px;'><summary style='font-weight:600;color:#374151;cursor:pointer;'>"+html.EscapeString(ip)+"</summary><pre style='white-space:pre-wrap;font-family:Menlo,monospace;font-size:12px;line-height:1.5;color:#111827;margin-top:8px;'>"+txt+"</pre></details>")
			} else {
				cards = append(cards, "<div style='border:1px solid #e5e7eb;border-radius:8px;background:#f9fafb;padding:12px;'><div style='font-weight:600;color:#374151;margin-bottom:8px;'>"+html.EscapeString(ip)+"</div><pre style='white-space:pre-wrap;font-family:Menlo,monospace;font-size:12px;line-height:1.5;color:#111827;'>"+txt+"</pre></div>")
			}
		}
		sysHtml = "<h2>系统信息</h2><div style=\"display:grid;grid-template-columns:repeat(3,1fr);gap:16px;\">" + strings.Join(cards, "") + "</div>\n"
	}

	htmlStr := `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <title>FIO性能报告</title>
  <script src="echarts.min.js"></script>
  <script>if (!window.echarts) document.write('<script src="https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js"><\/script>')</script>
  <style>
    body { font-family: Arial; max-width: 1100px; margin: 24px auto; }
    .header-row { display: flex; justify-content: space-between; align-items: baseline; }
    .version { color: #999; font-size: 13px; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #ddd; padding: 8px; text-align: center; }
    th { background: #f3f3f3; }
    h3 { color: #409EFF; }
    .chart { width: 100%; height: 320px; margin: 16px 0; }
    .bw-toggle { margin: 8px 0; }
    details > summary { list-style: none; }
    details > summary::-webkit-details-marker { display: none; }
  </style>
</head>
<body>
  <div class="header-row">
    <h1>FIO性能报告</h1>
    <span class="version">` + html.EscapeString(models.Version) + `</span>
  </div>
  ` + metaLine + `

  <h2>性能汇总</h2>
  <div class="bw-toggle">带宽单位：
    <label><input type="radio" name="bw_unit" onclick="setMiBps(true);" checked> MiBps</label>
    <label style="margin-left:12px"><input type="radio" name="bw_unit" onclick="setMiBps(false);"> MBps</label>
  </div>
  ` + generateHtmlSummaryTables(groupedRows) + `
  ` + sysHtml + `

  <h2>术语解释</h2>
  <table>
    <thead><tr><th>术语</th><th>说明</th></tr></thead>
    <tbody>
      <tr><td>IOPS</td><td>每秒 I/O 数（吞吐的操作次数）</td></tr>
      <tr><td>BW</td><td>带宽（MiB/s，已转换为每秒兆字节）</td></tr>
      <tr><td>LAT</td><td>总延迟（提交延迟 SLAT + 完成延迟 CLAT 的总和，单位 ms）</td></tr>
      <tr><td>CLAT</td><td>完成延迟（设备端完成 I/O 的耗时，单位 ms）</td></tr>
      <tr><td>SLAT</td><td>提交延迟（从线程发起到操作系统受理的前端耗时，单位 ms）</td></tr>
    </tbody>
  </table>

  <h2>分组时序图</h2>
  <div id="groups_root"></div>

  <script>
    const groups = ` + string(jsGroups) + `;
    const metricTitle = {
      iops: 'IOPS 每秒I/O数',
      bw: 'BW 带宽(MiB/s)',
      lat: 'LAT 总延迟(ms)',
      clat: 'CLAT 完成延迟(ms)',
      slat: 'SLAT 提交延迟(ms)'
    };

    let __isMiBps = true;
    function setMiBps(v) {
      __isMiBps = !!v;
      switch_bw_unit();
    }
    function switch_bw_unit() {
      document.querySelectorAll('th.bwth').forEach(th => {
        th.textContent = __isMiBps ? '带宽(MiBps)' : '带宽(MBps)';
      });
      document.querySelectorAll('td.bwv').forEach(td => {
        const base = parseFloat(td.getAttribute('data-mib'));
        if (isNaN(base)) return;
        td.textContent = (__isMiBps ? base : base * 1.048576).toFixed(2);
      });
    }

    function toLineData(pairs) {
      if (!pairs) return [];
      return pairs.map(p => [p[0] / 1000.0, p[1]]);
    }

    function createGroups() {
      const root = document.getElementById('groups_root');
      if (!groups || groups.length === 0) {
        root.innerHTML = '<p>No log groups found</p>';
        return;
      }
      groups.forEach(g => {
        const section = document.createElement('section');
        const h = document.createElement('h3');
        h.textContent = g.BS + ' / ' + g.RW + ' / iodepth ' + g.IODepth;
        section.appendChild(h);
        
        const metrics = Object.keys(g.Metrics || {}).filter(m => Object.keys(g.Metrics[m] || {}).length > 0);
        metrics.forEach(m => {
          const div = document.createElement('div');
          div.className = 'chart';
          div.id = 'chart_' + g.Label + '_' + m;
          section.appendChild(div);
        });
        root.appendChild(section);
      });
    }

    function renderGroups() {
      groups.forEach(g => {
        const metrics = Object.keys(g.Metrics || {}).filter(m => Object.keys(g.Metrics[m] || {}).length > 0);
        metrics.forEach(m => {
          const el = document.getElementById('chart_' + g.Label + '_' + m);
          if (!el) return;
          const chart = echarts.init(el);
          const hostSeries = Object.keys(g.Metrics[m]).map(host => ({
            name: host,
            type: 'line',
            showSymbol: false,
            data: toLineData(g.Metrics[m][host])
          }));
          const yName = (m === 'bw') ? 'MiB/s' : (m === 'lat' || m === 'clat' || m === 'slat' ? 'ms' : 'IOPS');
          chart.setOption({
            title: { text: metricTitle[m] || m.toUpperCase() },
            tooltip: { trigger: 'axis' },
            xAxis: { type: 'value', name: 's' },
            yAxis: { type: 'value', name: yName },
            legend: { top: 0 },
            toolbox: { right: 10, feature: {
              dataZoom: {}, magicType: { type: ['line','bar'] }, restore: {}, saveAsImage: {}
            } },
            dataZoom: [ { type: 'inside' }, { type: 'slider' } ],
            series: hostSeries
          });
        });
      });
    }

    createGroups();
    renderGroups();
    switch_bw_unit();
  </script>
</body>
</html>`

	return os.WriteFile(outPath, []byte(htmlStr), 0644)
}
