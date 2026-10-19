/**
 * Coin Metrics Community API 适配器。
 *
 * ⚠️ 白名单是**实测得出**的（2026-10-19），不是文档抄来的。
 * Community 层对部分指标返回 403，本适配器把不可用指标列在
 * `DENIED_METRICS` 中，让它们**在本地就失败**，
 * 而不是发出一个注定 403 的请求再浪费一次重试。
 *
 * 重新核对白名单：
 *   curl -s "https://community-api.coinmetrics.io/v4/timeseries/asset-metrics?assets=btc&metrics=<M>&frequency=1d&page_size=1"
 * 200 = 可用；403 = 需付费 key。
 */

import {
  toUtcSecondsBrand,
  type MetricContract,
  type Point,
  type SourceRef,
} from '@slowmoonship/metrics'
import { AdapterError, type AdapterRequest, type FetchContext, type RawSeries, type SourceAdapter } from './types.js'
import { fetchJson } from './http.js'

const BASE = 'https://community-api.coinmetrics.io/v4'
const PROVIDER = 'coin-metrics'

/** 实测：这些指标在免 key 层返回 403，不可用于 MVP */
export const DENIED_METRICS: ReadonlySet<string> = new Set([
  'FeeTotUSD',
  'FeeMeanNtv',
  'DiffMean',
  'RevUSD',
  'NVTAdj',
  'SplyAct1d',
  'TxTfrValAdjUSD',
  'BlkSizeMeanByte',
])

type MetricSpec = {
  readonly contract: MetricContract
  /**
   * 把上游原始值换算到 `contract.unit` 的乘数。
   *
   * 实测（2026-10-19）：`HashRate` 返回约 1e9，与 mempool.space 同期的 1e21 H/s
   * 正好差 1e12 —— 该端点以 TH/s 发布。没有这一步，"1,000,000,000 H/s"
   * （全网算力 1 GH/s，比 2011 年还低）会被当成事实发布出去。
   */
  readonly scale?: number
  /**
   * 规范化后的上限。越界即上游改了口径，宁可报错也不发布。
   *
   * 只有上限，没有下限：币史早期的全网算力确实只有 1e5 H/s 量级，
   * 设下限会把 2009 年的正确数据误判成错误数据——那才是真的造假。
   * 上限能抓住的正是危险方向——上游哪天改成直接给 H/s，
   * 换算后会变成 1e33，比物理上可能的算力高十个数量级。
   */
  readonly maxPlausible?: number
}

/**
 * 各指标的口径。注意 `SplyExNtv` / `FlowInExNtv` / `FlowOutExNtv` 依赖
 * 上游的交易所地址聚类，属启发式标注 —— 已在 contract 中写明。
 */
const SPECS: Readonly<Record<string, MetricSpec>> = {
  PriceUSD: {
    contract: {
      unit: 'usd',
      scale: 1,
      aggregation: 'mean',
      window: 'calendar-day-utc',
      labelSemantics: 'n/a',
    },
  },
  CapMrktCurUSD: {
    contract: {
      unit: 'usd',
      scale: 1,
      aggregation: 'last',
      window: 'calendar-day-utc',
      labelSemantics: 'n/a',
    },
  },
  SplyCur: {
    contract: {
      unit: 'btc',
      scale: 1,
      aggregation: 'last',
      window: 'point',
      labelSemantics: 'n/a',
    },
  },
  SplyExNtv: {
    contract: {
      unit: 'btc',
      scale: 1,
      aggregation: 'last',
      window: 'calendar-day-utc',
      labelSemantics: 'provider exchange-address cluster labels',
    },
  },
  FlowInExNtv: {
    contract: {
      unit: 'btc',
      scale: 1,
      aggregation: 'sum',
      window: 'calendar-day-utc',
      labelSemantics: 'provider exchange-address cluster labels',
    },
  },
  FlowOutExNtv: {
    contract: {
      unit: 'btc',
      scale: 1,
      aggregation: 'sum',
      window: 'calendar-day-utc',
      labelSemantics: 'provider exchange-address cluster labels',
    },
  },
  AdrActCnt: {
    contract: {
      unit: 'count',
      scale: 1,
      aggregation: 'sum',
      window: 'calendar-day-utc',
      labelSemantics: 'n/a',
    },
  },
  TxCnt: {
    contract: {
      unit: 'count',
      scale: 1,
      aggregation: 'sum',
      window: 'calendar-day-utc',
      labelSemantics: 'n/a',
    },
  },
  BlkCnt: {
    contract: {
      unit: 'blocks',
      scale: 1,
      aggregation: 'sum',
      window: 'calendar-day-utc',
      labelSemantics: 'n/a',
    },
  },
  IssTotNtv: {
    contract: {
      unit: 'btc',
      scale: 1,
      aggregation: 'sum',
      window: 'calendar-day-utc',
      labelSemantics: 'n/a',
    },
  },
  IssTotUSD: {
    contract: {
      unit: 'usd',
      scale: 1,
      aggregation: 'sum',
      window: 'calendar-day-utc',
      labelSemantics: 'n/a',
    },
  },
  FeeTotNtv: {
    contract: {
      unit: 'btc',
      scale: 1,
      aggregation: 'sum',
      window: 'calendar-day-utc',
      labelSemantics: 'n/a',
    },
  },
  HashRate: {
    contract: {
      unit: 'hashrate',
      scale: 1,
      aggregation: 'mean',
      window: 'calendar-day-utc',
      labelSemantics: 'n/a',
    },
    scale: 1e12,
    // 1e24 H/s 已是物理上不可能的量级，纯粹作为口径变化的哨兵
    maxPlausible: 1e24,
  },
}

