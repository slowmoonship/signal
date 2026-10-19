import { registry } from '@slowmoonship/metrics'

/**
 * Phase 0 占位页 —— 刻意不是正式首页。
 *
 * 正式首页（分类 + 极简指标列表）在 Phase 1 实现。
 * 这里只验证工具链打通，并暴露注册表当前状态，便于发现"指标定义了但没注册"。
 *
 * `params` 目前未用于渲染：Phase 1 才会真正按 locale 取双语文案。
 */
export default async function Placeholder({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  await params
  const count = registry.all().length

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">Signal</h1>
      <p className="mt-2 text-zinc-600 dark:text-zinc-400">加密资产市场与链上指标目录</p>

      <dl className="mt-10 space-y-2 font-mono text-sm">
        <div className="flex gap-4">
          <dt className="text-zinc-500">阶段</dt>
          <dd>Phase 0 — 骨架</dd>
        </div>
        <div className="flex gap-4">
          <dt className="text-zinc-500">已注册指标</dt>
          <dd>{count}</dd>
        </div>
        <div className="flex gap-4">
          <dt className="text-zinc-500">指标定义</dt>
          <dd>Phase 1 起填充</dd>
        </div>
      </dl>

      <p className="mt-10 border-t border-zinc-200 pt-4 text-sm text-zinc-500 dark:border-zinc-800">
        {count === 0
          ? '注册表为空。指标定义落地后，此处数量应随之增加。'
          : '指标已注册。'}
      </p>
    </main>
  )
}
