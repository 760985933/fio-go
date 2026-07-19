import { FioConfig, FioConfigReady, FioLogging } from '../types'

const DEFAULT_LOGGING: FioLogging = { enabled: true, log_avg_msec: 500, write_bw_log: true, write_lat_log: true, write_iops_log: true }

export function ensureConfig(config: FioConfig): FioConfigReady {
  return {
    ...config,
    global: { ...config.global },
    logging: config.logging ?? { ...DEFAULT_LOGGING },
    jobs: config.jobs.map(j => ({ ...j, direct: j.direct !== false, thread: j.thread !== false })),
  }
}

export function bsLabel(bs: number): string {
  return bs >= 1024 ? `${bs / 1024}M` : `${bs}k`
}
