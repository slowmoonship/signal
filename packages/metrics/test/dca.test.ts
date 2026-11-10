/**
 * 定投回测的测试。
 *
 * 这段代码最容易出的错是**静默地偏乐观**：把没达标的起点当成 0 参与取最小值、
 * 遇到缺失日沿用前值、或者把窗口外的起点也算进去。每一种都不会报错，
 * 只会让"最坏要等多久"这个数字偏小——而这正是读者唯一会照着做决定的那个数。
 * 所以下面每一条都在盯"会不会悄悄变小"。
 *
 * 三种结局必须分开数：达标（included）、窗口内始终没达标（censored，右删失）、
 * 因缺价而算不出来（invalidated）。把它们混成一个数，读者就无从判断
 * "最坏要等多久"这个结论建立在多少有效样本上。
 */

import { describe, expect, it } from 'vitest'

import { maxDcaWait, maxDcaWaitSeries, type SeriesPoint } from '../src/index.js'

const DAY = 86_400

/**
 * 序列的**日历天**起点。
 *
 * 不用 1_500_000_000 这种随手写的整数：定投回测按 UTC 日历日对齐，
 * 起点时刻必须落在午夜，否则算出来的"第几天"与日历天差一天。
 */
const T0 = Math.floor(1_500_000_000 / DAY) * DAY

/** 造一条从 T0 起的日频价格序列 */
function series(prices: readonly (number | null)[]): SeriesPoint[] {
  return prices.map((value, i) => ({ ts: T0 + i * DAY, value }))
}

/** 解析真实计算：某起点从第 0 天起，第几天首次超过阈值 */
function manualFirstPassage(
  prices: readonly (number | null)[],
  start: number,
  thresholdPercent: number,
): number | null {
  let shares = 0
  for (let k = start; k < prices.length; k += 1) {
    const p = prices[k]
    if (p === null || p === undefined || p <= 0) return null
    shares += 1 / p
    if ((shares * p) / (k - start + 1) - 1 > thresholdPercent / 100) return k - start
  }
  return null
}

