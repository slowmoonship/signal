/**
 * Signal 核心类型。
 *
 * 设计意图：把 `docs/METRIC_AUTHORING.md` 里的数据质量约束**编码进类型**，
 * 让违规在编译期或校验期就失败，而不是靠人记住。
 *
 * 字段的填写标准见 docs/METRIC_AUTHORING.md。
 */

// ── 基础枚举 ──────────────────────────────────────────────

export const ASSETS = ['btc', 'eth', 'sol'] as const
export type Asset = (typeof ASSETS)[number]

export const LOCALES = ['en', 'zh'] as const
export type Locale = (typeof LOCALES)[number]

export const METRIC_CATEGORIES = ['market', 'onchain', 'fees', 'mining'] as const
export type MetricCategory = (typeof METRIC_CATEGORIES)[number]

export const UNITS = [
  'btc',
  'usd',
  'count',
  'hashrate',
  'percent',
  'sat_per_vbyte',
  'index',
  'blocks',
] as const
export type Unit = (typeof UNITS)[number]

/** MVP 全部日频（ADR-004）。新增频率前必须先更新该 ADR。 */
export const METRIC_FREQUENCIES = ['1d'] as const
export type MetricFrequency = (typeof METRIC_FREQUENCIES)[number]

/**
 * 实体标签可信度。
 *
 * 交易所 / 巨鲸 / 矿池 / 矿工这类标签是**启发式聚类标注，不是链上事实**。
 * 非 `verified` 的来源禁止在下定义式的表述（见 `assertNoDefinitionalLanguage`）。
 */
export const LABEL_CONFIDENCES = ['verified', 'heuristic', 'unknown'] as const
export type LabelConfidence = (typeof LABEL_CONFIDENCES)[number]

export type AuthMode = 'none' | 'apiKey'

export type BetterWhen = 'higher' | 'lower' | null

/** 双语文案。缺任一语言都会被校验拦下。 */
export type Localized = Readonly<{ en: string; zh: string }>

// ── 时间 ────────────────────────────────────────────────

/**
 * UTC 纪元秒。
 *
 * 全站统一：存储、传输、比较一律用它。禁止本地时区字符串、
 * 禁止裸日期字符串（无时区无法确定瞬时点）。
 */
export type UtcSeconds = number & { readonly __brand: 'UtcSeconds' }

// ─�� 数据点 ──────────────────────────────────────────────

/**
 * 单个观测点。
 *
 * `value: number | null` 是**有意设计**：
 * - `null` = 上游没有该时间点的数据（缺失），**绝不填零**
 * - `0`    = 真实值为零（有效数据）
 *
 * 两者语义完全不同，不可互换。见 METRIC_AUTHORING.md §缺失值。
 */
export type Point = Readonly<{
  ts: UtcSeconds
  value: number | null
}>

/**
 * 去掉品牌的观测点。
 *
 * 派生与格式化只关心 `ts` 是 UTC 纪元秒，不关心它是否被类型系统验证过。
 * 用这个结构类型签名，`Point`（运行期已校验）与发布文件读回的裸 `number`
 * 都能直接传进去，不必在 web 层做品牌断言。
 */
export type SeriesPoint = Readonly<{ ts: number; value: number | null }>

// ── 语义契约 ────────────────────────────────────────────

/**
 * 口径契约。
 *
 * 同名指标在不同数据源下**不保证口径一致**。切换适配器时必须比对契约，
 * 禁止静默替换（见 `assertContractCompatible`）。
 */
export type MetricContract = Readonly<{
  /** 数值单位 */
  unit: Unit
  /** 从上游原始值换算到 `unit` 的乘数。如聪 → BTC 为 1e-8 */
  scale: number
  /** 区间聚合方式 */
  aggregation: 'sum' | 'mean' | 'last' | 'none'
  /** 时间窗口径 */
  window: 'calendar-day-utc' | 'rolling-24h' | 'block-144' | 'point'
  /**
   * 实体标注口径说明。涉及交易所 / 巨鲸 / 矿池的指标必填，
   * 且必须与 `sources[].labelConfidence` 的可信度相符。
   */
  labelSemantics: string
}>

// ── 来源 ────────────────────────────────────────────────

export type SourceRef = Readonly<{
  provider: string
  /** 上游指标名，如 `AdrActCnt` */
  metric?: string
  /** 供人核查的上游端点 */
  endpoint?: string
  auth: AuthMode
  labelConfidence: LabelConfidence
}>

// ── 缺失值策略 ───────────────────────────────────────────

/**
 * 缺失值策略。
 *
 * 目前只有一个合法值，保留为枚举是为了**强制每个指标显式声明**，
 * 避免"留空 = 默认填零"这种静默劣化。未来若确需别的策略，
 * 应先在 METRIC_AUTHORING.md 里论证再扩展此联合类型。
 */
export const MISSING_POLICIES = ['null'] as const
export type MissingPolicy = (typeof MISSING_POLICIES)[number]

// ── 历史口径 ─────────────────────────────────────────────

