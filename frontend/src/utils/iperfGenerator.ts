import { IperfConfig } from '../types'

export function generateIperfCommand(config: IperfConfig, serverHost: string): string {
  const args = ['iperf3', '-c', serverHost]

  if (config.protocol === 'udp') {
    args.push('-u')
  }

  if (config.bandwidth && config.bandwidth !== '0') {
    args.push('-b', config.bandwidth)
  }

  if (config.duration > 0) {
    args.push('-t', String(config.duration))
  }

  if (config.parallel > 1) {
    args.push('-P', String(config.parallel))
  }

  if (config.blockSize) {
    args.push('-l', config.blockSize)
  }

  if (config.windowSize) {
    args.push('-w', config.windowSize)
  }

  if (config.reverse) {
    args.push('-R')
  }

  if (config.bidir) {
    args.push('--bidir')
  }

  args.push('-J')

  if (config.extraFlags) {
    const flags = config.extraFlags.trim().split(/\s+/)
    args.push(...flags.filter(f => f.length > 0))
  }

  return args.join(' ')
}

export function formatBandwidth(bitsPerSecond: number): string {
  if (bitsPerSecond >= 1e9) {
    return `${(bitsPerSecond / 1e9).toFixed(2)} Gbps`
  }
  if (bitsPerSecond >= 1e6) {
    return `${(bitsPerSecond / 1e6).toFixed(2)} Mbps`
  }
  if (bitsPerSecond >= 1e3) {
    return `${(bitsPerSecond / 1e3).toFixed(2)} Kbps`
  }
  return `${bitsPerSecond.toFixed(0)} bps`
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1e12) {
    return `${(bytes / 1e12).toFixed(2)} TB`
  }
  if (bytes >= 1e9) {
    return `${(bytes / 1e9).toFixed(2)} GB`
  }
  if (bytes >= 1e6) {
    return `${(bytes / 1e6).toFixed(2)} MB`
  }
  if (bytes >= 1e3) {
    return `${(bytes / 1e3).toFixed(2)} KB`
  }
  return `${bytes} B`
}
