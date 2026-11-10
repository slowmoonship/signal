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

import { METRIC_CATEGORIES } from '@slowmoonship/metrics'

const WEB_SRC = fileURLToPath(new URL('../src/', import.meta.url))
const TINT_SRC = fileURLToPath(new URL('../src/lib/categories.ts', import.meta.url))

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

  it('不用彩色工具类：色值只能来自 globals.css 的 token', () => {
    const offenders: string[] = []
    // 只查 Tailwind 的调色板工具类（bg-red-500 / text-blue-600 …），
    // 不查语义 token（bg-surface / text-ink / bg-cat-market …），后者正是我们要的。
    const palette = /\b(?:bg|text|border|fill|stroke|ring|divide|from|to|via)-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|neutral|stone)-?\d{0,3}\b/
    for (const file of files) {
      if (!file.endsWith('.tsx')) continue
      const src = stripComments(readFileSync(file, 'utf8'), '.tsx')
      const hits = src.match(new RegExp(palette.source, 'g'))
      if (hits) offenders.push(`${file.replace(WEB_SRC, '')}: ${[...new Set(hits)].join(', ')}`)
    }
    expect(offenders).toEqual([])
  })

  it('组件不内联色值', () => {
    // 内联 style={{ background: … }} 或 style="color: #fff" 都能绕过 token 体系，
    // 也让明暗主题在那一处静默失效
    const offenders: string[] = []
    const inline = /style=\{\{[^}]*(?:color|background|borderColor)/i
    const inlineStr = /style="[^"]*(?:color|background)[^"]*(?:#|rgb|hsl)/i
    for (const file of files) {
      if (!file.endsWith('.tsx')) continue
      // OG 图是例外：satori（next/og 底层）不认 class，也不认 CSS 自定义属性，
      // 色值只能内联；而且分享图本来就跑在两个主题之外，必须固定一套中性色。
      if (file.endsWith('opengraph-image.tsx')) continue
      const src = stripComments(readFileSync(file, 'utf8'), '.tsx')
      if (inline.test(src) || inlineStr.test(src)) {
        offenders.push(file.replace(WEB_SRC, ''))
      }
    }
    expect(offenders).toEqual([])
  })
})

// ── 分类底色（CLAUDE.md §分类底色）────────────────────────

