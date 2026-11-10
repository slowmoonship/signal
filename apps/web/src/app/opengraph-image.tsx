/**
 * 社交分享图（OG / Twitter card）。
 *
 * 刻意只有拉丁字母与数字：`next/og` 内置的字体不含中文字形，
 * 中文会渲染成豆腐块。为了让中文也好看就得把一套 CJK 字体塞进构建产物
 * （约 4 MB），而分享图上真正要传达的只有三件事：这是什么、什么资产、多大更新频率。
 * 这三件事用拉丁字母说清楚就够了。图上的 alt 文本是中文，
 * 它是给读屏软件与爬虫看的文字，不受图片字体的限制。
 *
 * 视觉沿用 DESIGN.md 的红线：纯灰阶、无阴影无渐变、层级靠字重与间距。
 *
 * 放在 app 根上，因此 `/`、`/zh` 与所有详情页共用这一张图。
 */

import { ImageResponse } from 'next/og'

import { registry } from '@slowmoonship/metrics'

/**
 * 静态导出要求这个路由是静态的：`output: 'export'` 下没有运行时，
 * 图片必须在构建期生成成一张 PNG。
 */
export const dynamic = 'force-static'

export const alt = 'Signal —— 比特币市场与链上指标目录，每日一个快照'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default function OpengraphImage() {
  const count = registry.byAsset('btc').length

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          // 与 docs/DESIGN.md 的 --ink / --surface 同值：分享图在两个主题之外，
          // 固定用中性的一套，避免在聊天软件的白底或深底上看不清。
          backgroundColor: '#18181b',
          color: '#e4e4e7',
          padding: 72,
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: 30, letterSpacing: 6, color: '#a1a1aa' }}>SIGNAL</div>
          <div
            style={{
              marginTop: 24,
              fontSize: 76,
              fontWeight: 600,
              letterSpacing: -2,
              // satori（next/og 底层）要求多子节点的容器显式声明 display，
              // 否则渲染直接失败——不是布局失真，是构建期报错。
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <span>Bitcoin metrics,</span>
            <span>one snapshot a day.</span>
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            fontSize: 28,
            color: '#71717a',
            borderTop: '1px solid #3f3f46',
            paddingTop: 28,
            alignItems: 'center',
          }}
        >
          <span>BTC</span>
          <span style={{ margin: '0 16px' }}>·</span>
          <span>{count} metrics</span>
          <span style={{ margin: '0 16px' }}>·</span>
          <span>UTC</span>
        </div>
      </div>
    ),
    size,
  )
}
