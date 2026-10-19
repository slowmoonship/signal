import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

const resolvePath = (p: string): string => fileURLToPath(new URL(p, import.meta.url))

export default defineConfig({
  plugins: [
    {
      // vite 内置的 builtin 列表尚未包含实验性的 node:sqlite，
      // 会把 'node:sqlite' 剥掉前缀后当成裸包名去找。这里直接标为外部。
      name: 'externalize-node-sqlite',
      enforce: 'pre',
      resolveId(id) {
        if (id === 'node:sqlite' || id === 'sqlite') {
          return { id: 'node:sqlite', external: true }
        }
        return null
      },
    },
  ],
  resolve: {
    // workspace 包直接指向源码：测试与 ingest 用同一份实现，不存在"测的是编译产物"
    alias: {
      '@slowmoonship/metrics': resolvePath('./packages/metrics/src/index.ts'),
      '@slowmoonship/ingest': resolvePath('./packages/ingest/src/index.ts'),
    },
  },
  // node:sqlite 是 Node 内置模块，不能被 vite 打包解析
  ssr: {
    external: ['node:sqlite'],
  },
  test: {
    environment: 'node',
    // apps/web 也要进测试范围：视觉红线（只用灰阶）目前靠人肉 review 守着，
    // 而它一旦破防不会有任何运行时报错——所以需要一条可执行的守卫。
    include: ['packages/**/test/**/*.test.ts', 'apps/web/test/**/*.test.ts'],
    globals: false,
    server: {
      deps: {
        external: [/node:sqlite/],
      },
    },
  },
})
