// js/tradingBot.js — Zephyr Trading Bot UI logic

var tradingBot = (function () {
  var ipc = window.ipc

  // State
  var currentTab = 'sniper'
  var botMode = false // false = agent, true = bot
  var selectedFee = 0.0001
  var selectedAutoSell = 0 // 0 = off, otherwise multiplier
  var positions = {} // mint -> { symbol, name, entryPrice, entryAmountSol, timestamp }
  var positionPollInterval = null
  var copyTradeActive = false
  var copyTradeWs = null
  var copyTradeWallet = null
  // Loaded from main-process .env via ipc('wallet:getHeliusKey') during init().
  // Stays empty until init runs; getRpcUrl() falls back to public RPC if so.
  var HELIUS_KEY = ''

  var botSettings = {
    rpc: 'helius',
    defaultSlippage: 10,
    defaultFee: 0.0005
  }

  // ---- Init ----

  function init () {
    loadSettings()
    loadHeliusKey()
    bindModeToggle()
    bindTabs()
    bindSniper()
    bindPositions()
    bindCopyTrade()
    bindSettings()
  }

  async function loadHeliusKey () {
    try {
      var res = await ipc.invoke('wallet:getHeliusKey')
      if (res && res.success && res.data && res.data.key) HELIUS_KEY = res.data.key
    } catch (e) {}
  }

  // ---- Mode Toggle (AGENT / BOT) ----

  function bindModeToggle () {
    var agentBtn = document.getElementById('agent-mode-agent-btn')
    var botBtn = document.getElementById('agent-mode-bot-btn')
    if (!agentBtn || !botBtn) return

    agentBtn.addEventListener('click', function () {
      setMode('agent')
    })

    botBtn.addEventListener('click', function () {
      setMode('bot')
    })
  }

  function setMode (mode) {
    botMode = mode === 'bot'
    var agentBtn = document.getElementById('agent-mode-agent-btn')
    var botBtn = document.getElementById('agent-mode-bot-btn')
    var panel = document.getElementById('agent-panel')
    var titleText = document.getElementById('agent-panel-title-text')
    var clearBtn = document.getElementById('agent-clear-btn')

    if (botMode) {
      if (agentBtn) agentBtn.classList.remove('active')
      if (botBtn) botBtn.classList.add('active')
      if (panel) panel.classList.add('bot-mode-active')
      if (titleText) titleText.textContent = 'Trading Bot'
      if (clearBtn) clearBtn.style.display = 'none'
      refreshPositions()
    } else {
      if (agentBtn) agentBtn.classList.add('active')
      if (botBtn) botBtn.classList.remove('active')
      if (panel) panel.classList.remove('bot-mode-active')
      if (titleText) titleText.textContent = 'Zephyr Agent'
      if (clearBtn) clearBtn.style.display = ''
    }
  }

  // ---- Tab Switching ----

  function bindTabs () {
    var tabs = document.querySelectorAll('.bot-tab')
    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        var target = tab.getAttribute('data-tab')
        switchTab(target)
      })
    })
  }

  var positionAutoRefreshTimer = null

  function switchTab (tabName) {
    currentTab = tabName
    document.querySelectorAll('.bot-tab').forEach(function (t) {
      t.classList.toggle('active', t.getAttribute('data-tab') === tabName)
    })
    document.querySelectorAll('.bot-tab-pane').forEach(function (p) {
      p.classList.toggle('active', p.id === 'bot-tab-' + tabName)
    })
    if (positionAutoRefreshTimer) { clearInterval(positionAutoRefreshTimer); positionAutoRefreshTimer = null }
    if (tabName === 'positions') {
      refreshPositions()
      positionAutoRefreshTimer = setInterval(refreshPositions, 30000)
    }
  }

  // ---- SNIPER TAB ----

  function bindSniper () {
    // Fee presets
    document.querySelectorAll('.bot-fee-preset').forEach(function (btn) {
      btn.addEventListener('click', function () {
        document.querySelectorAll('.bot-fee-preset').forEach(function (b) { b.classList.remove('active') })
        btn.classList.add('active')
        selectedFee = parseFloat(btn.getAttribute('data-fee'))
      })
    })

    // Auto-sell presets
    document.querySelectorAll('.bot-autosell-preset').forEach(function (btn) {
      btn.addEventListener('click', function () {
        document.querySelectorAll('.bot-autosell-preset').forEach(function (b) { b.classList.remove('active') })
        btn.classList.add('active')
        selectedAutoSell = parseFloat(btn.getAttribute('data-mult'))
      })
    })

    // Verify token
    var verifyBtn = document.getElementById('bot-sniper-verify-btn')
    if (verifyBtn) {
      verifyBtn.addEventListener('click', function () {
        var mint = document.getElementById('bot-sniper-mint').value.trim()
        if (!mint) return
        verifyToken(mint)
      })
    }

    // Buy
    var buyBtn = document.getElementById('bot-sniper-buy-btn')
    if (buyBtn) {
      buyBtn.addEventListener('click', function () {
        executeBuy()
      })
    }
  }

  async function verifyToken (mint) {
    var statusEl = document.getElementById('bot-sniper-status')
    var infoEl = document.getElementById('bot-sniper-token-info')
    showStatus(statusEl, 'Verifying token...', 'loading')
    try {
      var net = await getNetwork()
      var res = await ipc.invoke('wallet:verifyToken', { mintAddress: mint, network: net })
      if (!res.success || !res.data || !res.data.valid) {
        showStatus(statusEl, (res.data && res.data.error) || res.error || 'Token not found', 'error')
        infoEl.style.display = 'none'
        return
      }
      var d = res.data
      document.getElementById('bot-sniper-token-name').textContent = (d.name || '—') + (d.symbol ? ' (' + d.symbol + ')' : '')
      document.getElementById('bot-sniper-token-price').textContent = d.price ? '$' + d.price : '—'
      document.getElementById('bot-sniper-token-source').textContent = d.source || '—'
      infoEl.style.display = 'flex'
      showStatus(statusEl, 'Token verified — ' + (d.source || 'unknown'), 'success')
    } catch (e) {
      showStatus(statusEl, 'Error: ' + e.message, 'error')
    }
  }

  async function executeBuy () {
    var mint = document.getElementById('bot-sniper-mint').value.trim()
    var amountStr = document.getElementById('bot-sniper-amount').value.trim()
    var statusEl = document.getElementById('bot-sniper-status')
    var buyBtn = document.getElementById('bot-sniper-buy-btn')

    if (!mint) { showStatus(statusEl, 'Enter a mint address', 'error'); return }
    if (!amountStr || parseFloat(amountStr) <= 0) { showStatus(statusEl, 'Enter a valid SOL amount', 'error'); return }

    var amount = parseFloat(amountStr)
    buyBtn.disabled = true
    showStatus(statusEl, 'Buying ' + amount + ' SOL of token...', 'loading')

    try {
      var net = await getNetwork()
      var res = await ipc.invoke('wallet:buyToken', { mintAddress: mint, amountSol: amount, network: net })
      if (!res.success) {
        showStatus(statusEl, 'Buy failed: ' + res.error, 'error')
        buyBtn.disabled = false
        return
      }
      var d = res.data

      // Fetch entry price immediately after buy for accurate P&L tracking
      var entryPrice = null
      try {
        var priceRes = await ipc.invoke('wallet:getTokenInfo', { mintAddress: mint, network: net })
        if (priceRes.success && priceRes.data && priceRes.data.price) {
          entryPrice = parseFloat(priceRes.data.price)
        }
      } catch (e) {}

      recordPosition(mint, d.name || '?', d.symbol || mint.substring(0, 6), amount, d.outAmount, entryPrice)

      showStatus(statusEl, 'Bought! Tx: ' + d.signature.substring(0, 16) + '...', 'success')

      // Auto-sell setup
      if (selectedAutoSell > 0) {
        setupAutoSell(mint, amount, selectedAutoSell, net)
      }
    } catch (e) {
      showStatus(statusEl, 'Error: ' + e.message, 'error')
    }

    buyBtn.disabled = false
  }

  function recordPosition (mint, name, symbol, amountSol, outAmount, entryPrice) {
    if (positions[mint]) {
      // Accumulate — weighted average entry price
      var existing = positions[mint]
      var totalSol = existing.entryAmountSol + amountSol
      if (entryPrice && existing.entryPrice) {
        existing.entryPrice = ((existing.entryPrice * existing.entryAmountSol) + (entryPrice * amountSol)) / totalSol
      } else if (entryPrice) {
        existing.entryPrice = entryPrice
      }
      existing.entryAmountSol = totalSol
      existing.outAmount = (existing.outAmount || 0) + (outAmount || 0)
    } else {
      positions[mint] = {
        mint: mint,
        name: name,
        symbol: symbol,
        entryAmountSol: amountSol,
        outAmount: outAmount || 0,
        entryPrice: entryPrice || null,
        timestamp: Date.now()
      }
    }
    savePositions()
  }

  async function setupAutoSell (mint, buyAmountSol, multiplier, network) {
    var targetSol = buyAmountSol * multiplier
    var checkInterval = setInterval(async function () {
      try {
        var res = await ipc.invoke('wallet:getTokenInfo', { mintAddress: mint, network: network })
        if (!res.success || !res.data) return
        var price = parseFloat(res.data.price)
        if (!price) return

        // Estimate current value: outAmount * current price (rough)
        var pos = positions[mint]
        if (!pos) { clearInterval(checkInterval); return }

        // Simple heuristic: check if price has 10x from entry
        if (!pos.entryPrice) { pos.entryPrice = price; return }
        var mult = price / pos.entryPrice
        if (mult >= multiplier) {
          clearInterval(checkInterval)
          var sellRes = await ipc.invoke('wallet:sellToken', { mintAddress: mint, amountTokens: 100, network: network, usePercent: true })
          if (sellRes.success) {
            delete positions[mint]
            savePositions()
          }
        }
      } catch (e) {}
    }, 10000) // check every 10 seconds
  }

  // ---- POSITIONS TAB ----

  function bindPositions () {
    var refreshBtn = document.getElementById('bot-positions-refresh')
    if (refreshBtn) {
      refreshBtn.addEventListener('click', refreshPositions)
    }
  }

  async function refreshPositions () {
    var listEl = document.getElementById('bot-positions-list')
    var totalPnlEl = document.getElementById('bot-total-pnl')
    if (!listEl) return

    loadPositions()
    var mints = Object.keys(positions)

    if (mints.length === 0) {
      listEl.innerHTML = '<div class="bot-empty-state">No positions yet</div>'
      if (totalPnlEl) totalPnlEl.textContent = '—'
      return
    }

    listEl.innerHTML = '<div class="bot-empty-state">Loading...</div>'

    try {
      var net = await getNetwork()
      var totalPnl = 0
      var cards = []

      for (var i = 0; i < mints.length; i++) {
        var mint = mints[i]
        var pos = positions[mint]
        var card = await buildPositionCard(pos, net)
        cards.push({ el: card.el, pnl: card.pnl })
        totalPnl += card.pnl
      }

      listEl.innerHTML = ''
      cards.forEach(function (c) { listEl.appendChild(c.el) })

      if (totalPnlEl) {
        var sign = totalPnl >= 0 ? '+' : ''
        totalPnlEl.textContent = sign + totalPnl.toFixed(4) + ' SOL'
        totalPnlEl.className = 'bot-pnl-' + (totalPnl > 0 ? 'up' : totalPnl < 0 ? 'down' : 'neutral')
      }
    } catch (e) {
      listEl.innerHTML = '<div class="bot-empty-state">Failed to load</div>'
    }
  }

  async function buildPositionCard (pos, network) {
    var div = document.createElement('div')
    div.className = 'bot-position-card'

    var currentPrice = null
    var pnl = 0
    var mult = null
    var priceLabel = 'No price data'

    try {
      var infoRes = await ipc.invoke('wallet:getTokenInfo', { mintAddress: pos.mint, network: network })
      if (infoRes.success && infoRes.data && infoRes.data.price) {
        currentPrice = parseFloat(infoRes.data.price)
        if (pos.entryPrice && currentPrice) {
          mult = currentPrice / pos.entryPrice
          pnl = pos.entryAmountSol * (mult - 1)
          var pct = ((mult - 1) * 100)
          var pctSign = pct >= 0 ? '+' : ''
          priceLabel = pctSign + pct.toFixed(2) + '%  •  $' + formatPrice(currentPrice)
        } else {
          priceLabel = '$' + formatPrice(currentPrice)
        }
      }
    } catch (e) {}

    var pnlSign = pnl >= 0 ? '+' : ''
    var pnlClass = pnl > 0 ? 'bot-pnl-up' : pnl < 0 ? 'bot-pnl-down' : 'bot-pnl-neutral'
    var timeAgo = formatTimeAgo(pos.timestamp)

    div.innerHTML =
      '<div class="bot-position-header">' +
        '<span class="bot-position-symbol">' + (pos.symbol || '?') + '</span>' +
        '<span class="bot-position-pnl ' + pnlClass + '">' + pnlSign + pnl.toFixed(4) + ' SOL</span>' +
      '</div>' +
      '<div class="bot-position-meta">' +
        '<span>Bought ' + pos.entryAmountSol.toFixed(3) + ' SOL</span>' +
        '<span>' + timeAgo + '</span>' +
      '</div>' +
      '<div class="bot-position-meta">' +
        '<span class="bot-position-price ' + pnlClass + '">' + priceLabel + '</span>' +
      '</div>' +
      '<div class="bot-position-sell-btns">' +
        '<button class="bot-pos-sell-btn" data-mint="' + pos.mint + '" data-pct="25">25%</button>' +
        '<button class="bot-pos-sell-btn" data-mint="' + pos.mint + '" data-pct="50">50%</button>' +
        '<button class="bot-pos-sell-btn" data-mint="' + pos.mint + '" data-pct="100">100%</button>' +
      '</div>'

    div.querySelectorAll('.bot-pos-sell-btn').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        var pct = parseInt(btn.getAttribute('data-pct'))
        var mint = btn.getAttribute('data-mint')
        btn.disabled = true
        btn.textContent = '...'
        try {
          var net = await getNetwork()
          var res = await ipc.invoke('wallet:sellToken', { mintAddress: mint, amountTokens: pct, network: net, usePercent: true })
          if (res.success) {
            if (pct === 100) {
              delete positions[mint]
              savePositions()
            }
            refreshPositions()
          } else {
            btn.disabled = false
            btn.textContent = pct + '%'
          }
        } catch (e) {
          btn.disabled = false
          btn.textContent = pct + '%'
        }
      })
    })

    return { el: div, pnl: pnl }
  }

  // ---- COPY TRADE TAB ----

  function bindCopyTrade () {
    var startBtn = document.getElementById('bot-copy-start-btn')
    var stopBtn = document.getElementById('bot-copy-stop-btn')
    var clearLogBtn = document.getElementById('bot-copy-clear-log')

    if (startBtn) startBtn.addEventListener('click', function () { startCopyTrade() })
    if (stopBtn) stopBtn.addEventListener('click', function () { stopCopyTrade() })
    if (clearLogBtn) {
      clearLogBtn.addEventListener('click', function () {
        var logEl = document.getElementById('bot-copy-log')
        if (logEl) logEl.innerHTML = '<div class="bot-empty-state">No activity yet</div>'
      })
    }

    // Mode toggle (% vs fixed)
    document.querySelectorAll('.bot-copy-mode-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        copyMode = btn.getAttribute('data-mode')
        document.querySelectorAll('.bot-copy-mode-btn').forEach(function (b) { b.classList.remove('active') })
        btn.classList.add('active')
        document.getElementById('bot-copy-pct-section').style.display = copyMode === 'pct' ? '' : 'none'
        document.getElementById('bot-copy-fixed-section').style.display = copyMode === 'fixed' ? '' : 'none'
        if (copyTradeActive) { stopCopyTrade(); setTimeout(startCopyTrade, 300) }
      })
    })

    // Live previews
    var pctEl = document.getElementById('bot-copy-pct')
    var fixedEl = document.getElementById('bot-copy-max-sol')
    if (pctEl) pctEl.addEventListener('input', function () {
      var preview = document.getElementById('bot-copy-pct-preview')
      if (preview) preview.textContent = (1 * (parseFloat(pctEl.value) || 50) / 100).toFixed(3).replace(/0+$/, '').replace(/\.$/, '')
    })
    if (fixedEl) fixedEl.addEventListener('input', function () {
      var preview = document.getElementById('bot-copy-fixed-preview')
      if (preview) preview.textContent = fixedEl.value || '0.1'
    })

    // Restart on setting change while active
    var restartFields = ['bot-copy-wallet', 'bot-copy-pct', 'bot-copy-max-sol', 'bot-copy-sells']
    restartFields.forEach(function (id) {
      var el = document.getElementById(id)
      if (!el) return
      el.addEventListener('change', function () {
        if (copyTradeActive) { stopCopyTrade(); setTimeout(startCopyTrade, 300) }
      })
    })
  }

  var copyTradeIpcBound = false
  var copyMode = 'pct' // 'pct' or 'fixed' — module-scoped so startCopyTrade can read it

  async function startCopyTrade () {
    var walletInput = document.getElementById('bot-copy-wallet').value.trim()
    var pct = parseFloat(document.getElementById('bot-copy-pct').value) || 50
    var fixedSol = parseFloat(document.getElementById('bot-copy-max-sol').value) || 0.1
    var copySells = document.getElementById('bot-copy-sells') ? document.getElementById('bot-copy-sells').checked : false
    var statusEl = document.getElementById('bot-copy-status')

    if (!walletInput || walletInput.length < 32) {
      showStatus(statusEl, 'Enter a valid Solana wallet address', 'error')
      return
    }

    copyTradeWallet = walletInput
    copyTradeActive = true

    // Show active bar, hide start button
    var startBtn = document.getElementById('bot-copy-start-btn')
    var activeEl = document.getElementById('bot-copy-active')
    if (startBtn) startBtn.style.display = 'none'
    if (activeEl) {
      activeEl.style.display = 'flex'
      var watchLabel = document.getElementById('bot-copy-watching-label')
      if (watchLabel) watchLabel.textContent = 'Watching: ' + walletInput.substring(0, 8) + '...' + walletInput.slice(-4)
    }

    var net = await getNetwork()

    ipc.invoke('bot:startCopyTrade', {
      walletAddress: walletInput,
      copyMode: copyMode,  // 'pct' or 'fixed'
      buyPct: pct,
      fixedSol: fixedSol,
      copySells: copySells,
      network: net
    })

    // Bind IPC listener only once
    if (!copyTradeIpcBound) {
      copyTradeIpcBound = true
      window.ipc.on('bot:copyTradeEvent', function (event, data) {
        appendCopyLog(data)
      })
    }
  }

  function stopCopyTrade () {
    copyTradeActive = false
    copyTradeWallet = null

    var startBtn = document.getElementById('bot-copy-start-btn')
    var activeEl = document.getElementById('bot-copy-active')
    if (startBtn) startBtn.style.display = 'flex'
    if (activeEl) activeEl.style.display = 'none'

    ipc.invoke('bot:stopCopyTrade')
  }

  function appendCopyLog (data) {
    var logEl = document.getElementById('bot-copy-log')
    if (!logEl) return

    var emptyState = logEl.querySelector('.bot-empty-state')
    if (emptyState) emptyState.remove()

    var entry = document.createElement('div')
    var time = new Date().toLocaleTimeString()
    var mintShort = data.mint ? data.mint.substring(0, 8) + '...' : ''
    var label = ''

    if (data.action === 'buy') {
      entry.className = 'bot-copy-log-entry buy'
      label = 'BOUGHT ' + mintShort + ' — ' + (data.amountSol || '?') + ' SOL' +
        (data.signature ? ' ✓' : '')
    } else if (data.action === 'sell') {
      entry.className = 'bot-copy-log-entry sell'
      label = 'SOLD ' + mintShort + (data.amountSol ? ' → ' + data.amountSol + ' SOL' : '') +
        (data.signature ? ' ✓' : '')
    } else if (data.action === 'copying') {
      entry.className = 'bot-copy-log-entry loading'
      label = data.extra
        ? 'COPYING ' + mintShort + ' ' + data.extra + '...'
        : 'COPYING ' + mintShort + ' — ' + (data.amountSol || '?') + ' SOL...'
    } else if (data.action === 'skip') {
      entry.className = 'bot-copy-log-entry skip'
      label = 'SKIPPED ' + mintShort + (data.reason ? ' — ' + data.reason : '')
    } else if (data.action === 'error') {
      entry.className = 'bot-copy-log-entry error'
      label = 'ERROR' + (mintShort ? ' ' + mintShort : '') + (data.reason ? ' — ' + data.reason : '')
    } else if (data.action === 'info') {
      entry.className = 'bot-copy-log-entry info'
      label = data.reason || ''
    } else {
      entry.className = 'bot-copy-log-entry'
      label = (data.action || '').toUpperCase() + ' ' + mintShort
    }

    entry.textContent = '[' + time + '] ' + label
    logEl.insertBefore(entry, logEl.firstChild)

    // Record in positions if buy
    if (data.action === 'buy' && data.mint) {
      recordPosition(data.mint, data.name || '?', data.symbol || mintShort, data.amountSol || 0, null)
    }
    // Remove from positions if sell (copy-sell mirrors the watched wallet exiting)
    if (data.action === 'sell' && data.mint && positions[data.mint]) {
      delete positions[data.mint]
      savePositions()
      // Refresh the open Positions tab if it's the current view
      if (currentTab === 'positions') refreshPositions()
    }
  }

  // ---- SETTINGS TAB ----

  function bindSettings () {
    var saveBtn = document.getElementById('bot-settings-save')
    if (saveBtn) {
      saveBtn.addEventListener('click', saveSettings)
    }
  }

  function saveSettings () {
    var statusEl = document.getElementById('bot-settings-status')
    var rpc = document.querySelector('input[name="bot-rpc"]:checked')
    var slippage = document.getElementById('bot-default-slippage').value
    var fee = document.getElementById('bot-default-fee').value

    botSettings.rpc = rpc ? rpc.value : 'helius'
    botSettings.defaultSlippage = parseInt(slippage) || 10
    botSettings.defaultFee = parseFloat(fee) || 0.0005

    try {
      localStorage.setItem('bot_settings', JSON.stringify(botSettings))
      showStatus(statusEl, 'Settings saved', 'success')

      ipc.invoke('bot:updateRpc', { rpc: botSettings.rpc })
    } catch (e) {
      showStatus(statusEl, 'Failed to save: ' + e.message, 'error')
    }
  }

  function loadSettings () {
    try {
      var stored = localStorage.getItem('bot_settings')
      if (stored) {
        botSettings = Object.assign(botSettings, JSON.parse(stored))
        var rpcInput = document.getElementById('bot-rpc-' + botSettings.rpc)
        if (rpcInput) rpcInput.checked = true
        var slippageEl = document.getElementById('bot-default-slippage')
        if (slippageEl) slippageEl.value = botSettings.defaultSlippage
        var feeEl = document.getElementById('bot-default-fee')
        if (feeEl) feeEl.value = botSettings.defaultFee
      }
    } catch (e) {}
  }

  // ---- Positions Persistence ----

  function savePositions () {
    try { localStorage.setItem('bot_positions', JSON.stringify(positions)) } catch (e) {}
  }

  function loadPositions () {
    try {
      var stored = localStorage.getItem('bot_positions')
      if (stored) positions = JSON.parse(stored)
    } catch (e) {}
  }

  // ---- Helpers ----

  async function getNetwork () {
    try {
      var res = await ipc.invoke('wallet:getNetwork')
      return (res.success && res.data && res.data.network) ? res.data.network : 'mainnet-beta'
    } catch (e) { return 'mainnet-beta' }
  }

  function getRpcUrl (network) {
    if (botSettings.rpc === 'helius' && HELIUS_KEY) {
      var base = network === 'devnet' ? 'devnet' : 'mainnet'
      return 'https://' + base + '.helius-rpc.com/?api-key=' + HELIUS_KEY
    }
    return network === 'devnet' ? 'https://api.devnet.solana.com' : 'https://api.mainnet-beta.solana.com'
  }

  var statusTimers = {}

  function showStatus (el, msg, type) {
    if (!el) return
    el.textContent = msg
    el.className = 'bot-status ' + (type || '')
    el.style.display = 'block'

    // Auto-hide success/error after 5s; keep loading visible until resolved
    if (type !== 'loading') {
      var id = el.id || msg
      clearTimeout(statusTimers[id])
      statusTimers[id] = setTimeout(function () {
        el.style.display = 'none'
      }, 5000)
    }
  }

  function formatPrice (p) {
    if (!p || p === 0) return '0'
    if (p >= 1) return p.toFixed(4)
    if (p >= 0.0001) return p.toFixed(6)
    // For very small numbers show leading zeros clearly: $0.000001234
    var str = p.toFixed(12).replace(/0+$/, '')
    return str
  }

  function formatTimeAgo (ts) {
    var diff = Math.floor((Date.now() - ts) / 1000)
    if (diff < 60) return diff + 's ago'
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago'
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago'
    return Math.floor(diff / 86400) + 'd ago'
  }

  function reapplyMode () {
    setMode(botMode ? 'bot' : 'agent')
  }

  function isBotMode () {
    return botMode
  }

  return { init: init, setMode: setMode, reapplyMode: reapplyMode, isBotMode: isBotMode }
})()

document.addEventListener('DOMContentLoaded', function () {
  tradingBot.init()
})
