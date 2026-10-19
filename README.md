# Signal

面向公众的加密资产市场与链上指标目录。阶段一只做 BTC，架构预留 ETH / SOL。
中英双语，日更抓取，明暗主题，视觉参考 leerob.com。

## 状态

**Phase 0–2 完成，Phase 3 进行中。**

- Phase 0：项目骨架、开发规范、数据适配器接口与数据质量约束。
- Phase 1：18 个 BTC 指标定义（中英双语文案齐全）、首页与详情页、明暗主题、历史曲线。
- Phase 2：接入真实免费源，`public/data` 已是 18 份真实快照，站点读的就是真数据。

本地预览：`npm run dev`。刷新数据：`npm run ingest:btc --workspace @slowmoonship/ingest -- --live`。
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
npm run dev              # 启动站点（http://localhost:3000，自动重定向到 /en 或 /zh）
npm run dev:fixtures     # 生成合成 fixture 并用它启动站点（页面会显示告警条）
npm run fixtures:btc     # 只生成 fixture（写入 fixtures/btc，绝不写 public/data）
npm run ingest:btc       # 抓取 BTC 指标（默认 dry-run）
# 加 --live 才落库并发布到 public/data：
npm run ingest:btc --workspace @slowmoonship/ingest -- --live
npm run sources          # 列出已注册适配器与付费墙指标
npm run db:init          # 初始化 SQLite
npm run db:reset         # 删库重建（破坏性）
npm run metrics:validate # 校验指标定义（进 CI）

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
| `docs/DECISIONS.md` | 架构决策记录（ADR-001 ~ 010） |

## 数据质量红线

这些不是口号，每条都有对应的可执行校验或测试：

1. 历史缺失保留为 `null`，**绝不填零**
2. 采集失败只标记 stale，**不覆盖上一份有效快照**
3. 时间一律 UTC 存储与传输
4. 每份数据同时记录 `sourceTime` 与 `ingestedAt`
5. 切换数据源必须通过 `assertContractCompatible` 口径检查
6. 交易所 / 巨鲸 / 矿池等实体标签属启发式标注，未经验证不得给出精确定义
7. 付费适配器未配置 key 时降级，不得成为免 key 路径的隐式依赖
