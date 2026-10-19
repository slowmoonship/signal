/**
 * 数据质量校验。
 *
 * CLAUDE.md §数据质量红线 的可执行版本。
 * 这里的每条规则都对应一个具体事故模式，不是形式主义。
 */

import {
  type Asset,
  type Localized,
  type MetricDefinition,
  type MetricContract,
  ASSETS,
  METRIC_CATEGORIES,
  METRIC_FREQUENCIES,
  MISSING_POLICIES,
  UNITS,
  type UtcSeconds,
} from './types.js'

// ── 契约兼容性 ───────────────────────────────────────────

export class ContractMismatchError extends Error {
  constructor(
    readonly metricId: string,
    readonly field: keyof MetricContract,
    readonly expected: unknown,
    readonly actual: unknown,
  ) {
    super(
      `[${metricId}] 口径不兼容：${field} 期望 ${JSON.stringify(expected)}，` +
        `实际 ${JSON.stringify(actual)}。同名指标来源不同不得默认口径一致——` +
        `请确认后更新指标定义的 contract，或为该来源另立指标。`,
    )
    this.name = 'ContractMismatchError'
  }
}

function normalizeSemantics(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ')
}

const HARD_FIELDS = ['unit', 'scale', 'aggregation', 'window'] as const

/**
 * 比对新旧口径契约。不一致即抛错。
 *
 * 用途有二：
 * 1. 免费 → 付费适配器切换时，确认口径可替换
 * 2. 派生指标组合多个来源时，确认它们说的是同一件事
 *
 * 刻意严格：宁可逼人显式处理，也不要静默产出"看着对但口径已变"的序列。
 */
export function assertContractCompatible(
  metricId: string,
  expected: MetricContract,
  actual: MetricContract,
): void {
  for (const field of HARD_FIELDS) {
    if (expected[field] !== actual[field]) {
      throw new ContractMismatchError(metricId, field, expected[field], actual[field])
    }
  }
  if (
    normalizeSemantics(expected.labelSemantics) !== normalizeSemantics(actual.labelSemantics)
  ) {
    throw new ContractMismatchError(
      metricId,
      'labelSemantics',
      expected.labelSemantics,
      actual.labelSemantics,
    )
  }
}

// ── 下定义式表述检测 ─────────────────────────────────────

/**
 * 检测"下定义"式表述。
 *
 * 规则：实体标签（交易所 / 巨鲸 / 矿池 / 矿工）是启发式聚类，不是链上事实。
 * 来源非 `verified` 时，给出精确定义会误导读者，因此禁止这类表述，
 * 只能写成"按 X 数据源的标注口径统计"。
 *
 * 中文词表刻意不含裸"指"字——"指标"本身含"指"，会造成大量误报。
 */
const DEFINITIONAL_PATTERNS: readonly { pattern: RegExp; hint: string }[] = [
  { pattern: /指的是|系指|指代|即为|定义为|意味着|所谓的/, hint: '中文下定义表述' },
  { pattern: /\brefers to\b/i, hint: 'referring to' },
  { pattern: /\bis defined as\b|\bdefined as\b/i, hint: 'defined as' },
  { pattern: /\bstands for\b/i, hint: 'stands for' },
  { pattern: /\bmeans that\b/i, hint: 'means that' },
]

export type DefinitionLanguageHit = { pattern: string; hint: string; locale: 'en' | 'zh' }

/** 返回 methodology 中下定义式表述的命中项，空数组表示合规。 */
export function findDefinitionalLanguage(text: Localized): DefinitionLanguageHit[] {
  const hits: DefinitionLanguageHit[] = []
  for (const locale of ['zh', 'en'] as const) {
    for (const { pattern, hint } of DEFINITIONAL_PATTERNS) {
      if (pattern.test(text[locale])) {
        hits.push({ pattern: pattern.source, hint, locale })
      }
    }
  }
  return hits
}

// ── 指标定义校验 ─────────────────────────────────────────

export type IssueLevel = 'error' | 'warning'
export type MetricIssue = {
  metricId: string
  level: IssueLevel
  code: string
  message: string
}

const ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function checkLocalized(field: string, value: Localized, metricId: string, out: MetricIssue[]): void {
  for (const locale of ['en', 'zh'] as const) {
    const v = value[locale]?.trim()
    if (!v) {
      out.push({
        metricId,
        level: 'error',
        code: `localized.${field}.missing`,
        message: `${field}.${locale} 缺失。指标文案必须双语齐全。`,
      })
    }
  }
}

function isNonEmpty(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0
}

/**
 * 校验单个指标定义。
 *
 * 覆盖 METRIC_AUTHORING.md 的必填字段清单与提交前自检清单中可机器化的部分。
 */
