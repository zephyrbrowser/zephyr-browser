// main/adblock/index.js
// Main adblock module - orchestrates all components

const { session: electronSession } = require('electron')
// Note: AdblockStorage, ListManager, AdblockEngine, YouTubeAdNeutralizer, CosmeticInjector
// are already in scope from bundled build - no require needed

class AdblockManager {
  constructor() {
    this.storage = null
    this.listManager = null
    this.engine = null
    this.youtubeNeutralizer = null
    this.cosmeticInjector = null
    this.initialized = false
    this.updateTimer = null
    // FIX 1: Track which sessions have been initialized
    this.initializedSessions = new Map() // session.id -> { engine, blocker }
  }

  async initialize(sessionParam = null) {
    if (this.initialized) {
      if ((process.env.ADBLOCK_DEBUG === '1')) console.log('[Adblock] Already initialized')
      return true
    }

    try {
      if ((process.env.ADBLOCK_DEBUG === '1')) console.log('[Adblock] Initializing adblock system...')

      // Initialize storage
      this.storage = new AdblockStorage()

      // Initialize list manager
      this.listManager = new ListManager(this.storage)

      // Initialize engine
      this.engine = new AdblockEngine(this.storage, this.listManager)
      await this.engine.initialize()

      // Attach to session
      const targetSession = sessionParam || electronSession.defaultSession
      await this.engine.attachToSession(targetSession)

      // DISABLED: YouTube neutralizer (now handled by inject.js to avoid conflicts)
      // this.youtubeNeutralizer = new YouTubeAdNeutralizer(this.storage)

      // Initialize cosmetic injector
      this.cosmeticInjector = new CosmeticInjector(this.storage, this.engine)

      // Set up automatic updates (daily)
      this.scheduleAutoUpdate()

      this.initialized = true

      if ((process.env.ADBLOCK_DEBUG === '1')) console.log('[Adblock] Initialization complete')
      return true
    } catch (error) {
      console.error('[Adblock] Initialization failed:', error)
      return false
    }
  }

  // FIX 1: Initialize adblock for a specific session (cached per session partition)
  async initializeForSession(session) {
    if (!session) {
      return false
    }

    const sessionPartition = session.getPartition()
    const sessionId = session.id || sessionPartition

    // Check if already initialized for this session
    if (this.initializedSessions.has(sessionId)) {
      if ((process.env.ADBLOCK_DEBUG === '1')) {
        console.log('[Adblock] Session already initialized:', sessionPartition)
      }
      return true
    }

    // Ensure global adblock is initialized
    if (!this.initialized) {
      await this.initialize(session)
    } else {
      // Attach engine to this new session
      try {
        await this.engine.attachToSession(session)

        // DISABLED: YouTube preload (now handled by inject.js)
        // if (this.youtubeNeutralizer) {
        //   await this.youtubeNeutralizer.registerPreloadScript(session)
        // }

        // Register popup blocker script for this session
        await this.registerPopupBlocker(session)

        this.initializedSessions.set(sessionId, { session, partition: sessionPartition })

        if ((process.env.ADBLOCK_DEBUG === '1')) {
          console.log('[Adblock] Attached to session:', sessionPartition)
        }
      } catch (error) {
        console.error('[Adblock] Failed to attach to session:', sessionPartition, error)
        return false
      }
    }

    return true
  }

