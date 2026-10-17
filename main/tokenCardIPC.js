// main/tokenCardIPC.js
// Token hover-card data service. The tokenCards preload script (injected into
// every page) detects contract addresses / $TICKERs and asks this handler for
// live token data. Data comes from Dexscreener (price/liquidity/market cap,
// no API key needed) plus GoPlus (mint/freeze authority risk checks on Solana).

// ---- cache ----
// Successful lookups are cached briefly so hovering the same token repeatedly
// doesn't hammer the APIs. Misses are cached longer (unknown tickers stay unknown).
var tokenCardCache = new Map() // key -> { data, expires }
const TOKENCARD_TTL = 60 * 1000 // 60s for hits
const TOKENCARD_MISS_TTL = 5 * 60 * 1000 // 5min for misses
const TOKENCARD_CACHE_MAX = 500

function tokenCardCacheGet (key) {
  var entry = tokenCardCache.get(key)
  if (entry && entry.expires > Date.now()) {
    return entry.data
  }
  tokenCardCache.delete(key)
  return null
}

function tokenCardCacheSet (key, data, ttl) {
  if (tokenCardCache.size >= TOKENCARD_CACHE_MAX) {
    // drop the oldest entry
    tokenCardCache.delete(tokenCardCache.keys().next().value)
  }
  tokenCardCache.set(key, { data: data, expires: Date.now() + ttl })
}

function formatNum (n) {
  n = Number(n)
  if (!isFinite(n) || n === 0) return null
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B'
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M'
  if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K'
  return '$' + n.toFixed(2)
}

function formatPrice (p) {
  p = Number(p)
  if (!isFinite(p)) return null
  if (p >= 1) return '$' + p.toLocaleString('en-US', { maximumFractionDigits: 2 })
  if (p >= 0.01) return '$' + p.toFixed(4)
  // tiny meme-coin prices: keep 4 significant digits
  return '$' + p.toPrecision(4).replace(/e-?\d+$/i, function (exp) { return exp })
}

function formatAge (createdAtMs) {
  if (!createdAtMs) return null
  var days = Math.floor((Date.now() - createdAtMs) / (24 * 60 * 60 * 1000))
  if (days < 1) return 'today'
  if (days < 30) return days + 'd'
  if (days < 365) return Math.floor(days / 30) + 'mo'
  return (days / 365).toFixed(1).replace(/\.0$/, '') + 'y'
}

// Pick the most liquid Solana pair. Falls back to any chain if the
// token isn't on Solana.
function pickBestPair (pairs, tickerFilter) {
  if (!Array.isArray(pairs) || pairs.length === 0) return null

  var candidates = pairs
  if (tickerFilter) {
    var t = tickerFilter.toLowerCase()
    candidates = pairs.filter(function (p) {
      return p.baseToken && (p.baseToken.symbol || '').toLowerCase() === t
    })
    if (candidates.length === 0) return null
  }

  // Prefer Solana pairs first
  var solCandidates = candidates.filter(function (p) { return p.chainId === 'solana' })
  var pool = solCandidates.length > 0 ? solCandidates : candidates

  return pool.reduce(function (best, p) {
    var liq = (p.liquidity && p.liquidity.usd) || 0
    var bestLiq = (best.liquidity && best.liquidity.usd) || 0
    return liq > bestLiq ? p : best
  })
}

function normalizePair (pair) {
  return {
    found: true,
    symbol: (pair.baseToken && pair.baseToken.symbol) || '?',
    name: (pair.baseToken && pair.baseToken.name) || '',
    address: (pair.baseToken && pair.baseToken.address) || '',
    chain: pair.chainId || '',
    price: formatPrice(pair.priceUsd),
    change24h: pair.priceChange && typeof pair.priceChange.h24 === 'number' ? pair.priceChange.h24 : (pair.priceChange ? Number(pair.priceChange.h24) : null),
    marketCap: formatNum(pair.marketCap || pair.fdv),
    liquidity: formatNum(pair.liquidity && pair.liquidity.usd),
    volume24h: formatNum(pair.volume && pair.volume.h24),
    age: formatAge(pair.pairCreatedAt),
    pairUrl: pair.url || ('https://dexscreener.com/' + pair.chainId + '/' + pair.pairAddress),
    risk: null // filled in by the GoPlus check below
  }
}

