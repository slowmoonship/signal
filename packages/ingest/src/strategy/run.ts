/**
 * Strategy 采集。
 *
 * 持仓、增发、回购和美元余额来自 SEC 8-K。
 * 股价、mNAV、每股聪数来自公司简报 PDF。
 * BTC 用美股收盘那一小时的 Binance Vision 开盘价，不用 UTC 日均价。
 *
 * 某一路失败就不动那一路已经发布的文件。不把「今天没披露」写成一笔新交易。
 */

import { execFile } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import {
  addCalendarDays,
  betaFromCloses,
  previousSession,
  sessionCloseUtc,
  type MetricModel,
  type SeriesPoint,
} from '@slowmoonship/metrics'

import { publishJson } from '../publish/atomic.js'
import { readPublished } from '../publish/merge.js'
import type { Logger } from '../sources/types.js'
import { consoleLogger } from '../runners/index.js'
import { parseBriefing, type BriefingExtract } from './briefing.js'
import {
  collapseEvents,
  dateToUtcMidnight,
  disclosureRecords,
  parseFilingEvents,
  seriesFromEvents,
  type DisclosureEvent,
} from './filing.js'
import { composeBetaFile, mergedDisclosures, mergedPoints, snapshotFile } from './release.js'

const execFileAsync = promisify(execFile)

const USER_AGENT = 'Signal/0.13 (educational; contact: zuihoudeshenji@live.com)'
const CIK = '0001050446'
const CIK_PATH = '1050446'
const SEC_SUBMISSIONS = `https://data.sec.gov/submissions/CIK${CIK}.json`
const TAPE_FROM = '2024-01-02'
const FILING_FROM = '2020-08-01'

/** 简报 PDF 的地址不是可枚举的目录。只刷新已经核对过的这几份。 */
const BRIEFINGS = [
  'https://assets.contentstack.io/v3/assets/bltf8d808d9b8cebd37/blt36fbde4f9ee6bd70/6acc479043475faf5f2f316c/MSTR_Investor_Briefing_As_of_2026-10-11.pdf',
  'https://assets.contentstack.io/v3/assets/bltf8d808d9b8cebd37/blt36fbde4f9ee6bd70/6ae8102a4ea2fd5ca62f3e51/MSTR_Investor_Briefing_As_of_2026-11-01.pdf',
  'https://assets.contentstack.io/v3/assets/bltf8d808d9b8cebd37/blt36fbde4f9ee6bd70/6afa7fcf5a0d255dea73ad18/MSTR_Investor_Briefing_As_of_2026-11-15.pdf',
] as const

type FetchImpl = typeof fetch

export type StrategyRunOptions = {
  readonly publishDir: string
  readonly dryRun?: boolean
  readonly logger?: Logger
  readonly fetchImpl?: FetchImpl
  readonly now?: Date
}

type FilingRef = {
  readonly accession: string
  readonly filedOn: string
  readonly form: string
  readonly primaryDocument: string
}

type TapePoint = { readonly session: string; readonly ts: number; readonly price: number }

type BriefingPoint = BriefingExtract & { readonly url: string }

