// main/agentIPC.js
// Main process IPC handler for OpenAI API calls (avoids CORS issues in renderer)

// Load .env file for API key
;(function loadEnv () {
  try {
    var envPath = require('path').join(__dirname, '.env')
    var envContent = require('fs').readFileSync(envPath, 'utf-8')
    envContent.split('\n').forEach(function (line) {
      line = line.trim()
      if (!line || line.startsWith('#')) return
      var eqIndex = line.indexOf('=')
      if (eqIndex === -1) return
      var key = line.substring(0, eqIndex).trim()
      var value = line.substring(eqIndex + 1).trim()
      // Remove surrounding quotes if present
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1)
      }
      if (key && value) {
        process.env[key] = value
      }
    })
  } catch (e) {
    // .env file is optional
  }
})()

// Cache for trending narratives (3-min TTL)
var trendingNarrativesCache = {
  data: null,
  timestamp: 0,
  TTL: 3 * 60 * 1000
}

// Tell the renderer whether the AI service is configured. The key itself never
// leaves the main process — all AI calls go through agent:chat / agent:transcribe.
ipc.handle('agent:getApiKey', function () {
  return { configured: !!process.env.OPENAI_API_KEY }
})

var AGENT_UNAVAILABLE_ERROR = 'Zephyr AI is temporarily unavailable. Please try again in a moment.'

// Map an AI-provider HTTP failure to a user-safe message (raw details go to the console).
function agentServiceError (status, rawText) {
  console.error('[Agent] AI service error ' + status + ':', rawText)
  if (status === 429) return 'Zephyr AI is busy right now. Please try again in a moment.'
  if (status === 400 && /context_length|maximum context/i.test(rawText || '')) {
    return 'This conversation is too long. Please start a new chat.'
  }
  return AGENT_UNAVAILABLE_ERROR
}

// Provide model to renderer
ipc.handle('agent:getModel', function () {
  return { model: process.env.AGENT_MODEL || 'gpt-4o' }
})

// Smart search - fetch Google results and parse them
ipc.handle('agent:smartSearch', async function (event, data) {
  try {
    var query = data.query
    if (!query) return { error: 'No query provided' }

    var searchUrl = 'https://www.google.com/search?q=' + encodeURIComponent(query) + '&num=10'

    var response = await net.fetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    })

    if (!response.ok) {
      return { error: 'Search failed: ' + response.status }
    }

    var html = await response.text()

    // Check if Google returned a consent/cookie page or CAPTCHA
    var isBlocked = html.includes('consent.google') || html.includes('captcha') || html.includes('unusual traffic') || html.includes('before you continue')
    if (isBlocked) {
      console.log('[SmartSearch] Google blocked request (consent/captcha), falling back to DuckDuckGo')
    }

    // Parse search results from HTML - extract titles, URLs, and snippets
    var results = []

    // Strategy 1: Extract structured result blocks
    // Google result blocks typically have: <a href="/url?q=...">title</a> followed by snippet text
    // We'll extract URLs and then look for nearby snippet text

    // First, get all result URLs with titles
    var linkPattern = /<a[^>]*href="\/url\?q=([^&"]+)[^"]*"[^>]*>([\s\S]*?)<\/a>/gi
    var match
    var resultPositions = []

    while ((match = linkPattern.exec(html)) !== null && resultPositions.length < 15) {
      var url = decodeURIComponent(match[1])
      var linkHtml = match[2]

      // Skip Google's own links
      if (url.includes('google.com') || url.includes('youtube.com/results') ||
          url.includes('accounts.google') || url.includes('support.google') ||
          url.startsWith('/') || url.includes('webcache.googleusercontent')) {
        continue
      }

      var title = linkHtml.replace(/<[^>]+>/g, '').trim()
      if (!title || title.length < 3) continue

      var isDuplicate = false
      for (var d = 0; d < resultPositions.length; d++) {
        if (resultPositions[d].url === url) { isDuplicate = true; break }
      }
      if (isDuplicate) continue

      resultPositions.push({
        title: title.substring(0, 200),
        url: url,
        position: match.index
      })
    }

    // Extract snippet text near each result
    // Snippets appear in <span> or <div> elements after the title link
    for (var r = 0; r < resultPositions.length; r++) {
      var pos = resultPositions[r].position
      // Look at the HTML block after this result (next 2000 chars)
      var nextBlockEnd = r + 1 < resultPositions.length ? resultPositions[r + 1].position : pos + 2000
      var block = html.substring(pos, Math.min(nextBlockEnd, pos + 2000))

      // Extract text content from the block, strip all HTML tags
      var blockText = block.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
      // Remove the title from the block text
      var snippet = blockText.replace(resultPositions[r].title, '').trim()
      // Clean up and limit snippet
      snippet = snippet.substring(0, 300).trim()
      // Remove leading/trailing artifacts
      snippet = snippet.replace(/^[\s\-·|]+/, '').replace(/[\s\-·|]+$/, '')

      results.push({
        title: resultPositions[r].title,
        url: resultPositions[r].url,
        snippet: snippet || ''
      })
    }

    // Fallback: try direct https links if we didn't find enough
    if (results.length < 3) {
      var directPattern = /<a[^>]*href="(https?:\/\/(?!google\.com|accounts\.google|webcache)[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi
      while ((match = directPattern.exec(html)) !== null && results.length < 10) {
        var dUrl = match[1]
        var dTitle = match[2].replace(/<[^>]+>/g, '').trim()

        if (!dTitle || dTitle.length < 3) continue
        if (dUrl.includes('google.com')) continue

        var isDup = false
        for (var dd = 0; dd < results.length; dd++) {
          if (results[dd].url === dUrl) { isDup = true; break }
        }
        if (isDup) continue

        results.push({
          title: dTitle.substring(0, 200),
          url: dUrl,
          snippet: ''
        })
      }
    }

    // Also try to extract Google's "featured snippets" or answer boxes
    var featuredSnippet = ''
    var featuredMatch = html.match(/data-attrid="wa:\/description"[^>]*>([\s\S]*?)<\/div>/i)
    if (featuredMatch) {
      featuredSnippet = featuredMatch[1].replace(/<[^>]+>/g, '').trim().substring(0, 500)
    }

    console.log('[SmartSearch] Google results for "' + query + '": ' + results.length + ' results' + (isBlocked ? ' (page was blocked)' : ''))

    // If Google returned 0 results (or was blocked), try DuckDuckGo as fallback
    if (results.length === 0) {
      try {
        var ddgUrl = 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query)
        var ddgResp = await net.fetch(ddgUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
          }
        })
        if (ddgResp.ok) {
          var ddgHtml = await ddgResp.text()
          // DDG HTML version: <a rel="nofollow" class="result__a" href="URL">Title</a>
          // and <a class="result__snippet" href="...">Snippet</a>
          var ddgLinkPattern = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi
          var ddgSnippetPattern = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi
          var ddgMatch
          var ddgSnippets = []

          // Collect snippets
          while ((ddgMatch = ddgSnippetPattern.exec(ddgHtml)) !== null) {
            ddgSnippets.push(ddgMatch[1].replace(/<[^>]+>/g, '').trim())
          }

          var ddgIdx = 0
          while ((ddgMatch = ddgLinkPattern.exec(ddgHtml)) !== null && results.length < 10) {
            var ddgResultUrl = ddgMatch[1]
            var ddgTitle = ddgMatch[2].replace(/<[^>]+>/g, '').trim()

            // DDG sometimes wraps URLs in a redirect — extract the real URL
            if (ddgResultUrl.includes('uddg=')) {
              var uddgMatch = ddgResultUrl.match(/uddg=([^&]+)/)
              if (uddgMatch) ddgResultUrl = decodeURIComponent(uddgMatch[1])
            }

            if (!ddgTitle || ddgTitle.length < 3) { ddgIdx++; continue }
            if (ddgResultUrl.includes('duckduckgo.com')) { ddgIdx++; continue }

            results.push({
              title: ddgTitle.substring(0, 200),
              url: ddgResultUrl,
              snippet: ddgSnippets[ddgIdx] ? ddgSnippets[ddgIdx].substring(0, 300) : ''
            })
            ddgIdx++
          }
        }
      } catch (ddgErr) {
        // DuckDuckGo fallback failed silently
      }
    }

    return {
      results: results.slice(0, 10),
      featured_snippet: featuredSnippet || null,
      total: results.length
    }
  } catch (error) {
    return { error: sanitizeUserError(error.message, 'Search failed') }
  }
})

