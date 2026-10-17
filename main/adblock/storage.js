// main/adblock/storage.js
// Persistent storage for adblock settings and filter lists

const fsAdblock = require('fs')
const pathStorage = require('path')
const { app: electronApp } = require('electron')

class AdblockStorage {
  constructor() {
    this.userDataPath = electronApp.getPath('userData')
    this.adblockDir = pathStorage.join(this.userDataPath, 'adblock')
    this.settingsPath = pathStorage.join(this.adblockDir, 'settings.json')
    this.listsDir = pathStorage.join(this.adblockDir, 'lists')
    this.metadataPath = pathStorage.join(this.adblockDir, 'metadata.json')

    this.ensureDirectories()
    this.settings = this.loadSettings()
    this.metadata = this.loadMetadata()
  }

  ensureDirectories() {
    if (!fsAdblock.existsSync(this.adblockDir)) {
      fsAdblock.mkdirSync(this.adblockDir, { recursive: true })
    }
    if (!fsAdblock.existsSync(this.listsDir)) {
      fsAdblock.mkdirSync(this.listsDir, { recursive: true })
    }
  }

  loadSettings() {
    try {
      if (fsAdblock.existsSync(this.settingsPath)) {
        const data = fsAdblock.readFileSync(this.settingsPath, 'utf8')
        return JSON.parse(data)
      }
    } catch (error) {
      if ((process.env.ADBLOCK_DEBUG === '1')) console.error('[Adblock Storage] Error loading settings:', error)
    }

    // Default settings
    return {
      enabled: true,
      allowlist: [] // hostnames that have adblock disabled
    }
  }

  saveSettings() {
    try {
      fsAdblock.writeFileSync(this.settingsPath, JSON.stringify(this.settings, null, 2))
      return true
    } catch (error) {
      if ((process.env.ADBLOCK_DEBUG === '1')) console.error('[Adblock Storage] Error saving settings:', error)
      return false
    }
  }

  loadMetadata() {
    try {
      if (fsAdblock.existsSync(this.metadataPath)) {
        const data = fsAdblock.readFileSync(this.metadataPath, 'utf8')
        return JSON.parse(data)
      }
    } catch (error) {
      if ((process.env.ADBLOCK_DEBUG === '1')) console.error('[Adblock Storage] Error loading metadata:', error)
    }

    return {
      lists: {},
      lastUpdated: null
    }
  }

  saveMetadata() {
    try {
      fsAdblock.writeFileSync(this.metadataPath, JSON.stringify(this.metadata, null, 2))
      return true
    } catch (error) {
      if ((process.env.ADBLOCK_DEBUG === '1')) console.error('[Adblock Storage] Error saving metadata:', error)
      return false
    }
  }

  // Settings methods
  isEnabled() {
    return this.settings.enabled
  }

  setEnabled(enabled) {
    this.settings.enabled = enabled
    return this.saveSettings()
  }

  isSiteAllowlisted(hostname) {
    return this.settings.allowlist.includes(hostname)
  }

  addToAllowlist(hostname) {
    if (!this.settings.allowlist.includes(hostname)) {
      this.settings.allowlist.push(hostname)
      this.saveSettings()
    }
  }

  removeFromAllowlist(hostname) {
    const index = this.settings.allowlist.indexOf(hostname)
    if (index > -1) {
      this.settings.allowlist.splice(index, 1)
      this.saveSettings()
    }
  }

  toggleSiteAllowlist(hostname) {
    if (this.isSiteAllowlisted(hostname)) {
      this.removeFromAllowlist(hostname)
      return false // now not allowlisted
    } else {
      this.addToAllowlist(hostname)
      return true // now allowlisted
    }
  }

  // Filter list storage
  saveFilterList(listName, content) {
    try {
      const filePath = pathStorage.join(this.listsDir, `${listName}.txt`)
      fsAdblock.writeFileSync(filePath, content, 'utf8')

      // Update metadata
      this.metadata.lists[listName] = {
        size: Buffer.byteLength(content, 'utf8'),
        updated: new Date().toISOString()
      }
      this.metadata.lastUpdated = new Date().toISOString()
      this.saveMetadata()

      return true
    } catch (error) {
      if ((process.env.ADBLOCK_DEBUG === '1')) console.error(`[Adblock Storage] Error saving list ${listName}:`, error)
      return false
    }
  }

  loadFilterList(listName) {
    try {
      const filePath = pathStorage.join(this.listsDir, `${listName}.txt`)
      if (fsAdblock.existsSync(filePath)) {
        return fsAdblock.readFileSync(filePath, 'utf8')
      }
    } catch (error) {
      if ((process.env.ADBLOCK_DEBUG === '1')) console.error(`[Adblock Storage] Error loading list ${listName}:`, error)
    }
    return null
  }

  getAllFilterLists() {
    const lists = {}
    try {
      const files = fsAdblock.readdirSync(this.listsDir)
      for (const file of files) {
        if (file.endsWith('.txt')) {
          const listName = file.replace('.txt', '')
          const content = this.loadFilterList(listName)
          if (content) {
            lists[listName] = content
          }
        }
      }
    } catch (error) {
      if ((process.env.ADBLOCK_DEBUG === '1')) console.error('[Adblock Storage] Error getting all filter lists:', error)
    }
    return lists
  }

  hasFilterLists() {
    try {
      const files = fsAdblock.readdirSync(this.listsDir)
      return files.some(f => f.endsWith('.txt'))
    } catch (error) {
      return false
    }
  }

  getMetadata() {
    return this.metadata
  }

  clearAllLists() {
    try {
      const files = fsAdblock.readdirSync(this.listsDir)
      for (const file of files) {
        fsAdblock.unlinkSync(pathStorage.join(this.listsDir, file))
      }
      this.metadata.lists = {}
      this.saveMetadata()
      return true
    } catch (error) {
      if ((process.env.ADBLOCK_DEBUG === '1')) console.error('[Adblock Storage] Error clearing lists:', error)
      return false
    }
  }
}

module.exports = AdblockStorage
