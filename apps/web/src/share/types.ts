/**
 * 分享卡的数据。只有字符串和数字，好让服务端组件把它交给按钮。
 *
 * 绘制在浏览器里发生。这里不放函数，也不放「近一年 P44」这种表格内部写法。
 */

export const SHARE_WIDTH = 1200
export const SHARE_HEIGHT = 630

export type SharePaint =
  | 'ink'
  | 'muted'
  | 'faint'
  | 'rainbow-1'
  | 'rainbow-2'
  | 'rainbow-3'
  | 'rainbow-4'
  | 'rainbow-5'
  | 'rainbow-6'
  | 'rainbow-7'
  | 'rainbow-8'
  | 'rainbow-9'

export type SharePoint = Readonly<{ ts: number; value: number }>

export type ShareLine = Readonly<{
  runs: readonly (readonly SharePoint[])[]
  paint: SharePaint
  width: number
  dash: boolean
}>

export type ShareBand = Readonly<{
  lower: readonly SharePoint[]
  upper: readonly SharePoint[]
  paint: SharePaint
}>

/** 已经抽稀过的曲线。刻度文字在服务端算好，绘制层不再解释指标。 */
export type ShareChart = Readonly<{
  yScale: 'linear' | 'log'
  yMin: number
  yMax: number
  xMin: number
  xMax: number
  xTicks: readonly { ts: number; label: string }[]
  yTicks: readonly { value: number; label: string }[]
  lines: readonly ShareLine[]
  bands: readonly ShareBand[]
  rules: readonly { value: number; label: string }[]
  markers: readonly SharePoint[]
  legend: readonly { label: string; paint: SharePaint }[]
}>

export type ShareStat = Readonly<{ label: string; value: string }>

export type HomeShareCard = Readonly<{
  kind: 'home'
  filename: string
  shareText: string
  title: string
  subtitle: string
  regime: 'bull' | 'bear' | 'range' | 'fault'
  regimeLabel: string
  sentence: string
  price: ShareStat
  stats: readonly ShareStat[]
  asOf: string
}>

export type MetricShareCard = Readonly<{
  kind: 'metric'
  filename: string
  shareText: string
  title: string
  category: string
  name: string
  value: string
  status: string
  statusLabel: string
  basis: string
  rangeLabel: string
  chart: ShareChart | null
  emptyChart: string
}>

export type ShareCard = HomeShareCard | MetricShareCard

export type ShareTheme = 'light' | 'dark'