// Scrape URL - fetch any URL and return its text content for analysis
ipc.handle('agent:scrapeUrl', async function (event, data) {
  try {
    var url = data.url
    if (!url) return { error: 'No URL provided' }

    var response = await net.fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    })

    if (!response.ok) {
      return { error: 'Failed to fetch URL: ' + response.status }
    }

    var contentType = response.headers.get('content-type') || ''
    var html = await response.text()

    // If response is JSON (like API endpoints), return raw text
    if (contentType.includes('application/json') || (html.trim().startsWith('{') && html.trim().endsWith('}'))) {
      return { title: 'JSON Response', text: html.substring(0, 15000) }
    }

    // Extract title
    var titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
    var title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : ''

    // Remove script, style, nav, footer, header elements
    var cleaned = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<nav[\s\S]*?<\/nav>/gi, '')
      .replace(/<footer[\s\S]*?<\/footer>/gi, '')
      .replace(/<header[\s\S]*?<\/header>/gi, '')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '')

    // Strip HTML tags and normalize whitespace
    var text = cleaned
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/\s+/g, ' ')
      .trim()

    // Limit to 15000 chars to avoid overwhelming the LLM context
    if (text.length > 15000) {
      text = text.substring(0, 15000) + '... [truncated]'
    }

    return { title: title, text: text }
  } catch (error) {
    return { error: sanitizeUserError(error.message, 'Failed to scrape URL') }
  }
})

