/**
 * Strategy 与目录补充指标的状态。
 *
 * 不走 BTC 的分位特征。股票涨了不是「偏强」，持仓增加也不是估值结论。
 * 买入 / 卖出只在披露写明交易方向时使用。
 */

import { sessionsAreAdjacent, utcDate } from '../calendar/nyse.js'
import { REALIZED_NEAR_PERCENT } from '../formulas/local.js'
import type { HomeReading, InterpretInput } from '../interpret.js'
import type { StatusFailureReason, StatusTone } from '../status.js'
import type { LocalizedText } from '../status.js'
import type { SeriesPoint } from '../types.js'

const VERSION = 'strategy-read-v1'

function known(points: readonly SeriesPoint[] | undefined): SeriesPoint[] {
  if (!points) return []
  return points.filter((point) => point.value !== null && Number.isFinite(point.value))
}

function text(zh: string, en: string): LocalizedText {
  return { zh, en }
}

function reading(
  metricId: string,
  ruleId: string,
  asOf: number,
  ok: boolean,
  tone: StatusTone,
  word: LocalizedText,
  basis: LocalizedText,
  reason: StatusFailureReason | null,
): HomeReading {
  return {
    metricId,
    ruleId,
    ruleVersion: VERSION,
    asOf,
    basisKind: 'flow',
    ok,
    reason,
    word,
    tone,
    basis,
  }
}

function missing(metricId: string, ruleId: string, basis: LocalizedText): HomeReading {
  return reading(metricId, ruleId, 0, false, 'void', text('缺数据', 'no data'), basis, 'insufficient-history')
}

function monthDay(ts: number): string {
  return utcDate(ts).slice(5)
}

function mstrPrice(input: InterpretInput): HomeReading {
  const points = known(input.series['mstr-price'])
  const last = points.at(-1)
  // 没有报价，和「有报价但比不出涨跌」不是一件事。
  if (!last || last.value === null) return missing('mstr-price', 'mstr-price-v1', text('没有可再分发的收盘', 'no redistributable close'))
  const session = utcDate(last.ts)
  const tape = known(input.series['btc-price-us-close']).at(-1)
  const tapeDay = tape ? utcDate(tape.ts) : null
  // 已发布的美股收盘日比这份简报更晚，说明报价还停在旧交易日。
  // 抓取失败另由快照的 stale 标在数值旁，不在这里把旧收盘说成没有数据。
  if (tapeDay !== null && tapeDay > session) {
    return reading(
      'mstr-price',
      'mstr-price-v1',
      last.ts,
      true,
      'void',
      text('待更新', 'pending'),
      text(`${monthDay(last.ts)}收盘`, `${monthDay(last.ts)} close`),
      null,
    )
  }
  const prev = points.at(-2)
  const prevDay = prev ? utcDate(prev.ts) : null
  if (!prev || prev.value === null || !prevDay || !sessionsAreAdjacent(prevDay, session)) {
    return reading(
      'mstr-price',
      'mstr-price-v1',
      last.ts,
      true,
      'void',
      text('历史不足', 'short'),
      text('无法比较涨跌', 'no comparable close'),
      null,
    )
  }
  const delta = last.value - (prev.value ?? 0)
  const word = delta > 0 ? text('上涨', 'up') : delta < 0 ? text('下跌', 'down') : text('持平', 'flat')
  return reading('mstr-price', 'mstr-price-v1', last.ts, true, 'flat', word, text('较上一收盘', 'vs prior close'), null)
}

function beta(input: InterpretInput): HomeReading {
  const model = input.models?.['mstr-btc-beta-90d']
  const last = known(input.series['mstr-btc-beta-90d']).at(-1)
  const value = last?.value
  if ((model?.quality === 'ok' || model?.quality === 'weak') && value !== undefined && value !== null) {
    if (model.quality === 'weak') {
      return reading(
        'mstr-btc-beta-90d',
        'mstr-beta-v1',
        last?.ts ?? 0,
        true,
        'flat',
        text('低可信', 'low confidence'),
        text('相关偏弱', 'weak correlation'),
        null,
      )
    }
    if (value >= 1.5) {
      return reading('mstr-btc-beta-90d', 'mstr-beta-v1', last?.ts ?? 0, true, 'hot', text('偏强', 'high'), text('90日Beta高于1.5', '90d beta above 1.5'), null)
    }
    if (value > 0.7) {
      return reading('mstr-btc-beta-90d', 'mstr-beta-v1', last?.ts ?? 0, true, 'flat', text('接近', 'near 1'), text('90日Beta接近1', '90d beta near 1'), null)
    }
    if (value > 0) {
      return reading('mstr-btc-beta-90d', 'mstr-beta-v1', last?.ts ?? 0, true, 'cold', text('偏弱', 'low'), text('90日Beta低于0.7', '90d beta below 0.7'), null)
    }
    return reading('mstr-btc-beta-90d', 'mstr-beta-v1', last?.ts ?? 0, true, 'flat', text('反向', 'inverse'), text('90日Beta为负', '90d beta negative'), null)
  }
  return missing('mstr-btc-beta-90d', 'mstr-beta-v1', text('不足90个交易日', 'under 90 sessions'))
}

