# FIO 配置生成器（前端）

位置：`frontend/fio-config-ui`

## 使用指南
- 直接用浏览器打开 `index.html` 即可使用（无需后端/启动服务）。
- 顶部可选择“预置模板”（空白 / xpxv 示例）。
- 左侧为多个任务（Jobs）卡片，可添加/复制/删除，并支持折叠；右侧为配置预览。
- 任务可视化仅包含字段：`bs(单位:k)`, `rw`, `rwmixread`, `iodepth`, `numjobs`。
- 日志路径自动生成：如 `write_bw_log` 为 `/tmp/fio/data/logs/{顺序值}_{bs内容}_{rw内容}_iodepth{值}_bw.log`，`lat/iops` 类似。
- 点击“导出 JSON”将当前配置保存为 `fio_config.json`。
- 点击“导入 JSON”可从本地选择 `fio_config.json` 加载到页面。
- 点击“生成并下载配置”会下载 `fio_config.fio` 文本文件。
- 页面会自动在 `localStorage` 中持久化当前配置。

## JSON 结构
```json
{
  "global": {
    "filename": "/dev/vdb",
    "runtime": 180,
    "ramp_time": 10,
    "ioengine": "libaio",
    "direct": 1,
    "time_based": 1,
    "norandommap": 1,
    "randrepeat": 0,
    "log_avg_msec": 500,
    "group_reporting": 1,
    "extras": { "stonewall": 1 }
  },
  "jobs": [
    {
      "name": "sec0_256k_read_iodepth32",
      "bs_k": 256,
      "rw": "read",
      "rwmixread": 70,
      "iodepth": 32,
      "numjobs": 2
    }
  ]
}
```

## 设计说明（与需求对齐）
- 前端代码已放置在 `frontend` 文件夹中，纯前端实现，符合“前后端分离”的要求。
- 所有主要函数均提供注释，返回值采用 `status/msg/data` 封装，便于错误处理与拓展。
- 通过 JSDoc 类型注释提高代码可读性（在 `app.js` 中）。
- 支持 JSON 导入导出，便于配置复用与修改。
- 支持预置模板（含 xpxv 示例），提升易用性与可视化编辑体验。
- 页面采用现代化样式和栅格布局，保证直观与美观。

## 注意事项
- 浏览器本地文件下载需要允许弹出下载；若阻止请在浏览器中允许。
- 导入 JSON 必须符合结构，否则会提示错误信息。兼容旧结构：若存在字符串 `bs`（如`"256k"`），会自动解析为数值 `bs_k: 256`。
- 输入值会进行基本校验与清理（如键名仅允许 `[a-zA-Z0-9_]`）。

## 后续可扩展
- 支持从 `.fio` 文本解析回 JSON（目前仅支持 JSON 导入）。
- 增加更多预置模板与参数分组（如队列、日志等）。