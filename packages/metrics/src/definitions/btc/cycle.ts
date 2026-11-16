/**
 * 估值与周期的本地公式（ADR-029）。
 *
 * 父序列都已经在本仓库里：价格、市值、MVRV、发行收入、算力。
 * 这里不新增上游，也不把这些比值送进三态分类——它们大多是同一条价格的不同写法。
 */

import { defineMetric } from '../../defineMetric.js'
import { LABEL_SEMANTICS } from '../../labels.js'
import type { MetricContract } from '../../types.js'
import { cmEndpoint } from './market.js'

const indexContract: MetricContract = {
  unit: 'index',
  scale: 1,
  aggregation: 'last',
  window: 'calendar-day-utc',
  labelSemantics: LABEL_SEMANTICS.none,
}

const usdContract: MetricContract = {
  unit: 'usd',
  scale: 1,
  aggregation: 'mean',
  window: 'calendar-day-utc',
  labelSemantics: LABEL_SEMANTICS.none,
}

function cm(metric: string) {
  return {
    provider: 'Coin Metrics' as const,
    metric,
    endpoint: cmEndpoint(metric),
    auth: 'none' as const,
    labelConfidence: 'verified' as const,
  }
}

export const ahr999 = defineMetric({
  id: 'ahr999',
  asset: 'btc',
  category: 'valuation',
  name: { en: 'AHR999 Index', zh: 'AHR999' },
  description: {
    en: 'Price divided by the 200-day fixed-amount cost, times price divided by a published exponential valuation.',
    zh: '价格除以 200 日固定金额成本，再乘以价格除以一条已发表的指数估值。',
  },
  methodology: {
    en: 'Version jiushen-ahr999-v1, coefficients taken from the published article and not refit here. Index = (price / 200-day fixed-amount cost) × (price / exponential valuation). Each UTC day in the window buys one unit of currency, so holdings accumulate 1/price and the cost is 200 / Σ(1/price): a harmonic mean, not a simple average and not a geometric mean. A missing day, a non-positive price, or a non-finite price makes that day null. The valuation is 10^(5.84 × log10(age) − 17.01), where age is the integer number of UTC days since 2009-01-03, and that day itself is 0. Some sites replace the harmonic mean with a 200-day geometric mean; that is a different version. The chart lines at 0.45 and 1.2 are the article’s historical distribution cuts. They are not this site’s status rule.',
    zh: '版本 jiushen-ahr999-v1。系数取自已发表的原文，本站不重新拟合。指数 =（价格 / 200 日固定金额成本）×（价格 / 指数估值）。窗口内每个 UTC 日投入 1 单位货币，持有量累加 1/当日价格，成本 = 200 / Σ(1/价格)，这是调和平均，不是算术平均，也不是几何平均。缺一天、价格非正或不是有限数，该日为 null。指数估值 = 10^(5.84 × log10(币龄) − 17.01)。币龄是自 2009-01-03（UTC）起的整数天，当天为 0。部分网站用 200 日几何平均代替调和平均，那是另一个版本。图上的 0.45 与 1.2 是原文按历史分布画出的参考线，不是本站的状态判定。',
  },
  limits: {
    en: 'Very large readings show up when bitcoin is young, because the exponential valuation is then very small. The index moves with price and with both denominators, so it is not a separate measurement from the price. The chart is on a log scale for that reason. Crossing 0.45 or 1.2 is not an instruction.',
    zh: '币龄很小时指数可以很大，因为那时的指数估值很小，所以曲线用对数坐标。它跟着价格和两个分母一起动，不是一条独立于价格的观测。穿过 0.45 或 1.2 不是操作指令。',
  },
  unit: 'index',
  frequency: '1d',
  format: { kind: 'decimal', maxDecimals: 2 },
  contract: indexContract,
  sources: [cm('PriceUSD')],
  deriveFrom: ['price'],
  derivation: { kind: 'local', formula: 'ahr999' },
  history: {
    availableFrom: '2011-02-02',
    note: {
      en: 'Needs 200 calendar days of PriceUSD, so it starts on 2011-02-02.',
      zh: '需要 200 个日历日的 PriceUSD，因此从 2011-02-02 起有数。',
    },
    mayBeRevised: false,
  },
  missingPolicy: 'null',
  betterWhen: null,
})

