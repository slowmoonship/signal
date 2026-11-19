/**
 * 详情图横轴刻度。
 *
 * 刻度按真实 UTC 时间取，不按点的序号。稀疏披露和抽稀都不会把刻度拉成等距。
 * 调用方再按像素间距丢掉会叠在一起的中间刻度，起点和终点留下来。
 */

const DAY = 86_400

export type TimeTick = Readonly<{ ts: number; label: string }>

function parts(ts: number): { y: number; m: number; d: number } {
  const date = new Date(ts * 1000)
  return { y: date.getUTCFullYear(), m: date.getUTCMonth(), d: date.getUTCDate() }
}

function stamp(y: number, m: number, d: number): number {
  return Math.floor(Date.UTC(y, m, d) / 1000)
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

export function timeAxisTicks(firstTs: number, lastTs: number, maxTicks = 6): TimeTick[] {
  if (!(lastTs > firstTs) || maxTicks < 2) return []
  const days = (lastTs - firstTs) / DAY
  const start = parts(firstTs)
  const end = parts(lastTs)
  const ticks: TimeTick[] = []

  const push = (ts: number, label: string): void => {
    if (ticks.some((tick) => Math.abs(tick.ts - ts) < DAY * 20 && tick.label === label)) return
    if (ticks.some((tick) => Math.abs(tick.ts - ts) < DAY * 0.4)) return
    ticks.push({ ts, label })
  }

  if (days <= 140) {
    const stepDays = Math.max(days <= 45 ? 7 : 14, Math.round(days / (maxTicks - 1)))
    push(firstTs, `${pad(start.m + 1)}-${pad(start.d)}`)
    let cursor = firstTs + stepDays * DAY
    while (cursor < lastTs - stepDays * DAY * 0.6) {
      const at = parts(cursor)
      push(cursor, `${pad(at.m + 1)}-${pad(at.d)}`)
      cursor += stepDays * DAY
    }
    push(lastTs, `${pad(end.m + 1)}-${pad(end.d)}`)
  } else if (days <= 420) {
    push(firstTs, `${start.y}-${pad(start.m + 1)}`)
    let y = start.y
    let m = start.m + 2
    while (m > 11) {
      y += 1
      m -= 12
    }
    for (let i = 0; i < 16; i += 1) {
      const ts = stamp(y, m, 1)
      if (ts >= lastTs - 25 * DAY) break
      if (ts > firstTs + 25 * DAY) push(ts, `${y}-${pad(m + 1)}`)
      m += 2
      while (m > 11) {
        y += 1
        m -= 12
      }
    }
    push(lastTs, `${end.y}-${pad(end.m + 1)}`)
  } else {
    const spanYears = Math.max(1, end.y - start.y)
    const step = spanYears <= 5 ? 1 : spanYears <= 12 ? 2 : 4
    push(firstTs, String(start.y))
    for (let y = start.y + step; y < end.y; y += step) {
      const ts = stamp(y, 0, 1)
      if (ts > firstTs + 40 * DAY && ts < lastTs - 40 * DAY) push(ts, String(y))
    }
    push(lastTs, String(end.y))
  }

  ticks.sort((a, b) => a.ts - b.ts)
  if (ticks.length <= maxTicks) return ticks
  const kept: TimeTick[] = [ticks[0] as TimeTick]
  const last = ticks[ticks.length - 1] as TimeTick
  const room = maxTicks - 2
  const stride = Math.ceil((ticks.length - 2) / room)
  for (let i = stride; i < ticks.length - 1; i += stride) {
    const tick = ticks[i]
    if (tick) kept.push(tick)
  }
  kept.push(last)
  return kept
}
