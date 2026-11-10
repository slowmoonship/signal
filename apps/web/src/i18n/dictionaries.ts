/**
 * UI 文案字典（ADR-008：自建 i18n，不引入 next-intl）。
 *
 * **V0.1 起只有中文**（ADR-021）：站点不提供英文界面，页头没有语言切换，
 * `/en` 也不再生成——因此这个文件里只有一份字典，
 * 也不再需要 `isLocale` / `otherLocale` 这类查表函数。
 *
 * 指标自己的文案仍在 `packages/metrics` 的定义里（那里保留 en/zh 双语，
 * 便于将来恢复），本文件只放**页面框架**的词条——两者不得互相重复。
 *
 * 组件里禁止写死文案：一律 `t()` 或直接取指标定义里的 `{ en, zh }`。
 */

import { type HomeGroupKey, type MetricCategory } from '@slowmoonship/metrics'

export type Dictionary = Readonly<{
  siteTitle: string
  tagline: string
  index: string
  categories: Readonly<Record<MetricCategory, string>>
  /** 首页表格的展示分组名。与注册表分类不是一回事。 */
  homeGroups: Readonly<Record<HomeGroupKey, string>>
  updatedAt: string
  sourceTime: string
  ingestedAt: string
  stale: string
  staleExplanation: string
  /** 快照过期横幅（首页）。日更站点的数据不是实时的，过期时必须自己说出来。 */
  snapshotOutdated: string
  snapshotOutdatedNote: string
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
  /** 数据许可的标签（详情页"数据来源"块） */
  licenseLabel: string
  labelHeuristicNote: string
  chartNoData: string
  chartSinglePoint: string
  chartWindow: string
  chartLatest: string
  fixtureBanner: string
  unitNote: string
  /** 页脚品牌署名 */
  footerBrand: string
  skipToContent: string
  notFoundTitle: string
  notFoundBody: string
  backToIndex: string
  /** 首页左栏 */
  heroTitle: string
  heroSubtitle: string
  heroExplanation: string
  heroStatReached: string
  heroStatUnreached: string
  heroStatMedian: string
  heroStatP90: string
  heroDays: string
  marketRead: string
  marketReadUnknown: string
  /** 十年价格走势 */
  sparklineNoData: string
  sparklineNoHighlight: string
  sparklineHighlight: string
  sparklineAria: string
  /** 首页表格表头 */
  colCategory: string
  colMetric: string
  colValue: string
  colChange: string
  colStatus: string
  colBasis: string
  statusPending: string
  statusInvalid: string
  dataNoValue: string
  statusShortHistory: string
  /** 观测覆盖率披露 */
  coverage: string
  coverageIncluded: string
  coverageCensored: string
  coverageInvalidated: string
  /** 等待天数分布 */
  distribution: string
  distributionCount: string
  distributionMin: string
  distributionP50: string
  distributionP90: string
  distributionP99: string
  distributionMax: string
  /** 天数的单位 */
  daysUnit: string
  /** 未计入的成本 */
  excludedCosts: string
}>

const zh: Dictionary = {
  siteTitle: 'Signal',
  tagline: '比特币市场与链上指标目录',
  index: '目录',
  categories: {
    market: '市场',
    onchain: '链上活动',
    exchange: '交易所',
    fees: '费用与区块',
    mining: '矿工与安全',
    valuation: '估值与周期',
  },
  homeGroups: {
    marketOverview: '价格与市场',
    valuationAnchors: '估值',
    exchangeFlows: '交易所与持仓',
    onchainActivity: '链上活动',
    feesBlocks: '费用与区块',
    miningSecurity: '矿工与安全',
  },
  updatedAt: '更新于',
  sourceTime: '来源时间',
  ingestedAt: '采集时间',
  stale: '抓取失败',
  snapshotOutdated: '数据快照已过期',
  snapshotOutdatedNote: '本站是每日抓取后生成的静态快照，不提供实时数据。',
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
  licenseLabel: '许可：',
  labelHeuristicNote: '实体标签是数据源自己的归类方式，不是链上可查的事实。',
  chartNoData: '这份快照里没有可用数值。',
  chartSinglePoint:
    '该指标每天只采样一次，因此这份快照只有一个点。历史自开始采集之日起每天增加一个点。',
  chartWindow: '显示区间',
  chartLatest: '最新',
  fixtureBanner: 'Fixture 数据 —— 本地合成的开发用数据，不是真实市场数据。',
  unitNote: '数值为日频、UTC。缺失的日期留空，不会用零填充。',
  footerBrand: 'slowmoonship-慢月船',
  skipToContent: '跳到正文',
  notFoundTitle: '未找到',
  notFoundBody: '没有这个指标。',
  backToIndex: '返回目录',

  heroTitle: '定投赚 5%，最长等多久？',
  heroSubtitle: '历史已达标样本中的最长等待',
  heroExplanation: '每天定额买入、累计收益首次达到 +5% 所需天数，取已达标起点中的最大值；过去十年的每一个起始日都按同一套规则回测，仍有起点至今未达标，单独计数。',
  heroStatReached: '已达标起点',
  heroStatUnreached: '尚未达标',
  heroStatMedian: '中位等待',
  heroStatP90: 'P90 等待',
  heroDays: '天',
  marketRead: '市场状态',
  marketReadUnknown: '部分输入缺失或已过期。',

  sparklineNoData: '价格历史不足，无法绘制走势图。',
  sparklineNoHighlight: '当前快照里没有可用的最长等待区间。',
  sparklineHighlight: '回测中等待最久的一段',
  sparklineAria: 'BTC 十年价格走势，高亮为回测中等待最久的一段',

  colCategory: '分类',
  colMetric: '指标',
  colValue: '当前值',
  colChange: '7 日',
  colStatus: '当前状态',
  colBasis: '判定依据',
  statusPending: '待更新',
  statusInvalid: '文件异常',
  dataNoValue: '暂无数据',
  statusShortHistory: '历史不足',

  coverage: '观测覆盖',
  coverageIncluded: '个起点达标',
  coverageCensored: '个起点在窗口内未达标',
  coverageInvalidated: '个起点因缺价作废',

  distribution: '等待天数分布',
  distributionCount: '个已达标起点',
  distributionMin: '最短',
  distributionP50: '中位',
  distributionP90: 'P90',
  distributionP99: 'P99',
  distributionMax: '最长',
  daysUnit: '天',
  excludedCosts: '未计入手续费、滑点与税。',
}

/**
 * 站点界面只有中文（ADR-021）。
 *
 * 取字典不需要传语言：全站只有一份文案，传一个 locale 进来只会让人以为
 * 还能切语言。语言参数仍然保留在组件 props 里——它决定取指标定义的哪一份文案
 * （`.zh`），那是数据层的接口，与界面语言是两回事。
 */
export function getDictionary(): Dictionary {
  return zh
}