describe('maxDcaWait', () => {
  it('单调上涨：等待极短，且末尾的起点因没有未来数据而删失', () => {
    // 注意 DCA 即使在稳步上涨的市场里也要两天才越过 +5%：
    // 投两天、第二天按更高价卖出，收益才刚好等于单日涨幅的一半。
    // 这是定投的固有性质，不是 bug——所以 0 天在这里并不是"立刻赚钱"。
    const r = maxDcaWait(series([100, 110, 120, 130]), 5, 3650)
    expect(r.maxDays).toBe(2)
    // 末尾两个起点没那么多天涨到 +5%，只能删失——这就是 coverage 存在的理由
    expect(r.included + r.censored).toBe(4)
    expect(r.included).toBe(2)
    expect(r.invalidated).toBe(0)
  })

  it('全程不涨：没有任何起点达标，报 null 而不是 0', () => {
    // 这是最关键的一条：把"永远等不到"写成 0，页面就会显示"0 天就能赚 5%"。
    const r = maxDcaWait(series([100, 100, 100, 100]), 5, 3650)
    expect(r.maxDays).toBeNull()
    expect(r.included).toBe(0)
    expect(r.censored).toBe(4)
    expect(r.invalidated).toBe(0)
  })

  it('下降后回升：最大值落在最早的起点上，与逐起点手算逐一对齐', () => {
    // 100 → 50（腰斩）→ 慢慢爬回 115。早期起点要扛过整段下跌。
    const prices = [100, 90, 70, 50, 60, 75, 90, 100, 105, 110, 112, 115]
    const r = maxDcaWait(series(prices), 5, 3650)

    // 与逐起点手算逐一对齐，避免"公式写错但结果看着合理"
    const perStart = prices.map((_, i) => manualFirstPassage(prices, i, 5))
    const reached = perStart.filter((d): d is number => d !== null)
    // 靠近末尾的起点没那么多天爬到 +5%，必然删失——这正是 coverage 要说的
    expect(perStart.length).toBe(prices.length)
    expect(reached.length + r.censored).toBe(prices.length)

    expect(r.maxDays).toBe(Math.max(...reached))
    expect(r.included).toBe(reached.length)
    expect(r.worstStartTs).toBe(T0)
  })

  it('价格里有缺失日：路径穿过缺失的起点记为作废，绝不插值后当成达标', () => {
    // 两条序列只差一个位置：干净的那天给 100，脏的那天缺失。
    // 只要起点 0 的路径穿过缺失，它就必须整条作废。
    const withNull: (number | null)[] = [100, null, 200, 300, 400]
    const clean: (number | null)[] = [100, 100, 200, 300, 400]

    const a = maxDcaWait(series(withNull), 5, 3650)
    const b = maxDcaWait(series(clean), 5, 3650)

    expect(manualFirstPassage(withNull, 0, 5)).toBeNull()
    expect(manualFirstPassage(clean, 0, 5)).not.toBeNull()

    // 观测总数不变（还是 5 个起点），但起点 0 的路径要穿过缺失的那一天，
    // 整条作废；落在 null **那一天**的起点 1 连起投都做不了，同样作废。
    // 起点 2 之后的路径不再经过那一天，因此不受影响
    expect(a.included + a.censored).toBe(3)
    expect(a.invalidated).toBe(2)
    expect(a.censored).toBe(b.censored)
    expect(a.included).toBe(b.included - 2)
    // 剩下那些起点各自的结果没有被改写：逐起点手算的最大值与实现一致。
    // （两条序列的 maxDays 本来就不同——落进 null 那天之后的起点路径变了，
    //  这正是"排除观测"会影响结论的直观体现，不能拿来做相等断言。）
    const survivors = withNull
      .map((_, i) => ({ i, d: manualFirstPassage(withNull, i, 5) }))
      .filter((x) => x.d !== null && x.i >= 2)
      .map((x) => x.d as number)
    expect(survivors.length).toBe(a.included)
    expect(a.maxDays).toBe(Math.max(...survivors))
  })

  it('窗口外的起点不参与枚举', () => {
    // 早期有一段腰斩（100 → 50），随后长期以 8%/日 上涨。窄窗口只看得到后半段。
    const tail = Array.from({ length: 50 }, (_, i) => 55 * Math.pow(1.08, i + 1))
    const prices: (number | null)[] = [100, 50, 55, ...tail]

    const narrow = maxDcaWait(series(prices), 5, 10)
    expect(narrow.included + narrow.censored).toBe(10)

    const wide = maxDcaWait(series(prices), 5, 3650)
    // 窄窗口落在稳步上涨段，几天就跨过 +5%；
    // 全窗口里起点 0 要扛过腰斩，等待明显更长——这段历史在窗口外时不可见
    expect(narrow.maxDays).toBe(2)
    expect(wide.maxDays).toBe(5)
    expect(wide.worstStartTs).toBe(T0)
    expect(narrow.worstStartTs).not.toBe(T0)
  })

  it('三类观测加起来等于窗口内的日历天数', () => {
    // 对账式断言：读者拿"达标 + 未达标 + 作废"三个数就能复原窗口规模。
    // 少一个数，就意味着有一批起点被静悄悄地丢掉了。
    const prices: (number | null)[] = [100, 95, 90, 85, null, 200, 300, 400, 500, 600]
    const r = maxDcaWait(series(prices), 5, 3650)
    expect(r.included + r.censored + r.invalidated).toBe(prices.length)
    expect(r.invalidated).toBe(5)
  })

  it('阈值 ≤ −100% 直接拒绝，而不是空转十年算出一个数', () => {
    const r = maxDcaWait(series([100, 200, 300]), -100, 3650)
    expect(r.maxDays).toBeNull()
    expect(r.included).toBe(0)
    expect(r.censored).toBe(0)
  })
})

