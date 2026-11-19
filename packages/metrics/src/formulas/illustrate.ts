/**
 * 相同金额的局部线性演示。
 *
 * 只回答「如果 BTC 的简单收益率是 5%，回归里的 Beta 那一项对应多少钱」。
 * 不加截距，不加残差，不把 Beta 换成明天的预测。
 * 真实持有路径是另一件事，样本不够 91 个收盘时不算。
 */

import { sessionCloseUtc } from '../calendar/nyse.js'

export const ILLUSTRATION_NOTIONAL_USD = 1000
export const ILLUSTRATION_BTC_RETURN = 0.05

export type BetaIllustration = Readonly<{
  notional: number
  btcReturn: number
  btcPnl: number
  sensitivityPnl: number
}>

export function betaIllustration(
  beta: number,
  btcReturn = ILLUSTRATION_BTC_RETURN,
  notional = ILLUSTRATION_NOTIONAL_USD,
): BetaIllustration | null {
  if (!Number.isFinite(beta) || !Number.isFinite(btcReturn) || !Number.isFinite(notional) || notional <= 0) {
    return null
  }
  return {
    notional,
    btcReturn,
    btcPnl: notional * btcReturn,
    sensitivityPnl: notional * beta * btcReturn,
  }
}

export type PathBacktest = Readonly<{
  notional: number
  sessions: number
  from: string
  to: string
  btcPnl: number
  mstrPnl: number
}>

type Close = Readonly<{ ts: number; value: number | null }>

/**
 * 用同一段对齐收盘重放 1000 美元。
 * 这是价格路径本身，不是 Beta 乘出来的。少于 91 个收盘就返回 null。
 */
export function pathBacktest(
  mstr: readonly Close[],
  btc: readonly Close[],
  notional = ILLUSTRATION_NOTIONAL_USD,
): PathBacktest | null {
  const btcByTs = new Map<number, number>()
  for (const point of btc) {
    if (point.value !== null && Number.isFinite(point.value) && point.value > 0) btcByTs.set(point.ts, point.value)
  }
  const aligned: { ts: number; mstr: number; btc: number }[] = []
  for (const point of mstr) {
    if (point.value === null || !Number.isFinite(point.value) || point.value <= 0) continue
    if (sessionCloseUtc(new Date(point.ts * 1000).toISOString().slice(0, 10)) !== point.ts) continue
    const btcPrice = btcByTs.get(point.ts)
    if (btcPrice === undefined) continue
    aligned.push({ ts: point.ts, mstr: point.value, btc: btcPrice })
  }
  aligned.sort((a, b) => a.ts - b.ts)
  if (aligned.length < 91) return null
  const window = aligned.slice(-91)
  const first = window[0]
  const last = window[window.length - 1]
  if (!first || !last) return null
  return {
    notional,
    sessions: window.length,
    from: new Date(first.ts * 1000).toISOString().slice(0, 10),
    to: new Date(last.ts * 1000).toISOString().slice(0, 10),
    btcPnl: notional * (last.btc / first.btc - 1),
    mstrPnl: notional * (last.mstr / first.mstr - 1),
  }
}
