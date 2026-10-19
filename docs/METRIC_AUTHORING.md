# 指标编写规范

新增一个指标的**唯一权威流程**。字段的机器可读定义在 `packages/metrics/src/types.ts`，
本文说明**为什么**这些字段必须存在、以及填值的判断标准。两者冲突时以 types.ts 为准并回头修本文。

---

## 流程

1. 在 `packages/ingest/src/sources/` 确认所需数据源已有 adapter；没有则先写 adapter（见下方 §数据源）
2. 在 `packages/metrics/src/definitions/<asset>/` 写 `defineMetric({...})`，中英双语四项文案齐全
3. 在 `registry.ts` 注册
4. `npm run ingest:btc` 跑一次，确认 `stale !== true` 且有值
5. 过下面的**提交前自检清单**

---

## 必填字段

| 字段 | 要求 | 常见错误 |
|---|---|---|
| `id` | 全局唯一，小写连字符 | 与其他指标重名 |
| `asset` | `btc` \| `eth` \| `sol` | 写死成字符串字面量而非联合类型 |
| `category` | 四个固定分类之一 | 新造分类导致首页分组失控 |
| `name` | `{ en, zh }` 齐全 | 只写一种语言 |
| `description` | `{ en, zh }`，回答"这个数说明了什么" | 复述指标名，毫无信息量 |
| `methodology` | `{ en, zh }`，**计算公式本身**，不是公式的名字 | 写"见官方文档" |
| `unit` | 见 §单位 | 用 `number` 一笔带过 |
| `frequency` | `1d`（MVP 全部日频） | 写成实际抓取频率 |
| `sources` | 数组，每项含 `provider` + `metric` + `labelConfidence` | 不写来源，用户无法判断可信度 |
| `history` | 可得历史起点与覆盖说明 | 假设有无限历史 |
| `missingPolicy` | 缺失时**如何处理**，见 §缺失值 | 留空（等于默认填零） |
| `format` | 数值格式化规则 | 统一用千分位，导致 0.012 BTC 显示成 "0" |

---

## 单位

`unit` 用受控字符串，不是自由文本。已定义：

| unit | 含义 | 展示 |
|---|---|---|
| `btc` | BTC 数量 | 最多 4 位小数 + `BTC` |
| `usd` | 美元 | `$` + 整数千分位 |
| `count` | 无量纲计数 | 千分位整数 |
| `hashrate` | H/s | 自动单位（EH/s / ZH/s） |
| `percent` | 0–100 | 1 位小数 + `%` |
| `sat_per_vbyte` | 聪/虚拟字节 | 整数 |
| `index` | 相对值（HHI 等） | 2 位小数 |
| `blocks` | 区块数 | 整数 + `blocks` |

**换算必须在派生层做并注明。** 例如美元费用由 `PriceUSD × FeeTotNtv` 得到时，
`methodology` 里必须写出这个乘式，不能只说"美元手续费"。

---

## 口径一致性（最重要的一条）

> **同名指标在不同数据源下不保证口径一致。切换数据源 ≠ 换个地方取数。**

每个 adapter 在取数前必须声明它对该指标产出的**语义契约**（`MetricContract`）：

```ts
{ unit, scale, aggregation, window, labelSemantics }
```

| 契约项 | 说明 | 例子 |
|---|---|---|
| `unit` | 单位 | `btc` vs `sats`（差 1e8） |
| `scale` | 数量级 | `1e-8` 换算 |
| `aggregation` | 区间聚合方式 | `sum` vs `mean` vs `last` |
| `window` | 时间窗 | 自然日 UTC vs 滚动 24h vs 区块 144 |
| `labelSemantics` | 实体标注口径 | 见下节 |

`assertContractCompatible(expected, actual)` 在每次切换或新增适配器时执行，
不一致**抛错中止**，不允许"先跑起来再说"。

---

## 标签可信度

交易所、巨鲸、矿池、矿工这类**实体标签是启发式标注，不是链上事实**。
不同数据商的聚类算法、交易所地址表、更新频率都不同。

每个来源必须声明 `labelConfidence`：

| 值 | 含义 | 允许的表述 |
|---|---|---|
| `verified` | 地址归属有明确依据 | 可陈述定义 |
| `heuristic` | 聚类推断，可能有误 | **只能**表述为"数据源标注的…"，禁止给精确定义 |
| `unknown` | 不清楚 | 不出现在页面上 |

**硬性规则：`labelConfidence !== 'verified'` 时，`methodology` 里禁止出现
"指"、"即"、"定义为" 这类下定义式的表述。** 只能写"按 X 数据源的标注口径统计"。

页面上凡展示实体标签的指标，必须能看到该置信度。

---

## 缺失值

三种情况，**三种不同的处理**，不可混用：

| 情况 | 处理 |
|---|---|
| 上游没给这个时间点的数据 | 存 `null`，前端断线显示，**绝不填 0** |
| 数据源当天尚未结算 | 存 `null`，并置 `stale: true`，页面显示"待更新" |
| 该指标在此源上永久没有（付费墙） | 不定义该指标 |

`0` 是有效数据（例如某天净流入恰好为零），`null` 才是缺失。类型层面区分这两者。

---

## 历史口径

- 免费源通常只给近数月至数年历史。**必须**在 `history` 里写明可得起点
- 源若会**重算历史值**（如活跃地址数的聚类算法更新），页面需标注口径可能变化
- 派生指标的历史依赖多个源；任一源缺历史，该点即为 `null`，不做外推

---

## 提交前自检清单

- [ ] `id` 唯一，`asset`/`category` 合法
- [ ] 四项文案（name/description/methodology）**中英双语**齐全
- [ ] `methodology` 写出了**公式本身**，换算步骤写明
- [ ] `unit` 用受控字符串；换算有注释说明来源
- [ ] `sources` 每项都有 `labelConfidence`；非 `verified` 的标签没有下定义式表述
- [ ] `missingPolicy` 明确，代码里没有任何填零逻辑
- [ ] adapter 声明了 `contract`，并通过 `assertContractCompatible`
- [ ] `history` 写明可得起点
- [ ] 跑通 `npm run ingest:btc` 后 `stale !== true` 且有真实值
- [ ] 断网重跑**不会破坏**已有快照（验证快照不可覆盖）
- [ ] `npm run typecheck && npm run lint && npm run test` 全绿
