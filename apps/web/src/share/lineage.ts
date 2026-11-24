/**
 * 海报页脚的来源，跟着这张图实际用到的指标走。
 * 没有用到的上游不出现，避免把整站的来源名单印成一张免责声明。
 */

import { registry } from '@slowmoonship/metrics'

const ORDER = ['Coin Metrics', 'Blockstream', 'mempool.space', 'Strategy 官方披露', 'Signal 自有计算'] as const

function providerLabel(provider: string): string {
  if (provider === 'Strategy' || provider === 'SEC EDGAR') return 'Strategy 官方披露'
  return provider
}

export function lineageOf(ids: readonly string[]): string[] {
  const found = new Set<string>()
  for (const id of ids) {
    if (!registry.has(id)) continue
    const def = registry.get(id)
    if (def.derivation) found.add('Signal 自有计算')
    for (const source of def.sources) found.add(providerLabel(source.provider))
  }
  const known = new Set<string>(ORDER)
  const ordered = ORDER.filter((name) => found.has(name))
  const rest = [...found].filter((name) => !known.has(name)).sort()
  return [...ordered, ...rest]
}