export type HistoryCoverage = Readonly<{
  /**
   * 可得历史起点（ISO-8601 UTC 日期）。
   * `null` = 未知或该指标为点值（无历史）。
   * 免费源通常只有近数月至数年历史，**必须在页面明示**。
   */
  availableFrom: string | null
  /** 双语说明：历史为何有限、会不会被源重算 */
  note: Localized
  /** 上游是否会重算历史值（如聚类算法更新）—— 会则页面需标注 */
  mayBeRevised: boolean
}>

// ── 派生计算 ──────────────────────────────────────────────

/**
 * 派生指标的计算方式。
 *
 * 只有两种形态，因为只有这两种推导是**不引入新假设**的：
 * - 逐点相减：两个上游序列相减（交易所净流入 = 流入 − 流出）
 * - 滚动百分比变化：同一序列的 t 与 t−N 点相比（7 日涨跌幅）
 *
 * `left` / `right` / `base` 既可以是已注册指标 id（从库里已有序列推导），
 * 也可以是上游指标名（同源取两条序列相减）。两者都必须是 `sources` 里
 * 已声明的指标，否则定义校验会报错——避免拼错指标名却静默产出 0。
 */
export type Derivation =
  | Readonly<{ kind: 'difference'; left: string; right: string }>
  | Readonly<{ kind: 'percentChange'; base: string; windowDays: number }>

// ── 指标定义 ────────────────────────────────────────────

export type FormatSpec =
  | { kind: 'int' }
  | { kind: 'decimal'; maxDecimals: number }
  | { kind: 'usd' }
  | { kind: 'btc' }
  | { kind: 'percent'; maxDecimals?: number }
  | { kind: 'hashrate' }
  | { kind: 'satPerVbyte' }

export type MetricDefinition = Readonly<{
  id: string
  asset: Asset
  category: MetricCategory
  /** 指标名 */
  name: Localized
  /** 这个数说明了什么 */
  description: Localized
  /** 计算公式本身，不是公式的名字 */
  methodology: Localized
  unit: Unit
  frequency: MetricFrequency
  format: FormatSpec
  contract: MetricContract
  sources: readonly SourceRef[]
  history: HistoryCoverage
  missingPolicy: MissingPolicy
  /** 涨跌是否有内在好坏。null = 中性，不染涨跌色 */
  betterWhen: BetterWhen
  /** 派生指标的父指标 id（必须是已注册的指标）。undefined = 非本注册表内派生 */
  deriveFrom?: readonly string[]
  /**
   * 派生计算方式。省略 = 该数值由某个上游端点直接给出，未经本地运算。
   *
   * 矿池集中度属于后者：HHI 由单次响应里的矿池份额分布算出，
   * 分布本身不是一个对外发布的指标，因此不写成 difference / percentChange。
   */
  derivation?: Derivation
  /**
   * 首页与详情页"较 N 天前"那一列的窗口天数。
   *
   * 省略 = 用全局默认的 7 天。显式 `null` = **不展示这一列**：
   * 对"7 日价格变化"这类本身就是变化量的指标，
   * 再对它做一次百分比变化等于回答读者没问的问题。
   */
  changeWindowDays?: number | null
  /**
   * 该序列会取负值（如净流入：正为流入交易所，负为流出）。
   *
   * 有了这个标记，页面才不会给这类指标算"较 7 天前变化了多少 %"：
   * 一个从 +837 BTC 变成 −163 BTC 的指标，百分比变化算出 −119%，
   * 读起来却像"某个正数跌了 119%"，与读者看到的事实完全相反。
   */
  canBeNegative?: boolean
  /**
   * 该数值由 Signal 在本地算出，但无法写成 difference / percentChange。
   *
   * 矿池集中度属于此类：HHI 由**单次响应里**的份额分布算出，
   * 分布本身不是一个可单独发布的序列，因此 `derivation` 留空。
   * 但页面必须如实告诉读者"这个数是 Signal 算的"，
   * 否则它会和上游直给的指标一样被标成"不做任何运算"。
   */
  computedLocally?: true
}>

// ── 发布快照 ────────────────────────────────────────────

/**
 * 一份发布的指标数据。
 *
 * 时间字段缺一不可且含义不同：
 * - `sourceTime`  = 上游**产生**该数据的时间
 * - `ingestedAt`  = 我们**采集**到它的时间
 *
 * 二者常常不同（免费源多为 T+1 结算），混淆会误导读者判断新鲜度。
 */
export type MetricSnapshot = Readonly<{
  metricId: string
  asset: Asset
  /** 本地化文案随定义走，快照只带数值与口径 */
  contract: MetricContract
  points: readonly Point[]
  sourceTime: string
  ingestedAt: string
  /**
   * 数据是否已过期 / 上游未结算。
   * true 时页面必须明示"待更新"，不得假装正常。
   */
  stale: boolean
  /** 实际产出这份数据的来源（可能与定义的候选来源不同） */
  resolvedSources: readonly SourceRef[]
  /** 采集期间的告警，如部分区间缺失 */
  warnings: readonly string[]
}>