describe('maxDcaWait 的最坏路径', () => {
  it('给出起点日、首次达标日、经过天数与最深浮亏', () => {
    // 100 → 腰斩 → 慢慢爬回：起点当天就是最深浮亏，之后才首次越过阈值
    const prices = [100, 90, 70, 50, 60, 75, 90, 100, 105, 110, 112, 115]
    const r = maxDcaWait(series(prices), 5, 3650)
    expect(r.worstStartTs).toBe(T0)
    expect(r.maxDays).not.toBeNull()
    // 首次达标日 = 起点日 + 等待天数，两个数必须自洽
    expect(r.firstPassageTs).toBe((r.worstStartTs as number) + (r.maxDays as number) * DAY)
    // 最深浮亏必然是负数，且不会低于 −100%
    expect(r.maxDrawdownPercent).not.toBeNull()
    expect(r.maxDrawdownPercent as number).toBeLessThan(0)
    expect(r.maxDrawdownPercent as number).toBeGreaterThan(-100)
  })

  it('没有任何起点达标时，最坏路径也是 null，不给出一个编造的区间', () => {
    const r = maxDcaWait(series([100, 100, 100, 100]), 5, 3650)
    expect(r.worstStartTs).toBeNull()
    expect(r.firstPassageTs).toBeNull()
    expect(r.maxDrawdownPercent).toBeNull()
  })
})

describe('maxDcaWaitSeries', () => {
  const prices = [100, 90, 70, 50, 60, 75, 90, 100, 105, 110, 112, 115]

  it('历史长度不足以填满窗口时返回空序列', () => {
    const r = maxDcaWaitSeries(series(prices), 5, 3650)
    expect(r.series).toEqual([])
  })

  it('每个 as-of 日都给出当日口径的答案，不是一条平线', () => {
    const window = 8
    const { series: out } = maxDcaWaitSeries(series(prices), 5, window)
    // 12 天数据、8 天窗口 → as-of 下标 7..11 共 5 个点
    expect(out).toHaveLength(5)
    // 早期 as-of 覆盖不到下跌段，最大等待应小于覆盖全程时的最大等待
    const full = maxDcaWait(series(prices), 5, prices.length)
    const first = out[0]
    expect(first?.value).not.toBeNull()
    expect(first?.value as number).toBeLessThanOrEqual(full.maxDays as number)
    // 且随窗口后移，答案应当变化——否则历史图就是一根直棍
    expect(new Set(out.map((p) => p.value)).size).toBeGreaterThan(1)
  })

  it('coverage 记的是最后一个 as-of 日的参与与删失数', () => {
    const flat = Array.from({ length: 40 }, () => 100)
    const { series: out, coverage } = maxDcaWaitSeries(series(flat), 5, 10)
    expect(coverage.included).toBe(0)
    expect(coverage.censored).toBe(10)
    expect(coverage.invalidated).toBe(0)
    // 没有任何起点达标时如实写 null，不写 0
    expect(out.every((p) => p.value === null)).toBe(true)
  })

  it('时间戳对齐到 UTC 日历日', () => {
    // 回测按**日历日**定义"第几天"，输出时间戳因此必须是 UTC 午夜。
    // 若沿用输入序列的时刻戳，一个非午夜起点的序列会被读成"早了一天"。
    const { series: out } = maxDcaWaitSeries(series(prices), 5, 8)
    expect(out[0]?.ts).toBe(T0 + 7 * DAY)
    expect(out[4]?.ts).toBe(T0 + 11 * DAY)
    for (const p of out) expect(p.ts % DAY).toBe(0)
  })

  it('worstCase 与最后一个 as-of 日的结果一致', () => {
    // 绿色高亮区间直接取自这里的推导结果，不允许图表另算一套
    const { series: out, worstCase } = maxDcaWaitSeries(series(prices), 5, 8)
    const last = out[out.length - 1]
    expect(worstCase).not.toBeNull()
    expect(worstCase?.days).toBe(last?.value)
    expect(worstCase?.passageTs).toBe((worstCase?.startTs as number) + (worstCase?.days as number) * DAY)
  })
})
