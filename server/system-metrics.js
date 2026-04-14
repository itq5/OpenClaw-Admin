import { execSync } from 'child_process'
import { readFileSync, statfsSync } from 'fs'
import os from 'os'
import { parse as parsePath } from 'path'

export function getAverageCpuUsage(cpus = os.cpus()) {
  if (!Array.isArray(cpus) || cpus.length === 0) {
    return 0
  }

  let totalUsage = 0

  for (const cpu of cpus) {
    const total = Object.values(cpu.times).reduce((sum, value) => sum + value, 0)
    const idle = cpu.times.idle
    totalUsage += total > 0 ? ((total - idle) / total) * 100 : 0
  }

  return totalUsage / cpus.length
}

export function getMonitoredDiskPath({
  cwd = process.cwd(),
  platform = os.platform(),
  systemDrive = process.env.SystemDrive,
} = {}) {
  const cwdRoot = parsePath(cwd).root
  if (cwdRoot) {
    return cwdRoot
  }

  if (platform === 'win32') {
    const normalizedSystemDrive = systemDrive
      ? String(systemDrive).replace(/[\\/]+$/, '')
      : 'C:'
    return `${normalizedSystemDrive}\\`
  }

  return '/'
}

export function getDiskInfo({ path = getMonitoredDiskPath() } = {}) {
  try {
    const stats = statfsSync(path)
    const blockSize = Number(stats.bsize)
    const totalBlocks = Number(stats.blocks)
    const freeBlocks = Number(stats.bavail ?? stats.bfree)
    const total = blockSize * totalBlocks
    const free = blockSize * freeBlocks

    return {
      path,
      total,
      free,
      used: Math.max(total - free, 0),
    }
  } catch {
    return { path, total: 0, free: 0, used: 0 }
  }
}

export function getNetworkTotals({ platform = os.platform() } = {}) {
  let bytesReceived = 0
  let bytesSent = 0

  try {
    if (platform === 'win32') {
      const output = execSync(
        'powershell -NoProfile -Command "Get-NetAdapterStatistics | ConvertTo-Json"',
        { encoding: 'utf8', timeout: 5000 }
      )
      const stats = JSON.parse(output || '[]')
      const adapters = Array.isArray(stats) ? stats : [stats]
      for (const adapter of adapters) {
        if (adapter) {
          bytesReceived += Number(adapter.ReceivedBytes) || 0
          bytesSent += Number(adapter.SentBytes) || 0
        }
      }
    } else {
      const netDev = readFileSync('/proc/net/dev', 'utf8')
      const lines = netDev.trim().split('\n').slice(2)
      for (const line of lines) {
        const parts = line.trim().split(/\s+/)
        if (parts.length >= 10) {
          const iface = parts[0].replace(':', '')
          if (iface === 'lo') {
            continue
          }
          bytesReceived += Number.parseInt(parts[1], 10) || 0
          bytesSent += Number.parseInt(parts[9], 10) || 0
        }
      }
    }
  } catch {
    bytesReceived = 0
    bytesSent = 0
  }

  return { bytesReceived, bytesSent }
}

export function collectLocalSystemMetrics({ includeTimestamp = false } = {}) {
  const cpus = os.cpus()
  const totalMem = os.totalmem()
  const freeMem = os.freemem()
  const usedMem = totalMem - freeMem
  const disk = getDiskInfo()
  const metrics = {
    cpu: {
      usage: Math.round(getAverageCpuUsage(cpus) * 10) / 10,
      cores: cpus.length,
      model: cpus[0]?.model || 'Unknown',
    },
    memory: {
      total: totalMem,
      used: usedMem,
      free: freeMem,
      usagePercent: totalMem > 0 ? Math.round((usedMem / totalMem) * 1000) / 10 : 0,
    },
    disk: {
      path: disk.path,
      total: disk.total,
      used: disk.used,
      free: disk.free,
      usagePercent: disk.total > 0 ? Math.round((disk.used / disk.total) * 1000) / 10 : 0,
    },
    network: getNetworkTotals(),
    uptime: os.uptime(),
    loadAverage: os.loadavg(),
    platform: os.platform(),
    hostname: os.hostname(),
  }

  if (includeTimestamp) {
    metrics.timestamp = Date.now()
  }

  return metrics
}

export function buildSystemAlerts(metrics, thresholds = { cpu: 80, memory: 80, disk: 80 }) {
  const alerts = []

  const cpuUsage = Number(metrics?.cpu?.usage) || 0
  if (cpuUsage > thresholds.cpu) {
    alerts.push({
      level: 'warning',
      type: 'cpu',
      message: `CPU usage is high: ${Math.round(cpuUsage)}%`,
      threshold: thresholds.cpu,
      current: Math.round(cpuUsage),
    })
  }

  const memoryUsage = Number(metrics?.memory?.usagePercent) || 0
  if (memoryUsage > thresholds.memory) {
    alerts.push({
      level: 'warning',
      type: 'memory',
      message: `Memory usage is high: ${Math.round(memoryUsage)}%`,
      threshold: thresholds.memory,
      current: Math.round(memoryUsage),
    })
  }

  const diskUsage = Number(metrics?.disk?.usagePercent) || 0
  if (diskUsage > thresholds.disk) {
    alerts.push({
      level: 'warning',
      type: 'disk',
      message: `Disk usage is high: ${Math.round(diskUsage)}%`,
      threshold: thresholds.disk,
      current: Math.round(diskUsage),
    })
  }

  return alerts
}
