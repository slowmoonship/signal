/**
 * 完整指标库的分组。
 *
 * 和首页白名单不是同一份清单：首页只留能在一屏里互相看的行，
 * 指标库必须覆盖注册表里的每一个指标，而且每个只出现一次。
 */

import { registry } from './definitions/index.js'
import type { Localized, MetricDefinition } from './types.js'

export type CatalogGroup = Readonly<{
  key: string
  label: Localized
  metricIds: readonly string[]
}>

export const CATALOG_GROUPS: readonly CatalogGroup[] = [
  {
    key: 'market',
    label: { zh: '市场行情', en: 'Market' },
    metricIds: ['price', 'price-change-7d', 'drawdown-ath', 'supply', 'market-cap', 'btc-price-us-close'],
  },
  {
    key: 'valuation',
    label: { zh: '估值', en: 'Valuation' },
    metricIds: [
      'ahr999',
      'rainbow-zone',
      'mvrv',
      'mvrv-zscore',
      'nupl',
      'btc-realized-price',
      'btc-realized-premium',
      'mayer-multiple',
      'dca-max-wait-days',
    ],
  },
  {
    key: 'cycle',
    label: { zh: '牛熊周期', en: 'Cycle' },
    metricIds: ['pi-cycle-top', 'sma-200w', 'ma-2y', 'puell-multiple', 'hash-ribbons'],
  },
  {
    key: 'exchange',
    label: { zh: '资金', en: 'Flows' },
    metricIds: ['exchange-netflow', 'exchange-balance'],
  },
  {
    key: 'onchain',
    label: { zh: '链上', en: 'On-chain' },
    metricIds: ['active-addresses', 'tx-count', 'block-count'],
  },
  {
    key: 'fees',
    label: { zh: '费用与区块', en: 'Fees' },
    metricIds: ['fees-total', 'miner-revenue', 'recommended-fee-rate', 'block-tx-count', 'block-weight'],
  },
  {
    key: 'mining',
    label: { zh: '矿工', en: 'Mining' },
    metricIds: ['hashrate', 'difficulty', 'pool-concentration', 'miner-revenue-usd'],
  },
  {
    key: 'strategy',
    label: { zh: 'Strategy', en: 'Strategy' },
    metricIds: [
      'mstr-price',
      'mstr-btc-beta-90d',
      'strategy-btc-holdings',
      'strategy-btc-per-share',
      'strategy-btc-cost',
      'strategy-btc-unrealized',
      'mstr-common-issuance',
      'strc-repurchase',
      'strategy-mnav',
      'strategy-usd-reserve',
      'strategy-usd-cash',
    ],
  },
]

export const CATALOG_METRIC_IDS: readonly string[] = CATALOG_GROUPS.flatMap((group) => group.metricIds)

export function tableName(def: MetricDefinition, locale: 'zh' | 'en'): string {
  return def.shortName?.[locale] ?? def.name[locale]
}

/** 注册表和指标库必须是同一份名单。多一个、少一个、重复一个都是错。 */
export function validateCatalog(): string[] {
  const problems: string[] = []
  const seen = new Set<string>()
  for (const id of CATALOG_METRIC_IDS) {
    if (seen.has(id)) problems.push(`${id} 在指标库里出现了两次`)
    seen.add(id)
    if (!registry.has(id)) problems.push(`${id} 没有注册`)
  }
  for (const def of registry.all()) {
    if (!seen.has(def.id)) problems.push(`${def.id} 没有进入指标库`)
  }
  return problems
}
