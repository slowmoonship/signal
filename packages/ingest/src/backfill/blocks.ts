/**
 * 历史区块抓取（回填用）。
 *
 * ## 为什么是区块而不是别的
 *
 * `difficulty` 与 `block-weight` 的口径都是"**某一天采集时链尖那个区块**的区块级字段"。
 * 这类"点采样"指标的历史无法从任何聚合序列里还原——但区块本身是公开的、可确定性重建的：
 * 任何一个高度上的区块，其 `difficulty` / `weight` 都是确定的。
 *
 * `pool-concentration` 同理：它是 mempool.space 对**最近一个月出块份额**的 HHI。
 * 只要能拿到每个区块的矿池标注，就能把任意一天的滚动窗口重新算出来。
 *
 * ## 数据源
 *
 * `GET https://mempool.space/api/v1/blocks/{height}` 一次返回以该高度为顶点的 15 个区块，
 * 每个区块带 `timestamp` / `bits` / `weight` / `extras.pool.slug`。
 * 一次 15 个区块，400 天约 3,840 次请求——比逐块抓（57,600 次）少一个数量级。
 *
 * ## 难度为什么自己算，而不是抄 `difficulty` 字段
 *
 * 上游给的是浮点数，且不同端点的序列化精度不同
 * （mempool.space 自己的接口给 `…071.9`，Blockstream 给 `…071.94`）。
 * 而 `difficulty` 完全可以由区块头的 `nBits` **确定性地**算出——
 * 用的是 Bitcoin Core `GetDifficulty()` 的原式：
 *
 *     difficulty = (0xFFFF / mantissa) × 256^(29 − exponent)
 *
 * 实测（2026-11-11，取 5 个跨越难度调整周期的区块）：
 * 由 `bits` 算出的值与 Blockstream 的 `difficulty` 字段**逐位相同**，
 * 而与 mempool.space 自己的序列化偶尔差一个 ULP。
 * 每日抓取走的是 Blockstream，因此回填也走同一条路，
 * 两条来源拼起来才是同一条曲线，而不是两条差在最后一位上的曲线。
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import { fetchJson } from '../sources/http.js'
import type { FetchContext, Logger } from '../sources/types.js'

const BASE = 'https://mempool.space'
const PROVIDER = 'mempool.space'
const BLOCKS_PATH = '/api/v1/blocks/{height}'

/** 一次请求返回的区块数（上游固定 15 个，从给定高度往下递减）。 */
export const BLOCKS_PER_CALL = 15

/**
 * 缓存里的一条区块。
 *
 * 只存算三个指标需要的东西：时间戳、nBits、权重、矿池标注。
 * 区块哈希、coinbase、费率区间这些一律不存——它们占 90% 的体积却一个都用不上。
 */
export type CachedBlock = Readonly<{
  /** 区块高度 */
  readonly height: number
  /** 区块时间戳（UTC 纪元秒） */
  readonly ts: number
  /** 区块头的 nBits */
  readonly bits: number
  /** 区块权重（权重单位，满块 4,000,000） */
  readonly weight: number
  /** mempool.space 的矿池标注 slug；null = 该区块没有可用标注 */
  readonly pool: string | null
}>

/** 缓存文件格式。数组而不是对象：体积小一半，解析也快。 */
type CacheFile = {
  readonly version: 1
  readonly blocks: readonly (readonly [number, number, number, number, string | null])[]
}

export type BlockCache = {
  /** 高度 → 区块 */
  readonly byHeight: Map<number, CachedBlock>
  /** 缓存文件路径 */
  readonly path: string
  /** 是否被改动过（决定要不要落盘） */
  dirty: boolean
}

/** 读缓存。文件不存在就是空缓存——回填从头开始。 */
export function loadBlockCache(path: string): BlockCache {
  const byHeight = new Map<number, CachedBlock>()
  if (existsSync(path)) {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as CacheFile
    if (raw.version !== 1 || !Array.isArray(raw.blocks)) {
      throw new Error(`区块缓存 ${path} 的格式不对（version=${String(raw.version)}）`)
    }
    // Array.isArray 的类型谓词是 `arg is any[]`：对 readonly 元组数组收窄后
    // 元素会退化成 any，这里显式取回声明的类型（形状已由上面的检查验证过）。
    const rows = raw.blocks as CacheFile['blocks']
    for (const [height, ts, bits, weight, pool] of rows) {
      byHeight.set(height, { height, ts, bits, weight, pool })
    }
  }
  return { byHeight, path, dirty: false }
}

/** 落盘缓存。原子写：先写临时文件再 rename，中断时正式文件仍是旧的完整版本。 */
export function saveBlockCache(cache: BlockCache): void {
  if (!cache.dirty) return
  mkdirSync(dirname(cache.path), { recursive: true })
  const blocks = [...cache.byHeight.values()]
    .sort((a, b) => a.height - b.height)
    .map((b) => [b.height, b.ts, b.bits, b.weight, b.pool] as const)
  const file: CacheFile = { version: 1, blocks }
  const tmp = `${cache.path}.tmp`
  writeFileSync(tmp, JSON.stringify(file), 'utf8')
  renameSync(tmp, cache.path)
  cache.dirty = false
}

/** 上游区块响应里我们关心的字段。 */
type RawBlock = {
  readonly height?: unknown
  readonly timestamp?: unknown
  readonly bits?: unknown
  readonly weight?: unknown
  readonly extras?: { readonly pool?: { readonly slug?: unknown } | null } | null
}

