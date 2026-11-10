/**
 * SQLite 存储层（`node:sqlite`，见 ADR-007）。
 *
 * 两条硬约束在此落地：
 * 1. `value` 允许为 NULL —— 缺失就是缺失，不以 0 代替
 * 2. 快照元信息按 metric 单独存，取数失败时不动它，
 *    即"采集失败不覆盖上一份有效快照"
 */

import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

import type {
  DcaDistribution,
  DcaWorstCase,
  MetricSnapshot,
  ObservationCoverage,
  Point,
  SourceRef,
  UtcSeconds,
} from '@slowmoonship/metrics'

import { dbPath } from '../paths.js'

/** 相对路径统一锚定仓库根，避免受 npm workspaces 的 cwd 影响 */
export const DEFAULT_DB_PATH = dbPath()

const SCHEMA = `
CREATE TABLE IF NOT EXISTS metric_points (
  metric_id TEXT    NOT NULL,
  asset     TEXT    NOT NULL,
  ts        INTEGER NOT NULL,   -- UTC 纪元秒
  value     REAL,               -- NULL = 缺失。绝不以 0 代替缺失
  PRIMARY KEY (metric_id, ts)
);

CREATE TABLE IF NOT EXISTS snapshot_meta (
  metric_id     TEXT PRIMARY KEY,
  asset         TEXT NOT NULL,
  source_time   TEXT NOT NULL,  -- 上游产生数据的时间
  ingested_at   TEXT NOT NULL,  -- 我们采集到它的时间
  stale         INTEGER NOT NULL,
  contract_json TEXT NOT NULL,
  sources_json  TEXT NOT NULL,
  warnings_json TEXT NOT NULL,
  coverage_json TEXT,           -- 观测覆盖率；NULL = 该指标无观测被排除
  worst_case_json TEXT,         -- 派生指标的可核对锚点；NULL = 该指标没有
  distribution_json TEXT        -- 等待天数的统计分布；NULL = 该指标没有
);

CREATE INDEX IF NOT EXISTS idx_points_asset_ts ON metric_points (asset, ts);
`

/**
 * 轻量迁移。
 *
 * `CREATE TABLE IF NOT EXISTS` 对**已存在**的表是空操作，因此后加的列
 * 不会自动出现在旧库上——而 CI 的 runner 常常复用缓存里的 `data/signal.db`。
 * 这里逐列检查、按需补齐，而不是要求所有人先 `npm run db:reset`。
 * 缺的列一律可空且无默认值，补完不影响任何已有行。
 */
function ensureCoverageColumn(db: DatabaseSync): void {
  const cols = db.prepare('PRAGMA table_info(snapshot_meta)').all() as { name: string }[]
  if (cols.some((c) => c.name === 'coverage_json')) return
  db.exec('ALTER TABLE snapshot_meta ADD COLUMN coverage_json TEXT')
}

/** 最坏路径锚点列。与 coverage 列同一批迁移，加在后面。 */
function ensureWorstCaseColumn(db: DatabaseSync): void {
  const cols = db.prepare('PRAGMA table_info(snapshot_meta)').all() as { name: string }[]
  if (cols.some((c) => c.name === 'worst_case_json')) return
  db.exec('ALTER TABLE snapshot_meta ADD COLUMN worst_case_json TEXT')
}

/** 统计分布列。与 worst_case 同批迁移。 */
function ensureDistributionColumn(db: DatabaseSync): void {
  const cols = db.prepare('PRAGMA table_info(snapshot_meta)').all() as { name: string }[]
  if (cols.some((c) => c.name === 'distribution_json')) return
  db.exec('ALTER TABLE snapshot_meta ADD COLUMN distribution_json TEXT')
}

export type StoredSnapshotMeta = {
  metricId: string
  asset: string
  sourceTime: string
  ingestedAt: string
  stale: boolean
  contractJson: string
  sourcesJson: string
  warningsJson: string
  coverageJson: string | null
  worstCaseJson: string | null
  distributionJson: string | null
}

/** 库里的 coverage_json 是 TEXT；解析失败说明 schema 受损，宁可当没有也不能猜 */
function parseCoverage(raw: string | null): ObservationCoverage | null {
  if (raw === null) return null
  const parsed: unknown = JSON.parse(raw)
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !Number.isInteger((parsed as { included?: unknown }).included) ||
    !Number.isInteger((parsed as { censored?: unknown }).censored)
  ) {
    throw new Error(`coverage_json 内容非法：${raw}`)
  }
  const record = parsed as { included: number; censored: number; invalidated?: unknown }
  // invalidated 是后加的列：旧库里没有这个数，按 0 处理是安全的——
  // "没有因数据缺口而作废的起点"与"这个口径还不存在"在旧数据上无法区分，
  // 而把未知说成 0 会高估样本量，因此这里选择保留缺失语义。
  const invalidated = Number.isInteger(record.invalidated) ? (record.invalidated as number) : 0
  return { included: record.included, censored: record.censored, invalidated }
}

