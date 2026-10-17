/* js/preload/tokenCards.js
   Token hover-cards: detects Solana mint addresses (base58) and $TICKERs in any
   webpage, underlines them, and shows a live data card on hover (price, market
   cap, liquidity, risk) with Trade / Chart / Copy actions.

   Detection wraps matches in spans via a TreeWalker (never touching innerHTML,
   so pages don't break). The card lives in a Shadow DOM host styled through
   adoptedStyleSheets, which keeps it immune to both the page's CSS and strict
   CSP rules. Data is fetched in the main process (tokenCardIPC.js). */

;(function () {
  // Internal pages don't need token cards.
  if (window.location.protocol === 'zephyr:') return

  // Solana mint addresses: 32-44 base58 chars (no 0, O, I, l)
  var ADDRESS_RE = /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/
  var TICKER_RE = /\$[A-Za-z][A-Za-z0-9]{1,9}\b/

  var HOVER_DELAY = 250 // ms before the card shows
  var HIDE_DELAY = 300 // grace period to move the mouse onto the card
  var MAX_MATCHES = 400 // per page, to protect perf on huge pages

  var matchCount = 0
  var hoverTimer = null
  var hideTimer = null
  var cardHost = null
  var cardRoot = null
  var activeTarget = null
  var lookupSeq = 0
  var lookupByTarget = new WeakMap() // target -> seq when lookup started

  // ---------- detection ----------

  function isSkippable (el) {
    var node = el
    while (node && node !== document.documentElement) {
      var tag = node.tagName
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' ||
          tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT' ||
          tag === 'svg' || tag === 'SVG') {
        return true
      }
      if (node.isContentEditable) return true
      if (node.dataset && node.dataset.zephyrTokenCard !== undefined) return true
      node = node.parentElement
    }
    return false
  }

  function styleTokenSpan (span) {
    // Styles applied directly (CSSOM) so strict page CSP can't strip them.
    span.style.borderBottom = '1px dashed rgba(113, 113, 123, 0.85)'
    span.style.cursor = 'pointer'
    span.style.textDecoration = 'none'
  }

  // Wrap every address/ticker occurrence inside one text node.
  function processTextNode (textNode) {
    if (matchCount >= MAX_MATCHES) return
    var text = textNode.nodeValue
    if (!text || text.length < 4 || text.length > 5000) return

    // Quick reject before the expensive work.
    if (text.indexOf('$') === -1 && !ADDRESS_RE.test(text)) return

    var combined = new RegExp(ADDRESS_RE.source + '|' + TICKER_RE.source, 'g')
    var match
    var last = 0
    var frag = null

    while ((match = combined.exec(text)) !== null) {
      if (matchCount >= MAX_MATCHES) break

      var token = match[0]
      var isAddress = token.charAt(0) !== '$'

      // skip pure-uppercase noise like "$USD" amounts is hard to distinguish;
      // accept and rely on the lookup returning "not found" for non-tokens.
      if (!frag) frag = document.createDocumentFragment()

      if (match.index > last) {
        frag.appendChild(document.createTextNode(text.slice(last, match.index)))
      }

      var span = document.createElement('span')
      span.textContent = token
      span.dataset.zephyrToken = isAddress ? token : token.slice(1) // strip $
      span.dataset.zephyrTokenType = isAddress ? 'address' : 'ticker'
      styleTokenSpan(span)
      frag.appendChild(span)

      last = match.index + token.length
      matchCount++
    }

    if (frag) {
      if (last < text.length) {
        frag.appendChild(document.createTextNode(text.slice(last)))
      }
      if (textNode.parentNode) {
        textNode.parentNode.replaceChild(frag, textNode)
      }
    }
  }

  function scan (root) {
    if (matchCount >= MAX_MATCHES) return
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        var parent = node.parentElement
        if (!parent || isSkippable(parent)) return NodeFilter.FILTER_REJECT
        return NodeFilter.FILTER_ACCEPT
      }
    })

    // Collect first — mutating while walking confuses the TreeWalker.
    var nodes = []
    var n
    while ((n = walker.nextNode())) {
      nodes.push(n)
      if (nodes.length > 3000) break
    }
    nodes.forEach(processTextNode)
  }

  // ---------- card UI ----------

  var CARD_CSS = [
    ':host { all: initial; }',
    '.zc-card {',
    '  position: fixed; z-index: 2147483647; width: 300px;',
    '  background: #ffffff; color: #111;',
    '  border: 1px solid #d6d8dc; border-radius: 14px;',
    '  box-shadow: 0 12px 40px rgba(0,0,0,0.18);',
    '  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;',
    '  font-size: 13px; line-height: 1.45; padding: 14px;',
    '  animation: zc-in 0.12s ease-out;',
    '}',
    '@keyframes zc-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }',
    '.zc-head { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }',
    '.zc-avatar {',
    '  width: 34px; height: 34px; border-radius: 50%; background: #111; color: #fff;',
    '  display: flex; align-items: center; justify-content: center;',
    '  font-weight: 700; font-size: 15px; flex-shrink: 0;',
    '}',
    '.zc-title { flex: 1; min-width: 0; }',
    '.zc-symbol { font-weight: 700; font-size: 15px; }',
    '.zc-name { color: #6b7280; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
    '.zc-badge { font-size: 10.5px; font-weight: 700; padding: 3px 8px; border-radius: 10px; white-space: nowrap; }',
    '.zc-badge.low { background: #e4f7ea; color: #146c2e; }',
    '.zc-badge.medium { background: #fff4d6; color: #8a6d00; }',
    '.zc-badge.high { background: #fdecea; color: #b3261e; }',
    '.zc-price-row { display: flex; align-items: baseline; gap: 8px; margin-bottom: 10px; }',
    '.zc-price { font-size: 19px; font-weight: 700; }',
    '.zc-change { font-size: 12.5px; font-weight: 600; }',
    '.zc-change.up { color: #0f9d58; }',
    '.zc-change.down { color: #d93025; }',
    '.zc-rows { border-top: 1px solid #eceef1; padding-top: 8px; margin-bottom: 10px; }',
    '.zc-row { display: flex; justify-content: space-between; padding: 2.5px 0; }',
    '.zc-row .k { color: #6b7280; }',
    '.zc-row .v { font-weight: 600; }',
    '.zc-warn { font-size: 11.5px; color: #b3261e; margin: -4px 0 8px; }',
    '.zc-actions { display: flex; gap: 7px; }',
    '.zc-btn {',
    '  flex: 1; border: 1px solid #d6d8dc; border-radius: 9px; background: #fff;',
    '  color: #111; font-size: 12.5px; font-weight: 600; padding: 7px 0;',
    '  cursor: pointer; text-align: center; font-family: inherit;',
    '  appearance: none; -webkit-appearance: none;',
    '}',
    '.zc-btn:hover { background: #f1f3f5; }',
    '.zc-btn.primary { background: #111; border-color: #111; color: #fff; }',
    '.zc-btn.primary:hover { background: #000; }',
    '.zc-loading { display: flex; align-items: center; gap: 8px; color: #6b7280; padding: 4px 0; }',
    '.zc-spin {',
    '  width: 14px; height: 14px; border: 2px solid #d6d8dc; border-top-color: #111;',
    '  border-radius: 50%; animation: zc-rot 0.7s linear infinite;',
    '}',
    '@keyframes zc-rot { to { transform: rotate(360deg); } }',
    '.zc-chain { text-transform: capitalize; }'
  ].join('\n')

  function ensureCard () {
    if (cardHost && document.documentElement.contains(cardHost)) return
    cardHost = document.createElement('div')
    cardHost.dataset.zephyrTokenCard = ''
    cardRoot = cardHost.attachShadow({ mode: 'closed' })

    try {
      var sheet = new CSSStyleSheet()
      sheet.replaceSync(CARD_CSS)
      cardRoot.adoptedStyleSheets = [sheet]
    } catch (e) {
      // very old engines: fall back to a <style> tag
      var styleEl = document.createElement('style')
      styleEl.textContent = CARD_CSS
      cardRoot.appendChild(styleEl)
    }

    document.documentElement.appendChild(cardHost)
  }

  function positionCard (card, targetRect) {
    var pad = 8
    var w = 300
    var x = Math.min(Math.max(targetRect.left, pad), window.innerWidth - w - pad)
    card.style.left = x + 'px'

    // Prefer below the token; flip above if there's no room.
    var estimatedH = 240
    if (targetRect.bottom + estimatedH + pad < window.innerHeight) {
      card.style.top = (targetRect.bottom + 6) + 'px'
    } else {
      card.style.top = Math.max(pad, targetRect.top - estimatedH - 6) + 'px'
    }
  }

  function hideCard () {
    if (cardRoot) {
      var existing = cardRoot.querySelector('.zc-card')
      if (existing) existing.remove()
    }
    activeTarget = null
  }

  function el (tag, className, text) {
    var node = document.createElement(tag)
    if (className) node.className = className
    if (text !== undefined) node.textContent = text
    return node
  }

  function renderLoading (rect) {
    ensureCard()
    hideCard()
    var card = el('div', 'zc-card')
    var loading = el('div', 'zc-loading')
    loading.appendChild(el('div', 'zc-spin'))
    loading.appendChild(el('span', null, 'Looking up token…'))
    card.appendChild(loading)
    bindCardHover(card)
    cardRoot.appendChild(card)
    positionCard(card, rect)
    return card
  }

  function renderCard (data, rect, rawToken) {
    ensureCard()
    hideCard()

    var card = el('div', 'zc-card')

    // header
    var head = el('div', 'zc-head')
    head.appendChild(el('div', 'zc-avatar', (data.symbol || '?').charAt(0).toUpperCase()))
    var title = el('div', 'zc-title')
    title.appendChild(el('div', 'zc-symbol', data.symbol || '?'))
    title.appendChild(el('div', 'zc-name', data.name || ''))
    head.appendChild(title)
    if (data.risk) {
      var labels = { low: 'LOW RISK', medium: 'CAUTION', high: 'HIGH RISK' }
      head.appendChild(el('span', 'zc-badge ' + data.risk.level, labels[data.risk.level]))
    }
    card.appendChild(head)

    // price
    if (data.price) {
      var priceRow = el('div', 'zc-price-row')
      priceRow.appendChild(el('span', 'zc-price', data.price))
      if (data.change24h !== null && isFinite(data.change24h)) {
        var up = data.change24h >= 0
        priceRow.appendChild(el('span', 'zc-change ' + (up ? 'up' : 'down'),
          (up ? '▲ +' : '▼ ') + data.change24h.toFixed(1) + '% (24h)'))
      }
      card.appendChild(priceRow)
    }

    // risk reasons (top one only, keep the card tight)
    if (data.risk && data.risk.level !== 'low' && data.risk.reasons.length) {
      card.appendChild(el('div', 'zc-warn', '⚠ ' + data.risk.reasons[0]))
    }

    // stat rows
    var rows = el('div', 'zc-rows')
    var stats = [
      ['Market cap', data.marketCap],
      ['Liquidity', data.liquidity],
      ['Volume 24h', data.volume24h],
      ['Age', data.age],
      ['Chain', data.chain ? data.chain : null]
    ]
    stats.forEach(function (s) {
      if (!s[1]) return
      var row = el('div', 'zc-row')
      row.appendChild(el('span', 'k', s[0]))
      var v = el('span', 'v', s[1])
      if (s[0] === 'Chain') v.classList.add('zc-chain')
      row.appendChild(v)
      rows.appendChild(row)
    })
    card.appendChild(rows)

    // actions
    var actions = el('div', 'zc-actions')

    if (data.chain === 'solana' && data.address) {
      var tradeBtn = el('button', 'zc-btn primary', 'Trade')
      tradeBtn.addEventListener('click', function () {
        ipc.send('tokenCardTrade', {
          symbol: data.symbol,
          name: data.name,
          address: data.address,
          chain: data.chain
        })
        hideCard()
      })
      actions.appendChild(tradeBtn)
    }

    if (data.pairUrl) {
      var chartBtn = el('button', 'zc-btn', 'Chart')
      chartBtn.addEventListener('click', function () {
        window.open(data.pairUrl)
        hideCard()
      })
      actions.appendChild(chartBtn)
    }

    if (data.address) {
      var copyBtn = el('button', 'zc-btn', 'Copy')
      copyBtn.addEventListener('click', function () {
        try {
          navigator.clipboard.writeText(data.address)
          copyBtn.textContent = 'Copied ✓'
          setTimeout(function () { copyBtn.textContent = 'Copy' }, 1200)
        } catch (e) {}
      })
      actions.appendChild(copyBtn)
    }

    if (actions.children.length) card.appendChild(actions)

    bindCardHover(card)
    cardRoot.appendChild(card)
    positionCard(card, rect)
  }

  function bindCardHover (card) {
    // Keep the card open while the mouse is over it.
    card.addEventListener('mouseenter', function () {
      clearTimeout(hideTimer)
    })
    card.addEventListener('mouseleave', function () {
      scheduleHide()
    })
  }

  function scheduleHide () {
    clearTimeout(hideTimer)
    hideTimer = setTimeout(hideCard, HIDE_DELAY)
  }

  // ---------- hover wiring ----------

  var inflightTarget = null // target currently being fetched — don't restart for same target

  async function lookupAndShow (target) {
    if (inflightTarget === target) return // already fetching this one
    inflightTarget = target

    var rect = target.getBoundingClientRect()
    var seq = ++lookupSeq
    lookupByTarget.set(target, seq)
    activeTarget = target

    renderLoading(rect)

    var result
    try {
      var lookupPromise = ipc.invoke('tokencard:lookup', {
        type: target.dataset.zephyrTokenType,
        query: target.dataset.zephyrToken
      })
      var timeoutPromise = new Promise(function (resolve) {
        setTimeout(function () { resolve({ found: false, timedOut: true }) }, 10000)
      })
      result = await Promise.race([lookupPromise, timeoutPromise])
    } catch (e) {
      result = { found: false }
    } finally {
      if (inflightTarget === target) inflightTarget = null
    }

    // Discard if a newer lookup for this same target was started
    if (lookupByTarget.get(target) !== seq) return

    if (!result || !result.found) {
      hideCard()
      target.dataset.zephyrTokenMiss = '1'
      target.style.borderBottom = 'none'
      target.style.cursor = ''
      return
    }

    renderCard(result, rect, target.dataset.zephyrToken)
  }

  document.addEventListener('mouseover', function (e) {
    var t = e.target
    // Only react to our span elements, never to the card itself
    if (!t || !t.dataset || t.dataset.zephyrToken === undefined || t.dataset.zephyrTokenMiss) return
    if (t === inflightTarget) return // already in flight for this span

    clearTimeout(hoverTimer)
    clearTimeout(hideTimer)
    hoverTimer = setTimeout(function () {
      lookupAndShow(t)
    }, HOVER_DELAY)
  }, true)

  document.addEventListener('mouseout', function (e) {
    var t = e.target
    if (!t || !t.dataset || t.dataset.zephyrToken === undefined) return
    clearTimeout(hoverTimer)
    scheduleHide()
  }, true)

  window.addEventListener('scroll', function () {
    hideCard()
  }, { passive: true, capture: true })

  // ---------- boot + dynamic content ----------

  var scanScheduled = false
  function scheduleScan (root) {
    if (scanScheduled || matchCount >= MAX_MATCHES) return
    scanScheduled = true
    var run = function () {
      scanScheduled = false
      try { scan(root || document.body) } catch (e) {}
    }
    if (window.requestIdleCallback) {
      window.requestIdleCallback(run, { timeout: 2000 })
    } else {
      setTimeout(run, 500)
    }
  }

  function start () {
    if (!document.body) return
    scheduleScan(document.body)

    var pending = false
    var observer = new MutationObserver(function () {
      if (pending || matchCount >= MAX_MATCHES) return
      pending = true
      setTimeout(function () {
        pending = false
        scheduleScan(document.body)
      }, 600)
    })
    observer.observe(document.body, { childList: true, subtree: true })
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start)
  } else {
    start()
  }
})()
