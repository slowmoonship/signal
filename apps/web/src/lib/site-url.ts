/**
 * 站点根 URL。
 *
 * **为什么不写死域名**：域名是 Phase 5 的决定，尚未拍板（PLAN §8）。
 * 现在把一个占位域名写进代码，等于假装部署目标已经定了——将来换域名时
 * 还得多一处要记得改的地方，而 sitemap / OG / canonical 全都依赖它。
 *
 * 读环境变量而不是 `NEXT_PUBLIC_*` 常量：没有值时返回 null，
 * 让调用方**显式决定**要不要生成绝对 URL（见 sitemap.ts 的注释）。
 * 域名没定之前，本地构建不应该凭空造出一个 `https://signal.example` 写进 sitemap。
 */
export function siteUrl(): URL | null {
  const raw = process.env.SIGNAL_SITE_URL
  if (raw === undefined || raw.trim() === '') return null
  try {
    return new URL(raw)
  } catch {
    // 配错了就当没配。抛错会让整个构建失败，而失败原因对部署者并不显然——
    // 错误信息里明确写出来，比一个 URL 构造函数异常有用。
    console.warn(`[signal] SIGNAL_SITE_URL 不是合法 URL，已忽略：${raw}`)
    return null
  }
}
