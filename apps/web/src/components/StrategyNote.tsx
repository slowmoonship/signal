/**
 * Strategy 详情页上多出来的那几句。
 *
 * 公式本身仍在指标定义里。这里只把披露日期、报价类型和 Beta 演示
 * 从同一份快照里摊开，避免和「这个数说明了什么」粘成一段。
 */

import {
  betaIllustration,
  closesToSessions,
  formatSignedPercent,
  formatValue,
  MSTR_KNOWN_SPLITS,
  MSTR_SMA_VERSION,
  pathBacktest,
  sessionCloseUtc,
  sessionSma,
  SITE_LOCALE,
  utcDate,
  type MetricModel,
  type SeriesPoint,
} from '@slowmoonship/metrics'

import { loadMetric } from '@/data/load'
import { getDictionary } from '@/i18n/dictionaries'

const QUOTE = {
  close: 'quoteClose',
  regular: 'quoteRegular',
  pre: 'quotePre',
  post: 'quotePost',
} as const

export function StrategyNote({ id, model }: { readonly id: string; readonly model: MetricModel | undefined }) {
  const t = getDictionary()
  const quote = model?.quoteType ? t[QUOTE[model.quoteType]] : null
  const beta = id === 'mstr-btc-beta-90d' ? <BetaNote model={model} /> : null
  const dates = model?.filedOn || model?.asOf || model?.periodStart ? <DateNote model={model} /> : null
  if (!quote && !beta && !dates && id !== 'strategy-btc-per-share' && id !== 'strategy-btc-cost' && id !== 'mstr-price') return null

  return (
    <div className="mt-6 max-w-prose space-y-4 bg-surface px-4 py-4 text-sm leading-relaxed text-ink-muted">
      {quote ? (
        <p>
          <span className="font-medium text-ink">{quote}</span>
          {model?.sessionDate ? <span className="ml-2 font-mono text-xs">{model.sessionDate}</span> : null}
        </p>
      ) : null}
      {id === 'mstr-price' ? <SmaNote /> : null}
      {id === 'mstr-price' ? <TradingViewLink /> : null}
      {id === 'strategy-btc-per-share' ? (
        <p>每股聪数是公司按假定稀释股数写明的数字。它不是总持仓除以基本股。</p>
      ) : null}
      {id === 'strategy-btc-cost' ? <CostClocks model={model} /> : null}
      {dates}
      {beta}
    </div>
  )
}

function SmaNote() {
  const price = loadMetric('mstr-price')
  const tape = loadMetric('btc-price-us-close')
  const points = price.ok ? price.value.points : []
  const latest = sessionSma(closesToSessions(points), MSTR_KNOWN_SPLITS).latest
  if (!latest) return <p>尚无足够的连续交易日行情计算50日均线</p>
  const tapePoint = tape.ok ? [...tape.value.points].reverse().find((point) => point.value !== null) : undefined
  const tapeDay = tapePoint ? utcDate(tapePoint.ts) : null
  if (tapeDay !== null && tapeDay > latest.session) {
    return (
      <p>
        50日均线可以按 {latest.session} 的收盘计算，但这份行情已经落后于 {tapeDay}。这里不把它写成当前趋势。
      </p>
    )
  }
  const deviation = formatSignedPercent(latest.deviationPercent, SITE_LOCALE) ?? '—'
  return (
    <div className="space-y-2">
      <p>
        50日均线 {formatValue(latest.sma, { kind: 'usd' }, SITE_LOCALE)}，偏离 {deviation}。
      </p>
      <p className="font-mono text-xs">
        截至 {latest.session} · {MSTR_SMA_VERSION} · 简报收盘，拆股后
      </p>
      <p>算术平均用截止当天的连续 50 个开市日。相差不到 1% 写成接近。这是收盘相对均线的位置，不是买卖建议。</p>
    </div>
  )
}

