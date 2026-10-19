# 架构决策记录（ADR）

条目只追加不改写。若某条被推翻，写一条新 ADR 并在旧条目末尾标注 `Superseded by ADR-XXX`。

| ADR | 主题 | 状态 |
|---|---|---|
| [001](#adr-001) | 双语（中英） | 已定 |
| [002](#adr-002) | 先用免费数据源，预留付费适配层 | 已定 |
| [003](#adr-003) | GitHub Actions 抓取 | 已定 |
| [004](#adr-004) | 日更，不做实时 | 已定 |
| [005](#adr-005) | 首页极简文字列表 | 已定 |
| [006](#adr-006) | 指标注册表即代码 | 已定 |
| [007](#adr-007) | 用 node:sqlite，不用 better-sqlite3 | 已定 |
| [008](#adr-008) | 自建 i18n，不用 next-intl | 已定 |

---

## ADR-001 双语（中英）

**背景** 站点面向公众，需覆盖中英文读者。
**决策** 路由 `/en`、`/zh`；`MetricDefinition` 的 name/description/methodology 均为 `{ en, zh }`。
**后果** 每个指标文案成本翻倍，漏一种语言会被自检清单拦下。中文需 Noto Sans SC，
且中文无 Inter 式字重变化，视觉层级需单独调（Phase 3）。

## ADR-002 先用免费数据源，预留付费适配层

**背景** 实测 Coin Metrics 免 key 接口把 `FeeTotUSD`/`RevUSD`/`NVTAdj` 等美元费用指标整族锁在 403 墙后。
**决策** MVP 只用免 key 源，原生单位为主，美元值由自抓 `PriceUSD` 换算。
`SourceAdapter` 从第一天就带 `auth: 'none' | 'apiKey'`，付费实现作为并行 adapter 存在，
仅在配置 key 时启用；指标定义带 `fallback`，付费源缺失时自动降级到免 key 源。
**后果** NVT 等经典指标不进 MVP。未配置 key 时行为与纯免 key 方案一致，不构成隐藏依赖。

## ADR-003 GitHub Actions 抓取

**背景** 抓取需要定时触发，第一版不想维护服务器。
**决策** `.github/workflows/ingest.yml`，`schedule` 日更 + `workflow_dispatch` 手动补数。
**后果** 抓取器保持宿主无关（就是一个 Node 脚本），后续迁到个人建站不用改代码。
GitHub cron 可能延迟数分钟，对日更场景无影响。

## ADR-004 日更，不做实时

**背景** 用户明确表示实时性要求不高，日更足够。
**决策** 全站每日一个快照。无轮询、无 SSE、无 WebSocket、无客户端刷新。
**后果** 这是最大的简化来源：没有数据过期竞态，页面在任意时刻都是一致的静止快照。
"更新时间"语义清晰。代价是价格等快变指标最长滞后 24h，需在页面明示。

## ADR-005 首页极简文字列表

**背景** 在 leerob 风格的两种密度中，用户选择极简文字列表（阅读器观感）。
**决策** 首页为分类 + 一行一条的指标列表，不做卡片、不做阴影、不加迷你走势图。
图表只出现在详情页，用 lightweight-charts 按需加载。
**后果** 移除了整套 sparkline 组件。首页更安静，信息密度低于专业数据终端，
但与"简洁克制"的定位一致。

## ADR-006 指标注册表即代码

**背景** 本质是一张由数据驱动的指标表；未来要加 ETH/SOL。
**决策** 每个指标是 `packages/metrics` 中的声明式定义对象，首页/详情/图表/来源链接全由它渲染。
**加 ETH/SOL 的成本 = 新增定义 + 新增 source adapter，页面层零改动。**
`packages/metrics` 是唯一事实源，三包都依赖它；web 不依赖 ingest，ingest 不感知 web。
**后果** 这是整个扩展性的唯一支点。硬编码指标列表被 CLAUDE.md 列为 bug。

## ADR-007 用 node:sqlite，不用 better-sqlite3

**背景** 原计划用 better-sqlite3，需要原生编译或预编译二进制，增加安装失败面。
**决策** 用 Node 内置 `node:sqlite`（Node 22.5+ 已提供，本机 22.23 实测可用）。
**后果** 零原生依赖，安装更稳。代价是该模块在 Node 22 上仍是实验特性（会打印警告），
API 可能在小版本间变化；若未来升级出问题，需评估迁移路径。
如需静音警告用 `NODE_OPTIONS=--no-warnings`，不要改代码绕过。

## ADR-008 自建 i18n，不用 next-intl

**背景** 只有两种语言，需要 locale 协商与切换。
**决策** 自建 middleware + 字典（约 60 行），不引入 next-intl。
**后果** 依赖更少，完全可控。代价是 hreflang、SEO alternates 需自己处理（Phase 4）。
若日后要接第三语言或需要更复杂的 locale 路由，换库的改动面仅限 middleware 一处。

## ADR-009 详情页图表手写 SVG，不用 lightweight-charts

**背景** PLAN §Phase 3 原写"详情页用 lightweight-charts"。Phase 1 实现时改成了服务端渲染的 SVG 折线图。
**背景（补充）** lightweight-charts 是 ~50 KB 的客户端库，必须 `use client` + 动态导入，
而页面是构建期静态生成的日更快照（ADR-004）——把 400 个点交给浏览器重画，
收益只有"悬停 tooltip / 缩放"两项；灰阶极简视觉下这两项本来就不该做成彩色十字线。
**决策** 图表改为服务端渲染的内联 SVG：纯函数，输入点数组，输出 `<path>` 与刻度文本。
`null` 点处断线而不是连过去（缺失不是零，见数据红线 1）。
**后果** 详情页 HTML 里就带着图，首屏无 JS 依赖，图表零客户端 JS。
代价是失去交互式缩放与 tooltip——若日后要做，接受"加回一个轻量交互层"的重做成本，
而不是现在就为两个交互项引入 50 KB 与 `use client`。
**对 ADR-005 的修正** ADR-005 中"用 lightweight-charts 按需加载"一句以本 ADR 为准。

## ADR-010 Fixture 与真实数据物理隔离

**背景** Phase 1 需要页面与图表跑起来，但此时还没有真实数据。
**决策** 三条同时生效，缺一条都不算数：
1. fixture 只能写进 `fixtures/btc`；写入路径若等于或位于 `public/data` 之下，生成器直接抛错；
2. 每份 fixture 文件带 `fixture: true`，页面读到就在顶部显示"非真实市场数据"告警条；
3. 数据目录由 `SIGNAL_DATA_DIR` 切换，页面代码路径完全相同——
   fixture 验证的就是真实数据会走的那条路径，不存在"只在假数据下能跑"的分支。
**后果** 任何人都不会把合成数据误当成真实行情发布，也不需要靠人记着"这次是假的"。
发布前只需 `npm run ingest:btc` 覆盖 `public/data`，告警条自动消失。
**延伸** fixture 的时间戳、数量级与减半计划按真实协议生成（例如流通量用真实减半表累积、
矿工收入 = 当日补贴 × 144 块），保证跨指标自洽——否则页面上的矛盾会被当成代码 bug 排查半天。

## ADR-011 主题 token 走 `:root` + 媒体查询 + `@theme inline`，不做手动切换

**背景** Phase 3 要求把散落的 `zinc-300` / `dark:text-zinc-400` 收敛成语义 token，
并保证明暗两态真正生效。第一版把两套颜色都写进 `@theme`（暗色那套嵌在媒体查询里），
构建产物里暗色块只剩 `dark:` 工具类、`--color-ink` 全局只出现一次——**暗色主题看着配了，实际永远不生效**。
**背景（续）** 另一条被否掉的方案是加手动切换开关。
**决策** 一、灰阶取值放在 `:root`，暗色覆盖放在 `@media (prefers-color-scheme: dark) { :root { … } }`，
由 `@theme inline { --color-ink: var(--ink) }` 把语义名映射到变量。
二、**不提供手动主题开关**，明暗只跟随系统。
**后果** `inline` 让工具类在运行时解析 `var(--ink)`，媒体查询覆盖才真正起作用；
代价是构建产物里工具类多一层变量间接，且 `@theme` 里**不再允许**放任何需要明暗切换的值。
不加开关则意味着不存在主题闪烁（`prefers-color-scheme` 在首帧已确定），
代价是用户不能在"我这台机器强制浅色但我偏好深色"时手动纠正——对一个日更快照站，这个代价比收益小。
若日后加开关，变量都已在 `:root` 上，只需覆盖同一批变量，不动任何组件。
`apps/web/test/theme.test.ts` 对这条有专门的守卫断言。
完整视觉规范见 `docs/DESIGN.md`。

## ADR-012 视觉红线由源码文本测试守卫，而不是渲染测试

**背景** CLAUDE.md §视觉红线此前只靠人肉 review 守着。
破防之后没有任何运行时报错，页面会静悄悄地变成"有点蓝的卡片墙"，而所有测试依然全绿。
**决策** 加 `apps/web/test/theme.test.ts`，直接读 `apps/web/src/**` 的源码文本，
断言不出现 `zinc-NNN`、`shadow*`、`gradient`、`rounded-full|2xl|3xl|xl`、Tailwind 彩色调色板类，
并断言暗色覆盖位于媒体查询的 `:root` 而非 `@theme`。
**后果** 视觉层第一次有了会红的守卫。代价是它管不了"class 用对了但位置用错了"——
本站构建期静态生成，没有浏览器运行时可挂，源码文本是唯一稳定的断言面。
若日后引入 Playwright 做视觉回归，本 ADR 以那时的渲染测试为准；两者不冲突。
守卫自身也做过变异验证（把 `text-ink` 改成 `text-zinc-900` 会立刻失败并指出文件与色阶）。

## ADR-013 依赖审计：记录风险评估，Phase 4 不做 major 升级

**背景** `npm audit` 报 5 条：2 critical（`tinypool` 原型污染 → RCE，经 `vitest` 传递）、
2 moderate（`@vitest/mocker` 路径穿越，同样经 `vitest`）、1 high（`postcss` 四个问题，经 `next` 传递）。
`npm audit fix --dry-run` 确认**没有非破坏性修复**：要清掉它们必须升 `vitest` 3 → 5 与 `next` 15 → 16。
**决策** Phase 4 不做这两个 major 升级，改为逐条评估并写进本 ADR。
**评估** 两条 critical 全部位于 `node_modules/tinypool`，只在 Vitest 的 worker 池里运行——
测试进程，不进入构建产物，也不参与任何线上请求；触发条件是攻击者能控制传给 `run()` 的
worker options，本仓库的 `vitest.config.ts` 全部为字面量，无外部输入。
`postcss` 的 high 只在构建期处理 CSS 时生效，而 CSS 全部是第一方源码，
产物里也不含 postcss。**没有一条落在运行时依赖路径上**（站点是纯静态 HTML + CSS）。
**后果** 接受"审计面板上永远有红字"这个状态，代价是失去了 `audit` 作为门禁的意义——
所以在 CI 里**不**加 `npm audit --audit-level=high`，那会天天红，且红的原因与用户无关。
若日后升级 `next` 或 `vitest` 大版本，这 5 条应当作为验收项重新核对，并顺带验证
`@theme inline` 主题结构、`next/og` 与 `node:sqlite` 三处在新版本下的行为（它们都依赖具体版本的实现细节）。
