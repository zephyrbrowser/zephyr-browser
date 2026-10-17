// Mixer Panel Inline UI Controller
const mixerAPI = require('./mixerAPI.js')
const webviews = require('./webviews.js')

const mixerPanelInline = {
  panel: null,
  isOpen: false,
  currencies: [],
  currentTransaction: null,
  estimateTimeout: null,
  panelHeight: 600,

  // DOM Elements
  elements: {},

  initialize: function () {
    // console.log('Mixer Panel Inline: Initializing...')

    // Get DOM elements
    this.panel = document.getElementById('mixer-panel-inline')

    this.elements = {
      closeBtn: document.getElementById('mixer-panel-inline-close'),
      fromCurrency: document.getElementById('mixer-from-currency-inline'),
      toCurrency: document.getElementById('mixer-to-currency-inline'),
      amountInput: document.getElementById('mixer-amount-input-inline'),
      sendMaxBtn: document.getElementById('mixer-send-max-inline'),
      receivingAddress: document.getElementById('mixer-receiving-address-inline'),
      estimatedAmount: document.getElementById('mixer-estimated-amount-inline'),
      createOrderBtn: document.getElementById('mixer-create-order-inline'),
      statusSection: document.getElementById('mixer-status-section-inline'),
      statusBadge: document.getElementById('mixer-status-badge-inline'),
      statusDetails: document.getElementById('mixer-status-details-inline'),
      amountError: document.getElementById('mixer-amount-error-inline'),
      addressError: document.getElementById('mixer-address-error-inline')
    }

    // Event listeners
    this.elements.closeBtn.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      this.close()
    })

    this.elements.fromCurrency.addEventListener('change', () => this.onCurrencyChange())
    this.elements.toCurrency.addEventListener('change', () => this.onCurrencyChange())
    this.elements.amountInput.addEventListener('input', () => this.onAmountChange())
    this.elements.createOrderBtn.addEventListener('click', () => this.createOrder())

    // Load currencies
    this.loadCurrencies()

    // console.log('Mixer Panel Inline: Initialization complete')
  },

  open: function () {
    // console.log('Mixer Panel Inline: Opening...')
    // console.log('Panel element:', this.panel)
    // console.log('Panel classes before:', this.panel.className)

    this.panel.classList.add('active')
    this.isOpen = true

    // Push webviews down to make room for the mixer panel
    webviews.adjustMargin([this.panelHeight, 0, 0, 0])

    // console.log('Panel classes after:', this.panel.className)
    // console.log('isOpen:', this.isOpen)

    // Load currencies if not already loaded
    if (this.currencies.length === 0) {
      this.loadCurrencies()
    }
  },

  close: function () {
    // console.log('Mixer Panel Inline: Closing...')
    this.panel.classList.remove('active')
    this.isOpen = false

    // Pull webviews back up
    webviews.adjustMargin([this.panelHeight * -1, 0, 0, 0])
  },

  toggle: function () {
    if (this.isOpen) {
      this.close()
    } else {
      this.open()
    }
  },

  async loadCurrencies() {
    // console.log('Mixer Panel Inline: Loading currencies...')

    try {
      const result = await mixerAPI.getAvailableCurrencies(false, true)

      if (result.success && result.data) {
        this.currencies = result.data
        this.populateCurrencySelects()
      } else {
        console.error('Failed to load currencies:', result.error)
      }
    } catch (error) {
      console.error('Error loading currencies:', error)
    }
  },

  populateCurrencySelects() {
    // console.log('Mixer Panel Inline: Populating currency selects with', this.currencies.length, 'currencies')

    // Clear existing options
    this.elements.fromCurrency.innerHTML = '<option value="">Select currency</option>'
    this.elements.toCurrency.innerHTML = '<option value="">Select currency</option>'

    // Populate options
    this.currencies.forEach(currency => {
      const option1 = document.createElement('option')
      option1.value = currency.ticker.toLowerCase()
      option1.textContent = `${currency.ticker.toUpperCase()} (${currency.name})`
      this.elements.fromCurrency.appendChild(option1)

      const option2 = document.createElement('option')
      option2.value = currency.ticker.toLowerCase()
      option2.textContent = `${currency.ticker.toUpperCase()} (${currency.name})`
      this.elements.toCurrency.appendChild(option2)
    })

    // Set default values (SOL -> USDT)
    this.elements.fromCurrency.value = 'sol'
    this.elements.toCurrency.value = 'usdt'

    // Load minimum amount for default pair
    this.updateMinimumAmount()
  },

  async updateMinimumAmount() {
    const fromCurrency = this.elements.fromCurrency.value
    const toCurrency = this.elements.toCurrency.value

    if (!fromCurrency || !toCurrency) return

    try {
      const fromNetwork = mixerAPI.getNetworkForCurrency(fromCurrency)
      const toNetwork = mixerAPI.getNetworkForCurrency(toCurrency)

      const result = await mixerAPI.getMinimumExchangeAmount(
        fromCurrency,
        toCurrency,
        fromNetwork,
        toNetwork
      )

      if (result.success && result.data) {
        const minAmount = result.data.minAmount || result.data
        this.elements.amountInput.placeholder = `Min ${minAmount} ${fromCurrency.toUpperCase()}`
        this.elements.amountInput.min = minAmount
      }
    } catch (error) {
      console.error('Error getting minimum amount:', error)
    }
  },

  onCurrencyChange() {
    // console.log('Mixer Panel Inline: Currency changed')
    this.updateMinimumAmount()
    this.getEstimate()
  },

  onAmountChange() {
    // Clear previous timeout
    if (this.estimateTimeout) {
      clearTimeout(this.estimateTimeout)
    }

    // Debounce estimate request
    this.estimateTimeout = setTimeout(() => {
      this.getEstimate()
    }, 500)
  },

  async getEstimate() {
    const fromCurrency = this.elements.fromCurrency.value
    const toCurrency = this.elements.toCurrency.value
    const amount = parseFloat(this.elements.amountInput.value)

    if (!fromCurrency || !toCurrency || !amount || amount <= 0) {
      this.elements.estimatedAmount.textContent = '-'
      return
    }

    try {
      const fromNetwork = mixerAPI.getNetworkForCurrency(fromCurrency)
      const toNetwork = mixerAPI.getNetworkForCurrency(toCurrency)

      const result = await mixerAPI.getEstimatedExchange(
        fromCurrency,
        toCurrency,
        fromNetwork,
        toNetwork,
        amount,
        'standard'
      )

      if (result.success && result.data) {
        const estimatedAmount = result.data.toAmount || result.data.estimatedAmount
        this.elements.estimatedAmount.textContent =
          `${estimatedAmount} ${toCurrency.toUpperCase()}`
      } else {
        this.elements.estimatedAmount.textContent = 'Error calculating estimate'
        console.error('Estimate error:', result.error)
      }
    } catch (error) {
      console.error('Error getting estimate:', error)
      this.elements.estimatedAmount.textContent = 'Error'
    }
  },

  async createOrder() {
    // console.log('Mixer Panel Inline: Creating order...')

    // Validate inputs
    const fromCurrency = this.elements.fromCurrency.value
    const toCurrency = this.elements.toCurrency.value
    const amount = parseFloat(this.elements.amountInput.value)
    const address = this.elements.receivingAddress.value.trim()

    // Clear previous errors
    this.elements.amountError.style.display = 'none'
    this.elements.addressError.style.display = 'none'

    let hasError = false

    if (!amount || amount <= 0) {
      this.elements.amountError.textContent = 'Please enter a valid amount'
      this.elements.amountError.style.display = 'block'
      hasError = true
    }

    if (!address) {
      this.elements.addressError.textContent = 'Please enter a receiving address'
      this.elements.addressError.style.display = 'block'
      hasError = true
    }

    if (!fromCurrency || !toCurrency) {
      alert('Mixer Error\n\nPlease select both currencies')
      hasError = true
    }

    if (hasError) return

    // Disable button
    this.elements.createOrderBtn.disabled = true
    this.elements.createOrderBtn.textContent = 'Creating Order...'

    try {
      const fromNetwork = mixerAPI.getNetworkForCurrency(fromCurrency)
      const toNetwork = mixerAPI.getNetworkForCurrency(toCurrency)

      const result = await mixerAPI.createExchange({
        fromCurrency,
        toCurrency,
        fromNetwork,
        toNetwork,
        fromAmount: amount,
        address
      })

      if (result.success && result.data) {
        this.currentTransaction = result.data
        this.showTransactionStatus(result.data)
        alert('Mixer Success\n\nOrder created successfully!')

        // Start polling for status updates
        this.startStatusPolling(result.data.id)
      } else {
        alert('Mixer Error\n\n' + (result.error || 'Failed to create order'))
      }
      
    } catch (error) {
      console.error('Error creating order:', error)
      alert('Mixer Error\n\nFailed to create order. Please try again.')
    } finally {
      // Re-enable button
      this.elements.createOrderBtn.disabled = false
      this.elements.createOrderBtn.innerHTML = '<i class="i carbon:shuffle"></i> Create Order'
    }
  },

  showTransactionStatus(transaction) {
    this.elements.statusSection.style.display = 'block'

    // Update status badge
    const status = transaction.status || 'new'
    this.elements.statusBadge.textContent = mixerAPI.getStatusText(status)
    this.elements.statusBadge.className = 'mixer-status-badge ' + status

    // Update status details
    const details = `
      <div><strong>Transaction ID:</strong> ${transaction.id}</div>
      <div><strong>Deposit Address:</strong> ${transaction.payinAddress}</div>
      <div><strong>Amount to Send:</strong> ${transaction.fromAmount} ${transaction.fromCurrency.toUpperCase()}</div>
      <div><strong>You will receive:</strong> ${transaction.toAmount || 'Calculating...'} ${transaction.toCurrency.toUpperCase()}</div>
      <div><strong>Status:</strong> ${mixerAPI.getStatusText(status)}</div>
    `
    this.elements.statusDetails.innerHTML = details
  },

  startStatusPolling(transactionId) {
    // Poll every 10 seconds
    const pollInterval = setInterval(async () => {
      try {
        const result = await mixerAPI.getTransactionStatus(transactionId)

        if (result.success && result.data) {
          this.showTransactionStatus(result.data)

          // Stop polling if transaction is finished, failed, or expired
          const status = result.data.status
          if (status === 'finished' || status === 'failed' || status === 'expired' || status === 'refunded') {
            clearInterval(pollInterval)
          }
        }
      } catch (error) {
        console.error('Error polling transaction status:', error)
      }
    }, 10000)

    // Stop polling after 30 minutes
    setTimeout(() => {
      clearInterval(pollInterval)
    }, 30 * 60 * 1000)
  }
}

module.exports = mixerPanelInline
