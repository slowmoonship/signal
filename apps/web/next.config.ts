import type { NextConfig } from 'next'

import { BASE_PATH } from './src/lib/base-path'

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // ── 静态导出（GitHub Pages）────────────────────────────────
  //
  // GitHub Pages 不运行 Node 服务，只发静态文件。因此本站以
  // `output: 'export'` 构建出 `out/`，由 GitHub Actions 部署。
  //
  // `basePath` 必须与 `src/lib/base-path.ts` 里的 BASE_PATH 一致：
  // 项目站点挂在 `https://slowmoonship.github.io/signal/` 下，
  // 少了它，所有资源 URL 都会指向域名根路径，页面一片空白。
  //
  // `trailingSlash: true` 是给静态托管准备的：Next 会把
  // `/metrics/price` 导出成 `out/metrics/price/index.html`，
  // 托管方按"目录 → index.html"的常规规则提供服务；
  // 不带斜杠的 `/metrics/price` 在静态托管上没有对应文件。
  output: 'export',
  basePath: BASE_PATH,
  trailingSlash: true,

  // 静态导出没有图片优化服务器（/\_next/image），任何 <Image> 都会被优化
  // 路由卡住。本站目前没有用到 <Image>，但显式关掉可以让"以后有人用了"
  // 时得到的仍是一份可导出的产物，而不是构建期报错。
  images: { unoptimized: true },

  // workspace 包直接指向 TypeScript 源码，需由 Next 编译
  // （CLAUDE.md 依赖方向约束：web 只 import metrics，且只读 public/data/*.json，
  //   不得在服务端直连外部 API）
  transpilePackages: ['@slowmoonship/metrics'],

  // lint 的唯一入口是根目录 `npm run lint`（ESLint flat config + 类型感知规则）。
  // 关闭 Next 内建的 lint 阶段，避免两套规则重复且互相打架。
  eslint: { ignoreDuringBuilds: true },

  webpack: (config) => {
    // packages/ 用 NodeNext 模块解析，内部相对导入写作 './x.js' 指向 './x.ts'。
    // webpack 默认不做这个映射，缺了它会报 "Can't resolve './defineMetric.js'"。
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      '.js': ['.ts', '.tsx', '.js'],
    }
    return config
  },
}

export default nextConfig
