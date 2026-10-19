/**
 * 口径语义词表。
 *
 * 这些字符串会在**指标定义**与**适配器实现**两侧各出现一次，
 * 而契约比对 `assertContractCompatible` 对 `labelSemantics` 做全等比较——
 * 任何一侧手写偏一个字符，抓取就会以"口径不兼容"中止。
 * 因此集中定义在这里，两侧都从这里取，禁止各写各的。
 */

export const LABEL_SEMANTICS = {
  /** 不涉及任何实体标注（客观统计） */
  none: 'n/a',
  /**
   * 数据源自有的交易所地址聚类。
   *
   * 聚类是启发式：地址归属可能错、可能随数据商更新而变化。
   * 因此所有依赖它的指标 `labelConfidence` 只能填 `heuristic`，
   * 文案里禁止出现"指 / 即 / 定义为"这类下定义表述。
   */
  exchangeCluster: 'provider exchange-address cluster labels',
  /**
   * mempool.space 的矿池归属标注。
   *
   * 来源于 coinbase 交易内的矿池标识标签，属启发式标注。
   */
  poolAttribution: 'mempool.space pool attribution labels',
} as const

export type LabelSemanticsKey = keyof typeof LABEL_SEMANTICS
