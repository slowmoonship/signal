/**
 * 纽约证券交易所的交易日与收盘时刻。
 *
 * MSTR 只在美股交易时段有收盘价，BTC 全天都有成交。
 * 把两者放在一起做收益率时，BTC 必须取「该交易日美东收盘那一刻」的价格，
 * 不能取 UTC 午夜，也不能取 UTC 日均价——那两个时刻股票市场根本没在收盘。
 *
 * 日历用公历日期字符串运算，不读机器时区。
 * 跑在 UTC+8 上和跑在 UTC 上必须得到同一个收盘纪元秒。
 *
 * 年份只覆盖已经核对过的范围。范围外返回 null：
 * 没有编码的年份如果照常开市，节假日会被当成交易日，配对出来的 Beta 是错的。
 */

export const NYSE_CALENDAR_FROM = 2024
export const NYSE_CALENDAR_UNTIL = 2028

/** 临时休市。不在常规假日规则里，但交易所当天确实没开。 */
const EXTRA_CLOSURES = new Set(['2025-01-09'])

const MONTHS: Readonly<Record<string, number>> = {
  january: 1,
  jan: 1,
  february: 2,
  feb: 2,
  march: 3,
  mar: 3,
  april: 4,
  apr: 4,
  may: 5,
  june: 6,
  jun: 6,
  july: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sep: 9,
  october: 10,
  oct: 10,
  november: 11,
  nov: 11,
  december: 12,
  dec: 12,
}

export type IsoDate = Readonly<{ year: number; month: number; day: number }>

export function parseIsoDate(iso: string): IsoDate | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const check = formatIsoDate({ year, month, day })
  // 2 月 31 日这类日期，Date.UTC 会进位到下一个月。进位了就不是合法日期。
  return check === iso ? { year, month, day } : null
}

export function formatIsoDate(date: IsoDate): string {
  const month = String(date.month).padStart(2, '0')
  const day = String(date.day).padStart(2, '0')
  return `${date.year}-${month}-${day}`
}

export function addCalendarDays(iso: string, days: number): string | null {
  const date = parseIsoDate(iso)
  if (!date) return null
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + days))
  return shifted.toISOString().slice(0, 10)
}

/** 0 = 周日 … 6 = 周六。用 UTC 构造，避免本地时区把周一算成周日。 */
export function weekday(iso: string): number | null {
  const date = parseIsoDate(iso)
  if (!date) return null
  return new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay()
}

function nthWeekday(year: number, month: number, weekDay: number, n: number): string {
  const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay()
  const day = 1 + ((weekDay - first + 7) % 7) + (n - 1) * 7
  return formatIsoDate({ year, month, day })
}

function lastWeekday(year: number, month: number, weekDay: number): string {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const lastDow = new Date(Date.UTC(year, month - 1, last)).getUTCDay()
  const day = last - ((lastDow - weekDay + 7) % 7)
  return formatIsoDate({ year, month, day })
}

/** 匿名格里高利算法。用来得到耶稣受难日，而不是在表里手写一个可能抄错的日期。 */
export function easterSunday(year: number): string {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return formatIsoDate({ year, month, day })
}

/**
 * 周六提前到周五，周日顺延到周一。
 * 元旦是例外：1 月 1 日若是周六，交易所既不休 12 月 31 日也不休 1 月 2 日。
 */
function observed(iso: string, newYear = false): string {
  const dow = weekday(iso)
  if (dow === 6) {
    if (newYear) return iso
    return addCalendarDays(iso, -1) ?? iso
  }
  if (dow === 0) return addCalendarDays(iso, 1) ?? iso
  return iso
}

function inCalendar(year: number): boolean {
  return year >= NYSE_CALENDAR_FROM && year <= NYSE_CALENDAR_UNTIL
}

