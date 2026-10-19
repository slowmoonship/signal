/**
 * 指标注册表 —— 唯一事实源。
 *
 * CLAUDE.md：任何包硬编码指标列表都是 bug。加指标 = 加定义 + 在这里注册。
 */

import { validateMetric, type MetricIssue } from './quality.js'
import type { Asset, MetricCategory, MetricDefinition } from './types.js'
import { ASSETS, METRIC_CATEGORIES } from './types.js'

export class RegistryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RegistryError'
  }
}

export class MetricRegistry {
  readonly #byId = new Map<string, MetricDefinition>()

  register(def: MetricDefinition): this {
    if (this.#byId.has(def.id)) {
      throw new RegistryError(`指标 id 重复注册："${def.id}"`)
    }
    this.#byId.set(def.id, def)
    return this
  }

  registerAll(defs: readonly MetricDefinition[]): this {
    for (const def of defs) this.register(def)
    return this
  }

  get(id: string): MetricDefinition {
    const found = this.#byId.get(id)
    if (!found) throw new RegistryError(`未注册的指标："${id}"`)
    return found
  }

  has(id: string): boolean {
    return this.#byId.has(id)
  }

  all(): readonly MetricDefinition[] {
    return [...this.#byId.values()]
  }

  byAsset(asset: Asset): readonly MetricDefinition[] {
    return this.all().filter((d) => d.asset === asset)
  }

  /** 首页用：按分类分组，分类顺序稳定（由 METRIC_CATEGORIES 决定） */
  grouped(asset: Asset): { category: MetricCategory; metrics: readonly MetricDefinition[] }[] {
    return METRIC_CATEGORIES.map((category) => ({
      category,
      metrics: this.byAsset(asset).filter((d) => d.category === category),
    })).filter((g) => g.metrics.length > 0)
  }

  /**
   * 校验全表：重复 id、deriveFrom 悬空引用等跨指标约束。
   * 返回全部问题（error + warning），由调用方决定是抛错还是仅告警。
   */
  validate(): readonly MetricIssue[] {
    const ids = new Set(this.#byId.keys())
    const issues: MetricIssue[] = []
    for (const def of this.all()) {
      // 重复 id 的检查需要"除自己以外"的 id 集合：
      // 直接把全表传进去会让每个指标都把自己当成重复项。
      // （注册阶段 register 已拦下重复，这里是给绕过 register 的构造路径兜底。）
      const others = new Set(ids)
      others.delete(def.id)
      issues.push(...validateMetric(def, others))
      if (def.deriveFrom) {
        for (const parent of def.deriveFrom) {
          const parentDef = this.#byId.get(parent)
          if (parentDef && parentDef.asset !== def.asset) {
            issues.push({
              metricId: def.id,
              level: 'error',
              code: 'deriveFrom.asset',
              message: `派生自不同资产：${parent}（${parentDef.asset}）→ ${def.id}（${def.asset}）`,
            })
          }
        }
      }
    }
    return issues
  }

  /** 派生指标的父指标定义，按依赖顺序返回 */
  parentsOf(def: MetricDefinition): readonly MetricDefinition[] {
    return (def.deriveFrom ?? []).map((id) => this.get(id))
  }
}

export function createRegistry(defs: readonly MetricDefinition[] = []): MetricRegistry {
  return new MetricRegistry().registerAll(defs)
}

export { ASSETS, METRIC_CATEGORIES }
