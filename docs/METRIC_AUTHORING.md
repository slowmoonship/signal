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
| `category` | 六个固定分类之一 | 新造分类导致首页分组失控 |
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
| `days` | 天数 | 整数 + `days` |

**分类只有这六个**（`MetricCategory`）：`market`（市场）、`onchain`（链上活动）、
`exchange`（交易所·持仓）、`fees`（费用与区块）、`mining`（矿工·安全）、
`valuation`（估值·周期）。新增分类要同时改 `types.ts` 的联合、
`METRIC_CATEGORIES` 数组、`apps/web/src/lib/categories.ts` 的 `CATEGORY_TINT`
（少改任何一处都会编译失败），并在 `globals.css` 里补一对明暗 token。

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

## 派生指标

派生不是"减一下"那么简单。`Derivation` 联合里目前有三种，它们分属两类：

| kind | 引入假设吗 | 说明 |
|---|---|---|
| `difference` | 否 | 两条序列相减，语义由两条上游的 `contract` 决定 |
| `percentChange` | 否 | 相对基期的百分比变化 |
| `dcaMaxWait` | **是** | 枚举起点 + 逐日推进 + 首次越过阈值 |

前两种只是把上游的数直接组合，读者可以自己用两条上游序列复算。
第三种**内嵌了模型**：每天投多少、窗口多长、阈值多少、份额怎么处理。
因此：

1. **`methodology` 必须逐条写明算法**，不能只写结论。
   例（定投等待期）：每天按当日公布价买入 1 美元，允许持有小数份额；
   第 k 天收益率为 `shares × price / (k + 1) − 1`；首次超过 +5% 的那天即该起始日的等待天数。
2. **`history.mayBeRevised` 几乎必然为 `true`**。窗口每日前移一格，
   "最坏的那个起点"可能整体换人，同一根柱子下"哪一天开始投"这个答案会被后加入的数据改写。
3. **删失必须以类型披露**。枚举型派生（"对每个起点求一个值，再取极值"）里，
   有些起点在窗口内**永远达不到阈值**——它们是右删失观测，不是"零天"。
   把它们悄悄剔除会让极值显得比实际更乐观，而被剔掉的恰恰是最悲观的那批。

   披露方式是 `ObservationCoverage`：

   ```ts
   export type ObservationCoverage = {
     included: number     // 确实在窗口内达到阈值的起点数
     censored: number     // 右删失：窗口内始终未达到阈值的起点数
     invalidated: number  // 作废：路径上穿过缺价日，根本无法定价
   }
   ```

   **三桶之和恒等于窗口长度**（按日历日的起点个数）。
   缺价不是"删失"：删失是"算出来了，没达标"，作废是"算不出来"。
   把两者并成一个数，读者就分不清"没回本"和"算不了"，
   而这两件事对结论的影响完全不同——一个是悲观观测，一个是数据缺陷。

   它挂在 `MetricSnapshot.coverage` 上，随快照一起发布，页面必须显示。
   存进 SQLite 时落在 `coverage_json` 列；`CREATE TABLE IF NOT EXISTS`
   对已存在的表是空操作，所以 `store/db.ts` 里有 `ensureCoverageColumn` 迁移。

4. **极值必须配分布**。头条数字是**最大值**，天然极端；
   读者看到"最长 340 天"，合理的问题是"那典型的一天呢"。
   枚举型派生要一并输出 `DcaDistribution`（count / min / p50 / p90 / p99 / max，
   **就近排名，不插值**），随快照一起发布，详情页与首页覆盖率同屏可见。

5. **标注回测里最坏的那条路径**。`DcaWaitResult.worstCase` 给出起点日、首次达标日、
   路径最大回撤，页面上的高亮区间**必须直接用它**，不在前端另算一遍。

