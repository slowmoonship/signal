# DESIGN.md —— Signal 的视觉规范

Phase 3 落地。`CLAUDE.md §视觉红线` 是约束的**来源**，本文件是它在代码里的**落地形态**：
每个 token 定义在哪、组件怎么用、哪些做法被明确禁止、以及每条禁令由什么来守。

改视觉之前先读本文件；改完之后跑 `npm run test`——视觉红线里的每一条都有对应的守卫测试。

---

## 1. 三条红线与它们的理由

### 1.1 只用灰阶

不用彩色表达涨跌，方向靠 `+` / `−` 符号。

除了"极简"，真正的原因是**语义方向因指标而异**：矿工收入涨是好事，费率涨不是，
交易所净流出涨可能是卖压也可能是合规转移。用红绿去标，等于替读者下了一个它未必成立的判断。
灰阶没有这个问题：符号只陈述方向，不表态。

实体标签（矿池、交易所、巨鲸）同理——它们本来就是启发式标注（数据红线 6），
染色会让读者误以为标签本身是权威事实。

### 1.2 不用阴影、胶囊圆角、彩色按钮、渐变

层级靠**字重与间距**，不靠装饰。这条不是审美偏好：
它同时消灭了"元素该有多突出"这个需要逐处判断的问题，
排版层级因此是可预测的——`<h1>` 一律 `text-2xl font-semibold`，
小节标题一律 `text-xs font-medium uppercase tracking-widest`，没有例外。

### 1.3 元信息用等宽字体

时间、来源、数值单位、数值本身一律 `font-mono`，并开 `font-feature-settings: 'tnum' 1`。
指标数值要在首页 18 行之间横向对齐比较，字宽不等就谈不上比较。

---

## 2. Token

全部定义在 `apps/web/src/app/globals.css`。

### 2.1 颜色：为什么是 `:root` + `@media` + `@theme inline` 三段

```
:root                       真实取值（明）
@media (prefers-color-scheme: dark) { :root { … } }    真实取值（暗）
@theme inline { --color-ink: var(--ink); … }           语义名 → 工具类
```

Tailwind v4 的 `@theme` **只在构建期求值**。把暗色值也写进 `@theme`
（哪怕嵌套在媒体查询里）产出的仍是一组被后者覆盖的 `:root` 常量，
而 `text-ink` 早已在构建期被编译成固定的浅色十六进制——**暗色主题看着配了，实际永远不生效**。
`@theme inline` 让工具类直接引用 `var(--ink)`，值在运行时才解析，媒体查询的覆盖才起作用。

这个坑在 Phase 3 的第一版就踩过：`grep` 产物 CSS 时发现暗色块里只有 `dark:` 工具类、
`--color-ink` 全局只出现一次。`apps/web/test/theme.test.ts` 现在有一条断言专门守它。

### 2.2 语义色

| token | 明 | 暗 | 用在哪 |
|---|---|---|---|
| `--surface` | `#ffffff` | `#09090b` | 页面底色 |
| `--surface-sunken` | `#fafafa` | `#18181b` | 列表悬停行 |
| `--ink` | `#18181b` | `#e4e4e7` | 标题、指标名、**数据线** |
| `--ink-muted` | `#52525b` | `#a1a1aa` | 说明正文、来源名、页脚 |
| `--ink-subtle` | `#a1a1aa` | `#71717a` | 时间戳、刻度、次要标签 |
| `--rule` | `#e4e4e7` | `#27272a` | 分隔线、图表网格线 |
| `--rule-strong` | `#d4d4d8` | `#3f3f46` | 告警框边框 |

**组件里不出现 `zinc-300` / `zinc-700` 这类具体色阶。**
理由是可维护性：18 个指标 × 2 语言 × 2 主题如果各自挑色阶，
调一次对比度要改几十处，而且没人说得清哪一处的 zinc-500 是"次级"还是随手写的。
语义名把"这一层墨色代表什么"固化下来，取值只在 `globals.css` 一处。

图表里数据线用 `--ink`、网格线用 `--rule`，是同一套层级关系——
明暗两态只切换取值，不切换层级。

### 2.3 字体

`apps/web/src/lib/fonts.ts`，`next/font/google` 注入两个 CSS 变量：

- **Inter** —— 拉丁字母与数字。指标数值、时间戳、来源都是拉丁/数字，
  由它承载保证 `tabular-nums` 下数字等宽对齐。
- **Noto Sans SC** —— 中文。中文与西文混排时字面高度和字重必须显式配对，
  只声明其中一个会让另一类字符掉回系统字体，字重对不上。

只请求 400 / 500 / 600 三个字重：全站只用到 `font-medium`、`font-semibold` 与正文默认的 400。

`--font-sans` 的末尾保留完整系统字体栈（`ui-sans-serif` … `PingFang SC` …）。
web font 没加载成功时退回本机 CJK 字体，而不是出现空白字形。

**`--font-mono` 仍是纯系统栈**（`ui-monospace, 'SF Mono', Menlo, Consolas`）。
等宽字体不打包：元信息全是数字与短标签，系统等宽字体足够，
而再打一套 Inter Mono 只会让 4.8 MB 的字体目录更大。

> 构建成本：Noto Sans SC 被 Google 按字频切成约 101 个 chunk × 3 字重 = 305 条 `@font-face`，
> 产物 4.8 MB。浏览器只下载页面实际用到的 chunk（实测覆盖 888 个汉字码位），
> 但**每次 CI 构建都要重新下载这 4.8 MB**。若日后 CI 构建时间成为瓶颈，
> 第一个该考虑的就是把 Noto 换成自托管子集，而不是砍中文字体。