function isoToday(now: Date): string {
  return now.toISOString().slice(0, 10)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function getBuffer(url: string, fetchImpl: FetchImpl, timeoutMs: number): Promise<{ status: number; body: Buffer }> {
  const response = await fetchImpl(url, {
    headers: { 'user-agent': USER_AGENT, accept: '*/*' },
    signal: AbortSignal.timeout(timeoutMs),
  })
  return { status: response.status, body: Buffer.from(await response.arrayBuffer()) }
}

function isZip(body: Buffer): boolean {
  return body.length > 4 && body[0] === 0x50 && body[1] === 0x4b
}

function parseKlineCsv(csv: string): Map<number, number> {
  const out = new Map<number, number>()
  for (const line of csv.split('\n')) {
    const [openTime, open] = line.split(',')
    if (!openTime || !open) continue
    let raw = Number(openTime)
    if (!Number.isFinite(raw)) continue
    if (raw > 1e14) raw = Math.floor(raw / 1000)
    const seconds = Math.floor(raw > 1e12 ? raw / 1000 : raw)
    const price = Number(open)
    if (!Number.isFinite(price) || price <= 0) continue
    out.set(seconds, price)
  }
  return out
}

async function unzipCsv(body: Buffer): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'signal-kline-'))
  const file = join(dir, 'klines.zip')
  try {
    writeFileSync(file, body)
    const { stdout } = await execFileAsync('unzip', ['-p', file], {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    })
    return stdout
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

async function readZip(url: string, fetchImpl: FetchImpl): Promise<Map<number, number> | null> {
  const { status, body } = await getBuffer(url, fetchImpl, 60_000)
  if (status === 404) return null
  if (status !== 200 || !isZip(body)) {
    throw new Error(`${url} 返回 ${status}，不是 K 线压缩包`)
  }
  return parseKlineCsv(await unzipCsv(body))
}

function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

async function loadMonth(
  symbol: string,
  year: number,
  month: number,
  today: string,
  fetchImpl: FetchImpl,
  logger: Logger,
): Promise<Map<number, number>> {
  const key = monthKey(year, month)
  const monthly = `https://data.binance.vision/data/spot/monthly/klines/${symbol}/1h/${symbol}-1h-${key}.zip`
  const packed = await readZip(monthly, fetchImpl)
  if (packed) return packed
  const out = new Map<number, number>()
  const last = daysInMonth(year, month)
  for (let day = 1; day <= last; day += 1) {
    const iso = `${key}-${String(day).padStart(2, '0')}`
    if (iso > today) break
    const daily = `https://data.binance.vision/data/spot/daily/klines/${symbol}/1h/${symbol}-1h-${iso}.zip`
    const rows = await readZip(daily, fetchImpl)
    if (!rows) continue
    for (const [ts, price] of rows) out.set(ts, price)
  }
  logger.info(`${symbol} ${key}: 月度文件没有，改用日文件，得到 ${out.size} 根小时线`)
  return out
}

async function loadTape(today: string, fetchImpl: FetchImpl, logger: Logger): Promise<{ points: TapePoint[]; warnings: string[] }> {
  const warnings: string[] = []
  const usdc = new Map<number, number>()
  const start = new Date(`${TAPE_FROM}T00:00:00.000Z`)
  const end = new Date(`${today}T00:00:00.000Z`)
  for (let year = start.getUTCFullYear(); year <= end.getUTCFullYear(); year += 1) {
    const monthFrom = year === start.getUTCFullYear() ? start.getUTCMonth() + 1 : 1
    const monthTo = year === end.getUTCFullYear() ? end.getUTCMonth() + 1 : 12
    for (let month = monthFrom; month <= monthTo; month += 1) {
      const primary = await loadMonth('BTCUSDC', year, month, today, fetchImpl, logger)
      let usedUsdt = false
      let rows = primary
      if (rows.size === 0) {
        rows = await loadMonth('BTCUSDT', year, month, today, fetchImpl, logger)
        usedUsdt = rows.size > 0
      }
      if (usedUsdt) warnings.push(`${monthKey(year, month)} 没有 BTCUSDC，改用了 BTCUSDT。USDT 不是美元。`)
      for (const [ts, price] of rows) if (!usdc.has(ts)) usdc.set(ts, price)
      logger.info(`${monthKey(year, month)}: ${rows.size} 根小时线`)
    }
  }

  const points: TapePoint[] = []
  let cursor: string | null = TAPE_FROM
  while (cursor && cursor <= today) {
    const ts = sessionCloseUtc(cursor)
    if (ts !== null) {
      const price = usdc.get(ts)
      if (price !== undefined) points.push({ session: cursor, ts, price })
    }
    cursor = addCalendarDays(cursor, 1)
  }
  return { points, warnings }
}

function filingUrl(ref: FilingRef): string {
  const accession = ref.accession.replaceAll('-', '')
  return `https://www.sec.gov/Archives/edgar/data/${CIK_PATH}/${accession}/${ref.primaryDocument}`
}

function exhibitNames(raw: unknown): string[] {
  if (typeof raw !== 'object' || raw === null) return []
  const directory = (raw as { directory?: unknown }).directory
  if (typeof directory !== 'object' || directory === null) return []
  const items = (directory as { item?: unknown }).item
  if (!Array.isArray(items)) return []
  const names: string[] = []
  for (const item of items) {
    if (typeof item !== 'object' || item === null) continue
    const name = (item as { name?: unknown }).name
    if (typeof name !== 'string' || !name.toLowerCase().endsWith('.htm')) continue
    if (!/ex99/i.test(name)) continue
    names.push(name)
  }
  return names
    .sort((a, b) => Number(/ex99[^0-9]*1/i.test(b)) - Number(/ex99[^0-9]*1/i.test(a)))
    .slice(0, 3)
}

/** 正文没有持仓时，再读附件 99。购买有时只写在新闻稿里。 */
async function parseExhibits(
  ref: FilingRef,
  meta: { readonly accession: string; readonly filedOn: string },
  fetchImpl: FetchImpl,
): Promise<DisclosureEvent[]> {
  const accession = ref.accession.replaceAll('-', '')
  await sleep(120)
  const index = await getBuffer(
    `https://www.sec.gov/Archives/edgar/data/${CIK_PATH}/${accession}/index.json`,
    fetchImpl,
    60_000,
  )
  if (index.status !== 200) return []
  let names: string[] = []
  try {
    names = exhibitNames(JSON.parse(index.body.toString('utf8')) as unknown)
  } catch {
    return []
  }
  const found: DisclosureEvent[] = []
  for (const name of names) {
    if (name === ref.primaryDocument) continue
    await sleep(120)
    const extra = await getBuffer(
      `https://www.sec.gov/Archives/edgar/data/${CIK_PATH}/${accession}/${name}`,
      fetchImpl,
      60_000,
    )
    if (extra.status !== 200) continue
    found.push(...parseFilingEvents(extra.body.toString('utf8'), meta))
  }
  return found
}

function unknownList(value: unknown): readonly unknown[] | null {
  if (!Array.isArray(value)) return null
  return Array.from(value as readonly unknown[])
}

const FILING_FORMS = new Set(['8-K', '8-K/A', '10-Q', '10-Q/A', '10-K', '10-K/A'])

function recentOf(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== 'object' || raw === null) return null
  const record = raw as Record<string, unknown>
  if (Array.isArray(record['form'])) return record
  const filings = record['filings']
  if (typeof filings !== 'object' || filings === null) return null
  const recent = (filings as { recent?: unknown }).recent
  if (typeof recent !== 'object' || recent === null) return null
  return recent as Record<string, unknown>
}

