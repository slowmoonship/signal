/**
 * mempool.space 适配器。
 *
 * ⚠️ 实测（2026-10-19）：
 * - `/api/v1/charts/*` 整组已下线 404 → 算力历史改用 `/api/v1/mining/hashrate/{period}`
 * - `period` 只接受 1m / 3m / 1y / all；`1d`、`7d` 会被**忽略**并返回全量
 * - 日更场景取 `1y`（365 个日级点，约 25KB）最合适，且漏跑数日后下次仍能补齐
 */

import {
  herfindahlIndex,
  LABEL_SEMANTICS,
  toUtcSecondsBrand,
  type LabelConfidence,
  type MetricContract,
  type Point,
  type SourceRef,
} from '@slowmoonship/metrics'
import {
  AdapterError,
  type AdapterRequest,
  type FetchContext,
  type RawSeries,
  type SourceAdapter,
} from './types.js'
import { fetchJson } from './http.js'

const BASE = 'https://mempool.space'
const PROVIDER = 'mempool.space'

/** 未声明时的默认标注可信度：客观统计类指标（不涉及任何实体标注）才是 verified */
const DEFAULT_LABEL_CONFIDENCE: LabelConfidence = 'verified'

type Spec = {
  path: (p: string) => string
  contract: MetricContract
  /**
   * 该指标依赖的实体标注可信度。
   *
   * 只有不涉及交易所 / 巨鲸 / 矿池 / 矿工标注的指标才可默认 'verified'；
   * 依赖矿池归属等启发式聚类的必须显式写 'heuristic'（CLAUDE.md 红线 6）。
   */
  labelConfidence?: LabelConfidence
}

/** 本适配器认识的指标（与 Coin Metrics 的指标名空间不同，用带前缀的名字避免混淆） */
const SPECS = {
  'mempool.HashRate': {
    path: (p: string) => `/api/v1/mining/hashrate/${p}`,
    contract: {
      unit: 'hashrate',
      scale: 1,
      aggregation: 'mean',
      window: 'calendar-day-utc',
      labelSemantics: LABEL_SEMANTICS.none,
    } satisfies MetricContract,
  },
  'mempool.Difficulty': {
    path: () => '/api/v1/difficulty-adjustment',
    contract: {
      unit: 'index',
      scale: 1,
      aggregation: 'last',
      window: 'point',
      labelSemantics: LABEL_SEMANTICS.none,
    } satisfies MetricContract,
  },
  'mempool.TipHeight': {
    path: () => '/api/blocks/tip/height',
    contract: {
      unit: 'blocks',
      scale: 1,
      aggregation: 'last',
      window: 'point',
      labelSemantics: LABEL_SEMANTICS.none,
    } satisfies MetricContract,
  },
  'mempool.RecommendedFee': {
    path: () => '/api/v1/fees/recommended',
    contract: {
      unit: 'sat_per_vbyte',
      scale: 1,
      aggregation: 'last',
      window: 'point',
      labelSemantics: LABEL_SEMANTICS.none,
    } satisfies MetricContract,
  },
  'mempool.PoolConcentration': {
    path: () => '/api/v1/mining/pools/1m',
    contract: {
      unit: 'index',
      scale: 1,
      aggregation: 'last',
      window: 'point',
      labelSemantics: LABEL_SEMANTICS.poolAttribution,
    } satisfies MetricContract,
    // 矿池归属来自 coinbase 交易里的矿工自述标签，是 mempool.space 的启发式聚类，
    // 不是链上可验证的事实，因此不能标 verified（CLAUDE.md 红线 6）。
    labelConfidence: 'heuristic',
  },
} as const satisfies Record<string, Spec>

type SpecName = keyof typeof SPECS

/** 日更取 1y：日级粒度、覆盖广、体积可控 */
const HASHRATE_PERIOD = '1y'

/** 解析结果。标注可信度由 spec 决定，解析器不关心。 */
type Parsed = {
  readonly points: readonly Point[]
  readonly sourceTime: string
  readonly warnings: readonly string[]
}

function labelConfidenceOf(spec: Spec): LabelConfidence {
  return spec.labelConfidence ?? DEFAULT_LABEL_CONFIDENCE
}

export class MempoolAdapter implements SourceAdapter {
  readonly provider = PROVIDER
  readonly auth = 'none' as const

  supports(req: Pick<AdapterRequest, 'asset' | 'metric'>): boolean {
    return req.metric.startsWith('mempool.') && req.metric in SPECS
  }

  contractFor(req: Pick<AdapterRequest, 'asset' | 'metric'>): MetricContract {
    const spec = SPECS[req.metric as SpecName]
    if (!spec) throw new AdapterError(PROVIDER, req.metric, '未登记口径')
    return spec.contract
  }

  sourceRef(req: AdapterRequest): SourceRef {
    // 未登记的指标名在这里也会被直接查表，缺了这道守卫就是一个 TypeError，
    // 读起来完全不像"这个适配器不提供该指标"
    const spec = SPECS[req.metric as SpecName]
    if (!spec) throw new AdapterError(PROVIDER, req.metric, '未登记口径')
    return {
      provider: PROVIDER,
      metric: req.metric,
      endpoint: `${BASE}${spec.path(HASHRATE_PERIOD)}`,
      auth: this.auth,
      labelConfidence: labelConfidenceOf(spec),
    }
  }