export const rainbowZone = defineMetric({
  id: 'rainbow-zone',
  asset: 'btc',
  category: 'valuation',
  name: { en: 'Signal Rainbow', zh: '彩虹图' },
  description: {
    en: 'Which of nine residual bands the daily reference price sits in, on a log-log fit frozen to 2012–2017.',
    zh: '日均参考价落在九个残差带中的哪一区。拟合只使用 2012 至 2017 年，之后系数冻结。',
  },
  methodology: {
    en: 'Version signal-rainbow-loglog-v1. Ordinary least squares on PriceUSD from 2012-01-01 through 2017-12-31 inclusive: log10(price) = a + b × log10(age). Age counts UTC days from 2009-01-03. If valid days in that window are under 95% of the calendar days, the whole series is null and the window is not quietly changed. Residual scale is the sample standard deviation (divisor n−1). Zone edges sit at −2, −1.5, −1, −0.5, 0.5, 1, 1.5 and 2 of that deviation: at or below −2 is zone 1, above 2 is zone 9. This is not the Blockchaincenter rainbow chart. That chart’s current coefficients and license are not published, and its 2014 formula is retired, so this model does not reuse its band names. Zones on or before 2017-12-31 are in-sample fits, not forecasts that had been published then. Later zones are extrapolation of the frozen coefficients, and those are not forecasts either. Most days fall in zones 4 and 5 because residuals cluster near the line.',
    zh: '版本 signal-rainbow-loglog-v1。在 2012-01-01 至 2017-12-31（含）的 PriceUSD 上做普通最小二乘：log10(价格) = a + b × log10(币龄)。币龄从 2009-01-03（UTC）起算。该窗内有效天数不足日历天数的 95% 时，整条序列为 null，不改窗重拟合。残差尺度是样本标准差，分母为 n−1。九个区的边界在 −2、−1.5、−1、−0.5、0.5、1、1.5、2 倍标准差：不超过 −2 为第 1 区，高于 2 为第 9 区。这不是 Blockchaincenter 的彩虹图。对方现行版本没有公布系数和许可，2014 年的旧公式也已停用，因此本模型不沿用对方的区间名称。2017-12-31 及之前的区号是样本内拟合，不是当时已经公布的预测；此后是冻结系数的外推，同样不是预测。大多数日子落在第 4 区与第 5 区，因为残差集中在拟合线附近。',
  },
  limits: {
    en: 'The fit window includes the 2017 rise, so the residual scale is wide and later low-price periods often stay in zone 4 rather than zone 1. A revision of pre-2018 prices moves every zone. The chart is not a model of next year’s price.',
    zh: '拟合窗含 2017 年的上涨，残差尺度因此偏宽，此后的低价日常常仍在第 4 区，而不是第 1 区。2018 年以前的价格若被修订，所有区号都会移动。这张图不能用来回答下一年的价格。',
  },
  unit: 'index',
  frequency: '1d',
  format: { kind: 'zone', of: 9 },
  contract: indexContract,
  sources: [cm('PriceUSD')],
  deriveFrom: ['price'],
  derivation: { kind: 'local', formula: 'rainbow-zone' },
  changeWindowDays: null,
  history: {
    availableFrom: '2010-07-18',
    note: {
      en: 'Zones exist from the first PriceUSD day. Coefficients use only 2012-01-01 through 2017-12-31 and are recomputed from that frozen window.',
      zh: '从 PriceUSD 的第一天起就有区号。系数只用 2012-01-01 至 2017-12-31，并按这个冻结窗口重算。',
    },
    mayBeRevised: true,
  },
  missingPolicy: 'null',
  betterWhen: null,
})