function holdings(input: InterpretInput): HomeReading {
  const id = 'strategy-btc-holdings'
  const points = known(input.series[id])
  const last = points.at(-1)
  if (!last || last.value === null) return missing(id, 'holdings-v1', text('没有持仓披露', 'no holdings filing'))
  const prev = points.at(-2)
  const seriesDelta = prev && prev.value !== null ? last.value - prev.value : null
  const model = input.models?.[id]
  const filed = model?.btcDelta
  // 相邻两周的持仓差必须等于本期披露。中间缺了几周时，序列差是多周合计，
  // 不能拿它去否定文件里写明的本期数量。
  const gapDays = prev ? (last.ts - prev.ts) / 86_400 : null
  const adjacent = gapDays !== null && gapDays > 0 && gapDays <= 10
  if (adjacent && seriesDelta !== null && filed !== undefined && Math.round(seriesDelta) !== Math.round(filed)) {
    return missing(id, 'holdings-v1', text('增减与披露不符', 'filing disagrees'))
  }
  const delta = filed ?? seriesDelta
  const klass =
    model?.deltaClass ??
    (delta === null ? null : delta > 0 ? 'buy' : delta < 0 ? 'adjustment' : 'unchanged')
  if (klass === 'buy' && delta !== null && delta > 0) {
    return reading(id, 'holdings-v1', last.ts, true, 'buy', text('买入', 'bought'), text(`本期 +${Math.round(delta)} BTC`, `+${Math.round(delta)} BTC`), null)
  }
  if (klass === 'sell' && delta !== null && delta < 0) {
    return reading(id, 'holdings-v1', last.ts, true, 'sell', text('卖出', 'sold'), text(`本期 ${Math.round(delta)} BTC`, `${Math.round(delta)} BTC`), null)
  }
  if (klass === 'adjustment') {
    return reading(id, 'holdings-v1', last.ts, true, 'flat', text('调整', 'adjustment'), text('不是公开市场卖出', 'not a market sale'), null)
  }
  if (klass === 'unchanged' || delta === 0) {
    return reading(id, 'holdings-v1', last.ts, true, 'flat', text('未动', 'unchanged'), text('持仓没有变化', 'holdings unchanged'), null)
  }
  return missing(id, 'holdings-v1', text('没有上期对照', 'no prior filing'))
}

function perShare(input: InterpretInput): HomeReading {
  const id = 'strategy-btc-per-share'
  const points = known(input.series[id])
  const last = points.at(-1)
  const prev = points.at(-2)
  if (!last || last.value === null || !prev || prev.value === null) {
    return missing(id, 'bps-v1', text('没有可比的两次披露', 'no comparable pair'))
  }
  const diff = Math.round(last.value - prev.value)
  if (diff > 0) {
    return reading(id, 'bps-v1', last.ts, true, 'flat', text('增厚', 'thicker'), text(`较上次多${diff}聪`, `+${diff} sats`), null)
  }
  if (diff < 0) {
    return reading(id, 'bps-v1', last.ts, true, 'flat', text('摊薄', 'thinner'), text(`较上次少${Math.abs(diff)}聪`, `${diff} sats`), null)
  }
  return reading(id, 'bps-v1', last.ts, true, 'flat', text('未变', 'unchanged'), text('每股聪数没变', 'sats per share unchanged'), null)
}

function shares(id: string, happened: string, happenedEn: string, none: string, noneEn: string, input: InterpretInput): HomeReading {
  const last = known(input.series[id]).at(-1)
  if (!last || last.value === null) return missing(id, `${id}-v1`, text('没有本期披露', 'no current filing'))
  if (last.value > 0) {
    return reading(id, `${id}-v1`, last.ts, true, 'flat', text(happened, happenedEn), text(`本期${Math.round(last.value)}股`, `${Math.round(last.value)} shares`), null)
  }
  return reading(id, `${id}-v1`, last.ts, true, 'flat', text(none, noneEn), text('本期没有发生', 'none this period'), null)
}

function unrealized(input: InterpretInput): HomeReading {
  const id = 'strategy-btc-unrealized'
  const last = known(input.series[id]).at(-1)
  if (!last || last.value === null) return missing(id, 'unrealized-v1', text('没有可比的市价', 'no mark price'))
  if (last.value > 0) {
    return reading(id, 'unrealized-v1', last.ts, true, 'flat', text('浮盈', 'gain'), text('市值高于成本', 'market above cost'), null)
  }
  if (last.value < 0) {
    return reading(id, 'unrealized-v1', last.ts, true, 'flat', text('浮亏', 'loss'), text('市值低于成本', 'market below cost'), null)
  }
  return reading(id, 'unrealized-v1', last.ts, true, 'flat', text('持平', 'flat'), text('市值等于成本', 'market equals cost'), null)
}

