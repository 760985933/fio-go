// Go 绑定类型定义 - 与 Go structs 保持一致

export interface HostConfig {
  host: string
  port: number
  user: string
  password: string
}

export interface ExecutionTaskConfig {
  id: string
  name: string
  script: string
  hosts: HostConfig[]
}

export interface ActionResult {
  host: string
  error: string
  msg: string
}

export interface CheckResult {
  host: string
  running: boolean
  residual: boolean
  msg: string
}

export interface AnalysisSummary {
  id: string
  name: string
  script: string
  hasData: boolean
  hasReport: boolean
  logAvailable: boolean
  dataDir: string
  reportDir: string
  reportHtmlUrl: string
  downloadUrl: string
}

export interface OrchestrationConfig {
  sequence: string[]
  interval: number
}

export interface AuditEntry {
  action: string
  details: string
  timestamp: string
}

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
    [key: string]: any
  }
  jobs: FioJob[]
}