// Set a file on a file input element in a view (bypasses browser security via main process)
ipc.handle('agent:setFileOnInput', async function (event, data) {
  try {
    var selector = data.selector
    var filePath = data.filePath
    var tabId = data.tabId

    if (!filePath) return { error: 'filePath required' }

    var fs = require('fs')
    if (!fs.existsSync(filePath)) {
      return { error: 'File not found: ' + filePath }
    }

    // Use getView (from viewManager.js global) to find the active tab's webContents
    var targetContents = null
    if (tabId && typeof global.getView === 'function') {
      var view = global.getView(tabId)
      if (view && view.webContents) {
        targetContents = view.webContents
      }
    }

    // Fallback: find any WebContentsView with an http(s) URL
    if (!targetContents) {
      var { webContents } = require('electron')
      var allContents = webContents.getAllWebContents()
      for (var i = 0; i < allContents.length; i++) {
        var wc = allContents[i]
        var url = wc.getURL() || ''
        if (url.startsWith('https://') || url.startsWith('http://')) {
          // Skip the main browser UI webContents (it has min:// URLs or is the renderer)
          if (!url.startsWith('min://') && !url.includes('chrome-extension://')) {
            targetContents = wc
          }
        }
      }
    }

    if (!targetContents) {
      return { error: 'No active view found for tab: ' + tabId }
    }

    var pathMod = require('path')
    var fileName = pathMod.basename(filePath)
    var fileBuffer = fs.readFileSync(filePath)
    var base64Data = fileBuffer.toString('base64')

    var ext = pathMod.extname(filePath).toLowerCase()
    var mimeMap = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml' }
    var mimeType = mimeMap[ext] || 'application/octet-stream'

    // Inject the file into the page's file input using DataTransfer API
    // Also try to trigger React's synthetic event system
    var jsSelector = JSON.stringify(selector || 'input[type="file"]')
    var jsFileName = JSON.stringify(fileName)
    var jsMimeType = JSON.stringify(mimeType)
    var jsBase64 = JSON.stringify(base64Data)

    var result = await targetContents.executeJavaScript(`
      (function() {
        try {
          var el = document.querySelector(${jsSelector});
          if (!el) el = document.querySelector('input[type="file"]');
          if (!el) {
            // Try to find any file input, even hidden ones
            var allInputs = document.querySelectorAll('input');
            for (var i = 0; i < allInputs.length; i++) {
              if (allInputs[i].type === 'file') { el = allInputs[i]; break; }
            }
          }
          if (!el) return JSON.stringify({ error: 'No file input found on page' });

          var base64 = ${jsBase64};
          var binaryStr = atob(base64);
          var bytes = new Uint8Array(binaryStr.length);
          for (var i = 0; i < binaryStr.length; i++) { bytes[i] = binaryStr.charCodeAt(i); }
          var file = new File([bytes], ${jsFileName}, { type: ${jsMimeType}, lastModified: Date.now() });
          var dt = new DataTransfer();
          dt.items.add(file);

          // Set files on the input
          Object.defineProperty(el, 'files', { value: dt.files, writable: true, configurable: true });
          el.files = dt.files;

          // Dispatch events that React and other frameworks listen for
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));

          // Also try triggering React's internal handler
          var nativeInputValueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
          var reactProps = Object.keys(el).filter(function(k) { return k.startsWith('__reactProps') || k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'); });
          if (reactProps.length > 0) {
            // React detected — fire a synthetic-like change event
            var syntheticEvent = new Event('change', { bubbles: true });
            Object.defineProperty(syntheticEvent, 'target', { value: el, writable: false });
            el.dispatchEvent(syntheticEvent);
          }

          return JSON.stringify({ success: true, file: ${jsFileName}, size: bytes.length, inputId: el.id || '', inputName: el.name || '' });
        } catch(e) { return JSON.stringify({ error: e.message }); }
      })()
    `)

    try { return JSON.parse(result) } catch (e) { return { success: true } }
  } catch (error) {
    return { error: sanitizeUserError(error.message, 'Failed to set file on input') }
  }
})

// Download a file from URL to temp directory (for file uploads)
ipc.handle('agent:downloadFile', async function (event, data) {
  try {
    var url = data.url
    if (!url) return { error: 'No URL provided' }

    var response = await net.fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    })

    if (!response.ok) {
      return { error: 'Failed to download: ' + response.status }
    }

    var buffer = await response.arrayBuffer()
    var path = require('path')
    var fs = require('fs')
    var os = require('os')

    // Determine file extension from URL or content-type
    var ext = '.tmp'
    var contentType = response.headers.get('content-type') || ''
    if (contentType.includes('image/png')) ext = '.png'
    else if (contentType.includes('image/jpeg') || contentType.includes('image/jpg')) ext = '.jpg'
    else if (contentType.includes('image/gif')) ext = '.gif'
    else if (contentType.includes('image/webp')) ext = '.webp'
    else if (contentType.includes('image/svg')) ext = '.svg'
    else {
      var urlExt = url.split('?')[0].split('.').pop()
      if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'mp4', 'webm'].includes(urlExt)) {
        ext = '.' + urlExt
      }
    }

    var fileName = 'zephyr_upload_' + Date.now() + ext
    var filePath = path.join(os.tmpdir(), fileName)
    fs.writeFileSync(filePath, Buffer.from(buffer))

    return { success: true, filePath: filePath, size: buffer.byteLength }
  } catch (error) {
    return { error: sanitizeUserError(error.message, 'Download failed') }
  }
})

