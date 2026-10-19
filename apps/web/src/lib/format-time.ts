/**
 * 时间显示。
 *
 * 全站一律 UTC（CLAUDE.md 红线 3）：存储是 UTC 纪元秒 / ISO-8601 Z，
 * 显示也必须是 UTC——用本地时区展示会让"今天"这个概念在读者那边漂移，
 * 而日频指标的比较全部以 UTC 日为界。
 *
 * 日期一律显式拼 `YYYY-MM-DD`，不交给 `Intl.DateTimeFormat`：
 * 同一个 UTC 时刻在不同 locale 下会渲染成 `10/19/2026` / `2026/10/19` /
 * `19/10/2026` 三种样子，读者无法一眼确认两处时间是不是同一天，
 * 对一个以"每天一个快照"为准的数据站来说这是硬伤。
 */

import type { Locale } from '@slowmoonship/metrics'

const pad = (n: number): string => (n < 10 ? `0${n}` : String(n))

/** 无时区后缀的字符串按 UTC 处理；带偏移的按偏移换算到 UTC */
function parseUtc(iso: string): number | null {
  const normalized = /[Zz]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`
  const ms = Date.parse(normalized)
  return Number.isNaN(ms) ? null : ms
}

/** 毫秒 → `YYYY-MM-DD`（UTC）。解析失败时原样返回，不猜。 */
function isoDay(ms: number): string {
  const d = new Date(ms)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

export function formatUtcDate(iso: string): string {
  const ms = parseUtc(iso)
  return ms === null ? iso : isoDay(ms)
}

/** `YYYY-MM-DD HH:mm`（UTC）。页面上的时间戳一律带分钟，秒级对日频数据是噪声。 */
export function formatUtcDateTime(iso: string): string {
  const ms = parseUtc(iso)
  if (ms === null) return iso
  const d = new Date(ms)
  return `${isoDay(ms)} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
}

/**
 * 纪元秒 → UTC 日期。
 *
 * 图表与列表的时间轴都用它。直接取 UTC 字段而不是换算时区：
 * 少了这一步，同一份快照在不同读者那里会显示成不同的日期。
 */
export function formatUtcDay(ts: number): string {
  return isoDay(ts * 1000)
}

/**
 * 距今多久。
 *
 * 页面是构建期静态生成的（ADR-004），因此这个"多久"是构建那一刻算出来的，
 * 不会自己走动——这与"不轮询、不实时"是一致的。
 *
 * 这是文件里唯一保留 locale 的函数：相对时间是纯语言问题，
 * "2 小时前"和"2 hours ago"没有可互换的机器格式。
 */
export function formatAge(iso: string, nowMs: number, locale: Locale): string {
  const ms = parseUtc(iso)
  if (ms === null) return ''
  const hours = Math.max(0, (nowMs - ms) / 3_600_000)
  const rtf = new Intl.RelativeTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-GB', {
    numeric: 'auto',
  })
  if (hours < 1) return rtf.format(-Math.round(hours * 60), 'minute')
  if (hours < 48) return rtf.format(-Math.round(hours), 'hour')
  return rtf.format(-Math.round(hours / 24), 'day')
}