function TradingViewLink() {
  return (
    <div className="space-y-2">
      <p className="font-medium text-ink">第三方行情</p>
      <p>
        本页价格只保存公司简报里写明的收盘。纳斯达克 MSTR 的行情在 TradingView 查看，报价有延迟，由对方提供。它不是本站的股票行情接口，页面也不从那里取数，弹性计算也不使用它。
      </p>
      <p>
        <a
          className="text-ink underline"
          href="https://www.tradingview.com/symbols/NASDAQ-MSTR/"
          target="_blank"
          rel="noopener noreferrer"
        >
          TradingView 上的 NASDAQ:MSTR
        </a>
      </p>
    </div>
  )
}

function CostClocks({ model }: { readonly model: MetricModel | undefined }) {
  const price = loadMetric('price')
  const cost = loadMetric('strategy-btc-cost')
  const pricePoint = price.ok ? [...price.value.points].reverse().find((point) => point.value !== null) : undefined
  const costPoint = cost.ok ? [...cost.value.points].reverse().find((point) => point.value !== null) : undefined
  const priceDay = pricePoint ? new Date(pricePoint.ts * 1000).toISOString().slice(0, 10) : null
  const costDay = costPoint ? new Date(costPoint.ts * 1000).toISOString().slice(0, 10) : null
  return (
    <div className="space-y-2">
      <p>
        持仓均价只在新的 SEC 披露里变化。下面的比较用最新 UTC 日均价对最新披露均价，两个日期不必是同一天。
      </p>
      <p className="font-mono text-xs text-ink">
        {costPoint ? `披露均价 ${formatValue(costPoint.value, { kind: 'usd' }, SITE_LOCALE)}` : '没有披露均价'}
        {costDay ? ` · 截至 ${costDay}` : ''}
        {pricePoint ? ` · 日均价 ${formatValue(pricePoint.value, { kind: 'usd' }, SITE_LOCALE)}` : ''}
        {priceDay ? ` · 截至 ${priceDay}` : ''}
      </p>
      {model?.marketUsd !== undefined && model.sessionDate ? (
        <p className="font-mono text-xs">
          美股收盘时刻的 BTC {formatValue(model.marketUsd, { kind: 'usd' }, SITE_LOCALE)} · {model.sessionDate}
          。这是持仓截止日当天或之前的收盘，不是上面的日均价。
        </p>
      ) : null}
    </div>
  )
}

function DateNote({ model }: { readonly model: MetricModel | undefined }) {
  if (!model) return null
  const period = model.periodStart && model.periodEnd ? `${model.periodStart} 至 ${model.periodEnd}` : null
  const href = model.accession
    ? `https://www.sec.gov/Archives/edgar/data/1050446/${model.accession.replaceAll('-', '')}/${model.accession}-index.html`
    : null
  return (
    <p className="font-mono text-xs">
      {model.asOf ? <span>持仓截止 {model.asOf}</span> : null}
      {model.filedOn ? <span className="ml-3">申报 {model.filedOn}</span> : null}
      {period ? <span className="ml-3">区间 {period}</span> : null}
      {model.sessionDate && model.asOf && model.sessionDate !== model.asOf ? (
        <span className="ml-3">市价收盘 {model.sessionDate}</span>
      ) : null}
      {href ? (
        <a className="ml-3 text-ink underline" href={href} target="_blank" rel="noreferrer noopener">
          SEC
        </a>
      ) : null}
    </p>
  )
}

