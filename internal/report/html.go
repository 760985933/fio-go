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

func GenerateHTML(groups []models.ChartGroup, systemTexts map[string]string, groupedRows []models.GroupedMetric, outPath string, clatAnalysis map[string]map[string]*models.HostClatData, startedAt ...string) error {
	ts := time.Now().Format("2006-01-02 15:04:05")
	var testStart, testEnd string

	if len(startedAt) > 0 {
		testStart = startedAt[0]
	}
	if len(startedAt) > 1 {
		testEnd = startedAt[1]
	}
	if clatAnalysis == nil {
		clatAnalysis = make(map[string]map[string]*models.HostClatData)
	}

	metaLines := []string{"<span>生成时间: " + ts + "</span>"}
	formatTimestamp := func(s string) string {
		if t, err := time.Parse(time.RFC3339, s); err == nil {
			return t.Format("2006-01-02 15:04:05")
		}
		return s
	}
	if testStart != "" {
		metaLines = append(metaLines, "<span>测试开始: "+html.EscapeString(formatTimestamp(testStart))+"</span>")
	}
	if testEnd != "" {
		metaLines = append(metaLines, "<span>测试结束: "+html.EscapeString(formatTimestamp(testEnd))+"</span>")
	}
	metaLine := strings.Join(metaLines, "")

	if groups == nil {
		groups = []models.ChartGroup{}
	}
	jsGroups, _ := json.Marshal(groups)
	jsClat, _ := json.Marshal(clatAnalysis)

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
  <title>FIO 性能测试报告</title>
  <script src="echarts.min.js"></script>
  <script>if (!window.echarts) document.write('<script src="https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js"><\/script>')</script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; max-width: 1100px; margin: 0 auto; padding: 32px 24px; background: #f5f5f7; color: #1d1d1f; line-height: 1.6; }
    .report-header { background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%); color: #fff; padding: 32px 40px; border-radius: 16px; margin-bottom: 24px; box-shadow: 0 4px 24px rgba(0,0,0,0.15); position: relative; text-align: center; }
    .report-header h1 { font-size: 28px; font-weight: 700; letter-spacing: -0.5px; margin-bottom: 12px; }
    .version { position: absolute; top: 16px; right: 20px; background: rgba(255,255,255,0.15); color: rgba(255,255,255,0.9); font-size: 13px; padding: 4px 12px; border-radius: 20px; backdrop-filter: blur(4px); }
    .meta-info { display: flex; justify-content: center; gap: 24px; flex-wrap: wrap; font-size: 13px; color: rgba(255,255,255,0.8); }
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
    .float-nav { position: fixed; bottom: 24px; right: 24px; z-index: 100; }
    .float-nav-toggle { width: 44px; height: 44px; border-radius: 50%; background: #007AFF; color: #fff; border: none; cursor: pointer; box-shadow: 0 4px 16px rgba(0,122,255,0.35); font-size: 20px; display: flex; align-items: center; justify-content: center; transition: transform 0.2s, box-shadow 0.2s; }
    .float-nav-toggle:hover { transform: scale(1.08); box-shadow: 0 6px 24px rgba(0,122,255,0.45); }
    .float-nav-menu { position: absolute; bottom: 56px; right: 0; background: #fff; border-radius: 12px; box-shadow: 0 8px 32px rgba(0,0,0,0.15); padding: 8px 0; min-width: 180px; display: none; max-height: 400px; overflow-y: auto; }
    .float-nav-menu.open { display: block; }
    .float-nav-menu a { display: block; padding: 8px 16px; font-size: 13px; color: #374151; text-decoration: none; transition: background 0.12s; white-space: nowrap; }
    .float-nav-menu a:hover { background: #eff6ff; color: #007AFF; }
    .float-nav-menu a.active { color: #007AFF; font-weight: 600; background: #f0f7ff; }
    @media print {
      body { max-width: 100%; padding: 0; background: #fff; }
      .float-nav { display: none !important; }
      .section { break-inside: avoid; page-break-inside: avoid; box-shadow: none; border: 1px solid #e5e7eb; }
      .chart { height: 280px; }
      .report-header { box-shadow: none; }
    }
  </style>
</head>
<body>
  <div class="report-header">
    <span class="version">v` + html.EscapeString(models.Version) + `</span>
    <h1>FIO 性能测试报告</h1>
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

  <div class="section" id="clat_percentile_section">
    <div class="section-title">CLAT 延迟百分位</div>
    <p style="font-size:13px;color:#6b7280;margin-bottom:12px;">完成延迟(CLAT)的 P50/P95/P99/P99.9 百分位分布，单位 μs</p>
    <div id="clat_percentile_root"></div>
  </div>

  <div class="section" id="clat_dist_section">
    <div class="section-title">CLAT 延迟分布</div>
    <p style="font-size:13px;color:#6b7280;margin-bottom:12px;">完成延迟(CLAT)的直方图分布，横轴为延迟上界(μs)，纵轴为 I/O 次数</p>
    <div id="clat_dist_root"></div>
  </div>

  <div class="float-nav">
    <div class="float-nav-menu" id="float-nav-menu"></div>
    <button class="float-nav-toggle" title="快速跳转">☰</button>
  </div>

  <script>
    const groups = ` + string(jsGroups) + `;
    const clatData = ` + string(jsClat) + `;
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
      const nav = document.getElementById('float-nav-menu');
      if (!groups || groups.length === 0) {
        root.innerHTML = '<p>No log groups found</p>';
        return;
      }
      groups.forEach((g, idx) => {
        const section = document.createElement('section');
        const secId = 'group_' + idx;
        section.id = secId;
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

        const link = document.createElement('a');
        link.href = '#' + secId;
        link.textContent = g.BS + ' / ' + g.RW + ' / QD' + g.IODepth;
        link.dataset.secId = secId;
        link.addEventListener('click', (e) => {
          e.preventDefault();
          document.getElementById(secId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          nav.classList.remove('open');
        });
        nav.appendChild(link);
      });
    }

    function initFloatNav() {
      const btn = document.querySelector('.float-nav-toggle');
      const nav = document.getElementById('float-nav-menu');
      btn.addEventListener('click', () => nav.classList.toggle('open'));
      document.addEventListener('click', (e) => {
        if (!e.target.closest('.float-nav')) nav.classList.remove('open');
      });
      const links = () => nav.querySelectorAll('a');
      const onScroll = () => {
        const sections = document.querySelectorAll('#groups_root section');
        let activeIdx = 0;
        sections.forEach((sec, i) => {
          if (sec.getBoundingClientRect().top <= 120) activeIdx = i;
        });
        links().forEach((a, i) => a.classList.toggle('active', i === activeIdx));
      };
      window.addEventListener('scroll', onScroll, { passive: true });
      onScroll();
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
    initFloatNav();
    renderClatCharts();

    function renderClatCharts() {
      if (!clatData || Object.keys(clatData).length === 0) {
        const pctSec = document.getElementById('clat_percentile_section');
        const distSec = document.getElementById('clat_dist_section');
        if (pctSec) pctSec.style.display = 'none';
        if (distSec) distSec.style.display = 'none';
        return;
      }

      const pctRoot = document.getElementById('clat_percentile_root');
      const distRoot = document.getElementById('clat_dist_root');
      if (!pctRoot || !distRoot) return;

      const nav = document.getElementById('float-nav-menu');
      if (nav) {
        [{id:'clat_percentile_section',text:'CLAT 百分位'},{id:'clat_dist_section',text:'CLAT 分布'}].forEach(item => {
          const a = document.createElement('a');
          a.href = '#' + item.id;
          a.textContent = item.text;
          a.addEventListener('click', e => {
            e.preventDefault();
            document.getElementById(item.id)?.scrollIntoView({behavior:'smooth',block:'start'});
            nav.classList.remove('open');
          });
          nav.appendChild(a);
        });
      }

      const sortedBs = Object.keys(clatData).sort((a, b) => {
        const toBytes = s => {
          s = s.toLowerCase();
          if (s.endsWith('k')) return parseInt(s) * 1024;
          if (s.endsWith('m')) return parseInt(s) * 1024 * 1024;
          return parseInt(s) || 0;
        };
        return toBytes(a) - toBytes(b);
      });

      sortedBs.forEach(bs => {
        const jobMap = clatData[bs];
        const jobNames = Object.keys(jobMap).sort();

        const pctH3 = document.createElement('h3');
        pctH3.textContent = bs + ' CLAT 百分位';
        pctRoot.appendChild(pctH3);

        const distH3 = document.createElement('h3');
        distH3.textContent = bs + ' CLAT 分布';
        distRoot.appendChild(distH3);

        jobNames.forEach(jobname => {
          const hostData = jobMap[jobname];
          if (!hostData) return;

          const pctDiv = document.createElement('div');
          pctDiv.className = 'chart';
          pctDiv.id = 'clat_pct_' + bs + '_' + jobname;
          pctRoot.appendChild(pctDiv);

          const distDiv = document.createElement('div');
          distDiv.className = 'chart';
          distDiv.id = 'clat_dist_' + bs + '_' + jobname;
          distRoot.appendChild(distDiv);

          // Percentile bar chart
          if (hostData.readP50 > 0 || hostData.writeP50 > 0) {
            const chart = echarts.init(pctDiv);
            const categories = ['P50', 'P95', 'P99', 'P99.9', 'Min', 'Max'];
            const readSeries = [
              hostData.readP50, hostData.readP95, hostData.readP99,
              hostData.readP999, hostData.readMin, hostData.readMax
            ];
            const writeSeries = [
              hostData.writeP50, hostData.writeP95, hostData.writeP99,
              hostData.writeP999, hostData.writeMin, hostData.writeMax
            ];
            const hasRead = readSeries.some(v => v > 0);
            const hasWrite = writeSeries.some(v => v > 0);
            const series = [];
            if (hasRead) series.push({
              name: '读', type: 'bar', barMaxWidth: 24,
              data: readSeries.map(v => Math.round(v * 100) / 100),
              itemStyle: { color: '#3b82f6' },
              label: { show: true, position: 'top', fontSize: 11, formatter: '{c}' }
            });
            if (hasWrite) series.push({
              name: '写', type: 'bar', barMaxWidth: 24,
              data: writeSeries.map(v => Math.round(v * 100) / 100),
              itemStyle: { color: '#f59e0b' },
              label: { show: true, position: 'top', fontSize: 11, formatter: '{c}' }
            });
            chart.setOption({
              title: { text: jobname, textStyle: { fontSize: 13 } },
              tooltip: { trigger: 'axis', formatter: params => {
                let s = params[0].axisValue + '<br/>';
                params.forEach(p => { s += p.marker + p.seriesName + ': ' + p.value + ' μs<br/>'; });
                return s;
              }},
              legend: { show: series.length > 1, top: 0 },
              xAxis: { type: 'category', data: categories },
              yAxis: { type: 'value', name: 'μs' },
              series: series
            });
          } else {
            pctDiv.remove();
          }

          // Distribution histogram
          const hasReadDist = hostData.readDist && hostData.readDist.length > 0;
          const hasWriteDist = hostData.writeDist && hostData.writeDist.length > 0;
          if (hasReadDist || hasWriteDist) {
            const chart = echarts.init(distDiv);
            const dist = hasReadDist ? hostData.readDist : hostData.writeDist;
            const isRead = hasReadDist;
            const labels = dist.map(d => Math.round(d.edge));
            const counts = dist.map(d => Math.round(d.count));
            chart.setOption({
              title: { text: jobname + (isRead ? ' 读延迟分布' : ' 写延迟分布'), textStyle: { fontSize: 13 } },
              tooltip: { trigger: 'axis', formatter: params => {
                const p = params[0];
                return '上界: ' + p.axisValue + ' μs<br/>I/O次数: ' + p.value;
              }},
              xAxis: { type: 'category', data: labels, name: 'μs',
                axisLabel: { rotate: 45, fontSize: 10 } },
              yAxis: { type: 'value', name: 'I/O次数' },
              dataZoom: [{ type: 'inside' }, { type: 'slider' }],
              series: [{ type: 'bar', data: counts, itemStyle: { color: isRead ? '#6366f1' : '#ec4899' },
                barMaxWidth: 16 }]
            });
          } else {
            distDiv.remove();
          }
        });
      });
    }
  </script>
</body>
</html>`

	return os.WriteFile(outPath, []byte(htmlStr), 0644)
}
