// Re-export Wails binding types as the canonical types
export type {
  HostConfig,
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
}

export interface FioConfig {
  global: {
    filename: string
    runtime: number
    ramp_time: number
    ioengine: string
  }
  jobs: FioJob[]
}