function costGap(pct: number): string {
  const abs = Math.abs(pct)
  return abs >= 10 ? abs.toFixed(0) : abs.toFixed(1)
}

function cost(input: InterpretInput): HomeReading {
  const id = 'strategy-btc-cost'
  const last = known(input.series[id]).at(-1)
  if (!last || last.value === null || !(last.value > 0)) return missing(id, 'cost-v1', text('没有披露均价', 'no stated average'))
  const price = known(input.series['price']).at(-1)
  if (!price || price.value === null || !(price.value > 0)) {
    return reading(id, 'cost-v1', last.ts, true, 'flat', text('均价', 'average'), text('没有可比现价', 'no market price'), null)
  }
  const pct = (price.value / last.value - 1) * 100
  const shown = costGap(pct)
  if (Math.abs(pct) < REALIZED_NEAR_PERCENT) {
    return reading(id, 'cost-v1', last.ts, true, 'flat', text('接近', 'near'), text(`现价相差 ${shown}%`, `${shown}% from cost`), null)
  }
  if (pct > 0) {
    return reading(id, 'cost-v1', last.ts, true, 'flat', text('成本上', 'above'), text(`现价高于成本 ${shown}%`, `${shown}% above cost`), null)
  }
  return reading(id, 'cost-v1', last.ts, true, 'flat', text('成本下', 'below'), text(`现价低于成本 ${shown}%`, `${shown}% below cost`), null)
}

function mnav(input: InterpretInput): HomeReading {
  const id = 'strategy-mnav'
  const last = known(input.series[id]).at(-1)
  if (!last || last.value === null) return missing(id, 'mnav-v1', text('没有公司披露值', 'no disclosed mNAV'))
  const shown = last.value.toFixed(2)
  if (last.value > 1) {
    return reading(id, 'mnav-v1', last.ts, true, 'flat', text('溢价', 'premium'), text(`公司披露${shown}倍`, `disclosed ${shown}x`), null)
  }
  if (last.value < 1) {
    return reading(id, 'mnav-v1', last.ts, true, 'flat', text('折价', 'discount'), text(`公司披露${shown}倍`, `disclosed ${shown}x`), null)
  }
  return reading(id, 'mnav-v1', last.ts, true, 'flat', text('平价', 'par'), text(`公司披露${shown}倍`, `disclosed ${shown}x`), null)
}

function dollars(id: string, word: LocalizedText, input: InterpretInput): HomeReading {
  const last = known(input.series[id]).at(-1)
  if (!last || last.value === null) return missing(id, `${id}-v1`, text('没有本期披露', 'no current filing'))
  const yi = last.value / 1e8
  const shown = yi >= 10 ? yi.toFixed(1) : yi.toFixed(2)
  return reading(id, `${id}-v1`, last.ts, true, 'flat', word, text(`${shown}亿美元`, `$${shown}亿`), null)
}

function usClose(input: InterpretInput): HomeReading {
  const last = known(input.series['btc-price-us-close']).at(-1)
  if (!last) return missing('btc-price-us-close', 'us-close-v1', text('没有收盘时刻价格', 'no session price'))
  return reading('btc-price-us-close', 'us-close-v1', last.ts, true, 'flat', text('收盘', 'close'), text('对齐美股收盘', 'US equity close'), null)
}

function dca(input: InterpretInput): HomeReading {
  const last = known(input.series['dca-max-wait-days']).at(-1)
  if (!last || last.value === null) return missing('dca-max-wait-days', 'dca-catalog-v1', text('历史不足', 'short history'))
  return reading('dca-max-wait-days', 'dca-catalog-v1', last.ts, true, 'flat', text('等待', 'wait'), text(`${Math.round(last.value)}天`, `${Math.round(last.value)} days`), null)
}

/** 这些 id 有自己的读法。其它 id 返回 null，交给原有规则或目录里的 30 日变化。 */
export function strategyReading(metricId: string, input: InterpretInput): HomeReading | null {
  switch (metricId) {
    case 'mstr-price':
      return mstrPrice(input)
    case 'mstr-btc-beta-90d':
      return beta(input)
    case 'strategy-btc-holdings':
      return holdings(input)
    case 'strategy-btc-per-share':
      return perShare(input)
    case 'mstr-common-issuance':
      return shares('mstr-common-issuance', '发行', 'issued', '未发行', 'none', input)
    case 'strc-repurchase':
      return shares('strc-repurchase', '回购', 'repurchased', '未回购', 'none', input)
    case 'strategy-btc-unrealized':
      return unrealized(input)
    case 'strategy-btc-cost':
      return cost(input)
    case 'strategy-mnav':
      return mnav(input)
    case 'strategy-usd-reserve':
      return dollars('strategy-usd-reserve', text('储备', 'reserve'), input)
    case 'strategy-usd-cash':
      return dollars('strategy-usd-cash', text('现金', 'cash'), input)
    case 'btc-price-us-close':
      return usClose(input)
    case 'dca-max-wait-days':
      return dca(input)
    default:
      return null
  }
}
