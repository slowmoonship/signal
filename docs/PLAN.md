# Signal — MVP 规划

> 面向公众的加密资产市场与链上指标目录与监控网站。
> 阶段一仅 BTC，架构预留 ETH / SOL。
>
> 状态：**Phase 0 已完成**（骨架 / 规范 / 数据适配器接口），Phase 1 待批准。
> 本文所有数据源均已于 2026-10-19 从本机实测验证（见 §4）。
> 已确认决策见 §0 与 `docs/DECISIONS.md`。

---

## 0. 已确认的决策（2026-10-19）

| # | 决策 | 影响 |
|---|---|---|
| D1 | **中英双语** | 路由分 `/en` 与 `/zh`；引入 Noto Sans SC；每个指标两套文案 |
| D2 | **先用免 key 源，但 source adapter 预留付费层** | 适配器接口可插拔，日后加 key 不改上层 |
| D3 | **GitHub Actions 定时抓取**；后续个人建站 | 抓取器与站点解耦，任何 cron 宿主都能跑 |
| D4 | **日更即可，实时性要求低** | ⭐ 关键简化：全站无高频轮询、无实时推送 |
| D5 | **首页为极简文字列表**（RSS/阅读器观感） | 首页不做卡片、不做迷你曲线；图表只出现在详情页 |

> D4 带来的最大收益：整个系统的复杂度显著下降。没有 15 分钟轮询、没有数据过期竞态、没有实时闪烁，站点在任何时刻都是一个**静止但准确**的快照。这与"简洁克制"的定位高度一致。

---

## 1. 现状

| 项 | 情况 |
|---|---|
| 项目目录 `/home/alex/slowmoonship/signal` | **完全为空**，无 git 仓库，无任何文件 |
| Node.js | v22.23.3 ✅ |
| npm | 10.9.9 ✅（pnpm 未安装，registry 可达 1.2s） |
| Python / git | 3.12.3 / 2.43.0 ✅（尚未 `git init`） |
| 网络 | npm / GitHub / Google Fonts / **memspace / CoinMetrics / Blockstream / DefiLlama 均可达**；**Binance 系不可达**（地域限制） |
| 现存规范 | 无 CLAUDE.md、无父级配置 |

**结论：从零搭建，无历史包袱。**

---

## 2. MVP 范围

### 2.1 页面结构

```
/en  /zh                     首页：分类 + 极简文字指标列表（一行一条：名称 · 数值 · 变化 · 更新时间）
  └─ /[locale]/metrics/[id]  详情：解释 · 计算逻辑 · 数据来源 · 历史曲线 · 更新时间
```

首页形态参考阅读器列表，**无卡片、无阴影、无迷你走势图**：

```
On-chain Activity                            更新于 2026-10-19 08:00 UTC
  Active Addresses                  608,276      -1.2%
  Transaction Count                637,431      +3.8%
  Exchange Netflow                   +837 BTC    -4.1%
```

### 2.2 指标清单（MVP 共 18 个）

**A. 市场 Market（4）** — `price` `market-cap` `supply` `price-at-hash` 等

**B. 链上活动 On-chain（5）**

| ID | 名称 | 源指标 |
|---|---|---|
| `active-addresses` | 活跃地址数 | `AdrActCnt` |
| `tx-count` | 交易笔数 | `TxCnt` |
| `block-count` | 出块数 | `BlkCnt` |
| `exchange-netflow` ⚠️ | 交易所净流入 | `FlowInExNtv` − `FlowOutExNtv` |
| `exchange-balance` | 交易所持币量 | `SplyExNtv` |

**C. 费用与区块 Fees（5）**

| ID | 名称 | 源指标 |
|---|---|---|
| `fees-total` | 每日总手续费 | `FeeTotNtv` |
| `miner-revenue` | 矿工发行收入 | `IssTotNtv` |
| `mempool-congestion` | 内存池拥堵度 | mempool `/fees/recommended` |
| `block-tx-count` | 每区块交易笔数 | Blockstream `tx_count` |
| `block-weight` | 区块权重 | Blockstream `weight` |

