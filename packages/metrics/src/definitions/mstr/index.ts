/**
 * Strategy（原 MicroStrategy）的披露与股价指标。
 *
 * 资产是 mstr，分类是 strategy。不要把它们登记成 BTC 链上指标。
 * 持仓、股数和每股聪数来自公司或 SEC 的披露，不来自行情网站的转载。
 */

import { defineMetric } from '../../defineMetric.js'
import { LABEL_SEMANTICS } from '../../labels.js'
import type { MetricContract, MetricDefinition, SourceRef } from '../../types.js'

const sec: SourceRef = {
  provider: 'SEC EDGAR',
  metric: 'Strategy Inc 8-K, 10-Q and 10-K',
  endpoint: 'https://data.sec.gov/submissions/CIK0001050446.json',
  auth: 'none',
  labelConfidence: 'verified',
  license: {
    name: 'SEC EDGAR access',
    url: 'https://www.sec.gov/os/accessing-edgar-data',
    restriction: {
      en: 'Figures are facts the company stated in its filing. Keep the accession with the number. Hosting on EDGAR does not make the filing a US government work.',
      zh: '数字是公司在申报里写明的事实，并保留 accession。文件放在 EDGAR 上，并不因此变成美国政府作品。',
    },
  },
}

const briefing: SourceRef = {
  provider: 'Strategy',
  metric: 'Investor briefing',
  endpoint: 'https://www.strategy.com/',
  auth: 'none',
  labelConfidence: 'verified',
  license: {
    name: 'Company disclosure',
    url: 'https://www.strategy.com/',
    restriction: {
      en: 'Figures are the snapshots the company printed in its own briefing. They are not a live quote.',
      zh: '数字是公司写在自己简报里的快照，不是实时报价。',
    },
  },
}

const point = (unit: MetricContract['unit']): MetricContract => ({
  unit,
  scale: 1,
  aggregation: 'last',
  window: 'point',
  labelSemantics: LABEL_SEMANTICS.none,
})

const session: MetricContract = {
  unit: 'usd',
  scale: 1,
  aggregation: 'last',
  window: 'us-equity-close',
  labelSemantics: LABEL_SEMANTICS.none,
}

const history = (from: string | null, zh: string, en: string): MetricDefinition['history'] => ({
  availableFrom: from,
  note: { zh, en },
  mayBeRevised: true,
})

export const mstrPrice = defineMetric({
  id: 'mstr-price',
  asset: 'mstr',
  category: 'strategy',
  name: { en: 'MSTR price', zh: 'MSTR 股价' },
  description: {
    en: 'The latest Class A close that Strategy itself printed in an investor briefing.',
    zh: 'Strategy 在投资者简报里写明的最新 A 类普通股收盘价。',
  },
  methodology: {
    en: 'The figure is the “MSTR Price” in the briefing, dated by the sentence “Market data as of … close”. It is an official close, not a pre-market, after-hours or in-session quote. Vendor histories from Nasdaq, Stooq, Coinbase and Yahoo were not used: their terms do not allow this site to redistribute the series. A new close appears only when a new briefing states one. If a later US equity session is already published, the close is labelled pending and keeps its session date. If it is the latest session but the previous session is missing, the label is short history. Neither case is “no data”. A one-day move is named only when the two closes are adjacent sessions. The seven-day column needs a close on the calendar day seven days earlier; otherwise it stays blank rather than spanning the gap.',
    zh: '数字取简报上的 MSTR Price，日期取「Market data as of … close」那一句。这是正式收盘价，不是盘前、盘后或盘中报价。纳斯达克、Stooq、Coinbase、Yahoo 的历史行情没有采用，因为它们的条款不允许本站再分发那条序列。只有新的简报写明了新收盘，这里才会多一个点。已发布的美股收盘日更晚时，状态是待更新，并写明这份收盘的交易日。收盘已是最新交易日、但没有上一日时，状态是历史不足。这两种都不是缺数据。只有相邻两个交易日才写上涨或下跌。七日变化要求正好七个日历日前有收盘，否则留空，不把中间的缺口当成七天涨跌。',
  },
  limits: {
    en: 'A close from the last briefing can be several sessions old. The page must not present it as a live price.',
    zh: '上一份简报的收盘价可能已经隔了几个交易日。页面不能把它显示成正在交易的价格。',
  },
  unit: 'usd',
  frequency: '1d',
  format: { kind: 'usd' },
  // 七日列会去对正好七日前的收盘。对不上就显示横线，不把两份简报的间隔算成七日涨跌。
  changeWindowDays: 7,
  contract: session,
  sources: [briefing],
  history: history(
    '2026-10-09',
    '目前只收录简报里写明的收盘。更早的交易日没有可再分发的来源。',
    'Only closes printed in briefings are included. Earlier sessions have no redistributable source.',
  ),
  missingPolicy: 'null',
  betterWhen: null,
})