function readRecent(raw: unknown): FilingRef[] {
  const filings = recentOf(raw)
  if (!filings) return []
  const forms = unknownList(filings['form'])
  const dates = unknownList(filings['filingDate'])
  const accessions = unknownList(filings['accessionNumber'])
  const documents = unknownList(filings['primaryDocument'])
  if (!forms || !dates || !accessions || !documents) return []
  const out: FilingRef[] = []
  for (let i = 0; i < forms.length; i += 1) {
    const form = forms[i]
    const filedOn = dates[i]
    const accession = accessions[i]
    const primaryDocument = documents[i]
    if (typeof form !== 'string' || typeof filedOn !== 'string' || typeof accession !== 'string') continue
    if (typeof primaryDocument !== 'string' || primaryDocument.length === 0) continue
    if (!FILING_FORMS.has(form)) continue
    if (filedOn < FILING_FROM) continue
    out.push({ form, filedOn, accession, primaryDocument })
  }
  return out
}

function olderNames(raw: unknown): string[] {
  if (typeof raw !== 'object' || raw === null) return []
  const files = (raw as { filings?: { files?: unknown } }).filings?.files
  if (!Array.isArray(files)) return []
  return files.flatMap((file) => {
    if (typeof file !== 'object' || file === null) return []
    const name = (file as { name?: unknown }).name
    return typeof name === 'string' ? [name] : []
  })
}

