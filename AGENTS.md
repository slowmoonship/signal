# Signal 的 Agent 约定

本文件与 `CLAUDE.md` 的「项目管理」一节一致，供 Cursor、Codex、Claude Code、OpenCode 共用。
产品与数据约束以 `CLAUDE.md` 为准。通用项目管理规则见
`/home/alex/services/vikunja/PROJECT-MANAGEMENT.md`。

Signal 的任务状态记在本机 Vikunja。用 PATH 里的 `vik`。
先执行 `vik projects find "Signal｜比特币市场与链上指标"`，使用当次返回的项目 ID。
不要把项目或任务 ID 写死在文档里。

1. 开始开发前查询该项目和对应任务。
2. 任务不存在时，只在用户授权下创建或更新。
3. 做完后按 Git 提交、测试和浏览器验收更新 Vikunja，并回读。
4. 本地完成和正式发布分开写。没有新证据就不要改进度。
5. 数据源或许可卡住时写下原因。计算框架写完，不等于指标已经有数。
6. 只有用户批准上线，并且 Actions 部署和线上验收都成功，才把发布标成完成。
7. 不要自行创建 cron、循环任务或自动唤起 Agent。日更仍只由本仓库的 GitHub Actions 执行。
