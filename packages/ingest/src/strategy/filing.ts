/**
 * Strategy 的 8-K 比特币与融资表格。
 *
 * 只认文件里写明的「买入 / 卖出 / 发行 / 回购」表，不从网页仪表盘抄数。
 * 披露日、交易区间、持仓截止日是三件不同的事，不能压成一个日期。
 * 同一截止日再披露一次时，后提交的那份覆盖前一份，不会多出一笔交易。
 */

import { parseEnglishDate } from '@slowmoonship/metrics'

export type FlowClass = 'buy' | 'sell' | 'adjustment' | 'unchanged'

export type DisclosureEvent = Readonly<{
  accession: string
  filedOn: string
  periodStart: string | null
  periodEnd: string | null
  holdingsAsOf: string | null
  btcDelta: number | null
  flowClass: FlowClass | null
  holdings: number | null
  averageUsd: number | null
  aggregateBillions: number | null
  mstrSharesIssued: number | null
  mstrProceedsUsd: number | null
  strcSharesRepurchased: number | null
  strcCostUsd: number | null
  usdReserveUsd: number | null
  usdCashUsd: number | null
}>

export function flattenHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#\d+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function parseNumber(raw: string | undefined): number | null {
  if (!raw) return null
  const cleaned = raw.replace(/,/g, '').trim()
  if (cleaned === '' || cleaned === '-' || cleaned === '—' || cleaned === '–') return null
  const value = Number(cleaned)
  return Number.isFinite(value) ? value : null
}

function dateIn(text: string): string | null {
  return parseEnglishDate(text)
}

const HEADER = /BTC (Purchased \/ \(Sold\)|Purchased|Sold|Adjusted|Acquired)\b/g
const COMPACT =
  /([\d,]+|-)\s*(?:\(\d+\))?\s+\$\s*([\d,.]+|-)(?:\s+(billion|million))?\s+\$\s*([\d,.]+|-)(?:\s+(?:billion|million))?\s+([\d,]+)\s+\$\s*([\d,.]+)(?:\s+(billion|million))?\s+\$\s*([\d,.]+)/
const LEAD = /([\d,]+|-)\s*(?:\(\d+\))?\s+\$\s*([\d,.]+|-)(?:\s+(billion|million))?\s+\$\s*([\d,.]+|-)/
const TAIL =
  /Aggregate BTC Holdings[\s\S]{0,240}?([\d,]+)\s+\$\s*([\d,.]+)(?:\s+(billion|million))?\s+\$\s*([\d,.]+)/g
const DASHES = /-\s+-\s+-[\s\S]{0,280}?([\d,]+)\s+\$\s*([\d,.]+)(?:\s+(billion|million))?\s+\$\s*([\d,.]+)/
const PROSE =
  /during the period between ([A-Za-z]+\.?\s+\d{1,2}, \d{4}) and ([A-Za-z]+\.?\s+\d{1,2}, \d{4}),?\s+[\s\S]{0,160}?acquired approximately ([\d,]+) bitcoins? for approximately \$([\d,.]+) (billion|million)[\s\S]{0,700}?average price of approximately \$([\d,]+)[\s\S]{0,700}?As of ([A-Za-z]+\.?\s+\d{1,2}, \d{4})[\s\S]{0,500}?aggregate of approximately ([\d,]+) bitcoins?[\s\S]{0,400}?aggregate purchase price of approximately \$([\d,.]+) (billion|million)[\s\S]{0,250}?average purchase price of approximately \$([\d,]+)/gi

type ParsedRow = Readonly<{
  header: string
  count: number | null
  holdings: number
  averageUsd: number
  aggregateBillions: number
  start: number
  section: string
}>

function asBillions(amount: number, unit: string | undefined): number {
  return unit === 'million' ? amount / 1000 : amount
}

function plausible(holdings: number, averageUsd: number, aggregateBillions: number, count: number | null): boolean {
  if (holdings < 10_000 || holdings > 2_000_000) return false
  if (averageUsd < 1_000 || averageUsd > 500_000) return false
  if (aggregateBillions < 0.5 || aggregateBillions > 500) return false
  return count === null || (count > 0 && count < holdings)
}