export const piCycleTop = defineMetric({
  id: 'pi-cycle-top',
  asset: 'btc',
  category: 'valuation',
  name: { en: 'Pi Cycle Top', zh: 'Pi Cycle' },
  description: {
    en: 'The 111-day price average divided by twice the 350-day price average. An upward cross is a separate event from the ratio merely nearing 1.',
    zh: '111 日价格均线除以 2 倍的 350 日价格均线。比值接近 1 与真正上穿是两件事。',
  },
  methodology: {
    en: 'Version pi-cycle-top-v1. The fast line is the arithmetic mean of the 111 UTC days ending that day. The slow line is twice the 350-day arithmetic mean. The published value is fast / slow. An upward cross requires the previous UTC day’s ratio to be below 1 and today’s ratio to be at least 1, both non-null. A missing day in between is not a cross. A ratio at or above 1 with no observed cross is left unconfirmed. On this daily-average series the upward crosses fall on 2013-04-06, 2013-12-05, 2017-12-16 and 2021-04-12. An exchange-close chart can differ by a few days.',
    zh: '版本 pi-cycle-top-v1。快线是含当日在内的 111 个 UTC 日价格算术平均，慢线是 350 日算术平均的 2 倍。发布值是快线 / 慢线。上穿要求前一个 UTC 日的比值低于 1，且当日不低于 1，两日都有数。中间缺日不算上穿。比值不低于 1 但没有观察到上穿，记为未确认。在这条日均价序列上，上穿日落在 2013-04-06、2013-12-05、2017-12-16 与 2021-04-12。交易所收盘价图表的日期可能相差数日。',
  },
  limits: {
    en: 'Those four dates line up with several later-recognised cycle highs. That is a coincidence observed after the fact. Later highs do not all come with a cross. A ratio below 1 only says the fast average is still under the slow one.',
    zh: '这四天与若干事后才被认出的周期高点在时间上接近，是事后观察到的重合。此后的价格高点并不都伴随上穿。比值低于 1 只说明快线还在慢线下方。',
  },
  unit: 'index',
  frequency: '1d',
  format: { kind: 'decimal', maxDecimals: 2 },
  contract: indexContract,
  sources: [cm('PriceUSD')],
  deriveFrom: ['price'],
  derivation: { kind: 'local', formula: 'pi-cycle-top' },
  history: {
    availableFrom: '2011-07-02',
    note: {
      en: 'The 350-day window is the longer one, so the ratio starts on 2011-07-02.',
      zh: '更长的窗口是 350 日，比值从 2011-07-02 起有数。',
    },
    mayBeRevised: false,
  },
  missingPolicy: 'null',
  betterWhen: null,
})

export const puellMultiple = defineMetric({
  id: 'puell-multiple',
  asset: 'btc',
  category: 'valuation',
  name: { en: 'Puell Multiple', zh: 'Puell 倍数' },
  description: {
    en: 'Daily USD issuance revenue divided by its own 365-day average. Fees are not included.',
    zh: '当日美元发行收入除以它自己的 365 日平均。不含手续费。',
  },
  methodology: {
    en: 'Version puell-issuance-v1. The numerator is that day’s IssTotUSD. The denominator is the arithmetic mean of IssTotUSD over the 365 UTC days ending that day. A gap in the window, or a mean that is not positive, makes the day null. A zero issuance value is kept when the mean is positive. The parent series is Coin Metrics IssTotUSD and excludes transaction fees. Charts that include fees diverge when fees are a large share of miner income. The lines at 0.5 and 4 are the levels commonly drawn on the original chart. They are reference lines, not this site’s status words.',
    zh: '版本 puell-issuance-v1。分子是当日 IssTotUSD，分母是含当日在内的 365 个 UTC 日 IssTotUSD 的算术平均。窗口缺日，或均值不是正数，该日为 null。发行收入为 0 时只要均值大于 0 就保留。父序列是 Coin Metrics 的 IssTotUSD，不含交易手续费。把手续费算进去的图表，在手续费占矿工收入较高时会偏离本序列。图上的 0.5 与 4 是常见图表上的参考线，不是本站的状态词。',
  },
  limits: {
    en: 'A halving lowers the numerator mechanically. A lower multiple is then not only a price story. This series is not the fee-inclusive variant.',
    zh: '减半会机械地压低分子，倍数下降并不只来自价格。本序列不是含手续费的那个版本。',
  },
  unit: 'index',
  frequency: '1d',
  format: { kind: 'decimal', maxDecimals: 2 },
  contract: indexContract,
  sources: [cm('IssTotUSD')],
  deriveFrom: ['miner-revenue-usd'],
  derivation: { kind: 'local', formula: 'puell-multiple' },
  history: {
    availableFrom: '2011-07-17',
    note: {
      en: 'Needs 365 days of issuance revenue, so it starts on 2011-07-17.',
      zh: '需要 365 日发行收入，因此从 2011-07-17 起有数。',
    },
    mayBeRevised: false,
  },
  missingPolicy: 'null',
  betterWhen: null,
})