// Detect user's region via IP geolocation (respects VPN)
ipc.handle('agent:getUserRegion', async function () {
  // Region-to-store/currency mapping
  var regionData = {
    US: { country: 'United States', currency: 'USD', stores: ['Amazon', 'Walmart', 'Best Buy', 'Newegg'], fallback_urls: ['https://www.amazon.com/s?k=[product]', 'https://www.walmart.com/search?q=[product]', 'https://www.bestbuy.com/site/searchpage.jsp?st=[product]'] },
    CA: { country: 'Canada', currency: 'CAD', stores: ['Amazon.ca', 'Best Buy Canada', 'Walmart.ca'], fallback_urls: ['https://www.amazon.ca/s?k=[product]', 'https://www.walmart.ca/search?q=[product]'] },
    GB: { country: 'United Kingdom', currency: 'GBP', stores: ['Amazon.co.uk', 'Argos', 'Currys'], fallback_urls: ['https://www.amazon.co.uk/s?k=[product]', 'https://www.currys.co.uk/search/[product]'] },
    DE: { country: 'Germany', currency: 'EUR', stores: ['Amazon.de', 'MediaMarkt', 'Otto'], fallback_urls: ['https://www.amazon.de/s?k=[product]', 'https://www.mediamarkt.de/de/search.html?query=[product]'] },
    FR: { country: 'France', currency: 'EUR', stores: ['Amazon.fr', 'Fnac', 'Cdiscount'], fallback_urls: ['https://www.amazon.fr/s?k=[product]', 'https://www.fnac.com/SearchResult/ResultList.aspx?Search=[product]'] },
    IN: { country: 'India', currency: 'INR', stores: ['Amazon.in', 'Flipkart', 'Croma'], fallback_urls: ['https://www.amazon.in/s?k=[product]', 'https://www.flipkart.com/search?q=[product]'] },
    PK: { country: 'Pakistan', currency: 'PKR', stores: ['Daraz.pk', 'Mega.pk', 'PriceOye'], fallback_urls: ['https://www.daraz.pk/catalog/?q=[product]', 'https://www.mega.pk/search/[product]', 'https://priceoye.pk/search?q=[product]'] },
    AE: { country: 'UAE', currency: 'AED', stores: ['Amazon.ae', 'Noon', 'Sharaf DG'], fallback_urls: ['https://www.amazon.ae/s?k=[product]', 'https://www.noon.com/uae-en/search/?q=[product]'] },
    SA: { country: 'Saudi Arabia', currency: 'SAR', stores: ['Amazon.sa', 'Noon', 'Extra'], fallback_urls: ['https://www.amazon.sa/s?k=[product]', 'https://www.noon.com/saudi-en/search/?q=[product]'] },
    AU: { country: 'Australia', currency: 'AUD', stores: ['Amazon.com.au', 'JB Hi-Fi', 'Kogan'], fallback_urls: ['https://www.amazon.com.au/s?k=[product]', 'https://www.jbhifi.com.au/search?query=[product]'] },
    JP: { country: 'Japan', currency: 'JPY', stores: ['Amazon.co.jp', 'Rakuten', 'Yodobashi'], fallback_urls: ['https://www.amazon.co.jp/s?k=[product]'] },
    BR: { country: 'Brazil', currency: 'BRL', stores: ['Amazon.com.br', 'Mercado Livre', 'Magazine Luiza'], fallback_urls: ['https://www.amazon.com.br/s?k=[product]'] },
    TR: { country: 'Turkey', currency: 'TRY', stores: ['Trendyol', 'Hepsiburada', 'Amazon.com.tr'], fallback_urls: ['https://www.amazon.com.tr/s?k=[product]', 'https://www.trendyol.com/sr?q=[product]'] },
    NG: { country: 'Nigeria', currency: 'NGN', stores: ['Jumia', 'Konga'], fallback_urls: ['https://www.jumia.com.ng/catalog/?q=[product]'] },
    SG: { country: 'Singapore', currency: 'SGD', stores: ['Amazon.sg', 'Lazada', 'Shopee'], fallback_urls: ['https://www.amazon.sg/s?k=[product]', 'https://www.lazada.sg/catalog/?q=[product]'] },
    CN: { country: 'China', currency: 'CNY', stores: ['JD.com', 'Taobao', 'TMall'], fallback_urls: ['https://www.amazon.com/s?k=[product]'] }
  }

  try {
    // Try ip-api.com (free, no key, returns country code)
    var resp = await net.fetch('http://ip-api.com/json/?fields=status,countryCode,country,city,regionName', {
      headers: { 'User-Agent': 'Zephyr Browser' }
    })
    if (resp.ok) {
      var json = await resp.json()
      if (json.status === 'success' && json.countryCode) {
        var code = json.countryCode
        var data = regionData[code] || { country: json.country || code, currency: 'USD', stores: ['Amazon'], fallback_urls: ['https://www.amazon.com/s?k=[product]'] }
        return {
          success: true,
          country: data.country,
          country_code: code,
          currency: data.currency,
          region: json.regionName || data.country,
          city: json.city || '',
          stores: data.stores,
          fallback_urls: data.fallback_urls
        }
      }
    }
  } catch (e) {
    console.log('[getUserRegion] IP geolocation failed:', e.message)
  }

  // Fallback: default to US
  return {
    success: true,
    country: 'United States',
    country_code: 'US',
    currency: 'USD',
    region: 'US',
    city: '',
    stores: ['Amazon', 'Walmart', 'Best Buy'],
    fallback_urls: ['https://www.amazon.com/s?k=[product]', 'https://www.walmart.com/search?q=[product]', 'https://www.bestbuy.com/site/searchpage.jsp?st=[product]']
  }
})

