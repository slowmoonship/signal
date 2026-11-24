# Signal

面向公众的加密资产市场与链上指标目录。阶段一只做 BTC，架构预留 ETH / SOL。
**界面为中文单语言**（底层文案保留 en/zh 双语），日更抓取，明暗主题，视觉参考 leerob.com。

线上站点：<https://slowmoonship.github.io/signal/>（GitHub Pages 静态站，每日自动更新）。

## 状态

**当前版本 V0.14.1**（<https://slowmoonship.github.io/signal/>）。
GitHub Actions 每天 04:37 UTC（北京时间 12:37）自动采集、计算、校验、导出并部署。
发布物是注册表里的全部指标快照，历史写在 `public/data/*.json` 里，不靠 runner 上的临时数据库。
披露类指标按披露频率更新，不要求每个自然日都有新观测。

- Phase 0：项目骨架、开发规范、数据适配器接口与数据质量约束。
- Phase 1：18 个 BTC 指标定义（中英双语文案齐全）、首页与详情页、明暗主题、历史曲线。
- Phase 2：接入真实免费源，站点读的就是真数据。
- Phase 3：视觉规范落地（语义 token、web 字体、320px 排版、键盘可达性），见 `docs/DESIGN.md`。
- Phase 4：GitHub Actions 日更与 CI、stale 与新鲜度文案、sitemap / robots / OG。
- V0.1：界面收敛为中文单语言（`/` 直接是首页，`/zh` 保留为历史别名）、
  市场状态卡片加语义底色、页脚改为品牌署名。
- V0.11：市场状态改为牛市 / 熊市 / 震荡，首页表格外框与左栏对齐，
  并由区块历史回填网络难度、区块权重、矿池集中度。
- V0.12：用已有价格、市值、MVRV、发行收入和算力补上 AHR999、彩虹图、
  Pi Cycle、Puell、Mayer、未实现盈亏、MVRV Z-Score、200 周均线、2 年倍数、
  算力丝带和距历史高点。首页右侧是 5 类 18 项。详情曲线按真实缺口分段后再抽稀。
  首页状态和判定依据来自同一条规则，不写 Pxx。这些阈值是读数归类，不是买卖建议。
- V0.13：接入 Strategy 披露指标，包括 BTC 持仓、持仓均价、浮盈亏、MSTR 股价、
  每股 BTC、普通股增发、STRC 回购、披露 mNAV、美元储备和美元现金。
  持仓从 2020-08-11 写起，并补上能对上 SEC 文件的 2024 年历史点。
  新增全宽指标库 `/metrics/`。MSTR 相对 BTC 的 90 日弹性在可再分发收盘不足 90 个交易日时不发布数字。
- V0.14.0：补上 BTC 链上平均成本与成本偏离，并把 Strategy 持仓均价放进首页精选。
  详情图的时间刻度按 UTC 标出年份。首页表格改为直角、列间分隔线和居中表头。
  MSTR 股价在收盘过期时显示待更新。50 日均线的计算规则已经写好，
  但连续可再分发的日线仍不足，页面不发布这条均线。90 日弹性继续缺数据。
- V0.14.1：氛围图改为全站背景，浅色是湖畔晨雾，深色是书架与星空。
  市场状态卡片恢复牛市浅绿、熊市浅红、震荡灰蓝，不再贴图。
  首页精选扩到 22 项。每区块交易笔数从 2025-10-01 起按每日链尖区块回填。
  推荐费率仍只保留每日采样，不用其他费率补历史。

## 环境变量

| 变量 | 作用 | 未配置时 |
|---|---|---|
| `SIGNAL_SITE_URL` | 站点根 URL。canonical、sitemap、`robots.txt` 的 sitemap 指针、OG 绝对地址都由它推导 | 不写死占位域名；sitemap 输出空、robots 不带 sitemap 指针 |
| `SIGNAL_DATA_DIR` | 页面读取的快照目录。`npm run dev:fixtures` 用它切到 `fixtures/btc` | 读 `apps/web/public/data` |

本地预览：`npm run preview`（用纯静态文件服务器服务 `apps/web/out`，模拟 Pages 的行为，
默认 <http://127.0.0.1:4310/signal/>）。开发模式：`npm run dev`（同样在 `/signal` 下）。
刷新数据：`npm run ingest:btc --workspace @slowmoonship/ingest -- --live`。
没有真实数据也能看页面：`npm run dev:fixtures`（合成数据，页面顶部有明确告警条）。