/** 当天是否全天休市。年份不在日历里时返回 true，调用方就不会把它当成交易日。 */
export function isNyseClosed(iso: string): boolean {
  const date = parseIsoDate(iso)
  if (!date || !inCalendar(date.year)) return true
  const dow = weekday(iso)
  if (dow === null || dow === 0 || dow === 6) return true
  if (EXTRA_CLOSURES.has(iso)) return true
  return closures(date.year).has(iso)
}

function closures(year: number): Set<string> {
  const goodFriday = addCalendarDays(easterSunday(year), -2)
  const dates = [
    observed(`${year}-01-01`, true),
    nthWeekday(year, 1, 1, 3),
    nthWeekday(year, 2, 1, 3),
    goodFriday,
    lastWeekday(year, 5, 1),
    observed(`${year}-06-19`),
    observed(`${year}-07-04`),
    nthWeekday(year, 9, 1, 1),
    nthWeekday(year, 11, 4, 4),
    observed(`${year}-12-25`),
  ]
  return new Set(dates.filter((d): d is string => d !== null && weekday(d) !== 0 && weekday(d) !== 6))
}

/** 提前收盘日的收盘是美东 13:00，不是 16:00。全天休市不是提前收盘。 */
export function isEarlyClose(iso: string): boolean {
  if (isNyseClosed(iso)) return false
  const date = parseIsoDate(iso)
  if (!date) return false
  const thanksgiving = nthWeekday(date.year, 11, 4, 4)
  const blackFriday = addCalendarDays(thanksgiving, 1)
  if (iso === blackFriday) return true
  const christmasEve = `${date.year}-12-24`
  if (iso === christmasEve) return true
  const july3 = `${date.year}-07-03`
  return iso === july3
}

/**
 * 夏令时：3 月第二个周日 02:00 起至 11 月第一个周日 02:00 前。
 * 收盘在下午，所以只看日期落在哪一侧，不用处理凌晨的回拨。
 */
export function isEasternDaylight(iso: string): boolean {
  const date = parseIsoDate(iso)
  if (!date) return false
  const start = nthWeekday(date.year, 3, 0, 2)
  const end = nthWeekday(date.year, 11, 0, 1)
  return iso >= start && iso < end
}

/**
 * 正常收盘美东 16:00，提前收盘美东 13:00，转成 UTC 纪元秒。
 * 休市、非法日期、日历范围外都返回 null。
 */
export function sessionCloseUtc(iso: string): number | null {
  if (isNyseClosed(iso)) return null
  const date = parseIsoDate(iso)
  if (!date) return null
  const offsetHours = isEasternDaylight(iso) ? 4 : 5
  const localHour = isEarlyClose(iso) ? 13 : 16
  return Math.floor(Date.UTC(date.year, date.month - 1, date.day, localHour + offsetHours) / 1000)
}

/** 上一个实际开市日。长周末和节假日会跳过，但不会跳过未知年份。 */
export function previousSession(iso: string): string | null {
  let cursor = addCalendarDays(iso, -1)
  for (let i = 0; i < 12 && cursor; i += 1) {
    if (sessionCloseUtc(cursor) !== null) return cursor
    cursor = addCalendarDays(cursor, -1)
  }
  return null
}

/** 两个交易日是否相邻：中间没有另一个开市日。 */
export function sessionsAreAdjacent(earlier: string, later: string): boolean {
  return previousSession(later) === earlier
}

const ENGLISH_DATE = /([A-Za-z]+)\.?\s+(\d{1,2}),\s*(\d{4})/

/** 「November 15, 2026」或「Nov. 13, 2026」。解析失败返回 null，不猜。 */
export function parseEnglishDate(text: string): string | null {
  const match = ENGLISH_DATE.exec(text)
  if (!match) return null
  const month = MONTHS[match[1]?.toLowerCase() ?? '']
  const day = Number(match[2])
  const year = Number(match[3])
  if (!month || !Number.isInteger(day) || !Number.isInteger(year)) return null
  return parseIsoDate(formatIsoDate({ year, month, day })) ? formatIsoDate({ year, month, day }) : null
}

export function utcDate(ts: number): string {
  return new Date(ts * 1000).toISOString().slice(0, 10)
}
