# Signal — MVP 规划

> 面向公众的加密资产市场与链上指标目录与监控网站。
> 阶段一仅 BTC，架构预留 ETH / SOL。
>
> 状态：**Phase 0–4 已完成**（骨架 / 规范 / 适配器接口；18 个指标定义 + 静态页面；真实免费源抓取已跑通；
> 视觉规范落地；自动化与 SEO 就绪）。
> Phase 5（上线）待你批准，本轮任务明确不部署。
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
> 实际实现中第 4 个为 `price-change-7d`，见 §6 Phase 1 的偏差记录。

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
| ↑ 实际实现为 `recommended-fee-rate`（推荐费率），理由见 §6 Phase 1 偏差记录 2 | | |
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

### Phase 1 — 指标注册表 + 静态内容（1.5 天）✅ 已完成 2026-10-19
实现 `MetricDefinition` 与 registry；用**假数据**写全 18 个指标定义（中英双语文案齐全）；首页列表与详情页骨架
**验收**：首页 18 行分类正确；详情页展示解释、计算逻辑、来源；切换 `/zh` 全站文案随之切换
*此阶段不碰网络，先把内容形态与双语体系定死*

**实际交付**
- 18 个指标定义（market 4 / onchain 5 / fees 5 / mining 4），每条含中英双语名称、说明、计算逻辑、历史口径备注，
  并通过 `validateMetric` 的机器自检（双语齐全、来源非空、口径自洽、派生依赖完整）。
- `/[locale]` 下的首页与 `/[locale]/metrics/[id]` 详情页，**构建期全静态生成**：2 个语言 × (1 + 18) = 38 页 + 404。
  详情页含服务端渲染的 SVG 历史曲线（ADR-009）。
- 数据来自 `fixtures/btc`（`SIGNAL_DATA_DIR` 切换），带 `fixture: true` 标记，页面顶部显示"非真实市场数据"告警条。
  fixture 生成器拒绝写入 `public/data`（ADR-010）。
- 时间显示一律显式 `YYYY-MM-DD[ HH:mm]` UTC，不用 locale 相关的 `Intl.DateTimeFormat`：
  同一个 UTC 日在不同 locale 下会渲染成三种写法，读者无法确认两处时间是否同一天。

**与本文档的偏差（记录在案）**
1. `price-at-hash` → **`price-change-7d`**。原文案描述的是一个需要哈希率做分母的派生指标，
   但免费源拿不到稳定的历史哈希率日频序列，算出来的是一条假曲线。改为 7 日价格变化：
   数据源直给价格、本地做日历日对齐的百分比变化，口径可验证，且对读者更有用。
2. `mempool-congestion` → **`recommended-fee-rate`**。mempool.space 的 `/fees/recommended`
   返回的是 `hourFee`——一个**推荐费率**，不是拥堵度指标（拥堵度需要全网算力与难度的比值，
   免费源拿不到）。按数据源实际给的数字命名，而不是给它安一个它没有测量的名字。
3. 详情页图表不用 lightweight-charts，改为服务端渲染 SVG（ADR-009）。

### Phase 2 — 抓取管线（2 天）✅ 已完成 2026-10-19
4 个 source adapter（`auth` 字段就位）+ 幂等 upsert + 容错；BTC runner 跑通 §4.4 白名单内 13 个指标；派生计算（净流入、矿池 HHI/Top3）；`export` 产出 JSON
**验收**：`npm run ingest:btc` 后 18 项全部有真实值与更新时间；删库重跑结果一致

**实际交付**：`npm run ingest:btc --workspace @slowmoonship/ingest -- --live` 一次跑通 18/18，
`public/data` 全部为真实数据（价格 $81,935、流通量 20,100,129 BTC、市值 $1.647T，
三者互洽：价格 × 流通量 = 市值，误差 0）。页面的 fixture 告警条随之消失。

