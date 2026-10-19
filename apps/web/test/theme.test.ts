/**
 * 视觉红线的可执行守卫（CLAUDE.md §视觉红线）。
 *
 * 这些约束原本只靠人肉 review：破防之后没有任何运行时报错，
 * 页面会静悄悄地变成"有点蓝的卡片墙"，而所有测试依然全绿。
 * 视觉是最容易漂移的一层，所以先把它钉在测试里。
 *
 * 这里读的是**源码文本**，不是渲染结果——本站是构建期静态生成，
 * 没有任何浏览器运行时可挂，源码就是唯一稳定的断言面。
 * 代价是它管不了「class 存在但用错位置」，只管「用词本身是否越界」。
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const WEB_SRC = fileURLToPath(new URL('../src/', import.meta.url))

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (/\.(tsx|css)$/.test(entry)) out.push(full)
  }
  return out
}

const files = walk(WEB_SRC)

/** 去掉注释，避免把「我们**不用** zinc」这句话也算成违规 */
function stripComments(src: string, ext: string): string {
  const stripped = src.replace(/\/\*[\s\S]*?\*\//g, '')
  // className 里的字符串不能删，只去行注释
  return ext === '.css' ? stripped : stripped.replace(/(^|[^:])\/\/.*$/gm, '$1')
}

describe('视觉红线守卫', () => {
  it('源码里有被扫描的样式文件', () => {
    expect(files.length).toBeGreaterThan(5)
  })

  it('组件只用语义 token，不散落 zinc-NNN 这类具体色阶', () => {
    const offenders: string[] = []
    for (const file of files) {
      if (!file.endsWith('.tsx')) continue
      const src = stripComments(readFileSync(file, 'utf8'), '.tsx')
      const hits = src.match(/zinc-\d+/g)
      if (hits) offenders.push(`${file.replace(WEB_SRC, '')}: ${[...new Set(hits)].join(', ')}`)
    }
    expect(offenders).toEqual([])
  })

  it('不用阴影、渐变与胶囊圆角', () => {
    const offenders: string[] = []
    const banned = [
      { re: /\bshadow(-|\b)/, why: '阴影' },
      { re: /\bbackdrop-blur/, why: '毛玻璃' },
      { re: /\bgradient|linear-gradient/, why: '渐变' },
      // rounded-full / rounded-3xl 这类大圆角；rounded-sm 级别的 2px 焦点环不算
      { re: /\brounded-(full|3xl|2xl|xl)\b/, why: '胶囊 / 大圆角' },
    ]
    for (const file of files) {
      const src = stripComments(readFileSync(file, 'utf8'), file.endsWith('.css') ? '.css' : '.tsx')
      for (const { re, why } of banned) {
        if (re.test(src)) offenders.push(`${file.replace(WEB_SRC, '')}: ${why}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('不用彩色：色值只允许出现在 globals.css 的 token 定义里', () => {
    const offenders: string[] = []
    // 只查 Tailwind 的调色板工具类（bg-red-500 / text-blue-600 …），
    // 不查语义 token（bg-surface / text-ink …），后者正是我们要的。
    const palette = /\b(?:bg|text|border|fill|stroke|ring|divide|from|to|via)-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/
    for (const file of files) {
      if (!file.endsWith('.tsx')) continue
      const src = stripComments(readFileSync(file, 'utf8'), '.tsx')
      const hits = src.match(new RegExp(palette.source, 'g'))
      if (hits) offenders.push(`${file.replace(WEB_SRC, '')}: ${[...new Set(hits)].join(', ')}`)
    }
    expect(offenders).toEqual([])
  })
})

/** 取 `@media (...) { ... }` 的**配平**内容——正则不配平花括号会跨块误匹配 */
function mediaBlock(src: string, condition: string): string | null {
  const at = src.indexOf(`@media ${condition}`)
  if (at < 0) return null
  const open = src.indexOf('{', at)
  if (open < 0) return null
  let depth = 0
  for (let i = open; i < src.length; i += 1) {
    const ch = src[i]
    if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) return src.slice(open + 1, i)
    }
  }
  return null
}

describe('主题 token 的接线', () => {
  const css = readFileSync(join(WEB_SRC, 'app/globals.css'), 'utf8')

  it('暗色覆盖写在媒体查询里的 :root 上，而不是 @theme 里', () => {
    // @theme 是构建期求值的：把暗色值放进去，工具类早已被编译成浅色常量，
    // 暗色主题看着配了，实际永远不生效。这条断言守的就是那个坑。
    expect(css).toMatch(/@theme\s+inline\s*\{/)
    const dark = mediaBlock(css, '(prefers-color-scheme: dark)')
    expect(dark).not.toBeNull()
    expect(dark ?? '').not.toContain('@theme')
    expect(dark).toMatch(/:root\s*\{[^}]*--ink:/)
  })

  it('明暗两态给每个语义 token 都赋了值', () => {
    const tokens = ['surface', 'surface-sunken', 'ink', 'ink-muted', 'ink-subtle', 'rule', 'rule-strong']
    const rootBlocks = [...css.matchAll(/:root\s*\{([^}]*)\}/g)].map((m) => m[1] ?? '')
    expect(rootBlocks.length).toBeGreaterThanOrEqual(2)
    for (const token of tokens) {
      expect(rootBlocks[0]).toMatch(new RegExp(`--${token}:`))
      expect(rootBlocks[1]).toMatch(new RegExp(`--${token}:`))
    }
  })

  it('每个 token 都通过 @theme inline 映射成工具类', () => {
    const inline = /@theme\s+inline\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
    for (const token of ['surface', 'surface-sunken', 'ink', 'ink-muted', 'ink-subtle', 'rule', 'rule-strong']) {
      expect(inline).toMatch(new RegExp(`--color-${token}:\\s*var\\(--${token}\\)`))
    }
  })

  it('明细与图表都锚定到 #content，跳过导航链接才有落点', () => {
    const layout = readFileSync(join(WEB_SRC, 'app/[locale]/layout.tsx'), 'utf8')
    expect(layout).toMatch(/className="skip-link"\s+href="#content"/)
    expect(layout).toMatch(/<main id="content"/)
  })
})