export const mstrBtcBeta90d = defineMetric({
  id: 'mstr-btc-beta-90d',
  asset: 'mstr',
  category: 'strategy',
  name: { en: 'Historical price elasticity of MSTR versus BTC', zh: 'MSTR 相对 BTC 的历史价格弹性' },
  shortName: { en: 'MSTR elasticity', zh: 'MSTR 弹性' },
  description: {
    en: 'How many percentage points MSTR’s simple return moved, on average, when BTC’s simple return moved one point over the last 90 sessions.',
    zh: '过去 90 个美股交易日里，BTC 简单收益率变动 1 个百分点时，MSTR 简单收益率在回归里平均对应变动多少个百分点。',
  },
  methodology: {
    en: 'Version mstr-btc-beta-v1. Beta = Cov(R_MSTR, R_BTC) / Var(R_BTC), ordinary least squares with an intercept. Returns are simple returns of split-adjusted closes, not log returns. The window is 90 valid NYSE session returns, which needs 91 aligned prices. BTC is the Binance Vision hour open at 16:00 America/New_York, or 13:00 on early closes, not the UTC daily average. A gap, a non-positive price, or a holiday is null and is not filled. The published number has one decimal place. Beta is not clipped when it is above 3, below 1, or negative.',
    zh: '版本 mstr-btc-beta-v1。Beta = Cov(R_MSTR, R_BTC) / Var(R_BTC)，带截距的普通最小二乘。收益率是复权收盘的简单收益率，不是对数收益率。窗口是 90 个有效美股交易日收益率，因此需要 91 个对齐的价格。BTC 用美东 16:00 的小时开盘价，提前收盘日用 13:00，不用 UTC 日均价。缺口、非正价格和休市日都是 null，不填补。发布值保留一位小数。Beta 大于 3、小于 1 或为负时都不截断。',
  },
  limits: {
    en: 'This is a historical statistical sensitivity. It is not a leverage ratio, not mNAV, not the multiple of bitcoin a dollar buys, and not a forecast. The illustration that applies the current beta to a 5% BTC move omits the intercept, the residual, later changes in beta, and risks that belong only to the stock. If the sample is short, BTC barely moved, the fit is unstable, or the close is stale, the number is withheld.',
    zh: '这是历史统计敏感度。它不是杠杆倍数，不是 mNAV，不是同样的钱能买到多少倍比特币，也不是对未来的预测。把当前 Beta 乘上「BTC 上涨 5%」只演示回归里的那一项，不含截距、残差、以后 Beta 的变化，以及股票自己的风险。样本不够、BTC 几乎没动、拟合不稳或收盘过期时，不发布这个数字。',
  },
  unit: 'index',
  frequency: '1d',
  format: { kind: 'multiple', decimals: 1 },
  changeWindowDays: null,
  canBeNegative: true,
  crossAsset: true,
  contract: {
    unit: 'index',
    scale: 1,
    aggregation: 'last',
    window: 'us-equity-close',
    labelSemantics: LABEL_SEMANTICS.none,
  },
  sources: [briefing],
  deriveFrom: ['mstr-price', 'btc-price-us-close'],
  derivation: { kind: 'local', formula: 'mstr-btc-beta-90d' },
  history: history(
    null,
    '可再分发的 MSTR 收盘不足以做满 90 日窗口时，序列留空，并写明原因。',
    'When redistributable MSTR closes do not fill 90 sessions, the series stays empty and the reason is stored.',
  ),
  missingPolicy: 'null',
  betterWhen: null,
})