## 仓库结构

```
packages/metrics    指标类型 + 注册表 + 派生计算   ← 唯一事实源
packages/ingest     数据源适配器 + SQLite + 原子发布
apps/web            Next.js 站点
docs/               规划、指标编写规范、架构决策记录
```

依赖方向固定为 `web → metrics ← ingest`。详见 `CLAUDE.md`。

## 常用命令

```bash
npm install
npm run dev              # 开发服务器（http://localhost:3000/signal/）
npm run build           # 静态导出到 apps/web/out（GitHub Pages 的部署产物）
npm run preview         # 用静态文件服务器预览 out/（默认 127.0.0.1:4310/signal/）
npm run dev:fixtures     # 生成合成 fixture 并用它启动站点（页面会显示告警条）
npm run fixtures:btc     # 只生成 fixture（写入 fixtures/btc，绝不写 public/data）
npm run ingest:btc       # 抓取 BTC 指标（默认 dry-run）
# 加 --live 才落库并发布到 public/data：
npm run ingest:btc --workspace @slowmoonship/ingest -- --live
npm run sources          # 列出已注册适配器与付费墙指标
npm run db:init          # 初始化 SQLite
npm run db:reset         # 删库重建（破坏性）
npm run metrics:validate # 校验指标定义（进 CI）
npm run data:verify     # 校验发布物：每个指标都有有效数据点（部署前跑）

npm run typecheck        # tsc，覆盖 packages / 测试 / web
npm run lint             # ESLint flat config，类型感知规则
npm run test             # Vitest
```

提交前必须全绿：`npm run typecheck && npm run lint && npm run test`。

## 数据来源

全部为**免 key** 数据源，且均已实测可用（详见 `docs/PLAN.md` §4）：

- **Coin Metrics Community API** —— 日频链上与市场指标（主力来源）
- **mempool.space** —— 推荐费率、矿池份额（算力作为回退源）
- **Blockstream** —— 链尖区块的难度、交易笔数、权重

Coin Metrics 免费层把美元计价的费用类指标（`FeeTotUSD`/`RevUSD`/`NVTAdj` 等）锁在付费墙后，
适配器已在本地拦截这些指标，避免发出注定失败的请求。需要它们时按 ADR-002 增加付费适配器。

## 文档

| 文件 | 内容 |
|---|---|
| `CLAUDE.md` | **最高约束来源**，每次会话自动加载 |
| `docs/PLAN.md` | MVP 范围、架构、实施计划、数据源实测结果 |
| `docs/METRIC_AUTHORING.md` | 新增指标的唯一权威流程与必填字段 |
| `docs/DESIGN.md` | 视觉规范：token、字体、排版层级、移动端与键盘可达性 |
| `docs/DECISIONS.md` | 架构决策记录（ADR-001 起，只追加） |

## 数据质量红线

这些不是口号，每条都有对应的可执行校验或测试：

1. 历史缺失保留为 `null`，**绝不填零**
2. 采集失败只标记 stale，**不覆盖上一份有效快照**
3. 时间一律 UTC 存储与传输
4. 每份数据同时记录 `sourceTime` 与 `ingestedAt`
5. 切换数据源必须通过 `assertContractCompatible` 口径检查
6. 交易所 / 巨鲸 / 矿池等实体标签属启发式标注，未经验证不得给出精确定义
7. 付费适配器未配置 key 时降级，不得成为免 key 路径的隐式依赖

8. 判定类逻辑在数据缺失、历史不足、过期或无法计算时返回 `unknown`，不降级成"中性"

视觉红线（只用灰阶、无阴影 / 胶囊 / 渐变 / 彩色）同样有可执行守卫，见 `docs/DESIGN.md` §6。

## 数据许可

| 来源 | 许可 | 本站如何使用 |
|---|---|---|
| Coin Metrics 社区 API | CC BY-NC 4.0 | 非商业使用；详情页与发布的 JSON 里都带署名与许可链接 |
| mempool.space | 未公开声明许可条款 | 公开接口，遵守其速率限制 |
| blockstream.info | 公开账本数据（Esplora 为 MIT） | 公开接口 |

各来源的署名与许可说明随数据一起发布（见 `SourceRef.license`）。
本站免费且不含付费内容，属非商业使用；**若将来商业化，
Coin Metrics 社区数据必须换成付费档**。