async function loadFilings(fetchImpl: FetchImpl, logger: Logger): Promise<DisclosureEvent[]> {
  const first = await getBuffer(SEC_SUBMISSIONS, fetchImpl, 60_000)
  if (first.status !== 200) throw new Error(`SEC submissions 返回 ${first.status}`)
  const root = JSON.parse(first.body.toString('utf8')) as unknown
  const refs = readRecent(root)
  for (const name of olderNames(root)) {
    await sleep(120)
    const extra = await getBuffer(`https://data.sec.gov/submissions/${name}`, fetchImpl, 60_000)
    if (extra.status !== 200) {
      logger.warn(`SEC ${name} 返回 ${extra.status}，这一段申报先跳过`)
      continue
    }
    refs.push(...readRecent(JSON.parse(extra.body.toString('utf8')) as unknown))
  }
  const seen = new Set<string>()
  const unique = refs.filter((ref) => {
    if (seen.has(ref.accession)) return false
    seen.add(ref.accession)
    return true
  })
  logger.info(`SEC 申报 ${unique.length} 份，自 ${FILING_FROM} 起`)

  const events: DisclosureEvent[] = []
  let cursor = 0
  async function worker(): Promise<void> {
    while (cursor < unique.length) {
      const index = cursor
      cursor += 1
      const ref = unique[index]
      if (!ref) return
      await sleep(150)
      try {
        const response = await getBuffer(filingUrl(ref), fetchImpl, 60_000)
        if (response.status !== 200) {
          logger.warn(`${ref.accession} 返回 ${response.status}`)
          continue
        }
        const meta = { accession: ref.accession, filedOn: ref.filedOn }
        let found = parseFilingEvents(response.body.toString('utf8'), meta)
        if (found.length === 0) found = await parseExhibits(ref, meta, fetchImpl)
        events.push(...found)
      } catch (error) {
        logger.warn(`${ref.accession} 读取失败：${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, unique.length) }, () => worker()))
  return collapseEvents(events)
}

async function loadBriefings(fetchImpl: FetchImpl, logger: Logger): Promise<BriefingPoint[]> {
  const out: BriefingPoint[] = []
  for (const url of BRIEFINGS) {
    const { status, body } = await getBuffer(url, fetchImpl, 60_000)
    if (status !== 200) throw new Error(`${url} 返回 ${status}`)
    const dir = mkdtempSync(join(tmpdir(), 'signal-brief-'))
    const file = join(dir, 'briefing.pdf')
    try {
      writeFileSync(file, body)
      const { stdout } = await execFileAsync('pdftotext', ['-layout', '-enc', 'UTF-8', file, '-'], {
        encoding: 'utf8',
        maxBuffer: 8 * 1024 * 1024,
      })
      const parsed = parseBriefing(stdout)
      if (parsed.price === null || parsed.priceSession === null) {
        logger.warn(`简报没有解析出收盘价：${url}`)
        continue
      }
      out.push({ ...parsed, url })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
  return out
}

function midnight(iso: string | null): number | null {
  if (!iso) return null
  return dateToUtcMidnight(iso)
}

function disclosureModel(event: DisclosureEvent, extra: Partial<MetricModel> = {}): MetricModel {
  return {
    kind: 'disclosure',
    version: 'strategy-8k-v1',
    quality: 'ok',
    ...(event.holdingsAsOf ? { asOf: event.holdingsAsOf } : {}),
    filedOn: event.filedOn,
    ...(event.periodStart ? { periodStart: event.periodStart } : {}),
    ...(event.periodEnd ? { periodEnd: event.periodEnd } : {}),
    accession: event.accession,
    ...(event.flowClass ? { deltaClass: event.flowClass } : {}),
    ...(event.btcDelta !== null ? { btcDelta: event.btcDelta } : {}),
    ...(event.holdings !== null ? { holdings: event.holdings } : {}),
    ...(event.averageUsd !== null ? { averageUsd: event.averageUsd } : {}),
    ...extra,
  }
}

function sessionOnOrBefore(iso: string): string | null {
  if (sessionCloseUtc(iso) !== null) return iso
  return previousSession(iso)
}

function publishIfAny(
  dir: string,
  metricId: string,
  fresh: readonly SeriesPoint[],
  sourceTime: string,
  ingestedAt: string,
  model: MetricModel | undefined,
  warnings: readonly string[],
  dryRun: boolean,
  logger: Logger,
  extra: Record<string, unknown> = {},
): boolean {
  const previous = readPublished(dir, metricId, (message) => logger.warn(message))
  const points = mergedPoints(previous?.points ?? null, fresh)
  if (!points.some((point) => point.value !== null)) {
    logger.warn(`${metricId}: 没有有效点，不发布`)
    return false
  }
  if (dryRun) {
    logger.info(`${metricId}: dry-run，${points.length} 个点`)
    return true
  }
  const publishedExtra = { ...extra }
  if ('disclosures' in publishedExtra) {
    const prior = previous as { disclosures?: unknown } | null
    publishedExtra.disclosures = mergedDisclosures(prior?.disclosures, publishedExtra.disclosures)
  }
  const file = {
    ...snapshotFile(metricId, points, sourceTime, ingestedAt, model, warnings, false),
    ...publishedExtra,
  }
  publishJson(dir, `${metricId}.json`, file)
  logger.info(`${metricId}: 发布 ${points.length} 个点`)
  return true
}

export async function runStrategy(opts: StrategyRunOptions): Promise<number> {
  const logger = opts.logger ?? consoleLogger
  const fetchImpl = opts.fetchImpl ?? fetch
  const now = opts.now ?? new Date()
  const ingestedAt = now.toISOString()
  const today = isoToday(now)
  let failed = false

  let tape: { points: TapePoint[]; warnings: string[] } | null = null
  try {
    tape = await loadTape(today, fetchImpl, logger)
    const latest = tape.points.at(-1)
    if (!latest) throw new Error('没有对齐到任何美股收盘时刻')
    publishIfAny(
      opts.publishDir,
      'btc-price-us-close',
      tape.points.map((point) => ({ ts: point.ts, value: point.price })),
      new Date(latest.ts * 1000).toISOString(),
      ingestedAt,
      {
        kind: 'disclosure',
        version: 'binance-vision-1h-v1',
        quality: 'ok',
        quoteType: 'close',
        sessionDate: latest.session,
        asOf: latest.session,
      },
      tape.warnings,
      opts.dryRun === true,
      logger,
    )
  } catch (error) {
    failed = true
    logger.error(`美股收盘时刻的 BTC 没有更新：${error instanceof Error ? error.message : String(error)}`)
  }

  let briefings: BriefingPoint[] = []
  try {
    briefings = await loadBriefings(fetchImpl, logger)
  } catch (error) {
    failed = true
    logger.error(`简报没有更新：${error instanceof Error ? error.message : String(error)}`)
  }

  const pricePoints: SeriesPoint[] = []
  const mnavPoints: SeriesPoint[] = []
  const bpsPoints: SeriesPoint[] = []
  let latestBrief: BriefingPoint | null = null
  for (const brief of briefings) {
    if (!brief.priceSession || brief.price === null) continue
    const closeTs = sessionCloseUtc(brief.priceSession)
    if (closeTs === null) {
      logger.warn(`${brief.priceSession} 不在纽交所日历里，这份收盘不发布`)
      continue
    }
    pricePoints.push({ ts: closeTs, value: brief.price })
    if (brief.mnav !== null) mnavPoints.push({ ts: closeTs, value: brief.mnav })
    const bpsTs = midnight(brief.holdingsAsOf) ?? midnight(brief.priceSession)
    if (bpsTs !== null && brief.bpsSats !== null) bpsPoints.push({ ts: bpsTs, value: brief.bpsSats })
    if (brief.priceSession && (!latestBrief?.priceSession || brief.priceSession > latestBrief.priceSession)) {
      latestBrief = brief
    }
  }
  const latestSession = latestBrief?.priceSession
  if (latestBrief && latestSession && latestBrief.price !== null) {
    const closeTs = sessionCloseUtc(latestSession)
    publishIfAny(
      opts.publishDir,
      'mstr-price',
      pricePoints,
      closeTs === null ? ingestedAt : new Date(closeTs * 1000).toISOString(),
      ingestedAt,
      {
        kind: 'disclosure',
        version: 'strategy-briefing-v1',
        quality: 'ok',
        quoteType: 'close',
        sessionDate: latestSession,
        asOf: latestSession,
        briefingUrl: latestBrief.url,
      },
      [],
      opts.dryRun === true,
      logger,
    )
    if (mnavPoints.length > 0) {
      publishIfAny(
        opts.publishDir,
        'strategy-mnav',
        mnavPoints,
        closeTs === null ? ingestedAt : new Date(closeTs * 1000).toISOString(),
        ingestedAt,
        {
          kind: 'disclosure',
          version: 'strategy-mnav-disclosed-v1',
          quality: 'ok',
          quoteType: 'close',
          sessionDate: latestSession,
          briefingUrl: latestBrief.url,
        },
        ['这是公司印出来的倍数，不是用市值除以比特币市值重算的。'],
        opts.dryRun === true,
        logger,
      )
    }
    if (bpsPoints.length > 0) {
      publishIfAny(
        opts.publishDir,
        'strategy-btc-per-share',
        bpsPoints,
        midnight(latestBrief.holdingsAsOf) === null
          ? ingestedAt
          : new Date((midnight(latestBrief.holdingsAsOf) ?? 0) * 1000).toISOString(),
        ingestedAt,
        {
          kind: 'disclosure',
          version: 'strategy-bps-stated-v1',
          quality: 'ok',
          asOf: latestBrief.holdingsAsOf ?? latestSession,
          briefingUrl: latestBrief.url,
          ...(latestBrief.bpsSats !== null ? { holdings: latestBrief.bpsSats } : {}),
        },
        ['分母是公司写明的假定稀释股数，不是基本股，也不是本站用旧股数重算的。'],
        opts.dryRun === true,
        logger,
      )
    }
  }

  const tapeBySession = new Map((tape?.points ?? []).map((point) => [point.session, point]))
  const mstrSeries = pricePoints
  const btcSeries = (tape?.points ?? []).map((point) => ({ ts: point.ts, value: point.price }))
  if (briefings.length > 0 && tape) {
    const beta = betaFromCloses(mstrSeries, btcSeries, today)
    const previous = readPublished(opts.publishDir, 'mstr-btc-beta-90d', (message) => logger.warn(message))
    const file = composeBetaFile({
      previous,
      fresh: beta.points,
      quality: beta.assessment.quality,
      formulaReason: beta.assessment.reason,
      samples: beta.latest?.n ?? 0,
      closes: pricePoints.length,
      session: latestBrief?.priceSession ?? null,
      fit: beta.latest,
      ingestedAt,
    })
    if (!opts.dryRun) publishJson(opts.publishDir, 'mstr-btc-beta-90d.json', file)
    logger.info(`mstr-btc-beta-90d: ${file.model?.quality ?? 'unknown'}，收盘 ${pricePoints.length} 个`)
  } else if (!opts.dryRun) {
    logger.warn('弹性倍数本轮不重写：简报或收盘时刻价格没有齐')
  }

  let events: DisclosureEvent[] = []
  try {
    events = await loadFilings(fetchImpl, logger)
  } catch (error) {
    failed = true
    logger.error(`SEC 披露没有更新：${error instanceof Error ? error.message : String(error)}`)
  }
  if (events.length > 0) {
    const series = seriesFromEvents(events)
    const latest = series.latest
    if (latest?.holdingsAsOf && latest.holdings !== null) {
      const asOfTs = midnight(latest.holdingsAsOf)
      publishIfAny(
        opts.publishDir,
        'strategy-btc-holdings',
        series.holdings,
        `${latest.filedOn}T00:00:00.000Z`,
        ingestedAt,
        disclosureModel(latest),
        [],
        opts.dryRun === true,
        logger,
        { disclosures: disclosureRecords(events) },
      )
      const mark = sessionOnOrBefore(latest.holdingsAsOf)
      const marked = mark ? tapeBySession.get(mark) : undefined
      publishIfAny(
        opts.publishDir,
        'strategy-btc-cost',
        series.cost,
        asOfTs === null ? ingestedAt : new Date(asOfTs * 1000).toISOString(),
        ingestedAt,
        disclosureModel(latest, marked ? { marketUsd: marked.price, sessionDate: marked.session } : {}),
        marked ? [] : ['截止日当天或之前的美股收盘价没有对齐上，页面只显示披露均价。'],
        opts.dryRun === true,
        logger,
      )
      if (marked && latest.averageUsd !== null) {
        const unrealized: SeriesPoint[] = []
        for (const holding of series.holdings) {
          const cost = series.cost.find((point) => point.ts === holding.ts)
          const asOf = new Date(holding.ts * 1000).toISOString().slice(0, 10)
          const session = sessionOnOrBefore(asOf)
          const price = session ? tapeBySession.get(session) : undefined
          if (!cost || !price) continue
          const pnl = holding.value * (price.price - cost.value)
          unrealized.push({ ts: holding.ts, value: Math.round(pnl * 100) / 100 })
        }
        publishIfAny(
          opts.publishDir,
          'strategy-btc-unrealized',
          unrealized,
          asOfTs === null ? ingestedAt : new Date(asOfTs * 1000).toISOString(),
          ingestedAt,
          disclosureModel(latest, { marketUsd: marked.price, sessionDate: marked.session, averageUsd: latest.averageUsd }),
          ['市价是持仓截止日当天或之前最后一个美股收盘时刻的 BTC，不是 UTC 日均价。'],
          opts.dryRun === true,
          logger,
        )
      }
    }
    publishFlow(opts, 'mstr-common-issuance', series.issuance, events, 'periodEnd', ingestedAt, logger)
    publishFlow(opts, 'strc-repurchase', series.repurchase, events, 'periodEnd', ingestedAt, logger)
    publishFlow(opts, 'strategy-usd-reserve', series.reserve, events, 'holdingsAsOf', ingestedAt, logger)
    publishFlow(opts, 'strategy-usd-cash', series.cash, events, 'holdingsAsOf', ingestedAt, logger)
    if (latestBrief?.holdings !== null && latestBrief?.holdings !== undefined && series.latest?.holdings !== null) {
      if (latestBrief.holdings !== series.latest?.holdings) {
        logger.warn(`简报持仓 ${latestBrief.holdings} 与 8-K ${series.latest?.holdings} 不一致，页面采用 8-K`)
      }
    }
  }

  return failed ? 1 : 0
}

function publishFlow(
  opts: StrategyRunOptions,
  metricId: string,
  points: readonly SeriesPoint[],
  events: readonly DisclosureEvent[],
  field: 'periodEnd' | 'holdingsAsOf',
  ingestedAt: string,
  logger: Logger,
): void {
  const latestPoint = points.at(-1)
  if (!latestPoint) return
  const iso = new Date(latestPoint.ts * 1000).toISOString().slice(0, 10)
  const event = [...events].reverse().find((item) => item[field] === iso) ?? events.at(-1)
  if (!event) return
  const proceeds =
    metricId === 'strc-repurchase' ? event.strcCostUsd : metricId === 'mstr-common-issuance' ? event.mstrProceedsUsd : null
  publishIfAny(
    opts.publishDir,
    metricId,
    points,
    `${event.filedOn}T00:00:00.000Z`,
    ingestedAt,
    disclosureModel(event, proceeds !== null ? { proceedsUsd: proceeds } : {}),
    [],
    opts.dryRun === true,
    logger,
  )
}
