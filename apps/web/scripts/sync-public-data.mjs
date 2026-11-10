/**
 * 把仓库根的 `public/data/*.json` 同步到 web 应用自己的 public 目录。
 *
 * 为什么需要这一步：Next 的静态导出只复制**应用自己的** public 目录
 * （`apps/web/public`），而发布数据住在仓库根的 `public/data`
 * ——那是 ingest 包的发布目录（`packages/ingest/src/paths.ts`）。
 * 不做这一步，导出产物里就没有 `data/*.json`：
 * 站点照常渲染（数据在构建期就已经内联进 HTML 了），
 * 但"原始数据可下载"这件事就没了，`robots.txt` 里那条 disallow 也就没了意义。
 *
 * 失败必须让构建失败：静默跳过会产出"少了 20 份数据文件"的站点，
 * 而这件事在构建日志里看不出来。
 *
 * 同步是**镜像**而不是叠加：目标目录里多出来的文件会被删掉，
 * 否则某天删掉一个指标之后，它的历史会永远留在导出产物里。
 */

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '../../..')

const source = join(repoRoot, 'public/data')
const target = join(repoRoot, 'apps/web/public/data')

if (!existsSync(source)) {
  console.error(`找不到发布数据目录：${source}`)
  console.error('先跑一次 `npm run ingest:btc --workspace @slowmoonship/ingest -- --live`。')
  process.exit(1)
}

const files = readdirSync(source).filter((name) => name.endsWith('.json'))
if (files.length === 0) {
  console.error(`${source} 里没有 JSON 文件，拒绝构建一个没有数据的站点。`)
  process.exit(1)
}

mkdirSync(target, { recursive: true })

// 镜像：先清掉目标目录里不再属于来源的文件
for (const name of readdirSync(target)) {
  if (!files.includes(name)) rmSync(join(target, name), { recursive: true, force: true })
}

for (const name of files) {
  cpSync(join(source, name), join(target, name))
}

console.log(`已同步 ${files.length} 份发布数据 → apps/web/public/data/`)