type CmRow = Record<string, string | undefined>

type CmResponse = {
  readonly data?: readonly CmRow[]
  readonly next_page_token?: string
}

const PAGE_SIZE = 10_000
const MAX_PAGES = 20

/**
 * 解析单行。
 *
 * Coin Metrics 用字符串 `"-"` 表示该时间点无数据 —— 这是**缺失**，
 * 必须转成 `null`，绝不能变成 0。
 */
function parseValue(raw: string | undefined): number | null {
  if (raw === undefined || raw === null) return null
  const trimmed = raw.trim()
  if (trimmed === '' || trimmed === '-') return null
  const n = Number(trimmed)
  return Number.isFinite(n) ? n : null
}

export class CoinMetricsAdapter implements SourceAdapter {
  readonly provider = PROVIDER
  readonly auth = 'none' as const

  supports(req: Pick<AdapterRequest, 'asset' | 'metric'>): boolean {
    return SPECS[req.metric] !== undefined && !DENIED_METRICS.has(req.metric)
  }

  contractFor(req: Pick<AdapterRequest, 'asset' | 'metric'>): MetricContract {
    const spec = SPECS[req.metric]
    if (!spec) {
      throw new AdapterError(
        PROVIDER,
        req.metric,
        `未登记口径。该指标可能属于付费墙（${DENIED_METRICS.has(req.metric) ? '实测 403' : '不在白名单'}）。`,
      )
    }
    return spec.contract
  }

  sourceRef(req: AdapterRequest): SourceRef {
    return {
      provider: PROVIDER,
      metric: req.metric,
      endpoint: `${BASE}/timeseries/asset-metrics?assets=${req.asset}&metrics=${req.metric}&frequency=1d`,
      auth: this.auth,
      // 交易所类指标依赖上游聚类标注 → heuristic；其余为客观统计 → verified
      labelConfidence: /ExNtv|ExUSD/.test(req.metric) ? 'heuristic' : 'verified',
    }
  }

  async fetch(req: AdapterRequest, ctx: FetchContext): Promise<RawSeries> {
    const contract = this.contractFor(req)
    const scale = SPECS[req.metric]?.scale
    const maxPlausible = SPECS[req.metric]?.maxPlausible
    const points: Point[] = []
    const warnings: string[] = []
    let pageToken: string | undefined

    for (let page = 0; page < MAX_PAGES; page += 1) {
      const params = new URLSearchParams({
        assets: req.asset,
        metrics: req.metric,
        frequency: '1d',
        page_size: String(PAGE_SIZE),
      })
      if (pageToken) params.set('page_token', pageToken)
      if (req.since !== undefined) {
        params.set('start_time', new Date(req.since * 1000).toISOString().slice(0, 19))
      }

      const body = await fetchJson<CmResponse>(
        `${BASE}/timeseries/asset-metrics?${params.toString()}`,
        ctx,
        { provider: PROVIDER, metric: req.metric },
      )

      for (const row of body.data ?? []) {
        const ts = toUtcSecondsOrThrow(row['time'], req.metric)
        const raw = parseValue(row[req.metric])
        const value = raw === null ? null : raw * (scale ?? 1)
        if (value === null) {
          warnings.push(`${new Date(ts * 1000).toISOString().slice(0, 10)} 上游未提供数据`)
        } else if (maxPlausible !== undefined && value > maxPlausible) {
          // 单位口径变了。把一个数量级差 1e12 的数字照发，等于发布一条假曲线，
          // 而它看上去和正常数据毫无区别——只能在这里拦住。
          throw new AdapterError(
            PROVIDER,
            req.metric,
            `换算后取值 ${value} 超过上限 ${maxPlausible}，` +
              `上游可能改了单位口径（原始值 ${raw}，乘数 ${scale ?? 1}）`,
          )
        }
        points.push({ ts: toUtcSecondsBrand(ts), value })
      }

      pageToken = body.next_page_token
      if (!pageToken) break
    }

    if (points.length === 0) {
      throw new AdapterError(PROVIDER, req.metric, '返回空序列')
    }

    points.sort((a, b) => a.ts - b.ts)
    const latestTs = points[points.length - 1]?.ts
    if (latestTs === undefined) {
      throw new AdapterError(PROVIDER, req.metric, '无法确定最新数据时间')
    }

    return {
      points,
      contract,
      // 来源时间 = 上游最新数据自身的时间戳，而非抓取时刻。
      // 免费源多为 T+1 结算，两者不同；页面判断新鲜度看的是这两个的差。
      sourceTime: new Date(latestTs * 1000).toISOString(),
      labelConfidence: this.sourceRef(req).labelConfidence,
      warnings: [...new Set(warnings)].slice(0, 20),
    }
  }
}

function toUtcSecondsOrThrow(raw: string | undefined, metric: string): number {
  if (!raw) throw new AdapterError(PROVIDER, metric, '响应缺少 time 字段')
  const ms = Date.parse(raw.endsWith('Z') ? raw : `${raw}Z`)
  if (Number.isNaN(ms)) throw new AdapterError(PROVIDER, metric, `无法解析时间 ${raw}`)
  return Math.floor(ms / 1000)
}