/** worst_case_json 解析。字段不全就当作没有锚点，而不是补一个假的。 */
function parseWorstCase(raw: string | null): DcaWorstCase | null {
  if (raw === null) return null
  const parsed: unknown = JSON.parse(raw)
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`worst_case_json 内容非法：${raw}`)
  }
  const record = parsed as Record<string, unknown>
  const startTs = record['startTs']
  const passageTs = record['passageTs']
  const days = record['days']
  const maxDrawdownPercent = record['maxDrawdownPercent']
  if (
    typeof startTs !== 'number' ||
    typeof passageTs !== 'number' ||
    typeof days !== 'number' ||
    typeof maxDrawdownPercent !== 'number'
  ) {
    throw new Error(`worst_case_json 内容非法：${raw}`)
  }
  return { startTs, passageTs, days, maxDrawdownPercent }
}

/** distribution_json 解析。字段不全就当作没有分布，而不是补一个假的。 */
function parseDistribution(raw: string | null): DcaDistribution | null {
  if (raw === null) return null
  const parsed: unknown = JSON.parse(raw)
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`distribution_json 内容非法：${raw}`)
  }
  const record = parsed as Record<string, unknown>
  const count = record['count']
  const min = record['min']
  const p50 = record['p50']
  const p90 = record['p90']
  const p99 = record['p99']
  const max = record['max']
  if (
    typeof count !== 'number' ||
    typeof min !== 'number' ||
    typeof p50 !== 'number' ||
    typeof p90 !== 'number' ||
    typeof p99 !== 'number' ||
    typeof max !== 'number'
  ) {
    throw new Error(`distribution_json 内容非法：${raw}`)
  }
  return { count, min, p50, p90, p99, max }
}

export class SnapshotStore {
  readonly #db: DatabaseSync

  constructor(path: string = DEFAULT_DB_PATH) {
    mkdirSync(dirname(path), { recursive: true })
    this.#db = new DatabaseSync(path)
    this.#db.exec('PRAGMA journal_mode = WAL;')
    this.#db.exec(SCHEMA)
    ensureCoverageColumn(this.#db)
    ensureWorstCaseColumn(this.#db)
    ensureDistributionColumn(this.#db)
  }

  close(): void {
    this.#db.close()
  }

  /** 幂等写入数据点。同一 (metric_id, ts) 覆盖，漏跑重跑安全。 */
  upsertPoints(metricId: string, asset: string, points: readonly Point[]): number {
    const stmt = this.#db.prepare(
      `INSERT INTO metric_points (metric_id, asset, ts, value) VALUES (?, ?, ?, ?)
       ON CONFLICT(metric_id, ts) DO UPDATE SET value = excluded.value, asset = excluded.asset`,
    )
    this.#db.exec('BEGIN')
    try {
      for (const p of points) stmt.run(metricId, asset, p.ts, p.value)
      this.#db.exec('COMMIT')
    } catch (e) {
      this.#db.exec('ROLLBACK')
      throw e
    }
    return points.length
  }

  /**
   * 提交一份快照的元信息与数据。
   *
   * 只在取数成功且至少有一个非空值时调用——这是"失败不覆盖旧快照"的执行点。
   * 整个提交在单个事务里，中途失败则回滚，不会留下半份快照。
   */
  commitSnapshot(snapshot: MetricSnapshot): void {
    const nonNull = snapshot.points.filter((p) => p.value !== null).length
    if (nonNull === 0) {
      throw new Error(
        `拒绝提交：指标 "${snapshot.metricId}" 没有任何非空数据点。` +
          `宁可不更新，也不要用空快照覆盖上一份有效数据。`,
      )
    }

    this.#db.exec('BEGIN')
    try {
      const stmt = this.#db.prepare(
        `INSERT INTO metric_points (metric_id, asset, ts, value) VALUES (?, ?, ?, ?)
         ON CONFLICT(metric_id, ts) DO UPDATE SET value = excluded.value, asset = excluded.asset`,
      )
      for (const p of snapshot.points) stmt.run(snapshot.metricId, snapshot.asset, p.ts, p.value)

      this.#db
        .prepare(
          `INSERT INTO snapshot_meta
             (metric_id, asset, source_time, ingested_at, stale, contract_json, sources_json, warnings_json, coverage_json, worst_case_json, distribution_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(metric_id) DO UPDATE SET
             asset = excluded.asset,
             source_time = excluded.source_time,
             ingested_at = excluded.ingested_at,
             stale = excluded.stale,
             contract_json = excluded.contract_json,
             sources_json = excluded.sources_json,
             warnings_json = excluded.warnings_json,
             coverage_json = excluded.coverage_json,
             worst_case_json = excluded.worst_case_json,
             distribution_json = excluded.distribution_json`,
        )
        .run(
          snapshot.metricId,
          snapshot.asset,
          snapshot.sourceTime,
          snapshot.ingestedAt,
          snapshot.stale ? 1 : 0,
          JSON.stringify(snapshot.contract),
          JSON.stringify(snapshot.resolvedSources),
          JSON.stringify(snapshot.warnings),
          snapshot.coverage ? JSON.stringify(snapshot.coverage) : null,
          snapshot.worstCase ? JSON.stringify(snapshot.worstCase) : null,
          snapshot.distribution ? JSON.stringify(snapshot.distribution) : null,
        )

      this.#db.exec('COMMIT')
    } catch (e) {
      this.#db.exec('ROLLBACK')
      throw e
    }
  }

  readPoints(metricId: string): { ts: UtcSeconds; value: number | null }[] {
    const stmt = this.#db.prepare(
      'SELECT ts, value FROM metric_points WHERE metric_id = ? ORDER BY ts ASC',
    )
    return stmt.all(metricId).map((r) => ({
      ts: Number(r['ts']) as UtcSeconds,
      value: r['value'] === null ? null : Number(r['value']),
    }))
  }

