/**
 * 投资者简报里公司自己写明的收盘价、mNAV 和每股聪数。
 *
 * 这些 PDF 不是每日行情。解析失败就当这份简报没有，不拿别的页面上的数字补。
 */

import { parseEnglishDate } from '@slowmoonship/metrics'

export type BriefingExtract = Readonly<{
  price: number | null
  priceSession: string | null
  mnav: number | null
  holdings: number | null
  bpsSats: number | null
  holdingsAsOf: string | null
}>

export function parseBriefing(text: string): BriefingExtract {
  const price = /\$(\d+\.\d{2})[\s\S]{0,160}?MSTR Price/.exec(text)
  const session = /Market data as of ([A-Za-z]+\.?\s+\d{1,2},\s+\d{4}) close/.exec(text)
  const mnav = /(\d+\.\d{2})x[\s\S]{0,400}?mNAV/.exec(text)
  const bps = /BTC Per Share \(Sats\)\s+([\d,]+) sats/.exec(text)
  const holdings = /(\d{3},\d{3})[\s\S]{0,400}?\bBTC\b/.exec(text)
  const asOf = /BTC holdings as of ([A-Za-z]+\.?\s+\d{1,2},\s+\d{4})/.exec(text)
  const priceValue = price?.[1] ? Number(price[1]) : null
  const mnavValue = mnav?.[1] ? Number(mnav[1]) : null
  const holdingsValue = holdings?.[1] ? Number(holdings[1].replace(/,/g, '')) : null
  const bpsValue = bps?.[1] ? Number(bps[1].replace(/,/g, '')) : null
  return {
    price: priceValue !== null && Number.isFinite(priceValue) ? priceValue : null,
    priceSession: session?.[1] ? parseEnglishDate(session[1]) : null,
    mnav: mnavValue !== null && Number.isFinite(mnavValue) ? mnavValue : null,
    holdings: holdingsValue !== null && Number.isFinite(holdingsValue) ? holdingsValue : null,
    bpsSats: bpsValue !== null && Number.isFinite(bpsValue) ? bpsValue : null,
    holdingsAsOf: asOf?.[1] ? parseEnglishDate(asOf[1]) : null,
  }
}
