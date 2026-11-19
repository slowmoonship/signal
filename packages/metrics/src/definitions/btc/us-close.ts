/**
 * 美股收盘时刻的 BTC 价格。
 *
 * 这不是首页那条 UTC 日均价。它只为了和 MSTR 的收盘配在同一个时刻。
 * 提前收盘日取美东 13:00，普通交易日取美东 16:00。缺那根小时线就是 null。
 */

import { defineMetric } from '../../defineMetric.js'
import { LABEL_SEMANTICS } from '../../labels.js'

export const btcPriceUsClose = defineMetric({
  id: 'btc-price-us-close',
  asset: 'btc',
  category: 'market',
  ingestGroup: 'strategy',
  name: { en: 'BTC at the US equity close', zh: '美股收盘时的 BTC' },
  description: {
    en: 'The BTC/USDC price at the New York cash-equity close, one point per session.',
    zh: '纽约股票收盘那一刻的 BTC/USDC 价格，每个美股交易日一个点。',
  },
  methodology: {
    en: 'Binance Vision spot BTCUSDC 1-hour kline, using the open of the candle whose open time is 16:00 America/New_York, or 13:00 on scheduled early closes. Daylight saving is applied. Weekends, NYSE holidays and sessions outside the encoded calendar are omitted. A missing hour is null. This is not the Coin Metrics UTC daily average, and it is not a daily VWAP. If a month has no BTCUSDC file, that month may fall back to BTCUSDT and the snapshot says so. From 2025-01-01 the archive timestamps are microseconds and are converted before matching.',
    zh: '取 Binance Vision 现货 BTCUSDC 的 1 小时 K 线，用开盘时间正好是美东 16:00 的那根 K 线的开盘价。提前收盘日改为美东 13:00。夏令时单独换算。周末、纽交所休市日，以及日历还没编码的年份，都不产生点。缺那一小时就是 null，不用 UTC 日均价或日线收盘顶上。某个月没有 BTCUSDC 文件时，可以改用 BTCUSDT，并在快照里写明。2025-01-01 起归档的时间戳是微秒，配对前会先换回秒。',
  },
  limits: {
    en: 'The hour open is the first trade at or after the bell, not a print at 16:00:00.000. USDT is not USD. The series is published under CC BY-NC-SA 4.0 and is for the non-commercial site.',
    zh: '小时开盘价是收盘钟声之时或之后的第一笔成交，不是 16:00:00.000 的逐笔。USDT 不是美元。这条序列按 CC BY-NC-SA 4.0 发布，只用于本站的非商业页面。',
  },
  unit: 'usd',
  frequency: '1d',
  format: { kind: 'usd' },
  contract: {
    unit: 'usd',
    scale: 1,
    aggregation: 'last',
    window: 'us-equity-close',
    labelSemantics: LABEL_SEMANTICS.none,
  },
  sources: [
    {
      provider: 'Binance Vision',
      metric: 'BTCUSDC 1h open',
      endpoint: 'https://data.binance.vision/data/spot/monthly/klines/BTCUSDC/1h/',
      auth: 'none',
      labelConfidence: 'verified',
      license: {
        name: 'CC BY-NC-SA 4.0',
        url: 'https://creativecommons.org/licenses/by-nc-sa/4.0/',
        restriction: {
          en: 'Non-commercial use. Derivatives stay under the same license. Attribute Binance Vision.',
          zh: '仅限非商业使用。衍生数据保持同一许可，并署名 Binance Vision。',
        },
      },
    },
  ],
  history: {
    availableFrom: '2024-01-02',
    note: {
      en: 'The encoded NYSE calendar starts in 2024. Earlier hours exist at the source but are not published here.',
      zh: '本站编码的纽交所日历从 2024 年开始。更早的小时数据源里有，这里不发布。',
    },
    mayBeRevised: false,
  },
  missingPolicy: 'null',
  betterWhen: null,
})