export const strategyBtcHoldings = defineMetric({
  id: 'strategy-btc-holdings',
  asset: 'mstr',
  category: 'strategy',
  name: { en: 'Strategy BTC holdings', zh: 'Strategy BTC 持仓' },
  description: {
    en: 'Bitcoin holdings Strategy reported as of the date in its Form 8-K.',
    zh: 'Strategy 在 8-K 里披露的、截至该日的比特币持仓。',
  },
  methodology: {
    en: 'The point is the total holdings the filing states: the “Aggregate BTC Holdings” row, or, in earlier 8-Ks and Exhibit 99.1, the sentence that states the balance and its aggregate cost. The timestamp is the “As of” date. When the sentence gives no as-of date, the date in that paragraph is used, otherwise the filing date. It is not a trade date, and the change between two filings is not spread across the days in between. “BTC Purchased” is a buy. “BTC Sold”, including sales whose proceeds funded preferred-stock repurchases, is a sale. A decrease that the filing does not call a sale is an adjustment. A later filing for the same as-of date replaces the earlier number. A week with no stated balance adds no point.',
    zh: '点的值是文件写明的总持仓：后来的表格用 Aggregate BTC Holdings；更早的 8-K 和附件 99.1 用写明余额和合计成本的那一句。时间是 As of 那天。句子没有截止日时，用这段话里的日期，再没有才用申报日。这不是成交日，两次披露之间的差额也不摊到中间每一天。「BTC Purchased」记为买入。「BTC Sold」记为卖出，包括用卖出所得回购优先股的情形。持仓减少但文件没有把它称为卖出的，记为调整。同一截止日以后来的那份为准。没有写明总持仓的那一周不加点。',
  },
  limits: {
    en: 'The filing date is when the public could read the number. It is not the trade date. A purchase window of several days is not a single trade on the as-of date.',
    zh: '申报日是公众读到这个数字的日期，不是成交日。跨了好几天的购买区间，也不能写成截止日当天的一笔交易。',
  },
  unit: 'btc',
  frequency: '1d',
  format: { kind: 'btc' },
  changeWindowDays: null,
  contract: point('btc'),
  sources: [sec],
  history: history(
    '2020-08-11',
    '从 2020 年 8 月第一次写明购买开始。中间没有申报的星期留空，不把差额摊平。',
    'Starts at the August 2020 purchase the company stated. Weeks with no filing stay empty. The difference is not spread across them.',
  ),
  missingPolicy: 'null',
  betterWhen: null,
})

export const strategyBtcPerShare = defineMetric({
  id: 'strategy-btc-per-share',
  asset: 'mstr',
  category: 'strategy',
  name: { en: 'BTC per share', zh: '每股含 BTC' },
  description: {
    en: 'Gross bitcoin per assumed diluted share, in satoshis, as Strategy states it.',
    zh: 'Strategy 写明的、按假定稀释股数计算的每股比特币，单位是聪。',
  },
  methodology: {
    en: 'The published KPI is gross bitcoin holdings divided by Assumed Diluted Shares Outstanding, times 100,000,000. Assumed diluted shares add basic Class A and Class B to the assumed conversion of converts and convertible preferred, option exercise, and RSU or PSU settlement. It is not the treasury-method share count, and it is not basic shares outstanding. Signal stores the sats figure the company printed. It does not divide a new holding by an old share count. Status compares the last two stated figures: more sats is thicker, fewer is thinner. That is a denominator fact, not a verdict on the financing.',
    zh: '公司公布的口径是：比特币总持仓除以假定稀释股数，再乘以 1 亿，得到每股聪数。假定稀释股数在 A 类和 B 类基本股之上，加上可转债与可转优先股的假定转换、期权行权，以及 RSU、PSU 结算。它不是库存股法下的股数，也不是基本流通股。本站保存公司印出来的聪数，不用新的持仓去除以旧的股数。状态比较最近两次写明的数字：变多是增厚，变少是摊薄。这是分母事实，不是对融资好坏的判决。',
  },
  limits: {
    en: 'Basic shares, fully diluted shares and assumed diluted shares are three denominators. This series is only the third, and only on dates the company stated it.',
    zh: '基本股、完全稀释股和假定稀释股是三个分母。这条序列只用第三种，而且只用公司写明了的那些日期。',
  },
  unit: 'count',
  frequency: '1d',
  format: { kind: 'sats' },
  changeWindowDays: null,
  contract: point('count'),
  sources: [briefing],
  history: history(
    '2026-10-09',
    '只在简报写明 BTC Per Share (Sats) 的日期上有点。公式版本跟公司当时的 BPS 定义走。',
    'A point exists only on dates when the briefing states BTC Per Share (Sats). The formula version is the company’s BPS definition at that date.',
  ),
  missingPolicy: 'null',
  betterWhen: null,
})

