/**
 * 发布目录里的实际可用性。
 *
 * 文件存在、data:verify 通过，都不等于这个指标能算。
 * 弹性倍数只有在可再分发收盘够 90 个交易日时才允许出现数字。
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const dataDir = join(import.meta.dirname, '../../../public/data')

type Point = { ts: number; value: number | null }
type File = {
  points: Point[]
  model?: { quality?: string; beta?: number; samples?: number; reason?: string }
}

function load(id: string): File {
  return JSON.parse(readFileSync(join(dataDir, `${id}.json`), 'utf8')) as File
}

function day(ts: number): string {
  return new Date(ts * 1000).toISOString().slice(0, 10)
}

function known(file: File): Point[] {
  return file.points.filter((point) => point.value !== null)
}

describe('发布数据的实际可用性', () => {
  it('可再分发收盘不够 91 个时，弹性倍数保持没有数字', () => {
    const closes = known(load('mstr-price'))
    const beta = load('mstr-btc-beta-90d')
    if (closes.length >= 91) {
      expect(known(beta).length).toBeGreaterThan(0)
      expect(beta.model?.samples).toBeGreaterThanOrEqual(90)
      expect(beta.model?.beta).toEqual(expect.any(Number))
      return
    }
    expect(beta.model?.quality).toBe('insufficient')
    expect(beta.model?.beta).toBeUndefined()
    expect(known(beta)).toHaveLength(0)
    expect(beta.model?.reason ?? '').toMatch(/90/)
  })

  it('2020 年 8 月第一次写明的购买还在', () => {
    const point = known(load('strategy-btc-holdings')).find((item) => day(item.ts) === '2020-08-11')
    expect(point?.value).toBe(21454)
  })

  it('2024-11-17 的 51,780 枚买入把 11 月的持仓接上', () => {
    const points = known(load('strategy-btc-holdings'))
    const byDay = new Map(points.map((point) => [day(point.ts), point.value]))
    expect(byDay.get('2024-11-10')).toBe(279420)
    expect(byDay.get('2024-11-17')).toBe(331200)
    expect(byDay.get('2024-11-24')).toBe(386700)
    expect((byDay.get('2024-11-10') ?? 0) + 51780).toBe(331200)
    expect((byDay.get('2024-11-17') ?? 0) + 55500).toBe(386700)
  })

  it('2026-11-15 的 850,849 枚持仓还在', () => {
    const points = known(load('strategy-btc-holdings'))
    const byDay = new Map(points.map((point) => [day(point.ts), point.value]))
    expect(byDay.get('2026-11-15')).toBe(850849)
    const last = points.at(-1)
    expect(last).toBeDefined()
    if (!last) return
    expect(day(last.ts) >= '2026-11-15').toBe(true)
    expect(last.value).toBeGreaterThan(0)
  })

  it('2024-11-17 的持仓能回到那份 8-K', () => {
    const file = JSON.parse(readFileSync(join(dataDir, 'strategy-btc-holdings.json'), 'utf8')) as {
      disclosures?: { holdingsAsOf: string; holdings: number; accession: string; sourceUrl: string }[]
    }
    const row = file.disclosures?.find((item) => item.holdingsAsOf === '2024-11-17')
    expect(row?.holdings).toBe(331200)
    expect(row?.accession).toBe('0001193125-24-260452')
    expect(row?.sourceUrl).toContain('0001193125-24-260452-index.html')
  })
})
