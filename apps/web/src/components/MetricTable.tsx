/**
 * 首页指标总表。
 *
 * 用真正的 `<table>` + `rowSpan`，而不是几个 div 拼出"看起来像合并单元格"的样子：
 * 分类合并是**语义**（同一个分类跨了这些行），不是装饰。读屏软件会把它读成
 * "分类：价格与市场"，而 div 拼出来的假合并只能被读成十七个互不相干的词。
 *
 * 列：分类 / 指标 / 当前值 / 7 日变化 / 当前状态 / 判定依据。
 *
 * **状态列与数据质量标记是两件事**（CLAUDE.md §首页）：
 * 状态列说的是"这个指标现在怎么样"，由 `packages/metrics` 的分位与方向算出；
 * 数据异常另有标记（待更新 / 历史不足 / 文件异常），挂在数值旁边。
 * 把两者混进同一列，读者就会把"抓取失败"读成"市场出事了"。
 *
 * **判定依据列不写死文案。** 它由特征层的数据现场生成
 * （"近一年分位 P82" / "7 日累计 +1,173 BTC"），
 * 写死的解释迟早和数值对不上，而生成的一句永远与状态词一致。
 *
 * 可点击范围：**只有指标名称本身**。第一版不做整行可点。
 *
 * 上一版用"拉伸链接"（`<Link>` 上的 `after:absolute after:inset-0` 撑满整行）。
 * 那个做法在这里是错的：绝对定位的后代在表格行里的包含块并不可靠，
 * 在真实浏览器里 `<Link>` 的伪元素会盖住整张表甚至整页——
 * 结果是**点页面任意位置都会跳到最后一个指标（矿工收入）的详情页**，
 * 连右上角的语言切换都被它吃掉。表格是可点的这件事收益很小，
 * 而"点哪都跳走"的代价极大，所以这一版把点击面积收回指标名本身。
 *
 * 移动端不横向滚动（CLAUDE.md）：分类列在窄屏收起，
 * 判定依据列在中等屏宽收起，分组边界由组标题承担
 * ——标题本来就要给读屏软件用，视觉上顺便把组分开了。
 */

import Link from 'next/link'

import {
  formatSignedPercent,
  formatValue,
  latestChange,
  latestKnown,
  MISSING,
  statusBasis,
  type FeatureTable,
  type HomeGroupKey,
  type SiteLocale,
  type MetricDefinition,
  type MetricStatus,
  type PublishedMetric,
} from '@slowmoonship/metrics'

import type { LoadResult } from '@/data/load'
import { getDictionary } from '@/i18n/dictionaries'
import { homeTintFor } from '@/lib/categories'

import { StatusPill } from './StatusPill'

export type MetricGroup = Readonly<{
  key: HomeGroupKey
  metrics: readonly MetricDefinition[]
}>

export type MetricTableProps = {
  readonly groups: readonly MetricGroup[]
  readonly locale: SiteLocale
  /** metricId → 读取结果。`undefined` 表示该指标根本没登记进这次加载 */
  readonly data: ReadonlyMap<string, LoadResult<PublishedMetric> | undefined>
  readonly changeWindowFor: (def: MetricDefinition) => number | null
  /** metricId → 当前状态。算不出来的那几个会是 `ok: false`，页面显示"缺数据" */
  readonly statuses: ReadonlyMap<string, MetricStatus>
  /** 判定依据列要用的特征表 */
  readonly features: FeatureTable
}

/**
 * 一行的可用性。
 *
 * 五态而不是两态，因为"没有这份文件"、"文件在但字段坏了"、"抓取失败但还留着旧快照"
 * 与"历史太短、算不出变化"对读者是四件完全不同的事。
 */
type Status = 'ok' | 'pending' | 'noData' | 'invalid' | 'shortHistory'

/**
 * 少于这个天数的历史就标"历史不足"。
 *
 * 日频指标 30 天是一年的十分之一，也刚好是分位标准化需要的最小样本量
 * （见 `packages/metrics` 的 `MIN_HISTORY_POINTS`）。低于它的指标
 * 既算不出有意义的"较 N 天前变化"，也做不了跨指标比较——
 * 免费源刚开始采集时正是这个样子，与其显示一个空的百分比，不如说清楚为什么空。
 */
const MIN_HISTORY_POINTS = 30

