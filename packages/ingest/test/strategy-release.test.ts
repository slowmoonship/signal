import { describe, expect, it } from 'vitest'

import { BETA_WINDOW } from '@slowmoonship/metrics'

import { composeBetaFile } from '../src/strategy/release.js'

describe('Beta 发布', () => {
  it('收盘不够 90 日窗口时不写倍数', () => {
    const file = composeBetaFile({
      previous: null,
      fresh: [{ ts: 1, value: 2.1 }],
      quality: 'insufficient',
      formulaReason: '有效收益率 2 个',
      samples: 2,
      closes: 3,
      session: '2026-11-13',
      fit: { beta: 2.1, correlation: 0.9, r2: 0.8, intercept: 0, residualStd: 0.01 },
      ingestedAt: '2026-11-17T00:00:00.000Z',
    })
    expect(file.points).toEqual([])
    expect(file.model?.beta).toBeUndefined()
    expect(file.model?.quality).toBe('insufficient')
    expect(file.model?.reason).toContain('3 个')
    expect(file.model?.reason).toContain(`${BETA_WINDOW}`)
    expect(file.stale).toBe(false)
    expect(JSON.stringify(file)).not.toMatch(/2\.1/)
  })

  it('上一份已经有倍数时，本轮样本不足只标过期，不把点清空', () => {
    const previous = composeBetaFile({
      previous: null,
      fresh: [{ ts: 1, value: 1.8 }],
      quality: 'ok',
      formulaReason: 'ok',
      samples: 90,
      closes: 91,
      session: '2026-11-13',
      fit: { beta: 1.8, correlation: 0.8, r2: 0.64, intercept: 0.01, residualStd: 0.02 },
      ingestedAt: '2026-11-16T00:00:00.000Z',
    })
    const next = composeBetaFile({
      previous,
      fresh: [],
      quality: 'insufficient',
      formulaReason: '本轮没有对齐收盘',
      samples: 0,
      closes: 0,
      session: null,
      fit: null,
      ingestedAt: '2026-11-17T00:00:00.000Z',
    })
    expect(next.points).toEqual(previous.points)
    expect(next.model?.beta).toBe(1.8)
    expect(next.stale).toBe(true)
    expect(next.warnings.at(-1)).toContain('没有对齐收盘')
  })
})
