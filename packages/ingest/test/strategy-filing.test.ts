/**
 * 披露解析。
 *
 * 数字来自已经读过的 8-K 表格形状。测试锁定的是「怎么读这张表」，
 * 不是把某一天的持仓写死成永远正确——真实行情仍以每次抓到的文件为准。
 */

import { describe, expect, it } from 'vitest'

import { collapseEvents, parseFiling, parseFilingEvents, seriesFromEvents } from '../src/strategy/filing.js'
import { parseBriefing } from '../src/strategy/briefing.js'

const BUY = `
<p>During Period November 9, 2026 to November 15, 2026 As of November 15, 2026</p>
<p>Shares Sold Notional Value (in millions) Net Proceeds (in millions)</p>
<p>MSTR Stock 2,087,040 $ - $ 244.7</p>
<p>During Period November 9, 2026 to November 15, 2026 As of November 15, 2026</p>
<p>BTC Purchased (1) Aggregate Purchase Price (in millions) (2) Average Purchase Price (2)
Aggregate BTC Holdings Aggregate Purchase Price (in billions) (2) Average Purchase Price (2)</p>
<p>485 $ 33.4 $ 68,887 850,849 $ 64.20 $ 75,452</p>
<p>Shares Repurchased Aggregate Purchase Price (in millions)</p>
<p>STRC Stock (1) 2,282,510 $ 228.1</p>
<p>USD Reserve and USD Cash were $4.75 billion and $151.2 million, respectively.</p>
`

const SALE = `
<p>During Period August 3, 2026 to August 9, 2026 As of August 9, 2026</p>
<p>BTC Sold (1) Aggregate Sale Price (in millions) Average Sale Price
Aggregate BTC Holdings Aggregate Purchase Price (in billions) Average Purchase Price</p>
<p>1,690 $108.6 $64,262 840,447 $63.36 $75,385</p>
<p>The net proceeds from the bitcoin sales were used to fund repurchases of STRC Stock.</p>
`

const ADJUSTED = `
<p>During Period January 6, 2026 to January 12, 2026 As of January 12, 2026</p>
<p>BTC Adjusted Aggregate Purchase Price (in millions) Average Purchase Price
Aggregate BTC Holdings Aggregate Purchase Price (in billions) Average Purchase Price</p>
<p>12 $ 1.0 $ 70,000 800,000 $ 60.00 $ 75,000</p>
<p>The change was a custody transfer, not a sale.</p>
`

