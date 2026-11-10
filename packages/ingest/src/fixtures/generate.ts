/**
 * Fixture 生成器 —— **开发与测试专用**。
 *
 * 存在的理由：Phase 1 还没有真实数据，但页面、数值格式化、空值处理、
 * 明暗主题都必须先跑起来看到东西。用 fixture 比用"临时硬编码"安全得多，
 * 因为它是数据源、格式、缺失语义都与线上一致的**同一套代码**。
 *
 * 三条不可让步的约束：
 * 1. 每个文件带 `fixture: true`，页面读到必须显示"非真实市场数据"。
 * 2. 只能写进 fixtures 目录；写向 `public/data` 直接抛错。
 * 3. 完全确定：同样的参数产出同样的字节，便于测试断言与截图比对。
 *
 * 数值本身是合成的（趋势 + 确定性噪声），**不对应任何真实市场行情**。
 */

import { join } from 'node:path'

import {
  herfindahlIndex,
  maxDcaWaitSeries,
  percentChangeSeries,
  registry,
  subtractSeries,
  toUtcSecondsBrand,
  type MetricDefinition,
  type Point,
  type PublishedMetric,
  type UtcSeconds,
} from '@slowmoonship/metrics'

import { publishJson } from '../publish/atomic.js'
import { REPO_ROOT, publishDir } from '../paths.js'

const DAY_SECONDS = 86_400
const GENESIS = Date.UTC(2009, 0, 3)

/**
 * 目标出块间隔 10 分钟，一天 144 个块。
 *
 * fixture 里所有与"补贴 / 出块"有关的量都必须乘它，否则供应量、矿工收入、
 * 减半高度会互相矛盾——而跨指标矛盾最容易被当成代码 bug 排查半天。
 * 真实网络一天可能是 143 或 145 个块；fixture 取 144 是为了让
 * 减半日与年化估算保持整数关系。
 */
const BLOCKS_PER_DAY = 144

/** 减半生效日（UTC 00:00）。索引 i 对应减半前每块补贴 */
const HALVINGS: readonly { readonly at: number; readonly before: number }[] = [
  { at: Date.UTC(2012, 10, 28), before: 50 },
  { at: Date.UTC(2016, 6, 9), before: 25 },
  { at: Date.UTC(2020, 4, 11), before: 12.5 },
  { at: Date.UTC(2024, 3, 20), before: 6.25 },
  { at: Date.UTC(2028, 3, 15), before: 3.125 },
]

function subsidyAt(dayStartMs: number): number {
  for (const h of HALVINGS) {
    if (dayStartMs < h.at) return h.before
  }
  return 1.5625
}

/**
 * 按真实减半计划累积流通量。
 *
 * 用真实协议逻辑而不是随机数，是为了让"市值 = 价格 × 流通量"这类
 * 跨指标关系在 fixture 里也自洽——否则页面上的矛盾会让人误以为是 bug。
 */
function buildSupplySeries(dayStartMs: number[]): number[] {
  const out: number[] = []
  let accumulated = 0
  let cursor = GENESIS
  let subsidy = subsidyAt(GENESIS)
  // 下一个减半生效时刻（毫秒）。必须是函数内的局部量：
  // 放在模块级会让第二次调用接着上次的进度走，结果不可复现。
  let nextHalvingAt = HALVINGS[0]?.at ?? Number.POSITIVE_INFINITY
  for (const day of dayStartMs) {
    while (cursor < day) {
      // cursor 与 day 都是**毫秒**。这里若按秒步进，循环会多跑 1000 倍，
      // 供应量虚增到 3 亿 BTC —— 一个没人会信的假数字。
      if (cursor >= nextHalvingAt) {
        subsidy = subsidyAt(cursor)
        nextHalvingAt = HALVINGS.find((h) => h.at > cursor)?.at ?? Number.POSITIVE_INFINITY
      }
      // 每轮是一天，而一天约出 144 个块：补贴要乘块数，否则供应量会少 144 倍
      accumulated += subsidy * BLOCKS_PER_DAY
      cursor += DAY_SECONDS * 1000
    }
    out.push(accumulated)
  }
  return out
}