export const strategyBtcCost = defineMetric({
  id: 'strategy-btc-cost',
  asset: 'mstr',
  category: 'strategy',
  name: { en: 'Average BTC cost', zh: '持仓均价' },
  description: {
    en: 'The average purchase price Strategy stated for its remaining bitcoin.',
    zh: 'Strategy 为其剩余比特币写明的平均购买价格。',
  },
  methodology: {
    en: 'Each filing states an average purchase price inclusive of fees and expenses. After a sale, the next filing states a new average. Signal stores that stated average and does not re-average the increments. When a filing states the aggregate cost and the holdings but not the per-coin average, the average is those two stated numbers divided. The billions figure in the same row is rounded; the average times the holdings is the finer total, and the page says which one it is showing. The detail page also shows the BTC price at the last US equity close on or before the as-of date.',
    zh: '每份申报会写一个含费用的平均购买价格。发生卖出后，下一份文件会给出新的均价。本站保存文件写明的均价，不用前后增量再平均一次。文件写了合计成本和总枚数、但没有写每股均价时，均价用这两个写明的数相除。同一行里的十亿美元是四舍五入后的合计数；均价乘以持仓是更细的一笔，页面会说明展示的是哪一个。详情页同时给出持仓截止日当天或之前最后一个美股收盘时刻的 BTC 价格。',
  },
  limits: {
    en: 'A lower average after a sale is an accounting result of which coins left, not evidence that the remaining coins were bought more cheaply in the market that week.',
    zh: '卖出之后均价变低，是离开的是哪些币的会计结果，不能当成「这一周剩下的币买得更便宜」。',
  },
  unit: 'usd',
  frequency: '1d',
  format: { kind: 'usd' },
  changeWindowDays: null,
  contract: point('usd'),
  sources: [sec],
  history: history(
    '2020-08-11',
    '均价跟着能解析的申报走。卖出前后的两个均价都保留，不合并成一条增量成本。',
    'The average follows the filings that parse. Averages before and after a sale are both kept.',
  ),
  missingPolicy: 'null',
  betterWhen: null,
})

export const strategyBtcUnrealized = defineMetric({
  id: 'strategy-btc-unrealized',
  asset: 'mstr',
  category: 'strategy',
  name: { en: 'Unrealized BTC result', zh: 'BTC 持仓浮盈亏' },
  description: {
    en: 'Mark-to-close value of the disclosed bitcoin minus the stated average cost times the same holdings.',
    zh: '披露持仓按美股收盘时刻的 BTC 市价计价，再减去同一持仓乘以披露均价。',
  },
  methodology: {
    en: 'For each holdings as-of date, the mark is the BTC/USDC hour open at the last NYSE close on or before that date. Unrealized = holdings × (mark − stated average). The as-of date and the session date are both kept, because a Sunday as-of uses Friday’s close. It is not recomputed by chaining weekly purchases.',
    zh: '每个持仓截止日，用该日或之前最后一个纽交所收盘时刻的 BTC/USDC 小时开盘价做市价。浮盈亏 = 持仓 ×（市价 − 披露均价）。截止日和收盘日都保留，因为周日的截止日要用周五的收盘。不按每周买入额去滚动重算成本。',
  },
  limits: {
    en: 'This is not accounting fair value under the company’s financial statements, and it is not a taxable gain. A positive number is not a reason to buy the stock.',
    zh: '这不是公司财务报表里的公允价值，也不是应税所得。正数不是买入股票的理由。',
  },
  unit: 'usd',
  frequency: '1d',
  format: { kind: 'usd' },
  changeWindowDays: null,
  canBeNegative: true,
  computedLocally: true,
  crossAsset: true,
  deriveFrom: ['strategy-btc-holdings', 'strategy-btc-cost', 'btc-price-us-close'],
  contract: point('usd'),
  sources: [sec],
  history: history(
    '2024-01-02',
    '只有持仓、均价和对应的美股收盘价都在时才有点。',
    'A point exists only when holdings, the stated average and the matching equity-close BTC price all exist.',
  ),
  missingPolicy: 'null',
  betterWhen: null,
})

