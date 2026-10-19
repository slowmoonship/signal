/**
 * 指标定义集合。
 *
 * BTC 已落地；ETH / SOL 按 ADR-006 的扩展缝新增同级目录后在此导入，
 * 页面层无需改动。
 */

import { createRegistry } from '../registry.js'
import type { MetricDefinition } from '../types.js'
import { btcMetrics } from './btc/index.js'

const DEFINITIONS: readonly MetricDefinition[] = [...btcMetrics]

export const registry = createRegistry(DEFINITIONS)

export { btcMetrics }
