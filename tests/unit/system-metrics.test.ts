import { describe, expect, it } from 'vitest'
import { buildSystemAlerts, getAverageCpuUsage } from '../../server/system-metrics.js'

describe('system metrics helpers', () => {
  it('averages cpu usage across cores', () => {
    const usage = getAverageCpuUsage([
      { times: { user: 30, nice: 0, sys: 10, idle: 60, irq: 0 } },
      { times: { user: 20, nice: 0, sys: 20, idle: 60, irq: 0 } },
    ] as any)

    expect(usage).toBeCloseTo(40)
  })

  it('builds alerts for high cpu, memory, and disk usage', () => {
    const alerts = buildSystemAlerts({
      cpu: { usage: 81.2 },
      memory: { usagePercent: 82.6 },
      disk: { usagePercent: 84.1 },
    } as any)

    expect(alerts).toEqual([
      {
        level: 'warning',
        type: 'cpu',
        message: 'CPU usage is high: 81%',
        threshold: 80,
        current: 81,
      },
      {
        level: 'warning',
        type: 'memory',
        message: 'Memory usage is high: 83%',
        threshold: 80,
        current: 83,
      },
      {
        level: 'warning',
        type: 'disk',
        message: 'Disk usage is high: 84%',
        threshold: 80,
        current: 84,
      },
    ])
  })

  it('skips alerts when values are below thresholds', () => {
    const alerts = buildSystemAlerts({
      cpu: { usage: 79.9 },
      memory: { usagePercent: 60.1 },
      disk: { usagePercent: 10.4 },
    } as any)

    expect(alerts).toEqual([])
  })
})