export const mstrCommonIssuance = defineMetric({
  id: 'mstr-common-issuance',
  asset: 'mstr',
  category: 'strategy',
  name: { en: 'MSTR common issuance', zh: 'MSTR 普通股增发' },
  description: {
    en: 'Class A shares Strategy reported selling during the 8-K period, and the net proceeds.',
    zh: '8-K 区间内 Strategy 报告售出的 A 类普通股股数，以及净募集额。',
  },
  methodology: {
    en: 'The value is the MSTR Stock row under Shares Sold. A dash is zero shares for that period. Net proceeds are the millions figure in that row, converted to dollars. The period end is the timestamp. Proceeds are also kept on the snapshot so the page can show both the share count and the dollars. Issuance is not labeled as bad news.',
    zh: '数值是 Shares Sold 表里的 MSTR Stock 行。破折号表示这一期股数是 0。净募集额是该行以百万美元计的数字，换算成美元。时间用区间结束日。金额另外记在快照上，页面可以同时给出股数和美元。增发不标记成利空。',
  },
  limits: {
    en: 'New shares can fund bitcoin purchases or preferred repurchases. Which one happened is in the filing footnote, not in the sign of this number.',
    zh: '新股可以用来买比特币，也可以用来回购优先股。究竟做了哪一件，要看脚注，不能看这个数字的正负。',
  },
  unit: 'count',
  frequency: '1d',
  format: { kind: 'shares' },
  changeWindowDays: null,
  contract: point('count'),
  sources: [sec],
  history: history('2024-01-01', '只统计 8-K 售股表里出现的 MSTR 行。', 'Only MSTR rows in the 8-K sales table are counted.'),
  missingPolicy: 'null',
  betterWhen: null,
})

export const strcRepurchase = defineMetric({
  id: 'strc-repurchase',
  asset: 'mstr',
  category: 'strategy',
  name: { en: 'STRC repurchase', zh: 'STRC 回购' },
  description: {
    en: 'STRC preferred shares Strategy reported repurchasing during the 8-K period, and the dollars spent.',
    zh: '8-K 区间内 Strategy 报告回购的 STRC 优先股股数，以及花费的美元。',
  },
  methodology: {
    en: 'The value is the STRC Stock row under Shares Repurchased. Dollars are the millions in that row. This is a different event from MSTR common issuance. The page does not call a repurchase good news. The footnote may say the cash came from common-stock sales, which is a tradeoff between preferred dividends and common dilution.',
    zh: '数值是 Shares Repurchased 表里的 STRC Stock 行。金额是该行的百万美元。这和 MSTR 普通股增发是两件不同的事。页面不把回购叫作利好。脚注可能写明资金来自普通股发行，那是优先股股息和普通股稀释之间的取舍。',
  },
  limits: {
    en: 'The STRC dividend rate is variable. A repurchase does not freeze that rate, and it does not by itself increase BTC per common share.',
    zh: 'STRC 的股息率是浮动的。回购不会把这个利率冻住，也不会单凭本身让普通股每股比特币变多。',
  },
  unit: 'count',
  frequency: '1d',
  format: { kind: 'shares' },
  changeWindowDays: null,
  contract: point('count'),
  sources: [sec],
  history: history('2024-01-01', '只统计回购表里的 STRC 行。其它优先股系列不混进这个数。', 'Only the STRC row of the repurchase table. Other preferred series stay out.'),
  missingPolicy: 'null',
  betterWhen: null,
})

