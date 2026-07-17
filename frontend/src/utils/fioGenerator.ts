import { FioConfig } from '../types'

function buildJobName(idx: number, job: { bs: number; rw: string; iodepth: number }): string {
  return `sec${idx}_${job.bs}k_${job.rw}_iodepth${job.iodepth}`
}

export function generateFioText(config: FioConfig, includeJsonComment: boolean = false): string {
  const lines: string[] = []

  lines.push('[global]')
  lines.push(`filename=${config.global.filename || '/dev/vdb'}`)
  lines.push(`runtime=${config.global.runtime || 180}`)
  lines.push(`ramp_time=${config.global.ramp_time || 30}`)
  lines.push(`ioengine=${config.global.ioengine || 'libaio'}`)
  lines.push('')

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
    lines.push('thread=1')
    lines.push('direct=1')
    lines.push('ioengine=libaio')
    lines.push('time_based=1')
    lines.push('overwrite=1')
    lines.push('norandommap=1')
    lines.push('randrepeat=0')
    lines.push('log_avg_msec=500')
    lines.push('group_reporting=1')
    lines.push(`write_bw_log=${jobName}`)
    lines.push(`write_lat_log=${jobName}`)
    lines.push(`write_iops_log=${jobName}`)
    lines.push('')
  })

  if (includeJsonComment) {
    lines.push(`# FIO_CONFIG_JSON: ${JSON.stringify(config)}`)
  }

  return lines.join('\n')
}
