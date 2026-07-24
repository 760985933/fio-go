package report

import (
        "fmt"
        "sort"
        "strings"

        "github.com/xuri/excelize/v2"
        "fio-go/internal/models"
        "fio-go/internal/parser"
)

type blockData struct {
        Read  *models.GroupedMetric
        Write *models.GroupedMetric
        Mixed *models.GroupedMetric
}

func generateMergedSheet(f *excelize.File, sheetName string, groupedRows []models.GroupedMetric) {
        // Group by BS -> IODepth -> blockData
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
                // using a copy to avoid pointer reuse issues
                rowCopy := r
                switch rw {
                case "read", "randread":
                        bkt.Read = &rowCopy
                case "write", "randwrite":
                        bkt.Write = &rowCopy
                case "readwrite", "rw", "randrw":
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

        curRow := 1

        titleStyle, _ := f.NewStyle(&excelize.Style{
                Font:      &excelize.Font{Bold: true},
                Alignment: &excelize.Alignment{Horizontal: "center", Vertical: "center"},
                Fill:      excelize.Fill{Type: "pattern", Color: []string{"FFF3CD"}, Pattern: 1},
                Border: []excelize.Border{
                        {Type: "left", Color: "DDDDDD", Style: 1},
                        {Type: "right", Color: "DDDDDD", Style: 1},
                        {Type: "top", Color: "DDDDDD", Style: 1},
                        {Type: "bottom", Color: "DDDDDD", Style: 1},
                },
        })
        topHeaderStyle, _ := f.NewStyle(&excelize.Style{
                Font:      &excelize.Font{Bold: true},
                Alignment: &excelize.Alignment{Horizontal: "center", Vertical: "center"},
                Fill:      excelize.Fill{Type: "pattern", Color: []string{"D9E8FB"}, Pattern: 1},
                Border: []excelize.Border{
                        {Type: "left", Color: "DDDDDD", Style: 1},
                        {Type: "right", Color: "DDDDDD", Style: 1},
                        {Type: "top", Color: "DDDDDD", Style: 1},
                        {Type: "bottom", Color: "DDDDDD", Style: 1},
                },
        })
        subHeaderStyle, _ := f.NewStyle(&excelize.Style{
                Font:      &excelize.Font{Bold: true},
                Alignment: &excelize.Alignment{Horizontal: "center", Vertical: "center"},
                Fill:      excelize.Fill{Type: "pattern", Color: []string{"F0F0F0"}, Pattern: 1},
                Border: []excelize.Border{
                        {Type: "left", Color: "DDDDDD", Style: 1},
                        {Type: "right", Color: "DDDDDD", Style: 1},
                        {Type: "top", Color: "DDDDDD", Style: 1},
                        {Type: "bottom", Color: "DDDDDD", Style: 1},
                },
        })
        cellStyleOdd, _ := f.NewStyle(&excelize.Style{
                Alignment: &excelize.Alignment{Horizontal: "center", Vertical: "center"},
                Border: []excelize.Border{
                        {Type: "left", Color: "EEEEEE", Style: 1},
                        {Type: "right", Color: "EEEEEE", Style: 1},
                        {Type: "top", Color: "EEEEEE", Style: 1},
                        {Type: "bottom", Color: "EEEEEE", Style: 1},
                },
        })
        cellStyleEven, _ := f.NewStyle(&excelize.Style{
                Alignment: &excelize.Alignment{Horizontal: "center", Vertical: "center"},
                Fill:      excelize.Fill{Type: "pattern", Color: []string{"FAFAFA"}, Pattern: 1},
                Border: []excelize.Border{
                        {Type: "left", Color: "EEEEEE", Style: 1},
                        {Type: "right", Color: "EEEEEE", Style: 1},
                        {Type: "top", Color: "EEEEEE", Style: 1},
                        {Type: "bottom", Color: "EEEEEE", Style: 1},
                },
        })

        for _, bs := range bsKeys {
                curRow++
                
                // Title
                titleRow := curRow
                f.SetSheetRow(sheetName, fmt.Sprintf("A%d", titleRow), &[]interface{}{fmt.Sprintf("%s 读写", bs)})
                f.MergeCell(sheetName, fmt.Sprintf("A%d", titleRow), fmt.Sprintf("K%d", titleRow))
                f.SetRowHeight(sheetName, titleRow, 24)
                f.SetCellStyle(sheetName, fmt.Sprintf("A%d", titleRow), fmt.Sprintf("K%d", titleRow), titleStyle)
                curRow++

                bsBytes := parser.BSToBytes(bs)
                useIops := bsBytes <= 32*1024
                metricLabel := "带宽(MiBps)"
                if useIops {
                        metricLabel = "IOPS(K)"
                }

                // Headers
                f.SetSheetRow(sheetName, fmt.Sprintf("A%d", curRow), &[]interface{}{
                        "iodepth", "numjobs", "模式", "读", "", "写", "", "混合读", "", "混合写", "",
                })
                f.SetRowHeight(sheetName, curRow, 22)
                f.SetCellStyle(sheetName, fmt.Sprintf("A%d", curRow), fmt.Sprintf("K%d", curRow), topHeaderStyle)
                
                f.SetSheetRow(sheetName, fmt.Sprintf("A%d", curRow+1), &[]interface{}{
                        "", "", "", metricLabel, "延迟(us)", metricLabel, "延迟(us)", metricLabel, "延迟(us)", metricLabel, "延迟(us)",
                })
                f.SetRowHeight(sheetName, curRow+1, 20)
                f.SetCellStyle(sheetName, fmt.Sprintf("A%d", curRow+1), fmt.Sprintf("K%d", curRow+1), subHeaderStyle)

                f.MergeCell(sheetName, fmt.Sprintf("A%d", curRow), fmt.Sprintf("A%d", curRow+1))
                f.MergeCell(sheetName, fmt.Sprintf("B%d", curRow), fmt.Sprintf("B%d", curRow+1))
                f.MergeCell(sheetName, fmt.Sprintf("C%d", curRow), fmt.Sprintf("C%d", curRow+1))
                f.MergeCell(sheetName, fmt.Sprintf("D%d", curRow), fmt.Sprintf("E%d", curRow))
                f.MergeCell(sheetName, fmt.Sprintf("F%d", curRow), fmt.Sprintf("G%d", curRow))
                f.MergeCell(sheetName, fmt.Sprintf("H%d", curRow), fmt.Sprintf("I%d", curRow))
                f.MergeCell(sheetName, fmt.Sprintf("J%d", curRow), fmt.Sprintf("K%d", curRow))

                curRow += 2

                depthMap := byBsDepth[bs]
                var depths []int
                for d := range depthMap {
                        depths = append(depths, d)
                }
                sort.Ints(depths)

                dataRowCount := 0
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

                        fmtVal := func(bktItem *models.GroupedMetric, getter func(*models.GroupedMetric) float64) string {
                                if bktItem == nil {
                                        return "-"
                                }
                                return fmt.Sprintf("%.2f", getter(bktItem))
                        }

                        var rMetric, wMetric, mrMetric, mwMetric string
                        if useIops {
                                rMetric = fmtVal(bkt.Read, func(m *models.GroupedMetric) float64 { return m.ReadIOPS / 1000.0 })
                                wMetric = fmtVal(bkt.Write, func(m *models.GroupedMetric) float64 { return m.WriteIOPS / 1000.0 })
                                mrMetric = fmtVal(bkt.Mixed, func(m *models.GroupedMetric) float64 { return m.ReadIOPS / 1000.0 })
                                mwMetric = fmtVal(bkt.Mixed, func(m *models.GroupedMetric) float64 { return m.WriteIOPS / 1000.0 })
                        } else {
                                rMetric = fmtVal(bkt.Read, func(m *models.GroupedMetric) float64 { return m.ReadBWMB })
                                wMetric = fmtVal(bkt.Write, func(m *models.GroupedMetric) float64 { return m.WriteBWMB })
                                mrMetric = fmtVal(bkt.Mixed, func(m *models.GroupedMetric) float64 { return m.ReadBWMB })
                                mwMetric = fmtVal(bkt.Mixed, func(m *models.GroupedMetric) float64 { return m.WriteBWMB })
                        }

                        rLat := fmtVal(bkt.Read, func(m *models.GroupedMetric) float64 { return m.ReadLatMS * 1000.0 })
                        wLat := fmtVal(bkt.Write, func(m *models.GroupedMetric) float64 { return m.WriteLatMS * 1000.0 })
                        mrLat := fmtVal(bkt.Mixed, func(m *models.GroupedMetric) float64 { return m.ReadLatMS * 1000.0 })
                        mwLat := fmtVal(bkt.Mixed, func(m *models.GroupedMetric) float64 { return m.WriteLatMS * 1000.0 })

                        rowVals := []interface{}{
                                depth, numjobs, modeCn,
                                rMetric, rLat, wMetric, wLat, mrMetric, mrLat, mwMetric, mwLat,
                        }
                        
                        // replace "-" with nil so it becomes blank? Actually python puts "-" 
                        // Wait, Python uses "-"
                        f.SetSheetRow(sheetName, fmt.Sprintf("A%d", curRow), &rowVals)
                        
                        style := cellStyleOdd
                        if dataRowCount%2 == 1 {
                                style = cellStyleEven
                        }
                        f.SetCellStyle(sheetName, fmt.Sprintf("A%d", curRow), fmt.Sprintf("K%d", curRow), style)
                        f.SetRowHeight(sheetName, curRow, 18)
                        
                        curRow++
                        dataRowCount++
                }
        }

        f.SetColWidth(sheetName, "A", "C", 10)
        f.SetColWidth(sheetName, "D", "D", 12)
        f.SetColWidth(sheetName, "E", "E", 14)
        f.SetColWidth(sheetName, "F", "F", 12)
        f.SetColWidth(sheetName, "G", "G", 14)
        f.SetColWidth(sheetName, "H", "H", 12)
        f.SetColWidth(sheetName, "I", "I", 14)
        f.SetColWidth(sheetName, "J", "J", 12)
        f.SetColWidth(sheetName, "K", "K", 14)
}