export const strategyMnav = defineMetric({
  id: 'strategy-mnav',
  asset: 'mstr',
  category: 'strategy',
  name: { en: 'Disclosed mNAV', zh: '披露 mNAV' },
  description: {
    en: 'The mNAV multiple Strategy printed. Signal does not recompute it.',
    zh: 'Strategy 印出来的 mNAV 倍数。本站不自行重算。',
  },
  methodology: {
    en: 'After 2026-07-23 the company describes mNAV as the Class A price divided by Net Bitcoin Per Share in dollars. Net bitcoin deducts specified senior claims and uses the fully diluted share count of the company’s definition. Earlier mNAV was a different ratio. This series stores only the multiples the briefings state, on the market-data session date. Market cap divided by bitcoin market value is not this number.',
    zh: '2026-07-23 之后，公司把 mNAV 描述为 A 类股价除以美元计的每股净比特币。净比特币会扣掉公司定义里的优先请求权，分母用它自己的完全稀释股数。更早的 mNAV 是另一个比率。这条序列只保存简报写明的倍数，时间用行情截止的那个交易日。市值除以比特币市值不是这个数。',
  },
  limits: {
    en: 'A multiple above 1 is not a buy signal, and a change in the multiple is not by itself dilution or a bargain. Signal does not reconstruct Net BPS.',
    zh: '大于 1 不是买入信号，倍数变化本身也不是稀释或便宜。本站不重建每股净比特币。',
  },
  unit: 'index',
  frequency: '1d',
  format: { kind: 'multiple', decimals: 2 },
  changeWindowDays: null,
  contract: {
    unit: 'index',
    scale: 1,
    aggregation: 'last',
    window: 'us-equity-close',
    labelSemantics: LABEL_SEMANTICS.none,
  },
  sources: [briefing],
  history: history(
    '2026-10-09',
    '只有简报写明 mNAV 的日期。2026-07-23 之前的旧口径不混进来。',
    'Only dates where the briefing states mNAV. The pre-2026-07-23 definition is not mixed in.',
  ),
  missingPolicy: 'null',
  betterWhen: null,
})

export const strategyUsdReserve = defineMetric({
  id: 'strategy-usd-reserve',
  asset: 'mstr',
  category: 'strategy',
  name: { en: 'USD reserve', zh: '美元储备' },
  description: {
    en: 'The USD Reserve Strategy said it keeps for preferred dividends and debt interest.',
    zh: 'Strategy 说用于优先股股息和债务利息的美元储备。',
  },
  methodology: {
    en: 'The 8-K sentence separates USD Reserve from USD Cash. Only the reserve is stored here. Other dollar assets are not treated as cash that can pay the dividend.',
    zh: '8-K 把 USD Reserve 和 USD Cash 分开写。这里只保存储备。其它美元资产不当成可以拿去付股息的现金。',
  },
  limits: {
    en: 'Dividing the reserve by a dividend estimate is a coverage model this series does not compute. The preferred dividend rate can change.',
    zh: '用储备去除以某个股息估计，是覆盖期模型，这条序列不算。优先股股息率会变。',
  },
  unit: 'usd',
  frequency: '1d',
  format: { kind: 'usd' },
  changeWindowDays: null,
  contract: point('usd'),
  sources: [sec],
  history: history('2024-01-01', '只在 8-K 同时写明储备金额时有点。', 'A point exists only when the 8-K states the reserve amount.'),
  missingPolicy: 'null',
  betterWhen: null,
})

export const strategyUsdCash = defineMetric({
  id: 'strategy-usd-cash',
  asset: 'mstr',
  category: 'strategy',
  name: { en: 'USD cash', zh: '美元现金' },
  description: {
    en: 'The USD Cash balance Strategy separates from the dividend reserve.',
    zh: 'Strategy 与股息储备分开披露的美元现金。',
  },
  methodology: {
    en: 'Taken from the same 8-K sentence as the reserve, the second amount, labeled USD Cash. It is not added into the reserve.',
    zh: '和储备来自 8-K 的同一句话，取其中标成 USD Cash 的那一笔。不并进储备。',
  },
  limits: {
    en: 'Management may use this balance for purposes other than the preferred dividend. It is not a coverage period.',
    zh: '管理层可以把这笔余额用在优先股股息以外的地方。它不是覆盖期。',
  },
  unit: 'usd',
  frequency: '1d',
  format: { kind: 'usd' },
  changeWindowDays: null,
  contract: point('usd'),
  sources: [sec],
  history: history('2024-01-01', '只在 8-K 写明 USD Cash 时有点。', 'A point exists only when the 8-K states USD Cash.'),
  missingPolicy: 'null',
  betterWhen: null,
})

export const mstrMetrics: readonly MetricDefinition[] = [
  mstrPrice,
  mstrBtcBeta90d,
  strategyBtcHoldings,
  strategyBtcPerShare,
  strategyBtcCost,
  strategyBtcUnrealized,
  mstrCommonIssuance,
  strcRepurchase,
  strategyMnav,
  strategyUsdReserve,
  strategyUsdCash,
]
