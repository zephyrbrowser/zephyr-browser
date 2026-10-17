// js/preload/adblock.js
// Preload script for adblock API exposure to renderer

const { contextBridge, ipcRenderer } = require('electron')

// Expose adblock API to renderer process
contextBridge.exposeInMainWorld('zephyrAdblock', {
  /**
   * Get current adblock status
   * @returns {Promise<{enabled: boolean, siteEnabled: boolean, host: string, blockedCount: number, lastUpdated: string}>}
   */
  getStatus: async function () {
    try {
      const result = await ipcRenderer.invoke('adblock:getStatus')
      return result.success ? result.data : null
    } catch (error) {
      console.error('[Adblock API] getStatus error:', error)
      return null
    }
  },

  /**
   * Toggle global adblock on/off
   * @returns {Promise<boolean>} New enabled state
   */
  toggleGlobal: async function () {
    try {
      const result = await ipcRenderer.invoke('adblock:toggleGlobal')
      return result.success ? result.data.enabled : null
    } catch (error) {
      console.error('[Adblock API] toggleGlobal error:', error)
      return null
    }
  },

  /**
   * Toggle adblock for current site or specific hostname
   * @param {string} hostname - Optional hostname to toggle
   * @returns {Promise<{allowlisted: boolean, hostname: string}>}
   */
  toggleSite: async function (hostname = null) {
    try {
      const result = await ipcRenderer.invoke('adblock:toggleSite', hostname)
      return result.success ? result.data : null
    } catch (error) {
      console.error('[Adblock API] toggleSite error:', error)
      return null
    }
  },

  /**
   * Update filter lists (downloads from internet)
   * @param {boolean} force - Force update even if recently updated
   * @returns {Promise<{success: boolean, updated: boolean, listsCount: number}>}
   */
  updateLists: async function (force = false) {
    try {
      const result = await ipcRenderer.invoke('adblock:updateLists', force)
      return result
    } catch (error) {
      console.error('[Adblock API] updateLists error:', error)
      return { success: false, error: error.message }
    }
  },

  /**
   * Get filter lists metadata
   * @returns {Promise<{lists: object, lastUpdated: string}>}
   */
  getListsInfo: async function () {
    try {
      const result = await ipcRenderer.invoke('adblock:getListsInfo')
      return result.success ? result.data : null
    } catch (error) {
      console.error('[Adblock API] getListsInfo error:', error)
      return null
    }
  },

  /**
   * Get blocked requests count for current page
   * @returns {Promise<number>}
   */
  getBlockedCount: async function () {
    try {
      const result = await ipcRenderer.invoke('adblock:getBlockedCount')
      return result.success ? result.data.blockedCount : 0
    } catch (error) {
      console.error('[Adblock API] getBlockedCount error:', error)
      return 0
    }
  }
})

// Expose IPC bridge for YouTube ad skip functionality
contextBridge.exposeInMainWorld('ipc', {
  send: function (channel, data) {
    // Whitelist specific channels for security
    const validChannels = ['youtube-skip-click']
    if (validChannels.includes(channel)) {
      ipcRenderer.send(channel, data)
    } else {
      console.error('[IPC Bridge] Invalid channel:', channel)
    }
  }
})