function statusOf(
  result: LoadResult<PublishedMetric> | undefined,
  metric: PublishedMetric | null,
): Status {
  if (!result) return 'noData'
  if (!result.ok) return result.reason === 'invalid' ? 'invalid' : 'noData'
  if (result.value.stale) return 'pending'
  if (metric && nonNullCount(metric) < MIN_HISTORY_POINTS) return 'shortHistory'
  return 'ok'
}

function nonNullCount(metric: PublishedMetric): number {
  let n = 0
  for (const p of metric.points) if (p.value !== null) n += 1
  return n
}

export function MetricTable({
  groups,
  locale,
  data,
  changeWindowFor,
  statuses,
  features,
}: MetricTableProps) {
  const t = getDictionary()

  return (
    <table className="w-full border-collapse text-sm">
      <caption className="sr-only">{t.index}</caption>
      <thead>
        <tr className="border-b border-rule-strong">
          {/* 列在窄屏收起时表头必须跟着一起收：表头数量与列数对不上时，
              读屏软件会把第 3 个表头念到第 2 列上。 */}
          <th scope="col" className="hidden w-24 py-2 pr-3 text-left align-bottom font-medium text-ink-subtle lg:table-cell">
            {t.colCategory}
          </th>
          <th scope="col" className="py-2 pr-3 text-left align-bottom font-medium text-ink-subtle">
            {t.colMetric}
          </th>
          <th scope="col" className="w-28 py-2 pr-3 text-right align-bottom font-medium text-ink-subtle sm:w-36">
            {t.colValue}
          </th>
          <th scope="col" className="w-16 py-2 pr-3 text-right align-bottom font-medium text-ink-subtle sm:w-20">
            {t.colChange}
          </th>
          <th scope="col" className="w-20 py-2 pr-3 text-left align-bottom font-medium text-ink-subtle">
            {t.colStatus}
          </th>
          <th scope="col" className="hidden w-28 py-2 text-left align-bottom font-medium text-ink-subtle xl:table-cell">
            {t.colBasis}
          </th>
        </tr>
      </thead>

      {groups.map((group) => (
        <tbody key={group.key} className={homeTintFor(group.key)}>
          {/* 组标题：宽屏下与分类列重复，收起；窄屏下靠它区分分组 */}
          <tr className="lg:hidden">
            <th
              scope="colgroup"
              className="border-b border-rule-strong py-1.5 text-left font-mono text-xs font-medium text-ink-muted uppercase tracking-widest"
            >
              {t.homeGroups[group.key]}
            </th>
            <td
              // 窄屏下分类列与判定依据列都是 display:none，可见列只剩 4 列
              // （指标 / 当前值 / 7 日变化 / 当前状态），colSpan 必须跟着减，
              // 否则读屏软件会以为这一行多出一列。
              colSpan={4}
              className="border-b border-rule-strong"
            />
          </tr>

          {group.metrics.map((def, index) => {
            const result = data.get(def.id)
            const metric = result?.ok === true ? result.value : null
            const status = statusOf(result, metric)
            const marketStatus = statuses.get(def.id)
            return (
              <tr
                key={def.id}
                // hover 用**半透明**的 ink 叠加，而不是不透明的 surface-sunken：
                // 行背景会画在行组（tbody）背景之上，不透明的悬停底色会把
                // 分类底色整片盖掉——鼠标扫过一组，同一组的行就先后"掉了色"，
                // 分组边界在读者眼前闪一下就没了。半透明叠加则保留色相。
                //
                // 这里**不能**加 `relative`：表格行一旦成为定位容器，
                // 任何绝对定位的后代（哪怕是别的单元格里链接的伪元素）
                // 都可能以整张表为包含块，覆盖整页并吞掉所有点击。
                className="border-b border-rule last:border-b-0 hover:bg-ink/[0.03]"
              >
                {index === 0 ? (
                  <th
                    scope="rowgroup"
                    rowSpan={group.metrics.length}
                    // 分类列在整段合并区里水平 + 垂直居中：
                    // 用真正的单元格对齐（align-middle），不用绝对定位模拟。
                    className="hidden w-24 border-b border-rule py-1.5 pr-3 text-center align-middle font-mono text-xs font-medium text-ink-muted uppercase tracking-widest lg:table-cell"
                  >
                    {t.homeGroups[group.key]}
                  </th>
                ) : null}

                <th scope="row" className="py-1.5 pr-3 text-left font-normal align-baseline">
                  <Link
                    href={`/metrics/${def.id}`}
                    className="text-ink hover:underline"
                  >
                    {def.name[locale]}
                  </Link>
                </th>

                {/* 数值列：窄屏允许在任意位置折行（wrap-anywhere）。
                    `break-words` 不够——它不改变单元格的最小内容宽度，
                    于是 "$1,646,907,492,049.81" 这类长数字会把整张表的
                    最小宽度撑到 381px，在 375px 屏上横向溢出 26px。
                    `overflow-wrap: anywhere` 会把最小宽度降到 1 个字符，
                    表格于是能收进视口。宽屏（sm 以上）恢复默认，
                    长数字在桌面端仍然完整显示在一行里。 */}
                <td className="py-1.5 pr-3 text-right font-mono text-sm text-ink tabular-nums wrap-anywhere sm:wrap-normal">
                  <Value metric={metric} def={def} locale={locale} status={status} />
                </td>

                <td className="py-1.5 pr-3 text-right font-mono text-sm text-ink-subtle tabular-nums">
                  <Change metric={metric} locale={locale} windowDays={changeWindowFor(def)} />
                </td>

                <td className="py-1.5 pr-3 text-left align-baseline">
                  {marketStatus ? (
                    <StatusPill status={marketStatus} locale={locale} />
                  ) : (
                    <span className="font-mono text-xs text-ink-subtle">{t.dataNoValue}</span>
                  )}
                </td>

                <td className="hidden py-1.5 text-left align-baseline font-mono text-xs whitespace-nowrap text-ink-subtle xl:table-cell">
                  {marketStatus ? (
                    <Basis marketStatus={marketStatus} features={features} locale={locale} />
                  ) : null}
                </td>
              </tr>
            )
          })}
        </tbody>
      ))}
    </table>
  )
}

