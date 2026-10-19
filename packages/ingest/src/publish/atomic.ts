/**
 * 原子发布。
 *
 * 写临时文件 → fsync → rename。rename 在同一文件系统内是原子的，
 * 因此读方永远看不到半份 JSON。
 *
 * 这条不能省：GitHub Actions 上抓取与构建可能并发，读者（CDN / 构建进程）
 * 必须在任意时刻都读到完整文件。
 */

import { renameSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

export type PublishResult = {
  readonly path: string
  readonly bytes: number
}

export function publishJson(dir: string, name: string, data: unknown): PublishResult {
  mkdirSync(dir, { recursive: true })
  const target = join(dir, name)
  const tmp = `${target}.${process.pid}.tmp`

  // 序列化成字符串后再写，避免 JSON.stringify 中途抛错留下半截文件
  const payload = `${JSON.stringify(data, null, 2)}\n`

  try {
    writeFileSync(tmp, payload, { encoding: 'utf8', mode: 0o644 })
    renameSync(tmp, target)
  } catch (e) {
    if (existsSync(tmp)) unlinkSync(tmp)
    throw new Error(`发布 ${target} 失败（已清理临时文件，原文件未被触碰）：${String(e)}`, {
      cause: e,
    })
  }

  return { path: target, bytes: Buffer.byteLength(payload) }
}

/**
 * 发布前的一致性检查：任何一项不通过就整个拒绝发布。
 *
 * 与单指标失败不同，这里的失败意味着**所有**指标都有问题
 * （网络全断、上游集体变更），此时保留上一份完整发布结果才是对的。
 */
export function assertPublishable(result: {
  metricId: string
  snapshot: { points: readonly { value: number | null }[]; stale: boolean }
}): void {
  const nonNull = result.snapshot.points.filter((p) => p.value !== null).length
  if (nonNull === 0) {
    throw new Error(
      `指标 "${result.metricId}" 无有效数据点，拒绝发布。` +
        `缺失的历史数据必须保留为 null，不得填零，也不得用空快照覆盖。`,
    )
  }
  if (result.snapshot.stale) {
    throw new Error(`指标 "${result.metricId}" 处于 stale 状态，拒绝发布。`)
  }
}
