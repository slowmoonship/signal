/**
 * GitHub Actions 工作流文件的结构守卫。
 *
 * 为什么需要它：工作流文件坏掉时，GitHub **不会**告诉你坏在第几行——
 * 它只是把这一轮运行标成 "This run likely failed because of a workflow file issue"，
 * 一个 0 秒的失败，而且一个 step 都没跑过。
 * 真正跑起来的测试救不了它（工作流本身没跑起来，测试也就没跑）。
 *
 * 所以这里守的是"文件能不能被 GitHub 解析"，而不是"跑起来对不对"。
 * 两类最常见的手写事故：
 *
 * 1. 步骤列表里混进一个标量（`- 某句话` 而不是 `- name: …`）。
 *    YAML 解析器会接受它（步骤列表里混进一个字符串），
 *    GitHub 的解析器不会——它要求每个 step 都是一个映射。
 * 2. 注释行丢掉了 `#` 前缀。中文注释尤其容易中招：
 *    `# 对照 db:reset 才是删库重建` 少了井号之后，
 *    它看上去只是一行正文，**而且在 YAML 里仍然合法**——
 *    只有当它以 `- ` 开头时才会被 GitHub 拒绝。
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const WORKFLOW_DIR = join(REPO_ROOT, '.github/workflows')

const files = readdirSync(WORKFLOW_DIR)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .map((name) => ({ name, src: readFileSync(join(WORKFLOW_DIR, name), 'utf8') }))

describe('GitHub Actions 工作流文件', () => {
  it('至少有一个工作流文件', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  it('每个列表项都是映射（`- name:` / `- uses:` / `- run:`），不能混进标量', () => {
    // 标量步骤项会被 GitHub 拒绝，而 YAML 解析器不报错——
    // 这正是"本地看着没问题、线上 0 秒失败"的那一类。
    const offenders: string[] = []
    for (const { name, src } of files) {
      src.split('\n').forEach((line, i) => {
        const m = /^(\s*)- (.+)$/.exec(line)
        if (!m) return
        const rest = (m[2] ?? '').trim()
        if (/^(name|uses|run|id|cron):/.test(rest)) return
        offenders.push(`${name}:${i + 1} ${line.trim()}`)
      })
    }
    expect(offenders).toEqual([])
  })

  it('没有丢掉井号的注释行（中文行以正文开头就是征兆）', () => {
    const offenders: string[] = []
    for (const { name, src } of files) {
      src.split('\n').forEach((line, i) => {
        if (/^\s*[一-龥]/.test(line)) offenders.push(`${name}:${i + 1} ${line.trim()}`)
      })
    }
    expect(offenders).toEqual([])
  })

  it('每个工作流都有名字、触发条件与作业', () => {
    for (const { name, src } of files) {
      expect(src, `${name} 缺少 name:`).toMatch(/^name:\s*\S/m)
      expect(src, `${name} 缺少触发条件 on:`).toMatch(/^on:/m)
      expect(src, `${name} 缺少 jobs:`).toMatch(/^jobs:/m)
    }
  })

  it('每个作业都声明了 runner、超时与步骤', () => {
    for (const { name, src } of files) {
      expect(src, `${name} 缺少 runs-on:`).toMatch(/^\s{4}runs-on:\s*\S/m)
      expect(src, `${name} 缺少 timeout-minutes:`).toMatch(/^\s{4}timeout-minutes:\s*\d+/m)
      expect(src, `${name} 缺少 steps:`).toMatch(/^\s{4}steps:/m)
    }
  })

  it('发布工作流用 GitHub 官方的三个 Pages action，且权限齐备', () => {
    const publish = files.find((f) => f.name === 'publish.yml')
    expect(publish, '缺少 publish.yml').toBeDefined()
    if (!publish) return
    expect(publish.src).toContain('actions/configure-pages@')
    expect(publish.src).toContain('actions/upload-pages-artifact@')
    expect(publish.src).toContain('actions/deploy-pages@')
    expect(publish.src).toMatch(/^\s{2}contents:\s*write/m)
    expect(publish.src).toMatch(/^\s{2}pages:\s*write/m)
    expect(publish.src).toMatch(/^\s{2}id-token:\s*write/m)
  })

  it('发布工作流不会被并发覆盖', () => {
    const publish = files.find((f) => f.name === 'publish.yml')
    expect(publish?.src).toMatch(/concurrency:/)
    // 取消正在跑的发布 = 站点可能停在一半的产物上
    expect(publish?.src).toMatch(/cancel-in-progress:\s*false/)
  })

  it('数据推送用默认 GITHUB_TOKEN（它不会再次触发工作流）', () => {
    const publish = files.find((f) => f.name === 'publish.yml')
    if (!publish) return
    // 用 PAT 或 SSH key 推送会再次触发本工作流 → 采集与推送互相触发，无限循环
    expect(publish.src).not.toMatch(/secrets\.GITHUB_TOKEN/)
    expect(publish.src).not.toMatch(/git push.*https:\/\//)
  })
})
