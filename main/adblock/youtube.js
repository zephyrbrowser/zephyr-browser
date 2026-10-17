// main/adblock/youtube.js
// YouTube-specific ad neutralizer - AGGRESSIVE approach based on working implementations

// Document start script - Intercepts YouTube data BEFORE rendering
const YOUTUBE_DOCUMENT_START_SCRIPT = `
(function() {
  'use strict';

  if (window.__ytAdBlockDocStart) return;
  window.__ytAdBlockDocStart = true;

  console.log('[Zephyr-YT] Document start script loaded');

  // Intercept ytInitialPlayerResponse BEFORE YouTube processes it
  let _ytInitialPlayerResponse = null;
  Object.defineProperty(window, 'ytInitialPlayerResponse', {
    get() { return _ytInitialPlayerResponse; },
    set(value) {
      if (value && typeof value === 'object') {
        console.log('[Zephyr-YT] Intercepting ytInitialPlayerResponse');
        // AGGRESSIVE: Strip ALL ad-related data structures
        if (value.adPlacements) delete value.adPlacements;
        if (value.playerAds) delete value.playerAds;
        if (value.adSlots) delete value.adSlots;
        if (value.playerResponse?.adPlacements) delete value.playerResponse.adPlacements;
        if (value.playerResponse?.playerAds) delete value.playerResponse.playerAds;
        if (value.playerConfig?.adConfig) delete value.playerConfig.adConfig;
        if (value.playerConfig?.adsConfig) delete value.playerConfig.adsConfig;
        if (value.adBreakParams) delete value.adBreakParams;
        if (value.adBreakHeartbeatParams) delete value.adBreakHeartbeatParams;
        if (value.playerAdsRenderer) delete value.playerAdsRenderer;
        if (value.adParams) delete value.adParams;
        if (value.overlay) delete value.overlay;
        if (value.overlays) delete value.overlays;

        // NEW: Strip additional ad vectors discovered in 2024-2025
        if (value.engagementPanels) {
          value.engagementPanels = value.engagementPanels.filter(panel =>
            !panel?.engagementPanelSectionListRenderer?.content?.adsEngagementPanelContentRenderer
          );
        }
        if (value.frameworkUpdates?.entityBatchUpdate?.mutations) {
          value.frameworkUpdates.entityBatchUpdate.mutations =
            value.frameworkUpdates.entityBatchUpdate.mutations.filter(m =>
              !m?.payload?.offlineabilityEntity?.key?.includes('ad')
            );
        }
      }
      _ytInitialPlayerResponse = value;
    },
    configurable: true
  });

  // Intercept ytInitialData for feed/sidebar ads
  let _ytInitialData = null;
  Object.defineProperty(window, 'ytInitialData', {
    get() { return _ytInitialData; },
    set(value) {
      if (value && typeof value === 'object') {
        console.log('[Zephyr-YT] Intercepting ytInitialData');
        const removeAds = (obj) => {
          if (!obj || typeof obj !== 'object') return;
          for (const key in obj) {
            if (Array.isArray(obj[key])) {
              obj[key] = obj[key].filter(item => {
                if (!item || typeof item !== 'object') return true;
                return !(
                  item.adSlotRenderer ||
                  item.displayAdRenderer ||
                  item.actionCompanionAdRenderer ||
                  item.promotedVideoRenderer ||
                  item.promotedSparklesTextSearchRenderer
                );
              });
            }
            removeAds(obj[key]);
          }
        };
        removeAds(value);
      }
      _ytInitialData = value;
    },
    configurable: true
  });

})();
`;