  async fetch(req: AdapterRequest, ctx: FetchContext): Promise<RawSeries> {
    const name = req.metric as SpecName
    const spec = SPECS[name]
    if (!spec) throw new AdapterError(PROVIDER, req.metric, '未登记口径')

    const url = `${BASE}${spec.path(HASHRATE_PERIOD)}`
    const body = await fetchJson<unknown>(url, ctx, { provider: PROVIDER, metric: req.metric })

    const nowSec = Math.floor(ctx.now() / 1000)
    const parsed = this.#parse(name, req.metric, body, nowSec)
    return {
      contract: spec.contract,
      labelConfidence: labelConfidenceOf(spec),
      points: parsed.points,
      sourceTime: parsed.sourceTime,
      warnings: parsed.warnings,
    }
  }

  #parse(name: SpecName, metric: string, body: unknown, nowSec: number): Parsed {
    switch (name) {
      case 'mempool.HashRate': {
        const rows = (body as { hashrates?: { timestamp: number; avgHashrate: number }[] })
          .hashrates
        if (!rows?.length) throw new AdapterError(PROVIDER, metric, '返回空序列')
        const points = rows.map((r) => ({
          ts: toUtcSecondsBrand(r.timestamp),
          value: Number.isFinite(r.avgHashrate) ? r.avgHashrate : null,
        }))
        return finish(points, PROVIDER, metric)
      }
      case 'mempool.Difficulty': {
        const row = body as { difficultyChange?: number; progressPercent?: number }
        if (typeof row.difficultyChange !== 'number') {
          throw new AdapterError(PROVIDER, metric, '响应缺少 difficultyChange')
        }
        // 接口不直接给当前难度，只给"下次调整百分比"。以进度线性折算当前值不可靠，
        // 因此这里如实返回 null 而非编造一个数——宁可缺数据，不可造数据。
        const points: Point[] = [{ ts: toUtcSecondsBrand(nowSec), value: null }]
        return {
          points,
          sourceTime: new Date(nowSec * 1000).toISOString(),
          warnings: [
            `接口仅提供下次难度调整百分比（${row.difficultyChange.toFixed(2)}%），` +
              `未提供当前难度绝对值；当前难度应改由 Blockstream 区块头提供（见 blockstream.ts）`,
          ],
        }
      }
      case 'mempool.TipHeight': {
        const height = Number(body)
        if (!Number.isFinite(height)) throw new AdapterError(PROVIDER, metric, '高度不可解析')
        return {
          points: [{ ts: toUtcSecondsBrand(nowSec), value: height }],
          sourceTime: new Date(nowSec * 1000).toISOString(),
          warnings: [],
        }
      }
      case 'mempool.RecommendedFee': {
        const row = body as { hourFee?: number }
        if (typeof row.hourFee !== 'number') {
          throw new AdapterError(PROVIDER, metric, '响应缺少 hourFee')
        }
        return {
          points: [{ ts: toUtcSecondsBrand(nowSec), value: row.hourFee }],
          sourceTime: new Date(nowSec * 1000).toISOString(),
          warnings: [],
        }
      }
      case 'mempool.PoolConcentration': {
        const raw = (body as { pools?: unknown }).pools
        const rows: readonly { blockCount?: unknown }[] = Array.isArray(raw)
          ? (raw as readonly { blockCount?: unknown }[])
          : []
        const warnings: string[] = []
        if (!Array.isArray(raw)) {
          warnings.push('响应缺少 pools 数组，无法计算矿池集中度')
        }

        // blockCount 缺失/非法不能按 0 计入：0 是一个合法份额，会把 HHI 悄悄算低。
        // 直接丢弃并如实报告丢了多少。
        const counts: number[] = []
        let dropped = 0
        for (const row of rows) {
          const bc = row?.blockCount
          if (typeof bc !== 'number' || !Number.isFinite(bc) || bc < 0) {
            dropped += 1
            continue
          }
          counts.push(bc)
        }
        if (dropped > 0) {
          warnings.push(
            `丢弃 ${dropped} 个 blockCount 缺失 / 非有限 / 为负的矿池，未按 0 计入份额`,
          )
        }

        const total = counts.reduce((a, b) => a + b, 0)
        // 无矿池或总区块数为 0 时没有任何份额可言，如实记 null（红线 1：缺失绝不填零）
        const hhi = total > 0 ? herfindahlIndex(counts.map((c) => c / total)) : null
        if (hhi === null) {
          warnings.push('矿池区块总数为 0，集中度无定义，记为 null 而非 0')
        }

        // 上游 1m 窗口每次调用都重算，没有可比对的区块时间戳，
        // 因此只有"采集时刻"这一个点，sourceTime 即采集时刻。
        return {
          points: [{ ts: toUtcSecondsBrand(nowSec), value: hhi }],
          sourceTime: new Date(nowSec * 1000).toISOString(),
          warnings,
        }
      }
    }
  }
}

function finish(
  points: readonly Point[],
  provider: string,
  metric: string,
): Parsed {
  if (points.length === 0) throw new AdapterError(provider, metric, '返回空序列')
  const sorted = [...points].sort((a, b) => a.ts - b.ts)
  const latest = sorted[sorted.length - 1]
  if (!latest) throw new AdapterError(provider, metric, '返回空序列')
  const missing = sorted.filter((p) => p.value === null).length
  return {
    points: sorted,
    sourceTime: new Date(latest.ts * 1000).toISOString(),
    warnings: missing > 0 ? [`${missing} 个时间点上游无数据（保留为 null，未填充）`] : [],
  }
}
