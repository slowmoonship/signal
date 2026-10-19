/**
 * Web 字体加载。
 *
 * Inter 承担拉丁字母与数字（指标数值、时间、来源等元信息），
 * Noto Sans SC 承担中文字形——中英混排时两者必须显式配对，
 * 只声明其中一个会让另一类字符掉回系统字体，字重与字面高度对不上。
 *
 * 两个 loader 都只输出 CSS 变量（`variable`），不直接指定 font-family：
 * `globals.css` 的 `--font-sans` 仍以系统字体栈收尾，
 * 字体没到位时页面退回系统 CJK 字体，而不是出现空白方块。
 */

import { Inter, Noto_Sans_SC } from 'next/font/google'

/**
 * 字重只声明 400 / 500 / 600：全站目前只用到 `font-medium` 与 `font-semibold`，
 * 外加正文默认的 400。Noto Sans SC 按 unicode-range 切片，
 * 每多一个字重就多一整套文件，构建时也要多下一轮，所以不贪。
 */
export const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
})

export const notoSansSC = Noto_Sans_SC({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  display: 'swap',
  variable: '--font-noto-sans-sc',
})

/** 挂到 `<body>` 上，让两套字体的 CSS 变量对整棵树生效。 */
export const fontVariables = `${inter.variable} ${notoSansSC.variable}`
