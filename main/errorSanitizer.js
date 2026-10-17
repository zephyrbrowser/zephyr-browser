// main/errorSanitizer.js
// Error messages from third-party services (AI provider, launch/trade APIs, RPC
// providers, data APIs) must never reach users verbatim: they can contain API
// keys, provider names or setup hints like ".env". Everything user-facing goes
// through sanitizeUserError(); the raw message is still logged to the console.
// This file is concatenated into the main process bundle — globals only.

var SANITIZE_GENERIC_ERROR = 'This service is temporarily unavailable. Please try again in a moment.'

// Errors that only make sense to a developer (bad/missing keys, billing, quota).
var SANITIZE_CONFIG_PATTERNS = [
  /api[\s_-]?key/i,
  /\.env\b/i,
  /unauthori[sz]ed/i,
  /\b401\b/,
  /\b403\b/,
  /forbidden/i,
  /insufficient_quota|exceeded your current quota|billing/i,
  /organization|project.*(access|permission)/i
]

var SANITIZE_SECRET_PATTERNS = [
  /sk-[A-Za-z0-9_\-*]{6,}/g, // AI provider keys (incl. masked ones)
  /api-key=[^&\s"']+/gi,
  /Bearer\s+[A-Za-z0-9._\-]+/gi
]

// Provider URLs are dropped entirely; names are swapped for neutral wording.
var SANITIZE_PROVIDER_URL = /https?:\/\/[^\s"')]*(openai|pumpdev|helius|jup\.ag|socialdata|gopluslabs|ankr)[^\s"')]*/gi

var SANITIZE_PROVIDER_NAMES = [
  [/open\s?ai/gi, 'Zephyr AI'],
  [/\bgpt-[\w.-]+/gi, 'Zephyr AI'],
  [/\bwhisper(-1)?\b/gi, 'voice service'],
  [/pump\s?dev/gi, 'launch service'],
  [/helius/gi, 'network'],
  [/jupiter/gi, 'swap router'],
  [/social\s?data/gi, 'social service'],
  [/go\s?plus(labs)?/gi, 'security service'],
  [/ankr/gi, 'network']
]

function sanitizeUserError (message, fallback) {
  var raw = message && message.message ? message.message : String(message || '')
  if (!raw) return fallback || SANITIZE_GENERIC_ERROR

  for (var i = 0; i < SANITIZE_CONFIG_PATTERNS.length; i++) {
    if (SANITIZE_CONFIG_PATTERNS[i].test(raw)) {
      console.error('[Zephyr] Service configuration error (hidden from user):', raw)
      return fallback || SANITIZE_GENERIC_ERROR
    }
  }

  var clean = raw
  SANITIZE_SECRET_PATTERNS.forEach(function (re) { clean = clean.replace(re, '[redacted]') })
  clean = clean.replace(SANITIZE_PROVIDER_URL, '')
  SANITIZE_PROVIDER_NAMES.forEach(function (pair) { clean = clean.replace(pair[0], pair[1]) })
  clean = clean
    .replace(/\s*[:-]?\s*[{[][\s\S]*[}\]]\s*$/, '') // trailing raw JSON response bodies
    .replace(/\s*\(\d{3}\)/g, '') // HTTP status codes like "(500)"
    .replace(/\bAPI\s+/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
  if (clean) clean = clean.charAt(0).toUpperCase() + clean.slice(1)

  if (clean !== raw) console.error('[Zephyr] Service error (sanitized for user):', raw)
  return clean || fallback || SANITIZE_GENERIC_ERROR
}

// Walk a tool/IPC result and sanitize any `error` / `message` strings in place.
function sanitizeResultErrors (result) {
  if (!result || typeof result !== 'object') return result
  if (typeof result.error === 'string') result.error = sanitizeUserError(result.error)
  if (result.success === false && typeof result.message === 'string') result.message = sanitizeUserError(result.message)
  return result
}
