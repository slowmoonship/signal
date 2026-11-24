/**
 * 分享海报是传播材料，不是内部分析表。
 *
 * 这里不启动浏览器：断言的是卡片数据，以及绘制时真正写上去的字。
 * 百分位缩写、对数轴上的 0、缺了署名、把参考图上的旧数字写死，都应该在这里失败。
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { latestKnown, type FeatureTable } from '@slowmoonship/metrics'

import { loadAll } from '../src/data/load.js'
import { siteRead } from '../src/data/read.js'
import { SHARE_BRAND, SHARE_BRAND_LINE } from '../src/share/brand.js'
import {
  backgroundAttempts,
  coverCrop,
  pickBackground,
  shareAssetUrl,
  validateCatalog,
  type ShareBackdrop,
} from '../src/share/backgrounds.js'
import { wrap } from '../src/share/canvas.js'
import { drawShareCard, type SharePainter } from '../src/share/draw.js'
import { deliverShareFile } from '../src/share/deliver.js'
import { buildHomeShareCard, buildMetricShareCard, splitShareRuns } from '../src/share/model.js'
import { posterUsd } from '../src/share/poster.js'
import { compositeOverWhite, contrastRatio, POSTER_FAINT, POSTER_INK, POSTER_PANEL, scrimAlpha } from '../src/share/theme.js'
import { SHARE_HEIGHT, SHARE_WIDTH, type ShareCard } from '../src/share/types.js'

const PERCENTILE = /P\d+/
const ADVICE = /适合定投|该买|可以入场|抄底|解套|逃顶/
const REFERENCE_NUMBERS = ['60,122.61', '850,849', '75,452', '51.8%']

function recordingPainter(): SharePainter & { texts: string[]; fills: string[]; rects: { w: number; h: number }[] } {
  const texts: string[] = []
  const fills: string[] = []
  const rects: { w: number; h: number }[] = []
  const painter: SharePainter & { texts: string[]; fills: string[]; rects: { w: number; h: number }[] } = {
    texts,
    fills,
    rects,
    setFill(color) {
      fills.push(color)
    },
    setStroke() {},
    setLineWidth() {},
    setFont() {},
    setTextAlign() {},
    setTextBaseline() {},
    setLineDash() {},
    setAlpha() {},
    fillRect(_x, _y, w, h) {
      rects.push({ w, h })
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
    roundRect() {},
    clip() {},
    arc() {},
    drawImage() {},
  }
  return painter
}

function paint(card: ShareCard, background: ShareBackdrop | null = null) {
  const painter = recordingPainter()
  drawShareCard(painter, card, {
    fontFamily: 'sans-serif',
    generatedAt: '2026-11-24T13:04:00Z',
    background,
  })
  return painter
}

describe('首页海报数据', () => {
  const home = buildHomeShareCard(loadAll(), siteRead().features)

  it('四块面板、顶部核心数字不在面板里重复，定投只是一行辅助', () => {
    expect(['牛市', '熊市', '震荡', '数据故障']).toContain(home.regimeLabel)
    expect(home.sentence.length).toBeGreaterThan(0)
    expect(home.sentence).not.toMatch(PERCENTILE)
    expect(home.sentence).not.toMatch(ADVICE)
    expect(home.price.name).toBe('BTC 价格')
    expect(home.price.value.startsWith('$')).toBe(true)
    expect(home.price.value).not.toContain('US$')
    expect(home.drawdown.name).toBe('距历史高点')
    expect(home.change90.name).toBe('90日变化')
    expect(home.panels.map((panel) => panel.id)).toEqual(['market', 'valuation', 'cycle', 'strategy'])
    expect(home.panels.map((panel) => panel.title)).toEqual(['市场行情', '估值水平', '周期信号', 'Strategy (MSTR)'])
    expect(home.panels[0]?.items.map((item) => item.id)).toEqual(['price-change-7d', 'price.30d', 'active-addresses'])
    expect(home.panels[1]?.items.map((item) => item.id)).toEqual([
      'ahr999',
      'rainbow-zone',
      'mvrv-zscore',
      'btc-realized-price',
    ])
    expect(home.panels[2]?.items.map((item) => item.id)).toEqual(['pi-cycle-top', 'sma-200w', 'puell-multiple', 'ma-2y'])
    expect(home.panels[3]?.items.map((item) => item.id)).toEqual([
      'strategy-btc-holdings',
      'strategy-btc-cost',
      'strategy-btc-per-share',
      'strategy-holding-change',
    ])
    const panelIds = home.panels.flatMap((panel) => panel.items.map((item) => item.id))
    expect(panelIds).not.toContain('drawdown-ath')
    expect(panelIds).not.toContain('price.90d')
    expect(panelIds).not.toContain('price')
    expect(home.dca).toContain('仅已达标样本')
    expect(home.dca).toContain('+5%')
    expect(home.dca).not.toMatch(ADVICE)
    expect(home.panels.some((panel) => panel.title.includes('定投'))).toBe(false)
  })

  it('金额、时间和来源来自这份快照，不是参考图上的旧数字', () => {
    const price = loadAll().get('price')
    expect(price?.ok).toBe(true)
    if (!price?.ok) return
    const latest = latestKnown(price.value.points)
    expect(latest?.value).toBeTypeOf('number')
    if (!latest || latest.value === null) return
    expect(home.price.value).toBe(posterUsd(latest.value, 2))
    expect(home.priceAsOf).toContain('BTC 数据截止')
    expect(home.priceAsOf).toContain('UTC')
    expect(home.strategyAsOf).toMatch(/^20\d{2}-\d{2}-\d{2}$/)
    expect(home.sources).toEqual(expect.arrayContaining(['Coin Metrics', 'Strategy 官方披露', 'Signal 自有计算']))
    const dumped = JSON.stringify(home)
    expect(dumped).not.toMatch(PERCENTILE)
    expect(dumped).not.toMatch(ADVICE)
    expect(dumped).not.toContain('US$')
    for (const item of home.panels.flatMap((panel) => panel.items)) {
      expect(item.value).not.toBe('0')
      expect(item.note.length).toBeGreaterThan(0)
    }
    const activity = home.panels[0]?.items[2]
    expect(activity?.note).toContain('不是用户数')
    const perShare = home.panels[3]?.items[2]
    expect(perShare?.note).toContain('假定稀释')
  })

  it('数据全缺时不填零，也不把故障说成震荡', () => {
    const empty = buildHomeShareCard(new Map(), {} as FeatureTable)
    expect(empty.regime).toBe('fault')
    expect(empty.regimeLabel).toBe('数据故障')
    expect(empty.sentence).toContain('无法判定')
    expect(empty.sentence).not.toContain('横盘')
    expect(empty.price.value).toBe('—')
    expect(empty.panels).toHaveLength(4)
    expect(empty.dca).toContain('—')
    expect(JSON.stringify(empty)).not.toContain('"$0')
    expect(empty.panels[3]?.items[3]?.value).toBe('暂无新披露')
  })
})

describe('详情海报数据', () => {
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
      expect(card.sources.length).toBeGreaterThan(0)
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

  it('价格单线图不把纵轴画到负数，同一段曲线不跨过日频缺口', () => {
    const price = buildMetricShareCard('price')
    expect(price?.chart?.yScale).toBe('linear')
    expect(price?.chart?.yTicks.every((tick) => !tick.label.startsWith('-'))).toBe(true)
    expect(price?.chart?.xTicks.some((tick) => /^20\d{2}$/.test(tick.label))).toBe(true)
    const day = 86_400
    const runs = splitShareRuns(
      [
        { ts: 0, value: 1 },
        { ts: day, value: 2 },
        { ts: day * 10, value: 3 },
        { ts: day * 11, value: 4 },
      ],
      1.5 * day,
    )
    expect(runs).toHaveLength(2)
    expect(runs[0]?.map((point) => point.ts)).toEqual([0, day])
    expect(runs[1]?.map((point) => point.ts)).toEqual([day * 10, day * 11])
  })

  it('Strategy 持仓均价带来源，不把股价当成必选项', () => {
    const card = buildMetricShareCard('strategy-btc-cost')
    expect(card?.sources).toContain('Strategy 官方披露')
    expect(card?.name).toContain('均价')
    expect(card?.value.startsWith('$')).toBe(true)
    expect(card?.value).not.toContain('US$')
    expect(buildMetricShareCard('price')?.value).not.toContain('US$')
  })

  it('换行不把一串数字拆开', () => {
    const painter = recordingPainter()
    const lines = wrap(painter, '统计地址活动，不是用户数。约 702,867 个活跃地址。30日上升 10.8%', 16 * 16, 3)
    expect(lines.some((line) => line.includes('702,867'))).toBe(true)
    expect(lines.some((line) => line.includes('10.8%'))).toBe(true)
    for (let index = 1; index < lines.length; index += 1) {
      const prev = lines[index - 1]?.replace(/…$/u, '') ?? ''
      const next = lines[index] ?? ''
      const tail = prev.slice(-1)
      const head = next.slice(0, 1)
      const piece = /[0-9.,%]/
      expect(piece.test(tail) && piece.test(head)).toBe(false)
    }
  })
})

describe('海报绘制', () => {
  const home = buildHomeShareCard(loadAll(), siteRead().features)

  it('输出 1920×1080，署名在底部，四个面板都画出来', () => {
    expect(SHARE_WIDTH).toBe(1920)
    expect(SHARE_HEIGHT).toBe(1080)
    for (const card of [
      home,
      buildMetricShareCard('ahr999'),
      buildMetricShareCard('rainbow-zone'),
      buildMetricShareCard('strategy-btc-cost'),
    ]) {
      expect(card).not.toBeNull()
      if (!card) continue
      const painted = paint(card)
      expect(painted.rects.some((rect) => rect.w === SHARE_WIDTH && rect.h === SHARE_HEIGHT)).toBe(true)
      const joined = painted.texts.join('\n')
      expect(joined).toContain('Signal')
      expect(joined).toContain(SHARE_BRAND.name)
      expect(joined).toContain(SHARE_BRAND.x)
      expect(joined).toContain(SHARE_BRAND.github)
      expect(joined).toContain(SHARE_BRAND.website)
      expect(painted.texts.filter((text) => text === SHARE_BRAND_LINE).length).toBe(1)
      expect(joined).toContain('图片生成 2026-11-24 13:04 UTC')
      expect(joined).not.toMatch(PERCENTILE)
      expect(joined).not.toMatch(ADVICE)
      expect(painted.fills.some((color) => /ffd700|d4af37|c9a227/i.test(color))).toBe(false)
    }
    const homeText = paint(home).texts.join('\n')
    for (const title of ['市场行情', '估值水平', '周期信号', 'Strategy (MSTR)']) {
      expect(homeText).toContain(title)
    }
    expect(homeText).toContain(home.dca)
  })

  it('换背景不改数据和版式文字，只改图片署名', () => {
    const landscape = paint(home, backdrop('landscape', 'Bonnie Moreland / CC0'))
    const night = paint(home, backdrop('night', 'RFNirmala / CC0'))
    const strip = (texts: string[]): string[] => texts.filter((text) => !text.includes('/ CC0'))
    expect(strip(landscape.texts)).toEqual(strip(night.texts))
    expect(landscape.texts.join('\n')).toContain('Bonnie Moreland / CC0')
    expect(night.texts.join('\n')).toContain('RFNirmala / CC0')
  })

  it('极长数字整段画上去', () => {
    const value = '123456789012345678901234567890.12'
    const stretched = { ...home, price: { ...home.price, value } }
    expect(paint(stretched).texts).toContain(value)
  })

  it('模板源码没有写死参考图上的历史读数', () => {
    const poster = readFileSync(fileURLToPath(new URL('../src/share/poster.ts', import.meta.url)), 'utf8')
    const draw = readFileSync(fileURLToPath(new URL('../src/share/draw-home.ts', import.meta.url)), 'utf8')
    for (const sample of REFERENCE_NUMBERS) {
      expect(poster).not.toContain(sample)
      expect(draw).not.toContain(sample)
    }
  })
})

describe('对比度', () => {
  it('面板上的正文在纯白底这个最坏情况下仍过 4.5:1', () => {
    const panel = compositeOverWhite(POSTER_PANEL)
    expect(contrastRatio(POSTER_INK, panel)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(POSTER_FAINT, panel)).toBeGreaterThanOrEqual(4.5)
  })

  it('最亮的照片上，大标题相对遮罩至少 3:1，采样失败时用固定遮罩', () => {
    expect(scrimAlpha(null)).toBe(0.5)
    const alpha = scrimAlpha(1)
    const scrim = compositeOverWhite(`rgba(7, 9, 13, ${alpha})`)
    expect(contrastRatio(POSTER_INK, scrim)).toBeGreaterThanOrEqual(3)
  })
})

describe('背景素材', () => {
  const file = fileURLToPath(new URL('../public/share/backgrounds.json', import.meta.url))
  const catalog = validateCatalog(JSON.parse(readFileSync(file, 'utf8')))

  it('清单合法，许可和作者都在，默认背景只有一张', () => {
    expect(catalog.errors).toEqual([])
    expect(catalog.records.length).toBeGreaterThanOrEqual(4)
    expect(catalog.records.filter((record) => record.fallback)).toHaveLength(1)
    for (const record of catalog.records) {
      expect(record.license).toBe('CC0')
      expect(record.author.length).toBeGreaterThan(0)
      expect(record.sourceUrl.startsWith('https://')).toBe(true)
      expect(record.licenseUrl).toContain('publicdomain/zero')
      expect(readFileSync(fileURLToPath(new URL(`../public${record.file}`, import.meta.url)))).toBeTruthy()
    }
    expect(catalog.records.map((record) => record.id)).toEqual(
      expect.arrayContaining(['landscape', 'night', 'warm', 'architecture']),
    )
  })

  it('随机选择躲开上一张，测试可以指定 id，路径带站点前缀', () => {
    const records = catalog.records
    const first = pickBackground(records, () => 0)
    expect(first).not.toBeNull()
    if (!first) return
    const next = pickBackground(records, () => 0, { previousId: first.id })
    expect(next?.id).not.toBe(first.id)
    expect(pickBackground(records, () => 0.99, { preferId: 'warm' })?.id).toBe('warm')
    expect(shareAssetUrl(first.file)).toBe(`/signal${first.file}`)
    const attempts = backgroundAttempts(records, () => 0, 'missing-id', null)
    expect(attempts[0]?.id).not.toBe('missing-id')
    expect(attempts.some((record) => record.fallback)).toBe(true)
  })

  it('坏清单被丢掉，不拿空作者充数', () => {
    const broken = validateCatalog([
      { id: 'nope', file: '/share/backgrounds/nope.webp', license: 'unknown', author: '' },
    ])
    expect(broken.records).toEqual([])
    expect(broken.errors.length).toBeGreaterThan(0)
    expect(pickBackground([], () => 0)).toBeNull()
  })

  it('cover 裁切保持比例', () => {
    const wide = coverCrop(4000, 1000, 1920, 1080)
    expect(wide).not.toBeNull()
    if (!wide) return
    expect(wide.sy).toBeCloseTo(0, 6)
    expect(wide.sx).toBeGreaterThan(0)
    expect(wide.sw / wide.sh).toBeCloseTo(1920 / 1080, 5)
    const tall = coverCrop(1000, 4000, 1920, 1080)
    expect(tall?.sx).toBe(0)
    expect(tall && tall.sy).toBeGreaterThan(0)
  })
})

describe('分享投递', () => {
  const file = new File([new Uint8Array([1, 2, 3])], 'signal-home.png', { type: 'image/png' })

  it('不能分享文件时下载，用户取消时不下载，拒绝时下载', async () => {
    await expect(deliverShareFile(file, 'Signal', {})).resolves.toBe('fallback')
    await expect(
      deliverShareFile(file, 'Signal', { share: async () => undefined, canShare: () => false }),
    ).resolves.toBe('fallback')
    await expect(deliverShareFile(file, 'Signal', { share: async () => undefined, canShare: () => true })).resolves.toBe(
      'shared',
    )
    await expect(
      deliverShareFile(file, 'Signal', {
        canShare: () => true,
        share: async () => {
          throw new DOMException('cancel', 'AbortError')
        },
      }),
    ).resolves.toBe('aborted')
    await expect(
      deliverShareFile(file, 'Signal', {
        canShare: () => true,
        share: async () => {
          throw new DOMException('lost', 'NotAllowedError')
        },
      }),
    ).resolves.toBe('fallback')
  })
})

describe('分享按钮只有一个', () => {
  it('组件里没有第二颗按钮，也不截整页', () => {
    const src = readFileSync(fileURLToPath(new URL('../src/share/ShareButton.tsx', import.meta.url)), 'utf8')
    const deliver = readFileSync(fileURLToPath(new URL('../src/share/deliver.ts', import.meta.url)), 'utf8')
    const dictionary = readFileSync(fileURLToPath(new URL('../src/i18n/dictionaries.ts', import.meta.url)), 'utf8')
    expect(src.match(/<button/g)).toHaveLength(1)
    expect(src).not.toContain('html2canvas')
    expect(src).not.toContain('分享到')
    expect(src).toContain('deliverShareFile')
    expect(src).toContain('useRef')
    expect(deliver).toContain('canShare')
    expect(deliver).toContain('AbortError')
    expect(dictionary).toContain('生成中')
  })
})

function backdrop(id: string, credit: string): ShareBackdrop {
  return { id, credit, image: { width: 200, height: 100, source: {}, luminance: 0.4 } }
}
