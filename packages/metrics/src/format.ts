/**
 * 数值格式化。
 *
 * 放在 metrics 包而不是 web，是因为"这个指标该怎么显示"是指标定义的一部分
 * （`FormatSpec`），而 web 层不允许硬编码任何指标相关的知识。
 *
 * 一条铁律：**`null` 永远返回 `null`，由调用方决定显示什么。**
 * 在这里把缺失渲染成 "0" 或 "—" 都会让"缺失"和"真实为零"在页面上无法区分，
 * 那是数据质量红线而不是显示偏好。
 */

import type { FormatSpec, Locale, Unit } from './types.js'

/** Intl locale。中文用 zh-CN 是为了拿到习惯的千分位与数字形状 */
const INTL_LOCALE: Readonly<Record<Locale, string>> = { en: 'en-US', zh: 'zh-CN' }

export const MISSING = '—'

/** 单位后缀。中英分列，因为英文单位与符号通常连写，中文需要留空格。 */
export const UNIT_LABELS: Readonly<Record<Unit, Readonly<Record<Locale, string>>>> = {
  btc: { en: 'BTC', zh: 'BTC' },
  usd: { en: 'USD', zh: '美元' },
  count: { en: '', zh: '' },
  hashrate: { en: 'H/s', zh: 'H/s' },
  percent: { en: '%', zh: '%' },
  sat_per_vbyte: { en: 'sat/vB', zh: 'sat/vB' },
  index: { en: '', zh: '' },
  blocks: { en: 'blocks', zh: '个区块' },
}

const HASH_RATE_UNITS: readonly { readonly threshold: number; readonly scale: number }[] = [
  { threshold: 1e18, scale: 1e18 }, // ZH/s
  { threshold: 1e15, scale: 1e15 }, // EH/s
  { threshold: 1e12, scale: 1e12 }, // PH/s
  { threshold: 1e9, scale: 1e9 }, // TH/s
]

function nf(locale: Locale, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  return new Intl.NumberFormat(INTL_LOCALE[locale], options)
}

/**
 * 算力单位自动进位。
 *
 * 全网算力动辄 10^20 H/s，直接显示就是 21 位数字，没人读得动；
 * 但也**不能**为了好读就丢掉量级信息——进位后必须带上单位后缀。
 */
export function formatHashRate(value: number, locale: Locale): string {
  const abs = Math.abs(value)
  for (const { threshold, scale } of HASH_RATE_UNITS) {
    if (abs >= threshold) {
      return `${nf(locale, { maximumFractionDigits: 2 }).format(value / scale)} ${unitForHashRate(scale)}`
    }
  }
  return `${nf(locale, { maximumFractionDigits: 0 }).format(value)} ${UNIT_LABELS.hashrate[locale]}`
}

function unitForHashRate(scale: number): string {
  switch (scale) {
    case 1e18:
      return 'ZH/s'
    case 1e15:
      return 'EH/s'
    case 1e12:
      return 'PH/s'
    case 1e9:
      return 'TH/s'
    default:
      return 'H/s'
  }
}

/**
 * 格式化一个数值。`null` → `null`（调用方决定占位符）。
 */
export function formatValue(value: number | null, spec: FormatSpec, locale: Locale): string | null {
  if (value === null || !Number.isFinite(value)) return null

  switch (spec.kind) {
    case 'int':
      return nf(locale, { maximumFractionDigits: 0 }).format(value)
    case 'decimal':
      return nf(locale, { maximumFractionDigits: spec.maxDecimals }).format(value)
    case 'usd': {
      // 整数值不带小数（市值有 15 位数字，再加 ".00" 只是噪声），
      // 带小数值保留两位。minimum 必须跟着走，否则 12.5 会显示成 "$12.5"。
      const decimals = value % 1 === 0 ? 0 : 2
      return nf(locale, {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      }).format(value)
    }
    case 'btc':
      return `${nf(locale, { maximumFractionDigits: 4 }).format(value)} BTC`
    case 'percent':
      return `${nf(locale, { maximumFractionDigits: spec.maxDecimals ?? 1 }).format(value)}%`
    case 'hashrate':
      return formatHashRate(value, locale)
    case 'satPerVbyte':
      return `${nf(locale, { maximumFractionDigits: 0 }).format(value)} sat/vB`
  }
}

/**
 * 带符号的百分比变化。首页变化列与详情页都用它，
 * 靠显式的 + / − 让读者不必去看列标题。
 */
export function formatSignedPercent(value: number | null, locale: Locale, maxDecimals = 1): string | null {
  if (value === null || !Number.isFinite(value)) return null
  const sign = value > 0 ? '+' : value < 0 ? '−' : ''
  // 小数位固定，否则 "+3%" 与 "+3.8%" 列宽不一致，读起来像两个精度
  const digits = nf(locale, {
    minimumFractionDigits: maxDecimals,
    maximumFractionDigits: maxDecimals,
  }).format(Math.abs(value))
  return `${sign}${digits}%`
}

/**
 * 图表纵轴刻度：与 `formatValue` 同口径，但大数压缩。
 *
 * 轴上放得下 "2.40T" 就没必要放 "2,400,000,000,000"——压缩只在轴上使用，
 * 页面正文里的数值一律走 `formatValue`，不因美观而损失精度。
 */
export function formatAxisTick(value: number, locale: Locale): string {
  const abs = Math.abs(value)
  if (abs >= 1e12) return `${nf(locale, { maximumFractionDigits: 2 }).format(value / 1e12)}T`
  if (abs >= 1e9) return `${nf(locale, { maximumFractionDigits: 2 }).format(value / 1e9)}B`
  if (abs >= 1e6) return `${nf(locale, { maximumFractionDigits: 2 }).format(value / 1e6)}M`
  if (abs >= 1e3) return `${nf(locale, { maximumFractionDigits: 1 }).format(value / 1e3)}K`
  return nf(locale, { maximumFractionDigits: 2 }).format(value)
}

/** 缺失占位。调用方在需要"显示点什么"时才用它，而不是在格式化层。 */
export function formatOrMissing(value: string | null): string {
  return value ?? MISSING
}
