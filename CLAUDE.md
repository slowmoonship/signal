# CLAUDE.md

> 本文件是 Signal 项目的**最高约束来源**，每次会话开始时自动加载。
> 若本文件与任何临场判断冲突，以本文件为准；有异议先改本文件，不要绕过它。

## 项目

**Signal** —— 面向公众的加密资产市场与链上指标目录。阶段一只做 BTC，架构预留 ETH / SOL。
中英双语，GitHub Actions 日更抓取，明暗主题，视觉参考 leerob.com（灰阶、字重驱动层级、极简）。

已确认的产品决策见 `docs/DECISIONS.md`。**这些是用户拍板的，不要自行推翻。**

## 技术栈

Next.js 15 (App Router) · TypeScript · Tailwind CSS v4 · Vitest · npm workspaces
数据层：`node:sqlite`（Node 内置，**不要引入 better-sqlite3**）· 抓取 Node + tsx

## 架构边界（硬约束）

包依赖方向，**只允许**：

```
apps/web ──→ packages/metrics ←── packages/ingest
```

1. `packages/metrics` 是**唯一事实源**（类型 + 指标注册表 + 派生计算）。三个包都依赖它。
2. **`apps/web` 不得 import `packages/ingest`**，不得直连任何外部 API，页面只读 `public/data/*.json`。
3. **`packages/ingest` 不得 import `apps/web`**，不得感知前端存在。
4. 任何一方**硬编码指标列表**都是 bug。指标只能通过 `packages/metrics` 的 `defineMetric` 定义。
5. 页面的数据新鲜度上限 = 抓取频率（日更）。**不要引入实时轮询、SSE、WebSocket、客户端轮询。**

## 开发纪律

- 新增指标走 `docs/METRIC_AUTHORING.md` 的流程，不跳步。指标文案必须中英双语齐全。
- 新增架构决策追加到 `docs/DECISIONS.md`（ADR 格式：背景 / 决策 / 后果），不要改写历史条目。
- 提交前必跑：`npm run typecheck && npm run lint && npm run test`
- 类型错误不得用 `any` / `@ts-ignore` / 非空断言 `!` 绕过。数据可能缺失是常态，用类型表达而不是骗编译器。
- 注释解释**为什么**，不解释**做了什么**。

## 数据质量红线（违反即 bug）

1. **历史缺失绝不填零。** 缺失即 `null`，由类型强制。`0` 是有效值（真实为零），`null` 是无数据。
2. **采集失败不得覆盖上一份有效快照。** 快照原子提升，失败即保持原状并置 `stale`。
3. **时间一律 UTC** 存储与传输（epoch 秒或 ISO-8601 带 `Z`），禁止本地时区字符串。
4. **每份数据必须同时记录 `sourceTime`（来源时间）与 `ingestedAt`（采集时间）**，二者不可混淆。
5. **同名指标来源不同，口径默认不一致。** 切换适配器必须过 `assertContractCompatible` 口径检查，禁止静默替换。
6. **实体标签（交易所 / 巨鲸 / 矿池 / 矿工）不是事实，是启发式标注。** 未经验证不得给出精确定义，详见 `docs/METRIC_AUTHORING.md` §标签可信度。
7. 付费适配器不得作为免 key 路径的**隐式依赖**；未配置 key 时必须降级而非报错。

## 视觉红线

只用灰阶（zinc/neutral）。**不用阴影、不用胶囊圆角、不用彩色按钮、不用渐变。**
层级靠字重与间距，不靠装饰。元信息（时间、来源、数值单位）用等宽字体。
首页是极简文字列表，**不要做成卡片墙，不要加迷你走势图**。

## 常用命令

```bash
npm run dev            # 启动 web 开发服务器
npm run ingest:btc     # 抓取 BTC 指标（Phase 1 前为 dry-run 模式）
npm run db:init        # 初始化 SQLite schema
npm run db:reset       # 删库重建
npm run typecheck      # tsc --noEmit（全仓库）
npm run lint           # ESLint flat config
npm run test           # Vitest
```