export const mayerMultiple = defineMetric({
  id: 'mayer-multiple',
  asset: 'btc',
  category: 'valuation',
  name: { en: 'Mayer Multiple', zh: 'Mayer 倍数' },
  description: {
    en: 'Daily reference price divided by its 200-day arithmetic mean.',
    zh: '日均参考价除以它的 200 日算术平均。',
  },
  methodology: {
    en: 'Version mayer-v1. Price divided by the arithmetic mean of the 200 UTC days ending that day. A gap in the window makes the day null. The chart line at 1 is price equal to that average. The line at 2.4 is the level drawn on Trace Mayer’s earlier sample. It is a reference, not a trigger this site declares.',
    zh: '版本 mayer-v1。价格除以含当日在内的 200 个 UTC 日价格算术平均。窗口缺日则为 null。图上的 1 表示价格等于这条均线。2.4 是 Trace Mayer 早期样本里画出的参考线，本站不把它当成触发条件。',
  },
  limits: {
    en: 'A 200-day window reacts slowly to a sharp drop. A high multiple only says price is above its own 200-day average.',
    zh: '200 日窗口对一次急跌反应慢。倍数高只说明价格高于自己的 200 日均线。',
  },
  unit: 'index',
  frequency: '1d',
  format: { kind: 'decimal', maxDecimals: 2 },
  contract: indexContract,
  sources: [cm('PriceUSD')],
  deriveFrom: ['price'],
  derivation: { kind: 'local', formula: 'mayer-multiple' },
  history: {
    availableFrom: '2011-02-02',
    note: {
      en: 'Needs 200 calendar days of PriceUSD, so it starts on 2011-02-02.',
      zh: '需要 200 个日历日的 PriceUSD，因此从 2011-02-02 起有数。',
    },
    mayBeRevised: false,
  },
  missingPolicy: 'null',
  betterWhen: null,
})

export const nupl = defineMetric({
  id: 'nupl',
  asset: 'btc',
  category: 'valuation',
  name: { en: 'NUPL', zh: '未实现盈亏' },
  description: {
    en: 'One minus the reciprocal of CapMVRVCur, which is the same number as unrealised profit over market cap for that definition.',
    zh: '1 减去 CapMVRVCur 的倒数。在这个口径下，它与未实现盈亏占市值的比例是同一个数。',
  },
  methodology: {
    en: 'Version nupl-from-capmvrvcur-v1. On days when CapMVRVCur is positive, NUPL = 1 − 1/MVRV. Coin Metrics CapMVRVCur is circulating market cap divided by realised cap, so the algebra matches (market cap − realised cap) / market cap. A missing or non-positive MVRV makes the day null. The value can be negative when market cap is below realised cap. The zero line on the chart is those two caps being equal. Other vendors’ realised-cap methods can differ in the last digits.',
    zh: '版本 nupl-from-capmvrvcur-v1。CapMVRVCur 为正的日子，NUPL = 1 − 1/MVRV。Coin Metrics 的 CapMVRVCur 是流通市值除以已实现市值，因此这个代数式与（市值 − 已实现市值）/ 市值 相同。MVRV 缺失或不是正数时为 null。市值低于已实现市值时，这个数小于 0。图上的 0 线是两个市值相等。其他数据商的已实现市值算法不同，末位会不一样。',
  },
  limits: {
    en: 'NUPL and MVRV are two writings of one ratio. They are not two independent observations. This site does not have the paid realised-cap series and does not invent a second one.',
    zh: '未实现盈亏与 MVRV 是同一个比值的两种写法，不是两条独立观测。本站没有付费的已实现市值序列，也不另造一条。',
  },
  unit: 'index',
  frequency: '1d',
  format: { kind: 'decimal', maxDecimals: 2 },
  contract: indexContract,
  sources: [cm('CapMVRVCur')],
  deriveFrom: ['mvrv'],
  derivation: { kind: 'local', formula: 'nupl' },
  canBeNegative: true,
  changeWindowDays: null,
  history: {
    availableFrom: '2010-07-18',
    note: {
      en: 'Available on every day CapMVRVCur is positive, from 2010-07-18.',
      zh: '自 2010-07-18 起，CapMVRVCur 为正的每一天都有数。',
    },
    mayBeRevised: true,
  },
  missingPolicy: 'null',
  betterWhen: null,
})