**`checkDerivation` 会替你拦住这些坑**：`windowDays` 必须是正整数、
阈值必须大于 −100（否则指标永远没有值）、`deriveFrom` 必须包含 `base`、
基准序列必须是日频（否则"第 k 天"在日历上没有意义）。

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
- [ ] 派生指标：`methodology` 写出了算法本身（不是算法的名字）
- [ ] 枚举型派生：右删失 / 作废数随值一起发布（`coverage` 三桶齐全，和恒等于窗口长度）
- [ ] 枚举型派生：极值配了分位数分布，最坏路径可被页面直接引用
- [ ] 文案过了 `copy.test.ts`：没有"适合定投 / 该买 / 偏冷"这类没有依据的判断
- [ ] 实体标签没有被写成"控制份额"这类定义式表述（矿池集中度是**出块份额**）
- [ ] 上了首页的指标已登记进 `packages/metrics/src/home.ts` 的白名单（`home.test.ts` 会拦）
- [ ] 上了首页的指标已登记进 `packages/metrics/src/status-specs.ts` 的状态词表
      （`home.test.ts` 会拦：状态列不允许开天窗）
- [ ] 跑通 `npm run ingest:btc` 后 `stale !== true` 且有真实值
- [ ] 断网重跑**不会破坏**已有快照（验证快照不可覆盖）
- [ ] `npm run typecheck && npm run lint && npm run test` 全绿

---

## 状态判定（首页"当前状态"列）

首页表格的每个指标都要有一个 ≤3 字的判断，规则见 ADR-018。
**指标定义本身不写状态词**，两者分开：

| 文件 | 放什么 |
|---|---|
| `market/features.ts` | 怎么算：分位、符号、过期与历史不足的判定 |
| `status.ts` | 怎么翻译：分位档 / 有符号方向 / 与价格背离 → 一个词 + 一个色档 |
| `status-specs.ts` | 每个指标**自己的**词：低→高三档，外加方向词与背离词 |
| `app/globals.css` | `--status-*` 色值（明暗各一份） |

新增一个上首页的指标时，四步：

1. **先看有没有能算的特征。** 状态判定挂在特征上，不是挂在指标上。
   没有对应特征就先去 `market/features.ts` 声明一个——
   写错 `featureId` 会静默变成"永远判不出来"，**不会编译报错**，
   所以 `status.test.ts` 里有一条断言专门查这件事。
2. **在三档之间选词。** 索引 0 = low，1 = mid，2 = high。
   顺带检查 `BAND_LOW_MAX` / `BAND_HIGH_MIN`：一个指标如果常年落在同一档，
   那个词就永远不会出现（`status.test.ts` 的"三档都打得到"只保证分支可达，
   不保证真实数据下三档都出现过）。
3. **有符号的量写 `flow`。** 不写的话会退到 `words` 上，
   而 `words` 描述的是**量的大小**——净流入会显示成"大量流入"，
   方向被吞掉。`flow` 存在时**方向优先于分位**。
4. **检查词里有没有立场。** `status.test.ts` 拦截投资建议与"超买 / 超卖 / 底部"
   这类**借来的结论**。判据很简单：这个词能不能只凭"这个数比过去 80% 的日子高"
   解释？能，才留。

**不要写进 `words` 的东西**：任何需要"和其他东西比"才能成立的判断。
`hot` 的全部含义就是分位，"该买"不是。

**不要为了让表格整齐而填"中性"。** 特征失败时状态判定返回
`ok: false` + 原因，页面显示"缺数据"并把原因挂在 `title` 上。
这是数据质量红线 8 在这一列上的落地：算不出来就是算不出来，
"中性"是一个有立场的结论，"判不了"不是。

> 已知的真实代价：`difficulty` / `recommended-fee-rate` / `block-weight` /
> `pool-concentration` 来自 mempool.space 链尖采样，每次运行一个点，
> 站点跑满一年之前它们的状态列一定是"缺数据"。
> 这是数据本身的性质，不是 bug——换源（Coin Metrics `DiffMean`，免 key 可取）
> 要过 `assertContractCompatible` 并写 ADR，不能悄悄换。
