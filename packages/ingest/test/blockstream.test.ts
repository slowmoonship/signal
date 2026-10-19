/**
 * Blockstream 适配器测试（全程离线，假 fetch）。
 *
 * 覆盖的是"写坏数据前必须失败"的几处：
 * tip 哈希形状、字段缺失填 null、非 2xx、以及口径与指标定义是否逐字段相等。
 */

import { describe, expect, it, vi } from 'vitest'

import { BlockstreamAdapter } from '../src/sources/blockstream.js'
import { AdapterError, type AdapterRequest, type FetchContext, type Logger } from '../src/sources/types.js'
import { assertContractCompatible, registry, toUtcSecondsBrand } from '@slowmoonship/metrics'

const silentLogger: Logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }

// 实测拿到的真实响应形状（2026-10-19）。
// 区块体直接存 JSON 文本再 parse：difficulty 是 17 位有效数字，
// 写成 TS 数字字面量会丢精度，也会让"上游给的就是这串字符"这件事看不出来。
const TIP_HASH = '00000000000000000000cb1f86dc5b1bc692d7c1b8bb0956677c734c46b898c6'
const BLOCK_JSON = `{"id":"${TIP_HASH}","height":972111,"timestamp":1792390027,` +
  `"tx_count":2307,"size":1752161,"weight":3993572,"difficulty":140577680051919.62}`
const BLOCK = JSON.parse(BLOCK_JSON) as {
  id: string
  height: number
  timestamp: number
  tx_count: number
  size: number
  weight: number
  difficulty: number
}
const BLOCK_TS = BLOCK.timestamp

type Route = {
  readonly tip?: () => Response
  readonly block?: () => Response
}

/** 按 URL 把两次请求分别喂假响应；未登记的 URL 直接失败，便于发现"打错端点" */
function fakeFetch(route: Route): typeof fetch {
  const impl = vi.fn(async (input: unknown) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.href : (input as { url: string }).url
    if (url === 'https://blockstream.info/api/blocks/tip/hash') {
      return route.tip ? route.tip() : new Response(TIP_HASH, { status: 200 })
    }
    if (url === `https://blockstream.info/api/block/${TIP_HASH}`) {
      return route.block ? route.block() : new Response(BLOCK_JSON, { status: 200 })
    }
    throw new Error(`测试未预期的请求：${url}`)
  })
  return impl as unknown as typeof fetch
}

function ctx(fetchImpl: typeof fetch): FetchContext {
  return {
    fetchImpl,
    now: () => Date.parse('2026-10-20T06:00:00Z'),
    logger: silentLogger,
    timeoutMs: 1000,
  }
}

function req(metric: string): AdapterRequest {
  return { metricId: 'x', asset: 'btc', metric }
}

const adapter = new BlockstreamAdapter()

// ── 三个指标的正常路径 ────────────────────────────────────

describe('Blockstream 三个指标的正常路径', () => {
  it('Difficulty 取区块 difficulty 字段', async () => {
    const series = await adapter.fetch(req('blockstream.Difficulty'), ctx(fakeFetch({})))
    expect(series.points).toEqual([{ ts: toUtcSecondsBrand(BLOCK_TS), value: BLOCK.difficulty }])
    expect(series.warnings).toEqual([])
    expect(series.labelConfidence).toBe('verified')
    expect(series.contract.unit).toBe('index')
  })

  it('BlockTxCount 取区块 tx_count 字段', async () => {
    const series = await adapter.fetch(req('blockstream.BlockTxCount'), ctx(fakeFetch({})))
    expect(series.points).toEqual([{ ts: toUtcSecondsBrand(BLOCK_TS), value: 2307 }])
    expect(series.contract.unit).toBe('count')
    expect(series.contract.aggregation).toBe('last')
    expect(series.contract.window).toBe('point')
  })

  it('BlockWeight 取区块 weight 字段', async () => {
    const series = await adapter.fetch(req('blockstream.BlockWeight'), ctx(fakeFetch({})))
    expect(series.points).toEqual([{ ts: toUtcSecondsBrand(BLOCK_TS), value: 3993572 }])
    expect(series.contract.unit).toBe('count')
  })

  it('每次运行只产出一个点，时间戳与 sourceTime 都取区块自身的时间', async () => {
    const series = await adapter.fetch(req('blockstream.Difficulty'), ctx(fakeFetch({})))
    expect(series.points).toHaveLength(1)
    expect(series.points[0]?.ts).toBe(BLOCK_TS)
    expect(series.sourceTime).toBe(new Date(BLOCK_TS * 1000).toISOString())
    // sourceTime 不得被采集时间污染（红线 4）
    expect(series.sourceTime).not.toBe(new Date(ctx(fakeFetch({})).now()).toISOString())
  })

  it('口径与三个指标定义逐字段相等（写入前的口径检查不会拦下）', () => {
    for (const [metricId, metric] of [
      ['difficulty', 'blockstream.Difficulty'],
      ['block-tx-count', 'blockstream.BlockTxCount'],
      ['block-weight', 'blockstream.BlockWeight'],
    ] as const) {
      const def = registry.get(metricId)
      expect(() =>
        assertContractCompatible(def.id, def.contract, adapter.contractFor(req(metric))),
      ).not.toThrow()
    }
  })

  it('只认 blockstream.* 前缀的三个指标', () => {
    expect(adapter.supports({ asset: 'btc', metric: 'blockstream.Difficulty' })).toBe(true)
    expect(adapter.supports({ asset: 'btc', metric: 'blockstream.Nope' })).toBe(false)
    expect(adapter.supports({ asset: 'btc', metric: 'AdrActCnt' })).toBe(false)
  })

  it('sourceRef 记录区块端点模板与免 key 口径', () => {
    expect(adapter.sourceRef(req('blockstream.BlockWeight'))).toEqual({
      provider: 'blockstream',
      metric: 'blockstream.BlockWeight',
      endpoint: 'https://blockstream.info/api/block/{hash}',
      auth: 'none',
      labelConfidence: 'verified',
    })
  })
})

