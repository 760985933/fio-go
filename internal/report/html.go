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

	metaLines := []string{"<span>生成时间: " + ts + "</span>"}
	if testStart != "" {
		metaLines = append(metaLines, "<span>测试开始: "+html.EscapeString(testStart)+"</span>")
	}
	if testEnd != "" {
		metaLines = append(metaLines, "<span>测试结束: "+html.EscapeString(testEnd)+"</span>")
	}
	metaLine := strings.Join(metaLines, "")

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
				cards = append(cards, "<details><summary>"+html.EscapeString(ip)+"</summary><pre style='white-space:pre-wrap;font-family:Menlo,monospace;font-size:12px;line-height:1.5;color:#111827;padding:12px 16px;margin:0;border-top:1px solid #e5e7eb;'>"+txt+"</pre></details>")
			} else {
				cards = append(cards, "<div style='border:1px solid #e5e7eb;border-radius:8px;background:#f9fafb;padding:14px 16px;'><div style='font-weight:600;color:#374151;margin-bottom:8px;font-size:13px;'>"+html.EscapeString(ip)+"</div><pre style='white-space:pre-wrap;font-family:Menlo,monospace;font-size:12px;line-height:1.5;color:#111827;margin:0;'>"+txt+"</pre></div>")
			}
		}
		sysHtml = "<div class='section'><div class='section-title'>系统信息</div><div style=\"display:grid;grid-template-columns:repeat(3,1fr);gap:12px;\">" + strings.Join(cards, "") + "</div></div>\n"
	}

	htmlStr := `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <title>FIO性能报告</title>
  <script src="echarts.min.js"></script>
  <script>if (!window.echarts) document.write('<script src="https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js"><\/script>')</script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; max-width: 1100px; margin: 0 auto; padding: 32px 24px; background: #f5f5f7; color: #1d1d1f; line-height: 1.6; }
    .report-header { background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%); color: #fff; padding: 32px 40px; border-radius: 16px; margin-bottom: 24px; box-shadow: 0 4px 24px rgba(0,0,0,0.15); }
    .report-header h1 { font-size: 28px; font-weight: 700; letter-spacing: -0.5px; margin-bottom: 12px; }
    .header-meta { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; }
    .version { background: rgba(255,255,255,0.15); color: rgba(255,255,255,0.9); font-size: 13px; padding: 4px 12px; border-radius: 20px; backdrop-filter: blur(4px); }
    .meta-info { display: flex; gap: 24px; flex-wrap: wrap; font-size: 13px; color: rgba(255,255,255,0.8); }
    .meta-info span { display: flex; align-items: center; gap: 4px; }
    .section { background: #fff; border-radius: 12px; padding: 24px 28px; margin-bottom: 20px; box-shadow: 0 1px 4px rgba(0,0,0,0.06); }
    .section-title { font-size: 18px; font-weight: 600; color: #1d1d1f; margin-bottom: 16px; padding-bottom: 8px; border-bottom: 2px solid #007AFF; display: inline-block; }
    h3 { color: #007AFF; font-size: 15px; font-weight: 600; margin: 20px 0 10px; }
    table { border-collapse: collapse; width: 100%; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.04); }
    th, td { border: 1px solid #e5e7eb; padding: 10px 12px; text-align: center; font-size: 13px; }
    th { background: #f8f9fa; font-weight: 600; color: #374151; border-bottom: 2px solid #d1d5db; }
    td { color: #1f2937; }
    tr:nth-child(even) { background: #f9fafb; }
    tr:hover { background: #eff6ff; }
    .bw-toggle { margin: 12px 0; display: flex; align-items: center; gap: 12px; font-size: 13px; color: #6b7280; }
    .bw-toggle label { display: flex; align-items: center; gap: 4px; cursor: pointer; padding: 4px 12px; border-radius: 6px; transition: background 0.15s; }
    .bw-toggle label:hover { background: #f3f4f6; }
    .chart { width: 100%; height: 320px; margin: 16px 0; }
    details { border: 1px solid #e5e7eb; border-radius: 8px; background: #f9fafb; margin-bottom: 8px; }
    details > summary { padding: 10px 16px; font-weight: 600; color: #374151; cursor: pointer; }
    details > summary:hover { background: #f3f4f6; border-radius: 8px; }
    details > summary::-webkit-details-marker { display: none; }
    details pre { padding: 12px 16px; margin: 0; font-size: 12px; line-height: 1.5; color: #111827; border-top: 1px solid #e5e7eb; }
    .glossary-table td:first-child { font-weight: 600; color: #007AFF; text-align: left; width: 80px; }
    .glossary-table td:last-child { text-align: left; }
  </style>
</head>
<body>
  <div class="report-header">
    <div class="header-meta">
      <h1>FIO性能报告</h1>
      <span class="version">v` + html.EscapeString(models.Version) + `</span>
    </div>
    <div class="meta-info">
      ` + metaLine + `
    </div>
  </div>

  <div class="section">
    <div class="section-title">性能汇总</div>
    <div class="bw-toggle">带宽单位：
      <label><input type="radio" name="bw_unit" onclick="setMiBps(true);" checked> MiBps</label>
      <label><input type="radio" name="bw_unit" onclick="setMiBps(false);"> MBps</label>
    </div>
    ` + generateHtmlSummaryTables(groupedRows) + `
  </div>
  ` + sysHtml + `

  <div class="section">
    <div class="section-title">术语解释</div>
    <table class="glossary-table">
      <thead><tr><th>术语</th><th>说明</th></tr></thead>
      <tbody>
        <tr><td>IOPS</td><td>每秒 I/O 数（吞吐的操作次数）</td></tr>
        <tr><td>BW</td><td>带宽（MiB/s，已转换为每秒兆字节）</td></tr>
        <tr><td>LAT</td><td>总延迟（提交延迟 SLAT + 完成延迟 CLAT 的总和，单位 ms）</td></tr>
        <tr><td>CLAT</td><td>完成延迟（设备端完成 I/O 的耗时，单位 ms）</td></tr>
        <tr><td>SLAT</td><td>提交延迟（从线程发起到操作系统受理的前端耗时，单位 ms）</td></tr>
      </tbody>
    </table>
  </div>

  <div class="section">
    <div class="section-title">分组时序图</div>
    <div id="groups_root"></div>
  </div>

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