  // FIX 5: Enhanced popup blocker for streaming sites
  async registerPopupBlocker(session) {
    try {
      const POPUP_BLOCKER_SCRIPT = `
(function() {
  'use strict';
  if (window.__zephyrPopupBlocker) return;
  window.__zephyrPopupBlocker = true;

  console.log('[Zephyr Popup Blocker] ===== INITIALIZED ON:', window.location.href, '=====');

  // FIX 5: NUCLEAR popup blocking - Block ALL window.open
  let userInitiatedClick = false;
  let lastUserClick = 0;

  // Track user clicks
  document.addEventListener('mousedown', function() {
    userInitiatedClick = true;
    lastUserClick = Date.now();
    setTimeout(() => { userInitiatedClick = false; }, 100);
  }, true);

  document.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' || e.key === ' ') {
      userInitiatedClick = true;
      lastUserClick = Date.now();
      setTimeout(() => { userInitiatedClick = false; }, 100);
    }
  }, true);

  // Override window.open - COMPLETE BLOCK (streaming sites workaround)
  const originalWindowOpen = window.open;
  let windowOpenCount = 0;
  let allowedDomains = ['youtube.com', 'youtu.be']; // Only allow YouTube popups

  window.open = function(...args) {
    const now = Date.now();
    const timeSinceClick = now - lastUserClick;
    const url = args[0]?.toString() || '';

    windowOpenCount++;

    // ALWAYS block known ad domains, no exceptions
    const adDomains = [
      'doubleclick.net', 'googlesyndication.com', 'googleadservices.com',
      'adclick', 'adserver', 'popup', 'popunder', 'redirect',
      'advertising.com', 'adnxs.com', 'outbrain.com', 'taboola.com',
      'ad.', 'ads.', 'banner', 'tracking', 'tracker', 'analytics',
      'click.', 'promo.', 'offer.', 'monetize'
    ];

    const isAdUrl = adDomains.some(domain => url.toLowerCase().includes(domain));

    if (isAdUrl) {
      console.log('[Zephyr] Blocked ad domain window.open:', url);
      return null;
    }

    // Block if URL is from different domain (streaming site ad tabs)
    // EXCEPTION: Allow if same domain OR whitelisted domain
    try {
      const currentDomain = window.location.hostname;
      const targetUrl = new URL(url, window.location.href);
      const targetDomain = targetUrl.hostname;

      const isAllowedDomain = allowedDomains.some(domain =>
        currentDomain.includes(domain) || targetDomain.includes(domain)
      );

      if (targetDomain && targetDomain !== currentDomain && !isAllowedDomain) {
        console.log('[Zephyr] Blocked cross-domain window.open:', targetDomain);
        return null;
      }
    } catch (err) {
      // Invalid URL, block it to be safe
      console.log('[Zephyr] Blocked invalid URL window.open');
      return null;
    }

    // For streaming sites: Block ALL window.open after first attempt (even same domain)
    // This prevents the first click from opening video + ad tab simultaneously
    if (windowOpenCount > 1) {
      console.log('[Zephyr] Blocked repeat window.open #' + windowOpenCount);
      return null;
    }

    // Streaming sites: Even first click must be within 50ms (not 100ms) and to same domain
    if (timeSinceClick < 50 && userInitiatedClick) {
      console.log('[Zephyr] Allowing user-initiated popup:', url.substring(0, 50));
      return originalWindowOpen.apply(this, args);
    }

    // Block all other popups
    console.log('[Zephyr] Blocked automatic/delayed popup:', url.substring(0, 50));
    return null;
  };

  // ENHANCED: Block onclick popups and new tab creation
  let clickCount = 0;
  let firstClickTime = 0;

  document.addEventListener('click', function(e) {
    const target = e.target;
    const href = target.href || target.closest('a')?.href;
    const now = Date.now();

    // Reset click count after 2 seconds
    if (now - firstClickTime > 2000) {
      clickCount = 0;
      firstClickTime = now;
    }

    clickCount++;

    // If more than 1 click in 2 seconds, block subsequent clicks (streaming site trick)
    if (clickCount > 1) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      console.log('[Zephyr] Blocked rapid click #' + clickCount + ' (ad tab prevention)');
      return false;
    }

    // Block suspicious popup links
    if (href) {
      const suspiciousPatterns = [
        'pop', 'adclick', 'redirect', 'advertis', 'tracker',
        '/go/', '/out/', '/away/', '/jump/', '/track/',
        'doubleclick', 'googlesyndication', 'adserver'
      ];

      const isSuspicious = suspiciousPatterns.some(pattern =>
        href.toLowerCase().includes(pattern)
      );

      if (isSuspicious) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        console.log('[Zephyr] Blocked suspicious link:', href);
        return false;
      }
    }

    // Block links with target="_blank" on streaming sites (common ad trick)
    const link = target.closest('a');
    if (link && link.target === '_blank') {
      const linkHref = link.href || '';
      const currentDomain = window.location.hostname;

      try {
        const linkDomain = new URL(linkHref).hostname;

        // If link goes to different domain, it's likely an ad
        if (linkDomain && linkDomain !== currentDomain) {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          console.log('[Zephyr] Blocked external target="_blank" link:', linkHref);
          return false;
        }
      } catch (err) {
        // Invalid URL, block it
        e.preventDefault();
        e.stopPropagation();
        return false;
      }
    }
  }, true);

  // Block mousedown events that might trigger ad tabs
  document.addEventListener('mousedown', function(e) {
    const target = e.target;

    // Check if element or parent has onclick that might open new tab
    let element = target;
    for (let i = 0; i < 5; i++) {
      if (!element) break;

      const onclick = element.onclick || element.getAttribute('onclick');
      if (onclick) {
        const onclickStr = onclick.toString().toLowerCase();
        if (onclickStr.includes('window.open') ||
            onclickStr.includes('target="_blank"') ||
            onclickStr.includes('newtab')) {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          console.log('[Zephyr] Blocked element with ad-opening onclick');
          return false;
        }
      }

      element = element.parentElement;
    }
  }, true);

  // FIX 5: Remove full-screen overlays (streaming site ads) - NUCLEAR AGGRESSIVE
  function removeOverlays() {
    console.log('[Zephyr] Scanning for overlays/popups on:', window.location.hostname);

    // NUCLEAR PRIORITY 1: Block ALL suspicious iframes IMMEDIATELY
    const iframes = document.querySelectorAll('iframe');
    console.log('[Zephyr] Found', iframes.length, 'iframes');
    iframes.forEach(iframe => {
      const src = iframe.src?.toLowerCase() || '';
      const id = iframe.id?.toLowerCase() || '';
      const className = iframe.className?.toString().toLowerCase() || '';

      // Block ad network iframes
      const isAdIframe = src.includes('doubleclick') || src.includes('googlesyndication') ||
                        src.includes('advertising') || src.includes('adserver') ||
                        src.includes('banner') || src.includes('popup') ||
                        id.includes('ad') || className.includes('ad') ||
                        id.includes('popup') || className.includes('popup');

      // Block high z-index iframes (popup trick)
      const style = window.getComputedStyle(iframe);
      const zIndex = parseInt(style.zIndex) || 0;
      const position = style.position;

      if (isAdIframe || (zIndex > 999 && (position === 'fixed' || position === 'absolute'))) {
        console.log('[Zephyr] Blocked suspicious iframe:', src || id || className);
        iframe.remove();
        return;
      }
    });

    // NUCLEAR: Remove ALL elements that look like popups/modals immediately
    const allPopupElements = document.querySelectorAll('div, section, aside, article');

    allPopupElements.forEach(el => {
      const text = el.textContent?.toLowerCase() || '';
      const className = el.className?.toString().toLowerCase() || '';
      const id = el.id?.toLowerCase() || '';

      // ULTRA AGGRESSIVE: Check for ANY popup/overlay indicators
      const hasAttentionText = text.includes('attention') || text.includes('activate vpn') ||
                              text.includes('checking your browser') || text.includes('verify you are human') ||
                              text.includes('complete verification') || text.includes('security check') ||
                              text.includes('file ready') || text.includes('download ready') ||
                              text.includes('click allow') || text.includes('click to continue') ||
                              text.includes('please wait') || text.includes('loading') ||
                              text.includes('verification required') || text.includes('enable javascript');

      const hasDownloadText = text.includes('download') && text.includes('file');

      const hasModalClass = className.includes('modal') || className.includes('popup') ||
                           className.includes('overlay') || className.includes('dialog') ||
                           className.includes('interstitial') || className.includes('backdrop');

      const hasModalId = id.includes('modal') || id.includes('popup') ||
                        id.includes('overlay') || id.includes('dialog') ||
                        id.includes('interstitial');

      // If it matches popup patterns, check if it's an overlay
      if (hasAttentionText || hasDownloadText || hasModalClass || hasModalId) {
        const style = window.getComputedStyle(el);
        const position = style.position;
        const zIndex = parseInt(style.zIndex) || 0;

        // Remove if it's positioned overlay (NUCLEAR: even z-index > 10)
        if ((position === 'fixed' || position === 'absolute') && zIndex > 10) {
          console.log('[Zephyr] ULTRA NUCLEAR: Removed popup (z-index:', zIndex, '):', className || id || text.substring(0, 50));
          el.remove();
          return;
        }
      }
    });

    // Target fixed/absolute positioned elements that cover screen
    const overlays = document.querySelectorAll('div, section, aside');

    overlays.forEach(el => {
      const style = window.getComputedStyle(el);
      const position = style.position;
      const zIndex = parseInt(style.zIndex) || 0;

      // Skip if not positioned
      if (position !== 'fixed' && position !== 'absolute') return;

      const width = el.offsetWidth;
      const height = el.offsetHeight;
      const viewportArea = window.innerWidth * window.innerHeight;
      const elArea = width * height;

      // Target overlays: ANY z-index + covers >15% of screen (ULTRA aggressive)
      if (zIndex > 50 && elArea > viewportArea * 0.15) {
        // Check for ad indicators in class/id
        const className = el.className?.toString().toLowerCase() || '';
        const id = el.id?.toLowerCase() || '';
        const text = el.textContent?.toLowerCase() || '';

        const isAdOverlay = className.includes('ad') ||
                           className.includes('popup') ||
                           className.includes('overlay') ||
                           className.includes('modal') ||
                           id.includes('ad') ||
                           id.includes('popup') ||
                           id.includes('overlay') ||
                           id.includes('modal') ||
                           text.includes('download now') ||
                           text.includes('file is ready');

        // Check if it has a close button
        const closeBtn = el.querySelector('[class*="close" i], [aria-label*="close" i], button[title*="close" i], .close, .dismiss, [data-dismiss]');

        if (closeBtn) {
          console.log('[Zephyr] Clicking overlay close button on:', className || id);
          closeBtn.click();
          setTimeout(() => {
            if (el.parentNode && el.offsetParent !== null) {
              el.remove();
            }
          }, 500);
        } else if (isAdOverlay) {
          // Remove if it looks like an ad
          const hasText = el.innerText && el.innerText.length > 20;
          const hasInputs = el.querySelectorAll('input, select, textarea').length > 0;
          const hasVideo = el.querySelectorAll('video').length > 0;

          // Don't remove if it has login inputs or video player
          if (!hasInputs && !hasVideo) {
            console.log('[Zephyr] Removing ad overlay:', className || id);
            el.remove();
          }
        }
      }
    });

    // Also remove known streaming ad containers
    const adContainers = document.querySelectorAll('[id*="ad-"], [class*="ad-overlay"], [class*="popup-ad"], .advertisement-overlay');
    adContainers.forEach(el => {
      if (el.offsetParent !== null) {
        console.log('[Zephyr] Removing ad container');
        el.remove();
      }
    });

    // DailyMail specific: Remove sticky/floating video ads
    const videoAds = document.querySelectorAll('.mol-video-ad, .mol-video-sticky, #molVideoSticky, .sticky-video-wrapper, .floating-video-wrapper, [class*="video-ad"], [id*="video-ad"]');
    videoAds.forEach(el => {
      if (el.offsetParent !== null) {
        console.log('[Zephyr] Removing video ad:', el.className || el.id);
        el.remove();
      }
    });

    // ULTIMATE NUCLEAR FALLBACK: Remove ANY fullscreen fixed/absolute element
    // (Catches popups that don't match any pattern)
    const allFixed = document.querySelectorAll('div[style*="position: fixed"], div[style*="position:fixed"], div[style*="position: absolute"], div[style*="position:absolute"]');
    allFixed.forEach(el => {
      const style = window.getComputedStyle(el);
      const position = style.position;
      const zIndex = parseInt(style.zIndex) || 0;

      // If it's full-screen or near-fullscreen and high z-index
      if ((position === 'fixed' || position === 'absolute') && zIndex > 100) {
        const width = el.offsetWidth;
        const height = el.offsetHeight;
        const isFullscreen = (width > window.innerWidth * 0.8 && height > window.innerHeight * 0.8);

        if (isFullscreen) {
          console.log('[Zephyr] NUCLEAR FALLBACK: Removing fullscreen overlay (z-index:', zIndex, ')');
          el.remove();
        }
      }
    });
  }

  // Run IMMEDIATELY and frequently
  removeOverlays();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', removeOverlays);
  }

  // Check every 500ms (more aggressive than 2000ms)
  setInterval(removeOverlays, 500);

  // ALSO check on ANY DOM change (catch popups as they're added)
  const popupObserver = new MutationObserver(() => {
    removeOverlays();
  });

  popupObserver.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  // Also check on user interaction (catch lazy-loaded ads)
  ['mousedown', 'touchstart', 'keydown'].forEach(eventType => {
    document.addEventListener(eventType, function() {
      setTimeout(removeOverlays, 100);
    }, { passive: true, once: false });
  });

  console.log('[Zephyr Popup Blocker] Active - monitoring overlays');
})();
`;

      await session.registerPreloadScript({
        preload: {
          code: POPUP_BLOCKER_SCRIPT,
          runAt: 'document-start',  // CRITICAL FIX: Run earlier to catch window.open overrides
          executeIn: 'main'  // Must run in page context to override window.open
        }
      })

      if ((process.env.ADBLOCK_DEBUG === '1')) {
        console.log('[Adblock] Registered popup blocker for session:', session.getPartition())
      }
    } catch (error) {
      if ((process.env.ADBLOCK_DEBUG === '1')) {
        console.error('[Adblock] Failed to register popup blocker:', error)
      }
    }
  }

