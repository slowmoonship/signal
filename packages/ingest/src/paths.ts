/**
 * 路径解析。
 *
 * npm workspaces 会把脚本的 cwd 设为**包目录**（packages/ingest），
 * 因此裸相对路径 'data/signal.db' 会落到 packages/ingest/data/，
 * 与规划中"仓库根目录 data/"不符。这里统一锚定到仓库根，
 * 使 `npm run ingest:btc` 从任何位置调用都写到同一处。
 */

import { dirname, join, resolve } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** 从本文件向上找带 workspaces 字段的 package.json，即仓库根 */
function findRepoRoot(): string {
  const start = dirname(fileURLToPath(import.meta.url))
  let dir = start
  for (let i = 0; i < 10; i += 1) {
    const pkg = join(dir, 'package.json')
    if (existsSync(pkg)) {
      try {
        const parsed: unknown = JSON.parse(readFileSync(pkg, 'utf8'))
        if (typeof parsed === 'object' && parsed !== null && 'workspaces' in parsed) {
          return dir
        }
      } catch {
        // 忽略无法解析的 package.json，继续向上找
      }
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  // 兜底：从 packages/ingest/src/paths.ts 往上三级即仓库根
  return resolve(start, '../../..')
}

export const REPO_ROOT = findRepoRoot()

/** 环境变量优先，便于 CI 与测试改写位置 */
export function dbPath(): string {
  return process.env['SIGNAL_DB_PATH'] ?? join(REPO_ROOT, 'data/signal.db')
}

export function publishDir(): string {
  return process.env['SIGNAL_PUBLISH_DIR'] ?? join(REPO_ROOT, 'public/data')
}
