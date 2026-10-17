// main/adblock/lists.js
// Filter list management and updates

const fetch = require('cross-fetch')

// Default filter lists - Enhanced with YouTube-specific lists
const DEFAULT_LISTS = {
  easylist: 'https://easylist.to/easylist/easylist.txt',
  easyprivacy: 'https://easylist.to/easylist/easyprivacy.txt',
  ublock_filters: 'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/filters.txt',
  ublock_privacy: 'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/privacy.txt',
  ublock_annoyances: 'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/annoyances.txt',
  ublock_unbreak: 'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/unbreak.txt',
  // Brave's additional lists
  brave_unbreak: 'https://raw.githubusercontent.com/brave/adblock-lists/master/brave-unbreak.txt',
  // Peter Lowe's Ad and tracking server list (lightweight, effective)
  peter_lowe: 'https://pgl.yoyo.org/adservers/serverlist.php?hostformat=adblockplus&showintro=0&mimetype=plaintext'
}

// Hard-coded YouTube and general ad blocking rules (network level)
// AGGRESSIVE blocking based on Brave's and uBlock Origin's approaches
const YOUTUBE_BLOCKING_RULES = `
! ===== YOUTUBE ADS - AGGRESSIVE BLOCKING =====
! Block YouTube ad endpoints
||youtube.com/api/stats/ads$important
||youtube.com/api/stats/qoe?*adformat=$important
||youtube.com/pagead/*$important
||youtube.com/ptracking$important
||youtube.com/get_video_info*&adformat=$important
||youtube.com/youtubei/v1/player/ad_break$important
||youtube.com/get_midroll_info$important
||youtube.com/ad_data_204$important
||youtube.com/api/stats/watchtime$important

! Block ad video playback
||googlevideo.com/videoplayback*&oad=$important
||googlevideo.com/videoplayback*&adformat=$important
||googlevideo.com/videoplayback*&ctier=$important
||googlevideo.com/videoplayback*ad_break$important
||googlevideo.com/videoplayback*&ad_cpn=$important

! Block YouTube ad domains
||ads.youtube.com^$important
||youtube.com^*/ad_companion_bin.js$important
||youtube.com^*/ad_data_204$important

! Block IMA SDK (Google's ad serving SDK)
||imasdk.googleapis.com/js/sdkloader/ima3.js$important
||imasdk.googleapis.com/js/sdkloader/ima3_dai.js$important
||imasdk.googleapis.com/preroll$important

! Block video ad stats
||video-ad-stats.googlesyndication.com^$important
||s.youtube.com/api/stats/qoe?*ad$important

! ===== GOOGLE ADS NETWORK =====
||doubleclick.net^$third-party
||googlesyndication.com^$third-party
||googleadservices.com^$third-party
||google-analytics.com/collect$third-party
||google-analytics.com/analytics.js$third-party
||adservice.google.com^$important
||pagead2.googlesyndication.com^$important
||tpc.googlesyndication.com^$important
||tpc.googlesyndication.com/safeframe^$important

! ===== SOCIAL MEDIA ADS =====
||static.ads-twitter.com^$third-party
||ads-api.twitter.com^$third-party
||facebook.com/tr$third-party
||connect.facebook.net/*/fbevents.js$third-party

! ===== OUTBRAIN & TABOOLA (Content Recommendation Ads) =====
||outbrain.com^$third-party
||taboola.com^$third-party
||widgets.outbrain.com^$important
||trc.taboola.com^$important
||cdn.taboola.com^$third-party
||images.taboola.com^$third-party

! ===== MAJOR AD NETWORKS =====
||serving-sys.com^$third-party
||smartadserver.com^$third-party
||pubmatic.com^$third-party
||openx.net^$third-party
||advertising.com^$third-party
||rubiconproject.com^$third-party
||contextweb.com^$third-party
||casalemedia.com^$third-party
||criteo.com^$third-party
||criteo.net^$third-party
||adsrvr.org^$third-party
||adnxs.com^$third-party

! ===== STREAMING PLATFORM ADS =====
||ads.twitch.tv^$important
||pubads.g.doubleclick.net^$important
||securepubads.g.doubleclick.net^$important

! ===== TRACKING & ANALYTICS =====
||googletagmanager.com/gtm.js$third-party
||googletagservices.com/tag/js/gpt.js$important
||www.googletagservices.com^$third-party
`.trim()

