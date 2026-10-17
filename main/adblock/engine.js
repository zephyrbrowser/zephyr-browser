// main/adblock/engine.js
// Core ad blocking engine using @ghostery/adblocker-electron (Brave-inspired, actively maintained)

const { ElectronBlocker } = require('@ghostery/adblocker-electron')

class AdblockEngine {
  constructor(storage, listManager) {
    this.storage = storage
    this.listManager = listManager
    this.blocker = null
    this.session = null
    this.blockedCounts = new Map() // webContentsId -> count
    this.isAttached = false
  }

  async initialize() {
    try {
      if ((process.env.ADBLOCK_DEBUG === '1')) console.log('[Adblock Engine] Initializing...')

      // Ensure filter lists exist
      await this.listManager.ensureListsExist()

      // Build engine from local lists
      await this.buildEngine()

      if ((process.env.ADBLOCK_DEBUG === '1')) console.log('[Adblock Engine] Initialized successfully')
      return true
    } catch (error) {
      console.error('[Adblock Engine] Initialization failed:', error)
      return false
    }
  }

  async buildEngine() {
    try {
      if ((process.env.ADBLOCK_DEBUG === '1')) console.log('[Adblock Engine] Building blocker from filter lists...')

      // Get combined filter lists
      const filterLists = this.listManager.getCombinedLists()

      if (!filterLists) {
        throw new Error('No filter lists available')
      }

      // Parse and create blocker with AGGRESSIVE settings (Brave-like)
      this.blocker = await ElectronBlocker.parse(filterLists, {
        enableCompression: true,
        enableHtmlFiltering: true, // Enable for better ad removal (cosmetic filtering)
        enableMutationObserver: true, // Watch for dynamically added ads
        loadCosmeticFilters: true, // Load element hiding rules
        loadGenericCosmeticsFilters: true, // More aggressive cosmetic blocking
        loadNetworkFilters: true // Network-level blocking
      })

      if ((process.env.ADBLOCK_DEBUG === '1')) {
        const stats = this.blocker.getFilters()
        console.log('[Adblock Engine] Blocker built:', {
          networkFilters: stats.networkFilters?.length || 0,
          cosmeticFilters: stats.cosmeticFilters?.length || 0
        })
      }

      // Re-attach if we had a session
      if (this.session && this.isAttached) {
        await this.detachFromSession()
        await this.attachToSession(this.session)
      }

      return true
    } catch (error) {
      console.error('[Adblock Engine] Build failed:', error)
      return false
    }
  }

  async attachToSession(session) {
    if (!this.blocker) {
      console.error('[Adblock Engine] Cannot attach: blocker not initialized')
      return false
    }

    try {
      this.session = session

      // Enable blocking in session
      this.blocker.enableBlockingInSession(session)

      // Track blocked requests
      this.blocker.on('request-blocked', (details) => {
        this.incrementBlockedCount(details.webContentsId)
        if ((process.env.ADBLOCK_DEBUG === '1')) console.log('[Adblock] Blocked:', details.url)
      })

      this.blocker.on('request-redirected', (details) => {
        if ((process.env.ADBLOCK_DEBUG === '1')) console.log('[Adblock] Redirected:', details.url)
      })

      // Custom filtering logic to respect allowlist
      const originalMatch = this.blocker.match.bind(this.blocker)
      this.blocker.match = (request) => {
        // Check if adblock is globally disabled
        if (!this.storage.isEnabled()) {
          return { match: false }
        }

        // Check if site is allowlisted
        const url = request.url || request.sourceUrl || ''
        const hostname = this.extractHostname(url)

        if (hostname && this.storage.isSiteAllowlisted(hostname)) {
          return { match: false }
        }

        // Check source URL for allowlist too
        const sourceUrl = request.sourceUrl || request.documentURL || ''
        const sourceHostname = this.extractHostname(sourceUrl)

        if (sourceHostname && this.storage.isSiteAllowlisted(sourceHostname)) {
          return { match: false }
        }

        // Use original matching logic
        return originalMatch(request)
      }

      this.isAttached = true
      if ((process.env.ADBLOCK_DEBUG === '1')) console.log('[Adblock Engine] Attached to session')
      return true
    } catch (error) {
      console.error('[Adblock Engine] Error attaching to session:', error)
      return false
    }
  }

  async detachFromSession() {
    if (this.blocker && this.session) {
      try {
        // Remove all listeners
        this.blocker.removeAllListeners('request-blocked')
        this.blocker.removeAllListeners('request-redirected')

        this.isAttached = false
        if ((process.env.ADBLOCK_DEBUG === '1')) console.log('[Adblock Engine] Detached from session')
      } catch (error) {
        console.error('[Adblock Engine] Error detaching:', error)
      }
    }
  }

  extractHostname(url) {
    try {
      const urlObj = new URL(url)
      return urlObj.hostname
    } catch (error) {
      return null
    }
  }

  incrementBlockedCount(webContentsId) {
    if (!webContentsId) return

    const current = this.blockedCounts.get(webContentsId) || 0
    this.blockedCounts.set(webContentsId, current + 1)
  }

  getBlockedCount(webContentsId) {
    return this.blockedCounts.get(webContentsId) || 0
  }

  resetBlockedCount(webContentsId) {
    this.blockedCounts.delete(webContentsId)
  }

  clearAllBlockedCounts() {
    this.blockedCounts.clear()
  }

  async rebuild() {
    if ((process.env.ADBLOCK_DEBUG === '1')) console.log('[Adblock Engine] Rebuilding engine...')
    await this.detachFromSession()
    await this.buildEngine()
    if (this.session) {
      await this.attachToSession(this.session)
    }
  }

  getCosmeticFilters(url) {
    if (!this.blocker || !this.storage.isEnabled()) {
      return { styles: '', scripts: [] }
    }

    const hostname = this.extractHostname(url)
    if (hostname && this.storage.isSiteAllowlisted(hostname)) {
      return { styles: '', scripts: [] }
    }

    try {
      const { styles = '', scripts = [] } = this.blocker.getCosmeticsFilters({
        url,
        hostname: hostname || '',
        domain: hostname || ''
      })

      return { styles, scripts }
    } catch (error) {
      if ((process.env.ADBLOCK_DEBUG === '1')) console.error('[Adblock Engine] Error getting cosmetic filters:', error)
      return { styles: '', scripts: [] }
    }
  }

  isEnabled() {
    return this.storage.isEnabled()
  }

  setEnabled(enabled) {
    return this.storage.setEnabled(enabled)
  }
}

module.exports = AdblockEngine