describe('8-K 表格', () => {
  const buy = parseFiling(BUY, { accession: '0001193125-26-462151', filedOn: '2026-11-16' })
  const sale = parseFiling(SALE, { accession: '0001193125-26-341297', filedOn: '2026-08-10' })

  it('买入、卖出和持仓截止日分开', () => {
    expect(buy?.flowClass).toBe('buy')
    expect(buy?.btcDelta).toBe(485)
    expect(buy?.holdings).toBe(850849)
    expect(buy?.averageUsd).toBe(75452)
    expect(buy?.holdingsAsOf).toBe('2026-11-15')
    expect(buy?.periodStart).toBe('2026-11-09')
    expect(buy?.periodEnd).toBe('2026-11-15')
    expect(buy?.filedOn).toBe('2026-11-16')
    expect(buy?.filedOn).not.toBe(buy?.holdingsAsOf)
    expect(sale?.flowClass).toBe('sell')
    expect(sale?.btcDelta).toBe(-1690)
    expect(sale?.holdings).toBe(840447)
    expect(sale?.averageUsd).toBe(75385)
  })

  it('同一份文件里的增发和回购是两件事', () => {
    expect(buy?.mstrSharesIssued).toBe(2087040)
    expect(buy?.mstrProceedsUsd).toBe(244_700_000)
    expect(buy?.strcSharesRepurchased).toBe(2282510)
    expect(buy?.strcCostUsd).toBe(228_100_000)
    expect(buy?.usdReserveUsd).toBe(4_750_000_000)
    expect(buy?.usdCashUsd).toBe(151_200_000)
  })

  it('非卖出的减少不记成卖出', () => {
    const adjusted = parseFiling(ADJUSTED, { accession: '0001193125-26-000001', filedOn: '2026-01-13' })
    expect(adjusted?.flowClass).toBe('adjustment')
    expect(adjusted?.flowClass).not.toBe('sell')
    expect(adjusted?.btcDelta).toBe(-12)
  })

  it('重复披露和修订都不增加交易笔数', () => {
    const revised = parseFiling(BUY.replace('850,849', '850,850'), {
      accession: '0001193125-26-462151-A',
      filedOn: '2026-11-17',
    })
    expect(revised).not.toBeNull()
    if (!buy || !revised) return
    const once = seriesFromEvents([sale, buy].filter((event) => event !== null))
    const twice = seriesFromEvents([sale, buy, buy].filter((event) => event !== null))
    expect(twice.holdings).toEqual(once.holdings)
    const amended = collapseEvents([sale, buy, revised].filter((event) => event !== null))
    expect(amended).toHaveLength(2)
    expect(amended.find((event) => event.holdingsAsOf === '2026-11-15')?.holdings).toBe(850850)
    expect(amended.find((event) => event.holdingsAsOf === '2026-11-15')?.accession).toContain('-A')
  })

  it('没有新披露时序列不变，也不补今天', () => {
    const events = [sale, buy].filter((event) => event !== null)
    const first = seriesFromEvents(events)
    const second = seriesFromEvents(events)
    expect(second).toEqual(first)
    const dates = first.holdings.map((point) => new Date(point.ts * 1000).toISOString().slice(0, 10))
    expect(dates).toEqual(['2026-08-09', '2026-11-15'])
    expect(dates).not.toContain('2026-11-17')
  })

  it('同一份文件里的上一周和本周都保留', () => {
    const html = `
      During Period September 28, 2026 to September 30, 2026
      BTC Acquired (1) Aggregate Purchase Price (in millions) (2) Average Purchase Price (2)
      - - -
      As of September 30, 2026 Aggregate BTC Holdings Aggregate Purchase Price (in billions) (2) Average Purchase Price (2)
      847,666 $63.95 $75,436.6
      During Period October 1, 2026 to October 4, 2026
      BTC Acquired (1) Aggregate Purchase Price (in millions) (2) Average Purchase Price (2)
      334 $28.7 $85,838.8
      As of October 4, 2026 Aggregate BTC Holdings Aggregate Purchase Price (in billions) (2) Average Purchase Price (2)
      848,000 $63.97 $75,440.7
    `
    const events = parseFilingEvents(html, { accession: '0001193125-26-413164', filedOn: '2026-10-05' })
    expect(events.map((event) => event.holdingsAsOf)).toEqual(['2026-09-30', '2026-10-04'])
    expect(events[0]?.flowClass).toBe('unchanged')
    expect(events[0]?.holdings).toBe(847666)
    expect(events[1]?.btcDelta).toBe(334)
    expect(events[1]?.holdings).toBe(848000)
    expect(events[1]?.averageUsd).toBeCloseTo(75440.7)
    expect(parseFiling(html, { accession: '0001193125-26-413164', filedOn: '2026-10-05' })?.holdings).toBe(848000)
  })

  it('2025 年初表格把金额直接写成 billion', () => {
    const html = `
      During Period March 24, 2025 to March 30, 2025 As of March 30, 2025
      BTC Acquired (1) Aggregate Purchase Price (2) Average Purchase Price (2)
      Aggregate BTC Holdings Aggregate Purchase Price (2) Average Purchase Price (2)
      22,048 $ 1.92 billion $ 86,969 528,185 $ 35.63 billion $ 67,458
    `
    const event = parseFiling(html, { accession: '0000950170-25-047219', filedOn: '2025-03-31' })
    expect(event?.flowClass).toBe('buy')
    expect(event?.btcDelta).toBe(22048)
    expect(event?.holdings).toBe(528185)
    expect(event?.aggregateBillions).toBeCloseTo(35.63)
    expect(event?.averageUsd).toBe(67458)
    expect(event?.holdingsAsOf).toBe('2025-03-30')
  })

  it('卖出数量和持仓分行时仍读到卖出', () => {
    const html = `
      During Period May 26, 2026 to May 31, 2026
      BTC Sold Aggregate Sale Price (in millions) (2) Average Sale Price (2)
      32 (1) $2.5 $77,135
      As of May 31, 2026 Aggregate BTC Holdings Aggregate Purchase Price (in billions) (2) Average Purchase Price (2)
      843,706 $63.87 $75,699
    `
    const event = parseFiling(html, { accession: '0001193125-26-249768', filedOn: '2026-06-01' })
    expect(event?.flowClass).toBe('sell')
    expect(event?.btcDelta).toBe(-32)
    expect(event?.holdings).toBe(843706)
    expect(event?.averageUsd).toBe(75699)
    expect(event?.holdingsAsOf).toBe('2026-05-31')
  })

  it('没有买卖的一周不是卖出', () => {
    const html = `
      During Period August 10, 2026 to August 16, 2026 As of August 16, 2026
      BTC Purchased / (Sold) (1) Aggregate Purchase / (Sale) Price (in millions) (2) Average Purchase / (Sale) Price (2)
      Aggregate BTC Holdings Aggregate Purchase Price (in billions) (2) Average Purchase Price (2)
      - $ - $ - 840,447 $ 63.36 $ 75,385
    `
    const event = parseFiling(html, { accession: '0001193125-26-353240', filedOn: '2026-08-17' })
    expect(event?.flowClass).toBe('unchanged')
    expect(event?.btcDelta).toBe(0)
    expect(event?.holdings).toBe(840447)
  })

  it('同一份文件里的两周按各自的截止日配对', () => {
    const html = `
      During Period December 29, 2025 to December 31, 2025 As of December 31, 2025
      BTC Acquired (1) Aggregate Purchase Price (in millions) (2) Average Purchase Price (2)
      Aggregate BTC Holdings Aggregate Purchase Price (in billions) (2) Average Purchase Price (2)
      3 $ 0.3 $ 88,210 672,500 $ 50.44 $ 74,997
      During Period January 1, 2026 to January 4, 2026 As of January 4, 2026
      BTC Acquired (1) Aggregate Purchase Price (in millions) (2) Average Purchase Price (2)
      Aggregate BTC Holdings Aggregate Purchase Price (in billions) (2) Average Purchase Price (2)
      1,283 $ 116.0 $ 90,391 673,783 $ 50.55 $ 75,026
      Q4 2025 Financial Update As of December 31, 2025 the company reported results.
    `
    const events = parseFilingEvents(html, { accession: '0001193125-26-001550', filedOn: '2026-01-05' })
    expect(events.map((event) => [event.holdingsAsOf, event.btcDelta, event.holdings])).toEqual([
      ['2025-12-31', 3, 672500],
      ['2026-01-04', 1283, 673783],
    ])
    expect(events[1]?.periodStart).toBe('2026-01-01')
    expect(events[1]?.periodEnd).toBe('2026-01-04')
  })

  it('2024 年的叙述披露读出持仓、区间和截止日', () => {
    const html = `
      during the period between February 15, 2024 and February 25, 2024, MicroStrategy, together with its subsidiaries,
      acquired approximately 3,000 bitcoins for approximately $155.4 million in cash, at an average price of approximately $51,813 per bitcoin,
      inclusive of fees and expenses. As of February 25, 2024, MicroStrategy held an aggregate of approximately 193,000 bitcoins,
      which were acquired at an aggregate purchase price of approximately $6.09 billion and an average purchase price of approximately $31,544 per bitcoin.
    `
    const event = parseFiling(html, { accession: '0001193125-24-045396', filedOn: '2024-02-26' })
    expect(event?.flowClass).toBe('buy')
    expect(event?.btcDelta).toBe(3000)
    expect(event?.holdings).toBe(193000)
    expect(event?.averageUsd).toBe(31544)
    expect(event?.aggregateBillions).toBeCloseTo(6.09)
    expect(event?.periodStart).toBe('2024-02-15')
    expect(event?.periodEnd).toBe('2024-02-25')
    expect(event?.holdingsAsOf).toBe('2024-02-25')
    expect(event?.filedOn).not.toBe(event?.holdingsAsOf)
  })

  it('均价用披露写明的数字，不拿前后两笔重新平均', () => {
    const series = seriesFromEvents([sale, buy].filter((event) => event !== null))
    expect(series.cost.map((point) => point.value)).toEqual([75385, 75452])
  })
})

describe('投资者简报', () => {
  const text = `
 $111.62
 MSTR Price
 Nov. 13 snapshot
 1.09x                                                        850,849                                                      $4,900M
 mNAV                                                         BTC                                                          USD ASSETS
 Market data as of Nov. 13, 2026 close. BTC holdings as of Nov. 15, 2026, as reported in the Form 8-K.
 BTC Per Share (Sats)                 186,082 sats
 BTC Per Share (Sats) increased from 56,598 sats in 2020 to 186,082 sats at the current snapshot.
`

  it('读出收盘价、mNAV 和官方每股聪数，不把历史对照句当成另一条', () => {
    const parsed = parseBriefing(text)
    expect(parsed.price).toBe(111.62)
    expect(parsed.priceSession).toBe('2026-11-13')
    expect(parsed.mnav).toBe(1.09)
    expect(parsed.holdings).toBe(850849)
    expect(parsed.bpsSats).toBe(186082)
    expect(parsed.holdingsAsOf).toBe('2026-11-15')
  })
})
