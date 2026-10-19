/**
 * Blockstream 区块头适配器。
 *
 * 为什么直读区块头：难度 / 交易笔数 / 权重都是**区块级字段**，
 * 只有把 tip 区块的原始头读出来才是准数。mempool.space 只给
 * "下次难度调整百分比"，无法还原当前难度绝对值（见 mempool.ts 的 Difficulty 分支）。
 *
 * 一次运行只产出一个点：这三项是**日更采样**而非区间聚合，
 * 序列靠"每天多一个点"自然生长，不做回补（见 mining.ts 里 difficulty 的 history 说明）。
 *
 * ⚠️ 实测（2026-10-19）：
 * - tip hash 走 `/api/blocks/tip/hash`，返回**纯文本**（Content-Type: text/plain），
 *   按 JSON 解析会直接炸，因此这里自己发请求而不是复用 `fetchJson`。
 * - `/api/block/tip` 在 blockstream.info **不存在**（那是 mempool.space 的路径），
 *   请求它只会拿到一段文本 "Invalid hex string" —— 所以下面的 hash 形状校验是必需的。
 */

import {
  LABEL_SEMANTICS,
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

const BASE = 'https://blockstream.info'
const PROVIDER = 'blockstream'
const TIP_HASH_URL = `${BASE}/api/blocks/tip/hash`
const BLOCK_URL = `${BASE}/api/block/{hash}`

/** 区块哈希必须是 64 位小写十六进制；其他形状一律视为上游没给哈希 */
const HASH_RE = /^[0-9a-f]{64}$/

type Spec = {
  /** 区块响应中该指标对应的字段名 */
  readonly field: 'difficulty' | 'tx_count' | 'weight'
  readonly contract: MetricContract
}

/**
 * 三个指标的取值口径完全一致：都是某个具体区块的区块级字段，
 * 取链尖那一刻的值，因此 aggregation 为 `last`、window 为 `point`，
 * 与指标定义侧逐字段相等（写入前会过 `assertContractCompatible`）。
 */
const SPECS: Readonly<Record<string, Spec>> = {
  'blockstream.Difficulty': {
    field: 'difficulty',
    contract: {
      unit: 'index',
      scale: 1,
      aggregation: 'last',
      window: 'point',
      labelSemantics: LABEL_SEMANTICS.none,
    },
  },
  'blockstream.BlockTxCount': {
    field: 'tx_count',
    contract: {
      unit: 'count',
      scale: 1,
      aggregation: 'last',
      window: 'point',
      labelSemantics: LABEL_SEMANTICS.none,
    },
  },
  'blockstream.BlockWeight': {
    field: 'weight',
    contract: {
      unit: 'count',
      scale: 1,
      aggregation: 'last',
      window: 'point',
      labelSemantics: LABEL_SEMANTICS.none,
    },
  },
}

/** 上游区块响应里我们关心的字段；其余字段一律不读 */
type BlockBody = {
  readonly id?: unknown
  readonly height?: unknown
  readonly timestamp?: unknown
  readonly difficulty?: unknown
  readonly tx_count?: unknown
  readonly weight?: unknown
}

export class BlockstreamAdapter implements SourceAdapter {
  readonly provider = PROVIDER
  readonly auth = 'none' as const

  supports(req: Pick<AdapterRequest, 'asset' | 'metric'>): boolean {
    return req.metric.startsWith('blockstream.') && req.metric in SPECS
  }

  contractFor(req: Pick<AdapterRequest, 'asset' | 'metric'>): MetricContract {
    const spec = SPECS[req.metric]
    if (!spec) throw new AdapterError(PROVIDER, req.metric, '未登记口径')
    return spec.contract
  }

  sourceRef(req: AdapterRequest): SourceRef {
    return {
      provider: PROVIDER,
      metric: req.metric,
      endpoint: BLOCK_URL,
      auth: this.auth,
      labelConfidence: 'verified',
    }
  }

  async fetch(req: AdapterRequest, ctx: FetchContext): Promise<RawSeries> {
    const spec = SPECS[req.metric]
    if (!spec) throw new AdapterError(PROVIDER, req.metric, '未登记口径')

    // 先固定哈希再按哈希取块：两次请求之间链尖可能前进，
    // 锁定哈希才能保证"点 / 时间戳 / 数值"来自同一个区块，自洽可比。
    const hash = await fetchTipHash(req.metric, ctx)
    const body = await fetchJson<BlockBody>(BLOCK_URL.replace('{hash}', hash), ctx, {
      provider: PROVIDER,
      metric: req.metric,
    })

    // 形状完全不可用时才抛错；单个字段缺失只记 null（红线 1）
    if (!isBlockBody(body)) {
      throw new AdapterError(PROVIDER, req.metric, '区块响应不是对象，形状不可用')
    }

    // 时间戳取区块自身的 timestamp：那是"被测状态成立的时刻"（sourceTime），
    // 与采集时间（ingestedAt，由 runner 从 ctx.now() 记录）是两回事，不可混淆。
    // 缺失时不拿采集时间凑数——那会让"数据有多新"这件事说谎。
    const ts = body['timestamp']
    if (typeof ts !== 'number' || !Number.isFinite(ts)) {
      throw new AdapterError(PROVIDER, req.metric, '区块响应缺少可用的 timestamp，无法确定来源时间')
    }

    const raw = body[spec.field]
    let value: number | null = null
    const warnings: string[] = []
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
      // 字段缺失即 null：0 是"真实为零"，用 0 填缺失是红线 1 意义上的造假
      warnings.push(
        `区块 ${hash} 的 ${spec.field} 字段缺失或非有限值，本点记为 null` +
          `（未用 0 或上一份快照的值填充）`,
      )
    } else {
      value = raw
    }

    const points: readonly Point[] = [{ ts: toUtcSecondsBrand(ts), value }]
    for (const p of points) {
      if (p.value !== null && !Number.isFinite(p.value)) {
        throw new AdapterError(PROVIDER, req.metric, '产出了非有限数值')
      }
    }

    return {
      points,
      contract: spec.contract,
      sourceTime: new Date(ts * 1000).toISOString(),
      labelConfidence: 'verified',
      warnings,
    }
  }
}

