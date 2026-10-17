// Mixer Panel UI Controller
const mixerAPI = require('./mixerAPI.js')
const webviews = require('./webviews.js')

const mixerPanel = {
  panel: null,
  isOpen: false,
  currentPair: 'sol|sol usdt|eth', // Format: "fromCurrency|fromNetwork toCurrency|toNetwork"
  amount: '',
  walletAddress: '',
  availablePairs: [],
  minAmount: '',
  estimatedAmount: '',
  isEstimating: false,
  isLoading: false,
  panelWidth: 450,

  // Order state
  orderData: null,
  timeRemaining: null,
  timerInterval: null,
  statusInterval: null,

  // DOM Elements
  elements: {},

  initialize: function () {
    // console.log('Mixer Panel: Initializing...')

    // Get DOM elements
    this.panel = document.getElementById('mixer-panel')

    this.elements = {
      closeBtn: document.getElementById('mixer-panel-close'),
      pairSelect: document.getElementById('mixer-pair-select'),
      amountInput: document.getElementById('mixer-amount-input'),
      addressInput: document.getElementById('mixer-receiving-address'),
      estimatedAmount: document.getElementById('mixer-estimated-amount'),
      minAmountText: document.getElementById('mixer-min-amount'),
      createOrderBtn: document.getElementById('mixer-create-order'),
      errorMessage: document.getElementById('mixer-error-message'),

      // Order view elements
      orderView: document.getElementById('mixer-order-view'),
      formView: document.getElementById('mixer-form-view'),
      orderId: document.getElementById('mixer-order-id'),
      sendAmount: document.getElementById('mixer-send-amount'),
      sendAddress: document.getElementById('mixer-send-address'),
      receiveAmount: document.getElementById('mixer-receive-amount'),
      timeRemainingText: document.getElementById('mixer-time-remaining'),
      progressBar: document.getElementById('mixer-progress-bar'),
      statusText: document.getElementById('mixer-status-text'),
      statusSteps: document.getElementById('mixer-status-steps'),
      cancelBtn: document.getElementById('mixer-cancel-order'),
      refreshBtn: document.getElementById('mixer-refresh-status'),
      copyOrderId: document.getElementById('mixer-copy-order-id'),
      copySendAddress: document.getElementById('mixer-copy-send-address')
    }

    // Event listeners
    this.elements.closeBtn.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      this.close()
    })

    this.elements.pairSelect.addEventListener('change', () => this.onPairChange())
    this.elements.amountInput.addEventListener('input', () => this.onAmountChange())
    this.elements.createOrderBtn.addEventListener('click', () => this.createOrder())
    this.elements.cancelBtn.addEventListener('click', () => this.cancelOrder())
    this.elements.refreshBtn.addEventListener('click', () => this.checkStatus(true))
    this.elements.copyOrderId.addEventListener('click', () => this.copyText(this.orderData.id, 'orderId'))
    this.elements.copySendAddress.addEventListener('click', () => this.copyText(this.orderData.payinAddress, 'sendAddress'))

    // Load available pairs
    this.loadAvailablePairs()

    // Check for existing order
    this.checkExistingOrder()

    // console.log('Mixer Panel: Initialization complete')
  },

  open: function () {
    // console.log('Mixer Panel: Opening...')

    if (this.panel) {
      this.panel.classList.add('active')
    }

    this.isOpen = true

    // Push webviews to the left to make room for the mixer panel from the right
    webviews.adjustMargin([0, this.panelWidth, 0, 0])

    // Load pairs if not already loaded
    if (this.availablePairs.length === 0) {
      this.loadAvailablePairs()
    }
  },

  close: function () {
    // console.log('Mixer Panel: Closing...')
    if (this.panel) {
      this.panel.classList.remove('active')
    }

    this.isOpen = false

    // Pull webviews back to original position
    webviews.adjustMargin([0, this.panelWidth * -1, 0, 0])

    // Clear intervals
    if (this.timerInterval) clearInterval(this.timerInterval)
    if (this.statusInterval) clearInterval(this.statusInterval)
  },

  toggle: function () {
    if (this.isOpen) {
      this.close()
    } else {
      this.open()
    }
  },

  async loadAvailablePairs() {
    try {
      const result = await mixerAPI.getAvailableCurrencies(false, true)

      if (result.success && result.data) {
        const currencies = result.data

        // Create pairs following your React logic (Phase 1, 2, 3)
        const pairs = this.createPairsFromCurrencies(currencies)

        this.availablePairs = pairs
        this.populatePairSelect()
      } else {
        console.error('Failed to load currencies:', result.error)
        this.useFallbackPairs()
      }
    } catch (error) {
      console.error('Error loading currencies:', error)
      this.useFallbackPairs()
    }
  },

  createPairsFromCurrencies(currencies) {
    // Helper function to parse token pair string
    const parseTokenPair = (pairString) => {
      const [from, to] = pairString.split(' ')
      const [fromCurrency, fromNetwork] = from.split('|')
      const [toCurrency, toNetwork] = to.split('|')
      return { fromCurrency, fromNetwork, toCurrency, toNetwork }
    }

    // Popular tickers to focus on
    const popularTickers = [
      'sol', 'btc', 'eth', 'usdt', 'usdc', 'bnb', 'ada', 'xrp', 'dot', 'ltc',
      'link', 'matic', 'avax', 'atom', 'xlm', 'algo', 'etc', 'xmr', 'icp', 'vet'
    ]

    // Group currencies by ticker
    const currencyGroups = {}
    currencies.forEach((currency) => {
      const ticker = currency.ticker.toLowerCase()
      if (!currencyGroups[ticker]) {
        currencyGroups[ticker] = []
      }
      currencyGroups[ticker].push({
        ticker,
        network: currency.network.toLowerCase(),
        name: currency.name
      })
    })

    // Create all possible pairs (ticker + network combinations)
    const pairsArray = []
    Object.keys(currencyGroups).forEach((fromTicker) => {
      currencyGroups[fromTicker].forEach((fromCurrency) => {
        Object.keys(currencyGroups).forEach((toTicker) => {
          if (fromTicker !== toTicker) {
            currencyGroups[toTicker].forEach((toCurrency) => {
              pairsArray.push(
                `${fromCurrency.ticker}|${fromCurrency.network} ${toCurrency.ticker}|${toCurrency.network}`
              )
            })
          }
        })
      })
    })

    // PHASE 1: Same-chain Foundation - Solana first, then BTC/ETH/Base
    const phase1Pairs = pairsArray.filter((pair) => {
      const { fromCurrency, fromNetwork, toCurrency, toNetwork } = parseTokenPair(pair)

      // SOL Ecosystem - Native Solana token swaps (highest volume, lowest friction)
      const solToSolStables = fromCurrency === 'sol' && fromNetwork === 'sol' &&
        ['usdt', 'usdc'].includes(toCurrency) && toNetwork === 'sol'

      const solStablesToSol = ['usdt', 'usdc'].includes(fromCurrency) && fromNetwork === 'sol' &&
        toCurrency === 'sol' && toNetwork === 'sol'

      const solEcosystem = solToSolStables || solStablesToSol

      // BTC Pairs
      const btcToStables = fromCurrency === 'btc' && fromNetwork === 'btc' &&
        ['usdt', 'usdc'].includes(toCurrency)

      const stablesToBtc = ['usdt', 'usdc'].includes(fromCurrency) &&
        toCurrency === 'btc' && toNetwork === 'btc'

      const btcPairs = btcToStables || stablesToBtc

      // ETH Ecosystem
      const ethToStables = fromCurrency === 'eth' && fromNetwork === 'eth' &&
        ['usdt', 'usdc'].includes(toCurrency) && toNetwork === 'eth'

      const stablesToEth = ['usdt', 'usdc'].includes(fromCurrency) && fromNetwork === 'eth' &&
        toCurrency === 'eth' && toNetwork === 'eth'

      const ethEcosystem = ethToStables || stablesToEth

      // Base Network - L2 scaling solution, fast and cheap
      const baseSwaps = fromNetwork === 'base' && toNetwork === 'base' &&
        ['eth', 'usdt', 'usdc'].includes(fromCurrency) && ['eth', 'usdt', 'usdc'].includes(toCurrency)

      return solEcosystem || btcPairs || ethEcosystem || baseSwaps
    })

    // PHASE 2: Network Expansion - Cross-network for stables (less scary, same asset)
    const phase2Pairs = pairsArray.filter((pair) => {
      const { fromCurrency, fromNetwork, toCurrency, toNetwork } = parseTokenPair(pair)

      // Stablecoin cross-network swaps - Same token, different network
      const stablecoinSwaps = ['usdt', 'usdc'].includes(fromCurrency) &&
        fromCurrency === toCurrency && fromNetwork !== toNetwork

      // All ERC20 pairs (Ethereum network)
      const allERC20 = fromNetwork === 'eth' && toNetwork === 'eth' &&
        popularTickers.includes(fromCurrency) && popularTickers.includes(toCurrency)

      // All Base network pairs
      const allBase = fromNetwork === 'base' && toNetwork === 'base' &&
        popularTickers.includes(fromCurrency) && popularTickers.includes(toCurrency)

      // BNB Chain pairs
      const bnbChainPairs = fromNetwork === 'bsc' && toNetwork === 'bsc' &&
        ['bnb', 'usdt', 'usdc', 'eth'].includes(fromCurrency) && ['bnb', 'usdt', 'usdc', 'eth'].includes(toCurrency)

      return stablecoinSwaps || allERC20 || allBase  || bnbChainPairs
    })

    // PHASE 3: Cross-chain — SOL to/from other networks
    const phase3Pairs = pairsArray.filter((pair) => {
      const { fromCurrency, fromNetwork, toCurrency, toNetwork } = parseTokenPair(pair)

      // SOL to everything (Solana is fast and people love it)
      const solToEverything = fromCurrency === 'sol' && fromNetwork === 'sol' &&
        popularTickers.includes(toCurrency) && toNetwork !== 'sol'

      const everythingToSol = popularTickers.includes(fromCurrency) && fromNetwork !== 'sol' &&
        toCurrency === 'sol' && toNetwork === 'sol'

      return solToEverything || everythingToSol
    })

    // PHASE 4: Altcoin Paradise - Top 20 altcoins get full access
    // const phase4Pairs = pairsArray.filter((pair) => {
    //   const { fromCurrency, fromNetwork, toCurrency, toNetwork } = parseTokenPair(pair)
    //
    //   const topAltcoins = ['ada', 'xrp', 'dot', 'ltc', 'link', 'matic', 'avax', 'atom']
    //
    //   const altcoinToAltcoin = topAltcoins.includes(fromCurrency) && topAltcoins.includes(toCurrency)
    //   const altcoinToStable = topAltcoins.includes(fromCurrency) && ['usdt', 'usdc'].includes(toCurrency)
    //   const stableToAltcoin = ['usdt', 'usdc'].includes(fromCurrency) && topAltcoins.includes(toCurrency)
    //
    //   return altcoinToAltcoin || altcoinToStable || stableToAltcoin
    // })

    // PHASE 5: Meme Season - Let the degens play
    // const phase5Pairs = pairsArray.filter((pair) => {
    //   const { fromCurrency, fromNetwork, toCurrency, toNetwork } = parseTokenPair(pair)
    //
    //   const memeCoins = ['doge', 'shib', 'pepe', 'floki', 'bonk']
    //   const isMeme = memeCoins.includes(fromCurrency) || memeCoins.includes(toCurrency)
    //
    //   return isMeme
    // })

    // PHASE 6: The Wild West - Everything else
    // const phase6Pairs = pairsArray.filter((pair) => {
    //   const { fromCurrency, fromNetwork, toCurrency, toNetwork } = parseTokenPair(pair)
    //
    //   // Rare pairs and exotic tokens
    //   const isRare = !popularTickers.includes(fromCurrency) || !popularTickers.includes(toCurrency)
    //
    //   return isRare
    // })

    // Combine active phases
    const activePairs = [...new Set([
      ...phase1Pairs,
      ...phase2Pairs,
      ...phase3Pairs
      // ...phase4Pairs,
      // ...phase5Pairs,
      // ...phase6Pairs
    ])]

    // Convert to label format
    const networkLabels = {
      'base': 'Base',
      'eth': 'ERC20',
      'arb': 'Arbitrum',
      'op': 'Optimism',
      'matic': 'Polygon',
      'avax': 'Avalanche',
      'bsc': 'BEP20',
      'btc': 'Bitcoin',
      'trx': 'TRC20',
      'ftm': 'Fantom',
      'sol': 'Solana'
    }

    return activePairs.map(pairString => {
      const { fromCurrency, fromNetwork, toCurrency, toNetwork } = parseTokenPair(pairString)
      const fromLabel = fromNetwork === fromCurrency ? fromCurrency.toUpperCase() :
        `${fromCurrency.toUpperCase()} (${networkLabels[fromNetwork] || fromNetwork.toUpperCase()})`
      const toLabel = toNetwork === toCurrency ? toCurrency.toUpperCase() :
        `${toCurrency.toUpperCase()} (${networkLabels[toNetwork] || toNetwork.toUpperCase()})`

      return {
        from: `${fromCurrency}|${fromNetwork}`,
        to: `${toCurrency}|${toNetwork}`,
        label: `${fromLabel} → ${toLabel}`
      }
    })
  },

  useFallbackPairs() {
    this.availablePairs = [
      { from: 'sol|sol', to: 'usdt|eth', label: 'SOL → USDT (ERC20)' },
      { from: 'sol|sol', to: 'eth|eth', label: 'SOL → ETH' },
      { from: 'btc|btc', to: 'usdt|eth', label: 'BTC → USDT (ERC20)' }
    ]
    this.populatePairSelect()
  },

  populatePairSelect() {
    this.elements.pairSelect.innerHTML = ''

    this.availablePairs.forEach(pair => {
      const option = document.createElement('option')
      option.value = `${pair.from} ${pair.to}`
      option.textContent = pair.label
      this.elements.pairSelect.appendChild(option)
    })

    // Set first pair as default
    if (this.availablePairs.length > 0) {
      this.currentPair = `${this.availablePairs[0].from} ${this.availablePairs[0].to}`
      this.elements.pairSelect.value = this.currentPair
      this.updateMinimumAmount()
    }
  },

  parsePair(pairString) {
    const [from, to] = pairString.split(' ')
    const [fromCurrency, fromNetwork] = from.split('|')
    const [toCurrency, toNetwork] = to.split('|')
    return { fromCurrency, fromNetwork, toCurrency, toNetwork }
  },

  async updateMinimumAmount() {
    const { fromCurrency, fromNetwork, toCurrency, toNetwork } = this.parsePair(this.currentPair)

    try {
      const result = await mixerAPI.getMinimumExchangeAmount(
        fromCurrency,
        toCurrency,
        fromNetwork,
        toNetwork
      )

      if (result.success && result.data) {
        this.minAmount = result.data.minAmount || result.data
        this.elements.minAmountText.textContent = `Min: ${this.minAmount} ${fromCurrency.toUpperCase()}`
      }
    } catch (error) {
      console.error('Error getting minimum amount:', error)
    }
  },

  onPairChange() {
    this.currentPair = this.elements.pairSelect.value
    this.updateMinimumAmount()

    // Recalculate estimate if amount is entered
    if (this.amount && parseFloat(this.amount) > 0) {
      this.getEstimate()
    } else {
      this.elements.estimatedAmount.textContent = '-'
    }
  },

  onAmountChange() {
    this.amount = this.elements.amountInput.value

    // Clear error
    this.hideError()

    // Debounce estimate request
    if (this.estimateTimeout) clearTimeout(this.estimateTimeout)

    if (this.amount && parseFloat(this.amount) > 0) {
      this.estimateTimeout = setTimeout(() => this.getEstimate(), 500)
    } else {
      this.elements.estimatedAmount.textContent = '-'
    }
  },

  async getEstimate() {
    if (!this.amount || parseFloat(this.amount) <= 0) {
      this.elements.estimatedAmount.textContent = '-'
      return
    }

    this.isEstimating = true
    const { fromCurrency, fromNetwork, toCurrency, toNetwork } = this.parsePair(this.currentPair)

    try {
      const result = await mixerAPI.getEstimatedExchange(
        fromCurrency,
        toCurrency,
        fromNetwork,
        toNetwork,
        parseFloat(this.amount),
        'standard'
      )

      if (result.success && result.data) {
        this.estimatedAmount = result.data.toAmount || result.data.estimatedAmount
        this.elements.estimatedAmount.textContent = `≈ ${this.estimatedAmount} ${toCurrency.toUpperCase()}`
      } else {
        this.elements.estimatedAmount.textContent = '-'
      }
    } catch (error) {
      console.error('Error getting estimate:', error)
      this.elements.estimatedAmount.textContent = '-'
    } finally {
      this.isEstimating = false
    }
  },

  async createOrder() {
    // Validate inputs
    this.walletAddress = this.elements.addressInput.value.trim()
    this.amount = this.elements.amountInput.value

    if (!this.amount || parseFloat(this.amount) <= 0) {
      this.showError('Please enter a valid amount')
      return
    }

    if (this.minAmount && parseFloat(this.amount) < parseFloat(this.minAmount)) {
      const { fromCurrency } = this.parsePair(this.currentPair)
      this.showError(`Minimum amount is ${this.minAmount} ${fromCurrency.toUpperCase()}`)
      return
    }

    if (!this.walletAddress) {
      this.showError('Please enter a receiving wallet address')
      return
    }

    this.isLoading = true
    this.elements.createOrderBtn.disabled = true
    this.elements.createOrderBtn.textContent = 'Creating Order...'

    try {
      const { fromCurrency, fromNetwork, toCurrency, toNetwork } = this.parsePair(this.currentPair)

      const result = await mixerAPI.createExchange({
        fromCurrency,
        toCurrency,
        fromNetwork,
        toNetwork,
        fromAmount: parseFloat(this.amount),
        address: this.walletAddress
      })

      if (result.success && result.data) {
        this.orderData = {
          id: result.data.id,
          payinAddress: result.data.payinAddress,
          status: result.data.status,
          toAmount: result.data.toAmount,
          fromAmount: this.amount,
          fromCurrency: fromCurrency.toUpperCase(),
          toCurrency: toCurrency.toUpperCase(),
          createdAt: Date.now()
        }

        // Save to localStorage
        localStorage.setItem('mixer_order', JSON.stringify(this.orderData))

        this.showOrderView()
        this.startTimers()
      } else {
        this.showError(result.error || 'Failed to create order')
      }
    } catch (error) {
      console.error('Error creating order:', error)
      this.showError('Failed to create order. Please try again.')
    } finally {
      this.isLoading = false
      this.elements.createOrderBtn.disabled = false
      this.elements.createOrderBtn.textContent = 'Create Order'
    }
  },

  showOrderView() {
    this.elements.formView.style.display = 'none'
    this.elements.orderView.style.display = 'flex'

    // Populate order details
    this.elements.orderId.textContent = this.orderData.id.substring(0, 12) + '...'
    this.elements.sendAmount.textContent = `${this.orderData.fromAmount} ${this.orderData.fromCurrency}`
    this.elements.sendAddress.textContent = this.orderData.payinAddress.substring(0, 8) + '...' + this.orderData.payinAddress.substring(this.orderData.payinAddress.length - 6)
    this.elements.receiveAmount.textContent = `≈ ${this.orderData.toAmount} ${this.orderData.toCurrency}`

    this.updateStatusDisplay()
  },

  showFormView() {
    this.elements.formView.style.display = 'flex'
    this.elements.orderView.style.display = 'none'

    // Reset form
    this.elements.amountInput.value = ''
    this.elements.addressInput.value = ''
    this.elements.estimatedAmount.textContent = '-'
    this.amount = ''
    this.walletAddress = ''
  },

  updateStatusDisplay() {
    const status = this.orderData.status
    const statusTexts = {
      'new': 'Swap created',
      'waiting': 'Waiting for your deposit',
      'confirming': 'Confirming deposit',
      'exchanging': 'Swapping funds',
      'sending': 'Sending to recipient',
      'finished': 'Swap complete',
      'failed': 'Swap failed',
      'refunded': 'Refunded',
      'expired': 'Swap expired'
    }

    this.elements.statusText.textContent = statusTexts[status] || status

    // Update progress bar
    const progressPercent = this.getProgressPercentage(status)
    this.elements.progressBar.style.width = `${progressPercent}%`
  },

  getProgressPercentage(status) {
    const statusMap = {
      'new': 20,
      'waiting': 25,
      'confirming': 50,
      'exchanging': 75,
      'sending': 90,
      'finished': 100,
      'failed': 100,
      'refunded': 100,
      'expired': 100
    }
    return statusMap[status] || 20
  },

  async checkStatus(showLoader) {
    if (!this.orderData) return

    if (showLoader && this.elements.refreshBtn) {
      this.elements.refreshBtn.classList.add('spinning')
    }

    try {
      const result = await mixerAPI.getTransactionStatus(this.orderData.id)

      if (result.success && result.data) {
        this.orderData.status = result.data.status
        this.orderData.toAmount = result.data.toAmount

        // Update localStorage
        localStorage.setItem('mixer_order', JSON.stringify(this.orderData))

        this.updateStatusDisplay()

        // Check if order is complete
        if (['finished', 'failed', 'refunded', 'expired'].includes(this.orderData.status)) {
          this.stopTimers()
          setTimeout(() => this.cancelOrder(), 3000)
        }
      }
    } catch (error) {
      console.error('Error checking status:', error)
    } finally {
      if (showLoader && this.elements.refreshBtn) {
        setTimeout(() => this.elements.refreshBtn.classList.remove('spinning'), 500)
      }
    }
  },

  startTimers() {
    // Countdown timer
    this.timerInterval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - this.orderData.createdAt) / 1000)
      this.timeRemaining = Math.max(0, 1800 - elapsed) // 30 minutes

      const mins = Math.floor(this.timeRemaining / 60)
      const secs = this.timeRemaining % 60
      this.elements.timeRemainingText.textContent = `${mins}:${secs.toString().padStart(2, '0')}`

      if (this.timeRemaining === 0) {
        this.orderData.status = 'expired'
        this.updateStatusDisplay()
        this.stopTimers()
      }
    }, 1000)

    // Status polling
    this.statusInterval = setInterval(() => {
      this.checkStatus(false)
    }, 15000)
  },

  stopTimers() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval)
      this.timerInterval = null
    }
    if (this.statusInterval) {
      clearInterval(this.statusInterval)
      this.statusInterval = null
    }
  },

  cancelOrder() {
    localStorage.removeItem('mixer_order')
    this.orderData = null
    this.stopTimers()
    this.showFormView()
  },

  checkExistingOrder() {
    const savedOrder = localStorage.getItem('mixer_order')
    if (savedOrder) {
      try {
        this.orderData = JSON.parse(savedOrder)

        // Check if order is already complete
        if (['finished', 'failed', 'refunded', 'expired'].includes(this.orderData.status)) {
          localStorage.removeItem('mixer_order')
          this.orderData = null
        } else {
          this.showOrderView()
          this.startTimers()
          this.checkStatus(false)
        }
      } catch (error) {
        console.error('Error loading saved order:', error)
        localStorage.removeItem('mixer_order')
      }
    }
  },

  copyText(text, field) {
    navigator.clipboard.writeText(text).then(() => {
      // Show success feedback
      const element = field === 'orderId' ? this.elements.copyOrderId : this.elements.copySendAddress
      const originalHTML = element.innerHTML
      element.innerHTML = '✓'
      setTimeout(() => {
        element.innerHTML = originalHTML
      }, 2000)
    })
  },

  showError(message) {
    this.elements.errorMessage.textContent = message
    this.elements.errorMessage.style.display = 'block'
    setTimeout(() => this.hideError(), 5000)
  },

  hideError() {
    this.elements.errorMessage.style.display = 'none'
  }
}

module.exports = mixerPanel