  scheduleAutoUpdate() {
    // Clear existing timer
    if (this.updateTimer) {
      clearInterval(this.updateTimer)
    }

    // Update every 24 hours
    const UPDATE_INTERVAL = 24 * 60 * 60 * 1000

    this.updateTimer = setInterval(async () => {
      if ((process.env.ADBLOCK_DEBUG === '1')) console.log('[Adblock] Running scheduled update')
      await this.updateFilterLists(false)
    }, UPDATE_INTERVAL)

    // Also check on startup (but don't force)
    setTimeout(async () => {
      await this.updateFilterLists(false)
    }, 60000) // Wait 1 minute after startup
  }

  async updateFilterLists(force = false) {
    if (!this.listManager) {
      return { success: false, error: 'Adblock not initialized' }
    }

    try {
      if ((process.env.ADBLOCK_DEBUG === '1')) console.log('[Adblock] Updating filter lists (force:', force, ')')

      const result = await this.listManager.updateLists(force)

      // Rebuild engine if lists were updated
      if (result.success && result.updated) {
        if ((process.env.ADBLOCK_DEBUG === '1')) console.log('[Adblock] Rebuilding engine with new lists')
        await this.engine.rebuild()
      }

      return result
    } catch (error) {
      console.error('[Adblock] Update failed:', error)
      return { success: false, error: error.message }
    }
  }

