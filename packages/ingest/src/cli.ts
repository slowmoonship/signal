#!/usr/bin/env tsx
/**
 * ingest CLI：`tsx src/cli.ts <command>`
 *
 *   btc        抓取 BTC 指标（默认 dry-run，加 --live 才真正落库发布）
 *   db:init    初始化数据库
 *   db:reset   删除并重建数据库（**破坏性**，仅本地开发用）
 */

import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

import { DEFAULT_DB_PATH, SnapshotStore } from './store/db.js'
import { consoleLogger, runIngest } from './runners/index.js'
import { publishDir } from './paths.js'
import {
  FIXTURE_DIR,
  fixtureSummary,
  generateFixtures,
  writeFixtures,
} from './fixtures/generate.js'
import type { FetchContext } from './sources/types.js'
import { adapters, DENIED_METRICS } from './sources/index.js'
import { registry } from '@slowmoonship/metrics'

const TIMEOUT_MS = 30_000

function flag(args: readonly string[], name: string): string | undefined {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}

function makeCtx(): FetchContext {
  return {
    fetchImpl: fetch,
    now: () => Date.now(),
    logger: consoleLogger,
    timeoutMs: TIMEOUT_MS,
  }
}

async function main(): Promise<number> {
  const [command = 'help', ...rest] = process.argv.slice(2)
  const live = rest.includes('--live')
  // --only id1,id2：只处理这几个指标。
  // 加一个新指标时必须重跑全部指标——新指标自己的历史序列往往依赖一次全量回算，
  // 只补它自己会让它与父指标的口径在不同日期上对不齐。
  const only = flag(rest, '--only')?.split(',').map((s) => s.trim()).filter(Boolean)

  switch (command) {
    case 'db:init': {
      const store = new SnapshotStore()
      store.close()
      console.log(`✓ 数据库就绪：${DEFAULT_DB_PATH}`)
      return 0
    }
    case 'db:reset': {
      for (const suffix of ['', '-wal', '-shm']) {
        rmSync(`${DEFAULT_DB_PATH}${suffix}`, { force: true })
      }
      const store = new SnapshotStore()
      store.close()
      console.log(`✓ 数据库已重建：${DEFAULT_DB_PATH}`)
      return 0
    }
    case 'btc': {
      if (!live) {
        console.log('⚠ dry-run 模式：不落库、不发布。加 --live 才会真正写入。\n')
      }
      const store = new SnapshotStore()
      try {
        const report = await runIngest({
          asset: 'btc',
          store,
          ctx: makeCtx(),
          dryRun: !live,
          ...(only ? { only } : {}),
          ...(live ? { publishDir: publishDir() } : {}),
        })
        const failed = report.outcomes.filter((o) => o.status === 'failed')
        return failed.length > 0 ? 1 : 0
      } finally {
        store.close()
      }
    }
    case 'fixtures:btc': {
      const endDate = flag(rest, '--end') ?? '2026-10-19'
      // 默认天数必须容得下定投回测的窗口（3650 天）：
      // 窗口装不下时 maxDcaWaitSeries 返回空序列，fixture 里那个指标就只剩一个空壳。
      const days = Number(flag(rest, '--days') ?? '3660')
      if (!Number.isInteger(days) || days < 2) {
        console.error('--days 必须是 ≥ 2 的整数')
        return 1
      }
      const outDir = flag(rest, '--out') ?? FIXTURE_DIR
      const files = generateFixtures({ endDate, days, outDir })
      const bytes = writeFixtures(files, outDir)
      console.log(`✓ 已生成 ${files.size} 份 fixture → ${outDir}（${(bytes / 1024).toFixed(0)} KB）`)
      console.log(`  结束日 ${endDate}，历史 ${days} 天`)
      console.log(fixtureSummary(files))
      console.log(`\n⚠ 这些是合成数据，不能当作真实市场数据发布。用 npm run dev:fixtures 查看。`)
      return 0
    }
    case 'verify:published': {
      // 发布物体检。CI 在部署之前用它把一道关：
      // **每个注册指标都必须有一份文件，且至少有一个有效数据点。**
      //
      // 为什么不是"没有失败就发"：空库起跑时，某个源失败会让它的指标
      // 在库里没有点。合并规则会保住磁盘上的上一份，但万一上一份也没有
      // （首次发布、或文件被误删），那一格就会变成"没有数据"——
      // 与其发上去让读者看到空白，不如在这里挡住。
      const dir = publishDir()
      const problems: string[] = []
      const ids = registry.byAsset('btc').map((d) => d.id)
      let stale = 0
      for (const id of ids) {
        const file = join(dir, `${id}.json`)
        if (!existsSync(file)) {
          problems.push(`${id}: 没有发布文件`)
          continue
        }
        let parsed: unknown
        try {
          parsed = JSON.parse(readFileSync(file, 'utf8'))
        } catch (e) {
          problems.push(`${id}: 文件无法解析（${String(e)}）`)
          continue
        }
        const metric = parsed as { points?: unknown; stale?: unknown }
        const points = Array.isArray(metric.points) ? metric.points : []
        const nonNull = points.filter(
          (p) =>
            typeof p === 'object' &&
            p !== null &&
            (p as { value?: unknown }).value !== null &&
            typeof (p as { value?: unknown }).value === 'number',
        ).length
        if (nonNull === 0) problems.push(`${id}: 没有任何有效数据点`)
        if (metric.stale === true) stale += 1
      }
      // 发布目录里不该有注册表之外的文件（多半是手工误放）
      const known = new Set(ids.map((id) => `${id}.json`))
      for (const name of readdirSync(dir)) {
        if (name.endsWith('.json') && !known.has(name)) {
          problems.push(`${name}: 不在注册表里`)
        }
      }
      if (problems.length > 0) {
        console.error('✗ 发布物体检未通过：')
        for (const p of problems) console.error(`  · ${p}`)
        return 1
      }
      console.log(`✓ ${ids.length} 份发布数据全部通过体检（其中 ${stale} 份标记 stale）`)
      return 0
    }
    case 'sources': {
      console.log(`已注册适配器 ${adapters.length} 个：`)
      for (const a of adapters) {
        console.log(`  · ${a.provider}  auth=${a.auth}`)
      }
      console.log(`\nCoin Metrics 付费墙指标（不可用，MVP 不引用）：`)
      console.log(`  ${[...DENIED_METRICS].join(', ')}`)
      return 0
    }
    default: {
      console.log(`用法：
  tsx src/cli.ts btc [--live] [--only id,id]   抓取 BTC 指标（默认 dry-run）
  tsx src/cli.ts fixtures:btc [--end D] [--days N] [--out DIR]
                                              生成合成 fixture（仅开发/测试）
  tsx src/cli.ts db:init                       初始化数据库
  tsx src/cli.ts db:reset                      删库重建（破坏性）
  tsx src/cli.ts sources                       列出已注册适配器与付费墙指标`)
      return 0
    }
  }
}

main()
  .then((code) => process.exit(code))
  .catch((e: unknown) => {
    console.error(e instanceof Error ? e.stack : String(e))
    process.exit(1)
  })
