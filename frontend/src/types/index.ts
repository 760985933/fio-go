// Re-export Wails binding types as the canonical types
import type { HostConfig as WailsHostConfig } from '../wailsjs/go/app/App';
export type {
  HostRecord,
  ExecutionTaskConfig,
  CheckResult,
  ActionResult,
  AnalysisSummary,
  OrchestrationConfig,
  AuditEntry,
  OrchestrationProgress,
  ExecutionResult,
} from '../wailsjs/go/app/App';

export type HostConfig = WailsHostConfig;

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

export type FioLoggingKey = keyof FioLogging

export interface FioConfig {
  global: {
    filename: string
    runtime: number
    ramp_time: number
    ioengine: string
    size?: string
    directory?: string
  }
  logging?: FioLogging
  jobs: FioJob[]
  description?: string
}

export type FioConfigReady = Omit<FioConfig, 'logging'> & { logging: FioLogging }

// iperf 配置类型
export interface IperfConfig {
  id: string
  name: string
  protocol: string
  bandwidth: string
  duration: number
  parallel: number
  blockSize: string
  windowSize: string
  reverse: boolean
  bidir: boolean
  extraFlags: string
  serverTestIP: string
  serverBindIP: string
}

export interface IperfTask {
  id: string
  name: string
  config: IperfConfig
  serverHost: HostConfig
  clientHosts: HostConfig[]
  status: string
  createdAt: string
  startedAt?: string
  finishedAt?: string
}

export interface IperfInterval {
  timestamp: number
  streamID: number
  duration: number
  bytes: number
  bitsPerSecond: number
  jitterMs: number
  lostPackets: number
  totalPackets: number
  retransmits: number
  cpuUser: number
  cpuSys: number
}

export interface IperfAnalysisSummary {
  taskId: string
  taskName: string
  serverHost: string
  clientCount: number
  status: string
  hasData: boolean
  hasReport: boolean
  createdAt: string
  avgBandwidth: number
  maxBandwidth: number
}