  // Content injection for webContents
  async injectIntoWebContents(webContents) {
    if (!this.initialized || !webContents || webContents.isDestroyed()) {
      console.log('[Adblock] injectIntoWebContents skipped - not initialized or destroyed')
      return false
    }

    try {
      const url = webContents.getURL()
      console.log('[Adblock] injectIntoWebContents called for:', url)

      // DISABLED: YouTube neutralizer injection (now handled by inject.js)
      // if (this.youtubeNeutralizer && this.youtubeNeutralizer.isYouTubeSite(url)) {
      //   await this.youtubeNeutralizer.injectIntoWebContents(webContents)
      // }

      // Inject cosmetic filters
      if (this.cosmeticInjector) {
        console.log('[Adblock] Calling cosmetic injector for:', url)
        const result = await this.cosmeticInjector.injectIntoWebContents(webContents)
        console.log('[Adblock] Cosmetic injector result:', result)
      }

      return true
    } catch (error) {
      console.error('[Adblock] Injection failed:', error)
      return false
    }
  }

  // Status and control methods
  getStatus(webContentsId = null, url = null) {
    if (!this.initialized) {
      return {
        enabled: false,
        siteEnabled: false,
        host: null,
        blockedCount: 0,
        lastUpdated: null,
        error: 'Not initialized'
      }
    }

    let hostname = null
    if (url) {
      try {
        hostname = new URL(url).hostname
      } catch (error) {
        // Invalid URL
      }
    }

    const enabled = this.storage.isEnabled()
    const siteAllowlisted = hostname ? this.storage.isSiteAllowlisted(hostname) : false
    const metadata = this.listManager.getListsMetadata()
    const blockedCount = webContentsId ? this.engine.getBlockedCount(webContentsId) : 0

    return {
      enabled,
      siteEnabled: enabled && !siteAllowlisted,
      host: hostname,
      blockedCount,
      lastUpdated: metadata.lastUpdated,
      listsCount: Object.keys(metadata.lists).length
    }
  }