function rowFrom(
  countRaw: string,
  holdingsRaw: string,
  averageRaw: string,
  billionsRaw: string,
  billionsUnit: string | undefined,
): Omit<ParsedRow, 'header' | 'start' | 'section'> | null {
  const holdings = parseNumber(holdingsRaw)
  const averageUsd = parseNumber(averageRaw)
  const billions = parseNumber(billionsRaw)
  const count = parseNumber(countRaw)
  if (holdings === null || averageUsd === null || billions === null) return null
  const aggregateBillions = asBillions(billions, billionsUnit)
  if (!plausible(holdings, averageUsd, aggregateBillions, count)) return null
  return { count, holdings, averageUsd, aggregateBillions }
}

function parseTableBody(body: string): Omit<ParsedRow, 'header' | 'start' | 'section'> | null {
  const compact = COMPACT.exec(body)
  if (compact?.[1] && compact[5] && compact[6] && compact[8]) {
    const row = rowFrom(compact[1], compact[5], compact[8], compact[6], compact[7])
    if (row) return row
  }
  const lead = LEAD.exec(body)
  TAIL.lastIndex = 0
  const tails = [...body.matchAll(TAIL)]
  const tail = tails.find((match) => {
    const holdings = parseNumber(match[1])
    return holdings !== null && holdings >= 10_000
  })
  if (lead?.[1] && tail?.[1] && tail[2] && tail[4]) {
    const row = rowFrom(lead[1], tail[1], tail[4], tail[2], tail[3])
    if (row) return row
  }
  const dashes = DASHES.exec(body)
  if (dashes?.[1] && dashes[2] && dashes[4]) {
    return rowFrom('-', dashes[1], dashes[4], dashes[2], dashes[3])
  }
  return null
}

function tableRows(text: string): ParsedRow[] {
  HEADER.lastIndex = 0
  const marks = [...text.matchAll(HEADER)]
  const rows: ParsedRow[] = []
  for (const [index, mark] of marks.entries()) {
    if (mark.index === undefined || !mark[1]) continue
    const start = mark.index
    const end = marks[index + 1]?.index ?? Math.min(text.length, start + 900)
    const section = text.slice(start, end)
    const parsed = parseTableBody(section.slice(mark[0].length))
    if (!parsed) continue
    rows.push({ ...parsed, header: mark[1], start, section })
  }
  return rows
}

function flowOf(header: string, count: number | null): { flowClass: FlowClass; btcDelta: number } {
  if (count === null || count === 0) return { flowClass: 'unchanged', btcDelta: 0 }
  if (header === 'Sold') return { flowClass: 'sell', btcDelta: -count }
  if (header === 'Adjusted') return { flowClass: 'adjustment', btcDelta: -count }
  return { flowClass: 'buy', btcDelta: count }
}

function lastAsOf(text: string): string | null {
  const found = [...text.matchAll(/As of ([A-Za-z]+\.?\s+\d{1,2}, \d{4})/g)]
  const raw = found.at(-1)?.[1]
  return raw ? dateIn(raw) : null
}

function blankFinance(): Pick<
  DisclosureEvent,
  | 'mstrSharesIssued'
  | 'mstrProceedsUsd'
  | 'strcSharesRepurchased'
  | 'strcCostUsd'
  | 'usdReserveUsd'
  | 'usdCashUsd'
> {
  return {
    mstrSharesIssued: null,
    mstrProceedsUsd: null,
    strcSharesRepurchased: null,
    strcCostUsd: null,
    usdReserveUsd: null,
    usdCashUsd: null,
  }
}

