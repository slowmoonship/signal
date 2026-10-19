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

  it('聪每虚拟字节', () => {
    expect(formatValue(7.4, { kind: 'satPerVbyte' }, 'en')).toBe('7 sat/vB')
  })
})

describe('算力单位进位', () => {
  it('大数自动进位并保留单位', () => {
    expect(formatHashRate(9.8e20, 'en')).toBe('980 ZH/s')
    expect(formatHashRate(6.2e17, 'en')).toBe('620 EH/s')
  })

  it('小数算力不硬套大单位', () => {
    expect(formatHashRate(5.6e-6, 'en')).toBe('0 H/s')
  })

  it('格式化后的量级与原值一致（防止除错 1000）', () => {
    const eh = 6.2e17
    expect(formatHashRate(eh, 'en')).toBe(`${(eh / 1e15).toLocaleString('en-US')} EH/s`)
  })
})

describe('带符号的变化', () => {
  it('正数带 +，负数带 −（排版减号而非连字符）', () => {
    expect(formatSignedPercent(3.81, 'en')).toBe('+3.8%')
    expect(formatSignedPercent(-4.12, 'en')).toBe('−4.1%')
  })

  it('0 不带符号', () => {
    expect(formatSignedPercent(0, 'en')).toBe('0.0%')
  })
})

describe('坐标轴刻度', () => {
  it('大数压缩，正文数值不受影响', () => {
    expect(formatAxisTick(2_400_000_000_000, 'en')).toBe('2.4T')
    expect(formatAxisTick(1_500, 'en')).toBe('1.5K')
    expect(formatAxisTick(42.5, 'en')).toBe('42.5')
  })

  it('正文格式化不受压缩影响', () => {
    expect(formatValue(2_400_000_000_000, { kind: 'usd' }, 'en')).toBe('$2,400,000,000,000')
  })
})
