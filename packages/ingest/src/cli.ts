#!/usr/bin/env tsx
/**
 * ingest CLI：`tsx src/cli.ts <command>`
 *
 *   btc        抓取 BTC 指标（默认 dry-run，加 --live 才真正落库发布）
 *   db:init    初始化数据库
 *   db:reset   删除并重建数据库（**破坏性**，仅本地开发用）
 */

import { rmSync } from 'node:fs'

import { DEFAULT_DB_PATH, SnapshotStore } from './store/db.js'
import { consoleLogger, runIngest } from './runners/index.js'
import { publishDir } from './paths.js'
import type { FetchContext } from './sources/types.js'
import { adapters, DENIED_METRICS } from './sources/index.js'

const TIMEOUT_MS = 30_000

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
          ...(live ? { publishDir: publishDir() } : {}),
        })
        const failed = report.outcomes.filter((o) => o.status === 'failed')
        return failed.length > 0 ? 1 : 0
      } finally {
        store.close()
      }
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
  tsx src/cli.ts btc [--live]   抓取 BTC 指标（默认 dry-run）
  tsx src/cli.ts db:init        初始化数据库
  tsx src/cli.ts db:reset       删库重建（破坏性）
  tsx src/cli.ts sources        列出已注册适配器与付费墙指标`)
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
