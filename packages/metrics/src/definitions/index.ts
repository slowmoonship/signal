/**
 * 指标定义集合。
 *
 * MVP 阶段只定义 BTC（Phase 1 起填充）。
 * 加 ETH/SOL = 新建 `eth/` 目录 + 在此导入，页面层无需改动。
 */

import { createRegistry } from '../registry.js'
import type { MetricDefinition } from '../types.js'

// Phase 1 起：`import * as btc from './btc/index.js'`
const DEFINITIONS: readonly MetricDefinition[] = []

export const registry = createRegistry(DEFINITIONS)
