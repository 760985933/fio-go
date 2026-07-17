import { FioConfig } from '../types'

function buildJobName(idx: number, job: { bs: number; rw: string; iodepth: number }): string {
  return `sec${idx}_${job.bs}k_${job.rw}_iodepth${job.iodepth}`
}

export function generateFioText(config: FioConfig, includeJsonComment: boolean = false): string {
  const lines: string[] = []

  // Global section
  lines.push('[global]')
  lines.push(`filename=${config.global.filename || '/dev/vdb'}`)
  lines.push(`runtime=${config.global.runtime || 180}`)
  lines.push(`ramp_time=${config.global.ramp_time || 30}`)
  lines.push(`ioengine=${config.global.ioengine || 'libaio'}`)
  if (config.global.size) {
    lines.push(`size=${config.global.size}`)
  }
  if (config.global.directory) {
    lines.push(`directory=${config.global.directory}`)
  }
  lines.push('time_based=1')
  lines.push('group_reporting=1')
  lines.push('')

  // Jobs
  config.jobs.forEach((job, idx) => {
    const jobName = buildJobName(idx, job)
    lines.push(`[${jobName}]`)
    lines.push(`bs=${job.bs}k`)
    lines.push(`rw=${job.rw}`)
    if (job.rwmixread !== undefined && (job.rw === 'readwrite' || job.rw === 'randrw')) {
      lines.push(`rwmixread=${job.rwmixread}`)
    }
    lines.push(`iodepth=${job.iodepth}`)
    lines.push(`numjobs=${job.numjobs}`)
    lines.push(`direct=${job.direct ? 1 : 0}`)
    lines.push(`thread=${job.thread ? 1 : 0}`)
    if (job.fsync !== undefined && job.fsync > 0) {
      lines.push(`fsync=${job.fsync}`)
    }
    if (job.iodepth_batch !== undefined && job.iodepth_batch > 0) {
      lines.push(`iodepth_batch=${job.iodepth_batch}`)
    }
    if (job.rate_iops !== undefined && job.rate_iops > 0) {
      lines.push(`rate_iops=${job.rate_iops}`)
    }
    // Fixed values
    lines.push('overwrite=1')
    lines.push('norandommap=1')
    lines.push('randrepeat=0')
    // Logging
    if (config.logging.enabled) {
      lines.push(`log_avg_msec=${config.logging.log_avg_msec}`)
      if (config.logging.write_bw_log) lines.push(`write_bw_log=${jobName}`)
      if (config.logging.write_lat_log) lines.push(`write_lat_log=${jobName}`)
      if (config.logging.write_iops_log) lines.push(`write_iops_log=${jobName}`)
    }
    lines.push('')
  })

  if (includeJsonComment) {
    lines.push(`# FIO_CONFIG_JSON: ${JSON.stringify(config)}`)
  }

  return lines.join('\n')
}
