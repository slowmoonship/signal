import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,

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