/** mulberry32：小、快、确定。同一 seed 永远给同一串数。 */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function seedFrom(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

const round = (v: number, digits: number): number => {
  const f = 10 ** digits
  return Math.round(v * f) / f
}

export type FixtureOptions = {
  /** 最后一个数据日（YYYY-MM-DD，UTC） */
  readonly endDate: string
  /** 历史点数（天） */
  readonly days: number
  /** 输出目录。必须是 fixtures 目录，不允许指向发布目录。 */
  readonly outDir: string
}

export const FIXTURE_DIR = join(REPO_ROOT, 'fixtures/btc')

/**
 * 快照里的告警文本是**数据层**的，不随页面语言变化
 * （页面文案在 `@/i18n/dictionaries`）。因此它必须保持语言中立、可被程序识别，
 * 中文写进英文页面会让人以为翻错了站点。
 */
const FIXTURE_WARNING =
  '[fixture] synthetic data from `npm run fixtures:btc` — not real market data.'
const FIXTURE_STALE_WARNING =
  '[fixture] simulated ingest failure: the previous snapshot was kept and marked stale.'

/** 把合成序列写成 `Point[]`，`ts` 为 UTC 纪元秒。 */
function points(values: readonly (number | null)[], dayStartMs: readonly number[]): Point[] {
  return values.map((value, i) => ({
    ts: toUtcSecondsBrand(Math.floor((dayStartMs[i] ?? GENESIS) / 1000)),
    value: value === null || !Number.isFinite(value) ? null : value,
  }))
}

/** 在指定下标处挖洞（缺失），并返回一个 copy。用来验证 null 在页面上的表现。 */
function punchHoles(values: readonly number[], holes: readonly number[]): (number | null)[] {
  const out: (number | null)[] = [...values]
  for (const i of holes) {
    if (i >= 0 && i < out.length) out[i] = null
  }
  return out
}

function at<T>(list: readonly T[], i: number): T {
  const v = list[i]
  if (v === undefined) throw new Error(`fixture 索引越界：${i} / ${list.length}`)
  return v
}

export function generateFixtures(opts: FixtureOptions): Map<string, PublishedMetric> {
  assertFixtureTarget(opts.outDir)

  const endMs = Date.parse(`${opts.endDate}T00:00:00Z`)
  if (Number.isNaN(endMs)) throw new Error(`fixture 结束日期无法解析：${opts.endDate}`)

  const days = opts.days
  // 天轴一律按毫秒推进。DAY_SECONDS 出现在这里要乘 1000，
  // 否则 400 个"天"会挤在 10 小时内，整条序列塌成一天。
  const dayStartMs = Array.from(
    { length: days },
    (_, i) => endMs - (days - 1 - i) * DAY_SECONDS * 1000,
  )

  const supply = buildSupplySeries(dayStartMs)
  const priceNoise = rng(seedFrom('price'))
  const price = dayStartMs.map((_, i) => {
    const t = i / Math.max(1, days - 1)
    const cycle = 1 + 0.34 * Math.sin(t * Math.PI * 1.7) + 0.14 * Math.sin(t * Math.PI * 5.3)
    const noise = 1 + (priceNoise() - 0.5) * 0.06
    return round(64_000 * cycle * noise, 2)
  })

  const txNoise = rng(seedFrom('tx-count'))
  const txCount = dayStartMs.map((_, i) => {
    const t = i / Math.max(1, days - 1)
    const cycle = 1 + 0.28 * Math.sin(t * Math.PI * 2.1 + 0.6)
    return Math.max(0, Math.round(520_000 * cycle * (1 + (txNoise() - 0.5) * 0.12)))
  })

  const activeAddresses = txCount.map((tx, i) =>
    Math.round(tx * (0.66 + 0.06 * Math.sin(i / 37)) + 4_000),
  )

  // 出块数围绕 144 波动：偶尔少一个，偶尔多一个（真实网络不会每天恰好 144）
  const blockCount = dayStartMs.map((_, i) => 143 + Math.round(rng(seedFrom(`blk${i}`))() * 3))

  const feeNoise = rng(seedFrom('fees'))
  const feesTotal = dayStartMs.map((_, i) => {
    const load = txCount[i] ?? 520_000
    return round((6 + (load / 520_000) * 26) * (1 + (feeNoise() - 0.5) * 0.35), 4)
  })

  const dailySubsidy = round(subsidyAt(endMs) * BLOCKS_PER_DAY, 8)
  const minerRevenue = dayStartMs.map(() => dailySubsidy)
  const minerRevenueUsd = dayStartMs.map((_, i) => round(dailySubsidy * at(price, i), 2))
  const marketCap = dayStartMs.map((_, i) => round(at(supply, i) * at(price, i), 2))

  // 交易所流量：流入与流出各自带噪声，净流入由 derive 相减得到
  const inNoise = rng(seedFrom('FlowInExNtv'))
  const outNoise = rng(seedFrom('FlowOutExNtv'))
  const flowIn = dayStartMs.map(() => round(1_800 * (1 + (inNoise() - 0.5) * 0.8), 4))
  const flowOut = dayStartMs.map(() => round(1_700 * (1 + (outNoise() - 0.5) * 0.8), 4))

  let balance = 2_650_000
  const netflow: (number | null)[] = subtractSeries(
    points(flowIn, dayStartMs),
    points(flowOut, dayStartMs),
  ).map((p) => (p.value === null ? null : round(p.value, 4)))
  const exchangeBalance = netflow.map((v) => {
    balance -= v ?? 0
    return round(balance, 2)
  })

  const hashNoise = rng(seedFrom('hashrate'))
  const hashrate = dayStartMs.map((_, i) => {
    const t = i / Math.max(1, days - 1)
    const growth = 5.2e19 * Math.exp(t * 1.9)
    const step = 1 + 0.06 * Math.sin((i / 14) * Math.PI) // 每 14 天一次难度台阶的影子
    return round(growth * step * (1 + (hashNoise() - 0.5) * 0.05), 0)
  })

  // MVRV（流通市值 / 已实现市值）：比值，1 附近是常态。
  // 形状与价格周期同源，但幅度不同——它是"贵不贵"，不是"涨没涨"。
  const mvrv = dayStartMs.map((_, i) => {
    const t = i / Math.max(1, days - 1)
    return round(1.05 + 0.65 * (0.5 + 0.5 * Math.sin(t * Math.PI * 1.7 + 0.4)), 2)
  })

  const series: Record<string, (number | null)[]> = {
    price,
    'market-cap': marketCap,
    supply,
    'price-change-7d': percentChangeSeries(points(price, dayStartMs), 7).map((p) =>
      p.value === null ? null : round(p.value, 6),
    ),
    // 挖洞：缺失必须是 null，不能是 0。页面要能画断线。
    'active-addresses': punchHoles(activeAddresses, [12, 47, 180]),
    'tx-count': punchHoles(txCount, [205]),
    'block-count': blockCount,
    // 故意让第 91 天恰好为 0：页面必须把"真的是零"与"没有数据"显示成两回事
    'exchange-netflow': netflow.map((v, i) => (i === 91 ? 0 : v)),
    'exchange-balance': exchangeBalance,
    'fees-total': punchHoles(feesTotal, [63, 64]),
    'miner-revenue': minerRevenue,
    'miner-revenue-usd': minerRevenueUsd,
    hashrate,
    mvrv,
  }

  // 时点类指标：每日只采一次样，因此只有一个点。
  // 这正是"历史自采集之日起累积"的含义，页面必须照实显示。
  const tipTs = toUtcSecondsBrand(Math.floor(endMs / 1000))
  const difficultyValue = Math.round(9.4e13 * (1 + 0.5 * Math.sin(days / 30)))
  const hhiShares = [0.31, 0.19, 0.13, 0.09, 0.07, 0.05, 0.04, 0.03, 0.025, 0.015, 0.01, 0.005]

  const pointMetrics: Record<string, number> = {
    difficulty: difficultyValue,
    'recommended-fee-rate': Math.max(1, Math.round(6 + 9 * (0.5 + 0.5 * Math.sin(days / 11)))),
    'block-tx-count': 2_800 + Math.round(1_400 * (0.5 + 0.5 * Math.sin(days / 9))),
    'block-weight': 3_950_000 + Math.round(40_000 * (0.5 + 0.5 * Math.sin(days / 5))),
    'pool-concentration': Math.round(herfindahlIndex(hhiShares) ?? 0),
  }

  // 价格序列的"点"形态（带时间戳），供定投回测使用
  const pricePoints = points(price, dayStartMs)

  const out = new Map<string, PublishedMetric>()
  for (const def of registry.byAsset('btc')) {
    const seriesValues = series[def.id]
    const pointValue: number | undefined = pointMetrics[def.id]
    const dca = dcaOf(def, pricePoints)
    if (!seriesValues && pointValue === undefined && !dca) {
      throw new Error(`fixture 未覆盖指标 "${def.id}"：既不在序列表也不在时点表`)
    }

    const data: Point[] = dca
      ? dca.points
      : seriesValues
        ? points(seriesValues, dayStartMs)
        : [{ ts: tipTs, value: pointValue ?? null }]

    out.set(def.id, buildFixtureFile(def, data, tipTs, dca))
  }
  return out
}

/**
 * 定投等待期的 fixture 值。
 *
 * 用**定义里的**阈值与窗口算，而不是在 fixture 里另写一份参数：
 * 口径只该有一个出处。定义改了就跟着改，fixture 不会变成另一个指标。
 *
 * 价格历史必须够长（窗口 3650 天），否则回测根本跑不起来——
 * `maxDcaWaitSeries` 在历史不足时返回空序列，而不是给一个假的数。
 */
function dcaOf(
  def: MetricDefinition,
  pricePoints: readonly Point[],
): {
  readonly points: Point[]
  readonly coverage: { included: number; censored: number; invalidated: number }
  readonly worstCase: NonNullable<PublishedMetric['worstCase']> | null
  readonly distribution: NonNullable<PublishedMetric['distribution']> | null
} | null {
  const derivation = def.derivation
  if (!derivation || derivation.kind !== 'dcaMaxWait') return null

  const priceDef = registry.get(derivation.base)
  if (priceDef.id !== 'price') return null

  const result = maxDcaWaitSeries(
    pricePoints,
    derivation.thresholdPercent,
    derivation.windowDays,
  )
  // 历史不足窗口时回测给不出任何结果——如实留空，而不是编一个数
  if (result.series.length === 0) return null
  return {
    points: result.series.map((p) => ({ ts: toUtcSecondsBrand(p.ts), value: p.value })),
    coverage: result.coverage,
    worstCase: result.worstCase,
    distribution: result.distribution,
  }
}

function buildFixtureFile(
  def: MetricDefinition,
  data: readonly Point[],
  tipTs: UtcSeconds,
  dca?: {
    readonly points: Point[]
    readonly coverage: { included: number; censored: number; invalidated: number }
    readonly worstCase: NonNullable<PublishedMetric['worstCase']> | null
    readonly distribution: NonNullable<PublishedMetric['distribution']> | null
  } | null,
): PublishedMetric {
  // 模拟一次采集失败：难度当天没抓到，但**上一份数据仍在**（stale 只是标记）
  const stale = def.id === 'difficulty'
  return {
    metricId: def.id,
    asset: def.asset,
    contract: def.contract,
    points: data,
    sourceTime: new Date(tipTs * 1000).toISOString(),
    ingestedAt: new Date(tipTs * 1000 + 6 * 3_600_000).toISOString(),
    stale,
    sources: def.sources,
    warnings: [
      FIXTURE_WARNING,
      ...(stale ? [FIXTURE_STALE_WARNING] : []),
    ],
    fixture: true,
    ...(dca?.coverage ? { coverage: dca.coverage } : {}),
    ...(dca?.worstCase ? { worstCase: dca.worstCase } : {}),
    ...(dca?.distribution ? { distribution: dca.distribution } : {}),
  }
}

/** 拒绝把 fixture 写进发布目录。红线：fixture 不得冒充真实市场数据。 */
export function assertFixtureTarget(dir: string): void {
  const normalized = dir.replace(/\/+$/, '')
  const forbidden = publishDir().replace(/\/+$/, '')
  if (normalized === forbidden || normalized.startsWith(`${forbidden}/`)) {
    throw new Error(
      `拒绝把 fixture 写入发布目录 ${normalized}。` +
        `fixture 是合成数据，只能写到 fixtures/ 下。`,
    )
  }
}

export { FIXTURE_WARNING }

/** 把生成结果原子写入目录。目标目录的守卫在 generate 阶段已执行过一次。 */
export function writeFixtures(
  files: ReadonlyMap<string, PublishedMetric>,
  dir: string,
): number {
  assertFixtureTarget(dir)
  let bytes = 0
  for (const [id, file] of files) {
    bytes += publishJson(dir, `${id}.json`, file).bytes
  }
  return bytes
}

/** 供 CLI 打印用：按分类列出 fixture 覆盖情况 */
export function fixtureSummary(files: ReadonlyMap<string, PublishedMetric>): string {
  const lines: string[] = []
  for (const group of registry.grouped('btc')) {
    const ids = group.metrics.map((m) => m.id).filter((id) => files.has(id))
    lines.push(`  ${group.category} (${ids.length}): ${ids.join(', ')}`)
  }
  return lines.join('\n')
}