function readFinance(text: string): ReturnType<typeof blankFinance> {
  const soldAt = text.indexOf('Shares Sold')
  const btcAt = text.search(/BTC (?:Purchased \/ \(Sold\)|Purchased|Sold|Adjusted|Acquired)\b/)
  const soldBlock = soldAt >= 0 && (btcAt < 0 || soldAt < btcAt) ? text.slice(soldAt, btcAt < 0 ? soldAt + 2500 : btcAt) : ''
  const issued = /MSTR Stock\s+([\d,]+|-)\s+\$\s*([\d,.-]+)\s+\$\s*([\d,.]+)/.exec(soldBlock)
  const repoAt = text.indexOf('Shares Repurchased')
  const repoBlock = repoAt >= 0 ? text.slice(repoAt, repoAt + 900) : ''
  const repurchased = /STRC Stock(?:\s*\(\d+\))?\s+([\d,]+|-)\s+\$\s*([\d,.]+|-)/.exec(repoBlock)
  const reserve = /USD Reserve and USD Cash were \$([0-9.]+) billion and \$([0-9.]+) million/.exec(text)
  const shares = parseNumber(issued?.[1])
  const proceedsMillions = parseNumber(issued?.[3])
  const repoShares = parseNumber(repurchased?.[1])
  const repoMillions = parseNumber(repurchased?.[2])
  return {
    mstrSharesIssued: issued ? (shares ?? 0) : null,
    mstrProceedsUsd: proceedsMillions === null ? null : proceedsMillions * 1_000_000,
    strcSharesRepurchased: repurchased ? (repoShares ?? 0) : null,
    strcCostUsd: repoMillions === null ? null : repoMillions * 1_000_000,
    usdReserveUsd: reserve?.[1] ? Number(reserve[1]) * 1_000_000_000 : null,
    usdCashUsd: reserve?.[2] ? Number(reserve[2]) * 1_000_000 : null,
  }
}

function periodFor(before: string): { start: string | null; end: string | null } {
  const found = [
    ...before.slice(-220).matchAll(/During Period ([A-Za-z]+\.?\s+\d{1,2}, \d{4}) to ([A-Za-z]+\.?\s+\d{1,2}, \d{4})/g),
  ]
  const match = found.at(-1)
  return {
    start: match?.[1] ? dateIn(match[1]) : null,
    end: match?.[2] ? dateIn(match[2]) : null,
  }
}

/** 截止日紧挨着这张表。季报句子里更晚的 As of 不属于这张表。 */
function asOfFor(before: string, section: string): string | null {
  const label = section.indexOf('Aggregate BTC Holdings')
  const window = label >= 0 ? section.slice(0, label) : section.slice(0, 160)
  return lastAsOf(window) ?? lastAsOf(before.slice(-160))
}

function fromTable(
  text: string,
  row: ParsedRow,
  meta: { readonly accession: string; readonly filedOn: string },
): DisclosureEvent {
  const before = text.slice(Math.max(0, row.start - 280), row.start)
  const period = periodFor(before)
  const flow = flowOf(row.header, row.count)
  return {
    accession: meta.accession,
    filedOn: meta.filedOn,
    periodStart: period.start,
    periodEnd: period.end,
    holdingsAsOf: asOfFor(before, row.section),
    ...flow,
    holdings: row.holdings,
    averageUsd: row.averageUsd,
    aggregateBillions: row.aggregateBillions,
    ...blankFinance(),
  }
}

function fromProse(
  match: RegExpMatchArray,
  meta: { readonly accession: string; readonly filedOn: string },
): DisclosureEvent | null {
  const count = parseNumber(match[3])
  const holdings = parseNumber(match[8])
  const averageUsd = parseNumber(match[11])
  const aggregate = parseNumber(match[9])
  if (count === null || holdings === null || averageUsd === null || aggregate === null || !match[10]) return null
  const aggregateBillions = asBillions(aggregate, match[10])
  if (!plausible(holdings, averageUsd, aggregateBillions, count)) return null
  return {
    accession: meta.accession,
    filedOn: meta.filedOn,
    periodStart: match[1] ? dateIn(match[1]) : null,
    periodEnd: match[2] ? dateIn(match[2]) : null,
    holdingsAsOf: match[7] ? dateIn(match[7]) : null,
    btcDelta: count,
    flowClass: 'buy',
    holdings,
    averageUsd,
    aggregateBillions,
    ...blankFinance(),
  }
}

/**
 * 一份 8-K 里可以有两张表：先重述上一周，再给本周。
 * 两张都留下，按持仓截止日分开，避免把两周的变动压成一笔。
 * 增发、回购和美元储备是整份文件的事，只挂在最后一张表上。
 */