/**
 * 取链尖区块哈希。
 *
 * 纯文本响应，Content-Type 是 text/plain，因此不能走 `fetchJson`。
 * 不重试：读不到哈希就整体失败并保留上一份快照，
 * 同一次运行里反复重试并不会让"当天没有值"变成有值。
 */
async function fetchTipHash(metric: string, ctx: FetchContext): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ctx.timeoutMs)
  let text: string
  try {
    const res = await ctx.fetchImpl(TIP_HASH_URL, {
      signal: controller.signal,
      headers: { accept: 'text/plain' },
    })
    if (!res.ok) {
      throw new AdapterError(PROVIDER, metric, `tip hash 接口 HTTP ${res.status} ${res.statusText}`)
    }
    text = await res.text()
  } catch (e) {
    if (e instanceof AdapterError) throw e
    const reason = e instanceof Error && e.name === 'AbortError' ? '请求超时' : String(e)
    throw new AdapterError(PROVIDER, metric, `tip hash 接口取数失败：${reason}`, e)
  } finally {
    clearTimeout(timer)
  }

  const hash = text.trim()
  // 形状守卫：`/api/block/tip` 这类不存在的路径在 blockstream.info 会返回
  // 文本 "Invalid hex string"，直接当哈希用会写进一条坏数据，故此处硬拦。
  if (!HASH_RE.test(hash)) {
    throw new AdapterError(
      PROVIDER,
      metric,
      `tip hash 不是 64 位小写十六进制，疑似上游返回了错误文本：${JSON.stringify(hash.slice(0, 80))}`,
    )
  }
  return hash
}

function isBlockBody(body: unknown): body is BlockBody {
  return typeof body === 'object' && body !== null && !Array.isArray(body)
}
