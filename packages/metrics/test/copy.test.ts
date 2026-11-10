/**
 * 文案红线的测试。
 *
 * 两条线都来自"这句话到底说了什么"：
 *
 * - **矿池集中度是出块份额，不是算力份额。**把它说成"算力控制份额"，
 *   等于宣称一个链上查不到的事实（出块份额 ≠ 算力份额，矿池在线率不同就分叉）。
 * - **冷热是描述，不是估值判断。**"偏冷 = 适合定投"没有任何推导关系：
 *   描述性指标低，并不意味着估值便宜。这句话在原型里出现过，必须保证它不再回来。
 *
 * 文字守卫很容易被"改个说法绕过"，所以这里扫的是**全部**指标文案与全部场景句子，
 * 而不是只查某一句。
 */

import { describe, expect, it } from 'vitest'

import { registry, SCENARIOS, type Localized } from '../src/index.js'

/** 把一个 Localized 摊平成一段可扫的文本 */
function flat(value: Localized): string {
  return `${value.en}\n${value.zh}`
}

/** 指标定义里所有面向读者的文字 */
function metricCopy(id: string): string {
  const def = registry.get(id)
  const history = def.history.note ? flat(def.history.note) : ''
  return [
    flat(def.name),
    flat(def.description),
    flat(def.methodology),
    history,
  ].join('\n')
}

describe('矿池集中度不得被说成"算力控制份额"', () => {
  /** 无论什么上下文都不允许出现的说法 */
  const hardBanned = [/算力控制/, /hashrate control/i, /control of hashrate/i, /hashrate share/i]

  it('指标定义本身不这么写', () => {
    const copy = metricCopy('pool-concentration')
    for (const re of hardBanned) {
      expect(copy, `pool-concentration 的文案出现了 ${re}`).not.toMatch(re)
    }
  })

  it('提到"算力份额"时必须是在否定它', () => {
    // 定义里确实要提到"算力份额"——为了说明它**不是**这个口径。
    // 但每一次提到都必须带否定词；不带否定就是在宣称矿池控制了多少算力。
    const copy = metricCopy('pool-concentration')
    const hits = occurrences(copy, '算力份额')
    expect(hits.length).toBeGreaterThan(0)
    for (const hit of hits) {
      expect(hit.before, '"算力份额"没有否定词').toMatch(/而非|不是|而不是/)
    }
    const enHits = occurrences(copy, 'share of hashrate')
    for (const hit of enHits) {
      expect(hit.before, '"share of hashrate" 没有否定词').toMatch(/not\s/i)
    }
  })

  it('指标定义明确说明这是出块份额', () => {
    const copy = metricCopy('pool-concentration')
    expect(copy).toMatch(/出块份额/)
    expect(copy).toMatch(/share of blocks/)
  })

  it('场景句子提到矿池集中度时，讲的也是出块而不是算力', () => {
    for (const scenario of SCENARIOS) {
      const text = flat(scenario.sentence)
      if (!text.includes('矿池') && !/pool/i.test(text)) continue
      for (const re of hardBanned) {
        expect(text, `${scenario.id} 的句子出现了 ${re}`).not.toMatch(re)
      }
      for (const hit of occurrences(text, '算力份额')) {
        expect(hit.before, `${scenario.id} 的"算力份额"没有否定词`).toMatch(/而非|不是|而不是/)
      }
    }
  })
})

/** 找出 needle 的每一次出现，连同它前面的一小段上下文 */
function occurrences(text: string, needle: string): { index: number; before: string }[] {
  const out: { index: number; before: string }[] = []
  let i = text.indexOf(needle)
  while (i >= 0) {
    out.push({ index: i, before: text.slice(Math.max(0, i - 16), i) })
    i = text.indexOf(needle, i + 1)
  }
  return out
}

describe('不得出现没有估值依据的"适合定投"类判断', () => {
  const banned = [
    /适合定投/,
    /该定投/,
    /可以定投/,
    /适合买入/,
    /该买入/,
    /可以买入/,
    /good time to buy/i,
    /time to buy/i,
    /good for (?:dca|dollar cost)/i,
    /should (?:buy|dca)/i,
    /偏冷/,
    /偏热/,
  ]

  it('全部指标文案都不含这类判断', () => {
    for (const def of registry.all()) {
      const copy = metricCopy(def.id)
      for (const re of banned) {
        expect(copy, `${def.id} 的文案出现了 ${re}`).not.toMatch(re)
      }
    }
  })

  it('全部场景句子都不含这类判断', () => {
    for (const scenario of SCENARIOS) {
      const text = flat(scenario.sentence)
      for (const re of banned) {
        expect(text, `${scenario.id} 的句子出现了 ${re}`).not.toMatch(re)
      }
    }
  })

  it('场景句子里不出现"偏冷 / 偏热"这类评级词', () => {
    // 场景的句子只陈述事实。评级词（冷、热、暖、凉）会把描述重新变回打分，
    // 而打分背后没有可核对的推导。
    for (const scenario of SCENARIOS) {
      const text = flat(scenario.sentence)
      expect(text, `${scenario.id} 出现了评级词`).not.toMatch(/冷|热|暖|凉|bullish|bearish/i)
    }
  })
})

describe('文案里不得混入 Markdown 标记', () => {
  // 指标文案是**纯文本**：详情页把它直接放进 <p>，
  // 任何 Markdown 语法都会以字面量出现在读者眼前（曾经真的印出过 "确实达到过"）。
  // 与其为文案加一个 Markdown 子集渲染器（顺手就是一处 XSS 面），
  // 不如要求文案本身干净：需要强调就靠句子结构和邻近的数字块。
  const markdown = [/\*\*/, /^#{1,6}\s/m, /`/, /\[[^\]]+\]\([^)]+\)/]

  it('全部指标文案都不含 Markdown 语法', () => {
    for (const def of registry.all()) {
      const copy = metricCopy(def.id)
      for (const re of markdown) {
        expect(copy, `${def.id} 的文案出现了 ${re}`).not.toMatch(re)
      }
    }
  })

  it('全部场景句子都不含 Markdown 语法', () => {
    for (const scenario of SCENARIOS) {
      const text = flat(scenario.sentence)
      for (const re of markdown) {
        expect(text, `${scenario.id} 的句子出现了 ${re}`).not.toMatch(re)
      }
    }
  })
})
