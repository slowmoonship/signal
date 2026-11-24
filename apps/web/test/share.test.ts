/**
 * 分享卡是传播材料，不是内部分析表。
 *
 * 这里不启动浏览器：断言的是卡片数据，以及绘制时真正写上去的字。
 * 百分位缩写、对数轴上的 0、缺了署名，都应该在这里失败。
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { loadAll } from '../src/data/load.js'
import { siteRead } from '../src/data/read.js'
import { SHARE_BRAND, SHARE_BRAND_LINE } from '../src/share/brand.js'
import { drawShareCard, type SharePainter } from '../src/share/draw.js'
import { buildHomeShareCard, buildMetricShareCard } from '../src/share/model.js'
import type { ShareCard } from '../src/share/types.js'

const PERCENTILE = /P\d+/
const ADVICE = /适合定投|该买|可以入场|抄底/

function recordingPainter(): SharePainter & { texts: string[]; fills: string[] } {
  const texts: string[] = []
  const fills: string[] = []
  let fill = ''
  const painter: SharePainter & { texts: string[]; fills: string[] } = {
    texts,
    fills,
    setFill(color) {
      fill = color
    },
    setStroke() {},
    setLineWidth() {},
    setFont() {},
    setTextAlign() {},
    setTextBaseline() {},
    setLineDash() {},
    fillRect() {
      fills.push(fill)
    },
    fillText(text) {
      texts.push(text)
    },
    measureText(text) {
      return { width: [...text].length * 16 }
    },
    beginPath() {},
    moveTo() {},
    lineTo() {},
    stroke() {},
    fill() {},
    save() {},
    restore() {},
    rect() {},
    clip() {},
    arc() {},
  }
  return painter
}

function paint(card: ShareCard, theme: 'light' | 'dark' = 'light'): string[] {
  const painter = recordingPainter()
  drawShareCard(painter, card, theme, 'sans-serif')
  return painter.texts
}

describe('分享卡数据', () => {
  const home = buildHomeShareCard(loadAll(), siteRead().features)

  it('首页卡带六个读数、市场状态和一句人话', () => {
    expect(['牛市', '熊市', '震荡', '数据故障']).toContain(home.regimeLabel)
    expect(home.sentence.length).toBeGreaterThan(0)
    expect(home.sentence).not.toMatch(PERCENTILE)
    expect(home.sentence).not.toMatch(ADVICE)
    expect(home.price.label).toBe('BTC 价格')
    expect(home.price.value).not.toBe('—')
    expect(home.price.value).not.toBe('0')
    expect(home.stats).toHaveLength(5)
    expect(home.stats.map((stat) => stat.label)).toEqual([
      '距历史高点',
      'AHR999',
      '链上平均成本',
      '定投赚5%最长等待',
      'Strategy BTC 持仓',
    ])
    expect(home.asOf).toContain('UTC')
    for (const stat of [home.price, ...home.stats]) {
      expect(stat.value).not.toMatch(PERCENTILE)
      expect(stat.label).not.toMatch(PERCENTILE)
    }
  })

  it('AHR999、彩虹图和链上平均成本的依据是人话，对数刻度不是 0', () => {
    for (const id of ['ahr999', 'rainbow-zone', 'btc-realized-price'] as const) {
      const card = buildMetricShareCard(id)
      expect(card).not.toBeNull()
      if (!card) continue
      expect(card.basis.length).toBeGreaterThan(0)
      expect(card.basis).not.toMatch(PERCENTILE)
      expect(card.status).not.toMatch(PERCENTILE)
      expect(card.rangeLabel).toContain('UTC')
      expect(card.rangeLabel).toMatch(/20\d{2}/)
      expect(card.chart).not.toBeNull()
      if (!card.chart) continue
      expect(card.chart.yScale).toBe('log')
      expect(card.chart.yMin).toBeGreaterThan(0)
      expect(card.chart.yTicks.length).toBeGreaterThanOrEqual(2)
      expect(card.chart.xTicks.some((tick) => /^20\d{2}$/.test(tick.label))).toBe(true)
      expect(card.chart.lines.some((line) => line.runs.some((run) => run.length > 20))).toBe(true)
      for (const tick of card.chart.yTicks) {
        expect(tick.label).not.toMatch(/^\$?0(?:\.0+)?$/)
        expect(tick.label.startsWith('-')).toBe(false)
      }
    }
  })

  it('彩虹图带分区，链上成本图的纵轴带美元刻度', () => {
    const rainbow = buildMetricShareCard('rainbow-zone')
    expect(rainbow?.chart?.bands.length).toBeGreaterThan(0)
    const realized = buildMetricShareCard('btc-realized-price')
    expect(realized?.chart?.yTicks.some((tick) => tick.label.startsWith('$'))).toBe(true)
  })

  it('价格单线图不把纵轴画到负数', () => {
    const price = buildMetricShareCard('price')
    expect(price?.chart?.yScale).toBe('linear')
    expect(price?.chart?.yTicks.every((tick) => !tick.label.startsWith('-'))).toBe(true)
    expect(price?.chart?.xTicks.some((tick) => /^20\d{2}$/.test(tick.label))).toBe(true)
  })
})

describe('分享图绘制', () => {
  const home = buildHomeShareCard(loadAll(), siteRead().features)

  it('署名集中在底部', () => {
    for (const card of [
      home,
      buildMetricShareCard('ahr999'),
      buildMetricShareCard('rainbow-zone'),
      buildMetricShareCard('btc-realized-price'),
    ]) {
      expect(card).not.toBeNull()
      if (!card) continue
      const texts = paint(card)
      const joined = texts.join('\n')
      expect(joined).toContain('Signal')
      expect(joined).toContain(SHARE_BRAND.name)
      expect(joined).toContain(SHARE_BRAND.x)
      expect(joined).toContain(SHARE_BRAND.github)
      expect(texts.filter((text) => text === SHARE_BRAND_LINE).length).toBe(1)
      expect(joined).not.toMatch(PERCENTILE)
      expect(joined).not.toMatch(ADVICE)
    }
  })

  it('深色卡片换底色，署名仍在', () => {
    const light = recordingPainter()
    const dark = recordingPainter()
    drawShareCard(light, home, 'light', 'sans-serif')
    drawShareCard(dark, home, 'dark', 'sans-serif')
    expect(light.fills[0]).not.toBe(dark.fills[0])
    expect(dark.texts.join('\n')).toContain(SHARE_BRAND_LINE)
  })
})

describe('分享按钮只有一个', () => {
  it('组件里没有第二颗按钮，也不截整页', () => {
    const src = readFileSync(fileURLToPath(new URL('../src/share/ShareButton.tsx', import.meta.url)), 'utf8')
    expect(src.match(/<button/g)).toHaveLength(1)
    expect(src).not.toContain('html2canvas')
    expect(src).not.toContain('分享到')
  })
})
