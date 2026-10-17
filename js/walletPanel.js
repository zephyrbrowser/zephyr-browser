// Wallet Panel UI Controller
const webviews = require('./webviews.js')
const ipc = require('electron').ipcRenderer
const browserUI = require('./browserUI.js')

const walletPanel = {
  panel: null,
  isOpen: false,
  panelWidth: 450,
  publicKey: null,
  balance: { sol: 0, lamports: 0 },
  network: 'mainnet-beta',
  isExportWarningVisible: false,
  isPrivateKeyVisible: false,
  solPrice: 0,
  priceUpdateInterval: null,

  // Token list
  tokens: [],
  customTokens: [], // manually added tokens — survive refreshes
  isTokensLoading: false,

  // Send modal state
  sendModalOpen: false,
  sendAsset: null, // { type: 'sol' } or { type: 'token', mint, symbol, balance, decimals, logo }
  estimatedFee: 0.00001, // 10000 lamports buffer for fee variations

  // Pending approval requests
  pendingConnectRequest: null,
  pendingTransactionRequest: null,
  pendingMessageRequest: null,

  // DOM Elements
  elements: {},

  initialize: function () {
    // console.log('[WalletPanel] Initializing... (renderer process)')

    // Get DOM elements
    this.panel = document.getElementById('wallet-panel')
    if (!this.panel) {
      console.error('[WalletPanel] Panel element not found!')
      return
    }

    this.elements = {
      closeBtn: document.getElementById('wallet-panel-close'),
      addressDisplay: document.getElementById('wallet-address-display'),
      copyAddressBtn: document.getElementById('wallet-copy-address'),
      qrCodeContainer: document.getElementById('wallet-qr-code'),
      balanceAmount: document.getElementById('wallet-balance-amount'),
      balanceUsd: document.getElementById('wallet-balance-usd'),
      balanceRefreshBtn: document.getElementById('wallet-balance-refresh-btn'),
      networkSelect: document.getElementById('wallet-network-select'),
      exportBtn: document.getElementById('wallet-export-btn'),
      importBtn: document.getElementById('wallet-import-btn'),
      refreshBtn: document.getElementById('wallet-refresh-btn'),

      // Tabs
      tabAssetsBtn: document.getElementById('wallet-tab-assets-btn'),
      tabSettingsBtn: document.getElementById('wallet-tab-settings-btn'),
      tabAssetsPane: document.getElementById('wallet-tab-assets'),
      tabSettingsPane: document.getElementById('wallet-tab-settings'),

      // Import modal
      importModal: document.getElementById('wallet-import-modal'),
      importKeyInput: document.getElementById('wallet-import-key-input'),
      importConfirmBtn: document.getElementById('wallet-import-confirm'),
      importCancelBtn: document.getElementById('wallet-import-cancel'),
      importError: document.getElementById('wallet-import-error'),

      // Export warning
      exportWarning: document.getElementById('wallet-export-warning'),
      exportConfirmBtn: document.getElementById('wallet-export-confirm'),
      exportCancelBtn: document.getElementById('wallet-export-cancel'),

      // Private key display
      privateKeyDisplay: document.getElementById('wallet-private-key-display'),
      privateKeyBox: document.getElementById('wallet-private-key-box'),
      copyPrivateKeyBtn: document.getElementById('wallet-copy-private-key'),
      hidePrivateKeyBtn: document.getElementById('wallet-hide-private-key'),

      // Inline connection approval (inside wallet panel)
      connectInline: document.getElementById('wallet-connect-inline'),
      connectOrigin: document.getElementById('wallet-connect-origin-inline'),
      connectApproveBtn: document.getElementById('wallet-connect-approve-inline'),
      connectRejectBtn: document.getElementById('wallet-connect-reject-inline'),

      // Inline transaction approval
      txInline: document.getElementById('wallet-tx-inline'),
      txOrigin: document.getElementById('wallet-tx-origin-inline'),
      txWarnings: document.getElementById('wallet-tx-warnings-inline'),
      txDetails: document.getElementById('wallet-tx-details-inline'),
      txApproveBtn: document.getElementById('wallet-tx-approve-inline'),
      txRejectBtn: document.getElementById('wallet-tx-reject-inline'),

      // Inline message signing
      msgInline: document.getElementById('wallet-msg-inline'),
      msgOrigin: document.getElementById('wallet-msg-origin-inline'),
      msgContent: document.getElementById('wallet-msg-content-inline'),
      msgApproveBtn: document.getElementById('wallet-msg-approve-inline'),
      msgRejectBtn: document.getElementById('wallet-msg-reject-inline'),

      // Token list
      tokensList: document.getElementById('wallet-tokens-list'),
      refreshTokensBtn: document.getElementById('wallet-refresh-tokens-btn'),
      addTokenBtn: document.getElementById('wallet-add-token-btn'),
      addTokenModal: document.getElementById('wallet-add-token-modal'),
      addTokenClose: document.getElementById('wallet-add-token-close'),
      addTokenInput: document.getElementById('wallet-add-token-input'),
      addTokenPreview: document.getElementById('wallet-add-token-preview'),
      addTokenName: document.getElementById('wallet-add-token-name'),
      addTokenSymbol: document.getElementById('wallet-add-token-symbol'),
      addTokenDecimals: document.getElementById('wallet-add-token-decimals'),
      addTokenBalance: document.getElementById('wallet-add-token-balance'),
      addTokenError: document.getElementById('wallet-add-token-error'),
      addTokenLookupBtn: document.getElementById('wallet-add-token-lookup-btn'),
      addTokenConfirmBtn: document.getElementById('wallet-add-token-confirm-btn'),

      // Send SOL button
      sendSolBtn: document.getElementById('wallet-send-sol-btn'),

      // Send modal
      sendModal: document.getElementById('wallet-send-modal'),
      sendTitle: document.getElementById('wallet-send-title'),
      sendBackBtn: document.getElementById('wallet-send-back-btn'),
      sendAssetIcon: document.getElementById('wallet-send-asset-icon'),
      sendAssetSymbol: document.getElementById('wallet-send-asset-symbol'),
      sendAssetBalance: document.getElementById('wallet-send-asset-balance'),
      sendRecipient: document.getElementById('wallet-send-recipient'),
      sendRecipientError: document.getElementById('wallet-send-recipient-error'),
      sendAmount: document.getElementById('wallet-send-amount'),
      sendAmountError: document.getElementById('wallet-send-amount-error'),
      sendMaxBtn: document.getElementById('wallet-send-max-btn'),
      sendFeeAmount: document.getElementById('wallet-send-fee-amount'),
      sendSummary: document.getElementById('wallet-send-summary'),
      sendSummaryAmount: document.getElementById('wallet-send-summary-amount'),
      sendSummaryRecipient: document.getElementById('wallet-send-summary-recipient'),
      sendCancelBtn: document.getElementById('wallet-send-cancel-btn'),
      sendConfirmBtn: document.getElementById('wallet-send-confirm-btn'),
      sendProcessing: document.getElementById('wallet-send-processing'),
      sendSuccess: document.getElementById('wallet-send-success'),
      sendSuccessMessage: document.getElementById('wallet-send-success-message'),
      sendExplorerLink: document.getElementById('wallet-send-explorer-link'),
      sendDoneBtn: document.getElementById('wallet-send-done-btn'),
      sendErrorState: document.getElementById('wallet-send-error'),
      sendErrorMessage: document.getElementById('wallet-send-error-message'),
      sendRetryBtn: document.getElementById('wallet-send-retry-btn'),

      // Token info panel
      tokenInfoPanel: document.getElementById('wallet-token-info-panel'),
      wtiName: document.getElementById('wti-name'),
      wtiSymbol: document.getElementById('wti-symbol'),
      wtiNetwork: document.getElementById('wti-network'),
      wtiMint: document.getElementById('wti-mint'),
      wtiMintCopy: document.getElementById('wti-mint-copy'),
      wtiPrice: document.getElementById('wti-price'),
      wtiMarketCap: document.getElementById('wti-marketcap'),
      wtiSupply: document.getElementById('wti-supply'),
      wtiHolders: document.getElementById('wti-holders'),
      wtiCreated: document.getElementById('wti-created')
    }

    // Set up event listeners
    this.setupEventListeners()

    // Initialize wallet data
    this.initializeWallet()

    // Listen for wallet IPC events
    this.setupIPCListeners()

    // console.log('[WalletPanel] Initialization complete')
  },

  setupEventListeners: function () {
    // Close button
    if (this.elements.closeBtn) {
      this.elements.closeBtn.addEventListener('click', (e) => {
        e.preventDefault()
        e.stopPropagation()
        this.close()
      })
    }

    // Copy address
    if (this.elements.copyAddressBtn) {
      this.elements.copyAddressBtn.addEventListener('click', () => this.copyAddress())
    }

    // Network select
    if (this.elements.networkSelect) {
      this.elements.networkSelect.addEventListener('change', (e) => this.switchNetwork(e.target.value))
    }

    // Export button
    if (this.elements.exportBtn) {
      this.elements.exportBtn.addEventListener('click', () => this.showExportWarning())
    }

    // Import button
    if (this.elements.importBtn) {
      this.elements.importBtn.addEventListener('click', () => this.showImportModal())
    }
    if (this.elements.importConfirmBtn) {
      this.elements.importConfirmBtn.addEventListener('click', (e) => {
        e.preventDefault()
        e.stopPropagation()
        this.confirmImport()
      })
    }
    if (this.elements.importCancelBtn) {
      this.elements.importCancelBtn.addEventListener('click', (e) => {
        e.preventDefault()
        e.stopPropagation()
        this.hideImportModal()
      })
    }

    // Refresh button (in actions section)
    if (this.elements.refreshBtn) {
      this.elements.refreshBtn.addEventListener('click', () => this.refreshBalanceWithAnimation())
    }

    // Tabs
    if (this.elements.tabAssetsBtn && this.elements.tabSettingsBtn) {
      this.elements.tabAssetsBtn.addEventListener('click', () => this.switchTab('assets'))
      this.elements.tabSettingsBtn.addEventListener('click', () => this.switchTab('settings'))
    }

    // Balance refresh button (top-right corner of balance box)
    if (this.elements.balanceRefreshBtn) {
      this.elements.balanceRefreshBtn.addEventListener('click', () => this.refreshBalanceWithAnimation())
    }

    // Export warning buttons
    if (this.elements.exportConfirmBtn) {
      this.elements.exportConfirmBtn.addEventListener('click', (e) => {
        e.preventDefault()
        e.stopPropagation()
        this.confirmExport()
      })
    }
    if (this.elements.exportCancelBtn) {
      this.elements.exportCancelBtn.addEventListener('click', (e) => {
        e.preventDefault()
        e.stopPropagation()
        this.hideExportWarning()
      })
    }

    // Private key buttons
    if (this.elements.copyPrivateKeyBtn) {
      this.elements.copyPrivateKeyBtn.addEventListener('click', () => this.copyPrivateKey())
    }
    if (this.elements.hidePrivateKeyBtn) {
      this.elements.hidePrivateKeyBtn.addEventListener('click', () => this.hidePrivateKey())
    }

    // Connection modal buttons
    if (this.elements.connectApproveBtn) {
      this.elements.connectApproveBtn.addEventListener('click', () => this.approveConnect())
    }
    if (this.elements.connectRejectBtn) {
      this.elements.connectRejectBtn.addEventListener('click', () => this.rejectConnect())
    }

    // Transaction modal buttons
    if (this.elements.txApproveBtn) {
      this.elements.txApproveBtn.addEventListener('click', () => this.approveTransaction())
    }
    if (this.elements.txRejectBtn) {
      this.elements.txRejectBtn.addEventListener('click', () => this.rejectTransaction())
    }

    // Message modal buttons
    if (this.elements.msgApproveBtn) {
      this.elements.msgApproveBtn.addEventListener('click', () => this.approveMessage())
    }
    if (this.elements.msgRejectBtn) {
      this.elements.msgRejectBtn.addEventListener('click', () => this.rejectMessage())
    }

    // Token refresh button
    if (this.elements.refreshTokensBtn) {
      this.elements.refreshTokensBtn.addEventListener('click', () => this.refreshTokens())
    }

    // Add token button & modal
    if (this.elements.addTokenBtn) {
      this.elements.addTokenBtn.addEventListener('click', () => this.showAddTokenModal())
    }
    if (this.elements.addTokenClose) {
      this.elements.addTokenClose.addEventListener('click', () => this.hideAddTokenModal())
    }
    if (this.elements.addTokenModal) {
      this.elements.addTokenModal.addEventListener('click', (e) => {
        if (e.target === this.elements.addTokenModal) this.hideAddTokenModal()
      })
    }
    if (this.elements.addTokenLookupBtn) {
      this.elements.addTokenLookupBtn.addEventListener('click', () => this.lookupToken())
    }
    if (this.elements.addTokenInput) {
      this.elements.addTokenInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') this.lookupToken()
      })
    }
    if (this.elements.addTokenConfirmBtn) {
      this.elements.addTokenConfirmBtn.addEventListener('click', () => this.addCustomToken())
    }

    // Send SOL button
    if (this.elements.sendSolBtn) {
      this.elements.sendSolBtn.addEventListener('click', () => this.openSendModal('sol'))
    }

    // Send modal buttons
    if (this.elements.sendBackBtn) {
      this.elements.sendBackBtn.addEventListener('click', () => this.closeSendModal())
    }
    if (this.elements.sendCancelBtn) {
      this.elements.sendCancelBtn.addEventListener('click', () => this.closeSendModal())
    }
    if (this.elements.sendMaxBtn) {
      this.elements.sendMaxBtn.addEventListener('click', () => this.setMaxAmount())
    }
    if (this.elements.sendConfirmBtn) {
      this.elements.sendConfirmBtn.addEventListener('click', () => this.executeSend())
    }
    if (this.elements.sendDoneBtn) {
      this.elements.sendDoneBtn.addEventListener('click', () => this.closeSendModal())
    }
    if (this.elements.sendRetryBtn) {
      this.elements.sendRetryBtn.addEventListener('click', () => this.resetSendModal())
    }
    if (this.elements.sendExplorerLink) {
      this.elements.sendExplorerLink.addEventListener('click', (e) => {
        e.preventDefault()
        const url = this.elements.sendExplorerLink.href
        if (url && url !== '#') {
          // Open in new browser tab
          const newTab = tabs.add({ url: url })
          browserUI.addTab(newTab, { enterEditMode: false })
        }
      })
    }

    // Send form validation
    if (this.elements.sendRecipient) {
      this.elements.sendRecipient.addEventListener('input', () => {
        this.validateSendForm()
        this.updateFeeEstimate()
      })
    }
    if (this.elements.sendAmount) {
      this.elements.sendAmount.addEventListener('input', () => {
        this.validateSendForm()
        this.updateFeeEstimate()
      })
    }

  },

  setupIPCListeners: function () {
    // console.log('[WalletPanel] Setting up IPC listeners')

    // Connection approval request
    ipc.on('wallet:showConnectApproval', (event, data) => {
      // console.log('[WalletPanel] Received wallet:showConnectApproval', data)
      // Flash the wallet button to indicate activity
      const walletBtn = document.getElementById('wallet-button')
      if (walletBtn) {
        // walletBtn.style.backgroundColor = '#ff0000'
        setTimeout(() => {
          walletBtn.style.backgroundColor = ''
        }, 1000)
      }
      this.showConnectModal(data)
    })

    // Transaction approval request
    ipc.on('wallet:showTransactionApproval', (event, data) => {
      this.showTransactionModal(data)
    })

    // Multiple transactions approval request
    ipc.on('wallet:showMultiTransactionApproval', (event, data) => {
      this.showMultiTransactionModal(data)
    })

    // Message approval request
    ipc.on('wallet:showMessageApproval', (event, data) => {
      this.showMessageModal(data)
    })

    // Wallet address changed (after burn/regenerate)
    ipc.on('wallet:addressChanged', (event, data) => {
      if (data && (data.address || data.publicKey)) {
        this.publicKey = data.address || data.publicKey
        this.updateAddressDisplay()
        this.generateQRCode()
        // Reset token list
        if (this.elements.tokensList) {
          this.elements.tokensList.innerHTML = '<div class="wallet-tokens-empty">No tokens found</div>'
        }
      }
    })

    // Real-time balance updates
    ipc.on('wallet:balanceChanged', (event, balance) => {
      this.balance = balance
      if (!this.solPrice) this.fetchSolPrice()
      this.updateBalanceDisplay()

      // Flash the balance to indicate update
      if (this.elements.balanceAmount) {
        this.elements.balanceAmount.classList.add('balance-updated')
        setTimeout(() => {
          this.elements.balanceAmount.classList.remove('balance-updated')
        }, 500)
      }
    })
  },

  async initializeWallet() {
    try {
      // Get public key
      const result = await ipc.invoke('wallet:getPublicKey')
      if (result.success && result.data.publicKey) {
        this.publicKey = result.data.publicKey
        this.updateAddressDisplay()
        this.generateQRCode()
      }

      // Get network
      const networkResult = await ipc.invoke('wallet:getNetwork')
      if (networkResult.success) {
        this.network = networkResult.data.network
        if (this.elements.networkSelect) {
          this.elements.networkSelect.value = this.network
        }
      }

      // Fetch price and balance in parallel, then update display once both arrive
      await Promise.all([this.fetchSolPrice(), this.refreshBalance()])
      this.updateBalanceDisplay()

      // Subscribe to real-time balance updates
      await this.subscribeToBalanceUpdates()

      // Start SOL price update interval (every 30 seconds)
      this.startPriceUpdates()
    } catch (error) {
      console.error('[WalletPanel] Error initializing wallet:', error)
    }
  },

  async fetchSolPrice() {
    const apis = [
      async () => {
        const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd')
        const d = await r.json()
        return d?.solana?.usd
      },
      async () => {
        const r = await fetch('https://min-api.cryptocompare.com/data/price?fsym=SOL&tsyms=USD')
        const d = await r.json()
        return d?.USD
      },
      async () => {
        const r = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDT')
        const d = await r.json()
        return d?.price ? parseFloat(d.price) : null
      }
    ]
    for (const api of apis) {
      try {
        const price = await api()
        console.log('[WalletPanel] SOL price fetched:', price)
        if (price && price > 0) {
          this.solPrice = price
          this.updateBalanceDisplay()
          return
        }
      } catch (e) { /* try next */ }
    }
    console.error('[WalletPanel] All SOL price APIs failed')
  },

  startPriceUpdates() {
    if (this.priceUpdateInterval) clearInterval(this.priceUpdateInterval)
    this.priceUpdateInterval = setInterval(() => this.fetchSolPrice(), 30000)
  },

  async subscribeToBalanceUpdates() {
    try {
      const result = await ipc.invoke('wallet:subscribeBalance')
      if (result.success) {
        // console.log('[WalletPanel] Subscribed to real-time balance updates')
      } else {
        console.error('[WalletPanel] Failed to subscribe to balance:', result.error)
      }
    } catch (error) {
      console.error('[WalletPanel] Error subscribing to balance:', error)
    }
  },

  updateAddressDisplay: function () {
    if (this.elements.addressDisplay && this.publicKey) {
      this.elements.addressDisplay.textContent = this.publicKey
    }
  },

  generateQRCode: function () {
    if (!this.elements.qrCodeContainer || !this.publicKey) return

    // Clear existing QR code
    this.elements.qrCodeContainer.innerHTML = ''

    // Generate QR code using simple canvas approach
    const canvas = document.createElement('canvas')
    canvas.width = 150
    canvas.height = 150

    // Use a simple QR code library or placeholder
    // For now, create a simple visual representation
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, 150, 150)

    // Draw a placeholder pattern (actual QR would need a library)
    ctx.fillStyle = '#000000'
    ctx.font = '10px monospace'
    ctx.textAlign = 'center'
    ctx.fillText('QR Code', 75, 75)
    ctx.fillText(this.publicKey.substring(0, 8) + '...', 75, 90)

    this.elements.qrCodeContainer.appendChild(canvas)
  },

  async refreshBalance() {
    try {
      const result = await ipc.invoke('wallet:getBalance')
      if (result.success) {
        this.balance = result.data
        this.updateBalanceDisplay()
      }
    } catch (error) {
      console.error('[WalletPanel] Error refreshing balance:', error)
      if (this.elements.balanceAmount) {
        this.elements.balanceAmount.textContent = '0.0000 SOL'
      }
    }
  },

  async refreshBalanceWithAnimation() {
    // Add spinning animation to refresh button
    if (this.elements.balanceRefreshBtn) {
      this.elements.balanceRefreshBtn.classList.add('refreshing')
    }

    try {
      // Refresh both price and balance
      await Promise.all([
        this.fetchSolPrice(),
        this.refreshBalance()
      ])
    } finally {
      // Remove spinning animation after a minimum of 500ms for visual feedback
      setTimeout(() => {
        if (this.elements.balanceRefreshBtn) {
          this.elements.balanceRefreshBtn.classList.remove('refreshing')
        }
      }, 500)
    }
  },

  updateBalanceDisplay: function () {
    if (this.elements.balanceAmount) {
      this.elements.balanceAmount.textContent = this.formatSolBalance(this.balance.sol) + ' SOL'
    }
    if (this.elements.balanceUsd) {
      const usdValue = (this.balance.sol || 0) * this.solPrice
      this.elements.balanceUsd.textContent = '≈ $' + usdValue.toFixed(2)
    }
  },

  formatSolBalance: function (balance) {
    if (!balance || balance === 0) return '0'
    const formatted = balance.toFixed(6)
    return formatted.replace(/\.?0+$/, '') || '0'
  },

  async switchNetwork(network) {
    try {
      const result = await ipc.invoke('wallet:switchNetwork', network)
      if (result.success) {
        this.network = result.data.network
        // Clear tokens and custom tokens — different network has different contracts
        this.tokens = []
        this.customTokens = []
        this.renderTokenList()
        // Refresh balance and tokens for new network
        await this.refreshBalance()
        await this.refreshTokens()
      }
    } catch (error) {
      console.error('[WalletPanel] Error switching network:', error)
    }
  },

  copyAddress: async function () {
    if (!this.publicKey) return

    try {
      // navigator.clipboard may exist but fail silently in Electron — always try textarea fallback
      var copied = false
      if (navigator.clipboard && navigator.clipboard.writeText) {
        try {
          await navigator.clipboard.writeText(this.publicKey)
          copied = true
        } catch (e) {}
      }
      if (!copied) {
        const el = document.createElement('textarea')
        el.value = this.publicKey
        el.style.position = 'fixed'
        el.style.opacity = '0'
        document.body.appendChild(el)
        el.focus()
        el.select()
        document.execCommand('copy')
        document.body.removeChild(el)
      }
      if (this.elements.copyAddressBtn) {
        const original = this.elements.copyAddressBtn.innerHTML
        this.elements.copyAddressBtn.classList.add('copied')
        this.elements.copyAddressBtn.innerHTML = '<i class="i carbon:checkmark"></i>'
        setTimeout(() => {
          this.elements.copyAddressBtn.classList.remove('copied')
          this.elements.copyAddressBtn.innerHTML = original
        }, 2000)
      }
    } catch (error) {
      console.error('[WalletPanel] Error copying address:', error)
    }
  },

  showExportWarning: function () {
    if (this.elements.exportWarning) {
      this.elements.exportWarning.classList.add('active')
      this.isExportWarningVisible = true
    }
  },

  hideExportWarning: function () {
    if (this.elements.exportWarning) {
      this.elements.exportWarning.classList.remove('active')
      this.isExportWarningVisible = false
    }
  },

  showImportModal: function () {
    if (this.elements.importModal) {
      if (this.elements.importKeyInput) this.elements.importKeyInput.value = ''
      if (this.elements.importError) this.elements.importError.textContent = ''
      this.elements.importModal.classList.add('active')
    }
  },

  hideImportModal: function () {
    if (this.elements.importModal) {
      this.elements.importModal.classList.remove('active')
    }
    if (this.elements.importKeyInput) this.elements.importKeyInput.value = ''
    if (this.elements.importError) this.elements.importError.textContent = ''
  },

  async confirmImport() {
    var privateKey = this.elements.importKeyInput ? this.elements.importKeyInput.value.trim() : ''
    if (!privateKey) {
      if (this.elements.importError) this.elements.importError.textContent = 'Please paste your private key.'
      return
    }

    if (this.elements.importConfirmBtn) this.elements.importConfirmBtn.textContent = 'Importing...'

    try {
      const result = await ipc.invoke('wallet:importWallet', privateKey)
      if (result.success) {
        this.hideImportModal()
        // New wallet — clear custom tokens from previous wallet
        this.customTokens = []
        this.tokens = []
        // Update UI with new wallet — IPC returns { address }
        this.publicKey = result.data.address || result.data.publicKey
        this.updateAddressDisplay()
        this.generateQRCode()
        await this.refreshBalance()
        await this.refreshTokens()
        ipc.send('wallet:walletImported', { publicKey: this.publicKey })
      } else {
        if (this.elements.importError) this.elements.importError.textContent = result.error || 'Import failed.'
      }
    } catch (err) {
      if (this.elements.importError) this.elements.importError.textContent = 'Error: ' + err.message
    }

    if (this.elements.importConfirmBtn) this.elements.importConfirmBtn.textContent = 'Import'
  },

  async confirmExport() {
    this.hideExportWarning()

    try {
      const result = await ipc.invoke('wallet:exportPrivateKey')
      if (result.success) {
        if (this.elements.privateKeyBox) {
          // Display as Base58 format
          this.elements.privateKeyBox.textContent = result.data.secretKeyBase58
        }
        if (this.elements.privateKeyDisplay) {
          this.elements.privateKeyDisplay.classList.add('active')
          this.isPrivateKeyVisible = true
        }
      } else {
        console.error('[WalletPanel] Export failed:', result.error)
      }
    } catch (error) {
      console.error('[WalletPanel] Error exporting private key:', error)
    }
  },

  hidePrivateKey: function () {
    if (this.elements.privateKeyDisplay) {
      this.elements.privateKeyDisplay.classList.remove('active')
      this.isPrivateKeyVisible = false
    }
    if (this.elements.privateKeyBox) {
      this.elements.privateKeyBox.textContent = ''
    }
  },

  async copyPrivateKey() {
    const keyText = this.elements.privateKeyBox?.textContent
    if (!keyText) return

    try {
      await navigator.clipboard.writeText(keyText)
      if (this.elements.copyPrivateKeyBtn) {
        this.elements.copyPrivateKeyBtn.textContent = 'Copied!'
        setTimeout(() => {
          this.elements.copyPrivateKeyBtn.textContent = 'Copy Key'
        }, 2000)
      }
    } catch (error) {
      console.error('[WalletPanel] Error copying private key:', error)
    }
  },

  // Connection approval - now inline inside wallet panel
  showConnectModal: function (data) {
    // console.log('[WalletPanel] showConnectModal called with:', data)
    this.pendingConnectRequest = data

    // Auto-open the wallet panel to show the approval request
    if (!this.isOpen) {
      this.open()
    }

    // Hide other inline approvals
    this.hideAllInlineApprovals()

    if (this.elements.connectOrigin) {
      this.elements.connectOrigin.textContent = data.origin
    }
    if (this.elements.connectInline) {
      this.elements.connectInline.classList.add('active')
      // console.log('[WalletPanel] Connect inline approval shown')
    } else {
      console.error('[WalletPanel] Connect inline element not found!')
    }
  },

  hideAllInlineApprovals: function () {
    if (this.elements.connectInline) {
      this.elements.connectInline.classList.remove('active')
    }
    if (this.elements.txInline) {
      this.elements.txInline.classList.remove('active')
    }
    if (this.elements.msgInline) {
      this.elements.msgInline.classList.remove('active')
    }
  },

  async approveConnect() {
    if (!this.pendingConnectRequest) return

    try {
      await ipc.invoke('wallet:approveConnect', {
        requestId: this.pendingConnectRequest.requestId
      })
      // Response is sent directly to webview by main process
    } catch (error) {
      console.error('[WalletPanel] Error approving connect:', error)
    }

    this.hideConnectModal()
  },

  async rejectConnect() {
    if (!this.pendingConnectRequest) return

    try {
      await ipc.invoke('wallet:rejectConnect', {
        requestId: this.pendingConnectRequest.requestId
      })
      // Response is sent directly to webview by main process
    } catch (error) {
      console.error('[WalletPanel] Error rejecting connect:', error)
    }

    this.hideConnectModal()
  },

  hideConnectModal: function () {
    if (this.elements.connectInline) {
      this.elements.connectInline.classList.remove('active')
    }
    this.pendingConnectRequest = null
  },

  // Transaction approval - now inline inside wallet panel
  showTransactionModal: function (data) {
    this.pendingTransactionRequest = data

    // Auto-open the wallet panel
    if (!this.isOpen) {
      this.open()
    }

    // Hide other inline approvals
    this.hideAllInlineApprovals()

    if (this.elements.txOrigin) {
      this.elements.txOrigin.textContent = data.origin
    }

    // Display warnings
    if (this.elements.txWarnings && data.decoded.warnings) {
      this.elements.txWarnings.innerHTML = ''
      data.decoded.warnings.forEach(warning => {
        const div = document.createElement('div')
        div.className = 'wallet-tx-warning-item'
        div.textContent = warning.message
        this.elements.txWarnings.appendChild(div)
      })
    }

    // Display transaction details
    if (this.elements.txDetails && data.decoded) {
      let detailsHtml = ''

      data.decoded.instructions.forEach((inst, idx) => {
        detailsHtml += `<div style="margin-bottom: 12px;">
          <strong>Instruction ${idx + 1}:</strong> ${inst.programName}<br>
          Program: ${inst.programId.substring(0, 20)}...<br>`

        if (inst.type === 'Transfer') {
          detailsHtml += `Type: ${inst.type}<br>
          Amount: ${inst.amountSOL} SOL<br>
          From: ${inst.from?.substring(0, 20)}...<br>
          To: ${inst.to?.substring(0, 20)}...<br>`
        }

        detailsHtml += `</div>`
      })

      this.elements.txDetails.innerHTML = detailsHtml
    }

    if (this.elements.txInline) {
      this.elements.txInline.classList.add('active')
    }
  },

  showMultiTransactionModal: function (data) {
    // For multiple transactions, show count and combined warnings
    this.pendingTransactionRequest = { ...data, isMulti: true }

    // Auto-open the wallet panel
    if (!this.isOpen) {
      this.open()
    }

    // Hide other inline approvals
    this.hideAllInlineApprovals()

    if (this.elements.txOrigin) {
      this.elements.txOrigin.textContent = `${data.origin} (${data.count} transactions)`
    }

    // Combine all warnings
    if (this.elements.txWarnings) {
      this.elements.txWarnings.innerHTML = ''
      const allWarnings = []
      data.decoded.forEach((tx, idx) => {
        tx.warnings?.forEach(w => {
          allWarnings.push({ ...w, tx: idx + 1 })
        })
      })

      allWarnings.forEach(warning => {
        const div = document.createElement('div')
        div.className = 'wallet-tx-warning-item'
        div.textContent = `TX ${warning.tx}: ${warning.message}`
        this.elements.txWarnings.appendChild(div)
      })
    }

    if (this.elements.txDetails) {
      this.elements.txDetails.innerHTML = `<strong>${data.count} transactions</strong> require your signature.`
    }

    if (this.elements.txInline) {
      this.elements.txInline.classList.add('active')
    }
  },

  async approveTransaction() {
    if (!this.pendingTransactionRequest) return

    try {
      if (this.pendingTransactionRequest.isMulti) {
        await ipc.invoke('wallet:approveSignAllTransactions', {
          requestId: this.pendingTransactionRequest.requestId
        })
      } else {
        await ipc.invoke('wallet:approveSignTransaction', {
          requestId: this.pendingTransactionRequest.requestId
        })
      }
      // Response is sent directly to webview by main process
    } catch (error) {
      console.error('[WalletPanel] Error approving transaction:', error)
    }

    this.hideTransactionModal()
  },

  async rejectTransaction() {
    if (!this.pendingTransactionRequest) return

    try {
      if (this.pendingTransactionRequest.isMulti) {
        await ipc.invoke('wallet:rejectSignAllTransactions', {
          requestId: this.pendingTransactionRequest.requestId
        })
      } else {
        await ipc.invoke('wallet:rejectSignTransaction', {
          requestId: this.pendingTransactionRequest.requestId
        })
      }
      // Response is sent directly to webview by main process
    } catch (error) {
      console.error('[WalletPanel] Error rejecting transaction:', error)
    }

    this.hideTransactionModal()
  },

  hideTransactionModal: function () {
    if (this.elements.txInline) {
      this.elements.txInline.classList.remove('active')
    }
    this.pendingTransactionRequest = null
  },

  // Message signing approval - now inline inside wallet panel
  showMessageModal: function (data) {
    this.pendingMessageRequest = data

    // Auto-open the wallet panel
    if (!this.isOpen) {
      this.open()
    }

    // Hide other inline approvals
    this.hideAllInlineApprovals()

    if (this.elements.msgOrigin) {
      this.elements.msgOrigin.textContent = data.origin
    }

    if (this.elements.msgContent) {
      this.elements.msgContent.textContent = data.messageText
    }

    if (this.elements.msgInline) {
      this.elements.msgInline.classList.add('active')
    }
  },

  async approveMessage() {
    if (!this.pendingMessageRequest) return

    try {
      await ipc.invoke('wallet:approveSignMessage', {
        requestId: this.pendingMessageRequest.requestId
      })
      // Response is sent directly to webview by main process
    } catch (error) {
      console.error('[WalletPanel] Error approving message:', error)
    }

    this.hideMessageModal()
  },

  async rejectMessage() {
    if (!this.pendingMessageRequest) return

    try {
      await ipc.invoke('wallet:rejectSignMessage', {
        requestId: this.pendingMessageRequest.requestId
      })
      // Response is sent directly to webview by main process
    } catch (error) {
      console.error('[WalletPanel] Error rejecting message:', error)
    }

    this.hideMessageModal()
  },

  hideMessageModal: function () {
    if (this.elements.msgInline) {
      this.elements.msgInline.classList.remove('active')
    }
    this.pendingMessageRequest = null
  },

  // Panel open/close
  open: function () {
    if (!this.panel) return

    this.panel.classList.add('active')
    this.isOpen = true
    webviews.adjustMargin([0, this.panelWidth, 0, 0])

    // Refresh balance and tokens when opening
    this.refreshBalance()
    this.refreshTokens()
  },

  switchTab: function (tab) {
    var isAssets = tab === 'assets'
    if (this.elements.tabAssetsBtn) this.elements.tabAssetsBtn.classList.toggle('active', isAssets)
    if (this.elements.tabSettingsBtn) this.elements.tabSettingsBtn.classList.toggle('active', !isAssets)
    if (this.elements.tabAssetsPane) this.elements.tabAssetsPane.classList.toggle('active', isAssets)
    if (this.elements.tabSettingsPane) this.elements.tabSettingsPane.classList.toggle('active', !isAssets)
  },

  close: function () {
    if (!this.panel) return

    this.panel.classList.remove('active')
    this.isOpen = false
    webviews.adjustMargin([0, -this.panelWidth, 0, 0])

    // Hide any open modals/displays
    this.hideExportWarning()
    this.hidePrivateKey()

    // Close send modal if open
    if (this.sendModalOpen && this.elements.sendModal) {
      this.elements.sendModal.classList.remove('active')
      this.sendModalOpen = false
    }
  },

  toggle: function () {
    if (this.isOpen) {
      this.close()
    } else {
      this.open()
    }
  },

  async refreshTokens() {
    if (this.isTokensLoading) return

    this.isTokensLoading = true

    // Add spinning animation
    if (this.elements.refreshTokensBtn) {
      this.elements.refreshTokensBtn.classList.add('refreshing')
    }

    try {
      const result = await ipc.invoke('wallet:getTokens')
      if (result.success) {
        var fetched = result.data
        // Re-fetch balance for any custom tokens and merge them in
        var customWithBalance = await Promise.all(this.customTokens.map(async (ct) => {
          // Check if auto-fetch already returned this token (update its balance if so)
          var found = fetched.find(t => (t.mint || t.contractAddress) === ct.contractAddress)
          if (found) return null // already in fetched list, skip duplicate
          // Re-fetch balance for this custom token
          try {
            var lookup = await ipc.invoke('wallet:lookupToken', { contractAddress: ct.contractAddress })
            if (lookup.success) return lookup.data
          } catch (e) {}
          return ct // keep with stale balance if lookup fails
        }))
        // Merge: auto-fetched first, then custom tokens not already in that list
        this.tokens = fetched.concat(customWithBalance.filter(Boolean))
        this.renderTokenList()
      }
    } catch (error) {
      console.error('[WalletPanel] Error refreshing tokens:', error)
    } finally {
      this.isTokensLoading = false
      setTimeout(() => {
        if (this.elements.refreshTokensBtn) {
          this.elements.refreshTokensBtn.classList.remove('refreshing')
        }
      }, 500)
    }
  },

  renderTokenList: function () {
    if (!this.elements.tokensList) return

    if (this.tokens.length === 0) {
      this.elements.tokensList.innerHTML = '<div class="wallet-tokens-empty">No tokens found</div>'
      return
    }

    this.elements.tokensList.innerHTML = this.tokens.map(token => `
      <div class="wallet-token-item" data-mint="${token.contractAddress || token.mint}" data-symbol="${token.symbol}" data-balance="${token.balance}" data-decimals="${token.decimals}" data-logo="${token.logo || ''}">
        <div class="wallet-token-icon">
          ${token.logo ? `<img src="${token.logo}" alt="${token.symbol}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><i class="i carbon:currency" style="display:none"></i>` : '<i class="i carbon:currency"></i>'}
        </div>
        <div class="wallet-token-info">
          <div class="wallet-token-name">${token.name}</div>
          <div class="wallet-token-symbol">${token.symbol}</div>
        </div>
        <div class="wallet-token-balance">
          <div class="wallet-token-amount">${this.formatTokenBalance(token.balance, token.decimals)}</div>
          ${token.usdValue ? `<div class="wallet-token-usd">≈ $${token.usdValue.toFixed(2)}</div>` : ''}
        </div>
        <i class="i carbon:chevron-right wallet-token-arrow"></i>
      </div>
    `).join('')

    // Add click handlers to entire token row
    this.elements.tokensList.querySelectorAll('.wallet-token-item').forEach(item => {
      item.addEventListener('click', () => {
        this.openSendModal('token', {
          mint: item.dataset.mint,
          symbol: item.dataset.symbol,
          balance: parseFloat(item.dataset.balance),
          decimals: parseInt(item.dataset.decimals),
          logo: item.dataset.logo || null
        })
      })
    })
  },

  formatTokenBalance: function (balance, decimals) {
    // Show 0 for zero or extremely small balances instead of scientific notation
    if (balance === 0 || balance < 0.000001) return '0'
    if (balance < 0.0001) return balance.toFixed(6)
    if (balance < 1) return balance.toFixed(4)
    if (balance < 1000) return balance.toFixed(2)
    return balance.toLocaleString(undefined, { maximumFractionDigits: 2 })
  },

  // ================================
  // ADD TOKEN MODAL METHODS
  // ================================

  _pendingTokenData: null,

  showAddTokenModal: function () {
    if (!this.elements.addTokenModal) return
    if (this.elements.addTokenInput) this.elements.addTokenInput.value = ''
    if (this.elements.addTokenError) this.elements.addTokenError.textContent = ''
    if (this.elements.addTokenPreview) this.elements.addTokenPreview.style.display = 'none'
    if (this.elements.addTokenConfirmBtn) this.elements.addTokenConfirmBtn.style.display = 'none'
    if (this.elements.addTokenLookupBtn) this.elements.addTokenLookupBtn.style.display = ''
    this._pendingTokenData = null
    this.elements.addTokenModal.classList.add('active')
  },

  hideAddTokenModal: function () {
    if (this.elements.addTokenModal) this.elements.addTokenModal.classList.remove('active')
    this._pendingTokenData = null
  },

  lookupToken: async function () {
    var addr = this.elements.addTokenInput ? this.elements.addTokenInput.value.trim() : ''
    if (!addr) {
      if (this.elements.addTokenError) this.elements.addTokenError.textContent = 'Please enter a contract address.'
      return
    }

    if (this.elements.addTokenError) this.elements.addTokenError.textContent = ''
    if (this.elements.addTokenLookupBtn) this.elements.addTokenLookupBtn.textContent = 'Looking up...'
    if (this.elements.addTokenPreview) this.elements.addTokenPreview.style.display = 'none'
    if (this.elements.addTokenConfirmBtn) this.elements.addTokenConfirmBtn.style.display = 'none'

    try {
      var result = await ipc.invoke('wallet:lookupToken', { contractAddress: addr })
      if (result.success) {
        var t = result.data
        this._pendingTokenData = t
        if (this.elements.addTokenName) this.elements.addTokenName.textContent = t.name
        if (this.elements.addTokenSymbol) this.elements.addTokenSymbol.textContent = t.symbol
        if (this.elements.addTokenDecimals) this.elements.addTokenDecimals.textContent = t.decimals
        if (this.elements.addTokenBalance) this.elements.addTokenBalance.textContent = this.formatTokenBalance(t.balance, t.decimals) + ' ' + t.symbol
        if (this.elements.addTokenPreview) this.elements.addTokenPreview.style.display = 'block'
        if (this.elements.addTokenConfirmBtn) this.elements.addTokenConfirmBtn.style.display = ''
      } else {
        if (this.elements.addTokenError) this.elements.addTokenError.textContent = result.error || 'Token not found.'
      }
    } catch (err) {
      if (this.elements.addTokenError) this.elements.addTokenError.textContent = 'Error: ' + err.message
    }

    if (this.elements.addTokenLookupBtn) this.elements.addTokenLookupBtn.textContent = 'Look Up'
  },

  addCustomToken: function () {
    if (!this._pendingTokenData) return
    var t = this._pendingTokenData
    var addr = t.contractAddress

    // Save to customTokens so it survives refreshes
    var alreadyCustom = this.customTokens.some(ct => ct.contractAddress === addr)
    if (!alreadyCustom) {
      this.customTokens.push({
        contractAddress: t.contractAddress,
        symbol: t.symbol,
        name: t.name,
        decimals: t.decimals,
        balance: t.balance,
        rawBalance: t.rawBalance,
        logo: t.logo || null
      })
    }

    // Add to visible list if not already shown
    var exists = this.tokens.some(tk => (tk.mint || tk.contractAddress) === addr)
    if (!exists) {
      this.tokens.push({
        contractAddress: t.contractAddress,
        symbol: t.symbol,
        name: t.name,
        decimals: t.decimals,
        balance: t.balance,
        rawBalance: t.rawBalance,
        logo: t.logo || null
      })
      this.renderTokenList()
    }

    this.hideAddTokenModal()
  },

  // ================================
  // SEND MODAL METHODS
  // ================================

  openSendModal: async function (type, tokenData) {
    // Refresh balance first to get latest on-chain balance (important after dApp transactions)
    await this.refreshBalance()

    if (type === 'sol') {
      this.sendAsset = {
        type: 'sol',
        symbol: 'SOL',
        balance: this.balance.sol || 0,
        decimals: 9,
        logo: null
      }
    } else {
      this.sendAsset = {
        type: 'token',
        ...tokenData
      }
    }

    // Update modal UI
    if (this.elements.sendTitle) {
      this.elements.sendTitle.textContent = `Send ${this.sendAsset.symbol}`
    }
    if (this.elements.sendAssetSymbol) {
      this.elements.sendAssetSymbol.textContent = this.sendAsset.symbol
    }
    if (this.elements.sendAssetBalance) {
      const balanceStr = this.sendAsset.type === 'sol'
        ? this.formatSolBalance(this.sendAsset.balance)
        : this.formatTokenBalance(this.sendAsset.balance, this.sendAsset.decimals)
      this.elements.sendAssetBalance.textContent = `Balance: ${balanceStr}`
    }
    if (this.elements.sendAssetIcon) {
      if (this.sendAsset.logo) {
        this.elements.sendAssetIcon.innerHTML = `<img src="${this.sendAsset.logo}" alt="${this.sendAsset.symbol}" onerror="this.style.display='none'">`
      } else {
        this.elements.sendAssetIcon.innerHTML = '<i class="i carbon:currency"></i>'
      }
    }

    // Reset form
    if (this.elements.sendRecipient) this.elements.sendRecipient.value = ''
    if (this.elements.sendAmount) this.elements.sendAmount.value = ''
    if (this.elements.sendRecipientError) this.elements.sendRecipientError.textContent = ''
    if (this.elements.sendAmountError) this.elements.sendAmountError.textContent = ''
    if (this.elements.sendSummary) this.elements.sendSummary.style.display = 'none'
    if (this.elements.sendConfirmBtn) this.elements.sendConfirmBtn.disabled = true

    // Show modal
    this.resetSendModal()
    if (this.elements.sendModal) {
      this.elements.sendModal.classList.add('active')
    }
    this.sendModalOpen = true

    // Fetch fee estimate
    this.updateFeeEstimate()

    // Show/hide token info panel and load data
    if (this.elements.tokenInfoPanel) {
      if (type === 'token' && tokenData && tokenData.mint) {
        this.elements.tokenInfoPanel.style.display = 'block'
        this.loadTokenInfo(tokenData.mint)
      } else {
        this.elements.tokenInfoPanel.style.display = 'none'
      }
    }
  },

  loadTokenInfo: async function (mintAddress) {
    const el = this.elements
    // Reset all to loading state
    const fields = ['wtiName', 'wtiSymbol', 'wtiNetwork', 'wtiMint', 'wtiPrice', 'wtiMarketCap', 'wtiSupply', 'wtiHolders', 'wtiCreated']
    fields.forEach(f => { if (el[f]) el[f].textContent = '...' })

    // Show mint and network immediately (we already know these)
    if (el.wtiMint) el.wtiMint.textContent = mintAddress.substring(0, 4) + '...' + mintAddress.slice(-4)
    if (el.wtiNetwork) el.wtiNetwork.textContent = 'Solana'

    // Wire copy button with full mint address
    if (el.wtiMintCopy) {
      el.wtiMintCopy.onclick = () => {
        navigator.clipboard.writeText(mintAddress).then(() => {
          const icon = el.wtiMintCopy.querySelector('.i')
          if (icon) {
            icon.className = 'i carbon:checkmark'
            setTimeout(() => { icon.className = 'i carbon:copy' }, 1500)
          }
        })
      }
    }

    try {
      const netResult = await ipc.invoke('wallet:getNetwork')
      const network = (netResult.data && netResult.data.network) || 'mainnet-beta'
      const result = await ipc.invoke('wallet:getTokenInfo', { mintAddress, network })

      if (!result.success) return

      const info = result.data
      if (el.wtiName) el.wtiName.textContent = info.name || '—'
      if (el.wtiSymbol) el.wtiSymbol.textContent = info.symbol || '—'
      if (el.wtiNetwork) el.wtiNetwork.textContent = network === 'devnet' ? 'Solana Devnet' : 'Solana'
      if (el.wtiPrice) el.wtiPrice.textContent = info.price ? '$' + info.price.toFixed(info.price < 0.0001 ? 8 : info.price < 0.01 ? 6 : 4) : '—'
      if (el.wtiMarketCap) el.wtiMarketCap.textContent = info.marketCap ? '$' + this.formatLargeNumber(info.marketCap) : '—'
      if (el.wtiSupply) el.wtiSupply.textContent = info.totalSupply ? this.formatLargeNumber(parseFloat(info.totalSupply)) : '—'
      if (el.wtiHolders) el.wtiHolders.textContent = info.topHolders ? info.topHolders + (info.topHolders === 20 ? '+' : '') : '—'
      if (el.wtiCreated) el.wtiCreated.textContent = info.createdAt || '—'
    } catch (e) {
      fields.forEach(f => { if (el[f] && el[f].textContent === '...') el[f].textContent = '—' })
    }
  },

  formatLargeNumber: function (n) {
    if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B'
    if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M'
    if (n >= 1e3) return (n / 1e3).toFixed(2) + 'K'
    return n.toLocaleString(undefined, { maximumFractionDigits: 2 })
  },

  closeSendModal: function () {
    if (this.elements.sendModal) {
      this.elements.sendModal.classList.remove('active')
    }
    this.sendModalOpen = false
    this.sendAsset = null

    // Refresh balance and tokens after sending
    this.refreshBalance()
    this.refreshTokens()
  },

  resetSendModal: function () {
    // Hide all states, show form
    if (this.elements.sendModal) {
      const content = this.elements.sendModal.querySelector('.wallet-send-modal-content')
      if (content) content.style.display = 'flex'
    }
    if (this.elements.sendProcessing) this.elements.sendProcessing.style.display = 'none'
    if (this.elements.sendSuccess) this.elements.sendSuccess.style.display = 'none'
    if (this.elements.sendErrorState) this.elements.sendErrorState.style.display = 'none'
    // Hide fee row until user enters recipient + amount
    const feeRow = this.elements.sendFeeAmount && this.elements.sendFeeAmount.closest('.wallet-send-fee')
    if (feeRow) feeRow.style.display = 'none'
  },

  _feeDebounceTimer: null,

  updateFeeEstimate() {
    clearTimeout(this._feeDebounceTimer)
    this._feeDebounceTimer = setTimeout(() => this._doFeeEstimate(), 400)
  },

  async _doFeeEstimate() {
    try {
      const recipient = this.elements.sendRecipient ? this.elements.sendRecipient.value.trim() : ''
      const amountStr = this.elements.sendAmount ? this.elements.sendAmount.value.trim() : ''
      const amount = parseFloat(amountStr)
      const isToken = this.sendAsset && this.sendAsset.type === 'token'

      // Only show the fee once the user has entered a plausible recipient + amount
      const hasInputs = !!(recipient && recipient.length >= 32 && recipient.length <= 44 && amount > 0)

      const result = await ipc.invoke('wallet:estimateFee')
      if (!result.success) return

      // Token transfers may also create the recipient's token account; keep a small buffer
      this.estimatedFee = isToken ? result.data.fee * 2 : result.data.fee

      // Only show fee row when user has entered recipient + amount
      const feeRow = this.elements.sendFeeAmount && this.elements.sendFeeAmount.closest('.wallet-send-fee')
      if (feeRow) feeRow.style.display = hasInputs ? 'flex' : 'none'

      if (hasInputs && this.elements.sendFeeAmount) {
        this.elements.sendFeeAmount.textContent = this.formatFeeUsd(this.estimatedFee)
      }
    } catch (error) {
      console.error('[WalletPanel] Error estimating fee:', error)
    }
  },

  // Format fee as USD — anything under $0.01 shows as "< $0.01"
  formatFeeUsd: function (feeSol) {
    var usd = feeSol * this.solPrice
    if (usd < 0.01) return '< $0.01'
    if (usd < 1)    return '≈ $' + usd.toFixed(3)
    return '≈ $' + usd.toFixed(2)
  },


  // Keep for any legacy callers
  formatFeeDisplay: function (feeSol) {
    return this.formatFeeUsd(feeSol)
  },

  setMaxAmount: function () {
    if (!this.sendAsset || !this.elements.sendAmount) return

    let maxAmount = this.sendAsset.balance

    // For SOL, subtract the estimated network fee (in lamports to avoid float drift)
    if (this.sendAsset.type === 'sol') {
      const balanceLamports = Math.floor(this.sendAsset.balance * 1e9)
      const feeLamports = Math.floor(this.estimatedFee * 1e9)
      const maxLamports = Math.max(0, balanceLamports - feeLamports)
      maxAmount = maxLamports / 1e9
    }

    // Display with 6 decimal places for precision
    const decimals = 6
    this.elements.sendAmount.value = maxAmount > 0 ? maxAmount.toFixed(decimals) : '0'
    this.validateSendForm()
  },

  async validateSendForm() {
    let isValid = true
    const recipient = this.elements.sendRecipient?.value.trim() || ''
    const amountStr = this.elements.sendAmount?.value.trim() || ''
    const amount = parseFloat(amountStr)

    // Reset errors
    if (this.elements.sendRecipientError) this.elements.sendRecipientError.textContent = ''
    if (this.elements.sendAmountError) this.elements.sendAmountError.textContent = ''
    if (this.elements.sendRecipient) this.elements.sendRecipient.classList.remove('error')
    if (this.elements.sendAmount) this.elements.sendAmount.classList.remove('error')

    // Validate recipient
    if (recipient) {
      try {
        const result = await ipc.invoke('wallet:validateAddress', { address: recipient })
        if (!result.success || !result.data.isValid) {
          if (this.elements.sendRecipientError) this.elements.sendRecipientError.textContent = 'Invalid address'
          if (this.elements.sendRecipient) this.elements.sendRecipient.classList.add('error')
          isValid = false
        }
      } catch (e) {
        isValid = false
      }
    } else {
      isValid = false
    }

    if (!amountStr || isNaN(amount) || amount <= 0) {
      isValid = false
    } else if (this.sendAsset) {
      let maxAmount
      if (this.sendAsset.type === 'sol') {
        const balanceLamports = Math.floor(this.sendAsset.balance * 1e9)
        const feeLamports = Math.floor(this.estimatedFee * 1e9)
        const maxLamports = Math.max(0, balanceLamports - feeLamports)
        maxAmount = maxLamports / 1e9
      } else {
        maxAmount = this.sendAsset.balance
      }

      // Compare with epsilon to handle floating point comparison (1 lamport tolerance)
      if (amount > maxAmount + 0.000001) {
        if (this.elements.sendAmountError) this.elements.sendAmountError.textContent = 'Insufficient balance'
        if (this.elements.sendAmount) this.elements.sendAmount.classList.add('error')
        isValid = false
      }
    }

    

    // Update summary
    if (isValid && this.elements.sendSummary) {
      this.elements.sendSummary.style.display = 'block'
      if (this.elements.sendSummaryAmount) {
        this.elements.sendSummaryAmount.textContent = `${amount} ${this.sendAsset.symbol}`
      }
      if (this.elements.sendSummaryRecipient) {
        this.elements.sendSummaryRecipient.textContent = recipient.substring(0, 8) + '...' + recipient.substring(recipient.length - 8)
      }
    } else if (this.elements.sendSummary) {
      this.elements.sendSummary.style.display = 'none'
    }

    if (this.elements.sendConfirmBtn) {
      this.elements.sendConfirmBtn.disabled = !isValid
    }


    return isValid
  },

  async executeSend() {
    if (!this.sendAsset) return

    const recipient = this.elements.sendRecipient?.value.trim()
    const amount = parseFloat(this.elements.sendAmount?.value || '0')

    if (!recipient || !amount) return

    // Show processing state
    const content = this.elements.sendModal?.querySelector('.wallet-send-modal-content')
    if (content) content.style.display = 'none'
    if (this.elements.sendProcessing) this.elements.sendProcessing.style.display = 'flex'

    try {
      let result
      if (this.sendAsset.type === 'sol') {
        result = await ipc.invoke('wallet:sendSOL', { recipient, amount })
      } else {
        result = await ipc.invoke('wallet:sendToken', {
          mint: this.sendAsset.contractAddress || this.sendAsset.mint,
          recipient,
          amount,
          decimals: this.sendAsset.decimals
        })
      }

      if (result.success) {
        if (this.elements.sendProcessing) this.elements.sendProcessing.style.display = 'none'
        if (this.elements.sendSuccess) this.elements.sendSuccess.style.display = 'flex'
        if (this.elements.sendSuccessMessage) {
          this.elements.sendSuccessMessage.textContent = `Sent ${amount} ${this.sendAsset.symbol} successfully!`
        }
        if (this.elements.sendExplorerLink) {
          const explorerUrl = this.network === 'devnet'
            ? `https://solscan.io/tx/${result.data.signature}?cluster=devnet`
            : `https://solscan.io/tx/${result.data.signature}`
          this.elements.sendExplorerLink.href = explorerUrl
        }
      } else {
        throw new Error(result.error || 'Transaction failed')
      }
    } catch (error) {
      console.error('[WalletPanel] Send error:', error)
      if (this.elements.sendProcessing) this.elements.sendProcessing.style.display = 'none'
      if (this.elements.sendErrorState) this.elements.sendErrorState.style.display = 'flex'
      if (this.elements.sendErrorMessage) {
        this.elements.sendErrorMessage.textContent = this.parseTransactionError(error.message)
      }
    }
  },

  parseTransactionError: function (errorMessage) {
    if (!errorMessage) return 'Transaction failed'
    const msg = errorMessage.toLowerCase()
    if (msg.includes('insufficient funds') || msg.includes('insufficient lamports')) {
      return 'Insufficient balance for this transaction'
    }
    if (msg.includes('rent') || msg.includes('below rent-exempt minimum')) {
      return 'Amount would leave account below minimum balance'
    }
    if (msg.includes('blockhash') && (msg.includes('expired') || msg.includes('not found'))) {
      return 'Transaction expired. Please try again'
    }
    if (msg.includes('timeout') || msg.includes('network') || msg.includes('connection')) {
      return 'Network error. Please check your connection'
    }
    if (msg.includes('invalid') && msg.includes('address')) {
      return 'Invalid recipient address'
    }
    if (msg.includes('simulation failed')) {
      return 'Transaction simulation failed'
    }
    if (msg.includes('custom program error')) {
      return 'Transaction rejected by program'
    }
    if (errorMessage.length > 100) {
      return 'Transaction failed. Please try again'
    }
    return errorMessage
  }
}

module.exports = walletPanel
