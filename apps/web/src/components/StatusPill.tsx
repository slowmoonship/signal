/**
 * 状态胶囊。
 *
 * 全站唯一允许染色的数据含义（CLAUDE.md §视觉红线 §状态色）。
 * 组件只认 `StatusTone`，不知道背后是哪个明度的红或蓝——
 * 那些色值锁在 `globals.css` 的 `--status-*` 里（CLAUDE.md §分类底色 的同款约束）。
 *
 * **不要把它做成"涨跌色"。** 这里表达的是"这个数相对它自己近一年处在什么位置"，
 * 与涨跌无关，与好坏也无关——净流入会被标成 hot，
 * 而"净流入 = 该卖"从来不是本站的结论。
 */

import { statusWord, type MetricStatus, type SiteLocale, type StatusTone } from '@slowmoonship/metrics'

/** 色档 → 语义工具类。底色与文字成对，不能只给其中一个。 */
const TONE_CLASS: Readonly<Record<StatusTone, string>> = {
  hot: 'bg-status-hot text-status-hot-ink',
  flat: 'bg-status-flat text-status-flat-ink',
  cold: 'bg-status-cold text-status-cold-ink',
  void: 'bg-status-void text-status-void-ink',
}

export function StatusPill({
  status,
  locale,
}: {
  readonly status: MetricStatus
  readonly locale: SiteLocale
}) {
  // 词一律从 statusWord() 取，不在本组件另写一份：
  // 同一个状态在首页句子和这个胶囊上显示成两个词，读者会以为是两件事。
  const word = statusWord(status, locale)
  const tone: StatusTone = status.ok ? status.tone : 'void'

  return (
    <span
      // 判不出来时把原因挂在 title 上：胶囊本身只有三个字，
      // 读者 hover 一下就能知道是"缺数据"还是"历史不足"还是"已过期"。
      title={status.ok ? undefined : status.detail}
      className={`inline-block rounded-md px-1.5 py-0.5 font-mono text-xs whitespace-nowrap ${TONE_CLASS[tone]}`}
    >
      {word}
    </span>
  )
}