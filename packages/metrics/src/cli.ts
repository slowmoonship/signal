#!/usr/bin/env tsx
/**
 * 指标定义校验器（`npm run metrics:validate`）。
 *
 * 放进 CI，防止不合规的指标定义被合进来。
 * 退出码：0 = 无 error（warning 照常打印）；1 = 有 error。
 */

import { registry } from './definitions/index.js'

const issues = registry.validate()
const errors = issues.filter((i) => i.level === 'error')
const warnings = issues.filter((i) => i.level === 'warning')

for (const w of warnings) {
  console.warn(`[warn] [${w.metricId}] [${w.code}] ${w.message}`)
}

if (errors.length > 0) {
  for (const e of errors) {
    console.error(`[error] [${e.metricId}] [${e.code}] ${e.message}`)
  }
  console.error(`\n✗ ${errors.length} 个错误，${warnings.length} 个警告。`)
  process.exit(1)
}

console.log(`✓ ${registry.all().length} 个指标定义校验通过${warnings.length ? `（${warnings.length} 个警告）` : ''}。`)