// ── 形状守卫：哈希不对就绝不写 ────────────────────────────

describe('tip 哈希校验', () => {
  it('非 64 位十六进制的响应被拒（实测 "Invalid hex string"）', async () => {
    const fetchImpl = fakeFetch({ tip: () => new Response('Invalid hex string', { status: 200 }) })
    await expect(
      adapter.fetch(req('blockstream.Difficulty'), ctx(fetchImpl)),
    ).rejects.toBeInstanceOf(AdapterError)
    await expect(
      adapter.fetch(req('blockstream.Difficulty'), ctx(fetchImpl)),
    ).rejects.toThrow(/64 位小写十六进制/)
  })

  it('大写十六进制同样被拒，避免同一区块出现两种哈希写法', async () => {
    const fetchImpl = fakeFetch({ tip: () => new Response(TIP_HASH.toUpperCase(), { status: 200 }) })
    await expect(
      adapter.fetch(req('blockstream.Difficulty'), ctx(fetchImpl)),
    ).rejects.toBeInstanceOf(AdapterError)
  })

  it('hash 不合法时不发出第二个请求', async () => {
    const fetchImpl = fakeFetch({ tip: () => new Response('', { status: 200 }) })
    await expect(
      adapter.fetch(req('blockstream.Difficulty'), ctx(fetchImpl)),
    ).rejects.toBeInstanceOf(AdapterError)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})

// ── 字段缺失即 null，绝不填零 ──────────────────────────────

describe('字段缺失', () => {
  it('difficulty 缺失记为 null 并附警告', async () => {
    const { difficulty: _drop, ...rest } = BLOCK
    const fetchImpl = fakeFetch({ block: () => new Response(JSON.stringify(rest), { status: 200 }) })
    const series = await adapter.fetch(req('blockstream.Difficulty'), ctx(fetchImpl))
    expect(series.points).toEqual([{ ts: toUtcSecondsBrand(BLOCK_TS), value: null }])
    expect(series.warnings).toHaveLength(1)
    expect(series.warnings[0]).toMatch(/difficulty/)
  })

  it('weight 为 null 时同样记为 null，不用 0 冒充', async () => {
    const body = { ...BLOCK, weight: null as unknown as number }
    const fetchImpl = fakeFetch({ block: () => new Response(JSON.stringify(body), { status: 200 }) })
    const series = await adapter.fetch(req('blockstream.BlockWeight'), ctx(fetchImpl))
    expect(series.points.map((p) => p.value)).toEqual([null])
    expect(series.warnings[0]).toMatch(/weight/)
  })

  it('timestamp 缺失时抛错，不用采集时间凑数', async () => {
    const { timestamp: _drop, ...rest } = BLOCK
    const fetchImpl = fakeFetch({ block: () => new Response(JSON.stringify(rest), { status: 200 }) })
    await expect(
      adapter.fetch(req('blockstream.BlockTxCount'), ctx(fetchImpl)),
    ).rejects.toThrow(/timestamp/)
  })

  it('响应不是对象时抛错', async () => {
    const fetchImpl = fakeFetch({ block: () => new Response('[]', { status: 200 }) })
    await expect(
      adapter.fetch(req('blockstream.BlockTxCount'), ctx(fetchImpl)),
    ).rejects.toBeInstanceOf(AdapterError)
  })
})

// ── HTTP 失败 ────────────────────────────────────────────

describe('HTTP 失败', () => {
  it('tip 接口 5xx 归一为 AdapterError', async () => {
    const fetchImpl = fakeFetch({ tip: () => new Response('boom', { status: 503, statusText: 'Busy' }) })
    await expect(
      adapter.fetch(req('blockstream.Difficulty'), ctx(fetchImpl)),
    ).rejects.toThrow(/HTTP 503/)
  })

  it('区块接口 403 立即失败，不无限重试', async () => {
    const fetchImpl = fakeFetch({
      block: () => new Response('no', { status: 403, statusText: 'Forbidden' }),
    })
    await expect(
      adapter.fetch(req('blockstream.BlockWeight'), ctx(fetchImpl)),
    ).rejects.toBeInstanceOf(AdapterError)
    expect(fetchImpl).toHaveBeenCalledTimes(2) // tip 一次 + block 一次
  })

  it('未知指标直接拒绝，不发任何请求', async () => {
    const fetchImpl = fakeFetch({})
    await expect(adapter.fetch(req('blockstream.Unknown'), ctx(fetchImpl))).rejects.toThrow(
      /未登记口径/,
    )
    expect(() => adapter.contractFor({ asset: 'btc', metric: 'blockstream.Unknown' })).toThrow(
      /未登记口径/,
    )
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