**D. 算力与挖矿 Mining（4）**

| ID | 名称 | 源指标 |
|---|---|---|
| `hashrate` | 全网算力 | `HashRate` / mempool `/mining/hashrate/1y` |
| `difficulty` | 网络难度 | Blockstream `difficulty` + mempool 难度调整 |
| `pool-concentration` ⚠️ | 矿池集中度 | mempool `/mining/pools/1m` → HHI / Top3 |
| `miner-revenue-usd` | 矿工收入（美元） | `IssTotUSD` |

> ⚠️ = 本地派生计算，是"计算逻辑"栏目的展示样例。

### 2.3 明确排除

用户账户 / 收藏 / 告警推送 / 实时轮询 / 逐笔成交 / 衍生品情绪指标（Binance 实测不可达，见 §4.3）/ ETH 与 SOL 的任何指标。

---

## 3. 技术架构

### 3.1 核心设计：指标注册表即代码

站点的本质是「一张由数据驱动的指标表」。因此**不为每个指标写页面组件**，而是：

> 每个指标 = `packages/metrics` 里的一个**声明式定义对象**。首页、详情页、图表、来源链接、更新时间全部由它渲染。

```ts
export const activeAddresses = defineMetric({
  id: 'active-addresses',
  asset: 'btc',                 // ← 换 ETH/SOL 只改这里与新增定义
  category: 'onchain',
  name:        { en: 'Active Addresses', zh: '活跃地址数' },
  description: { en: '...',      zh: '...' },
  methodology: { en: '...',      zh: '...' },   // 计算逻辑，支持 Markdown + 公式
  unit: 'addresses',
  format: 'int',                // 数值格式化
  cadence: '1d',
  sources: [{ provider: 'coin-metrics', metric: 'AdrActCnt', auth: 'none' }],
  betterWhen: null,             // null = 中性，不染涨跌色
})
```

**加 ETH / SOL 的成本 = 新增一份定义 + 增加一个 source adapter，页面层零改动。** 这是本架构唯一必须守住的扩展缝。

### 3.2 技术选型