  readMeta(metricId: string): StoredSnapshotMeta | null {
    const row = this.#db.prepare('SELECT * FROM snapshot_meta WHERE metric_id = ?').get(metricId)
    if (!row) return null
    return {
      metricId: String(row['metric_id']),
      asset: String(row['asset']),
      sourceTime: String(row['source_time']),
      ingestedAt: String(row['ingested_at']),
      stale: Number(row['stale']) === 1,
      contractJson: String(row['contract_json']),
      sourcesJson: String(row['sources_json']),
      warningsJson: String(row['warnings_json']),
      coverageJson: row['coverage_json'] === null ? null : String(row['coverage_json']),
      worstCaseJson: row['worst_case_json'] === null ? null : String(row['worst_case_json']),
      distributionJson: row['distribution_json'] === null ? null : String(row['distribution_json']),
    }
  }

  /** 观测覆盖率。列缺失或为 NULL 都表示"无观测被排除"。 */
  readCoverage(metricId: string): ObservationCoverage | null {
    const meta = this.readMeta(metricId)
    return meta ? parseCoverage(meta.coverageJson) : null
  }

  /** 派生指标的可核对锚点（当前只有定投等待期）。 */
  readWorstCase(metricId: string): DcaWorstCase | null {
    const meta = this.readMeta(metricId)
    return meta ? parseWorstCase(meta.worstCaseJson) : null
  }

  /** 等待天数的统计分布（当前只有定投等待期）。 */
  readDistribution(metricId: string): DcaDistribution | null {
    const meta = this.readMeta(metricId)
    return meta ? parseDistribution(meta.distributionJson) : null
  }

  /**
   * 把某指标的元信息标记为 stale，**不动数据点**。
   *
   * 抓取失败时的正确行为：保留上一份有效数据，只在前端提示"待更新"。
   */
  markStale(metricId: string, ingestedAt: string, reason: string): boolean {
    const existing = this.readMeta(metricId)
    if (!existing) return false
    const warnings = JSON.parse(existing.warningsJson) as string[]
    if (!warnings.includes(reason)) warnings.push(reason)
    this.#db
      .prepare('UPDATE snapshot_meta SET stale = 1, ingested_at = ?, warnings_json = ? WHERE metric_id = ?')
      .run(ingestedAt, JSON.stringify(warnings), metricId)
    return true
  }

  listMetricIds(asset: string): string[] {
    return this.#db
      .prepare('SELECT DISTINCT metric_id FROM metric_points WHERE asset = ? ORDER BY metric_id')
      .all(asset)
      .map((r) => String(r['metric_id']))
  }
}

export type { SourceRef }
