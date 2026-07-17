// Re-export Wails binding types as the canonical types
export type {
  HostConfig,
  HostRecord,
  ExecutionTaskConfig,
  CheckResult,
  ActionResult,
  AnalysisSummary,
  OrchestrationConfig,
  AuditEntry,
  OrchestrationProgress,
} from '../wailsjs/go/app/App';

// FIO 配置类型 (前端本地使用)
export interface FioJob {
  bs: number
  rw: string
  rwmixread?: number
  iodepth: number
  numjobs: number
  direct: boolean
  thread: boolean
  fsync?: number
  iodepth_batch?: number
  rate_iops?: number
}

export interface FioLogging {
  enabled: boolean
  log_avg_msec: number
  write_bw_log: boolean
  write_lat_log: boolean
  write_iops_log: boolean
}

export interface FioConfig {
  global: {
    filename: string
    runtime: number
    ramp_time: number
    ioengine: string
    size?: string
    directory?: string
  }
  logging: FioLogging
  jobs: FioJob[]
}
