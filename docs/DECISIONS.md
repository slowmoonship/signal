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
