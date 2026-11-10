/**
 * 首页白名单的测试。
 *
 * 白名单住在 `packages/metrics`（CLAUDE.md §架构边界 4）：页面层不得自己列指标。
 *
 * 这里**刻意不锁死指标数量**。上一版锁了"恰好 11 个"，结果是后来每加一个真正有用的
 * 指标都要先改测试，改久了这条断言就变成了"11 是对的"这个结论本身。
 * 数量改成一条上限 + 一条互不重复 + 一条全注册的约束：
 * 失控成清单能被上限拦住，而"多一个有价值的指标"不再需要先改断言。
 *
 * 但**具体是哪几个指标、哪几个分组、什么顺序**仍然逐个点名——
 * 数量对但换掉一行，读者看到的就是另一张表。
 */

import { describe, expect, it } from 'vitest'

import {
  HERO_METRIC_ID,
  HOME_GROUP_KEYS,
  HOME_GROUPS,
  HOME_METRIC_IDS,
  registry,
  SPARKLINE_PRICE_METRIC_ID,
  STATUS_SPECS,
  validateHomeWhitelist,
} from '../src/index.js'

/**
 * 表格行数的上限。
 *
 * 40 行是"读者不会觉得自己在看一张数据库导出"的经验线，
 * 不是审美判断——真正的问题是"一组里的指标能不能互相解释"，
 * 那由分组断言守住。
 */
const MAX_ROWS = 40

describe('首页白名单', () => {
  it('行数不超过上限，也不是个位数的清单', () => {
    expect(HOME_METRIC_IDS.length).toBeGreaterThanOrEqual(12)
    expect(HOME_METRIC_IDS.length).toBeLessThanOrEqual(MAX_ROWS)
  })

  it('六个分组：价格与市场 / 估值 / 交易所与持仓 / 链上活动 / 费用与区块 / 矿工与安全', () => {
    expect(HOME_GROUPS.map((g) => g.key)).toEqual([
      'marketOverview',
      'valuationAnchors',
      'exchangeFlows',
      'onchainActivity',
      'feesBlocks',
      'miningSecurity',
    ])
  })

  it('分组键与 HOME_GROUP_KEYS 完全一致，且每组都不空', () => {
    expect(HOME_GROUPS.map((g) => g.key)).toEqual([...HOME_GROUP_KEYS])
    for (const group of HOME_GROUPS) {
      expect(group.metricIds.length, `${group.key} 是空组`).toBeGreaterThan(0)
    }
  })

  it('每个指标只出现一次', () => {
    expect(new Set(HOME_METRIC_IDS).size).toBe(HOME_METRIC_IDS.length)
  })

  it('白名单上的指标全部已在注册表里登记', () => {
    for (const id of HOME_METRIC_IDS) {
      expect(registry.has(id), `${id} 没有注册`).toBe(true)
    }
  })

  it('白名单就是规格里那些指标，逐个点名', () => {
    expect([...HOME_METRIC_IDS]).toEqual([
      // 价格与市场
      'price',
      'price-change-7d',
      'supply',
      // 估值
      'market-cap',
      'mvrv',
      // 交易所与持仓
      'exchange-netflow',
      'exchange-balance',
      'pool-concentration',
      // 链上活动
      'active-addresses',
      'tx-count',
      'block-count',
      // 费用与区块
      'fees-total',
      'recommended-fee-rate',
      'block-weight',
      // 矿工与安全
      'hashrate',
      'difficulty',
      'miner-revenue-usd',
    ])
  })

  it('头条指标与走势图指标已注册，且不混在表格里', () => {
    expect(registry.has(HERO_METRIC_ID)).toBe(true)
    expect(registry.has(SPARKLINE_PRICE_METRIC_ID)).toBe(true)
    expect(HOME_METRIC_IDS).not.toContain(HERO_METRIC_ID)
    // 走势图用的价格指标本来就在表里（作为"当前价格"这一行）
    expect(HOME_METRIC_IDS).toContain(SPARKLINE_PRICE_METRIC_ID)
  })

  it('每个首页指标都有状态判定，否则状态列会开天窗', () => {
    const withStatus = new Set(STATUS_SPECS.map((s) => s.metricId))
    for (const id of HOME_METRIC_IDS) {
      expect(withStatus.has(id), `${id} 没有状态判定`).toBe(true)
    }
  })

  it('状态判定没有覆盖到不存在的指标（否则是死配置）', () => {
    for (const spec of STATUS_SPECS) {
      expect(registry.has(spec.metricId), `${spec.metricId} 没有注册`).toBe(true)
    }
  })

  it('自检函数对当前白名单没有异议', () => {
    expect(validateHomeWhitelist()).toEqual([])
  })
})