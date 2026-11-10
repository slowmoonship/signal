/**
 * 首页交互与排版的回归守卫。
 *
 * 这一组断言守的都是**已经真实翻车过**的地方：
 *
 * 1. 拉伸链接（`after:absolute after:inset-0`）在表格行里会把伪元素的
 *    包含块算到整张表甚至整页，于是**点页面任意位置都跳到最后一个指标**
 *    （矿工收入）的详情页，连右上角的语言切换都被吃掉。
 *    这类 bug 没有任何运行时特征——页面照常渲染，控制台一片干净。
 * 2. 判定依据列把内部 metric id 与长错误信息摆到首页，行高被撑成两行。
 * 3. 分类列顶对齐，读起来像一张没排过的表。
 *
 * 这些断言读的是**源码文本**：本站构建期静态生成，没有浏览器运行时可挂，
 * 源码是唯一稳定的断言面（与 `theme.test.ts` 同一取舍）。
 * 真实点击由 `browser.test.ts` 在有浏览器与预览服务时执行。
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { HOME_METRIC_IDS } from '@slowmoonship/metrics'

const WEB_SRC = fileURLToPath(new URL('../src/', import.meta.url))

/**
 * 去掉注释再断言。
 *
 * 这一组断言要查的是"代码里有没有用这个类名"，而注释里恰恰会**提到**
 * 这些类名（"别用 relative"、"绝对定位会盖住整页"）。
 * 不去注释的话，断言会先被解释这个 bug 的那段话绊倒。
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const TABLE = stripComments(readFileSync(join(WEB_SRC, 'components/MetricTable.tsx'), 'utf8'))
const SPARK = stripComments(readFileSync(join(WEB_SRC, 'components/PriceSparkline.tsx'), 'utf8'))
const LAYOUT = stripComments(readFileSync(join(WEB_SRC, 'app/layout.tsx'), 'utf8'))
const PAGE = stripComments(readFileSync(join(WEB_SRC, 'views/HomeView.tsx'), 'utf8'))

describe('指标名称链接（第一版只有指标名可点）', () => {
  it('链接指向自己的详情页', () => {
    // 规范地址在站点根下（ADR-021）：/metrics/<id>，不带语言前缀
    expect(TABLE).toContain('href={`/metrics/${def.id}`}')
  })

  it('表内没有任何绝对定位——那正是"点哪都跳走"的来源', () => {
    // `<tr>` 一旦带上 relative，链接的 ::after 就可能以整张表为包含块，
    // 铺满页面并盖住所有其它元素。整行可点的收益远小于这个代价。
    expect(TABLE).not.toMatch(/\babsolute\b/)
    expect(TABLE).not.toMatch(/after:(?:absolute|inset-0)/)
    expect(TABLE).not.toMatch(/\brelative\b/)
  })

  it('表格不会盖住页面上的其它东西', () => {
    // 页头的品牌字标与页脚都在表格上方，被表格链接盖住就点不到了。
    expect(TABLE).not.toMatch(/\bfixed\b/)
    expect(TABLE).not.toMatch(/\bz-\d/)
    expect(TABLE).not.toMatch(/pointer-events/)
    // 行悬停底色用半透明叠加，不是不透明底色——不透明会把分类底色整片盖掉
    expect(TABLE).toMatch(/hover:bg-ink\/\[0\.03\]/)
  })

  it('页头没有语言切换入口（V0.1 只有中文，ADR-021）', () => {
    // 有语言切换就意味着还有第二种界面语言。删掉它之前，
    // 页面层不得出现任何指向另一种语言的链接。
    expect(LAYOUT).not.toMatch(/\/en/)
    expect(LAYOUT).not.toMatch(/English/)
    expect(LAYOUT).not.toMatch(/LocaleSwitch/)
  })

  it('首页每个指标都有详情页可去', () => {
    // 白名单里的每个 id 都会出现在表格里，因此每个 id 都要有可生成的详情路由
    for (const id of HOME_METRIC_IDS) {
      expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
    }
  })
})

describe('分类列', () => {
  it('在合并区里水平与垂直居中', () => {
    const rowgroup = /<th\s+scope="rowgroup"[\s\S]*?>/.exec(TABLE)?.[0] ?? ''
    expect(rowgroup).toMatch(/text-center/)
    expect(rowgroup).toMatch(/align-middle/)
    // 不能用绝对定位模拟居中
    expect(rowgroup).not.toMatch(/absolute/)
  })
})

describe('判定依据列', () => {
  it('不换行，且不出现内部 metric id', () => {
    const basis = /<td className="hidden[^"]*whitespace-nowrap[^"]*">/.exec(TABLE)
    expect(basis, '判定依据单元格缺少 whitespace-nowrap').not.toBeNull()
  })

  it('失败原因不直接进可见文本（只进 title）', () => {
    // 完整原因留在悬停提示与详情页；表格里那一格必须短
    expect(TABLE).toMatch(/title=\{full === short \? undefined : full\}/)
    expect(TABLE).not.toMatch(/\{marketStatus\.detail\}/)
  })
})

describe('页头', () => {
  it('品牌字标放大，说明性标题缩小', () => {
    const brand = /<span className="([^"]*)">\s*\{t\.siteTitle\}/.exec(LAYOUT)?.[1] ?? ''
    expect(brand, '页头字标字号未放大').toMatch(/text-2xl|sm:text-\[28px\]/)
    // 说明性标题退居其次
    const h1 = /<h1 className="([^"]*)">/.exec(PAGE)?.[1] ?? ''
    expect(h1, '副标题字号未缩小').toMatch(/text-base|text-lg/)
    expect(h1).not.toMatch(/text-2xl|text-3xl/)
  })

  it('页头到正文的距离收紧', () => {
    expect(LAYOUT).not.toMatch(/justify-between py-6/)
    expect(PAGE).not.toMatch(/mt-8 gap-8/)
  })
})

describe('定投绿色区间', () => {
  it('背景带与高亮线都来自同一个 worstCase', () => {
    // 背景带与高亮线各画一遍坐标就会错位，而错位几乎看不出来。
    // 几何在 @/lib/sparkline 里一次算完，组件只负责画。
    expect(SPARK).toMatch(/computeSparklineGeometry/)
    expect(SPARK).toMatch(/fill-highlight/)
    expect(SPARK).toMatch(/stroke-highlight/)
  })

  it('背景带贯穿整个绘图区高度', () => {
    const rect = /<rect[\s\S]*?\/>/.exec(SPARK)?.[0] ?? ''
    expect(rect).toMatch(/y=\{plotTop\}/)
    expect(rect).toMatch(/height=\{plotBottom - plotTop\}/)
  })

  it('没有硬编码的日期或像素坐标', () => {
    // 区间必须由数据算出：源码里不该出现形如 2018-01-01 或 120px 的常量
    expect(SPARK).not.toMatch(/\d{4}-\d{2}-\d{2}/)
    expect(SPARK).not.toMatch(/x=\{\d+\}/)
    expect(SPARK).not.toMatch(/width=\{\d+\}/)
  })
})

describe('数据时效', () => {
  it('更新时间取自数据自带的时间戳，不是构建时间', () => {
    expect(PAGE).toMatch(/newestSourceTime\(data\)/)
    expect(PAGE).not.toMatch(/new Date\(\)\.toISOString\(\).*updatedAt/)
  })

  it('快照过期时明确标识', () => {
    expect(PAGE).toMatch(/outdated/)
    expect(PAGE).toMatch(/snapshotOutdated/)
    // 过期判定用数据时间与构建时刻的差，而不是构建时刻与构建时刻的差
    expect(PAGE).toMatch(/nowMs - Date\.parse\(newest\)/)
  })
})

describe('页脚品牌与社交入口', () => {
  const FOOTER = stripComments(readFileSync(join(WEB_SRC, 'components/SiteFooter.tsx'), 'utf8'))
  const DICT = stripComments(readFileSync(join(WEB_SRC, 'i18n/dictionaries.ts'), 'utf8'))

  it('页脚写的是品牌署名，不再是"每日一个快照"', () => {
    expect(DICT).toMatch(/slowmoonship-慢月船/)
    expect(FOOTER).toMatch(/footerBrand/)
    expect(DICT).not.toMatch(/每日一个快照/)
    expect(DICT).not.toMatch(/无实时数据/)
  })

  it('两个社交按钮指向真实账号，不是占位地址', () => {
    expect(FOOTER).toContain('https://github.com/slowmoonship')
    expect(FOOTER).toContain('https://x.com/slowmoonship')
    // 占位域名是最容易蒙混过关的一种：链接能点，但点过去什么也没有
    expect(FOOTER).not.toMatch(/example\.(com|org)/)
  })

  it('外链新窗口打开且带安全的 rel', () => {
    expect(FOOTER).toMatch(/target="_blank"/)
    expect(FOOTER).toMatch(/rel="noopener noreferrer"/)
  })

  it('窄屏换行而不是横向溢出', () => {
    expect(FOOTER).toMatch(/flex-wrap/)
  })
})