function fetchWithTimeout (url, opts, ms) {
  return Promise.race([
    net.fetch(url, opts),
    new Promise(function (_, reject) {
      setTimeout(function () { reject(new Error('timeout')) }, ms)
    })
  ])
}

// GoPlus Solana token security: returns { level: 'low'|'medium'|'high', reasons: [] }
// or null if the token isn't on Solana / the check fails.
async function checkTokenRisk (chain, address) {
  if (chain !== 'solana' || !address) return null

  try {
    var res = await fetchWithTimeout(
      'https://api.gopluslabs.io/api/v1/solana/token_security?contract_addresses=' + address,
      { headers: { Accept: 'application/json' } },
      5000
    )
    if (!res.ok) return null
    var json = await res.json()
    var info = json.result && json.result[address]
    if (!info) return null

    var reasons = []
    var level = 'low'

    if (info.freezable && info.freezable.status === '1') {
      level = 'high'
      reasons.push('Freeze authority active — your tokens can be frozen')
    }
    if (info.balance_mutable_authority && info.balance_mutable_authority.status === '1') {
      level = 'high'
      reasons.push('Authority can change balances')
    }
    if (info.closable && info.closable.status === '1') {
      level = 'high'
      reasons.push('Token can be closed by authority')
    }
    if (info.mintable && info.mintable.status === '1') {
      if (level === 'low') level = 'medium'
      reasons.push('Supply is mintable')
    }
    if (info.transfer_fee && Object.keys(info.transfer_fee).length > 0) {
      if (level === 'low') level = 'medium'
      reasons.push('Token charges a transfer fee')
    }

    return { level: level, reasons: reasons }
  } catch (e) {
    return null
  }
}

// data: { type: 'address' | 'ticker', query: string }
ipc.handle('tokencard:lookup', async function (event, data) {
  try {
    console.log('[tokencard] lookup called:', data)
    if (!data || !data.query) return { found: false }

    var type = data.type === 'ticker' ? 'ticker' : 'address'
    var query = String(data.query).trim()
    // base58 mints are case-sensitive; tickers aren't
    var cacheKey = type + ':' + (type === 'ticker' ? query.toLowerCase() : query)

    var cached = tokenCardCacheGet(cacheKey)
    if (cached) return cached

    var url
    var tickerFilter = null
    if (type === 'address') {
      if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(query)) return { found: false }
      url = 'https://api.dexscreener.com/latest/dex/tokens/' + query
    } else {
      tickerFilter = query.replace(/^\$/, '')
      if (!/^[A-Za-z][A-Za-z0-9]{1,9}$/.test(tickerFilter)) return { found: false }
      url = 'https://api.dexscreener.com/latest/dex/search?q=' + encodeURIComponent(tickerFilter)
    }

    console.log('[tokencard] fetching:', url)
    var res = await fetchWithTimeout(url, { headers: { Accept: 'application/json' } }, 8000)
    console.log('[tokencard] dex response status:', res.status)
    if (!res.ok) {
      return { found: false }
    }
    var json = await res.json()
    console.log('[tokencard] pairs count:', json.pairs ? json.pairs.length : 0)

    var pair = pickBestPair(json.pairs, tickerFilter)
    if (!pair) {
      console.log('[tokencard] no pair found')
      var miss = { found: false }
      tokenCardCacheSet(cacheKey, miss, TOKENCARD_MISS_TTL)
      return miss
    }

    console.log('[tokencard] best pair:', pair.baseToken && pair.baseToken.symbol, pair.chainId)
    var result = normalizePair(pair)

    // Risk check (Solana only). Failures just leave the badge off.
    result.risk = await checkTokenRisk(result.chain, result.address)
    console.log('[tokencard] returning result for', result.symbol)

    tokenCardCacheSet(cacheKey, result, TOKENCARD_TTL)
    return result
  } catch (e) {
    console.error('[tokencard] ERROR:', e.message)
    return { found: false, error: sanitizeUserError(e.message) }
  }
})
