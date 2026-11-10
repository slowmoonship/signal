/**
 * 发布前的历史合并。
 *
 * 为什么需要它：GitHub Actions 每次运行都是一台**全新**的 runner，
 * 本地 SQLite 库是空的。抓取时"增量起点"（库里最后一个时间戳）
 * 因此永远是 null，适配器会按源能给的窗口返回数据——
 * 对 Coin Metrics 这类有完整历史的源没问题，
 * 但对 blockstream / mempool.space 这类**只提供近期数据**的源，
 * 每天抓到的就只是最近几个点。
 *
 * 如果直接用库里那点数据覆盖发布文件，这几个指标的历史就会永远停在
 * "最近几天"，越跑越短——而源那边其实每天都在往前滚，
 * 昨天发布过的那个点，本来是可以留下来的。
 *
 * 所以发布不是"覆盖"，是"合并"：
 *
 * - 时间戳按 UTC 对齐，同一个 ts 只保留一条；
 * - 新值非 null 时用新值（源可能重述历史，源今天的说法优先）；
 * - 新值是 null 而旧值有效时**保留旧值**——
 *   缺失不是"这个数变成空"，更不是"这个数不存在了"（CLAUDE.md 红线 1）；
 * - 只存在于旧文件里的点全部保留：那是已经发布过的历史，不许被一轮
 *   不完整的抓取抹掉。
 *
 * 这条合并规则同时挡住了另一个更危险的情形：**抓取失败**。
 * 失败时库里没有新点，合并结果就是旧文件原封不动，
 * 配合 stale 标记发布出去——页面继续显示上一份有效数据并提示"待更新"，
 * 而不是把指标清空（红线 2）。
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { PublishedMetric, SeriesPoint } from '@slowmoonship/metrics'

/**
 * 合并"已发布的旧点"与"本轮抓到的新点"。
 *
 * @param previous 磁盘上已发布的旧点；null = 没有旧文件（首次发布）
 * @param incoming 本轮抓到的点
 */
export function mergePublishedPoints(
  previous: readonly SeriesPoint[] | null,
  incoming: readonly SeriesPoint[],
): SeriesPoint[] {
  const byTs = new Map<number, number | null>()

  for (const p of previous ?? []) {
    byTs.set(p.ts, p.value)
  }

  for (const p of incoming) {
    const old = byTs.get(p.ts)
    if (p.value === null) {
      // 新值为空：不许把旧的有效值改成 null。
      // 旧值本来就是 null 时保持 null。
      if (old === undefined) byTs.set(p.ts, null)
      continue
    }
    byTs.set(p.ts, p.value)
  }

  return [...byTs.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([ts, value]) => ({ ts, value }))
}

/**
 * 读磁盘上已发布的上一份文件。
 *
 * 返回 null 表示"没有可用的上一份"（文件不存在、读不出来、形状不对）。
 * 形状不对时**不抛异常**：发布目录里的一份坏文件不该让整轮抓取失败；
 * 但也不能被当成"上一份是空的"——那正是会把历史抹掉的那条路。
 * 因此这里返回 null 之外还会打一条警告，让日志里留下痕迹。
 */
export function readPublished(
  dir: string,
  metricId: string,
  warn?: (message: string) => void,
): PublishedMetric | null {
  const file = join(dir, `${metricId}.json`)
  if (!existsSync(file)) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'))
  } catch (e) {
    warn?.(`已发布的 ${metricId}.json 无法解析（${String(e)}），本轮按"没有上一份"处理`)
    return null
  }

  if (typeof parsed !== 'object' || parsed === null) {
    warn?.(`已发布的 ${metricId}.json 不是对象，本轮按"没有上一份"处理`)
    return null
  }

  const record = parsed as Partial<PublishedMetric>
  if (!Array.isArray(record.points)) {
    warn?.(`已发布的 ${metricId}.json 缺少 points 字段，本轮按"没有上一份"处理`)
    return null
  }

  const points: SeriesPoint[] = []
  for (const p of record.points) {
    if (typeof p !== 'object' || p === null) continue
    const ts = (p as { ts?: unknown }).ts
    const value = (p as { value?: unknown }).value
    if (typeof ts !== 'number' || !Number.isFinite(ts)) continue
    if (value !== null && typeof value !== 'number') continue
    points.push({ ts, value: value === null ? null : value })
  }

  return { ...record, points } as PublishedMetric
}