class ListManager {
  constructor(storage) {
    this.storage = storage
    this.updatePromise = null
  }

  async downloadList(url, listName) {
    try {
      if ((process.env.ADBLOCK_DEBUG === '1')) console.log(`[Adblock Lists] Downloading ${listName} from ${url}`)

      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Zephyr-Browser/1.0'
        },
        timeout: 60000
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      const content = await response.text()

      if (!content || content.length < 100) {
        throw new Error('Invalid or empty filter list')
      }

      if ((process.env.ADBLOCK_DEBUG === '1')) console.log(`[Adblock Lists] Downloaded ${listName}: ${content.length} bytes`)

      return content
    } catch (error) {
      if ((process.env.ADBLOCK_DEBUG === '1')) console.error(`[Adblock Lists] Error downloading ${listName}:`, error.message)
      return null
    }
  }

  async downloadAllLists() {
    const results = {}
    const promises = []

    for (const [name, url] of Object.entries(DEFAULT_LISTS)) {
      promises.push(
        this.downloadList(url, name)
          .then(content => {
            if (content) {
              results[name] = content
            }
          })
      )
    }

    await Promise.all(promises)

    if ((process.env.ADBLOCK_DEBUG === '1')) console.log(`[Adblock Lists] Downloaded ${Object.keys(results).length}/${Object.keys(DEFAULT_LISTS).length} lists`)

    return results
  }

  async updateLists(forceUpdate = false) {
    // Prevent concurrent updates
    if (this.updatePromise) {
      if ((process.env.ADBLOCK_DEBUG === '1')) console.log('[Adblock Lists] Update already in progress')
      return this.updatePromise
    }

    this.updatePromise = this._performUpdate(forceUpdate)
    const result = await this.updatePromise
    this.updatePromise = null

    return result
  }

  async _performUpdate(forceUpdate) {
    try {
      // Check if update is needed
      const metadata = this.storage.getMetadata()
      const lastUpdated = metadata.lastUpdated ? new Date(metadata.lastUpdated) : null

      if (!forceUpdate && lastUpdated) {
        const hoursSinceUpdate = (Date.now() - lastUpdated.getTime()) / (1000 * 60 * 60)
        if (hoursSinceUpdate < 24) {
          if ((process.env.ADBLOCK_DEBUG === '1')) console.log(`[Adblock Lists] Lists updated ${Math.round(hoursSinceUpdate)}h ago, skipping`)
          return { success: true, updated: false, message: 'Lists are up to date' }
        }
      }

      if ((process.env.ADBLOCK_DEBUG === '1')) console.log('[Adblock Lists] Starting list update...')

      // Download all lists
      const lists = await this.downloadAllLists()

      if (Object.keys(lists).length === 0) {
        throw new Error('Failed to download any filter lists')
      }

      // Save all downloaded lists
      let savedCount = 0
      for (const [name, content] of Object.entries(lists)) {
        if (this.storage.saveFilterList(name, content)) {
          savedCount++
        }
      }

      if ((process.env.ADBLOCK_DEBUG === '1')) console.log(`[Adblock Lists] Saved ${savedCount} lists successfully`)

      return {
        success: true,
        updated: true,
        listsCount: savedCount,
        metadata: this.storage.getMetadata()
      }
    } catch (error) {
      if ((process.env.ADBLOCK_DEBUG === '1')) console.error('[Adblock Lists] Update failed:', error)
      return {
        success: false,
        updated: false,
        error: error.message
      }
    }
  }

  async ensureListsExist() {
    // Check if we have any filter lists
    if (this.storage.hasFilterLists()) {
      if ((process.env.ADBLOCK_DEBUG === '1')) console.log('[Adblock Lists] Filter lists already exist')
      return true
    }

    if ((process.env.ADBLOCK_DEBUG === '1')) console.log('[Adblock Lists] No filter lists found, downloading...')

    // Download for first time
    const result = await this.updateLists(true)
    return result.success
  }

  getCombinedLists() {
    const allLists = this.storage.getAllFilterLists()
    const combined = Object.values(allLists).join('\n')
    // Add YouTube blocking rules at the end
    return combined + '\n' + YOUTUBE_BLOCKING_RULES
  }

  getListsMetadata() {
    return this.storage.getMetadata()
  }
}

module.exports = ListManager