- **Blockstream 适配器**：`difficulty` / `block-tx-count` / `block-weight` 三个指标来自同一个链尖区块
  （两次请求：先 `/api/blocks/tip/hash`，再 `/api/block/{hash}`）。
  注意 `/api/block/tip` 在 blockstream 上**不存在**（那是 mempool 的路径），Phase 0 的定义里写错过。
- **矿池集中度**：`/api/v1/mining/pools/1m` 只给**出块数**，不是算力；文案已按实际口径改为"出块份额"。
  HHI 由 Signal 本地算出（`computedLocally`），页面如实标注"由 Signal 计算"而非"数据源直接给出"。
- **runner 三条取数路径**：直接取（含 fallback）、差值派生、百分比派生。
  fallback 只在口径检查通过后发生，并把实际来源写进快照；口径不兼容一律整体失败，不静默换源。
- **失败也发布**：抓取失败时重新发布上一份有效快照并带上 `stale` 与失败原因——
  否则站点会一直显示一份"看起来是今天"的旧数据。

**过程中发现并修掉的数据缺陷**（都已加测试或值域守卫）
1. **Coin Metrics `HashRate` 以 TH/s 发布**（实测约 1e9），直接当 H/s 用会让"全网算力"显示成 1.1 TH/s，
   比真实值差 1e12。已在适配器换算（×10¹²）并加物理上限守卫；
   同时修掉 `formatHashRate` 单位阶梯漏级的问题（缺 GH 一级，1.1e9 会被标成 TH/s）。
2. **`block-weight` 的上游指标名写成了 `blockstream.BlockTxCount`**（笔误），会把交易笔数当区块权重发布。
3. **净流入的百分比变化无意义**：从 +837 变成 −163 算出来是 −119%。
   新增 `canBeNegative`，这类指标一律不展示"较 N 天前变化"。
4. 难度、币种数、矿池集中度等"每天只采样一次"的指标，页面原本会显示一个空的"7 日变化"标签。

### Phase 3 — 视觉与主题（1.5 天）✅ 已完成 2026-10-19
DESIGN.md token 落地（zinc 灰阶、无阴影、无胶囊、字重驱动层级、mono 元信息）；明暗主题无闪烁；详情页 lightweight-charts；中文排版微调；移动端与键盘可达性
**验收**：明暗两态与 leerob 观感一致；中英文长文本均无溢出

**实际交付**：`docs/DESIGN.md`（token、字体、排版层级、移动端与键盘）；`globals.css` 的
`:root` + 媒体查询 + `@theme inline` 三段主题；`next/font` 接入 Inter + Noto Sans SC；
首页行与详情页数值在 320px 竖排；跳过导航链接与 `:focus-visible` 焦点环；
`apps/web/test/theme.test.ts` 8 条守卫（视觉红线第一次会红）。

**与原计划的偏离**：
1. **图表不是 lightweight-charts**，是手写服务端 SVG（ADR-009 已在 Phase 1 修正，
   本阶段只是落实）；静态日更快照用不上 50 KB 客户端 JS。
2. **不提供手动主题切换开关**（ADR-011）。加开关就要在首帧前注入脚本防闪烁，
   而 `prefers-color-scheme` 在首帧已确定，闪烁本就不存在。
3. **`--font-mono` 未打包 web 字体**：元信息全是数字与短标签，系统等宽足够。

**踩到的坑**（值得记，因为它看起来像"配好了"）：
第一版把明暗两套颜色都写进 `@theme`，暗色那套嵌在媒体查询里。构建产物中暗色块只剩
`dark:` 工具类，`--color-ink` 全局只出现一次——Tailwind v4 的 `@theme` 只在**构建期**求值，
`text-ink` 早被编译成固定浅色十六进制，暗色主题永远不会生效。
必须用 `@theme inline` 让工具类在运行时解析 `var(--ink)`。现已有测试专门守这一点。

**未覆盖的验收项**："与 leerob 观感一致"依赖人眼。本机没有可用的无头浏览器
（无 chromium / playwright），因此明暗两态、320px 排版是**按 CSS 推导 + 构建产物核对**确认的，
没有截图佐证。若日后引入 Playwright，值得补一轮真正的渲染验收。