export function parseFilingEvents(
  html: string,
  meta: { readonly accession: string; readonly filedOn: string },
): DisclosureEvent[] {
  const text = flattenHtml(html)
  const tables = tableRows(text).map((row) => fromTable(text, row, meta))
  const events: DisclosureEvent[] = [...tables]
  if (events.length === 0) {
    PROSE.lastIndex = 0
    for (const match of text.matchAll(PROSE)) {
      const event = fromProse(match, meta)
      if (event) events.push(event)
    }
  }
  const last = events.at(-1)
  if (!last) return []
  events[events.length - 1] = { ...last, ...readFinance(text) }
  return events
}

export function parseFiling(
  html: string,
  meta: { readonly accession: string; readonly filedOn: string },
): DisclosureEvent | null {
  return parseFilingEvents(html, meta).at(-1) ?? null
}

/** 同一持仓截止日只留最晚提交的那份。重跑不会多出一条。 */
export function collapseEvents(events: readonly DisclosureEvent[]): DisclosureEvent[] {
  const sorted = [...events].sort(
    (a, b) => a.filedOn.localeCompare(b.filedOn) || a.accession.localeCompare(b.accession),
  )
  const byAsOf = new Map<string, DisclosureEvent>()
  for (const event of sorted) {
    const key = event.holdingsAsOf ?? `${event.periodEnd ?? 'none'}:${event.accession}`
    const prev = byAsOf.get(key)
    if (!prev || event.filedOn >= prev.filedOn) byAsOf.set(key, event)
  }
  return [...byAsOf.values()].sort((a, b) => (a.holdingsAsOf ?? '').localeCompare(b.holdingsAsOf ?? ''))
}

export function dateToUtcMidnight(iso: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null
  const ms = Date.parse(`${iso}T00:00:00.000Z`)
  return Number.isNaN(ms) ? null : Math.floor(ms / 1000)
}

export type DisclosurePoint = Readonly<{ ts: number; value: number }>

export type DisclosureSeries = Readonly<{
  holdings: readonly DisclosurePoint[]
  cost: readonly DisclosurePoint[]
  issuance: readonly DisclosurePoint[]
  repurchase: readonly DisclosurePoint[]
  reserve: readonly DisclosurePoint[]
  cash: readonly DisclosurePoint[]
  latest: DisclosureEvent | null
}>

function pushPoint(into: DisclosurePoint[], iso: string | null, value: number | null): void {
  if (iso === null || value === null || !Number.isFinite(value)) return
  const ts = dateToUtcMidnight(iso)
  if (ts === null) return
  const existing = into.findIndex((point) => point.ts === ts)
  if (existing >= 0) into.splice(existing, 1)
  into.push({ ts, value })
}

/** 只在披露给出的日期上落点。没有新披露就不会冒出「今天又交易了」。 */
export function seriesFromEvents(events: readonly DisclosureEvent[]): DisclosureSeries {
  const collapsed = collapseEvents(events)
  const holdings: DisclosurePoint[] = []
  const cost: DisclosurePoint[] = []
  const issuance: DisclosurePoint[] = []
  const repurchase: DisclosurePoint[] = []
  const reserve: DisclosurePoint[] = []
  const cash: DisclosurePoint[] = []
  for (const event of collapsed) {
    pushPoint(holdings, event.holdingsAsOf, event.holdings)
    pushPoint(cost, event.holdingsAsOf, event.averageUsd)
    pushPoint(issuance, event.periodEnd, event.mstrSharesIssued)
    pushPoint(repurchase, event.periodEnd, event.strcSharesRepurchased)
    pushPoint(reserve, event.holdingsAsOf, event.usdReserveUsd)
    pushPoint(cash, event.holdingsAsOf, event.usdCashUsd)
  }
  const sort = (points: DisclosurePoint[]): DisclosurePoint[] => points.sort((a, b) => a.ts - b.ts)
  return {
    holdings: sort(holdings),
    cost: sort(cost),
    issuance: sort(issuance),
    repurchase: sort(repurchase),
    reserve: sort(reserve),
    cash: sort(cash),
    latest: collapsed.at(-1) ?? null,
  }
}