/**
 * Bitcoin Core 的难度公式。
 *
 * `GetDifficulty()`：`(0xFFFF / mantissa) × 256^(29 − exponent)`。
 * 难度调整在 exponent 不变时由 mantissa 承担；exponent 每 +1，难度 ×256。
 */
export function difficultyFromBits(bits: number): number | null {
  if (!Number.isFinite(bits) || bits <= 0) return null
  const exponent = Math.floor(bits / 0x1000000)
  const mantissa = bits & 0x00ffffff
  if (mantissa === 0) return null
  let d = 0x0000ffff / mantissa
  for (let i = exponent; i < 29; i += 1) d *= 256
  for (let i = exponent; i > 29; i -= 1) d /= 256
  return d
}

/**
 * 抓取从 `toHeight` 往下、直到出现早于 `fromTs` 的区块为止，全部写进缓存。
 *
 * **按页走而不是按高度走**：上游一次给 15 个区块，
 * 断点续传以"这一页是不是已经在缓存里"为单位——
 * 整页命中就完全不发请求，中断后重跑只补真正缺的那几页。
 *
 * 停止条件是**时间**而不是高度：区块高度与日历时间不是线性关系
 * （难度调整会让出块变快或变慢），用高度推算会差出好几天。
 */
export async function fetchBlocksUntil(opts: {
  /** 起始高度（通常是链尖高度） */
  readonly toHeight: number
  /** 抓到这个时间戳之前的区块就停 */
  readonly fromTs: number
  readonly cache: BlockCache
  readonly ctx: FetchContext
  readonly logger: Logger
  /** 每次请求之间的间隔（毫秒）。默认 400ms ≈ 2.5 req/s */
  readonly delayMs?: number
  /** 每隔多少次请求落一次盘 */
  readonly saveEvery?: number
}): Promise<void> {
  const { toHeight, fromTs, cache, ctx, logger } = opts
  const delayMs = opts.delayMs ?? 400
  const saveEvery = opts.saveEvery ?? 50

  let calls = 0
  let added = 0
  let skipped = 0

  let h = toHeight
  for (;;) {
    const pageHeights = pageOf(h)
    const missing = pageHeights.filter((height) => !cache.byHeight.has(height))

    if (missing.length > 0) {
      const url = `${BASE}${BLOCKS_PATH.replace('{height}', String(h))}`
      const body = await fetchJson<readonly RawBlock[]>(url, ctx, {
        provider: PROVIDER,
        metric: 'backfill.blocks',
      })
      calls += 1
      if (!Array.isArray(body)) {
        throw new Error(`区块响应不是数组：${url}`)
      }
      // 同上：Array.isArray 收窄会把 readonly 元组/对象数组的元素退化成 any
      for (const raw of body as readonly RawBlock[]) {
        const block = toCachedBlock(raw)
        if (!block) continue
        if (block.height > toHeight) continue
        const existing = cache.byHeight.get(block.height)
        if (existing && existing.ts === block.ts) continue
        cache.byHeight.set(block.height, block)
        cache.dirty = true
        added += 1
      }
      if (calls % saveEvery === 0) {
        saveBlockCache(cache)
        logger.info(
          `已抓取 ${cache.byHeight.size} 个区块（新增 ${added}），当前高度 ${h}`,
        )
      }
      await sleep(delayMs)
    } else {
      skipped += 1
    }

    // 这一页里最早的区块早于目标时间，说明已经覆盖到需要的范围
    const oldest = pageHeights
      .map((height) => cache.byHeight.get(height))
      .reduce((min, b) => (b && (!min || b.ts < min.ts) ? b : min), undefined as CachedBlock | undefined)
    if (oldest && oldest.ts < fromTs) break
    h -= BLOCKS_PER_CALL
    if (h < 0) break
  }

  saveBlockCache(cache)
  logger.info(
    `区块抓取完成：缓存共 ${cache.byHeight.size} 个区块，本次新增 ${added}，` +
      `请求 ${calls} 次，跳过整页命中 ${skipped} 页`,
  )
}

/** 一页覆盖的高度：从 h 往下 15 个。 */
function pageOf(h: number): number[] {
  const out: number[] = []
  for (let i = 0; i < BLOCKS_PER_CALL; i += 1) out.push(h - i)
  return out
}

/** 链尖高度。 */
export async function fetchTipHeight(ctx: FetchContext): Promise<number> {
  // Esplora 的路径（mempool.space 自己那版 /api/v1/mining/blocks/tip/height 不存在）
  const url = `${BASE}/api/blocks/tip/height`
  const body = await fetchJson<unknown>(url, ctx, {
    provider: PROVIDER,
    metric: 'backfill.tip-height',
  })
  if (typeof body !== 'number' || !Number.isFinite(body)) {
    throw new Error(`链尖高度不可解析：${String(body)}`)
  }
  return body
}

/** 上游字段 → 缓存记录。缺字段的区块直接丢弃，不做部分填充。 */
function toCachedBlock(raw: RawBlock): CachedBlock | null {
  const height = raw.height
  const ts = raw.timestamp
  const bits = raw.bits
  const weight = raw.weight
  if (typeof height !== 'number' || !Number.isFinite(height)) return null
  if (typeof ts !== 'number' || !Number.isFinite(ts)) return null
  if (typeof bits !== 'number' || !Number.isFinite(bits)) return null
  if (typeof weight !== 'number' || !Number.isFinite(weight)) return null
  const slug = raw.extras?.pool?.slug
  return {
    height,
    ts,
    bits,
    weight,
    pool: typeof slug === 'string' && slug.length > 0 ? slug : null,
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