export const mvrvZscore = defineMetric({
  id: 'mvrv-zscore',
  asset: 'btc',
  category: 'valuation',
  name: { en: 'MVRV Z-Score', zh: 'MVRV Z' },
  description: {
    en: 'Market cap minus realised cap, divided by the expanding sample standard deviation of market cap.',
    zh: '市值减去已实现市值，再除以市值从序列起点到当日的样本标准差。',
  },
  methodology: {
    en: 'Version mvrv-z-expanding-v1. On the same UTC day, realised cap = circulating market cap / CapMVRVCur, and the ratio must be positive. Z = (market cap − realised cap) / the sample standard deviation of market cap from the first valid observation through that day, divisor n−1. Fewer than 30 valid market-cap observations yields null. The standard deviation is of market cap, not a z-score of the MVRV ratio. The lines at 0 and 7 are levels often drawn in the literature. They are references, not a rule this site trades.',
    zh: '版本 mvrv-z-expanding-v1。同一 UTC 日，已实现市值 = 流通市值 / CapMVRVCur，比值必须为正。Z =（流通市值 − 已实现市值）/ 流通市值从首个有效观测到当日（含）的样本标准差，分母用 n−1。有效市值不足 30 个观测时为 null。标准差是市值的，不是把 MVRV 比值再做一次 z-score。图上的 0 与 7 是文献里常画的参考线，不是本站执行的规则。',
  },
  limits: {
    en: 'Early market caps are small, so early Z readings are large and stretch a linear chart. The window grows through the current day. A later market cap does not rewrite an earlier Z.',
    zh: '早期市值很小，早期的 Z 可以很大，线性图的纵轴会被那一段拉开。窗口扩展到当日。后来的市值不会改写更早日期的 Z。',
  },
  unit: 'index',
  frequency: '1d',
  format: { kind: 'decimal', maxDecimals: 2 },
  contract: indexContract,
  sources: [cm('CapMrktCurUSD'), cm('CapMVRVCur')],
  deriveFrom: ['market-cap', 'mvrv'],
  derivation: { kind: 'local', formula: 'mvrv-zscore' },
  canBeNegative: true,
  changeWindowDays: null,
  history: {
    availableFrom: '2010-08-16',
    note: {
      en: 'Needs 30 market-cap observations and a positive MVRV, so the first value is 2010-08-16.',
      zh: '需要 30 个市值观测和正的 MVRV，因此第一个值在 2010-08-16。',
    },
    mayBeRevised: true,
  },
  missingPolicy: 'null',
  betterWhen: null,
})

export const sma200w = defineMetric({
  id: 'sma-200w',
  asset: 'btc',
  category: 'valuation',
  name: { en: '200-Week Average', zh: '200周均线' },
  description: {
    en: 'Arithmetic mean of the last 200 Sunday PriceUSD values. The published number is the average in dollars.',
    zh: '最近 200 个周日 PriceUSD 的算术平均。发布值是这条均线的美元价格。',
  },
  methodology: {
    en: 'Version sma-200w-iso-v1. Weeks run Monday through Sunday in UTC. The week’s sample is Sunday’s PriceUSD. The average needs 200 consecutive Sundays with a positive price. A missing Sunday makes every window that includes it null. No other day is substituted, and a 1400-day average is not used in its place. Monday through Saturday keep the average from the latest finished Sunday; the unfinished week does not move it. On 2017-12-16 this average and a 1400-day average differed by about 4%. The status compares that day’s price with the average: under 1 is below the line, from 1 up to 2 is above the line, and 2 or more is at twice the line. The factor of 2 is a display bucket, not a famous rule.',
    zh: '版本 sma-200w-iso-v1。周界是 UTC 周一至周日，周样本取周日的 PriceUSD。200 个连续周日都必须有正价格，缺一周则包含它的窗口为 null。不用别的日子顶上，也不改用 1400 日均线。周一到周六沿用最近一个已结束周日的均线，未结束的当周不改数值。2017-12-16 这条均线与 1400 日均线相差约 4%。状态看的是当日价格与均线之比：低于 1 为均线下，1 到 2 为均线上，达到 2 为两倍上。2 倍只是展示分档，不是一条著名规则。',
  },
  limits: {
    en: 'Sunday’s sample is that day’s average reference price, not an exchange weekly settlement. A missing Sunday blanks every window that contains it.',
    zh: '周日样本是那天的日均参考价，不是交易所的周结算价。缺一个周日，包含它的窗口全部为空。',
  },
  unit: 'usd',
  frequency: '1d',
  format: { kind: 'usd' },
  contract: usdContract,
  sources: [cm('PriceUSD')],
  deriveFrom: ['price'],
  derivation: { kind: 'local', formula: 'sma-200w' },
  history: {
    availableFrom: '2014-05-11',
    note: {
      en: 'Two hundred Sundays after the first usable Sunday in PriceUSD, so the average starts on 2014-05-11.',
      zh: 'PriceUSD 里第一个可用周日之后再过 200 个周日，均线从 2014-05-11 起有数。',
    },
    mayBeRevised: false,
  },
  missingPolicy: 'null',
  betterWhen: null,
})