// AGGRESSIVE runtime script - Based on proven working implementations
const YOUTUBE_RUNTIME_SCRIPT = `
(function() {
  'use strict';

  if (window.__ytAdBlockRuntime) return;
  window.__ytAdBlockRuntime = true;

  console.log('[Zephyr-YT] Runtime script loaded');

  const CONFIG = {
    skipDelay: 0,
    speedUpAds: true,
    muteAds: true,
    checkInterval: 500,
  };

  const SELECTORS = {
    skipButtons: [
      '.ytp-skip-ad-button',
      '.ytp-ad-skip-button',
      '.ytp-ad-skip-button-modern',
      '.videoAdUiSkipButton',
      'button.ytp-ad-skip-button',
      'button.ytp-ad-skip-button-modern',
      '.ytp-ad-skip-button-slot button',
      '.ytp-ad-skip-button-container button',
    ],
    adIndicators: [
      '.ad-showing',
      '.ytp-ad-player-overlay',
      '.ytp-ad-player-overlay-instream-info',
      '.ytp-ad-text',
      '.ytp-ad-preview-container',
    ],
    video: 'video.html5-main-video, video.video-stream',
    player: '#movie_player',
  };

  let lastAdState = false;
  let originalPlaybackRate = 1;
  let originalVolume = 1;
  let adSkipCount = 0;

  function trySkipAd() {
    for (const selector of SELECTORS.skipButtons) {
      const skipButton = document.querySelector(selector);
      if (skipButton && skipButton.offsetParent !== null) {
        skipButton.click();
        adSkipCount++;
        console.log('[Zephyr-YT] Ad skip button clicked (#' + adSkipCount + ')');
        return true;
      }
    }
    return false;
  }

  function isAdPlaying() {
    const player = document.querySelector(SELECTORS.player);
    if (player?.classList.contains('ad-showing')) return true;

    for (const selector of SELECTORS.adIndicators) {
      if (document.querySelector(selector)) return true;
    }

    const video = document.querySelector(SELECTORS.video);
    if (video) {
      const adText = document.querySelector('.ytp-ad-text');
      if (adText && adText.textContent) return true;
    }

    return false;
  }

  function speedUpAd(video) {
    if (!CONFIG.speedUpAds || !video) return;

    if (video.playbackRate !== 16) {
      originalPlaybackRate = video.playbackRate || 1;
      video.playbackRate = 16;
      console.log('[Zephyr-YT] Ad speed set to 16x');
    }
  }

  function muteAd(video) {
    if (!CONFIG.muteAds || !video) return;

    if (!video.muted) {
      originalVolume = video.volume;
      video.muted = true;
      console.log('[Zephyr-YT] Ad muted');
    }
  }

  function restorePlayback(video) {
    if (!video) return;

    if (video.playbackRate === 16) {
      video.playbackRate = originalPlaybackRate || 1;
    }

    if (video.muted && originalVolume > 0) {
      video.muted = false;
      video.volume = originalVolume;
    }
  }

  function skipToEnd(video) {
    if (!video || !video.duration) return;

    // Only for short ads (< 5 minutes)
    if (video.duration < 300) {
      video.currentTime = video.duration - 0.1;
      console.log('[Zephyr-YT] Skipped to end of ad');
    }
  }

  function removeAdOverlays() {
    const overlays = [
      '.ytp-ad-overlay-container',
      '.ytp-ad-text-overlay',
      '.ytp-ad-overlay-slot',
      '.ytp-ad-image-overlay',
      '.ytp-ad-player-overlay-flyout-cta',
    ];

    overlays.forEach(selector => {
      const elements = document.querySelectorAll(selector);
      elements.forEach(el => {
        if (el && el.style.display !== 'none') {
          el.style.display = 'none';
        }
      });
    });
  }

  function handleAds() {
    const video = document.querySelector(SELECTORS.video);
    const adPlaying = isAdPlaying();

    removeAdOverlays();

    if (adPlaying) {
      if (!lastAdState) {
        console.log('[Zephyr-YT] ====== AD DETECTED ======');
      }

      // Priority 1: Try to skip
      if (trySkipAd()) {
        lastAdState = false;
        return;
      }

      // Priority 2: If can't skip, go aggressive
      if (video) {
        muteAd(video);
        speedUpAd(video);

        // Try to skip to end if it's a short ad
        if (video.duration && video.duration < 30) {
          skipToEnd(video);
        }
      }

      lastAdState = true;
    } else {
      if (lastAdState && video) {
        restorePlayback(video);
        console.log('[Zephyr-YT] Ad ended, playback restored');
      }
      lastAdState = false;
    }
  }

  function injectCSS() {
    const style = document.createElement('style');
    style.id = 'zephyr-yt-adblock-css';
    style.textContent = \`
      .ytp-ad-overlay-container,
      .ytp-ad-text-overlay,
      .ytp-ad-overlay-slot,
      .video-ads,
      #player-ads,
      ytd-ad-slot-renderer,
      ytd-banner-promo-renderer,
      ytd-promoted-sparkles-web-renderer,
      ytd-display-ad-renderer,
      ytd-in-feed-ad-layout-renderer,
      ytd-promoted-video-renderer,
      ytd-compact-promoted-video-renderer,
      #masthead-ad,
      ytd-primetime-promo-renderer,
      .ytd-merch-shelf-renderer,
      ytd-merch-shelf-renderer,
      ytd-statement-banner-renderer,
      .ytd-statement-banner-renderer,
      .ytp-ad-preview-container,
      .ytp-ad-preview-text {
        display: none !important;
        visibility: hidden !important;
      }

      .ad-showing video {
        opacity: 0.01 !important;
      }
    \`;

    if (!document.getElementById('zephyr-yt-adblock-css')) {
      document.head.appendChild(style);
      console.log('[Zephyr-YT] CSS injected');
    }
  }

  function init() {
    injectCSS();
    setInterval(handleAds, CONFIG.checkInterval);
    handleAds();
    console.log('[Zephyr-YT] Initialized, checking every ' + CONFIG.checkInterval + 'ms');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Handle SPA navigation
  let lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      console.log('[Zephyr-YT] Navigation detected, resetting state');
      lastAdState = false;
      originalPlaybackRate = 1;
      originalVolume = 1;
    }
  }).observe(document.body, { subtree: true, childList: true });

})();
`;

