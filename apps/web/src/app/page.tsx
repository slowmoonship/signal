/**
 * 首页路由：`/`。
 *
 * 站点根路径直接就是中文首页——不经过服务端重定向，
 * 静态导出到 GitHub Pages 之后打开域名根路径也能落到首页（ADR-021）。
 */

import { HomeView } from '@/views/HomeView'
import { homeMetadata } from '@/views/routes'

export function generateMetadata() {
  return homeMetadata({ legacy: false })
}

export default function Page() {
  return <HomeView />
}