describe('分类底色', () => {
  const css = readFileSync(join(WEB_SRC, 'app/globals.css'), 'utf8')

  it('色值只写在 globals.css 的 token 里，明暗两态各一份', () => {
    const declared = [...css.matchAll(/(?<![-\w])--cat-([a-z]+):\s*([^;]+);/g)].map((m) => m[1] as string)
    // 每个分类必须在明暗两态都出现一次
    expect(declared.length).toBe(METRIC_CATEGORIES.length * 2)
    for (const c of METRIC_CATEGORIES) {
      expect(declared.filter((n) => n === c).length, `${c} 声明次数不是 2`).toBe(2)
    }
  })

  it('底色一律低饱和（HSL 饱和度 ≤ 40%）', () => {
    // 饱和度是"这还是不是灰阶"的唯一量化指标。放松它，
    // 六个分类就会慢慢长成六个能读出态度的颜色——而底色不该有态度。
    const offenders: string[] = []
    for (const m of css.matchAll(/--cat-[a-z]+:\s*hsl\(\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%\s*\)/g)) {
      const saturation = Number(m[2])
      const lightness = Number(m[3])
      if (saturation > 40) offenders.push(`${m[0]} 饱和度 ${saturation}%`)
      // 浅色态必须够浅、暗色态必须够暗，否则底色会盖过文字
      const isDark = lightness < 50
      if (isDark ? lightness > 18 : lightness < 94) {
        offenders.push(`${m[0]} 明度 ${lightness}% 超出该态的可用区间`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('每个分类都通过 @theme inline 映射成 bg-cat-* 工具类', () => {
    const categories = tintSourceCategories()
    const inline = /@theme\s+inline\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? ''
    for (const { category, className } of categories) {
      expect(inline, `${category} 未映射`).toMatch(
        new RegExp(`--color-cat-${category}:\\s*var\\(--cat-${category}\\)`),
      )
      // 类名必须与分类名一一对应，否则组件会刷出一个"没有底色"的组
      expect(className).toBe(`bg-cat-${category}`)
    }
    expect(categories.length).toBeGreaterThanOrEqual(4)
  })

  it('组件只通过 bg-cat-* 类取色，且类别表与注册表完全一致', () => {
    // 从注册表读分类，而不是在这里写死一份：写死的两份迟早分叉
    const declared = tintSourceCategories().map((e) => e.category).sort()
    expect(declared).toEqual([...METRIC_CATEGORIES].sort())

    const tsx = readFileSync(join(WEB_SRC, 'components/MetricTable.tsx'), 'utf8')
    // 组件里不允许出现裸色值类
    expect(tsx).not.toMatch(/hsl\(|#[0-9a-f]{3,8}\b/i)
  })
})

/**
 * 从 categories.ts 里抠出 CATEGORY_TINT 的 分类 → 类名 对应关系。
 *
 * 刻意用数组而不是 Map：测试文件不在任何 package 的 tsconfig include 里，
 * eslint 走 projectService 的默认工程，那里的 lib 装不下 Map/Set 的类型，
 * 用它们会让所有取值退化成 any，类型化 lint 随即报 unsafe-argument。
 */
function tintSourceCategories(): { category: string; className: string }[] {
  const src = stripComments(readFileSync(TINT_SRC, 'utf8'), '.tsx')
  const body = /CATEGORY_TINT[^=]*=\s*\{([\s\S]*?)\n\}/.exec(src)?.[1] ?? ''
  return [...body.matchAll(/^\s*([a-z]+):\s*'([^']+)'/gm)].map((m) => ({
    category: m[1] as string,
    className: m[2] as string,
  }))
}

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
    const tokens = ['surface', 'surface-sunken', 'ink', 'ink-muted', 'ink-subtle', 'rule', 'rule-strong', 'highlight']
    const rootBlocks = [...css.matchAll(/:root\s*\{([^}]*)\}/g)].map((m) => m[1] ?? '')
    expect(rootBlocks.length).toBeGreaterThanOrEqual(2)
    for (const token of tokens) {
      expect(rootBlocks[0]).toMatch(new RegExp(`--${token}:`))
      expect(rootBlocks[1]).toMatch(new RegExp(`--${token}:`))
    }
  })

  it('每个 token 都通过 @theme inline 映射成工具类', () => {
    const inline = /@theme\s+inline\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
    for (const token of ['surface', 'surface-sunken', 'ink', 'ink-muted', 'ink-subtle', 'rule', 'rule-strong', 'highlight']) {
      expect(inline).toMatch(new RegExp(`--color-${token}:\\s*var\\(--${token}\\)`))
    }
  })

  it('明细与图表都锚定到 #content，跳过导航链接才有落点', () => {
    const layout = readFileSync(join(WEB_SRC, 'app/layout.tsx'), 'utf8')
    expect(layout).toMatch(/className="skip-link"\s+href="#content"/)
    expect(layout).toMatch(/<main id="content"/)
  })

  it('字体变量挂在 <html> 上，不挂 <body>', () => {
    // 这条曾经是一个完全静默的 bug：构建产物 CSS 一字不差地正确，
    // 但页面上一个 web font 都没加载，退回系统字体也看不出任何报错。
    //
    // 原因：Tailwind 把 `--font-sans: var(--font-inter), …` 声明在 `:root`（<html>），
    // 而 CSS 自定义属性的 var() 在**声明处**替换——那一刻 <html> 上还没有
    // `--font-inter`，`--font-sans` 直接变成 guaranteed-invalid，
    // 且这个 invalid 状态会原样继承给所有后代，**不会**在 <body> 上重新求值。
    // 所以 next/font 的变量必须挂到 <html>，让 var() 在替换时能取到值。
    const layout = readFileSync(join(WEB_SRC, 'app/layout.tsx'), 'utf8')
    expect(layout).toMatch(/<html[^>]*className=\{fontVariables\}/)
    expect(layout).not.toMatch(/<body[^>]*fontVariables/)
  })
})

