/**
 * `/zh` —— 首页的历史别名。
 *
 * 上一版站点的首页在 `/zh`（那时还有 `/en`），外部链接与书签都指向它。
 * V0.1 去掉英文界面后规范地址变成 `/`，但这个路径必须继续能打开（ADR-021），
 * 否则站外已经发出去的链接会全部变成 404。
 *
 * 内容与 `/` 完全一致；canonical 指向 `/`，并且不进入索引——
 * 它是同一页面的另一个地址，不是第二份内容。
 */

import { HomeView } from '@/views/HomeView'
import { homeMetadata } from '@/views/routes'

export function generateMetadata() {
  return homeMetadata({ legacy: true })
}

export default function Page() {
  return <HomeView />
}
