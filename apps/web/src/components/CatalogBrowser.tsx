'use client'

/**
 * 指标库的筛选发生在浏览器里。
 *
 * 数据在构建期已经放进页面，这里不再请求任何接口。
 * 搜索只匹配名称，不引入别的检索系统。
 */

import Link from 'next/link'
import { useMemo, useState } from 'react'

import type { MetricStatus, SiteLocale } from '@slowmoonship/metrics'

import { StatusPill } from '@/components/StatusPill'
import { getDictionary } from '@/i18n/dictionaries'

export type CatalogRow = {
  readonly id: string
  readonly name: string
  readonly search: string
  readonly group: string
  readonly groupLabel: string
  readonly asset: string
  readonly value: string
  readonly basis: string
  readonly time: string
  readonly stale: boolean
  readonly missing: boolean
  readonly status: MetricStatus
}

const ASSETS = ['btc', 'mstr'] as const

export function CatalogBrowser({ rows }: { readonly rows: readonly CatalogRow[] }) {
  const t = getDictionary()
  const locale: SiteLocale = 'zh'
  const [query, setQuery] = useState('')
  const [asset, setAsset] = useState<'all' | 'btc' | 'mstr'>('all')
  const [group, setGroup] = useState('all')
  const groups = useMemo(() => {
    const seen: { key: string; label: string }[] = []
    for (const row of rows) {
      if (!seen.some((item) => item.key === row.group)) seen.push({ key: row.group, label: row.groupLabel })
    }
    return seen
  }, [rows])
  const visible = rows.filter((row) => {
    if (asset !== 'all' && row.asset !== asset) return false
    if (group !== 'all' && row.group !== group) return false
    const needle = query.trim().toLowerCase()
    if (needle && !row.search.toLowerCase().includes(needle)) return false
    return true
  })
  const count =
    visible.length === rows.length
      ? t.catalogCount.replace('{n}', String(rows.length))
      : t.catalogShown.replace('{shown}', String(visible.length)).replace('{total}', String(rows.length))

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t.catalogTitle}</h1>
        <p className="font-mono text-xs text-ink-subtle" data-catalog-count="">
          {count}
        </p>
      </div>

      <div className="mt-5 flex flex-col gap-3 bg-surface px-3 py-3">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t.searchPlaceholder}
          aria-label={t.searchPlaceholder}
          className="w-full border border-rule bg-surface px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-subtle"
        />
        <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm" role="group" aria-label="资产">
          <FilterButton pressed={asset === 'all'} onClick={() => setAsset('all')}>
            {t.filterAll}
          </FilterButton>
          {ASSETS.map((item) => (
            <FilterButton key={item} pressed={asset === item} onClick={() => setAsset(item)}>
              {item === 'btc' ? 'BTC' : 'MSTR'}
            </FilterButton>
          ))}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm" role="group" aria-label="分类">
          <FilterButton pressed={group === 'all'} onClick={() => setGroup('all')}>
            {t.filterAll}
          </FilterButton>
          {groups.map((item) => (
            <FilterButton key={item.key} pressed={group === item.key} onClick={() => setGroup(item.key)}>
              {item.label}
            </FilterButton>
          ))}
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="mt-8 text-sm text-ink-muted">{t.noSearchHits}</p>
      ) : (
        <div className="mt-6 overflow-hidden border border-rule bg-surface">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-rule-strong">
                <th scope="col" className="hidden border-r border-rule px-2 py-2 text-center align-middle font-medium text-ink-subtle lg:table-cell">
                  {t.colCategory}
                </th>
                <th scope="col" className="border-r border-rule px-2 py-2 text-center align-middle font-medium text-ink-subtle">
                  {t.colMetric}
                </th>
                <th scope="col" className="border-r border-rule px-2 py-2 text-center align-middle font-medium text-ink-subtle">
                  {t.colValue}
                </th>
                <th scope="col" className="px-2 py-2 text-center align-middle font-medium text-ink-subtle xl:border-r xl:border-rule">
                  {t.colStatus}
                </th>
                <th scope="col" className="hidden px-2 py-2 text-center align-middle font-medium text-ink-subtle xl:table-cell">
                  {t.colBasis}
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row, index) => {
                const showGroup = index === 0 || visible[index - 1]?.group !== row.group
                return (
                  <tr key={row.id} className="border-b border-rule last:border-b-0" data-catalog-row={row.asset}>
                    <th scope="row" className="hidden border-r border-rule py-1.5 pr-3 text-center align-middle font-mono text-xs font-medium text-ink-muted lg:table-cell">
                      {showGroup ? row.groupLabel : ''}
                    </th>
                    <td className="border-r border-rule py-1.5 pr-3 align-baseline">
                      <Link href={`/metrics/${row.id}`} className="text-ink hover:underline">
                        {row.name}
                      </Link>
                      {row.time ? (
                        <span className="mt-0.5 block font-mono text-[10px] text-ink-subtle sm:hidden">{row.time}</span>
                      ) : null}
                    </td>
                    <td className="border-r border-rule py-1.5 pr-3 text-right align-baseline font-mono text-sm tabular-nums wrap-anywhere sm:wrap-normal">
                      {row.missing ? <span className="text-ink-subtle">{t.dataNoValue}</span> : row.value}
                      {row.stale ? <span className="ml-1.5 text-[10px] text-ink-subtle">{t.statusPending}</span> : null}
                    </td>
                    <td className="py-1.5 pr-3 align-baseline xl:border-r xl:border-rule">
                      <StatusPill status={row.status} locale={locale} />
                    </td>
                    <td className="hidden py-1.5 align-baseline font-mono text-xs text-ink-subtle xl:table-cell">
                      {row.basis}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function FilterButton({
  pressed,
  onClick,
  children,
}: {
  readonly pressed: boolean
  readonly onClick: () => void
  readonly children: string
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={pressed ? 'border-b border-ink font-medium text-ink' : 'text-ink-subtle hover:text-ink'}
    >
      {children}
    </button>
  )
}
