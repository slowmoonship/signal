/**
 * 格式化测试。
 *
 * 最要紧的一条：null 必须格式化不成任何数字。
 * 一旦缺失被渲染成 "0" 或 "—0"，读者就无法区分"当天真的是零"和"我们没拿到数"。
 */

import { describe, expect, it } from 'vitest'

import {
  formatAxisTick,
  formatHashRate,
  formatOrMissing,
  formatSignedPercent,
  formatValue,
  MISSING,
} from '../src/index.js'

describe('缺失值', () => {
  const specs = [
    { kind: 'int' },
    { kind: 'decimal', maxDecimals: 2 },
    { kind: 'usd' },
    { kind: 'btc' },
    { kind: 'percent' },
    { kind: 'hashrate' },
    { kind: 'satPerVbyte' },
  ] as const

  it('null 一律返回 null，不产生任何数字', () => {
    for (const spec of specs) {
      expect(formatValue(null, spec, 'en'), spec.kind).toBeNull()
      expect(formatValue(null, spec, 'zh'), spec.kind).toBeNull()
    }
  })

  it('占位符与真实数字不同形，读者一眼能分辨', () => {
    expect(formatOrMissing(formatValue(null, { kind: 'int' }, 'en'))).toBe(MISSING)
    expect(formatOrMissing(formatValue(0, { kind: 'int' }, 'en'))).toBe('0')
  })

  it('NaN / Infinity 当作缺失处理', () => {
    expect(formatValue(Number.NaN, { kind: 'int' }, 'en')).toBeNull()
    expect(formatValue(Number.POSITIVE_INFINITY, { kind: 'usd' }, 'en')).toBeNull()
    expect(formatSignedPercent(Number.NaN, 'en')).toBeNull()
  })
})

describe('数值格式', () => {
  it('整数千分位', () => {
    expect(formatValue(608276, { kind: 'int' }, 'en')).toBe('608,276')
  })

  it('0 显示为 0 而不是空', () => {
    expect(formatValue(0, { kind: 'int' }, 'en')).toBe('0')
  })

  it('小数按 maxDecimals 取整显示，不做四舍五入到更少位', () => {
    expect(formatValue(0.012345, { kind: 'decimal', maxDecimals: 4 }, 'en')).toBe('0.0123')
  })

  it('BTC 保留至多 4 位小数（0.012 BTC 不会显示成 0）', () => {
    expect(formatValue(0.0123, { kind: 'btc' }, 'en')).toBe('0.0123 BTC')
    expect(formatValue(0.00001, { kind: 'btc' }, 'en')).toBe('0 BTC')
  })

  it('美元整数不带小数，市值不显示成科学计数法', () => {
    expect(formatValue(1_234_567, { kind: 'usd' }, 'en')).toBe('$1,234,567')
    expect(formatValue(2_400_000_000_000, { kind: 'usd' }, 'en')).toBe('$2,400,000,000,000')
  })

  it('带小数的美元保留 2 位', () => {
    expect(formatValue(12.5, { kind: 'usd' }, 'en')).toBe('$12.50')
  })

  it('百分比', () => {
    expect(formatValue(-1.24, { kind: 'percent' }, 'en')).toBe('-1.2%')
  })

  it('百分比的小数位固定：同一列表里不该出现 "-2%" 与 "-2.0%" 并排', () => {
    expect(formatValue(-2, { kind: 'percent', maxDecimals: 1 }, 'en')).toBe('-2.0%')
    expect(formatValue(-2.03, { kind: 'percent', maxDecimals: 1 }, 'en')).toBe('-2.0%')
  })

  it('聪每虚拟字节', () => {
    expect(formatValue(7.4, { kind: 'satPerVbyte' }, 'en')).toBe('7 sat/vB')
  })
})

describe('坐标轴刻度', () => {
  it('按 1000 逐级缩写，且每一级都标注正确', () => {
    expect(formatAxisTick(1_646_907_492_049, 'en')).toBe('1.65T')
    expect(formatAxisTick(2_500_000_000, 'en')).toBe('2.5B')
    expect(formatAxisTick(1_234_567, 'en')).toBe('1.23M')
    expect(formatAxisTick(15_400, 'en')).toBe('15.4K')
    expect(formatAxisTick(812, 'en')).toBe('812')
  })

  it('负刻度同样缩写（净流入这类会过零的序列）', () => {
    expect(formatAxisTick(-2_500_000_000, 'en')).toBe('-2.5B')
  })

  it('缩写后量级不变：K/M/B/T 一格都不能差', () => {
    for (const [value, expected] of [
      [1e3, '1K'],
      [1e6, '1M'],
      [1e9, '1B'],
      [1e12, '1T'],
    ] as const) {
      expect(formatAxisTick(value, 'en'), `${value} 的刻度缩写`).toBe(expected)
    }
  })
})

describe('算力单位进位', () => {
  it('大数自动进位并保留单位', () => {
    // 9.8e20 H/s = 980 EH/s（1 EH/s = 1e18 H/s，Zetta 从未被定义过）
    expect(formatHashRate(9.8e20, 'en')).toBe('980 EH/s')
    // 6.2e17 H/s = 620 PH/s。把它标成 EH/s 就是差 1000 倍的单位错误，
    // 而页面上完全看不出异常——所以每一级都要单独断言。
    expect(formatHashRate(6.2e17, 'en')).toBe('620 PH/s')
  })

  it('每一级前缀都对应正确的 1000 倍进位', () => {
    const cases: readonly [number, string][] = [
      [1.1e21, '1.1 ZH/s'],
      [2.2e21, '2.2 ZH/s'],
      [5e20, '500 EH/s'],
      [2.5e17, '250 PH/s'],
      [1.4e14, '140 TH/s'],
      [1.1e9, '1.1 GH/s'],
      [3.2e7, '32 MH/s'],
      [4.5e4, '45 kH/s'],
      [900, '900 H/s'],
    ]
    for (const [value, expected] of cases) {
      expect(formatHashRate(value, 'en'), `${value} 的单位标注`).toBe(expected)
    }
  })

  it('小数算力不硬套大单位', () => {
    expect(formatHashRate(5.6e-6, 'en')).toBe('0 H/s')
  })

  it('格式化后的量级与原值一致（防止除错 1000）', () => {
    const eh = 6.2e17
    expect(formatHashRate(eh, 'en')).toBe(`${(eh / 1e15).toLocaleString('en-US')} PH/s`)
  })
})