// Check website safety - multiple security checks from main process (no CORS)
ipc.handle('agent:checkWebsiteSafety', async function (event, data) {
  try {
    var url = data.url
    if (!url) return { error: 'No URL provided' }

    // Normalize URL
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url
    }

    var parsedUrl
    try {
      parsedUrl = new URL(url)
    } catch (e) {
      return { error: 'Invalid URL: ' + url }
    }

    var hostname = parsedUrl.hostname
    var checks = {}

    // 1. HTTPS check
    checks.https = { passed: parsedUrl.protocol === 'https:', detail: parsedUrl.protocol === 'https:' ? 'Site uses HTTPS encryption' : 'Site does NOT use HTTPS — connection is unencrypted' }

    // 2. Suspicious TLD and pattern check (instant, no network)
    var scamTLDs = ['.tk', '.ml', '.ga', '.cf', '.gq', '.buzz', '.top', '.xyz', '.club', '.work', '.click', '.loan', '.racing']
    var tld = '.' + hostname.split('.').pop()
    var hasSuspiciousTLD = scamTLDs.indexOf(tld) !== -1

    // Brand impersonation check
    var brands = ['paypal', 'google', 'facebook', 'apple', 'amazon', 'microsoft', 'netflix', 'instagram', 'twitter', 'binance', 'coinbase', 'metamask', 'phantom']
    var suspiciousBrand = null
    for (var b = 0; b < brands.length; b++) {
      if (hostname.includes(brands[b]) && !hostname.endsWith(brands[b] + '.com') && !hostname.endsWith(brands[b] + '.org') && !hostname.endsWith(brands[b] + '.io')) {
        suspiciousBrand = brands[b]
        break
      }
    }

    var homoglyphs = hostname.includes('0') && (hostname.includes('paypal') || hostname.includes('g00gle')) || hostname.includes('rn') && hostname.includes('am') // "rn" looks like "m"
    var excessiveHyphens = (hostname.match(/-/g) || []).length > 2
    var excessiveSubdomains = hostname.split('.').length > 4

    var patternIssues = []
    if (hasSuspiciousTLD) patternIssues.push('Uses suspicious TLD (' + tld + ')')
    if (suspiciousBrand) patternIssues.push('Possible impersonation of ' + suspiciousBrand)
    if (excessiveHyphens) patternIssues.push('Excessive hyphens in domain')
    if (excessiveSubdomains) patternIssues.push('Excessive subdomains')

    checks.patterns = {
      passed: patternIssues.length === 0,
      detail: patternIssues.length === 0 ? 'No suspicious patterns detected' : patternIssues.join('; ')
    }

    // Run network checks in parallel
    var networkChecks = []

    // 3. URLhaus malware database check
    networkChecks.push(
      (async function () {
        try {
          var body = 'url=' + encodeURIComponent(url)
          var resp = await net.fetch('https://urlhaus-api.abuse.ch/v1/url/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body
          })
          var json = await resp.json()
          if (json.query_status === 'no_results') {
            checks.malware = { passed: true, detail: 'Not found in URLhaus malware database' }
          } else if (json.query_status === 'ok' || json.threat) {
            checks.malware = { passed: false, detail: 'LISTED in URLhaus malware database! Threat: ' + (json.threat || json.tags || 'malware') }
          } else {
            checks.malware = { passed: true, detail: 'Not found in URLhaus malware database' }
          }
        } catch (e) {
          checks.malware = { passed: null, detail: 'Could not query malware database: ' + e.message }
        }
      })()
    )

    // 4. RDAP domain age check
    networkChecks.push(
      (async function () {
        try {
          // Extract registrable domain (last 2 parts for most TLDs)
          var parts = hostname.split('.')
          var domain = parts.length >= 2 ? parts.slice(-2).join('.') : hostname
          var resp = await net.fetch('https://rdap.org/domain/' + domain, {
            headers: { 'Accept': 'application/rdap+json' }
          })
          if (!resp.ok) {
            checks.domain_age = { passed: null, detail: 'RDAP lookup not available for this domain' }
            return
          }
          var json = await resp.json()
          var regDate = null
          if (json.events) {
            for (var ev = 0; ev < json.events.length; ev++) {
              if (json.events[ev].eventAction === 'registration') {
                regDate = json.events[ev].eventDate
                break
              }
            }
          }
          if (regDate) {
            var reg = new Date(regDate)
            var now = new Date()
            var ageDays = Math.floor((now - reg) / (1000 * 60 * 60 * 24))
            var ageYears = Math.floor(ageDays / 365)
            var ageStr = ageYears > 0 ? ageYears + ' year(s)' : ageDays + ' day(s)'
            checks.domain_age = {
              passed: ageDays > 90,
              detail: 'Domain registered ' + ageStr + ' ago (since ' + reg.toISOString().split('T')[0] + ')' + (ageDays <= 90 ? ' — WARNING: very new domain' : '')
            }
          } else {
            checks.domain_age = { passed: null, detail: 'Registration date not available via RDAP' }
          }
        } catch (e) {
          checks.domain_age = { passed: null, detail: 'Domain age check failed: ' + e.message }
        }
      })()
    )

    // 5. SSL / connectivity check (HEAD request)
    networkChecks.push(
      (async function () {
        try {
          var resp = await net.fetch(url, { method: 'HEAD', headers: { 'User-Agent': 'Zephyr Safety Check' } })
          checks.ssl = { passed: true, detail: 'SSL connection successful (HTTP ' + resp.status + ')' }
        } catch (e) {
          var msg = e.message || ''
          if (msg.includes('certificate') || msg.includes('SSL') || msg.includes('CERT')) {
            checks.ssl = { passed: false, detail: 'SSL certificate error: ' + msg }
          } else {
            checks.ssl = { passed: null, detail: 'Could not connect: ' + msg }
          }
        }
      })()
    )

    await Promise.all(networkChecks)

    // Calculate overall verdict
    var failCount = 0
    var passCount = 0
    var checkNames = Object.keys(checks)
    for (var c = 0; c < checkNames.length; c++) {
      if (checks[checkNames[c]].passed === true) passCount++
      else if (checks[checkNames[c]].passed === false) failCount++
    }

    var verdict = 'SAFE'
    if (failCount >= 2 || checks.malware && checks.malware.passed === false) {
      verdict = 'DANGEROUS'
    } else if (failCount >= 1 || (checks.domain_age && checks.domain_age.passed === false)) {
      verdict = 'CAUTION'
    }

    return {
      url: url,
      hostname: hostname,
      verdict: verdict,
      checks: checks,
      summary: verdict === 'SAFE' ? 'This website appears safe based on all checks.' : verdict === 'CAUTION' ? 'Some concerns detected — proceed with caution.' : 'Multiple red flags detected — this website may be dangerous!'
    }
  } catch (error) {
    return { error: sanitizeUserError(error.message, 'Safety check failed') }
  }
})

ipc.handle('agent:chat', async function (event, data) {
  try {
    var apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) {
      console.error('[Agent] OPENAI_API_KEY is not set in .env')
      return { error: AGENT_UNAVAILABLE_ERROR }
    }

    var model = data.model || process.env.AGENT_MODEL || 'gpt-4o'

    var requestBody = {
      model: model,
      messages: data.messages
    }

    if (data.tools && data.tools.length > 0) {
      requestBody.tools = data.tools
      requestBody.tool_choice = 'auto'
    }
    if (data.max_tokens) {
      requestBody.max_tokens = data.max_tokens
    }

    var response = await net.fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey
      },
      body: JSON.stringify(requestBody)
    })

    if (!response.ok) {
      return { error: agentServiceError(response.status, await response.text()) }
    }

    var result = await response.json()
    return result
  } catch (error) {
    console.error('[Agent] AI request failed:', error)
    return { error: 'Could not reach Zephyr AI. Check your internet connection and try again.' }
  }
})

// Transcribe recorded mic audio via OpenAI Whisper (avoids the browser
// Web Speech API, which fails with "network" errors inside Electron).
// data: { audioBase64: string, mimeType: string }
ipc.handle('agent:transcribe', async function (event, data) {
  try {
    var apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) {
      console.error('[Agent] OPENAI_API_KEY is not set in .env')
      return { error: 'Voice input is temporarily unavailable. Please type your message instead.' }
    }
    if (!data || !data.audioBase64) {
      return { error: 'No audio captured.' }
    }

    var mimeType = data.mimeType || 'audio/webm'
    var ext = mimeType.indexOf('ogg') !== -1 ? 'ogg' : (mimeType.indexOf('mp4') !== -1 ? 'mp4' : 'webm')

    var buffer = Buffer.from(data.audioBase64, 'base64')
    var blob = new Blob([buffer], { type: mimeType })

    var form = new FormData()
    form.append('file', blob, 'audio.' + ext)
    form.append('model', process.env.AGENT_STT_MODEL || 'whisper-1')
    form.append('response_format', 'json')

    var response = await net.fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + apiKey
      },
      body: form
    })

    if (!response.ok) {
      console.error('[Agent] Transcription error ' + response.status + ':', await response.text())
      return { error: 'Could not understand the recording. Please try again or type your message.' }
    }

    var result = await response.json()
    return { text: (result.text || '').trim() }
  } catch (error) {
    console.error('[Agent] Transcription request failed:', error)
    return { error: 'Voice input failed. Check your internet connection and try again.' }
  }
})

