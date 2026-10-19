/**
 * 页面数据读取。
 *
 * 唯一的数据来源是磁盘上的 JSON 文件（`public/data/*.json`）。
 * 页面**不**在服务端发起任何外部请求（CLAUDE.md 架构边界）：
 * 上游抖动不能变成 500，本地断网也能跑，日更语义（ADR-004）天然满足。
 *
 * 读取时逐字段校验，坏文件返回 null 而不是抛错：缺一份数据不该让整站打不开。
 * 但返回 null 也绝不能被当成 0——页面显示"尚无数据"。
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import { registry, type Asset, type PublishedMetric } from '@slowmoonship/metrics'

/** 指标 id 直接拼进文件路径，必须先过白名单，否则 `../` 可以读到仓库外 */
const SAFE_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/

/**
 * 仓库根 = 带 `workspaces` 字段的 package.json 所在目录。
 *
 * 不能用 `new URL(..., import.meta.url)`：webpack 会把它当成资源引用去解析一个
 * 以 `..` 开头的"模块"，直接报 Can't resolve。从 cwd 向上找则两边行为一致。
 */
function repoRoot(): string {
  let dir = process.cwd()
  for (let i = 0; i < 10; i += 1) {
    const pkg = join(dir, 'package.json')
    if (existsSync(pkg)) {
      try {
        const parsed: unknown = JSON.parse(readFileSync(pkg, 'utf8'))
        if (typeof parsed === 'object' && parsed !== null && 'workspaces' in parsed) return dir
      } catch {
        // 忽略无法解析的 package.json，继续向上找
      }
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  throw new Error('无法定位仓库根：向上 10 层都没找到带 workspaces 的 package.json')
}

/**
 * 数据目录。
 *
 * 默认是发布目录；`SIGNAL_DATA_DIR` 指向 `fixtures/btc` 时即切换到 fixture 模式。
 * 唯一的差别就是目录位置——页面代码路径完全相同，
 * 这样 fixture 验证的就是真实数据会走的那条路径。
 */
export function dataDir(): string {
  const override = process.env['SIGNAL_DATA_DIR']
  if (override !== undefined && override.trim() !== '') {
    return resolve(repoRoot(), override)
  }
  return join(repoRoot(), 'public/data')
}

export type LoadResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: 'missing' | 'invalid'; detail?: string }

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/**
 * 校验发布文件。
 *
 * 每个字段都查，因为"字段存在但类型不对"（例如某次手改把 value 写成字符串）
 * 在页面上会表现为诡异的数字，比直接判定为坏文件危险得多。
 */
export function parsePublishedMetric(raw: unknown, expectedId: string): LoadResult<PublishedMetric> {
  if (!isRecord(raw)) return { ok: false, reason: 'invalid', detail: '顶层不是对象' }
  if (raw['metricId'] !== expectedId) {
    return { ok: false, reason: 'invalid', detail: `metricId 为 ${String(raw['metricId'])}` }
  }
  if (raw['asset'] !== 'btc' && raw['asset'] !== 'eth' && raw['asset'] !== 'sol') {
    return { ok: false, reason: 'invalid', detail: `未知 asset ${String(raw['asset'])}` }
  }
  if (!isRecord(raw['contract'])) return { ok: false, reason: 'invalid', detail: '缺少 contract' }

  const rawPoints = raw['points']
  if (!Array.isArray(rawPoints)) return { ok: false, reason: 'invalid', detail: 'points 不是数组' }

  const points = []
  for (const p of rawPoints) {
    if (!isRecord(p)) return { ok: false, reason: 'invalid', detail: 'points 中存在非对象元素' }
    const ts = num(p['ts'])
    const value = p['value'] === null ? null : num(p['value'])
    // value 既不是 null 也不是有限数字 → 字段被破坏，不能猜
    if (ts === null || (p['value'] !== null && value === null)) {
      return { ok: false, reason: 'invalid', detail: `点 ${JSON.stringify(p)} 的 ts/value 非法` }
    }
    points.push({ ts, value })
  }

  const strings = (key: 'sourceTime' | 'ingestedAt'): string | null => {
    const v = raw[key]
    return typeof v === 'string' && v.length > 0 ? v : null
  }
  const sourceTime = strings('sourceTime')
  const ingestedAt = strings('ingestedAt')
  if (sourceTime === null || ingestedAt === null) {
    return { ok: false, reason: 'invalid', detail: '缺少 sourceTime 或 ingestedAt' }
  }
  if (typeof raw['stale'] !== 'boolean') {
    return { ok: false, reason: 'invalid', detail: 'stale 不是布尔值' }
  }

  const arr = (key: string): unknown[] => (Array.isArray(raw[key]) ? (raw[key] as unknown[]) : [])

  return {
    ok: true,
    value: {
      metricId: expectedId,
      asset: raw['asset'],
      contract: raw['contract'] as PublishedMetric['contract'],
      points,
      sourceTime,
      ingestedAt,
      stale: raw['stale'],
      sources: arr('sources') as PublishedMetric['sources'],
      warnings: arr('warnings').filter((w): w is string => typeof w === 'string'),
      ...(raw['fixture'] === true ? { fixture: true as const } : {}),
    },
  }
}

export function loadMetric(id: string): LoadResult<PublishedMetric> {
  if (!SAFE_ID.test(id)) return { ok: false, reason: 'invalid', detail: `非法指标 id "${id}"` }
  let text: string
  try {
    text = readFileSync(join(dataDir(), `${id}.json`), 'utf8')
  } catch {
    return { ok: false, reason: 'missing' }
  }
  try {
    return parsePublishedMetric(JSON.parse(text) as unknown, id)
  } catch (e) {
    return { ok: false, reason: 'invalid', detail: `JSON 解析失败：${String(e)}` }
  }
}

/** 指标 id 一律来自注册表，绝不在页面层硬编码列表（CLAUDE.md 架构边界）。 */
export function loadAsset(asset: Asset): Map<string, LoadResult<PublishedMetric>> {
  const out = new Map<string, LoadResult<PublishedMetric>>()
  for (const def of registry.byAsset(asset)) out.set(def.id, loadMetric(def.id))
  return out
}

export function isFixture(result: LoadResult<PublishedMetric>): boolean {
  return result.ok && result.value.fixture === true
}