| 层 | 选择 | 理由 |
|---|---|---|
| 框架 | **Next.js 15（App Router）+ TypeScript** | 与 leerob 同源；D4 下全站静态化即可，SSG 足够 |
| 样式 | **Tailwind CSS v4** | 直接对应 leerob 的 zinc 灰阶 + dark mode 写法 |
| 图表 | **lightweight-charts**，**仅详情页** | D5 下首页无图，图表库只按需加载一处 |
| 首页 | **纯列表，无 SVG sparkline** | D5 决定，省掉一整套图表组件 |
| 数据存储 | **SQLite（`node:sqlite` 内置）** 事实源 → 导出 JSON | 零原生依赖，安装更稳（[ADR-007](DECISIONS.md#adr-007)） |
| 抓取 | **Node + tsx**，由 cron 调度 | 与前端同语言，单一工具链 |
| 字体 | `next/font/google`：Inter（拉丁）+ Noto Sans SC（中文） | 已实测 fonts.googleapis.com / gstatic 可达 |
| 包管理 | **npm** | 本机现成 |

### 3.3 数据流

```
  mempool.space ┐
 Coin Metrics  ├─→ packages/ingest ─→ data/signal.db ─→ export ─→ public/data/*.json
  Blockstream   │      (adapter 层)      (SQLite)                      │
  DefiLlama    ┘                                                          ▼
                                                          Next.js 构建时静态读取 → 页面
```

**关键决策：抓取在构建之外，页面只读静态 JSON。** D4 之后这条更站得住：数据本来就是"一天一个快照"，没有任何实时性要求。收益是前端不需要任何 API key、上游抖动不会导致 500、本地 `npm run dev` 断网也能跑。

### 3.4 国际化（D1）

- 路由：`/[locale]`，middleware 按 cookie → `Accept-Language` → 默认 `en` 做一次重定向
- 文案：`src/i18n/dictionaries.ts`，指标定义本身已带 `{ en, zh }`
- 组件不写死文案，一律走 `t()` 或直接从 metric 定义取
- SEO：`<html lang>` 随 locale 变，两个 `hreflang` 互指
- **不引入 next-intl**：仅两种语言，自建约 60 行足够；若日后要接第三语言再换库（换的只有 middleware 一处）

### 3.5 预留付费适配层（D2）

adapter 接口从第一天就区分 `auth: 'none' | 'apiKey'`：

```ts
interface SourceAdapter {
  provider: string
  supports(asset: Asset, metric: string, auth: AuthMode): boolean
  fetch(...): Promise<SeriesPoint[]>   // auth 由实现内部从 env 读取
}
```

免 key 实现永远可用；付费实现作为**并行 adapter** 存在，优先级更高，仅在配置了 key 时启用。指标定义里同时写 `fallback`，付费源缺失时自动降级到免 key 源——**加 key 不需要改页面，也不需要改抓取调度。**

---

## 4. 数据获取方案

### 4.1 实测方法

规划前对每个候选端点做了真实请求（2026-10-19），**只把实测通过的写进方案**。这一步发现网上大量教程引用的免费接口已经失效。

### 4.2 已验证可用的数据源

| 源 | 端点 | 实测 | 提供 |
|---|---|---|---|
| **Coin Metrics Community** | `community-api.coinmetrics.io/v4/timeseries/asset-metrics` | ✅ | 免 key 日频历史序列，指标最丰富 |
| mempool.space | `/api/blocks/tip/height` | ✅ | 区块高度 |
| mempool.space | `/api/v1/fees/recommended` | ✅ | 推荐费率 → 拥堵度 |
| mempool.space | `/api/v1/mining/pools/1m` | ✅ | 矿池分布 → 集中度 |
| mempool.space | `/api/v1/mining/hashrate/1y` | ✅ 365 点 | 日级算力历史 |
| mempool.space | `/api/v1/difficulty-adjustment` | ✅ | 难度、下次调整预估 |
| Blockstream | `/api/block/:hash` | ✅ | 单区块全量：difficulty / tx_count / weight / height |
| Blockstream | `/api/block-height/:h` | ✅ | hash ↔ 高度 |
| DefiLlama | `coins.llama.fi/prices/current`、`/chart` | ✅ | 实时价格 / 价格序列 |

> mempool 算力粒度实测：`1m`=30 点(小时)、`3m`=92 点、`1y`=365 点(日)、`all`=6499 点。注意 `1d` 与 `7d` 参数**被忽略**（返回全量）。日更场景取 `/1y` 落库最合适：25KB/次，且天然自愈——漏跑几天后下次仍能补齐。

### 4.3 已失效或被墙（**不要使用**）

| 端点 | 实测 | 说明 |
|---|---|---|
| `mempool.space/api/v1/charts/*` | ❌ 404 | 整组下线，改用 `/api/v1/mining/hashrate/:period` |
| `mempool.space/api/v1/mining/blocks/fees` | ❌ 500 | 服务端故障 |
| `blockstream.info/api/blocks/:h/stats`、`/api/mempool/stats` | ❌ 404 | 端点不存在 |
| `fapi.binance.com`（资金费率/未平仓量） | ❌ 超时 | **网络不可达**，衍生品指标需换源或搁置 |
| `api.llama.fi/coins` | ❌ 404 | 改用 `coins.llama.fi` |

### 4.4 Coin Metrics 免 key 白名单（实测）

关键风险：Community API 对部分指标返回 **403**。逐一实测结果：

- ✅ **可用**：`PriceUSD` `CapMrktCurUSD` `SplyCur` `SplyExNtv` `FlowInExNtv` `FlowOutExNtv` `AdrActCnt` `TxCnt` `BlkCnt` `IssTotNtv` `IssTotUSD` `FeeTotNtv` `HashRate`
- ❌ **需付费 key**：`FeeTotUSD` `FeeMeanNtv` `DiffMean` `RevUSD` `NVTAdj` `SplyAct1d` `TxTfrValAdjUSD` `BlkSizeMeanByte`

> ⚠️ **美元计价的费用类指标整族被锁**（`FeeTotUSD`/`FeeMeanNtv`/`RevUSD`/`NVTAdj`）。因此 D2 的方案落地为：MVP 只用原生单位（BTC / sats），美元值由我方自抓的 `PriceUSD` 换算，**不引用被锁的源**。经典指标 NVT 暂不进 MVP。

### 4.5 抓取调度与容错（D3 + D4）

- **频率：每日一次**，GitHub Actions `schedule: cron`（建议 UTC 06:00，避开整点拥塞）
- 手动触发 `workflow_dispatch`，用于补数据与调试
- 容错：指数退避重试 3 次；单指标失败**不阻塞整批**；连续失败置 `stale: true`，首页该行显示"数据可能滞后"而非假装正常
- 幂等：按 `metric_id + ts` 主键 upsert，重跑安全；漏跑数日后下次运行自动补齐历史

---

## 5. 目录结构

```
signal/
├── CLAUDE.md                  # 项目级开发规范（§7）
├── README.md
├── package.json               # npm workspaces 根
├── docs/
│   ├── PLAN.md                # 本文
│   ├── ARCHITECTURE.md        # 架构与数据流详解
│   ├── METRIC_AUTHORING.md    # ★ 如何新增一个指标（最重要）
│   ├── DESIGN.md              # 视觉规范（leerob 风格 token）
│   └── DECISIONS.md           # ADR 记录（ADR-001 ~ 008）
├── packages/
│   ├── metrics/               # 共享：类型 + 指标注册表 + 派生计算
│   │   └── src/
│   │       ├── types.ts       # MetricDefinition / SeriesPoint / SourceAdapter
│   │       ├── registry.ts    # 按 asset+category 聚合
│   │       ├── derive.ts      # 净流入、集中度等派生函数
│   │       └── definitions/{btc,eth}/…   # eth/ 留占位
│   └── ingest/                # 抓取 + 落库 + 导出
│       └── src/
│           ├── sources/       # coin-metrics.ts mempool.ts blockstream.ts llamaprice.ts
│           ├── runners/       # btc.ts  ← eth.ts / sol.ts 未来在此平行添加
│           ├── db.ts          # SQLite schema + upsert
│           └── export.ts      # SQLite → public/data/*.json
├── apps/web/                  # Next.js
│   └── src/
│       ├── middleware.ts      # locale 协商与重定向
│       ├── i18n/dictionaries.ts
│       ├── app/[locale]/
│       │   ├── page.tsx       # 首页：分类 + 极简列表
│       │   ├── metrics/[id]/page.tsx
│       │   └── components/    # MetricRow / MetricChart / SourceBadge / Freshness
│       └── ...
├── data/signal.db             # SQLite（.gitignore；只提交导出的 JSON）
├── public/data/*.json          # 提交进 git，前端构建直接读
└── .github/workflows/ingest.yml
```

**原则：`packages/metrics` 是唯一事实源。** web 只 import 它，ingest 只消费它。任何一方硬编码指标列表都是 bug——这是扩展性的全部保障。

---

## 6. 实施计划

因 D4/D5 砍掉了实时性与首页图表组件，整体比初版更短。Phase 0–4 全程本地可验收，不涉及线上部署。

### Phase 0 — 骨架（0.5 天）
`git init`、npm workspaces 三包、Next.js + Tailwind v4 + TS 打通；SQLite schema 与 `defineMetric` 类型定稿；`middleware` 语言协商
**验收**：`npm run dev` 起站点，`npm run db:init` 成功

### Phase 1 — 指标注册表 + 静态内容（1.5 天）
实现 `MetricDefinition` 与 registry；用**假数据**写全 18 个指标定义（中英双语文案齐全）；首页列表与详情页骨架
**验收**：首页 18 行分类正确；详情页展示解释、计算逻辑、来源；切换 `/zh` 全站文案随之切换
*此阶段不碰网络，先把内容形态与双语体系定死*

### Phase 2 — 抓取管线（2 天）
4 个 source adapter（`auth` 字段就位）+ 幂等 upsert + 容错；BTC runner 跑通 §4.4 白名单内 13 个指标；派生计算（净流入、矿池 HHI/Top3）；`export` 产出 JSON
**验收**：`npm run ingest:btc` 后 18 项全部有真实值与更新时间；删库重跑结果一致

### Phase 3 — 视觉与主题（1.5 天）
DESIGN.md token 落地（zinc 灰阶、无阴影、无胶囊、字重驱动层级、mono 元信息）；明暗主题无闪烁；详情页 lightweight-charts；中文排版微调；移动端与键盘可达性
**验收**：明暗两态与 leerob 观感一致；中英文长文本均无溢出

### Phase 4 — 自动化（1 天）
GitHub Actions 日更 workflow（`schedule` + `workflow_dispatch`）；`stale` 状态与新鲜度文案；SEO 元信息、hreflang、OG 图；typecheck/lint 进 CI
**验收**：手动触发 workflow 完成抓取并提交数据变更

### Phase 5 — 上线（待批准）
域名与部署。**本阶段需你明确批准后才启动**（当前任务明确要求不部署）。按 D3，第一版在 GitHub Actions 跑，后续可平滑迁到个人建站。

**合计约 6 个工作日**（Phase 0–4）。

---

## 7. 项目级开发规范建议

分四层，成本递增、收益递减：

### 7.1 `CLAUDE.md`（根目录，最高优先级）
这是**我每次会话自动读取**的文件，也是未来 AI 协作者的入口。控制在 100 行内：

- 一句话定位 + §0 已确认决策（防止后来的会话推翻你的拍板）
- 三包职责与依赖方向：`web → metrics ← ingest`，**禁止反向依赖**
- 硬性约束：指标只能经 `defineMetric` 定义；组件不得硬编码指标名；web 层不得直连外部 API；任何文案必须双语
- 常用命令：`dev` / `ingest:btc` / `db:reset` / `typecheck` / `lint`
- 视觉红线：不用阴影、不用胶囊圆角、不用彩色按钮、只用灰阶
- 提交前必跑 `npm run typecheck && npm run lint`

### 7.2 `docs/METRIC_AUTHORING.md`（投入产出比最高）
新增指标的**唯一权威流程**：加 adapter → 写 `defineMetric`（含双语四段文案）→ 跑 ingest → 注册 → 自检 checklist。做成 checklist 能显著降低加 ETH/SOL 的成本与出错率。

### 7.3 机器可执行的约束
typecheck + ESLint 进 CI 且 PR 必须通过；约定式提交（`feat:`/`fix:`/`docs:`/`chore:`）；`.claude/settings.json` 预授权只读命令以减少确认摩擦。

### 7.4 决策记录
`docs/DECISIONS.md` 用 ADR 格式记"为什么日更""为什么不用 next-intl"等。§0 的 D1–D5 就是它的种子。

**建议优先级**：7.1 → 7.2 → 7.3 → 7.4。

---

## 8. 仍待确认

以下不影响开工，但需要你后续拍板：

1. **双语默认语言与 URL 形态**：`/` 默认跳 `/en` 还是 `/zh`？是否需要 `/` 作为不带前缀的英文版以利 SEO？建议默认 `en`、前缀式 `/zh`、`/en`。
2. **域名**：第一版用什么？（GitHub Pages 子域 or 自有域名）——影响 Phase 4 的 basePath 配置。
3. **历史数据深度**：Coin Metrics 免费档通常只给近数月至数年。是否接受详情页曲线**只回溯到可得起点**，并在页面上标注"数据自 X 起可得"？建议接受并显式标注。
4. **指标文案由谁定稿**：18 个指标的中英文解释与计算逻辑，我可以基于数据源官方文档起草，但**术语表述需要你校对**（尤其 `Whale`/`Exchange`/`Miner` 这类标签的界定口径）。

---

## 下一步

`CLAUDE.md` / `docs/METRIC_AUTHORING.md` / `docs/DECISIONS.md` 已落地，Phase 0 已执行完毕。
下一阶段为 Phase 1（指标注册表 + 静态内容），待批准后开始。
`docs/DESIGN.md` 在 Phase 3 前编写即可。