---

## 3. 主题切换：没有开关

明暗跟随 `prefers-color-scheme`，**不提供手动切换**。

一旦允许手动切换，就必须在第一帧之前知道用户选了什么——那意味着一段内联脚本。
对一个日更快照的静态站来说，这段脚本要防的闪烁本身就不存在：
`prefers-color-scheme` 在第一帧就已确定。

如果日后加上开关，`globals.css` 的三段结构是为此准备的：
变量都在 `:root` 上，手动切换只需要覆盖同一批变量，不需要动任何组件。

---

## 4. 排版层级

字重只有三档：`font-normal`（默认 400）、`font-medium`（500）、`font-semibold`（600）。
全站没有第三档以上，也不用字号做层级跳跃。

| 角色 | class |
|---|---|
| 页面标题 / 指标名 | `text-2xl font-semibold tracking-tight` |
| 指标数值（详情页） | `text-2xl sm:text-3xl font-mono tabular-nums` |
| 数值（首页行内） | `text-sm font-mono tabular-nums` |
| 小节标题 | `text-xs font-medium uppercase tracking-widest text-ink-subtle` |
| 说明正文 | `text-[15px] leading-relaxed text-ink-muted` |
| 元信息 | `text-xs font-mono text-ink-subtle` |

中文正文用 `text-[15px]` 而不是 `text-base`：16px 下中文行高偏松，
15px + `leading-relaxed` 在 640px 宽度上每行能多容纳几个字而不显拥挤。

---

## 5. 移动端与键盘

### 5.1 320px 不溢出

首页每一行在窄屏**竖排**（名称在上，数值与变化在下），`sm` 起才回到一行。

理由是算得出来的：市值 `$1,646,907,492,049.81` 有 21 个字符，
等宽 14px 下约 176px；再加 4.5rem 的变化列和 gap，320px 减去 `px-5` 两侧共剩约 240px——
指标名会被挤到只剩十几个像素。与其加横向滚动条，不如换排版。

详情页的指标数值同理：`text-2xl` 起、`sm` 才升到 `text-3xl`，并允许 `break-words`。

`body` 上有 `overflow-wrap: break-word`：中文没有词间空格，
长 endpoint（`https://blockstream.info/api/block/0000…`）必须能断行，
源码 URL 一律配 `break-all`。

### 5.2 键盘可达性

- **`:focus-visible`** 才有焦点环，2px `var(--ink)` + 2px offset。
  鼠标点击不出现，键盘 Tab 一定看得见——深色主题下浏览器默认焦点环常常和背景撞色。
- **跳过导航链接**（`.skip-link`）：首页 18 行都是链接，键盘用户每翻一页都要 Tab 过。
  平时用 `position: absolute; left: -9999px` 移出视口，**不用 `display: none`**
  （那样它就无法被聚焦，跳过链接会彻底失效）；聚焦时回到文档流。落点是 `<main id="content">`。
- 语义标签：该用 `<article>` / `<section>` / `<dl>` 的地方都用上了
  （`Freshness` 是 `<dl>`，图表是 `<figure>` + `role="img"` + `aria-label` 描述显示区间）。
- `prefers-reduced-motion: reduce` 时关掉全部动画与过渡。

---

## 6. 由测试守住的部分

`apps/web/test/theme.test.ts`，8 条。视觉是最容易悄悄漂移的一层，
而破防不会产生任何运行时报错——所以先钉住：

1. 组件源码里不出现 `zinc-NNN`
2. 不出现 `shadow*` / `backdrop-blur` / `gradient` / `rounded-full|2xl|3xl|xl`
3. 不出现 Tailwind 彩色调色板类（`bg-red-500` 等）
4. 暗色覆盖在 `@media` 的 `:root` 上，**不在** `@theme` 里（配平花括号后逐块检查）
5. 明暗两态给每个语义 token 都赋了值
6. 每个 token 都通过 `@theme inline` 映射成工具类
7. 明暗两态 token 名单一致
8. 跳过导航链接与 `#content` 落点同时存在

这些测试读的是**源码文本**而非渲染结果——本站构建期静态生成，没有浏览器运行时可挂。
代价是管不了"class 用对了但位置用错了"，只管"用词是否越界"。
这是没有渲染测试时能拿到的最强保证，剩下的靠 code review。

> 守卫本身也验证过：把 `MetricRow` 里的 `text-ink` 改成 `text-zinc-900`，
> 第 1 条立刻失败并指出文件与色阶。

---

## 7. 明确不做的事

| 不做 | 为什么 |
|---|---|
| 涨跌染色 | 方向因指标而异，染色等于替读者下判断（§1.1） |
| 手动主题切换开关 | 需要首帧前的内联脚本，而闪烁本就不存在（§3） |
| 卡片墙 / 阴影 / 渐变 / 胶囊圆角 | 视觉红线（§1.2） |
| 首页迷你走势图 | 极简文字列表是产品决策（ADR-005） |
| 交互式图表库 | 静态快照用不上 50 KB 客户端 JS（ADR-009） |
| 图表 tooltip / 缩放 | 同上；若日后要做，接受"加一层轻交互"的重做成本 |
| 打包等宽字体 | 元信息全是数字与短标签，系统等宽足够（§2.3） |