  toggleGlobal() {
    if (!this.initialized) {
      return false
    }

    const newState = !this.storage.isEnabled()
    this.storage.setEnabled(newState)

    if ((process.env.ADBLOCK_DEBUG === '1')) console.log('[Adblock] Global toggle:', newState)
    return newState
  }

  toggleSite(hostname) {
    if (!this.initialized || !hostname) {
      return null
    }

    const isNowAllowlisted = this.storage.toggleSiteAllowlist(hostname)

    if ((process.env.ADBLOCK_DEBUG === '1')) console.log('[Adblock] Site toggle:', hostname, '- allowlisted:', isNowAllowlisted)

    return {
      allowlisted: isNowAllowlisted,
      hostname
    }
  }

  getListsInfo() {
    if (!this.initialized) {
      return { lists: {}, lastUpdated: null }
    }

    return this.listManager.getListsMetadata()
  }

  getBlockedCount(webContentsId) {
    if (!this.initialized || !webContentsId) {
      return 0
    }

    return this.engine.getBlockedCount(webContentsId)
  }

  resetBlockedCount(webContentsId) {
    if (this.initialized && webContentsId) {
      this.engine.resetBlockedCount(webContentsId)
    }
  }

  // Cleanup
  destroy() {
    if (this.updateTimer) {
      clearInterval(this.updateTimer)
      this.updateTimer = null
    }

    if (this.engine) {
      this.engine.detachFromSession()
    }

    // DISABLED: YouTube neutralizer cleanup
    // if (this.youtubeNeutralizer) {
    //   this.youtubeNeutralizer.clearAllTracking()
    // }

    if (this.cosmeticInjector) {
      this.cosmeticInjector.clearAllTracking()
    }

    this.initialized = false
    if ((process.env.ADBLOCK_DEBUG === '1')) console.log('[Adblock] Destroyed')
  }
}

// Singleton instance
let instance = null

function getAdblockManager() {
  if (!instance) {
    instance = new AdblockManager()
  }
  return instance
}

module.exports = {
  AdblockManager,
  getAdblockManager
}
