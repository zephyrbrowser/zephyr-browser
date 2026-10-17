// main/adblock/inject.js
// Production YouTube Ad Handler - Electron/Chromium Safe

const UNIVERSAL_AD_BLOCKING_CSS = `
/* Hide ad elements */
ytd-display-ad-renderer,
ytd-promoted-video-renderer,
ytd-ad-slot-renderer,
#panels.ytd-watch-flexy,
ytd-companion-slot-renderer,
ytd-player-legacy-desktop-watch-ads-renderer,
.ytwTopBannerImageTextIconButtonedLayoutViewModelHost,
tp-yt-paper-dialog[modern],
yt-mealbar-promo-renderer,
#mealbar-promo-renderer,
#masthead-ad { display: none !important; }
`;

const GENERIC_COSMETIC_SCRIPT = `
(function() {
  'use strict';
  if (window.__zephyrCosmeticFilter) return;
  window.__zephyrCosmeticFilter = true;

  // Web3/DeFi sites that should NOT get aggressive cosmetic filtering
  // (popup overlay removal, broad ad-container selectors)
  // These sites use modals, overlays, and class names that conflict with ad detection
  var WEB3_DOMAINS = [
    'raydium.io', 'jup.ag', 'jupiter.ag', 'marinade.finance', 'orca.so',
    'tensor.trade', 'magiceden.io', 'phantom.app', 'solflare.com',
    'birdeye.so', 'dexscreener.com', 'solscan.io', 'solana.com',
    'meteora.ag', 'drift.trade', 'mango.markets', 'marginfi.com',
    'kamino.finance', 'sanctum.so', 'helium.com', 'tiplink.io',
    'backpack.exchange', 'step.finance', 'hawksight.co', 'parcl.co',
    'save.finance', 'aldrin.com', 'saber.so', 'tulip.garden',
    'francium.io', 'hubbleprotocol.io', 'lido.fi', 'aave.com',
    'uniswap.org', 'pancakeswap.finance', 'curve.fi', 'compound.finance',
    'opensea.io', 'blur.io', 'nftx.io', 'zapper.fi', 'zerion.io',
    'rainbow.me', 'metamask.io', 'coinbase.com', 'kraken.com',
    'pump.fun', 'dextools.io', 'defined.fi', 'gecko.finance',
    'coingecko.com', 'coinmarketcap.com'
  ];
  var currentHost = window.location.hostname.toLowerCase();
  var isWeb3Site = WEB3_DOMAINS.some(function(d) {
    return currentHost === d || currentHost.endsWith('.' + d);
  });

  const AD_SELECTORS = [
    'ytd-display-ad-renderer',
    'ytd-promoted-video-renderer',
    'ytd-ad-slot-renderer',
    '#panels.ytd-watch-flexy',
    'ytd-companion-slot-renderer',
    'ytd-player-legacy-desktop-watch-ads-renderer',
    '.ytwTopBannerImageTextIconButtonedLayoutViewModelHost',
    'tp-yt-paper-dialog[modern]',
    'yt-mealbar-promo-renderer',
    '#mealbar-promo-renderer',
    '#masthead-ad'
  ];

  function hideAds() {
    AD_SELECTORS.forEach(sel => {
      document.querySelectorAll(sel).forEach(el => {
        if (el && el.offsetParent !== null) {
          el.style.setProperty('display', 'none', 'important');
        }
      });
    });
  }

  // Hide empty ad containers and ad-label elements left behind after blocking
  var AD_CONTAINER_SELECTORS = [
    '[class*="ad-container"]', '[class*="adcontainer"]', '[class*="ad_container"]',
    '[class*="ad-wrapper"]', '[class*="adwrapper"]', '[class*="ad_wrapper"]',
    '[class*="ad-slot"]', '[class*="adslot"]', '[class*="ad_slot"]',
    '[class*="ad-banner"]', '[class*="adbanner"]', '[class*="ad_banner"]',
    '[class*="ad-block"]', '[class*="adblock"]', '[class*="ad_block"]',
    '[class*="ad-space"]', '[class*="adspace"]', '[class*="ad_space"]',
    '[class*="ad-holder"]', '[class*="adholder"]', '[class*="ad_holder"]',
    '[class*="ad-wrap"]', '[class*="adwrap"]',
    '[id*="ad-container"]', '[id*="adcontainer"]', '[id*="ad_container"]',
    '[id*="ad-wrapper"]', '[id*="adwrapper"]', '[id*="ad_wrapper"]',
    '[id*="ad-slot"]', '[id*="adslot"]', '[id*="ad_slot"]',
    '[id*="ad-banner"]', '[id*="adbanner"]', '[id*="ad_banner"]',
    '[id*="ad-space"]', '[id*="adspace"]', '[id*="ad_space"]',
    '.adsense', '.ads', '.ad', '#ads', '#ad',
    '[data-ad]', '[data-ads]', '[data-ad-type]'
  ];

  function hideEmptyAdContainers() {
    // Skip YouTube — its ad elements are handled by hideAds() with specific ytd-* selectors.
    // The broad ad-container selectors here would match YouTube's own UI elements.
    if (window.location.hostname.includes('youtube.com')) return;
    // Skip Web3/DeFi sites — their wallet adapter classes contain "ad" in "adapter"
    // and their modals/overlays would be falsely flagged as ad containers.
    if (isWeb3Site) return;

    // 1. Hide elements whose only text is an ad label like "Advertisement"
    var all = document.querySelectorAll('div, span, p, section, aside, article, header, footer');
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (!el || el.style.display === 'none') continue;
      // Only check elements that have no child elements (leaf nodes) or only hidden children
      var text = el.textContent.trim();
      if (/^(Advertisement|Ad|Ads|Sponsored)$/i.test(text)) {
        // Check it has no meaningful child elements with other content
        var children = el.children;
        var hasVisibleChild = false;
        for (var j = 0; j < children.length; j++) {
          if (children[j].offsetParent !== null && children[j].textContent.trim() && !/^(Advertisement|Ad|Ads|Sponsored)$/i.test(children[j].textContent.trim())) {
            hasVisibleChild = true;
            break;
          }
        }
        if (!hasVisibleChild) {
          el.style.setProperty('display', 'none', 'important');
        }
      }
    }

    // 2. Hide known ad container selectors that are empty or contain only blocked content
    AD_CONTAINER_SELECTORS.forEach(function (sel) {
      document.querySelectorAll(sel).forEach(function (el) {
        if (!el || el.style.display === 'none') return;
        // Hide if empty, or contains only hidden children, or only an ad label
        var visibleText = el.innerText ? el.innerText.trim() : '';
        var hasVisibleIframe = false;
        el.querySelectorAll('iframe').forEach(function (f) {
          if (f.offsetParent !== null) hasVisibleIframe = true;
        });
        if (!hasVisibleIframe && (!visibleText || /^(Advertisement|Ad|Ads|Sponsored)?$/i.test(visibleText))) {
          el.style.setProperty('display', 'none', 'important');
        }
      });
    });
  }

  setInterval(hideAds, 2000);
  setInterval(hideEmptyAdContainers, 2000);
  if (document.readyState !== 'loading') { hideAds(); hideEmptyAdContainers(); }

  // === POPUP AD BLOCKER (all sites) ===
  if (!window.__zephyrPopupBlocker) {
    window.__zephyrPopupBlocker = true;

    var currentHost = window.location.hostname.toLowerCase();

    // Helper: check if a URL is an ad
    function isAdUrl(url) {
      if (!url) return false;
      var urlStr = String(url);
      // Tracking params = ad
      if (/aff_id=|affiliate=|clickid=|pbref=|tracking=|clid=|click_id=/i.test(urlStr)) return true;
      try {
        var host = new URL(urlStr).hostname.toLowerCase();
        // Same domain = not an ad (real navigation)
        if (host === currentHost || host.endsWith('.' + currentHost) || currentHost.endsWith('.' + host)) return false;
        // Known ad domains
        var adDomains = [
          'adcash.com','adcolony.com','admeld.com','adnetik.com','adpop.com',
          'adpopup.com','adserve.me','adsterra.com','adtelligent.com','adtarget.com',
          'clickbooth.com','clickdealer.com','doubleclick.net','exoclick.com',
          'exoclick.net','googlesyndication.com','googleadservices.com',
          'inmobi.com','leadflash.com','mobovida.com','popads.net','popcash.net',
          'propellerads.com','propellerads.net','pubmatic.com','smartadserver.com',
          'taboola.com','trafficjunky.com','trafficleader.com','widgetbucks.com',
          'yieldmo.com','appnexus.com','casalemedia.com','outbrain.com',
          'advertising.com','serving-sys.com','vserv.com','bidtellect.com',
          'adspush.com','iclick.com','zumobi.com','videofactory.com',
          'admob.com','adreactor.com','adknowledge.com','adlifetech.com',
          'admix.in','adware.com','adMedia.com','trafficstar.net',
          'adnow.com','adnow.ru','mgid.com','revcontent.com',
          'criteo.com','33across.com','somoaudience.com','conversant.com'
        ];
        for (var i = 0; i < adDomains.length; i++) {
          if (host === adDomains[i] || host.endsWith('.' + adDomains[i])) return true;
        }
      } catch (e) {}
      return false;
    }

    // 1. Override window.open - catches window.open() calls
    var _origOpen = window.open;
    window.open = function (url, target, features) {
      if (url && isAdUrl(String(url))) {
        // console.log('[Zephyr-PopupBlock] Blocked window.open:', String(url).substring(0, 100));
        return null;
      }
      return _origOpen.apply(this, arguments);
    };

    // 2. Click interceptor - catches <a target="_blank"> and click-handler redirects
    // This runs at capture phase so it fires BEFORE the site's own handlers
    document.addEventListener('click', function (e) {
      // Walk up from the clicked element to find an <a> tag
      var el = e.target;
      var link = null;
      for (var i = 0; i < 5; i++) {
        if (!el) break;
        if (el.tagName === 'A' && el.href) { link = el; break; }
        el = el.parentElement;
      }
      if (link && link.href) {
        var href = link.href;
        // Block if it's a target="_blank" link to an ad domain
        if (link.target === '_blank' && isAdUrl(href)) {
          e.preventDefault();
          e.stopImmediatePropagation();
          // console.log('[Zephyr-PopupBlock] Blocked <a target=_blank>:', href.substring(0, 100));
          return false;
        }
      }
    }, true); // capture phase

    // 3. Remove interstitial/overlay ads
    // Only active on non-YouTube pages — YouTube's own UI uses overlays legitimately
    function removePopupOverlays() {
      if (window.location.hostname.includes('youtube.com')) return;
      // Skip Web3/DeFi sites — their wallet connection modals, swap confirmations,
      // and approval dialogs are fixed-position overlays that look like ad popups
      if (isWeb3Site) return;

      var allEls = document.querySelectorAll('*');
      for (var i = 0; i < allEls.length; i++) {
        var el = allEls[i];
        if (!el || !el.style || el.style.display === 'none') continue;
        var tag = el.tagName.toLowerCase();
        if (tag === 'video' || tag === 'canvas' || tag === 'html' || tag === 'head' || tag === 'script' || tag === 'style') continue;
        if (el.id === 'movie_player' || el.id === 'yt-ad-overlay') continue;

        var style = window.getComputedStyle(el);
        var rect = el.getBoundingClientRect();
        var pos = style.position;
        var zIndex = parseInt(style.zIndex) || 0;

        // Two detection modes:
        // A) Positioned overlay: fixed/absolute with high z-index or large area
        // B) Full-viewport interstitial: covers viewport width and most of height (regardless of position)
        var isPositionedOverlay = (pos === 'fixed' || pos === 'absolute') && (zIndex >= 100 || (rect.width > window.innerWidth * 0.3 && rect.height > 50));
        var isFullViewportInterstitial = rect.width >= window.innerWidth * 0.9 && rect.height >= window.innerHeight * 0.5 && tag !== 'body';

        if (!isPositionedOverlay && !isFullViewportInterstitial) continue;

        var text = (el.textContent || '').toLowerCase();
        var cls = (el.className || '').toLowerCase();
        var combined = text + ' ' + cls;

        // Ad-specific keywords
        var hasAdKeyword = /\bdownload\b|\bclick here\b|\badblock\b|\badpopup\b|\bbanner ad\b|\bsponsored\b|\binterstitial\b/i.test(combined);

        // Countdown pattern: "Wait XX" or "Wait 0X" — interstitial timer
        var hasCountdown = /wait\s*\d/i.test(combined);

        // Close button: X symbol as text content in a small element, or class-based
        var hasCloseBtn = el.querySelector('.fa-times, [aria-label*="close"], [class*="closeBtn"], [class*="close-btn"], [class*="close_btn"]');
        if (!hasCloseBtn) {
          // Look for a child element that is just "×", "✕", "X", or "close" text
          var spans = el.querySelectorAll('div, span, button, a');
          for (var j = 0; j < spans.length; j++) {
            var child = spans[j];
            var childText = (child.textContent || '').trim();
            if (/^[×✕✖✗X]$/i.test(childText) || childText.toLowerCase() === 'close') {
              hasCloseBtn = child;
              break;
            }
          }
        }

        // For positioned overlays: ad keyword OR (close btn + large area)
        // For full-viewport interstitials: need stronger signal — countdown OR ad keyword OR close btn
        var shouldBlock = false;
        if (isPositionedOverlay) {
          shouldBlock = hasAdKeyword || (hasCloseBtn && rect.width > window.innerWidth * 0.3 && rect.height > 50);
        }
        if (isFullViewportInterstitial) {
          shouldBlock = shouldBlock || hasAdKeyword || hasCountdown || (hasCloseBtn && hasCountdown);
        }

        if (shouldBlock) {
          el.style.setProperty('display', 'none', 'important');
        }
      }

      // Also remove ad iframes directly
      document.querySelectorAll('iframe').forEach(function (iframe) {
        try {
          var src = iframe.src || '';
          if (isAdUrl(src)) {
            iframe.style.setProperty('display', 'none', 'important');
          }
        } catch (e) {}
      });
    }

    // Run overlay removal on load and periodically
    if (document.readyState !== 'loading') removePopupOverlays();
    setInterval(removePopupOverlays, 1500);
  }

  // === YOUTUBE AD HANDLER ===
  if (!window.location.hostname.includes('youtube.com')) return;
  if (window.__ytAdHandler) return;
  window.__ytAdHandler = true;

  // console.log('[YT-AdBlock] Initializing...');

  let adActive = false;
  let overlay = null;
  let checkInterval = null;
  let video = null;
  let originalMuted = false;
  let originalPlaybackRate = 1;
  let skipClicked = false;
  let skipAttempts = 0;
  let adStartTime = 0;

  // Continuously track the user's playback rate while no ad is active.
  // YouTube swaps the video element during ads, so reading it at ad-start
  // gives the ad's rate (1x), not the user's setting.
  let lastKnownRate = 1;
  let lastKnownMuted = false;
  setInterval(function () {
    if (adActive) return;
    var p = document.querySelector('#movie_player');
    if (!p) return;
    var v = p.querySelector('video');
    if (v) {
      lastKnownRate = v.playbackRate;
      lastKnownMuted = v.muted;
    }
  }, 500);

  // Create overlay (appended to #movie_player)
  function createOverlay() {
    if (overlay) return overlay;

    const player = document.querySelector('#movie_player');
    if (!player) return null;

    overlay = document.createElement('div');
    overlay.id = 'yt-ad-overlay';
    overlay.style.cssText = 'position:absolute;inset:0;background:#000;z-index:999999;pointer-events:none;display:none;align-items:center;justify-content:center;opacity:0;transition:opacity 0.3s';

    const spinner = document.createElement('div');
    spinner.style.cssText = 'width:48px;height:48px;border:4px solid rgba(255,255,255,0.2);border-top-color:#fff;border-radius:50%;animation:spin 0.8s linear infinite';
    overlay.appendChild(spinner);

    const style = document.createElement('style');
    style.textContent = '@keyframes spin{to{transform:rotate(360deg)}}';
    document.head.appendChild(style);

    player.appendChild(overlay);
    return overlay;
  }

  // Check if ad is active
  function isAdActive() {
    const player = document.querySelector('#movie_player');
    if (!player) return false;
    return player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting');
  }

  // Try to click skip button (scoped to #movie_player)
  function trySkip() {
    const player = document.querySelector('#movie_player');
    if (!player) return false;

    const video = player.querySelector('video');
    if (!video) return false;

    // Skip very early frames - give player a moment to initialize
    const adElapsed = (Date.now() - adStartTime) / 1000;
    if (adElapsed < 0.5) {
      return false;
    }

    // Check video is actually playing (player readiness)
    if (video.paused || video.seeking || video.readyState < 2) {
      return false;
    }

    // Primary target: .ytp-skip-ad button inside container
    const skipContainer = player.querySelector('.ytp-skip-ad');
    if (!skipContainer || skipContainer.offsetParent === null) return false;

    const btn = skipContainer.querySelector('button.ytp-skip-ad-button');
    if (!btn || btn.offsetParent === null) return false;

    // Check if button is truly clickable (allow opacity 0.5 for YouTube's styling)
    const style = window.getComputedStyle(btn);
    if (parseFloat(style.opacity) < 0.3 || style.pointerEvents === 'none') {
      return false;
    }

    // CRITICAL: Check countdown timer has expired
    const skipText = btn.querySelector('.ytp-skip-ad-button__text');
    if (skipText && skipText.textContent) {
      const text = skipText.textContent.trim().toLowerCase();
      // Must say "skip" not "skip in X"
      if (!text.includes('skip') || text.includes('in ') || /\d/.test(text)) {
        // console.log('[YT-AdBlock] Skip timer still counting:', text);
        return false;
      }
    }

    // console.log('[YT-AdBlock] Attempting skip at', adElapsed.toFixed(2), 'seconds (real time)');

    // Get button position for system-level click
    const rect = btn.getBoundingClientRect();
    const x = Math.round(rect.left + rect.width / 2);
    const y = Math.round(rect.top + rect.height / 2);

    // Send request to main process for system-level click
    if (window.ipc && window.ipc.send) {
      // console.log('[YT-AdBlock] Requesting system click at', x, y);
      window.ipc.send('youtube-skip-click', { x, y });
    } else {
      // Fallback: try programmatic click (likely won't work)
      // console.log('[YT-AdBlock] IPC not available, trying fallback click');
      btn.click();
      btn.focus();
      btn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
      btn.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
    }

    return true;
  }

  // Handle ad state changes
  function handleAd() {
    const player = document.querySelector('#movie_player');
    if (!player) return;

    const nowAdActive = isAdActive();
    video = player.querySelector('video');

    // Ad started
    if (nowAdActive && !adActive) {
      adStartTime = Date.now();
      // console.log('[YT-AdBlock] Ad detected');
      adActive = true;

      // Use the last known values from before the ad, not the current video element
      // (YouTube may have already swapped it to the ad's video)
      originalMuted = lastKnownMuted;
      originalPlaybackRate = lastKnownRate;

      // Mute and speed up video during ads
      if (video) {
        video.muted = true;
        video.playbackRate = 16;
        // console.log('[YT-AdBlock] Video muted, sped up to 16x. Will restore to', originalPlaybackRate, 'x');
      }
    }
    // Ad is still active - ENFORCE mute and speed continuously
    else if (nowAdActive && adActive) {
      if (video) {
        if (!video.muted) {
          video.muted = true;
          // console.log('[YT-AdBlock] Re-muting video (YouTube tried to unmute)');
        }
        if (video.playbackRate !== 16) {
          video.playbackRate = 16;
          // console.log('[YT-AdBlock] Re-applying 16x speed (YouTube tried to reset)');
        }
      }

      // Show overlay
      createOverlay();
      if (overlay) {
        overlay.style.display = 'flex';
        setTimeout(() => {
          if (overlay && adActive) overlay.style.opacity = '1';
        }, 50);
      }

      // Reset skip state
      skipClicked = false;
      skipAttempts = 0;

      // Start checking for skip button every 200ms
      if (checkInterval) clearInterval(checkInterval);
      checkInterval = setInterval(() => {
        if (!adActive || skipClicked) {
          clearInterval(checkInterval);
          checkInterval = null;
          return;
        }

        skipAttempts++;

        // Timeout after 30 seconds (150 attempts at 200ms)
        if (skipAttempts >= 150) {
          // console.log('[YT-AdBlock] Skip timeout (30s)');
          clearInterval(checkInterval);
          checkInterval = null;
          return;
        }

        if (trySkip()) {
          skipClicked = true;
          clearInterval(checkInterval);
          checkInterval = null;
        }
      }, 200);
    }
    // Ad ended
    else if (!nowAdActive && adActive) {
      // console.log('[YT-AdBlock] Ad ended');
      adActive = false;

      // Stop checking
      if (checkInterval) {
        clearInterval(checkInterval);
        checkInterval = null;
      }

      // Restore video state - unmute and reset speed
      if (video) {
        video.muted = originalMuted;
        video.playbackRate = originalPlaybackRate;
        // console.log('[YT-AdBlock] Restored: muted=' + originalMuted + ', speed=' + originalPlaybackRate + 'x');
      }

      // Hide overlay
      if (overlay) {
        overlay.style.opacity = '0';
        setTimeout(() => {
          if (overlay && !adActive) overlay.style.display = 'none';
        }, 300);
      }
    }
  }

  // Poll for ad state every 250ms
  setInterval(handleAd, 250);

  // MutationObserver on #movie_player for class changes
  const player = document.querySelector('#movie_player');
  if (player) {
    const observer = new MutationObserver(handleAd);
    observer.observe(player, { attributes: true, attributeFilter: ['class'] });
  }

  // console.log('[YT-AdBlock] Ready');
})();
`;

class CosmeticInjector {
  constructor(storage, engine) {
    this.storage = storage;
    this.engine = engine;
  }

  shouldInject(url) {
    if (!this.storage.isEnabled()) return false;
    try {
      const hostname = new URL(url).hostname;
      if (this.storage.isSiteAllowlisted(hostname)) return false;
      return true;
    } catch {
      return false;
    }
  }

  async injectIntoWebContents(webContents) {
    if (!webContents || webContents.isDestroyed()) return false;

    try {
      const url = webContents.getURL();
      if (!url || !this.shouldInject(url)) return false;

      await webContents.insertCSS(UNIVERSAL_AD_BLOCKING_CSS);

      const { styles } = this.engine.getCosmeticFilters(url);
      if (styles && styles.length > 0) {
        await webContents.insertCSS(styles);
      }

      await webContents.executeJavaScript(GENERIC_COSMETIC_SCRIPT, true);
      return true;
    } catch (error) {
      console.error('[Cosmetic Injector] Error:', error);
      return false;
    }
  }
}

module.exports = CosmeticInjector;
