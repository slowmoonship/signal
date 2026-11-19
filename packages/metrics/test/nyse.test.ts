/**
 * 美股收盘时刻。
 *
 * 锁定的是交易所日历，不是某一笔行情：
 * 夏令时、节假日和提前收盘只要偏一小时，BTC 就会配错一根 K 线。
 */

import { describe, expect, it } from 'vitest'

import {
  isEarlyClose,
  isNyseClosed,
  parseEnglishDate,
  previousSession,
  sessionCloseUtc,
  sessionsAreAdjacent,
} from '../src/calendar/nyse.js'

function utcHour(iso: string): number {
  const ts = sessionCloseUtc(iso)
  expect(ts, iso).not.toBeNull()
  return new Date((ts ?? 0) * 1000).getUTCHours()
}

describe('收盘时刻', () => {
  it('夏令时 16:00 是 20:00 UTC，冬令时是 21:00 UTC', () => {
    expect(utcHour('2026-06-15')).toBe(20)
    expect(utcHour('2026-01-02')).toBe(21)
    expect(utcHour('2026-03-06')).toBe(21)
    expect(utcHour('2026-03-09')).toBe(20)
  })

  it('提前收盘是 13:00 美东，全天休市不是提前收盘', () => {
    expect(isEarlyClose('2026-11-27')).toBe(true)
    expect(utcHour('2026-11-27')).toBe(18)
    expect(isEarlyClose('2026-12-24')).toBe(true)
    expect(utcHour('2026-12-24')).toBe(18)
    expect(isNyseClosed('2026-07-03')).toBe(true)
    expect(isEarlyClose('2026-07-03')).toBe(false)
    expect(sessionCloseUtc('2026-07-03')).toBeNull()
  })

  it('2026 与 2027 的休市日按交易所公告', () => {
    for (const iso of [
      '2026-01-01',
      '2026-01-19',
      '2026-02-16',
      '2026-04-03',
      '2026-05-25',
      '2026-06-19',
      '2026-07-03',
      '2026-09-07',
      '2026-11-26',
      '2026-12-25',
    ]) {
      expect(sessionCloseUtc(iso), iso).toBeNull()
    }
    for (const iso of [
      '2027-01-01',
      '2027-01-18',
      '2027-02-15',
      '2027-03-26',
      '2027-05-31',
      '2027-06-18',
      '2027-07-05',
      '2027-09-06',
      '2027-11-25',
      '2027-12-24',
    ]) {
      expect(sessionCloseUtc(iso), iso).toBeNull()
    }
    expect(isEarlyClose('2027-11-26')).toBe(true)
    expect(sessionCloseUtc('2028-01-03')).not.toBeNull()
    expect(sessionCloseUtc('2027-12-31')).not.toBeNull()
    expect(isEarlyClose('2028-07-03')).toBe(true)
    expect(isEarlyClose('2028-11-24')).toBe(true)
  })

  it('周末、节假日和日历范围外都不是交易日', () => {
    expect(sessionCloseUtc('2026-11-15')).toBeNull()
    expect(sessionCloseUtc('2025-01-09')).toBeNull()
    expect(sessionCloseUtc('2023-06-15')).toBeNull()
    expect(previousSession('2026-01-20')).toBe('2026-01-16')
    expect(sessionsAreAdjacent('2026-01-16', '2026-01-20')).toBe(true)
    expect(sessionsAreAdjacent('2026-01-16', '2026-01-21')).toBe(false)
  })

  it('英文日期解析失败时不猜', () => {
    expect(parseEnglishDate('November 15, 2026')).toBe('2026-11-15')
    expect(parseEnglishDate('Nov. 13, 2026 close')).toBe('2026-11-13')
    expect(parseEnglishDate('not a date')).toBeNull()
  })
})