export const ma2y = defineMetric({
  id: 'ma-2y',
  asset: 'btc',
  category: 'valuation',
  name: { en: '2-Year Multiple', zh: '2年倍数' },
  description: {
    en: 'Daily reference price divided by its 730-day arithmetic mean. The chart also draws five times that mean.',
    zh: '日均参考价除以 730 日算术平均。图上同时画出这条均线的 5 倍。',
  },
  methodology: {
    en: 'Version ma-2y-730d-v1. The average is the arithmetic mean of the 730 UTC days ending that day. It is not 104 weeks, and a leap year does not change it to 731. The upper line is five times the average, the multiple used on the common chart. This site does not re-estimate it. The published value is price / average. Below 1, price is under the average. From 1 through 5, price sits between the two lines. Above 5, price is over the upper line.',
    zh: '版本 ma-2y-730d-v1。均线是含当日在内的 730 个 UTC 日价格算术平均，不是 104 周，闰年也不改成 731。上轨是均线的 5 倍，沿用常见图表的倍数，本站不重新估计。发布值是价格 / 均线。低于 1 表示价格在均线之下，1 到 5 表示在两条线之间，高于 5 表示在上轨之上。',
  },
  limits: {
    en: 'A 730-day window reacts slowly to a sharp drop. Crossing the 5× line is a chart convention, not a condition this site turns into a trade.',
    zh: '730 日窗口对一次急跌反应很慢。越过 5 倍上轨是图表惯例，不是本站给出的交易条件。',
  },
  unit: 'index',
  frequency: '1d',
  format: { kind: 'decimal', maxDecimals: 2 },
  contract: indexContract,
  sources: [cm('PriceUSD')],
  deriveFrom: ['price'],
  derivation: { kind: 'local', formula: 'ma-2y' },
  history: {
    availableFrom: '2012-07-16',
    note: {
      en: 'Needs 730 calendar days of PriceUSD, so it starts on 2012-07-16.',
      zh: '需要 730 个日历日的 PriceUSD，因此从 2012-07-16 起有数。',
    },
    mayBeRevised: false,
  },
  missingPolicy: 'null',
  betterWhen: null,
})

export const hashRibbons = defineMetric({
  id: 'hash-ribbons',
  asset: 'btc',
  category: 'mining',
  name: { en: 'Hash Ribbons', zh: '算力丝带' },
  description: {
    en: 'The 30-day hashrate average divided by the 60-day hashrate average. No price confirmation is included.',
    zh: '30 日算力均线除以 60 日算力均线。不含价格确认。',
  },
  methodology: {
    en: 'Version hash-ribbons-ma-v1. The fast line is the arithmetic mean of hashrate over the 30 UTC days ending that day. The slow line is the 60-day mean. The published value is fast / slow. A ratio below 1 is contraction. An upward cross is the previous day below 1 and the current day at or above 1. Any other ratio at or above 1 is recovery. A missing day is not a cross. The full Hash Ribbons trade signal also asks for a price-momentum confirmation. Published descriptions of that confirmation do not agree, so this series does not add one.',
    zh: '版本 hash-ribbons-ma-v1。快线是含当日在内的 30 个 UTC 日算力算术平均，慢线是 60 日。发布值是快线 / 慢线。比值低于 1 记为收缩。前一日低于 1 且当日不低于 1 记为上穿。其余不低于 1 的日子记为恢复。缺日不构成交叉。完整的 Hash Ribbons 交易信号还要求价格动量确认，已发表的确认写法并不一致，本序列不补一个。',
  },
  limits: {
    en: 'A falling hashrate average is sometimes called miner capitulation. That is an interpretation. The chain has no such field. An upward cross only says the 30-day average is back above the 60-day average.',
    zh: '算力均线回落常被称作矿工投降。那是一种解释，链上没有这个字段。上穿只说明 30 日均线回到 60 日均线上方。',
  },
  unit: 'index',
  frequency: '1d',
  format: { kind: 'decimal', maxDecimals: 2 },
  contract: indexContract,
  sources: [cm('HashRate')],
  deriveFrom: ['hashrate'],
  derivation: { kind: 'local', formula: 'hash-ribbons' },
  history: {
    availableFrom: '2009-03-09',
    note: {
      en: 'Needs 60 days of hashrate, so the ratio starts on 2009-03-09. Hashrate history itself may be revised by the source.',
      zh: '需要 60 日算力，比值从 2009-03-09 起有数。算力历史本身可能被数据源重算。',
    },
    mayBeRevised: true,
  },
  missingPolicy: 'null',
  betterWhen: null,
})