/**
 * 判定依据：状态词是怎么来的。永远由数据生成，不写死。
 *
 * 这一格**必须短**。它是表格里的一列，不是解释框：
 * "指标 pool-concentration 的历史不足 365 天，无法做分位标准化"
 * 这种句子会把行高撑成两行、把整张表的下沿顶开，
 * 而且它把内部的 metric id 与计算口径直接摆到了读者面前。
 * 短版由 `statusBasis` 生成（"近1年 P66" / "7日净流入 1,173 BTC" / "历史不足"），
 * 完整解释留在 `title`（悬停可见）与指标详情页。
 */
function Basis({
  marketStatus,
  features,
  locale,
}: {
  readonly marketStatus: MetricStatus
  readonly features: FeatureTable
  readonly locale: SiteLocale
}) {
  const obs = features[marketStatus.featureId]
  const short = statusBasis(
    marketStatus,
    obs && obs.ok ? obs.value : undefined,
    locale,
  )
  // 完整原因只进 title，不进可见文本。
  const full = marketStatus.ok ? short : marketStatus.detail
  return <span title={full === short ? undefined : full}>{short}</span>
}

/**
 * 数值 + 数据质量标记。
 *
 * 标记只在不正常时出现：正常时这一格只有那个数。
 * 一列永远写着"正常"的信息等于没有信息（CLAUDE.md §首页）。
 */
function Value({
  metric,
  def,
  locale,
  status,
}: {
  readonly metric: PublishedMetric | null
  readonly def: MetricDefinition
  readonly locale: SiteLocale
  readonly status: Status
}) {
  const t = getDictionary()

  if (status === 'noData') {
    return <span className="text-ink-subtle">{t.dataNoValue}</span>
  }
  if (status === 'invalid') {
    return <span className="text-ink-subtle">{t.statusInvalid}</span>
  }

  const latest = metric ? latestKnown(metric.points) : null
  const formatted = formatValue(latest?.value ?? null, def.format, locale)
  const marker =
    status === 'pending' ? t.statusPending : status === 'shortHistory' ? t.statusShortHistory : null

  return (
    <>
      {formatted ?? <span className="text-ink-subtle">{MISSING}</span>}
      {marker ? (
        <span className="ml-1.5 text-[10px] text-ink-subtle">{marker}</span>
      ) : null}
    </>
  )
}

function Change({
  metric,
  locale,
  windowDays,
}: {
  readonly metric: PublishedMetric | null
  readonly locale: SiteLocale
  readonly windowDays: number | null
}) {
  // 窗口为 null 表示这个指标本身就是变化量（见 MetricDefinition.changeWindowDays），
  // 或者会取负值——对它算百分比等于回答读者没问的问题。
  const change = metric && windowDays !== null ? latestChange(metric.points, windowDays) : null
  return <>{formatSignedPercent(change, locale) ?? ''}</>
}