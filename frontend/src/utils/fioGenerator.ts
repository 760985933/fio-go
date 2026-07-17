import { FioConfig, FioJob } from '../types'

function buildJobName(idx: number, job: FioJob): string {
  const rw = job.rw.toLowerCase()
  return `sec${idx}_${job.bs}k_${rw}_iodepth${job.iodepth}`
}

export function generateFioText(config: FioConfig, includeJsonComment: boolean = false): string {
  const lines: string[] = []

  // Global section
  lines.push('[global]')
  lines.push(`filename=${config.global.filename || '/dev/vdb'}`)
  lines.push(`runtime=${config.global.runtime || 180}`)
  lines.push(`ramp_time=${config.global.ramp_time || 30}`)
  lines.push(`ioengine=${config.global.ioengine || 'libaio'}`)
  lines.push('')

  // Job sections
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
    lines.push('time_based=1')
    lines.push(`write_bw_log=${jobName}`)
    lines.push(`write_lat_log=${jobName}`)
    lines.push(`write_iops_log=${jobName}`)
    lines.push('')
  })

  if (includeJsonComment) {
    const jsonStr = JSON.stringify(config)
    lines.push(`# FIO_CONFIG_JSON: ${jsonStr}`)
  }

  return lines.join('\n')
}
