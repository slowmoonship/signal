/**
 * 指标定义入口。
 *
 * 存在的唯一理由：让"写错口径"在写定义的那一刻就失败，
 * 而不是等到页面上出现误导性数字。
 */

import { validateMetric, type MetricIssue } from './quality.js'
import type { MetricDefinition } from './types.js'

export class MetricValidationError extends Error {
  constructor(
    readonly metricId: string,
    readonly issues: readonly MetricIssue[],
  ) {
    const errors = issues.filter((i) => i.level === 'error')
    super(
      `指标 "${metricId}" 定义不合法（${errors.length} 个错误）：\n` +
        errors.map((i) => `  · [${i.code}] ${i.message}`).join('\n'),
    )
    this.name = 'MetricValidationError'
  }
}

/** 校验并冻结一个指标定义。校验不通过直接抛出，不返回。 */
export function defineMetric(def: MetricDefinition): MetricDefinition {
  // 跨引用检查（重复 id、deriveFrom 指向已注册指标）由 registry 在聚合时做，
  // 此处只做单指标自身的校验。
  const issues = validateMetric(def)
  const errors = issues.filter((i) => i.level === 'error')
  if (errors.length > 0) {
    throw new MetricValidationError(def.id, issues)
  }
  return Object.freeze(def)
}