// Comprehensive YouTube CSS
const YOUTUBE_AD_BLOCKING_CSS = `
/* Hide ALL YouTube ad components */
#secondary ytd-display-ad-renderer,
#secondary ytd-promoted-video-renderer,
#secondary ytd-compact-promoted-video-renderer,
ytd-ad-slot-renderer,
ytd-in-feed-ad-layout-renderer,
ytd-companion-slot-renderer,
ytd-banner-promo-renderer,
ytd-statement-banner-renderer,
ytd-action-companion-ad-renderer,
ytd-reel-video-renderer[is-ad],
.ytp-ad-overlay-container,
.ytp-ad-player-overlay,
.ytp-ad-image-overlay,
.ytp-ad-text-overlay,
.ytp-ad-player-overlay-flyout-cta,
.ytp-ad-visit-advertiser-button {
  display: none !important;
  visibility: hidden !important;
}
`;

class YouTubeAdNeutralizer {
  constructor(storage) {
    this.storage = storage;
    this.registeredSessions = new Set();
  }

  isYouTubeSite(url) {
    try {
      const urlObj = new URL(url);
      const hostname = urlObj.hostname.toLowerCase();
      return hostname === 'www.youtube.com' ||
             hostname === 'youtube.com' ||
             hostname === 'm.youtube.com' ||
             hostname === 'music.youtube.com';
    } catch (error) {
      return false;
    }
  }

  shouldInject(url) {
    if (!this.storage.isEnabled()) {
      return false;
    }

    if (!this.isYouTubeSite(url)) {
      return false;
    }

    try {
      const hostname = new URL(url).hostname;
      if (this.storage.isSiteAllowlisted(hostname)) {
        return false;
      }
    } catch (error) {
      return false;
    }

    return true;
  }

  async registerPreloadScript(session) {
    if (!session) {
      console.error('[YouTube Neutralizer] No session provided');
      return false;
    }

    const sessionId = session.id || session.getPartition();

    if (this.registeredSessions.has(sessionId)) {
      console.log('[YouTube Neutralizer] Session already has preload:', sessionId);
      return true;
    }

    try {
      // CRITICAL FIX: Must run in MAIN world to access YouTube's page variables
      await session.registerPreloadScript({
        preload: {
          code: YOUTUBE_DOCUMENT_START_SCRIPT,
          runAt: 'document-start',
          executeIn: 'main'  // THIS IS THE CRITICAL FIX - Run in page's JavaScript context
        }
      });

      this.registeredSessions.add(sessionId);
      console.log('[YouTube Neutralizer] ✓ Registered document_start script (MAIN world) for:', sessionId);
      return true;
    } catch (error) {
      console.error('[YouTube Neutralizer] Failed to register preload:', error);
      return false;
    }
  }

  async injectIntoWebContents(webContents) {
    if (!webContents || webContents.isDestroyed()) {
      return false;
    }

    try {
      const url = webContents.getURL();

      if (!this.shouldInject(url)) {
        return false;
      }

      console.log('[YouTube Neutralizer] Injecting into:', url);

      // Inject CSS
      await webContents.insertCSS(YOUTUBE_AD_BLOCKING_CSS);

      // CRITICAL FIX: Execute in MAIN world so it can access YouTube's DOM and variables
      await webContents.executeJavaScript(YOUTUBE_RUNTIME_SCRIPT, {
        executeIn: 'main'  // Run in page's JavaScript context, not isolated
      });

      console.log('[YouTube Neutralizer] ✓ Injection complete (MAIN world)');
      return true;
    } catch (error) {
      console.error('[YouTube Neutralizer] Injection failed:', error);
      return false;
    }
  }

  clearAllTracking() {
    this.registeredSessions.clear();
  }
}

module.exports = YouTubeAdNeutralizer;
