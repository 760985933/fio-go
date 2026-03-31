package report

import (
	"fmt"
	"sort"
	"strings"

	"fio-go/models"
	"fio-go/parser"
)

func generateHtmlSummaryTables(groupedRows []models.GroupedMetric) string {
	byBsDepth := make(map[string]map[int]*blockData)

	for _, r := range groupedRows {
		bs := r.BS
		depth := r.IODepth
		rw := strings.ToLower(r.RW)

		if byBsDepth[bs] == nil {
			byBsDepth[bs] = make(map[int]*blockData)
		}
		if byBsDepth[bs][depth] == nil {
			byBsDepth[bs][depth] = &blockData{}
		}

		bkt := byBsDepth[bs][depth]
		rowCopy := r
		if rw == "read" || rw == "randread" {
			bkt.Read = &rowCopy
		} else if rw == "write" || rw == "randwrite" {
			bkt.Write = &rowCopy
		} else if rw == "readwrite" || rw == "rw" || rw == "randrw" {
			bkt.Mixed = &rowCopy
		}
	}

	var bsKeys []string
	for bs := range byBsDepth {
		bsKeys = append(bsKeys, bs)
	}
	sort.Slice(bsKeys, func(i, j int) bool {
		return parser.BSToBytes(bsKeys[i]) < parser.BSToBytes(bsKeys[j])
	})

	var htmlParts []string

	for _, bs := range bsKeys {
		htmlParts = append(htmlParts, fmt.Sprintf("<h3>%s 读写</h3>", bs))

		bsBytes := parser.BSToBytes(bs)
		useIops := bsBytes <= 32*1024
		metricLabel := "IOPS(K)"
		bwthAttr := ""
		if !useIops {
			metricLabel = "带宽(MiBps)"
			bwthAttr = ` class="bwth"`
		}

		thead := `<thead>` +
			`<tr><th rowspan=2>iodepth</th><th rowspan=2>numjobs</th><th rowspan=2>模式</th>` +
			`<th colspan=2>读</th><th colspan=2>写</th><th colspan=2>混合读</th><th colspan=2>混合写</th></tr>` +
			fmt.Sprintf(`<tr><th%s>%s</th><th>延迟(us)</th><th%s>%s</th><th>延迟(us)</th><th%s>%s</th><th>延迟(us)</th><th%s>%s</th><th>延迟(us)</th></tr>`,
				bwthAttr, metricLabel, bwthAttr, metricLabel, bwthAttr, metricLabel, bwthAttr, metricLabel) +
			`</thead>`

		depthMap := byBsDepth[bs]
		var depths []int
		for d := range depthMap {
			depths = append(depths, d)
		}
		sort.Ints(depths)

		var rowsHtml []string
		for _, depth := range depths {
			bkt := depthMap[depth]

			var rws []string
			numjobs := 0
			if bkt.Read != nil {
				rws = append(rws, bkt.Read.RW)
				numjobs = bkt.Read.Numjobs
			}
			if bkt.Write != nil {
				rws = append(rws, bkt.Write.RW)
				if numjobs == 0 {
					numjobs = bkt.Write.Numjobs
				}
			}
			if bkt.Mixed != nil {
				rws = append(rws, bkt.Mixed.RW)
				if numjobs == 0 {
					numjobs = bkt.Mixed.Numjobs
				}
			}

			modeCn := "顺序"
			for _, rw := range rws {
				if strings.Contains(strings.ToLower(rw), "rand") {
					modeCn = "随机"
					break
				}
			}

			fmtVal := func(bktItem *models.GroupedMetric, getter func(*models.GroupedMetric) float64, isBw bool) string {
				if bktItem == nil {
					if isBw {
						return `<td class="bwv" data-mib="-">-</td>`
					}
					return `<td>-</td>`
				}
				v := getter(bktItem)
				if isBw {
					return fmt.Sprintf(`<td class="bwv" data-mib="%.2f">%.2f</td>`, v, v)
				}
				return fmt.Sprintf(`<td>%.2f</td>`, v)
			}

			var rMetric, wMetric, mrMetric, mwMetric string
			if useIops {
				rMetric = fmtVal(bkt.Read, func(m *models.GroupedMetric) float64 { return m.ReadIOPS / 1000.0 }, false)
				wMetric = fmtVal(bkt.Write, func(m *models.GroupedMetric) float64 { return m.WriteIOPS / 1000.0 }, false)
				mrMetric = fmtVal(bkt.Mixed, func(m *models.GroupedMetric) float64 { return m.ReadIOPS / 1000.0 }, false)
				mwMetric = fmtVal(bkt.Mixed, func(m *models.GroupedMetric) float64 { return m.WriteIOPS / 1000.0 }, false)
			} else {
				rMetric = fmtVal(bkt.Read, func(m *models.GroupedMetric) float64 { return m.ReadBWMB }, true)
				wMetric = fmtVal(bkt.Write, func(m *models.GroupedMetric) float64 { return m.WriteBWMB }, true)
				mrMetric = fmtVal(bkt.Mixed, func(m *models.GroupedMetric) float64 { return m.ReadBWMB }, true)
				mwMetric = fmtVal(bkt.Mixed, func(m *models.GroupedMetric) float64 { return m.WriteBWMB }, true)
			}

			rLat := fmtVal(bkt.Read, func(m *models.GroupedMetric) float64 { return m.ReadLatMS * 1000.0 }, false)
			wLat := fmtVal(bkt.Write, func(m *models.GroupedMetric) float64 { return m.WriteLatMS * 1000.0 }, false)
			mrLat := fmtVal(bkt.Mixed, func(m *models.GroupedMetric) float64 { return m.ReadLatMS * 1000.0 }, false)
			mwLat := fmtVal(bkt.Mixed, func(m *models.GroupedMetric) float64 { return m.WriteLatMS * 1000.0 }, false)

			row := fmt.Sprintf(`<tr><td>%d</td><td>%d</td><td>%s</td>%s%s%s%s%s%s%s%s</tr>`,
				depth, numjobs, modeCn,
				rMetric, rLat, wMetric, wLat, mrMetric, mrLat, mwMetric, mwLat)
			rowsHtml = append(rowsHtml, row)
		}

		tableHtml := fmt.Sprintf(`<table>%s<tbody>%s</tbody></table>`, thead, strings.Join(rowsHtml, ""))
		htmlParts = append(htmlParts, tableHtml)
	}

	return strings.Join(htmlParts, "")
}
