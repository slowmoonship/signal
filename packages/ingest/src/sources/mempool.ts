/**
 * mempool.space 适配器。
 *
 * ⚠️ 实测（2026-10-19）：
 * - `/api/v1/charts/*` 整组已下线 404 → 算力历史改用 `/api/v1/mining/hashrate/{period}`
 * - `period` 只接受 1m / 3m / 1y / all；`1d`、`7d` 会被**忽略**并返回全量
 * - 日更场景取 `1y`（365 个日级点，约 25KB）最合适，且漏跑数日后下次仍能补齐
 */

import {
  toUtcSecondsBrand,
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
const PROVIDER = 'mempool'

/** 本适配器认识的指标（与 Coin Metrics 的指标名空间不同，用带前缀的名字避免混淆） */
const SPECS = {
  'mempool.HashRate': {
    path: (p: string) => `/api/v1/mining/hashrate/${p}`,
    contract: {
      unit: 'hashrate',
      scale: 1,
      aggregation: 'mean',
      window: 'calendar-day-utc',
      labelSemantics: 'n/a',
    } satisfies MetricContract,
  },
  'mempool.Difficulty': {
    path: () => '/api/v1/difficulty-adjustment',
    contract: {
      unit: 'index',
      scale: 1,
      aggregation: 'last',
      window: 'point',
      labelSemantics: 'n/a',
    } satisfies MetricContract,
  },
  'mempool.TipHeight': {
    path: () => '/api/blocks/tip/height',
    contract: {
      unit: 'blocks',
      scale: 1,
      aggregation: 'last',
      window: 'point',
      labelSemantics: 'n/a',
    } satisfies MetricContract,
  },
  'mempool.RecommendedFee': {
    path: () => '/api/v1/fees/recommended',
    contract: {
      unit: 'sat_per_vbyte',
      scale: 1,
      aggregation: 'last',
      window: 'point',
      labelSemantics: 'n/a',
    } satisfies MetricContract,
  },
} as const

type SpecName = keyof typeof SPECS

/** 日更取 1y：日级粒度、覆盖广、体积可控 */
const HASHRATE_PERIOD = '1y'

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
    return {
      provider: PROVIDER,
      metric: req.metric,
      endpoint: `${BASE}${SPECS[req.metric as SpecName].path(HASHRATE_PERIOD)}`,
      auth: this.auth,
      labelConfidence: 'verified',
    }
  }

  async fetch(req: AdapterRequest, ctx: FetchContext): Promise<RawSeries> {
    const name = req.metric as SpecName
    const spec = SPECS[name]
    if (!spec) throw new AdapterError(PROVIDER, req.metric, '未登记口径')

    const url = `${BASE}${spec.path(HASHRATE_PERIOD)}`
    const body = await fetchJson<unknown>(url, ctx, { provider: PROVIDER, metric: req.metric })

    const nowSec = Math.floor(ctx.now() / 1000)
    const built = this.#parse(name, req.metric, body, nowSec, ctx)
    return { contract: spec.contract, ...built }
  }

  #parse(
    name: SpecName,
    metric: string,
    body: unknown,
    nowSec: number,
    ctx: FetchContext,
  ): { points: readonly Point[]; sourceTime: string; labelConfidence: 'verified'; warnings: string[] } {
    switch (name) {
      case 'mempool.HashRate': {
        const rows = (body as { hashrates?: { timestamp: number; avgHashrate: number }[] })
          .hashrates
        if (!rows?.length) throw new AdapterError(PROVIDER, metric, '返回空序列')
        const points = rows.map((r) => ({
          ts: toUtcSecondsBrand(r.timestamp),
          value: Number.isFinite(r.avgHashrate) ? r.avgHashrate : null,
        }))
        return finish(points, ctx, PROVIDER, metric)
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
          labelConfidence: 'verified',
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
          labelConfidence: 'verified',
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
          labelConfidence: 'verified',
          warnings: [],
        }
      }
    }
  }
}

function finish(
  points: readonly Point[],
  ctx: FetchContext,
  provider: string,
  metric: string,
): { points: readonly Point[]; sourceTime: string; labelConfidence: 'verified'; warnings: string[] } {
  if (points.length === 0) throw new AdapterError(provider, metric, '返回空序列')
  const sorted = [...points].sort((a, b) => a.ts - b.ts)
  const latest = sorted[sorted.length - 1]
  if (!latest) throw new AdapterError(provider, metric, '返回空序列')
  const missing = sorted.filter((p) => p.value === null).length
  return {
    points: sorted,
    sourceTime: new Date(latest.ts * 1000).toISOString(),
    labelConfidence: 'verified',
    warnings: missing > 0 ? [`${missing} 个时间点上游无数据（保留为 null，未填充）`] : [],
  }
}
