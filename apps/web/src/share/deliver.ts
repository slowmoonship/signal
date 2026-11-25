/**
 * 把已经画好的 PNG 交出去。
 *
 * `navigator.share` 存在，不等于能分享文件。先问 `canShare`。
 * 用户关掉系统面板是 AbortError，到此为止，不再下载一份。
 * 手势过期、浏览器拒绝、或根本没有这个 API，才下载。
 */

export type ShareDelivery = 'shared' | 'aborted' | 'fallback'

type SharePayload = {
  files: File[]
  title: string
  text: string
}

export type ShareNavigator = Readonly<{
  share?: (data: SharePayload) => Promise<void>
  canShare?: (data: SharePayload) => boolean
}>

export async function deliverShareFile(file: File, text: string, nav: ShareNavigator): Promise<ShareDelivery> {
  if (typeof nav.share !== 'function') return 'fallback'
  const payload: SharePayload = { files: [file], title: 'Signal', text }
  if (typeof nav.canShare === 'function' && !nav.canShare(payload)) return 'fallback'
  try {
    await nav.share(payload)
    return 'shared'
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return 'aborted'
    return 'fallback'
  }
}
