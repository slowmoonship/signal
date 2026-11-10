/**
 * 静态预览服务器 —— 用来测 `out/`，而不是测 `next start`。
 *
 * 为什么不用 `next start`：`output: 'export'` 的产物是**纯静态文件**，
 * Next 的生产服务器在这种模式下根本跑不起来。
 * 更重要的是：**GitHub Pages 也不运行 Next.js**，它只发文件。
 * 拿一个 Next 服务器去"证明"静态导出成功，证明不了任何事——
 * 那证明的是"Next 能跑"，而线上跑的是 GitHub Pages。
 *
 * 它模仿 GitHub Pages 的三条规则：
 * 1. 站点挂在子路径下（`/signal`）：请求前缀先剥掉，再找文件；
 * 2. 目录 → 该目录下的 `index.html`；
 * 3. 找不到 → `404.html`，且状态码是 **404**（不是 200，
 *    否则搜索引擎会把不存在的页面当成正常页面收录）。
 *
 * 用法：`npm run preview --workspace @slowmoonship/web`（默认 4310 端口）。
 */

import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../out')
const basePath = '/signal'
const port = Number(process.env.PORT ?? 4310)

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
}

if (!existsSync(root)) {
  console.error(`找不到导出产物：${root}\n先跑 \`npm run build --workspace @slowmoonship/web\`。`)
  process.exit(1)
}

/** 把 URL 路径安全地映射到磁盘文件；越界（../）一律拒绝 */
function resolveFile(pathname) {
  const decoded = decodeURIComponent(pathname)
  const rel = normalize(decoded).replace(/^(\.\.[/\\])+/, '')
  const full = resolve(root, `.${rel}`)
  if (full !== root && !full.startsWith(root + sep)) return null
  return full
}

function send(res, file, status) {
  res.writeHead(status, {
    'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
    'cache-control': 'no-cache',
  })
  createReadStream(file).pipe(res)
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  let pathname = url.pathname

  if (!pathname.startsWith(basePath)) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('404 — 站点挂在 ' + basePath + ' 下\n')
    return
  }
  pathname = pathname.slice(basePath.length) || '/'

  let file = resolveFile(pathname)
  if (!file) {
    res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('400\n')
    return
  }

  if (existsSync(file) && statSync(file).isDirectory()) {
    file = join(file, 'index.html')
  }

  if (!existsSync(file) || !statSync(file).isFile()) {
    const notFound = join(root, '404.html')
    if (existsSync(notFound)) {
      send(res, notFound, 404)
      return
    }
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('404\n')
    return
  }

  send(res, file, 200)
})

server.listen(port, '127.0.0.1', () => {
  console.log(`静态预览已启动：http://127.0.0.1:${port}${basePath}/（根目录：${root}）`)
})
