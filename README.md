# NetTopo 性能测试工具

NetTopo 网络拓扑性能测试管理与报告生成工具，支持 CLI、Web 和桌面 GUI 三种模式。

## 功能特性

- **FIO 配置生成器** — 可视化编辑 FIO 测试参数，自动生成 `.fio` 脚本
- **远程任务执行** — 通过 SSH 批量部署、运行、监控 FIO 测试
- **数据自动拉取** — 测试完成后一键拉取所有节点的结果数据
- **智能报告生成** — 自动生成 Excel 汇总表 + HTML 交互式图表报告
- **任务编排** — 多场景拖拽排序，自动顺序执行

## 快速开始

### 方式一：桌面应用（推荐）

从 [Releases](../../releases) 页面下载对应平台的应用，双击运行即可。

| 平台 | 文件 |
|------|------|
| macOS (Universal) | `nettopo_test` |
| Windows | `nettopo_test.exe` |
| Linux | `nettopo_test` |

### 方式二：CLI 模式

```bash
# 分析 FIO 数据并生成报告
./nettopo_test_cli -data /path/to/fio/data -output-dir ./output

# 启动 Web 管理界面
./nettopo_test_cli -web -port 8080
```

### 方式三：从源码编译

```bash
# CLI 模式
go build -o nettopo_test_cli ./cmd/cli/

# Desktop 模式（需要安装 Wails CLI 和 Node.js）
go install github.com/wailsapp/wails/v2/cmd/wails@latest
cd frontend && npm install && cd ..
wails build
```

## 项目结构

```
fio-go/
├── cmd/cli/              # CLI 模式入口
├── main.go               # Wails 桌面模式入口
├── internal/
│   ├── app/              # Wails 绑定层
│   ├── executor/         # SSH/FIO 远程执行
│   ├── models/           # 数据模型
│   ├── parser/           # JSON/日志解析
│   ├── report/           # Excel/HTML 报告生成
│   └── web/              # Web 模式服务
├── frontend/             # React 桌面 UI
├── build/                # 构建配置
├── scripts/              # FIO 脚本
└── wails.json            # Wails 配置
```

## 使用说明

### 1. 准备 FIO 数据

将 FIO 测试产生的 JSON 和日志文件按以下结构组织：

```
data/
├── 192.168.1.100/        # 按节点 IP 分目录
│   ├── system.txt        # 系统信息
│   └── logs/             # FIO 日志文件
└── 192.168.1.101/
    ├── system.txt
    └── logs/
```

### 2. 生成报告

```bash
./nettopo_test_cli -data ./data -output-dir ./output
```

生成文件：
- `output/fio_summary.xlsx` — Excel 汇总表（含节点明细、性能汇总、合并视图）
- `output/fio_report.html` — HTML 交互式报告（含 ECharts 时序图）

### 3. 远程执行（Web/桌面模式）

1. 配置 FIO 测试参数
2. 添加目标主机（SSH 连接信息）
3. 点击「部署并运行」自动推送脚本并启动测试
4. 测试完成后点击「拉取数据」下载结果
5. 点击「生成报告」自动分析并生成报告

## 环境要求

- Go 1.25+
- Node.js 20+（仅桌面模式编译需要）
- FIO（仅运行测试的机器需要）
- SSH 访问（仅远程执行需要）

## License

AGPLv3

本项目采用 GNU Affero General Public License v3.0 (AGPLv3) 开源协议。

**核心要求：**

- 任何基于本项目的衍生作品，若对外提供网络服务或分发，**必须完整公开前后端全部源代码**。
- 衍生作品包含但不限于：前端页面、后端服务、接口逻辑、数据库脚本、部署脚本，均需完整开源。
- 不得仅开放前端代码而隐藏服务端实现。