// Fetch live crypto Twitter narratives via SocialData.tools API
ipc.handle('agent:fetchTrendingNarratives', async function () {
  try {
    // Cache check
    var now = Date.now()
    if (trendingNarrativesCache.data && (now - trendingNarrativesCache.timestamp) < trendingNarrativesCache.TTL) {
      console.log('[fetchTrendingNarratives] Returning cached narratives (age: ' + Math.round((now - trendingNarrativesCache.timestamp) / 1000) + 's)')
      return { success: true, narratives: trendingNarrativesCache.data, cached: true }
    }

    var apiKey = process.env.SOCIALDATA_API_KEY
    
    if (!apiKey) {
      console.error('[Agent] SOCIALDATA_API_KEY is not set in .env')
      return { error: 'Live social data is temporarily unavailable.' }
    }

    var socialDataHeaders = {
      'Authorization': 'Bearer ' + apiKey,
      'Accept': 'application/json'
    }

    // Run 3 searches in parallel
    var searches = [
      'solana OR pumpfun OR "pump.fun" min_faves:50',
      '"just launched" OR "new token" OR "CT" OR "trenches" OR "ape" min_faves:20',
      'meta OR narrative OR ticker OR deploying OR "solana launch" min_faves:30'
    ]

    var searchResults = await Promise.all(searches.map(function (query) {
      var url = 'https://api.socialdata.tools/twitter/search?query=' + encodeURIComponent(query) + '&type=Latest'
      return net.fetch(url, { headers: socialDataHeaders })
        .then(function (res) { return res.ok ? res.json() : { tweets: [] } })
        .catch(function () { return { tweets: [] } })
    }))

    // Merge and dedupe by tweet ID
    var seenIds = {}
    var allTweets = []
    for (var si = 0; si < searchResults.length; si++) {
      var rawTweets = searchResults[si]
      var tweets = (rawTweets && rawTweets.tweets) ? rawTweets.tweets : (rawTweets && rawTweets.data) ? rawTweets.data : []
      for (var ti = 0; ti < tweets.length; ti++) {
        var t = tweets[ti]
        var tweetId = t.id_str || t.id
        if (!tweetId || seenIds[tweetId]) continue
        seenIds[tweetId] = true
        allTweets.push(t)
      }
    }

    console.log('[fetchTrendingNarratives] Merged ' + allTweets.length + ' unique tweets')

    // Filter: remove spam/bot-like tweets
    var cutoffMs = 24 * 60 * 60 * 1000
    var nowMs = Date.now()

    var filtered = allTweets.filter(function (t) {
      var text = (t.full_text || t.text || '').toLowerCase()
      var likes = (t.favorite_count || 0)
      var retweets = (t.retweet_count || 0)
      var engagement = likes + retweets
      if (engagement < 5) return false
      if (t.created_at) {
        var tweetTime = new Date(t.created_at).getTime()
        if (nowMs - tweetTime > cutoffMs) return false
      }
      var cashtags = (text.match(/\$[a-z]+/g) || []).length
      if (cashtags > 6) return false
      if (text.replace(/https?:\/\/\S+/g, '').trim().length < 20) return false
      return true
    })

    console.log('[fetchTrendingNarratives] After filtering: ' + filtered.length + ' tweets')

    // Score each tweet: engagement * freshness
    var scoredTweets = filtered.map(function (t) {
      var likes = (t.favorite_count || 0)
      var retweets = (t.retweet_count || 0)
      var engagement = likes + (retweets * 2)
      var freshnessScore = 1.0
      if (t.created_at) {
        var ageMs = nowMs - new Date(t.created_at).getTime()
        var ageHours = ageMs / (1000 * 60 * 60)
        freshnessScore = Math.max(0.1, 1 / (1 + ageHours / 4))
      }
      return {
        id: t.id_str || t.id,
        text: (t.full_text || t.text || '').replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim(),
        author: t.user ? (t.user.screen_name || '') : '',
        likes: likes,
        retweets: retweets,
        score: engagement * freshnessScore,
        created_at: t.created_at || ''
      }
    })

    // Sort by score, take top 80
    scoredTweets.sort(function (a, b) { return b.score - a.score })
    var topTweets = scoredTweets.slice(0, 80)

    // Keyword extraction (word + bigram frequency)
    var stopWords = {
      'the': 1, 'a': 1, 'an': 1, 'and': 1, 'or': 1, 'but': 1, 'in': 1, 'on': 1, 'at': 1,
      'to': 1, 'for': 1, 'of': 1, 'with': 1, 'is': 1, 'it': 1, 'this': 1, 'that': 1,
      'are': 1, 'was': 1, 'be': 1, 'by': 1, 'from': 1, 'as': 1, 'we': 1, 'i': 1,
      'my': 1, 'you': 1, 'just': 1, 'get': 1, 'has': 1, 'he': 1, 'she': 1, 'they': 1,
      'can': 1, 'will': 1, 'do': 1, 'so': 1, 'up': 1, 'if': 1, 'all': 1, 'new': 1,
      'amp': 1, 'rt': 1, 'via': 1, 'like': 1, 'not': 1, 'no': 1, 'into': 1, 'more': 1,
      'out': 1, 'now': 1, 'when': 1, 'its': 1, 'our': 1, 'me': 1, 'been': 1, 'have': 1
    }

    var wordFreq = {}
    var bigramFreq = {}

    for (var wi = 0; wi < topTweets.length; wi++) {
      var words = topTweets[wi].text
        .toLowerCase()
        .replace(/[^a-z0-9\s$#]/g, ' ')
        .split(/\s+/)
        .filter(function (w) { return w.length > 2 && !stopWords[w] })

      for (var wj = 0; wj < words.length; wj++) {
        var word = words[wj]
        wordFreq[word] = (wordFreq[word] || 0) + 1
        if (wj + 1 < words.length) {
          var bigram = word + ' ' + words[wj + 1]
          bigramFreq[bigram] = (bigramFreq[bigram] || 0) + 1
        }
      }
    }

    // Top keywords and bigrams
    var topKeywords = Object.keys(wordFreq)
      .sort(function (a, b) { return wordFreq[b] - wordFreq[a] })
      .slice(0, 30)

    var topBigrams = Object.keys(bigramFreq)
      .filter(function (b) { return bigramFreq[b] >= 2 })
      .sort(function (a, b) { return bigramFreq[b] - bigramFreq[a] })
      .slice(0, 15)

    // Cluster tweets into narrative groups by keyword seeds
    var clusterSeeds = topBigrams.concat(topKeywords.slice(0, 10))
    var clusterLabels = clusterSeeds.slice(0, 8)
    var clusters = {}
    for (var ci = 0; ci < clusterLabels.length; ci++) {
      clusters[clusterLabels[ci]] = []
    }

    for (var ti2 = 0; ti2 < topTweets.length; ti2++) {
      var tweet = topTweets[ti2]
      var tweetTextLower = tweet.text.toLowerCase()
      var bestCluster = null
      var bestCount = 0

      for (var cli = 0; cli < clusterLabels.length; cli++) {
        var seed = clusterLabels[cli]
        var count = 0
        var seedWords = seed.split(' ')
        for (var swi = 0; swi < seedWords.length; swi++) {
          if (tweetTextLower.indexOf(seedWords[swi]) !== -1) count++
        }
        if (count > bestCount) {
          bestCount = count
          bestCluster = seed
        }
      }

      if (bestCluster && bestCount > 0) {
        clusters[bestCluster].push(tweet)
      }
    }

    // Build narrative briefs
    var narratives = []
    var clusterKeys = Object.keys(clusters)

    for (var nci = 0; nci < clusterKeys.length; nci++) {
      var clusterKey = clusterKeys[nci]
      var clusterTweets = clusters[clusterKey]
      if (clusterTweets.length < 2) continue

      clusterTweets.sort(function (a, b) { return b.score - a.score })

      var repTweets = clusterTweets.slice(0, 5).map(function (t) {
        return {
          text: t.text.substring(0, 200),
          author: t.author,
          likes: t.likes,
          retweets: t.retweets
        }
      })

      var avgScore = clusterTweets.reduce(function (s, t) { return s + t.score }, 0) / clusterTweets.length

      narratives.push({
        label: clusterKey,
        tweet_count: clusterTweets.length,
        avg_engagement_score: Math.round(avgScore),
        velocity: clusterTweets.length,
        representative_tweets: repTweets,
        top_keywords: [clusterKey].concat(topKeywords.filter(function (k) {
          return k !== clusterKey && clusterKey.indexOf(k) === -1
        }).slice(0, 5))
      })
    }

    // Sort by tweet count, limit to 8
    narratives.sort(function (a, b) { return b.tweet_count - a.tweet_count })
    narratives = narratives.slice(0, 8)

    console.log('[fetchTrendingNarratives] Built ' + narratives.length + ' narrative clusters')

    // Cache and return
    trendingNarrativesCache.data = narratives
    trendingNarrativesCache.timestamp = Date.now()

    return {
      success: true,
      narratives: narratives,
      tweet_count: topTweets.length,
      cached: false,
      fetched_at: new Date().toISOString()
    }
  } catch (error) {
    return { error: sanitizeUserError(error.message, 'Failed to fetch trending narratives') }
  }
})

// Check if a token name or ticker already exists on DexScreener
ipc.handle('agent:checkTokenCollision', async function (event, data) {
  try {
    var name = (data.name || '').trim()
    var ticker = (data.ticker || '').trim().toUpperCase()

    if (!name && !ticker) return { error: 'Provide at least name or ticker' }

    var queries = []
    if (ticker) queries.push(ticker)
    if (name && name.toUpperCase() !== ticker) queries.push(name)

    var dexResults = await Promise.all(queries.map(function (q) {
      var url = 'https://api.dexscreener.com/latest/dex/search?q=' + encodeURIComponent(q)
      return net.fetch(url, {
        headers: { 'User-Agent': 'Zephyr Browser', 'Accept': 'application/json' }
      })
        .then(function (res) { return res.ok ? res.json() : { pairs: [] } })
        .catch(function () { return { pairs: [] } })
    }))

    // Merge pairs, dedupe
    var seenPairs = {}
    var allPairs = []
    for (var ri = 0; ri < dexResults.length; ri++) {
      var pairs = (dexResults[ri] && dexResults[ri].pairs) ? dexResults[ri].pairs : []
      for (var pi = 0; pi < pairs.length; pi++) {
        var pair = pairs[pi]
        var pairAddr = pair.pairAddress || (pair.baseToken && pair.baseToken.address) || ''
        if (!pairAddr || seenPairs[pairAddr]) continue
        seenPairs[pairAddr] = true
        allPairs.push(pair)
      }
    }

    // Filter to Solana only
    var solanaPairs = allPairs.filter(function (p) {
      return (p.chainId || '').toLowerCase() === 'solana'
    })

    // Check for close matches
    var tickerLower = ticker.toLowerCase()
    var nameLower = name.toLowerCase()

    var matches = solanaPairs.filter(function (p) {
      var pTicker = ((p.baseToken && p.baseToken.symbol) || '').toLowerCase()
      var pName = ((p.baseToken && p.baseToken.name) || '').toLowerCase()
      return (ticker && pTicker === tickerLower) ||
             (name && pName === nameLower) ||
             (ticker && pName.indexOf(tickerLower) !== -1) ||
             (name && nameLower.length >= 4 && pTicker.indexOf(nameLower.substring(0, 4)) !== -1)
    }).slice(0, 10).map(function (p) {
      return {
        name: (p.baseToken && p.baseToken.name) || '',
        ticker: (p.baseToken && p.baseToken.symbol) || '',
        address: (p.baseToken && p.baseToken.address) || '',
        dex: p.dexId || '',
        liquidity_usd: (p.liquidity && p.liquidity.usd) ? Math.round(p.liquidity.usd) : 0,
        url: p.url || ''
      }
    })

    return {
      success: true,
      ticker: ticker,
      name: name,
      exists: matches.length > 0,
      match_count: matches.length,
      matches: matches,
      note: matches.length > 0
        ? 'Collision detected on Solana — consider a different ticker/name'
        : 'No collision found on Solana DexScreener'
    }
  } catch (error) {
    return { error: sanitizeUserError(error.message, 'Failed to check token collision') }
  }
})

// Fetch recent tweets from a specific X/Twitter user via SocialData.tools
ipc.handle('agent:fetchUserTweets', async function (event, data) {
  try {
    var username = (data.username || '').trim().replace(/^@/, '')
    if (!username) return { error: 'No username provided' }

    var apiKey = process.env.SOCIALDATA_API_KEY
    if (!apiKey) {
      console.error('[Agent] SOCIALDATA_API_KEY is not set in .env')
      return { error: 'Live social data is temporarily unavailable.' }
    }

    var socialDataHeaders = {
      'Authorization': 'Bearer ' + apiKey,
      'Accept': 'application/json'
    }

    // Use search endpoint with from:username — more flexible, no user ID needed
    var query = 'from:' + username
    var url = 'https://api.socialdata.tools/twitter/search?query=' + encodeURIComponent(query) + '&type=Latest'

    console.log('[fetchUserTweets] Fetching tweets from @' + username)

    var response = await net.fetch(url, { headers: socialDataHeaders })
    if (!response.ok) {
      console.error('[Agent] SocialData error', response.status)
      return { error: 'Live social data is temporarily unavailable.' }
    }

    var result = await response.json()
    var tweets = (result && result.tweets) ? result.tweets : (result && result.data) ? result.data : []

    console.log('[fetchUserTweets] Got ' + tweets.length + ' tweets from @' + username)

    // Score and sort by engagement * freshness
    var nowMs = Date.now()
    var processed = tweets.map(function (t) {
      var likes = (t.favorite_count || 0)
      var retweets = (t.retweet_count || 0)
      var replies = (t.reply_count || 0)
      var engagement = likes + (retweets * 2) + replies

      var freshnessScore = 1.0
      if (t.created_at) {
        var ageMs = nowMs - new Date(t.created_at).getTime()
        var ageHours = ageMs / (1000 * 60 * 60)
        freshnessScore = Math.max(0.1, 1 / (1 + ageHours / 4))
      }

      return {
        text: (t.full_text || t.text || '').replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim(),
        likes: likes,
        retweets: retweets,
        replies: replies,
        score: engagement * freshnessScore,
        created_at: t.created_at || '',
        is_reply: !!(t.in_reply_to_status_id_str || t.in_reply_to_user_id_str)
      }
    }).filter(function (t) {
      return t.text.length > 10
    })

    // Sort by score descending
    processed.sort(function (a, b) { return b.score - a.score })

    // Take top 30
    var topTweets = processed.slice(0, 30)

    // Extract top themes (simple keyword frequency)
    var stopWords = {
      'the': 1, 'a': 1, 'an': 1, 'and': 1, 'or': 1, 'but': 1, 'in': 1, 'on': 1, 'at': 1,
      'to': 1, 'for': 1, 'of': 1, 'with': 1, 'is': 1, 'it': 1, 'this': 1, 'that': 1,
      'are': 1, 'was': 1, 'be': 1, 'by': 1, 'from': 1, 'as': 1, 'we': 1, 'i': 1,
      'my': 1, 'you': 1, 'just': 1, 'get': 1, 'has': 1, 'he': 1, 'she': 1, 'they': 1,
      'can': 1, 'will': 1, 'do': 1, 'so': 1, 'up': 1, 'if': 1, 'all': 1, 'new': 1,
      'amp': 1, 'rt': 1, 'via': 1, 'like': 1, 'not': 1, 'no': 1, 'into': 1, 'more': 1,
      'out': 1, 'now': 1, 'when': 1, 'its': 1, 'our': 1, 'me': 1, 'been': 1, 'have': 1
    }

    var wordFreq = {}
    for (var i = 0; i < topTweets.length; i++) {
      var words = topTweets[i].text.toLowerCase()
        .replace(/[^a-z0-9\s$#]/g, ' ')
        .split(/\s+/)
        .filter(function (w) { return w.length > 2 && !stopWords[w] })
      for (var j = 0; j < words.length; j++) {
        wordFreq[words[j]] = (wordFreq[words[j]] || 0) + 1
      }
    }

    var topKeywords = Object.keys(wordFreq)
      .sort(function (a, b) { return wordFreq[b] - wordFreq[a] })
      .slice(0, 20)

    return {
      success: true,
      username: username,
      tweet_count: topTweets.length,
      top_tweets: topTweets.slice(0, 15).map(function (t) {
        return {
          text: t.text.substring(0, 280),
          likes: t.likes,
          retweets: t.retweets,
          replies: t.replies,
          is_reply: t.is_reply,
          created_at: t.created_at
        }
      }),
      top_keywords: topKeywords,
      fetched_at: new Date().toISOString()
    }
  } catch (error) {
    return { error: sanitizeUserError(error.message, 'Failed to fetch user tweets') }
  }
})
