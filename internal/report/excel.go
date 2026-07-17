package report

import (
	"fmt"
	"sort"
	"strings"

	"github.com/xuri/excelize/v2"

	"fio-go/internal/models"
	"fio-go/internal/parser"
)

func GenerateExcel(res *parser.AnalysisResult, outPath string) ([]models.GroupedMetric, error) {
        f := excelize.NewFile()
        defer f.Close()

	sheetNodes := "节点汇总"
	sheetMerged := "性能汇总(合并)"
	sheetData := "数据汇总"
	sheetOS := "OS配置"

	f.SetSheetName("Sheet1", sheetMerged)
        f.NewSheet(sheetData)
        f.NewSheet(sheetNodes)

        // Generate data for nodes and data sheets
        var groupedRows []models.GroupedMetric

        // Sort BS
        var bsKeys []string
        for k := range res.Aggregated {
                bsKeys = append(bsKeys, k)
        }
	sort.Slice(bsKeys, func(i, j int) bool {
		return parser.BSToBytes(bsKeys[i]) < parser.BSToBytes(bsKeys[j])
	})

	// 1. sheetNodes "节点汇总"
	f.SetColWidth(sheetNodes, "A", "A", 10)
	f.SetColWidth(sheetNodes, "B", "B", 28)
	f.SetColWidth(sheetNodes, "C", "C", 12)
	f.SetColWidth(sheetNodes, "D", "D", 10)
	f.SetColWidth(sheetNodes, "E", "E", 16)
	f.SetColWidth(sheetNodes, "F", "G", 12)
	f.SetColWidth(sheetNodes, "H", "K", 14)

	headers := []interface{}{"bs", "场景", "读写类型", "iodepth", "节点IP", "读IOPS", "写IOPS", "读带宽(MB/s)", "写带宽(MB/s)", "读延迟均值(ms)", "写延迟均值(ms)"}
	f.SetSheetRow(sheetNodes, "A1", &headers)

	boldStyle, _ := f.NewStyle(&excelize.Style{Font: &excelize.Font{Bold: true}, Alignment: &excelize.Alignment{Horizontal: "center"}})
	f.SetRowStyle(sheetNodes, 1, 1, boldStyle)

	summaryFill, _ := f.NewStyle(&excelize.Style{
		Fill: excelize.Fill{Type: "pattern", Color: []string{"FFF3CD"}, Pattern: 1},
		Font: &excelize.Font{Bold: true},
	})

	rowIdx := 2
	for _, bs := range bsKeys {
		jobMap := res.Aggregated[bs]
		jobKeys := make([]string, 0, len(jobMap))
		for j := range jobMap {
			jobKeys = append(jobKeys, j)
		}
		sort.Slice(jobKeys, func(i, j int) bool {
			// get one node to check RW
			var rw1, rw2 string
			for _, n := range jobMap[jobKeys[i]] {
				rw1 = n.RW
				break
			}
			for _, n := range jobMap[jobKeys[j]] {
				rw2 = n.RW
				break
			}
			r1 := parser.RWRank(rw1)
			r2 := parser.RWRank(rw2)
			if r1 == r2 {
				return jobKeys[i] < jobKeys[j]
			}
			return r1 < r2
		})

		for _, jobname := range jobKeys {
			ipMap := jobMap[jobname]

			// Collect nodes from ipMap
			var nodes []models.NodeMetric
			for _, metric := range ipMap {
				nodes = append(nodes, metric)
			}

			if len(nodes) == 0 {
				continue
			}

			// Sort nodes by IP
			sort.Slice(nodes, func(i, j int) bool {
				return nodes[i].IP < nodes[j].IP
			})

			var rIopsSum, wIopsSum, rBwSum, wBwSum, rLatSum, wLatSum float64
			rw := nodes[0].RW
			iodepth := nodes[0].IODepth

			for _, n := range nodes {
				f.SetSheetRow(sheetNodes, fmt.Sprintf("A%d", rowIdx), &[]interface{}{
					bs, jobname, n.RW, n.IODepth, n.IP,
					n.ReadIOPS, n.WriteIOPS, n.ReadBW / 1024.0, n.WriteBW / 1024.0,
					n.ReadClatMeanUS / 1000.0, n.WriteClatMeanUS / 1000.0,
				})
				rowIdx++

				rIopsSum += n.ReadIOPS
				wIopsSum += n.WriteIOPS
				rBwSum += n.ReadBW
				wBwSum += n.WriteBW
				rLatSum += n.ReadClatMeanUS * n.ReadIOPS
				wLatSum += n.WriteClatMeanUS * n.WriteIOPS
			}

			rLatAvg := 0.0
			if rIopsSum > 0 {
				rLatAvg = rLatSum / rIopsSum
			}
			wLatAvg := 0.0
			if wIopsSum > 0 {
				wLatAvg = wLatSum / wIopsSum
			}

			f.SetSheetRow(sheetNodes, fmt.Sprintf("A%d", rowIdx), &[]interface{}{
				bs, jobname, rw, iodepth, "场景汇总",
				rIopsSum, wIopsSum, rBwSum / 1024.0, wBwSum / 1024.0,
				rLatAvg / 1000.0, wLatAvg / 1000.0,
			})
			f.SetRowStyle(sheetNodes, rowIdx, rowIdx, summaryFill)
			rowIdx++

			nj := res.NumJobsMap[parser.MakeNumJobsKey(bs, strings.ToLower(rw), iodepth)]
			if nj == 0 {
				nj = parser.ExtractNumJobs(parser.FioJob{"jobname": jobname})
			}

			groupedRows = append(groupedRows, models.GroupedMetric{
				BS: bs, Jobname: jobname, RW: rw, IODepth: iodepth, Numjobs: nj,
				ReadIOPS: rIopsSum, WriteIOPS: wIopsSum,
				ReadBWMB: rBwSum / 1024.0, WriteBWMB: wBwSum / 1024.0,
				ReadLatMS: rLatAvg / 1000.0, WriteLatMS: wLatAvg / 1000.0,
			})
		}
	}

	// 2. sheetData "数据汇总"
	headersData := []interface{}{"bs", "读写类型", "iodepth", "numjobs", "读IOPS", "写IOPS", "读带宽(MB/s)", "写带宽(MB/s)", "读延迟均值(ms)", "写延迟均值(ms)"}
	f.SetSheetRow(sheetData, "A1", &headersData)
	f.SetRowStyle(sheetData, 1, 1, boldStyle)

	sort.Slice(groupedRows, func(i, j int) bool {
		if groupedRows[i].BS != groupedRows[j].BS {
			return parser.BSToBytes(groupedRows[i].BS) < parser.BSToBytes(groupedRows[j].BS)
		}
		return parser.RWRank(groupedRows[i].RW) < parser.RWRank(groupedRows[j].RW)
	})

	for i, r := range groupedRows {
		f.SetSheetRow(sheetData, fmt.Sprintf("A%d", i+2), &[]interface{}{
			r.BS, r.RW, r.IODepth, r.Numjobs,
			r.ReadIOPS, r.WriteIOPS, r.ReadBWMB, r.WriteBWMB, r.ReadLatMS, r.WriteLatMS,
		})
	}
	f.SetColWidth(sheetData, "A", "A", 10)
	f.SetColWidth(sheetData, "B", "B", 12)
	f.SetColWidth(sheetData, "C", "D", 10)
	f.SetColWidth(sheetData, "E", "F", 12)
	f.SetColWidth(sheetData, "G", "J", 14)

	// 3. sheetOS "OS配置"
	if len(res.SystemTexts) > 0 {
		f.NewSheet(sheetOS)
		f.SetSheetRow(sheetOS, "A1", &[]interface{}{"节点IP", "内容"})
		f.SetRowStyle(sheetOS, 1, 1, boldStyle)
		f.SetColWidth(sheetOS, "A", "A", 18)
		f.SetColWidth(sheetOS, "B", "B", 120)

		var ips []string
		for ip := range res.SystemTexts {
			ips = append(ips, ip)
		}
		sort.Strings(ips)

		for i, ip := range ips {
			f.SetSheetRow(sheetOS, fmt.Sprintf("A%d", i+2), &[]interface{}{ip, res.SystemTexts[ip]})
		}
	}

	// 4. Generate Merged Sheet
        generateMergedSheet(f, sheetMerged, groupedRows)

        return groupedRows, f.SaveAs(outPath)
}
