/**
 * UI 文案字典（ADR-008：自建 i18n，不引入 next-intl）。
 *
 * 只有两种语言，自建足够。指标自己的文案在 `packages/metrics` 的定义里，
 * 本文件只放**页面框架**的词条——两者不得互相重复。
 *
 * 组件里禁止写死文案：一律 `t()` 或直接取指标定义里的 `{ en, zh }`。
 */

import { LOCALES, type Locale } from '@slowmoonship/metrics'

export type Dictionary = Readonly<{
  siteTitle: string
  tagline: string
  index: string
  categories: Readonly<Record<'market' | 'onchain' | 'fees' | 'mining', string>>
  updatedAt: string
  sourceTime: string
  ingestedAt: string
  stale: string
  staleExplanation: string
  noData: string
  noDataHint: string
  invalidFile: string
  change7d: string
  changeWindow: string
  whatItMeasures: string
  howItIsCalculated: string
  dataSource: string
  history: string
  historyFrom: string
  historyUnknownStart: string
  mayBeRevised: string
  warnings: string
  methodNotDerived: string
  computedLocally: string
  derivation: string
  labelConfidence: Readonly<Record<'verified' | 'heuristic' | 'unknown', string>>
  labelConfidenceNote: string
  labelHeuristicNote: string
  chartNoData: string
  chartSinglePoint: string
  chartWindow: string
  chartLatest: string
  fixtureBanner: string
  unitNote: string
  footerNote: string
  skipToContent: string
  notFoundTitle: string
  notFoundBody: string
  backToIndex: string
}>

const en: Dictionary = {
  siteTitle: 'Signal',
  tagline: 'Market and on-chain metrics for Bitcoin',
  index: 'Index',
  categories: {
    market: 'Market',
    onchain: 'On-chain activity',
    fees: 'Fees and blocks',
    mining: 'Hashrate and mining',
  },
  updatedAt: 'updated',
  sourceTime: 'Source time',
  ingestedAt: 'Collected',
  stale: 'Update failed',
  staleExplanation:
    'The most recent collection attempt did not succeed. The values shown are the last valid snapshot, kept unchanged.',
  noData: 'no data',
  noDataHint: 'No snapshot has been collected for this metric yet.',
  invalidFile: 'Published file failed validation',
  change7d: '7d',
  changeWindow: 'change over 7 days',
  whatItMeasures: 'What this measures',
  howItIsCalculated: 'How it is calculated',
  dataSource: 'Data source',
  history: 'History',
  historyFrom: 'Available from',
  historyUnknownStart: 'Start date unknown',
  mayBeRevised: 'The source may restate past values.',
  warnings: 'Notes',
  methodNotDerived: 'Reported directly by the source; Signal performs no arithmetic on it.',
  computedLocally:
    'Computed by Signal from the figures in this response — the source publishes the underlying numbers, not this value.',
  derivation: 'Computed by Signal',
  labelConfidence: {
    verified: 'Verified',
    heuristic: 'Heuristic label',
    unknown: 'Unknown',
  },
  labelConfidenceNote: 'Label confidence',
  labelHeuristicNote:
    'Entity labels are the data source’s own attribution, not a fact recorded on chain.',
  chartNoData: 'No values in the loaded snapshot.',
  chartSinglePoint:
    'This metric is sampled once a day, so the loaded snapshot holds a single value. History grows one point per day.',
  chartWindow: 'shown range',
  chartLatest: 'latest',
  fixtureBanner: 'Fixture data — synthetic, generated locally for development. Not real market data.',
  unitNote: 'Values are daily and UTC. Missing days are left blank; they are never filled with zero.',
  footerNote: 'Daily snapshots. No live data, no polling.',
  skipToContent: 'Skip to content',
  notFoundTitle: 'Not found',
  notFoundBody: 'No such metric.',
  backToIndex: 'Back to index',
}

const zh: Dictionary = {
  siteTitle: 'Signal',
  tagline: '比特币市场与链上指标目录',
  index: '目录',
  categories: {
    market: '市场',
    onchain: '链上活动',
    fees: '费用与区块',
    mining: '算力与挖矿',
  },
  updatedAt: '更新于',
  sourceTime: '来源时间',
  ingestedAt: '采集时间',
  stale: '抓取失败',
  staleExplanation:
    '最近一次抓取未成功。下列数值是上一份有效快照，原样保留，未做任何修改。',
  noData: '暂无数据',
  noDataHint: '该指标尚未采集到任何快照。',
  invalidFile: '发布文件未通过校验',
  change7d: '7 日',
  changeWindow: '7 日变化',
  whatItMeasures: '这个数说明了什么',
  howItIsCalculated: '怎么算出来的',
  dataSource: '数据来源',
  history: '历史口径',
  historyFrom: '可得起点',
  historyUnknownStart: '起点未知',
  mayBeRevised: '数据源可能重算历史值。',
  warnings: '备注',
  methodNotDerived: '由数据源直接给出，Signal 不做任何运算。',
  computedLocally: '由 Signal 依据该响应中的原始数据算出——数据源发布的是构成这个数的各项，而不是这个数本身。',
  derivation: '由 Signal 计算',
  labelConfidence: {
    verified: '已核实',
    heuristic: '启发式标注',
    unknown: '不清楚',
  },
  labelConfidenceNote: '标注可信度',
  labelHeuristicNote: '实体标签是数据源自己的归类方式，不是链上可查的事实。',
  chartNoData: '这份快照里没有可用数值。',
  chartSinglePoint:
    '该指标每天只采样一次，因此这份快照只有一个点。历史自开始采集之日起每天增加一个点。',
  chartWindow: '显示区间',
  chartLatest: '最新',
  fixtureBanner: 'Fixture 数据 —— 本地合成的开发用数据，不是真实市场数据。',
  unitNote: '数值为日频、UTC。缺失的日期留空，不会用零填充。',
  footerNote: '每日一个快照。无实时数据，不轮询。',
  skipToContent: '跳到正文',
  notFoundTitle: '未找到',
  notFoundBody: '没有这个指标。',
  backToIndex: '返回目录',
}

export const dictionaries: Readonly<Record<Locale, Dictionary>> = { en, zh }

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value)
}

export function getDictionary(locale: Locale): Dictionary {
  return dictionaries[locale]
}

/** 另一种语言（用于切换按钮）。只有两种语言时无需查表。 */
export function otherLocale(locale: Locale): Locale {
  return locale === 'en' ? 'zh' : 'en'
}

const LOCALE_LABEL: Readonly<Record<Locale, string>> = { en: 'English', zh: '中文' }

export function localeLabel(locale: Locale): string {
  return LOCALE_LABEL[locale]
}