function BetaNote({ model }: { readonly model: MetricModel | undefined }) {
  const t = getDictionary()
  const mstr = loadMetric('mstr-price')
  const btc = loadMetric('btc-price-us-close')
  const aligned = align(mstr.ok ? mstr.value.points : [], btc.ok ? btc.value.points : [])
  const demo =
    (model?.quality === 'ok' || model?.quality === 'weak') && model.beta !== undefined
      ? betaIllustration(model.beta)
      : null
  const path =
    mstr.ok && btc.ok ? pathBacktest(mstr.value.points, btc.value.points) : null
  return (
    <div className="space-y-4">
      <p>
        窗口是 90 个美股交易日。样本 {model?.samples ?? 0} 个
        {model?.r2 !== undefined ? `，R² ${model.r2.toFixed(2)}` : '，R² 未计算'}。
        {model?.reason ? ` ${model.reason}` : ` ${t.betaBlocked}`}
      </p>
      <p>这是历史统计敏感度，不是固定杠杆，也不是同样的钱能买到多少倍比特币。</p>
      {demo ? (
        <div className="border border-rule bg-surface px-3 py-3">
          <p className="font-medium text-ink">{t.betaDemoTitle}</p>
          <p className="mt-2">
            以 {formatValue(demo.notional, { kind: 'usd' }, SITE_LOCALE)} 为例。若 BTC 简单收益率是 +5%，直接持有
            BTC 的变化是 {formatValue(demo.btcPnl, { kind: 'usd' }, SITE_LOCALE)}。按当前历史 Beta，MSTR
            里对应 BTC 的那一项大约是 {formatValue(demo.sensitivityPnl, { kind: 'usd' }, SITE_LOCALE)}。
          </p>
          <p className="mt-2 text-xs">
            这只含回归里的敏感度一项，不含截距、残差、以后 Beta 的变化和股票自己的风险，不是对未来收益的预测。
          </p>
        </div>
      ) : null}
      {path ? (
        <div className="border border-rule bg-surface px-3 py-3">
          <p className="font-medium text-ink">{t.betaPathTitle}</p>
          <p className="mt-2 font-mono text-xs">
            {path.from} 至 {path.to} · BTC {formatValue(path.btcPnl, { kind: 'usd' }, SITE_LOCALE)} · MSTR{' '}
            {formatValue(path.mstrPnl, { kind: 'usd' }, SITE_LOCALE)}
          </p>
          <p className="mt-2 text-xs">这是同一段收盘价走出来的结果，不是上面的 Beta 演示。</p>
        </div>
      ) : null}
      {aligned.length > 0 ? (
        <div>
          <p className="font-medium text-ink">{t.alignedCloses}</p>
          <table className="mt-2 w-full font-mono text-xs">
            <tbody>
              {aligned.map((row) => (
                <tr key={row.ts}>
                  <td className="py-1 pr-3">{row.session}</td>
                  <td className="py-1 pr-3 text-right">{formatValue(row.mstr, { kind: 'usd' }, SITE_LOCALE)}</td>
                  <td className="py-1 text-right">BTC {formatValue(row.btc, { kind: 'usd' }, SITE_LOCALE)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {aligned.length >= 2 && aligned[0] && aligned.at(-1) ? (
            <p className="mt-2 text-xs">
              从 {aligned[0].session} 到 {aligned.at(-1)?.session}，MSTR{' '}
              {formatSignedPercent((aligned.at(-1)?.mstr ?? aligned[0].mstr) / aligned[0].mstr - 1, SITE_LOCALE)}
              ，BTC {formatSignedPercent((aligned.at(-1)?.btc ?? aligned[0].btc) / aligned[0].btc - 1, SITE_LOCALE)}
              。这不是 90 日回归。
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function align(mstr: readonly SeriesPoint[], btc: readonly SeriesPoint[]) {
  const btcByTs = new Map<number, number>()
  for (const point of btc) {
    if (point.value !== null && point.value > 0) btcByTs.set(point.ts, point.value)
  }
  const rows: { ts: number; session: string; mstr: number; btc: number }[] = []
  for (const point of mstr) {
    if (point.value === null || point.value <= 0) continue
    const session = new Date(point.ts * 1000).toISOString().slice(0, 10)
    if (sessionCloseUtc(session) !== point.ts) continue
    const price = btcByTs.get(point.ts)
    if (price === undefined) continue
    rows.push({ ts: point.ts, session, mstr: point.value, btc: price })
  }
  return rows.sort((a, b) => a.ts - b.ts)
}