### Phase 4 — 自动化（1 天）✅ 已完成 2026-10-20
GitHub Actions 日更 workflow（`schedule` + `workflow_dispatch`）；`stale` 状态与新鲜度文案；SEO 元信息、hreflang、OG 图；typecheck/lint 进 CI
**验收**：手动触发 workflow 完成抓取并提交数据变更

**实际交付**：
- `.github/workflows/ci.yml` —— Node 22（`node:sqlite` 需 ≥22.5.0，与根 `engines` 一致）、
  `npm ci` + typecheck / lint / test / `metrics:validate`，`contents: read`，同分支并发自动取消。
- `.github/workflows/ingest.yml` —— `cron: '17 6 * * *'`（错开整点峰值）+ `workflow_dispatch`，
  抓取 → 测试 → 仅在 `public/data` 真有变化时提交 → 推送。提交信息带抓取时刻与 stale 份数。
- stale 文案修正：**`Freshness` 原本复用 `noDataHint`（"尚未采集到任何快照"），这是错的**——
  stale 的前提恰恰是*有*一份快照，只是这次没抓到。说成"暂无数据"会让读者以为页面上什么都没有。
  新增 `staleExplanation`，并在大数值下方加告警条（新鲜度说明在页面更靠后，多数人只看数字就走了）。
- SEO：`sitemap.xml` / `robots.txt` / OG 图 / Twitter card，`metadataBase` 由 `SIGNAL_SITE_URL` 决定。

**踩到的坑**：
1. **`hreflang` 互指曾全是相对 URL**。Next 会把 `url` 相对 `metadataBase` 展开，
   却把 `alternates.languages` 原样输出，产物是 `<loc>https://…/en</loc>` 配
   `<xhtml:link href="/en">`——搜索引擎直接丢弃这条互指。已在 sitemap 里自己拼绝对地址，并加测试守住。
2. **workflow 提交步骤会在"当天没有 stale 指标"时反而失败**。
   `shell: bash` 带 `-o pipefail`，`grep -l` 零匹配退出 1，整条管道失败 → 提交不执行。
   已加 `|| true`，并在本机复现验证过（去掉守卫时退出码确实是 1）。
3. **CI 与测试 tsconfig 的模块解析模式不同**。`apps/web` 用 `bundler`（`@/x` 无扩展名），
   根 `tsconfig.test.json` 用 `NodeNext`（强制扩展名），同一份源码两边都过不了。
   路由文件统一写 `@/lib/site-url.js`，两套配置都能解析。

**依赖审计**：`npm audit` 的 5 条（2 critical / 2 moderate / 1 high）全部经 `vitest` / `next` 传递，
没有非破坏性修复。逐条评估见 **ADR-013**：无一条落在运行时依赖路径上（站点是纯静态产物），
因此本阶段不升级 `vitest` 3→5 与 `next` 15→16，也不把 `npm audit` 加进 CI 当门禁。

**未验证**：workflow 从未在真实 GitHub 上跑过（本仓库无 remote）。YAML 已验证可解析，
但 `actions/*` 版本、runner 环境、缓存与推送权限都需要你推上去之后才知道。

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

Phase 0–4 已执行完毕并各自提交。**Phase 1–4 的授权范围到此为止。**
Phase 5（域名与部署）**需你明确批准**，本轮任务明确不部署、不推送远程仓库，因此没有执行。

推上去之前你需要拍板的事（PLAN §8）：
1. 域名——它决定 `SIGNAL_SITE_URL`，也是 canonical / sitemap / OG 的前提；
2. GitHub 上主分支叫 `master` 还是 `main`——`.github/workflows/ci.yml` 目前按本地的 `master` 写；
3. 18 个指标的中英文术语表述是否需要你校对（尤其 `Whale` / `Exchange` / `Miner` 的口径）。