export function validateMetric(def: MetricDefinition, knownIds?: ReadonlySet<string>): MetricIssue[] {
  const out: MetricIssue[] = []
  const push = (level: IssueLevel, code: string, message: string): void => {
    out.push({ metricId: def.id, level, code, message })
  }

  // 标识与枚举
  if (!ID_PATTERN.test(def.id)) {
    push('error', 'id.format', `id "${def.id}" 必须是小写连字符格式`)
  }
  if (knownIds?.has(def.id)) {
    push('error', 'id.duplicate', `id "${def.id}" 重复注册`)
  }
  if (!ASSETS.includes(def.asset)) {
    push('error', 'asset.unknown', `asset "${def.asset}" 不在 ${ASSETS.join(',')} 中`)
  }
  if (!METRIC_CATEGORIES.includes(def.category)) {
    push('error', 'category.unknown', `category "${def.category}" 不在允许列表中`)
  }
  if (!METRIC_FREQUENCIES.includes(def.frequency)) {
    push('error', 'frequency.unknown', `frequency "${def.frequency}" 不在允许列表中`)
  }
  if (!MISSING_POLICIES.includes(def.missingPolicy)) {
    push('error', 'missingPolicy.unknown', `missingPolicy "${def.missingPolicy}" 非法`)
  }

  // 双语文案
  checkLocalized('name', def.name, def.id, out)
  checkLocalized('description', def.description, def.id, out)
  checkLocalized('methodology', def.methodology, def.id, out)

  // 单位与契约
  if (!UNITS.includes(def.unit)) {
    push('error', 'unit.unknown', `unit "${def.unit}" 不在受控列表中`)
  }
  if (def.contract.unit !== def.unit) {
    push(
      'error',
      'contract.unit.mismatch',
      `contract.unit (${def.contract.unit}) 与顶层 unit (${def.unit}) 不一致`,
    )
  }
  if (!Number.isFinite(def.contract.scale) || def.contract.scale <= 0) {
    push('error', 'contract.scale.invalid', `contract.scale 必须是正数，实为 ${def.contract.scale}`)
  }
  if (!isNonEmpty(def.contract.labelSemantics)) {
    push('error', 'contract.labelSemantics.missing', 'labelSemantics 必填，口径必须可核查')
  }

  // 来源
  if (def.sources.length === 0) {
    push('error', 'sources.empty', '至少要有一个来源')
  }
  for (const [i, src] of def.sources.entries()) {
    if (!isNonEmpty(src.provider)) push('error', `sources.${i}.provider`, 'provider 必填')
    if (!isNonEmpty(src.metric)) push('warning', `sources.${i}.metric`, '建议写明上游指标名以便核查')
  }

  // 标签可信度 × 下定义表述
  const minConfidence = def.sources.reduce((worst, s) => {
    const order = { verified: 0, heuristic: 1, unknown: 2 } as const
    return order[s.labelConfidence] > order[worst] ? s.labelConfidence : worst
  }, def.sources[0]?.labelConfidence ?? 'unknown')

  if (minConfidence !== 'verified') {
    const hits = findDefinitionalLanguage(def.methodology)
    for (const hit of hits) {
      push(
        'error',
        'methodology.definitional',
        `来源标签可信度为 ${minConfidence}，methodology.${hit.locale} 出现下定义式表述（${hit.hint}）。` +
          `只能表述为"按 X 数据源的标注口径统计"，不得给精确定义。`,
      )
    }
  }

  // 历史口径
  if (def.history.availableFrom !== null && !ISO_DATE.test(def.history.availableFrom)) {
    push(
      'error',
      'history.availableFrom.format',
      `availableFrom 必须是 ISO-8601 UTC 日期（YYYY-MM-DD）或 null，实为 "${def.history.availableFrom}"`,
    )
  }
  checkLocalized('history.note', def.history.note, def.id, out)
  if (def.history.mayBeRevised) {
    push(
      'warning',
      'history.mayBeRevised',
      '上游会重算历史值，页面需标注口径可能变化',
    )
  }
  if (def.history.availableFrom === null) {
    push('warning', 'history.availableFrom.unknown', '历史起点未知，页面需显式说明数据可能不完整')
  }

  // 派生指标。跨引用检查只在注册表聚合时才做（单指标校验拿不到全表 id）
  if (knownIds) {
    for (const parent of def.deriveFrom ?? []) {
      if (!knownIds.has(parent)) {
        push('error', 'deriveFrom.unknown', `deriveFrom 引用了未注册的指标 "${parent}"`)
      }
    }
  }

  return out
}

// ── 时间工具 ────────────────────────────────────────────

/** 校验一个纪元秒是否落在合理范围内（防上游给出秒/毫秒混用）。 */
export function isPlausibleUtcSeconds(ts: number): boolean {
  // 2009-01-03（比特币创世）到 2100-01-01
  return Number.isFinite(ts) && ts >= 1_230_768_000 && ts <= 4_102_444_800
}

/**
 * 把各种上游时间格式归一为 UTC 纪元秒。
 *
 * 上游常见三种：ISO-8601 带 Z、ISO 不带时区（按 UTC 处理）、已经是秒的纪元。
 * **不做本地时区推断**——那是数据出错的温床。
 */
export function toUtcSeconds(input: string | number): number {
  if (typeof input === 'number') {
    if (!isPlausibleUtcSeconds(input)) {
      throw new Error(`纪元秒不合理：${input}（检查是否上游误传毫秒）`)
    }
    return input
  }
  // 无时区后缀的按 UTC 解析，避免落到本地时区
  const normalized = /[Zz]|[+-]\d{2}:?\d{2}$/.test(input) ? input : `${input}Z`
  const ms = Date.parse(normalized)
  if (Number.isNaN(ms)) throw new Error(`无法解析时间：${JSON.stringify(input)}`)
  const secs = Math.floor(ms / 1000)
  if (!isPlausibleUtcSeconds(secs)) {
    throw new Error(`时间超出合理范围：${JSON.stringify(input)}`)
  }
  return secs
}

export function toUtcSecondsBrand(value: number): UtcSeconds {
  if (!isPlausibleUtcSeconds(value)) throw new Error(`纪元秒不合理：${value}`)
  return value as UtcSeconds
}

export function utcSecondsToIso(ts: UtcSeconds): string {
  return new Date(ts * 1000).toISOString()
}

export type { Asset }
