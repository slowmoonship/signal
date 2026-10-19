/**
 * 适配器注册表。
 *
 * 新增数据源 = 实现 SourceAdapter + 加到这里。
 * ADR-002：`apiKey` 适配器必须实现降级逻辑，未配置 key 时不得让
 * 免费路径失败，也不得让付费源变成隐式依赖。
 */

import type { AdapterRequest, SourceAdapter } from './types.js'
import { BlockstreamAdapter } from './blockstream.js'
import { CoinMetricsAdapter, DENIED_METRICS } from './coin-metrics.js'
import { MempoolAdapter } from './mempool.js'

export const adapters: readonly SourceAdapter[] = [
  new CoinMetricsAdapter(),
  new MempoolAdapter(),
  new BlockstreamAdapter(),
]

/**
 * 按指标挑选适配器。
 *
 * 返回 `null` 而非抛错：runner 需要知道"这个指标当前无可用来源"
 * （比如付费 key 未配置），以便保留上一份快照而不是把它清空。
 */
export function resolveAdapter(req: Pick<AdapterRequest, 'asset' | 'metric'>): SourceAdapter | null {
  return adapters.find((a) => a.supports(req)) ?? null
}

/** 某指标当前能否被任一已注册适配器产出 */
export function isAvailable(req: Pick<AdapterRequest, 'asset' | 'metric'>): boolean {
  return resolveAdapter(req) !== null
}

export { DENIED_METRICS }
export { BlockstreamAdapter } from './blockstream.js'
export { CoinMetricsAdapter } from './coin-metrics.js'
export { MempoolAdapter } from './mempool.js'
export * from './types.js'