// ── 状态色（CLAUDE.md §状态色）────────────────────────

describe('状态色', () => {
  const css = readFileSync(join(WEB_SRC, 'app/globals.css'), 'utf8')
  const TONES = ['hot', 'flat', 'cold', 'void'] as const

  it('色值只写在 globals.css，明暗两态各一份', () => {
    // 与分类底色同款约束：内联色值会让暗色主题在这一处静默失效
    const rootBlocks = [...css.matchAll(/:root\s*\{([^}]*)\}/g)].map((m) => m[1] ?? '')
    expect(rootBlocks.length).toBeGreaterThanOrEqual(2)
    for (const tone of TONES) {
      for (const suffix of ['', '-ink']) {
        const token = `--status-${tone}${suffix}`
        expect(rootBlocks[0], `${token} 缺少浅色值`).toMatch(new RegExp(`${token}:\\s*hsl\\(`))
        expect(rootBlocks[1], `${token} 缺少暗色值`).toMatch(new RegExp(`${token}:\\s*hsl\\(`))
      }
    }
  })

  it('底色低饱和（HSL ≤ 40%）且只做背景填充', () => {
    // 放松饱和度，状态胶囊就会从"位置提示"长成"红=危险 蓝=安全"的告警盘。
    const offenders: string[] = []
    for (const m of css.matchAll(/--status-[a-z-]+:\s*hsl\(\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%\s*\)/g)) {
      // -ink 是文字色，饱和度可以高一些；只约束底色
      if (m[0].includes('-ink')) continue
      const saturation = Number(m[2])
      const lightness = Number(m[3])
      if (saturation > 40) offenders.push(`${m[0]} 饱和度 ${saturation}%`)
      const isDark = lightness < 50
      if (isDark ? lightness > 20 : lightness < 93) {
        offenders.push(`${m[0]} 明度 ${lightness}% 超出该态的可用区间`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('底色不参与涨跌染色：涨跌只由 +/- 号表达', () => {
    // 一次真实的翻车方式：给"7 日变化"加负值红底。
    // "涨"对不同指标含义相反（矿工收入涨是好，费率涨不是），
    // 染色等于替读者下了判断，而读者看到的只有颜色。
    const tsx = readFileSync(join(WEB_SRC, 'components/MetricTable.tsx'), 'utf8')
    expect(stripComments(tsx, '.tsx')).not.toMatch(/\b(?:bg|text)-(?:status-|cat-)/)
  })

  it('全站没有第二个绿色 token，状态色与高亮绿不会混淆', () => {
    // 绿色如果同时表示"最长等待期"和"偏强"，读者会以为绿色=好。
    for (const m of css.matchAll(/--status-[a-z-]+:\s*hsl\(\s*([\d.]+)\s+([\d.]+)%/g)) {
      const hue = Number(m[1])
      // 绿色在 HSL 环上大约落在 90–150
      const inGreen = (hue >= 90 && hue <= 150) || (hue >= 330 && hue <= 360)
      expect(inGreen, `${m[0]} 落在了绿色区间，会与 --highlight 混淆`).toBe(false)
    }
  })

  it('每个色档都通过 @theme inline 映射成 bg-status-* / text-status-*-ink', () => {
    const inline = /@theme\s+inline\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
    for (const tone of TONES) {
      expect(inline, `${tone} 未映射`).toMatch(
        new RegExp(`--color-status-${tone}:\\s*var\\(--status-${tone}\\)`),
      )
      expect(inline, `${tone} 的文字色未映射`).toMatch(
        new RegExp(`--color-status-${tone}-ink:\\s*var\\(--status-${tone}-ink\\)`),
      )
    }
  })

  it('组件只用语义类，且色档表与 StatusTone 一一对应', () => {
    const src = stripComments(readFileSync(join(WEB_SRC, 'components/StatusPill.tsx'), 'utf8'), '.tsx')
    expect(src).not.toMatch(/hsl\(|#[0-9a-f]{3,8}\b/i)
    const body = /TONE_CLASS[^=]*=\s*\{([\s\S]*?)\n\}/.exec(src)?.[1] ?? ''
    // 四个色档，每个各一条底色 + 一条文字色，缺一不可
    const classes = [...body.matchAll(/\b(?:bg|text)-status-[a-z-]+\b/g)].map((m) => m[0] as string)
    expect([...new Set(classes)].sort()).toEqual([
      'bg-status-cold',
      'bg-status-flat',
      'bg-status-hot',
      'bg-status-void',
      'text-status-cold-ink',
      'text-status-flat-ink',
      'text-status-hot-ink',
      'text-status-void-ink',
    ])
    // 每个色档键都必须有值，否则渲染出来是一个没有底色的裸文字
    const keys = [...body.matchAll(/^\s*(\w+):/gm)].map((m) => m[1] as string)
    expect(keys).toEqual([...TONES])
  })
})

// ── 高亮绿（CLAUDE.md §高亮绿）────────────────────────

describe('高亮绿', () => {
  const css = readFileSync(join(WEB_SRC, 'app/globals.css'), 'utf8')

  it('绿色只有两个 token，且各有各的职责', () => {
    // 允许多一个彩色强调，就等于没有约束：读者会开始解读颜色。
    // 但绿色现在有两个**互不相干**的职责，因此必须是两个 token：
    // - `--highlight`：走势图上"最长定投等待期"那一段（标一段区间）
    // - `--market-improving`：市场状态卡片"条件明确改善"的底色（标一个结论）
    // 共用一个绿色，读者就会把"这段最难受"读成"现在适合买"。
    const greenTokens = [...css.matchAll(/(--market-improving|--highlight[a-z-]*):/g)].map(
      (m) => m[0] as string,
    )
    expect([...new Set(greenTokens)].sort()).toEqual(['--highlight:', '--market-improving:'])
  })

  it('市场状态的绿在绿色区间，状态色依然避开绿色', () => {
    // --market-improving 本来就该是绿的（它就是"改善"）；
    // --status-* 一律不许进绿色区间——那是"相对自身历史的位置"，
    // 两者混用，"绿色 = 好"立刻长回来。
    const marketGreen = /--market-improving:\s*hsl\(\s*([\d.]+)/.exec(css)
    expect(marketGreen, '找不到 --market-improving 的色值').not.toBeNull()
    const hue = Number(marketGreen?.[1])
    expect(hue >= 90 && hue <= 150, `--market-improving 的色相 ${hue} 不在绿色区间`).toBe(true)

    for (const m of css.matchAll(/--status-[a-z-]+:\s*hsl\(\s*([\d.]+)\s+([\d.]+)%/g)) {
      const statusHue = Number(m[1])
      const inGreen = (statusHue >= 90 && statusHue <= 150) || (statusHue >= 330 && statusHue <= 360)
      expect(inGreen, `${m[0]} 落在了绿色区间，会与市场状态底色混淆`).toBe(false)
    }
  })

  it('--highlight 明暗两态各一份，且都走 @theme inline', () => {
    const rootBlocks = [...css.matchAll(/:root\s*\{([^}]*)\}/g)].map((m) => m[1] ?? '')
    expect(rootBlocks.length).toBeGreaterThanOrEqual(2)
    expect(rootBlocks[0]).toMatch(/--highlight:\s*hsl\(/)
    expect(rootBlocks[1]).toMatch(/--highlight:\s*hsl\(/)
    const inline = /@theme\s+inline\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(inline).toMatch(/--color-highlight:\s*var\(--highlight\)/)
  })

  it('绿色只用在十年价格走势图上', () => {
    // 一旦绿色出现在别处（比如"推荐买入"标记），它就从一个事实变成了一个建议。
    const users: string[] = []
    for (const file of files) {
      if (!file.endsWith('.tsx')) continue
      const src = stripComments(readFileSync(file, 'utf8'), '.tsx')
      if (/\b(?:bg|text|border|fill|stroke|ring|divide|from|to|via)-highlight\b/.test(src)) {
        users.push(file.replace(WEB_SRC, ''))
      }
    }
    expect(users).toEqual(['components/PriceSparkline.tsx'])
  })

  it('绿色标记的是"最长等待期"，不是"适合定投"', () => {
    // 这条是语义守卫：绿色标的那一段是回测算出来的事实。
    // 一旦文案把它说成"底部 / 适合定投 / 该买了"，颜色就替读者下了估值判断。
    const dict = readFileSync(join(WEB_SRC, 'i18n/dictionaries.ts'), 'utf8')
    const banned = [/适合定投/, /该买/, /底部区域/, /可以入场/, /good time to buy/i, /time to buy/i]
    for (const re of banned) {
      expect(dict, `出现了投资建议式文案：${re}`).not.toMatch(re)
    }
  })
})

// ── 市场状态卡片底色（CLAUDE.md §市场状态卡片）────────────

describe('市场状态卡片底色', () => {
  const css = readFileSync(join(WEB_SRC, 'app/globals.css'), 'utf8')
  const TONES = ['improving', 'deteriorating', 'neutral'] as const

  it('色值只写在 globals.css，明暗两态各一份', () => {
    // 与分类底色、状态色同款约束：内联色值会让暗色主题在这一处静默失效
    const rootBlocks = [...css.matchAll(/:root\s*\{([^}]*)\}/g)].map((m) => m[1] ?? '')
    expect(rootBlocks.length).toBeGreaterThanOrEqual(2)
    for (const tone of ['improving', 'deteriorating']) {
      const token = `--market-${tone}`
      expect(rootBlocks[0], `${token} 缺少浅色值`).toMatch(new RegExp(`${token}:\\s*hsl\\(`))
      expect(rootBlocks[1], `${token} 缺少暗色值`).toMatch(new RegExp(`${token}:\\s*hsl\\(`))
    }
    // 中性档就是卡片原来的背景，跟着 --surface 走，因此不随主题另设一份
    expect(css).toMatch(/--market-neutral:\s*var\(--surface\)/)
  })

  it('底色低饱和（HSL ≤ 50%）且只做背景填充，不改文字颜色', () => {
    // 饱和度上限比分类底色（≤40%）宽一档，理由写在这里：
    // 分类底色的职责是"别被读成态度"，而这里的颜色**本身就是结论**——
    // 读者要的是一眼看出方向，底色太淡就等于没做。
    // 但明度仍然压得很浅（浅色态 ≥92%），仍然是极浅的底，不是色块。
    const offenders: string[] = []
    for (const m of css.matchAll(
      /--market-[a-z]+:\s*hsl\(\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%\s*\)/g,
    )) {
      const saturation = Number(m[2])
      const lightness = Number(m[3])
      if (saturation > 50) offenders.push(`${m[0]} 饱和度 ${saturation}%`)
      const isDark = lightness < 50
      if (isDark ? lightness > 18 : lightness < 92) {
        offenders.push(`${m[0]} 明度 ${lightness}% 超出该态的可用区间`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('每个色档都通过 @theme inline 映射成 bg-market-*', () => {
    const inline = /@theme\s+inline\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
    for (const tone of TONES) {
      expect(inline, `${tone} 未映射`).toMatch(
        new RegExp(`--color-market-${tone}:\\s*var\\(--market-${tone}\\)`),
      )
    }
  })

  it('只有市场状态卡片用 bg-market-*——右栏表格一个都不用', () => {
    // 给每个指标都染上底色，读者会以为整张表在表达同一个判断。
    const users: string[] = []
    for (const file of files) {
      if (!file.endsWith('.tsx')) continue
      const src = stripComments(readFileSync(file, 'utf8'), '.tsx')
      if (/\bbg-market-[a-z]+\b/.test(src)) users.push(file.replace(WEB_SRC, ''))
    }
    expect(users).toEqual(['components/HeroMetric.tsx'])
  })

  it('底色只做背景，不给文字另配一套颜色', () => {
    for (const file of files) {
      if (!file.endsWith('.tsx')) continue
      const src = stripComments(readFileSync(file, 'utf8'), '.tsx')
      expect(src, `${file.replace(WEB_SRC, '')} 给市场状态文字单独上了色`).not.toMatch(/\btext-market-/)
    }
  })
})
