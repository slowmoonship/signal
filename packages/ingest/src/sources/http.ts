/**
 * 取数公共设施：超时、指数退避重试、错误归一。
 *
 * 选 fetchImpl 作为参数而非直接用全局 fetch，是为了测试能离线跑。
 */

import { AdapterError, type FetchContext } from './types.js'

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504])

export type JsonFetchOptions = {
  readonly provider: string
  readonly metric: string
  readonly retries?: number
  /** 重试基础延迟（毫秒），实际为 base * 2^n */
  readonly backoffBaseMs?: number
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** 带超时与退避重试的 JSON GET。 */
export async function fetchJson<T>(
  url: string,
  ctx: FetchContext,
  opts: JsonFetchOptions,
): Promise<T> {
  const retries = opts.retries ?? 3
  const backoffBaseMs = opts.backoffBaseMs ?? 500
  let lastError: unknown

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), ctx.timeoutMs)
    try {
      const res = await ctx.fetchImpl(url, {
        signal: controller.signal,
        headers: { accept: 'application/json' },
      })

      if (!res.ok) {
        const retryable = RETRYABLE_STATUS.has(res.status)
        if (!retryable || attempt === retries) {
          throw new AdapterError(
            opts.provider,
            opts.metric,
            `HTTP ${res.status} ${res.statusText}`,
          )
        }
        lastError = new Error(`HTTP ${res.status}`)
        ctx.logger.warn(
          `${opts.provider}/${opts.metric} HTTP ${res.status}，第 ${attempt + 1} 次重试`,
        )
      } else {
        return (await res.json()) as T
      }
    } catch (e) {
      if (e instanceof AdapterError) throw e
      // AbortError（超时）与网络层错误都可重试
      lastError = e
      if (attempt === retries) break
      ctx.logger.warn(
        `${opts.provider}/${opts.metric} 取数失败（${describe(e)}），第 ${attempt + 1} 次重试`,
      )
    } finally {
      clearTimeout(timer)
    }

    await sleep(backoffBaseMs * 2 ** attempt)
  }

  throw new AdapterError(
    opts.provider,
    opts.metric,
    `重试 ${retries} 次后仍失败：${describe(lastError)}`,
    lastError,
  )
}

function describe(e: unknown): string {
  if (e instanceof Error) {
    return e.name === 'AbortError' ? '请求超时' : e.message
  }
  return String(e)
}
