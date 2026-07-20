import { useState, useEffect } from 'react'
import { HostConfig } from '../../types'
import * as App from '../../wailsjs/go/app/App'

interface Props {
  onAudit: (action: string, details: string) => void
  onShowResults: (title: string, content: string, wide?: boolean) => Promise<void>
  active?: boolean
}

// CheckIperfServer 与 CheckIperfInstalled 都返回 ExecutionResult（或其数组）
type ExecResult = Awaited<ReturnType<typeof App.CheckIperfServer>>

// 从 `iperf3 --version` 输出解析版本号，判断是否满足 >= 3.7（低于 3.7 不支持 --json-stream）
function parseIperfVersion(msg: string): { version: string; ok: boolean } | null {
  const m = msg.match(/iperf3?\s+(\d+)\.(\d+)(?:\.(\d+))?/i)
  if (!m) return null
  const major = parseInt(m[1], 10)
  const minor = parseInt(m[2], 10)
  const ok = major > 3 || (major === 3 && minor >= 7)
  return { version: `${m[1]}.${m[2]}${m[3] ? '.' + m[3] : ''}`, ok }
}

export function IperfServerManager({ onAudit, onShowResults, active }: Props) {
  const [hosts, setHosts] = useState<HostConfig[]>([])
  const [hostPorts, setHostPorts] = useState<Record<string, number>>({})
  const [serverStatus, setServerStatus] = useState<Record<string, boolean>>({})
  const [serverError, setServerError] = useState<Record<string, string>>({})
  const [installStatus, setInstallStatus] = useState<Record<string, boolean | null>>({})
  const [installVersion, setInstallVersion] = useState<Record<string, string>>({})
  const [installWarn, setInstallWarn] = useState<Record<string, boolean>>({})
  useEffect(() => { if (active) loadHosts() }, [active])

  const getPort = (hostKey: string) => hostPorts[hostKey] || 5201

  const loadHosts = async () => {
    try {
      const list = await App.GetHosts()
      setHosts(list || [])
    } catch { /* ignore */ }
  }

  // 将单台主机的安装检查结果写入状态，并返回摘要后缀
  const applyInstallResult = (hostKey: string, r: ExecResult): string => {
    const installed = !r.error
    setInstallStatus(prev => ({ ...prev, [hostKey]: installed }))
    let detail = ''
    if (installed) {
      const v = parseIperfVersion(r.msg)
      if (v) {
        setInstallVersion(prev => ({ ...prev, [hostKey]: v.version }))
        setInstallWarn(prev => ({ ...prev, [hostKey]: !v.ok }))
        detail = `（iperf3 ${v.version}${v.ok ? '' : '，版本低于 3.7，功能不全'}）`
      } else {
        setInstallVersion(prev => ({ ...prev, [hostKey]: '' }))
        detail = `（${r.msg}）`
      }
    } else {
      setInstallVersion(prev => ({ ...prev, [hostKey]: '' }))
      detail = `（${r.error}）`
    }
    return detail
  }

  // 「检查」：同时检查 server 运行状态 与 iperf3 安装状态，两者独立互不影响
  const checkServer = async (host: HostConfig): Promise<{ running: ExecResult | null; install: ExecResult | null } | null> => {
    const port = getPort(host.host)
    try {
      const [runningOutcome, installOutcome] = await Promise.allSettled([
        App.CheckIperfServer(host, port),
        App.CheckIperfInstalled([host]),
      ])
      if (runningOutcome.status === 'fulfilled') {
        const runningRes = runningOutcome.value
        if (runningRes.error) {
          // SSH 登录/连接失败：明确标记为“连接失败”，而不是误判为“未启动”
          setServerError(prev => ({ ...prev, [host.host]: runningRes.error }))
          setServerStatus(prev => ({ ...prev, [host.host]: false }))
        } else {
          setServerError(prev => ({ ...prev, [host.host]: '' }))
          setServerStatus(prev => ({ ...prev, [host.host]: runningRes.running }))
        }
      } else {
        setServerStatus(prev => ({ ...prev, [host.host]: false }))
      }
      let install: ExecResult | null = null
      if (installOutcome.status === 'fulfilled') {
        install = installOutcome.value[0]
        applyInstallResult(host.host, install)
      }
      return {
        running: runningOutcome.status === 'fulfilled' ? runningOutcome.value : null,
        install,
      }
    } catch { return null }
  }

  const startServer = async (host: HostConfig) => {
    const port = getPort(host.host)
    try {
      // 启动前先确认该主机已安装 iperf3
      const installResults = await App.CheckIperfInstalled([host])
      const install = installResults[0]
      if (!install || install.error) {
        setInstallStatus(prev => ({ ...prev, [host.host]: false }))
        await onShowResults('无法启动', `主机 ${host.host} 未安装 iperf3，无法启动 server。请先安装 iperf3 ≥ 3.7。${install?.error ? '（' + install.error + '）' : ''}`)
        return
      }
      setInstallStatus(prev => ({ ...prev, [host.host]: true }))
      const result = await App.StartIperfServer(host, port)
      if (result.error) {
        await onShowResults('启动失败', result.error)
        return
      }
      setServerStatus(prev => ({ ...prev, [host.host]: true }))
      onAudit('启动iperf3 server', `${host.host}:${port}`)
    } catch (err) {
      await onShowResults('启动失败', String(err))
    }
  }

  const stopServer = async (host: HostConfig) => {
    const port = getPort(host.host)
    try {
      const result = await App.StopIperfServer(host, port)
      setServerStatus(prev => ({ ...prev, [host.host]: false }))
      onAudit('停止iperf3 server', `${host.host}:${port}`)
    } catch (err) {
      await onShowResults('停止失败', String(err))
    }
  }

  const checkAll = async () => {
    if (hosts.length === 0) return
    const lines: string[] = []
    for (const host of hosts) {
      const r = await checkServer(host)
      if (!r || !r.running) {
        lines.push(`${host.host}: 检查失败`)
      } else if (r.running.error) {
        lines.push(`${host.host}: 连接失败（${r.running.error}）`)
      } else {
        const runningTxt = r.running.running ? '运行中' : '未启动'
        let installTxt = ''
        if (r.install) {
          if (r.install.error) {
            installTxt = ' / 未安装'
          } else {
            const v = parseIperfVersion(r.install.msg)
            installTxt = v ? ` / 已安装 ${v.version}` : ' / 已安装'
          }
        }
        lines.push(`${host.host}: ${runningTxt}${installTxt}`)
      }
    }
    await onShowResults('批量检查结果', lines.join('\n'))
  }

  const checkInstalled = async () => {
    if (hosts.length === 0) return
    try {
      const results = await App.CheckIperfInstalled(hosts)
      const lines: string[] = []
      results.forEach((r, i) => {
        const detail = applyInstallResult(hosts[i].host, r)
        lines.push(`${hosts[i].host}: ${!r.error ? '已安装' : '未安装'}${detail}`)
      })
      onAudit('检查iperf3安装', `${hosts.length} 台主机`)
      await onShowResults('iperf3 安装检查结果', lines.join('\n'))
    } catch { /* ignore */ }
  }

  return (
    <div>
      <div className="manager-header">
        <h2>Server 管理</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn btn-outline btn-sm" onClick={loadHosts}>刷新主机</button>
          <button className="btn btn-outline btn-sm" onClick={checkAll}>批量检查</button>
          <button className="btn btn-outline btn-sm" onClick={checkInstalled}>检查iperf3安装</button>
        </div>
      </div>

      <div style={{ background: '#fef3cd', border: '1px solid #ffc107', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 13, color: '#856404', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontWeight: 600 }}>⚠ 请确保所有主机安装 iperf3 ≥ 3.7</span>
        <span>（低于 3.7 版本不支持 <code style={{ background: '#fff3cd', padding: '1px 4px', borderRadius: 3 }}>--json-stream</code>，实时监控和测试执行将无法工作）</span>
      </div>

      <div className="panel">
        {hosts.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontSize: 12 }}>请先在主机管理中添加主机</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
                <th style={{ padding: '8px 12px' }}>主机</th>
                <th style={{ padding: '8px 12px' }}>端口</th>
                <th style={{ padding: '8px 12px' }}>安装状态</th>
                <th style={{ padding: '8px 12px' }}>状态</th>
                <th style={{ padding: '8px 12px' }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {hosts.map(host => {
                const isRunning = serverStatus[host.host]
                return (
                  <tr key={host.host} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '8px 12px' }}>{host.user}@{host.host}:{host.port}</td>
                    <td style={{ padding: '8px 12px' }}>
                      <input
                        type="number"
                        value={getPort(host.host)}
                        onChange={e => setHostPorts(prev => ({ ...prev, [host.host]: parseInt(e.target.value) || 5201 }))}
                        style={{ width: 70, fontSize: 13 }}
                      />
                    </td>
                    <td style={{ padding: '8px 12px' }}>
                      {installStatus[host.host] === undefined ? (
                        <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>未检查</span>
                      ) : installStatus[host.host] ? (
                        installVersion[host.host] ? (
                          <span
                            style={{ color: installWarn[host.host] ? '#f59e0b' : '#22c55e' }}
                            title={installWarn[host.host] ? '版本低于 3.7，--json-stream 不可用' : `iperf3 ${installVersion[host.host]}`}
                          >
                            {installWarn[host.host] ? '⚠ ' : ''}已安装 {installVersion[host.host]}
                          </span>
                        ) : (
                          <span style={{ color: '#22c55e' }}>已安装</span>
                        )
                      ) : (
                        <span style={{ color: '#ef4444' }}>未安装</span>
                      )}
                    </td>
                    <td style={{ padding: '8px 12px' }}>
                      <span style={{
                        display: 'inline-block',
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        background: serverError[host.host] ? '#ef4444' : isRunning === undefined ? '#9ca3af' : isRunning ? '#22c55e' : '#ef4444',
                        marginRight: 6,
                      }} />
                      {serverError[host.host] ? (
                        <span style={{ color: '#ef4444' }} title={serverError[host.host]}>连接失败</span>
                      ) : isRunning === undefined ? (
                        '未检查'
                      ) : isRunning ? (
                        '运行中'
                      ) : (
                        '未启动'
                      )}
                    </td>
                    <td style={{ padding: '8px 12px' }}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button className="btn btn-outline btn-sm" onClick={() => checkServer(host)}>检查</button>
                        {isRunning ? (
                          <button className="btn btn-danger btn-sm" onClick={() => stopServer(host)}>停止</button>
                        ) : (
                          <button className="btn btn-primary btn-sm" onClick={() => startServer(host)}>启动</button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
