var { Keypair, Connection, PublicKey, LAMPORTS_PER_SOL, Transaction, VersionedTransaction, SystemProgram } = require('@solana/web3.js')
var { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddress, createAssociatedTokenAccountInstruction, createTransferInstruction, getAccount, createInitializeMint2Instruction, createMintToInstruction, createSetAuthorityInstruction, AuthorityType, MINT_SIZE} = require('@solana/spl-token')

const bs58Module = require('bs58')
const { getMint } = require('@solana/spl-token')
const WELL_KNOWN_TOKENS = {
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': {
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6,
    logo: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/logo.png'
  },
  'Es9vMFrzaCERZy4d9dzy5oXb5yK4wY6HG3pXj7uGz1z': {
    symbol: 'USDT',
    name: 'Tether USD',
    decimals: 6,
    logo: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/Es9vMFrzaCERZy4d9dzy5oXb5yK4wY6HG3pXj7uGz1z/logo.png'
  },
  'So11111111111111111111111111111111111111112': {
    symbol: 'wSOL',
    name: 'Wrapped SOL',
    decimals: 9,
    logo: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png'
  },
  '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs': {
    symbol: 'ETH',
    name: 'Ether (Wormhole)',
    decimals: 8,
    logo: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs/logo.png'
  },
  '9n4nbM75f5Ui33ZbPYXn59EwSgE8CGsHtAeTH5YFeJ9E': {
    symbol: 'BTC',
    name: 'Bitcoin (Wormhole)',
    decimals: 8,
    logo: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/9n4nbM75f5Ui33ZbPYXn59EwSgE8CGsHtAeTH5YFeJ9E/logo.png'
  },
  'orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE': {
    symbol: 'ORCA',
    name: 'Orca',
    decimals: 6,
    logo: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE/logo.png'
  },
  '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R': {
    symbol: 'RAY',
    name: 'Raydium',
    decimals: 6,
    logo: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R/logo.png'
  },
  'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN': {
    symbol: 'JUP',
    name: 'Jupiter',
    decimals: 6,
    logo: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN/logo.png'
  }
}
const bs58 = bs58Module.default || bs58Module



// RPC endpoints — public Solana RPCs rate-limit aggressively (429s, fetch failures),
// so use Helius for mainnet which has a generous free tier.
// Key is loaded from .env (HELIUS_API_KEY) — see main/loadEnv.js.
const HELIUS_API_KEY = process.env.HELIUS_API_KEY || ''
const MAINNET_RPC = HELIUS_API_KEY
  ? 'https://mainnet.helius-rpc.com/?api-key=' + HELIUS_API_KEY
  : 'https://api.mainnet-beta.solana.com'
const DEVNET_RPCS = [
  'https://rpc.ankr.com/solana_devnet',
  'https://api.devnet.solana.com'
]
var DEVNET_RPC = DEVNET_RPCS[0]
var devnetRPCReady = false

// Try devnet RPCs in order — test with actual getBalance (not just getHealth)
;(async function findWorkingDevnetRPC() {
  var https = require('https')
  var http = require('http')
  for (var i = 0; i < DEVNET_RPCS.length; i++) {
    try {
      var url = DEVNET_RPCS[i]
      var mod = url.startsWith('https') ? https : http
      var ok = await new Promise(function (resolve) {
        // Test with getBalance on the system program (always exists) — this catches 403s that getHealth misses
        var body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getBalance', params: ['11111111111111111111111111111112'] })
        var parsed = new URL(url)
        var req = mod.request({ hostname: parsed.hostname, port: parsed.port, path: parsed.pathname + parsed.search, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }, timeout: 8000 }, function (res) {
          var data = ''
          res.on('data', function (c) { data += c })
          res.on('end', function () {
            if (res.statusCode !== 200) { resolve(false); return }
            try {
              var json = JSON.parse(data)
              resolve(!json.error) // Make sure it's not a 403 wrapped in JSON
            } catch (e) { resolve(false) }
          })
        })
        req.on('error', function () { resolve(false) })
        req.on('timeout', function () { req.destroy(); resolve(false) })
        req.write(body)
        req.end()
      })
      if (ok) {
        DEVNET_RPC = url
        devnetRPCReady = true
        console.log('[WalletManager] Using devnet RPC: ' + url.split('?')[0])
        return
      } else {
        console.log('[WalletManager] RPC failed getBalance test: ' + url.split('?')[0])
      }
    } catch (e) { /* try next */ }
  }
  console.log('[WalletManager] WARNING: All devnet RPCs failed — balance polling will be disabled until a working RPC is found')
  devnetRPCReady = false
})()

// Convert a human-readable supply string to base units BigInt safely (no floating point)
function toBaseUnitsBigInt(supplyStr, decimals) {
  var str = String(supplyStr).trim()
  var parts = str.split('.')
  var wholePart = parts[0] || '0'
  var fracPart = (parts[1] || '').substring(0, decimals)

  // Pad fractional part to `decimals` length
  while (fracPart.length < decimals) {
    fracPart += '0'
  }

  // Remove leading zeros from whole part but keep at least one digit
  wholePart = wholePart.replace(/^0+/, '') || '0'

  return BigInt(wholePart + fracPart)
}

// Borsh serialization helpers for Metaplex metadata
function borshString(str) {
  var bytes = Buffer.from(str, 'utf8')
  var lenBuf = Buffer.alloc(4)
  lenBuf.writeUInt32LE(bytes.length)
  return Buffer.concat([lenBuf, bytes])
}

function serializeCreateMetadataV3(opts) {
  var parts = []
  // Discriminator: CreateMetadataAccountV3 = instruction index 33
  parts.push(Buffer.from([33]))
  // DataV2: name, symbol, uri
  parts.push(borshString(opts.name))
  parts.push(borshString(opts.symbol))
  parts.push(borshString(opts.uri))
  // seller_fee_basis_points (u16 LE)
  var feeBuf = Buffer.alloc(2)
  feeBuf.writeUInt16LE(opts.sellerFeeBasisPoints || 0)
  parts.push(feeBuf)
  // creators: Option<Vec<Creator>> — None for fungible tokens
  if (opts.creators) {
    parts.push(Buffer.from([1])) // Some
    var lenBuf = Buffer.alloc(4)
    lenBuf.writeUInt32LE(opts.creators.length)
    parts.push(lenBuf)
    for (var i = 0; i < opts.creators.length; i++) {
      var c = opts.creators[i]
      parts.push(c.address.toBuffer()) // 32 bytes
      parts.push(Buffer.from([c.verified ? 1 : 0]))
      parts.push(Buffer.from([c.share]))
    }
  } else {
    parts.push(Buffer.from([0])) // None
  }
  // collection: Option<Collection> — None
  parts.push(Buffer.from([0]))
  // uses: Option<Uses> — None
  parts.push(Buffer.from([0]))
  // is_mutable: bool
  parts.push(Buffer.from([opts.isMutable ? 1 : 0]))
  // collection_details: Option<CollectionDetails> — None
  parts.push(Buffer.from([0]))
  return Buffer.concat(parts)
}

// ImgBB API key for image hosting
var IMGBB_API_KEY = ZEPHYR_SECRETS.IMGBB_API_KEY

// Upload an image to ImgBB (returns permanent URL)
function uploadToImgBB(base64Data, imageName) {
  return new Promise(function (resolve, reject) {
    var https = require('https')
    var querystring = require('querystring')

    var postData = querystring.stringify({
      key: IMGBB_API_KEY,
      image: base64Data,
      name: imageName || 'token_logo'
    })

    var options = {
      hostname: 'api.imgbb.com',
      path: '/1/upload',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData)
      }
    }

    var req = https.request(options, function (res) {
      var data = ''
      res.on('data', function (chunk) { data += chunk })
      res.on('end', function () {
        try {
          var json = JSON.parse(data)
          if (json.success && json.data && json.data.url) {
            resolve(json.data.url)
          } else {
            reject(new Error('ImgBB upload failed: ' + (json.error ? json.error.message : data)))
          }
        } catch (e) {
          reject(new Error('ImgBB response parse error: ' + e.message))
        }
      })
    })
    req.on('error', function (err) { reject(err) })
    req.write(postData)
    req.end()
  })
}

// Upload token metadata to IPFS via pump.fun's free pinning endpoint
// pump.fun expects: file (image), name, symbol, description, twitter, telegram, website
// Returns metadataUri pointing to ipfs.io gateway with full CORS support
function uploadToIPFS(opts) {
  return new Promise(function (resolve, reject) {
    var https = require('https')
    var crypto = require('crypto')

    var boundary = '----Zephyr' + crypto.randomBytes(8).toString('hex')
    var parts = []

    // Image file part — pump.fun requires a "file" field with the image
    if (opts.imageBuffer) {
      parts.push('--' + boundary + '\r\n')
      parts.push('Content-Disposition: form-data; name="file"; filename="' + (opts.imageName || 'logo.png') + '"\r\n')
      parts.push('Content-Type: ' + (opts.imageMime || 'image/png') + '\r\n\r\n')
      parts.push(opts.imageBuffer) // Buffer
      parts.push('\r\n')
    }

    // Text fields
    var textFields = {
      name: opts.name || '',
      symbol: opts.symbol || '',
      description: opts.description || '',
      twitter: opts.twitter || '',
      telegram: opts.telegram || '',
      website: opts.website || '',
      showName: 'true'
    }

    for (var key in textFields) {
      if (textFields[key]) {
        parts.push('--' + boundary + '\r\n')
        parts.push('Content-Disposition: form-data; name="' + key + '"\r\n\r\n')
        parts.push(textFields[key] + '\r\n')
      }
    }

    parts.push('--' + boundary + '--\r\n')

    // Convert all parts to buffers and concatenate
    var buffers = parts.map(function (part) {
      return Buffer.isBuffer(part) ? part : Buffer.from(part, 'utf8')
    })
    var bodyBuffer = Buffer.concat(buffers)

    var req = https.request({
      hostname: 'pump.fun',
      path: '/api/ipfs',
      method: 'POST',
      headers: {
        'Content-Type': 'multipart/form-data; boundary=' + boundary,
        'Content-Length': bodyBuffer.length
      }
    }, function (res) {
      var data = ''
      res.on('data', function (chunk) { data += chunk })
      res.on('end', function () {
        console.log('[IPFS] pump.fun response (status ' + res.statusCode + '): ' + data.substring(0, 500))
        try {
          var json = JSON.parse(data)
          if (json.metadataUri) {
            resolve(json.metadataUri)
          } else {
            reject(new Error('IPFS upload failed: no metadataUri in response: ' + data.substring(0, 200)))
          }
        } catch (e) {
          reject(new Error('IPFS response parse error: ' + e.message + ' body: ' + data.substring(0, 200)))
        }
      })
    })
    req.on('error', function (err) { reject(err) })
    req.setTimeout(30000, function () {
      req.destroy()
      reject(new Error('IPFS upload timed out after 30s'))
    })
    req.write(bodyBuffer)
    req.end()
  })
}

// Fetch an image from a URL and return its Buffer
function fetchImageBuffer(imageUrl) {
  return new Promise(function (resolve, reject) {
    var mod = imageUrl.startsWith('https') ? require('https') : require('http')
    mod.get(imageUrl, function (res) {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // Follow redirect
        fetchImageBuffer(res.headers.location).then(resolve).catch(reject)
        return
      }
      var chunks = []
      res.on('data', function (chunk) { chunks.push(chunk) })
      res.on('end', function () { resolve(Buffer.concat(chunks)) })
    }).on('error', function (err) { reject(err) })
  })
}

// Upload token metadata — handles image upload + IPFS pinning in one step
async function uploadTokenMetadata(opts) {
  var imageBuffer = null
  var imageName = 'logo.png'
  var imageMime = 'image/png'

  // Get image as a Buffer for pump.fun upload
  if (opts.logoUrl && opts.logoUrl.startsWith('data:')) {
    // Data URL from chat attachment
    console.log('[Metadata] Processing logo from data URL...')
    var matches = opts.logoUrl.match(/^data:([^;]+);base64,(.+)$/)
    if (matches) {
      imageMime = matches[1]
      imageBuffer = Buffer.from(matches[2], 'base64')
      var ext = imageMime.split('/')[1] || 'png'
      imageName = (opts.symbol || 'token') + '_logo.' + ext
    }
  } else if (opts.logoUrl && opts.logoUrl.startsWith('file://')) {
    // File path from disk
    console.log('[Metadata] Reading logo from disk...')
    try {
      var fs = require('fs')
      var filePath = opts.logoUrl.replace('file://', '')
      imageBuffer = fs.readFileSync(filePath)
      imageName = require('path').basename(filePath)
    } catch (readErr) {
      console.error('[Metadata] Failed to read logo file: ' + readErr.message)
    }
  } else if (opts.logoUrl && opts.logoUrl.startsWith('http')) {
    // URL — first upload to ImgBB to get a permanent URL, then fetch as buffer
    console.log('[Metadata] Fetching logo from URL: ' + opts.logoUrl)
    try {
      imageBuffer = await fetchImageBuffer(opts.logoUrl)
      imageName = (opts.symbol || 'token') + '_logo.png'
    } catch (fetchErr) {
      console.error('[Metadata] Failed to fetch logo: ' + fetchErr.message)
    }
  }

  if (imageBuffer) {
    console.log('[Metadata] Logo ready: ' + imageBuffer.length + ' bytes')
  } else {
    console.log('[Metadata] No logo image provided')
  }

  // Upload everything to IPFS via pump.fun — it creates the metadata JSON with image
  console.log('[Metadata] Uploading to IPFS via pump.fun...')
  var metadataUrl = await uploadToIPFS({
    imageBuffer: imageBuffer,
    imageName: imageName,
    imageMime: imageMime,
    name: opts.name,
    symbol: opts.symbol,
    description: opts.description || opts.name + ' token',
    website: opts.socials && opts.socials.website || '',
    twitter: opts.socials && opts.socials.twitter || '',
    telegram: opts.socials && opts.socials.telegram || ''
  })
  console.log('[Metadata] Metadata URI (' + metadataUrl.length + ' chars): ' + metadataUrl)

  return { metadataUrl: metadataUrl, imageUrl: '' }
}

// Token metadata cache
const TOKEN_METADATA_CACHE = new Map()

// Telegram notification for token launches
var WM_TELEGRAM_BOT_TOKEN = ZEPHYR_SECRETS.TELEGRAM_BOT_TOKEN
var WM_TELEGRAM_CHAT_IDS = ['-5193939831', '-5286396943']
// -5193939831 test token
// -5286396943 test token

var WM_TELEGRAM_RELAY_URLS = [
  'https://api.zephyrbrowser.com/api/notify'
]

async function wmSendTelegram (text) {
  var fetchFn = typeof globalThis.fetch === 'function' ? globalThis.fetch : require('cross-fetch')
  var headers = { 'Content-Type': 'application/json' }

  for (var c = 0; c < WM_TELEGRAM_CHAT_IDS.length; c++) {
    var chatId = WM_TELEGRAM_CHAT_IDS[c]
    var sent = false

    for (var i = 0; i < WM_TELEGRAM_RELAY_URLS.length; i++) {
      try {
        var res = await fetchFn(WM_TELEGRAM_RELAY_URLS[i], {
          method: 'POST', headers: headers,
          body: JSON.stringify({ message: text, botToken: WM_TELEGRAM_BOT_TOKEN, chatId: chatId })
        })
        if (res.ok) {
          console.log('[WalletManager] Telegram sent to', chatId, 'via relay:', WM_TELEGRAM_RELAY_URLS[i])
          sent = true
          break
        }
        console.warn('[WalletManager] Relay', WM_TELEGRAM_RELAY_URLS[i], 'returned', res.status)
      } catch (err) {
        console.warn('[WalletManager] Relay', WM_TELEGRAM_RELAY_URLS[i], 'failed:', err.message)
      }
    }

    if (!sent) {
      // Final fallback: direct Telegram API
      try {
        var directRes = await fetchFn('https://api.telegram.org/bot' + WM_TELEGRAM_BOT_TOKEN + '/sendMessage', {
          method: 'POST', headers: headers,
          body: JSON.stringify({ chat_id: chatId, text: text, disable_web_page_preview: false })
        })
        if (directRes.ok) console.log('[WalletManager] Telegram sent to', chatId, 'via direct API')
      } catch (err) {
        console.error('[WalletManager] All Telegram endpoints failed for', chatId, ':', err.message)
      }
    }
  }
}

async function wmSendTelegramLaunchNotification (params) {
  try {
    var isDevnet = params.network === 'devnet'
    var networkTag = isDevnet ? ' [DEVNET]' : ''
    var explorerSuffix = isDevnet ? '?cluster=devnet' : ''

    var message =
      (isDevnet ? '🧪' : '🚀') + ' New Token Launched via Zephyr' + networkTag + '!\n\n' +
      '📛 Name: ' + params.name + '\n' +
      '🔤 Symbol: ' + params.symbol + '\n' +
      '💎 Supply: ' + params.initialSupply + '\n' +
      '📍 Mint: ' + params.mint + '\n'

    if (params.liquiditySol) {
      message += '💧 Liquidity: ' + params.liquiditySol + ' SOL (Raydium CPMM)\n'
    }

    message += '🔗 Solscan: https://solscan.io/token/' + params.mint + explorerSuffix

    if (isDevnet) {
      message += '\n\n⚠️ This token is on DEVNET — not real value.'
    }

    await wmSendTelegram(message)
  } catch (err) {
    console.error('[WalletManager] Telegram notification failed (non-fatal):', err.message)
  }
}

class WalletManager {
  constructor() {
    this.keypair = null
    this.connection = null
    this.network = 'mainnet-beta' // or 'devnet'
    this.pendingTransactions = new Map() // requestId -> { transaction, resolve, reject }

    // Balance subscription
    this.balanceSubscriptionId = null
    this.balanceCallbacks = new Set()
    this.lastKnownBalance = null
  }
  async preloadTokenMetadata() {
    if (TOKEN_METADATA_CACHE.size > 0) return

    try {
      const res = await fetch('https://token.jup.ag/strict')
      const tokens = await res.json()

      for (const t of tokens) {
        TOKEN_METADATA_CACHE.set(t.address, {
          symbol: t.symbol,
          name: t.name,
          logo: t.logoURI,
          decimals: t.decimals
        })
      }
    } catch (err) {
      console.warn('[WalletManager] Token metadata preload failed')
    }
  }

  /**
   * Initialize the wallet - generates a new keypair on every browser launch
   */
  async initialize() {
    // Generate new ephemeral keypair
    this.keypair = Keypair.generate()

    // Initialize connection
    const rpcUrl = this.network === 'mainnet-beta' ? MAINNET_RPC : DEVNET_RPC
    this.connection = new Connection(rpcUrl, 'confirmed')
    // Suppress underlying ws library "ws error" spam when WSS upgrades fail (public RPC, auth, etc.)
    try {
      var rpcWs = this.connection._rpcWebSocket
      if (rpcWs && typeof rpcWs.on === 'function') rpcWs.on('error', function () {})
    } catch (e) {}

    // ✅ async call now works
    await this.preloadTokenMetadata()

    return {
      publicKey: this.getPublicKey(),
      network: this.network
    }
  }


  /**
   * Get the public key as base58 string
   */
  getPublicKey() {
    if (!this.keypair) return null
    return this.keypair.publicKey.toBase58()
  }

  /**
   * Import a wallet from a Base58 private key
   * Replaces the current ephemeral keypair permanently for this session
   */
  async importWallet(privateKeyBase58) {
    try {
      var secretKey = bs58.decode(privateKeyBase58)
      if (secretKey.length !== 64) {
        throw new Error('Invalid private key length. Expected 64 bytes.')
      }
      this.keypair = Keypair.fromSecretKey(secretKey)
      return {
        publicKey: this.keypair.publicKey.toBase58(),
        network: this.network
      }
    } catch (err) {
      throw new Error('Invalid private key: ' + err.message)
    }
  }

  /**
   * Get the secret key as Uint8Array (for export)
   * Returns the 64-byte secret key in Phantom-compatible format
   */
  getKeypair() {
    if (!this.keypair) throw new Error('Wallet not initialized')
    return this.keypair
  }

  getSecretKey() {
    if (!this.keypair) return null
    return Array.from(this.keypair.secretKey)
  }

  /**
   * Get the secret key as base58 string
   */
  getSecretKeyBase58() {
    if (!this.keypair) return null
    return bs58.encode(this.keypair.secretKey)
  }

  /**
   * Get wallet balance in SOL
   */
  async getBalance() {
    if (!this.keypair || !this.connection) {
      throw new Error('Wallet not initialized')
    }

    try {
      const balance = await this.connection.getBalance(this.keypair.publicKey)
      this.lastKnownBalance = {
        lamports: balance,
        sol: balance / LAMPORTS_PER_SOL
      }
      return this.lastKnownBalance
    } catch (error) {
      console.error('[WalletManager] Error getting balance:', error)
      throw error
    }
  }

  /**
   * Subscribe to balance changes
   * @param {Function} callback - Called when balance changes with { lamports, sol }
   * @returns {Function} - Unsubscribe function
   */
  subscribeToBalance(callback) {
    if (!this.keypair || !this.connection) {
      throw new Error('Wallet not initialized')
    }

    // Add callback
    this.balanceCallbacks.add(callback)

    // Start subscription if not already running
    if (this.balanceSubscriptionId === null) {
      this._startBalanceSubscription()
    }

    // Return unsubscribe function
    return () => {
      this.balanceCallbacks.delete(callback)
      if (this.balanceCallbacks.size === 0) {
        this._stopBalanceSubscription()
      }
    }
  }

  /**
   * Start WebSocket subscription to account changes
   */
  _startBalanceSubscription() {
    // Public Solana RPCs (both mainnet-beta and devnet) reject WSS upgrades with 401 under load,
    // which causes the underlying ws library to spam reconnect attempts to the terminal.
    // The 5s HTTP poller is already started in walletIPC.js and handles balance updates fine,
    // so we skip the WebSocket subscription entirely.
  }

  /**
   * Stop WebSocket subscription
   */
  _stopBalanceSubscription() {
    if (this.balanceSubscriptionId !== null && this.connection) {
      try {
        this.connection.removeAccountChangeListener(this.balanceSubscriptionId)
        // console.log('[WalletManager] Balance subscription stopped')
      } catch (error) {
        console.error('[WalletManager] Error stopping balance subscription:', error)
      }
      this.balanceSubscriptionId = null
    }
  }

  /**
   * Sign a transaction (supports both legacy and versioned transactions)
   * @param {Buffer} serializedTransaction - Serialized transaction buffer
   * @returns {Buffer} - Signed serialized transaction
   */
  async signTransaction(serializedTransaction) {
    if (!this.keypair) {
      throw new Error('Wallet not initialized')
    }

    try {
      const txBuffer = Buffer.from(serializedTransaction)

      // Try to detect versioned transaction by checking the message version byte
      // The structure is: [num_signatures (1 byte)][signatures (64 bytes each)][message...]
      // For versioned transactions, the message starts with a version byte with high bit set (0x80 for v0)
      const numSignatures = txBuffer[0]
      const messageOffset = 1 + (numSignatures * 64)
      const messageVersionByte = txBuffer[messageOffset]
      const isVersioned = messageVersionByte !== undefined && (messageVersionByte & 0x80) !== 0

      console.log('[WalletManager] Transaction detection:', {
        numSignatures,
        messageOffset,
        messageVersionByte,
        isVersioned,
        totalLength: txBuffer.length
      })

      if (isVersioned) {
        // Handle VersionedTransaction (v0 transactions used by Jupiter, etc.)
        // console.log('[WalletManager] Signing VersionedTransaction')
        const versionedTx = VersionedTransaction.deserialize(txBuffer)

        // Sign the versioned transaction
        versionedTx.sign([this.keypair])

        // Return serialized signed transaction
        return Array.from(versionedTx.serialize())
      } else {
        // Handle legacy Transaction
        // console.log('[WalletManager] Signing legacy Transaction')
        const transaction = Transaction.from(txBuffer)

        // Sign with our keypair
        transaction.sign(this.keypair)

        // Return serialized signed transaction
        return Array.from(transaction.serialize())
      }
    } catch (error) {
      console.error('[WalletManager] Error signing transaction:', error)
      throw error
    }
  }

  /**
   * Sign multiple transactions (supports both legacy and versioned transactions)
   * @param {Array<Buffer>} serializedTransactions - Array of serialized transaction buffers
   * @returns {Array<Buffer>} - Array of signed serialized transactions
   */
  async signAllTransactions(serializedTransactions) {
    if (!this.keypair) {
      throw new Error('Wallet not initialized')
    }

    try {
      const signedTransactions = []

      for (const serializedTx of serializedTransactions) {
        const txBuffer = Buffer.from(serializedTx)

        // Detect versioned transaction by checking the message version byte
        const numSignatures = txBuffer[0]
        const messageOffset = 1 + (numSignatures * 64)
        const messageVersionByte = txBuffer[messageOffset]
        const isVersioned = messageVersionByte !== undefined && (messageVersionByte & 0x80) !== 0

        if (isVersioned) {
          const versionedTx = VersionedTransaction.deserialize(txBuffer)
          versionedTx.sign([this.keypair])
          signedTransactions.push(Array.from(versionedTx.serialize()))
        } else {
          const transaction = Transaction.from(txBuffer)
          transaction.sign(this.keypair)
          signedTransactions.push(Array.from(transaction.serialize()))
        }
      }

      return signedTransactions
    } catch (error) {
      console.error('[WalletManager] Error signing transactions:', error)
      throw error
    }
  }

  /**
   * Sign a message
   * @param {Uint8Array} message - Message to sign
   * @returns {Uint8Array} - Signature
   */
  async signMessage(message) {
    if (!this.keypair) {
      throw new Error('Wallet not initialized')
    }

    try {
      const nacl = require('tweetnacl')
      const messageBytes = Buffer.from(message)
      const signature = nacl.sign.detached(messageBytes, this.keypair.secretKey)
      return Array.from(signature)
    } catch (error) {
      console.error('[WalletManager] Error signing message:', error)
      throw error
    }
  }

  /**
   * Decode a transaction for display in confirmation UI
   * Supports both legacy and versioned transactions
   * @param {Buffer} serializedTransaction - Serialized transaction buffer
   * @returns {Object} - Decoded transaction details
   */
  decodeTransaction(serializedTransaction) {
    try {
      const txBuffer = Buffer.from(serializedTransaction)

      // Detect versioned transaction by checking the message version byte
      // The structure is: [num_signatures (1 byte)][signatures (64 bytes each)][message...]
      // For versioned transactions, the message starts with a version byte with high bit set (0x80 for v0)
      const numSignatures = txBuffer[0]
      const messageOffset = 1 + (numSignatures * 64)
      const messageVersionByte = txBuffer[messageOffset]
      const isVersioned = messageVersionByte !== undefined && (messageVersionByte & 0x80) !== 0

      let details

      if (isVersioned) {
        // Handle VersionedTransaction
        const versionedTx = VersionedTransaction.deserialize(txBuffer)
        const message = versionedTx.message

        details = {
          isVersioned: true,
          version: message.version,
          recentBlockhash: message.recentBlockhash,
          feePayer: message.staticAccountKeys[0]?.toBase58() || null,
          instructions: [],
          signatures: versionedTx.signatures.map((sig, idx) => ({
            publicKey: message.staticAccountKeys[idx]?.toBase58() || 'unknown',
            signature: sig ? bs58.encode(sig) : null
          }))
        }

        // Decode compiled instructions for versioned transaction
        for (const instruction of message.compiledInstructions) {
          const programId = message.staticAccountKeys[instruction.programIdIndex]?.toBase58() || 'unknown'

          const decodedInstruction = {
            programId,
            programIdIndex: instruction.programIdIndex,
            accountKeyIndexes: instruction.accountKeyIndexes,
            data: bs58.encode(instruction.data),
            programName: this._getProgramName(programId)
          }

          details.instructions.push(decodedInstruction)
        }
      } else {
        // Handle legacy Transaction
        const transaction = Transaction.from(txBuffer)

        details = {
          isVersioned: false,
          recentBlockhash: transaction.recentBlockhash,
          feePayer: transaction.feePayer?.toBase58() || null,
          instructions: [],
          signatures: transaction.signatures.map(sig => ({
            publicKey: sig.publicKey.toBase58(),
            signature: sig.signature ? bs58.encode(sig.signature) : null
          }))
        }

        // Decode each instruction
        for (const instruction of transaction.instructions) {
          const decodedInstruction = {
            programId: instruction.programId.toBase58(),
            keys: instruction.keys.map(key => ({
              pubkey: key.pubkey.toBase58(),
              isSigner: key.isSigner,
              isWritable: key.isWritable
            })),
            data: bs58.encode(instruction.data)
          }

          // Try to identify common program types
          const programId = instruction.programId.toBase58()

          // System Program
          if (programId === '11111111111111111111111111111111') {
            decodedInstruction.programName = 'System Program'

            // Try to decode transfer instruction
            if (instruction.data.length >= 12) {
              const instructionType = instruction.data.readUInt32LE(0)
              if (instructionType === 2) { // Transfer
                const lamports = instruction.data.readBigUInt64LE(4)
                decodedInstruction.type = 'Transfer'
                decodedInstruction.amount = Number(lamports)
                decodedInstruction.amountSOL = Number(lamports) / LAMPORTS_PER_SOL
                decodedInstruction.from = instruction.keys[0]?.pubkey.toBase58()
                decodedInstruction.to = instruction.keys[1]?.pubkey.toBase58()
              }
            }
          }
          // Token Program
          else if (programId === 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') {
            decodedInstruction.programName = 'Token Program'
          }
          // Associated Token Account Program
          else if (programId === 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL') {
            decodedInstruction.programName = 'Associated Token Account Program'
          }
          else {
            decodedInstruction.programName = 'Unknown Program'
          }

          details.instructions.push(decodedInstruction)
        }
      }

      // Calculate warnings (applies to both versioned and legacy transactions)
      details.warnings = []

      // Check for full balance transfer
      for (const inst of details.instructions) {
        if (inst.type === 'Transfer' && inst.from === this.getPublicKey()) {
          details.warnings.push({
            type: 'transfer',
            message: `Transferring ${inst.amountSOL} SOL to ${inst.to}`
          })
        }
      }

      // Check for unknown programs
      const unknownPrograms = details.instructions.filter(i => i.programName === 'Unknown Program')
      if (unknownPrograms.length > 0) {
        details.warnings.push({
          type: 'unknown_program',
          message: `Transaction interacts with ${unknownPrograms.length} unknown program(s)`
        })
      }

      // Check for multiple instructions
      if (details.instructions.length > 1) {
        details.warnings.push({
          type: 'multiple_instructions',
          message: `Transaction contains ${details.instructions.length} instructions`
        })
      }

      return details
    } catch (error) {
      console.error('[WalletManager] Error decoding transaction:', error)
      throw error
    }
  }

  /**
   * Get human-readable program name from program ID
   * @param {string} programId - Program ID in base58
   * @returns {string} - Program name
   */
  _getProgramName(programId) {
    const knownPrograms = {
      '11111111111111111111111111111111': 'System Program',
      'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA': 'Token Program',
      'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL': 'Associated Token Account Program',
      'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4': 'Jupiter Aggregator v6',
      'JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB': 'Jupiter Aggregator v4',
      '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8': 'Raydium AMM',
      'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK': 'Raydium CLMM',
      'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc': 'Orca Whirlpool',
      '9W959DqEETiGZocYWCQPaJ6sBmUzgfxXfqGeTEdp3aQP': 'Orca Swap v2',
      'ComputeBudget111111111111111111111111111111': 'Compute Budget Program',
      'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr': 'Memo Program',
      'Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo': 'Memo Program v1'
    }
    return knownPrograms[programId] || 'Unknown Program'
  }

  /**
   * Send a signed transaction
   * @param {Buffer} signedTransaction - Signed serialized transaction
   * @returns {string} - Transaction signature
   */
  async sendTransaction(signedTransaction) {
    if (!this.connection) {
      throw new Error('Connection not initialized')
    }

    try {
      const signature = await this.connection.sendRawTransaction(
        Buffer.from(signedTransaction),
        { skipPreflight: false, preflightCommitment: 'confirmed' }
      )

      // Wait for confirmation
      await this.connection.confirmTransaction(signature, 'confirmed')

      return signature
    } catch (error) {
      console.error('[WalletManager] Error sending transaction:', error)
      throw error
    }
  }

  /**
   * Switch network
   * @param {string} network - 'mainnet-beta' or 'devnet'
   */
  switchNetwork(network) {
    if (network !== 'mainnet-beta' && network !== 'devnet') {
      throw new Error('Invalid network. Use "mainnet-beta" or "devnet"')
    }

    // Stop existing subscription before switching
    this._stopBalanceSubscription()

    this.network = network
    const rpcUrl = network === 'mainnet-beta' ? MAINNET_RPC : DEVNET_RPC
    this.connection = new Connection(rpcUrl, 'confirmed')
    try {
      var rpcWs = this.connection._rpcWebSocket
      if (rpcWs && typeof rpcWs.on === 'function') rpcWs.on('error', function () {})
    } catch (e) {}

    // Restart subscription if we had callbacks
    if (this.balanceCallbacks.size > 0) {
      this._startBalanceSubscription()
    }

    // Reset last known balance
    this.lastKnownBalance = null

    // console.log('[WalletManager] Switched to network:', network)

    return { network: this.network }
  }

  /**
   * Store a pending transaction for user approval
   */
  storePendingTransaction(requestId, transaction, resolve, reject) {
    this.pendingTransactions.set(requestId, { transaction, resolve, reject })
  }

  /**
   * Get a pending transaction
   */
  getPendingTransaction(requestId) {
    return this.pendingTransactions.get(requestId)
  }

  /**
   * Remove a pending transaction
   */
  removePendingTransaction(requestId) {
    this.pendingTransactions.delete(requestId)
  }

  /**
   * Get all SPL token accounts and balances for this wallet
   * @returns {Array} - Array of token objects with mint, balance, decimals, etc.
   */
  async getTokenAccounts() {
    if (!this.keypair || !this.connection) {
      throw new Error('Wallet not initialized')
    }

    // 🔥 Query BOTH token programs
    const [classicRes, token2022Res] = await Promise.all([
      this.connection.getParsedTokenAccountsByOwner(
        this.keypair.publicKey,
        { programId: TOKEN_PROGRAM_ID }
      ),
      this.connection.getParsedTokenAccountsByOwner(
        this.keypair.publicKey,
        { programId: TOKEN_2022_PROGRAM_ID }
      )
    ])

    const allAccounts = [...classicRes.value, ...token2022Res.value]
    const tokens = []

    for (const { account, pubkey } of allAccounts) {
      const info = account.data.parsed.info
      const mint = info.mint

      const rawAmount = info.tokenAmount.amount // STRING
      const decimals = info.tokenAmount.decimals

      if (rawAmount === '0') continue

      const balance = Number(rawAmount) / Math.pow(10, decimals)

      const metadata = await this._getTokenMetadata(mint)

      tokens.push({
        mint,
        tokenAccount: pubkey.toBase58(),
        rawBalance: rawAmount,
        balance,
        decimals,

        symbol: metadata?.symbol ?? 'Unknown',
        name: metadata?.name ?? 'Unknown Token',
        logo: metadata?.logo ?? null,

        isUnknown: !metadata
      })
    }

    return tokens
  }

  /**
   * Look up a single SPL token by mint (used by the "Add Token" modal)
   * @param {string} mintAddress - Token mint address
   * @returns {Object} - { contractAddress, mint, symbol, name, decimals, balance, rawBalance, logo }
   */
  async lookupToken(mintAddress) {
    if (!this.keypair || !this.connection) {
      throw new Error('Wallet not initialized')
    }

    var mintPubkey = new PublicKey(mintAddress)
    var mintAccount = await this.connection.getAccountInfo(mintPubkey)
    if (!mintAccount) throw new Error('Token not found on this network.')
    if (!mintAccount.owner.equals(TOKEN_PROGRAM_ID) && !mintAccount.owner.equals(TOKEN_2022_PROGRAM_ID)) {
      throw new Error('Address is not an SPL token mint.')
    }

    var mintInfo = await getMint(this.connection, mintPubkey, 'confirmed', mintAccount.owner)
    var metadata = await this._getTokenMetadata(mintAddress)

    var rawBalance = '0'
    var res = await this.connection.getParsedTokenAccountsByOwner(this.keypair.publicKey, { mint: mintPubkey })
    if (res.value.length > 0) {
      rawBalance = res.value.reduce(function (sum, acc) {
        return sum + BigInt(acc.account.data.parsed.info.tokenAmount.amount)
      }, BigInt(0)).toString()
    }

    return {
      contractAddress: mintAddress,
      mint: mintAddress,
      symbol: (metadata && metadata.symbol) || 'Unknown',
      name: (metadata && metadata.name) || 'Unknown Token',
      decimals: mintInfo.decimals,
      balance: Number(rawBalance) / Math.pow(10, mintInfo.decimals),
      rawBalance: rawBalance,
      logo: (metadata && metadata.logo) || null
    }
  }

  /**
   * Get token metadata from Jupiter API
   * @param {string} mint - Token mint address
   * @returns {Object} - Token metadata
   */
  async _getTokenMetadata(mint) {
    // 1️⃣ Well-known tokens (USDC etc.)
    if (WELL_KNOWN_TOKENS[mint]) {
      return WELL_KNOWN_TOKENS[mint]
    }

    // 2️⃣ Jupiter token list
    if (TOKEN_METADATA_CACHE.has(mint)) {
      return TOKEN_METADATA_CACHE.get(mint)
    }

    // 3️⃣ On-chain Metaplex metadata
    try {
      var metaplexMeta = await this._fetchMetaplexMetadata(mint)
      if (metaplexMeta) {
        // Cache it for future lookups
        TOKEN_METADATA_CACHE.set(mint, metaplexMeta)
        return metaplexMeta
      }
    } catch (e) {
      console.log('[TokenMeta] Metaplex fetch failed for ' + mint + ': ' + e.message)
    }

    // 4️⃣ On-chain fallback (decimals only)
    try {
      const mintInfo = await getMint(this.connection, new PublicKey(mint))
      return {
        symbol: 'Unknown',
        name: 'Unknown Token',
        decimals: mintInfo.decimals,
        logo: null
      }
    } catch {
      return null
    }
  }

  /**
   * Fetch Metaplex Token Metadata from on-chain account
   * @param {string} mint - Token mint address
   * @returns {Object|null} - { name, symbol, logo, decimals } or null
   */
  async _fetchMetaplexMetadata(mint) {
    var METADATA_PROGRAM_ID = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s')
    var mintPubkey = new PublicKey(mint)

    // Derive metadata PDA
    var [metadataPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from('metadata'), METADATA_PROGRAM_ID.toBuffer(), mintPubkey.toBuffer()],
      METADATA_PROGRAM_ID
    )

    var accountInfo = await this.connection.getAccountInfo(metadataPDA)
    if (!accountInfo || !accountInfo.data) return null

    var data = accountInfo.data

    // Parse Metaplex metadata v1 layout:
    // [0] key (1 byte)
    // [1..32] update authority (32 bytes)
    // [33..64] mint (32 bytes)
    // [65..68] name length (4 bytes LE) then name string
    // then symbol length (4 bytes LE) then symbol string
    // then uri length (4 bytes LE) then uri string
    var offset = 1 + 32 + 32 // skip key + update_authority + mint = 65

    // Read name
    var nameLen = data.readUInt32LE(offset)
    offset += 4
    var name = data.slice(offset, offset + nameLen).toString('utf8').replace(/\0/g, '').trim()
    offset += nameLen

    // Read symbol
    var symbolLen = data.readUInt32LE(offset)
    offset += 4
    var symbol = data.slice(offset, offset + symbolLen).toString('utf8').replace(/\0/g, '').trim()
    offset += symbolLen

    // Read URI
    var uriLen = data.readUInt32LE(offset)
    offset += 4
    var uri = data.slice(offset, offset + uriLen).toString('utf8').replace(/\0/g, '').trim()

    if (!name && !symbol) return null

    // Try to fetch logo from metadata URI
    var logo = null
    if (uri && (uri.startsWith('http://') || uri.startsWith('https://'))) {
      try {
        var resp = await net.fetch(uri, { signal: AbortSignal.timeout(5000) })
        if (resp.ok) {
          var json = await resp.json()
          logo = json.image || json.logo || null
        }
      } catch (e) {
        // URI fetch failed, continue without logo
      }
    }

    // Get decimals from mint
    var decimals = 9
    try {
      var mintInfo = await getMint(this.connection, mintPubkey)
      decimals = mintInfo.decimals
    } catch (e) {}

    return { name: name, symbol: symbol, logo: logo, decimals: decimals }
  }

  /**
   * Send SOL to a recipient
   * @param {string} recipientAddress - Recipient's public key
   * @param {number} amountSOL - Amount in SOL
   * @returns {string} - Transaction signature
   */
  async sendSOL(recipientAddress, amountSOL) {
    if (!this.keypair || !this.connection) {
      throw new Error('Wallet not initialized')
    }

    const recipientPubkey = new PublicKey(recipientAddress)

    // 1. Get balance
    const balanceLamports = await this.connection.getBalance(this.keypair.publicKey)

    // 2. Get blockhash
    const { blockhash, lastValidBlockHeight } =
      await this.connection.getLatestBlockhash('confirmed')

    // 3. Build a dummy tx to estimate fee
    const feeTx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: this.keypair.publicKey,
        toPubkey: recipientPubkey,
        lamports: 1
      })
    )
    feeTx.recentBlockhash = blockhash
    feeTx.feePayer = this.keypair.publicKey

    const feeResp = await this.connection.getFeeForMessage(
      feeTx.compileMessage(),
      'confirmed'
    )

    const feeLamports = feeResp.value ?? 5000

    // 4. Convert requested SOL → lamports (SAFE rounding)
    let requestedLamports = Math.round(amountSOL * LAMPORTS_PER_SOL)

    // 5. HARD SAFETY CHECK
    const maxSendable = balanceLamports - feeLamports

    if (maxSendable <= 0) {
      throw new Error('Insufficient balance for fee')
    }

    // Clamp amount if user tries to send too much
    if (requestedLamports > maxSendable) {
      requestedLamports = maxSendable
    }

    // 6. Final transaction
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: this.keypair.publicKey,
        toPubkey: recipientPubkey,
        lamports: requestedLamports
      })
    )

    tx.recentBlockhash = blockhash
    tx.feePayer = this.keypair.publicKey
    tx.sign(this.keypair)

    const signature = await this.connection.sendRawTransaction(
      tx.serialize(),
      { skipPreflight: false, preflightCommitment: 'confirmed' }
    )

    await this.connection.confirmTransaction(
      { signature, blockhash, lastValidBlockHeight },
      'confirmed'
    )

    return signature
  }


  /**
   * Send SPL token to a recipient
   * @param {string} mintAddress - Token mint address
   * @param {string} recipientAddress - Recipient's public key
   * @param {number} amount - Amount in token units (not raw)
   * @param {number} decimals - Token decimals
   * @returns {string} - Transaction signature
   */
  async sendToken(mintAddress, recipientAddress, amount, decimals) {
    if (!this.keypair || !this.connection) {
      throw new Error('Wallet not initialized')
    }

    const mintPubkey = new PublicKey(mintAddress)
    const recipientPubkey = new PublicKey(recipientAddress)

    // 🔍 Detect token program (classic vs Token-2022)
    const mintInfo = await this.connection.getAccountInfo(mintPubkey)
    if (!mintInfo) throw new Error('Mint not found')

    const tokenProgramId = mintInfo.owner.equals(TOKEN_2022_PROGRAM_ID)
      ? TOKEN_2022_PROGRAM_ID
      : TOKEN_PROGRAM_ID

    const rawAmount = BigInt(Math.floor(amount * Math.pow(10, decimals)))

    // ✅ Get ATAs using correct program
    const sourceATA = await getAssociatedTokenAddress(
      mintPubkey,
      this.keypair.publicKey,
      false,
      tokenProgramId
    )

    const destinationATA = await getAssociatedTokenAddress(
      mintPubkey,
      recipientPubkey,
      false,
      tokenProgramId
    )

    const tx = new Transaction()

    // 🧠 Create destination ATA if missing
    try {
      await getAccount(this.connection, destinationATA, 'confirmed', tokenProgramId)
    } catch {
      tx.add(
        createAssociatedTokenAccountInstruction(
          this.keypair.publicKey,     // payer
          destinationATA,             // ATA
          recipientPubkey,            // owner
          mintPubkey,                 // mint
          tokenProgramId
        )
      )
    }

    // 🔁 Transfer using correct program
    tx.add(
      createTransferInstruction(
        sourceATA,
        destinationATA,
        this.keypair.publicKey,
        rawAmount,
        [],
        tokenProgramId
      )
    )

    const { blockhash, lastValidBlockHeight } =
      await this.connection.getLatestBlockhash('confirmed')

    tx.recentBlockhash = blockhash
    tx.feePayer = this.keypair.publicKey
    tx.sign(this.keypair)

    const sig = await this.connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: false,
      preflightCommitment: 'confirmed'
    })

    await this.connection.confirmTransaction(
      { signature: sig, blockhash, lastValidBlockHeight },
      'confirmed'
    )

    return sig
  }


  /**
   * Estimate transaction fee for SOL transfer
   * @returns {number} - Estimated fee in SOL
   */
  async estimateFee() {
    if (!this.connection) {
      throw new Error('Connection not initialized')
    }

    try {
      // Get recent blockhash and fee calculator
      const { feeCalculator } = await this.connection.getRecentBlockhash('confirmed')
      // A simple transfer is about 1 signature, so fee is lamportsPerSignature
      const feeInLamports = feeCalculator?.lamportsPerSignature || 5000 // Default 5000 lamports
      return feeInLamports / LAMPORTS_PER_SOL
    } catch (error) {
      // Return a default fee estimate
      return 0.000005 // 5000 lamports default
    }
  }

  /**
   * Validate a Solana address
   * @param {string} address - Address to validate
   * @returns {boolean} - Whether the address is valid
   */
  isValidAddress(address) {
    try {
      new PublicKey(address)
      return true
    } catch (e) {
      return false
    }
  }

  /**
   * Deploy a new SPL token on Devnet
   * Creates mint, ATA, mints initial supply, optionally revokes authorities
   * @param {object} params
   * @param {string} params.name - Token name (max 32 chars)
   * @param {string} params.symbol - Token symbol (max 10 chars)
   * @param {string} [params.description] - Token description
   * @param {number} [params.decimals=9] - Token decimals
   * @param {string|number} params.initialSupply - Initial supply in human units
   * @param {boolean} [params.revokeAuthorities=true] - Revoke mint + freeze authority
   * @param {number} [params.maxSolSpend=0.5] - Max SOL to spend on fees/rent
   * @returns {object} - { mint, ata, signatures, explorerLinks }
   */
  async deployToken(params) {
    if (!this.keypair || !this.connection) {
      throw new Error('Wallet not initialized')
    }

    var name = (params.name || '').trim()
    var symbol = (params.symbol || '').trim()
    var decimals = typeof params.decimals === 'number' ? params.decimals : 9
    var supplyStr = String(params.initialSupply || '0')
    var description = (params.description || '').trim()
    var logoUrl = (params.logoUrl || '').trim()
    var socials = params.socials || {}
    var maxSolSpend = typeof params.maxSolSpend === 'number' ? params.maxSolSpend : 0.5

    // Security options
    var revokeMintAuthority = params.revokeMintAuthority !== false
    var revokeFreezeAuthority = params.revokeFreezeAuthority !== false
    var makeMetadataImmutable = params.makeMetadataImmutable !== false

    // Validate inputs
    if (!name || name.length > 32) {
      throw new Error('Token name is required and must be 32 characters or fewer')
    }
    if (!symbol || symbol.length > 10) {
      throw new Error('Token symbol is required and must be 10 characters or fewer')
    }
    if (decimals < 0 || decimals > 18) {
      throw new Error('Decimals must be between 0 and 18')
    }

    // Convert supply to base units using BigInt (no floating point)
    var supplyBaseUnits = toBaseUnitsBigInt(supplyStr, decimals)
    if (supplyBaseUnits <= BigInt(0)) {
      throw new Error('Initial supply must be greater than 0')
    }
    var U64_MAX = BigInt('18446744073709551615')
    if (supplyBaseUnits > U64_MAX) {
      throw new Error('Supply too large: ' + supplyStr + ' with ' + decimals + ' decimals exceeds the maximum allowed (u64 overflow). Try a smaller supply or fewer decimals.')
    }

    // Upload metadata (image to ImgBB + JSON to JsonBlob) and get permanent URLs
    console.log('[DeployToken] Uploading token metadata...')
    var metaUpload = await uploadTokenMetadata({
      name: name,
      symbol: symbol,
      description: description,
      logoUrl: logoUrl,
      socials: socials
    })
    var metadataUri = metaUpload.metadataUrl
    console.log('[DeployToken] Metadata URI: ' + metadataUri)

    // Use the current network connection (mainnet or devnet based on wallet settings)
    var activeConnection = this.connection

    // Check balance
    var balanceLamports = await activeConnection.getBalance(this.keypair.publicKey)
    var balanceSOL = balanceLamports / LAMPORTS_PER_SOL
    console.log('[DeployToken] Wallet balance: ' + balanceSOL + ' SOL (' + this.network + ')')

    // Estimate costs: mint account rent + ATA rent + metadata rent + tx fees
    var mintRent = await activeConnection.getMinimumBalanceForRentExemption(MINT_SIZE)
    var ataRent = await activeConnection.getMinimumBalanceForRentExemption(165)
    // Metadata account is ~679 bytes (varies with name/symbol/uri length)
    var metadataRent = await activeConnection.getMinimumBalanceForRentExemption(679)
    var estimatedFees = 20000 // ~4 signatures
    var totalCostLamports = mintRent + ataRent + metadataRent + estimatedFees
    var totalCostSOL = totalCostLamports / LAMPORTS_PER_SOL

    console.log('[DeployToken] Estimated cost: ' + totalCostSOL + ' SOL (includes metadata)')

    if (totalCostSOL > maxSolSpend) {
      throw new Error(
        'Estimated cost (' + totalCostSOL.toFixed(6) + ' SOL) exceeds max spend limit (' +
        maxSolSpend + ' SOL). Increase maxSolSpend or reduce operations.'
      )
    }

    if (balanceLamports < totalCostLamports) {
      var insufficientMsg = this.network === 'devnet'
        ? ' SOL. Use "airdrop devnet SOL" to get more.'
        : ' SOL. Please fund your wallet with real SOL on mainnet.'
      throw new Error(
        'Insufficient SOL. Need ~' + totalCostSOL.toFixed(6) +
        ' SOL but have ' + balanceSOL.toFixed(6) + insufficientMsg
      )
    }

    var signatures = []

    // Generate mint keypair
    var mintKeypair = Keypair.generate()
    var mintPubkey = mintKeypair.publicKey

    // Derive metadata PDA
    var TOKEN_METADATA_PROGRAM_ID = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s')
    var [metadataPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from('metadata'), TOKEN_METADATA_PROGRAM_ID.toBuffer(), mintPubkey.toBuffer()],
      TOKEN_METADATA_PROGRAM_ID
    )

    // Get ATA address
    var ata = await getAssociatedTokenAddress(
      mintPubkey,
      this.keypair.publicKey,
      false,
      TOKEN_PROGRAM_ID
    )

    // Get blockhash
    var { blockhash, lastValidBlockHeight } =
      await activeConnection.getLatestBlockhash('confirmed')

    // Build transaction with all instructions
    var tx = new Transaction()

    // 1. Create mint account
    tx.add(
      SystemProgram.createAccount({
        fromPubkey: this.keypair.publicKey,
        newAccountPubkey: mintPubkey,
        space: MINT_SIZE,
        lamports: mintRent,
        programId: TOKEN_PROGRAM_ID
      })
    )

    // 2. Initialize mint (freeze authority based on user choice)
    tx.add(
      createInitializeMint2Instruction(
        mintPubkey,
        decimals,
        this.keypair.publicKey, // mint authority
        revokeFreezeAuthority ? null : this.keypair.publicKey, // freeze authority
        TOKEN_PROGRAM_ID
      )
    )

    // 3. Create Metaplex metadata account (CreateMetadataAccountV3)
    var metadataData = serializeCreateMetadataV3({
      name: name,
      symbol: symbol,
      uri: metadataUri,
      sellerFeeBasisPoints: 0,
      creators: null,
      collection: null,
      uses: null,
      isMutable: !makeMetadataImmutable,
      collectionDetails: null
    })

    var TransactionInstruction = require('@solana/web3.js').TransactionInstruction
    tx.add(new TransactionInstruction({
      programId: TOKEN_METADATA_PROGRAM_ID,
      keys: [
        { pubkey: metadataPDA, isSigner: false, isWritable: true },
        { pubkey: mintPubkey, isSigner: false, isWritable: false },
        { pubkey: this.keypair.publicKey, isSigner: true, isWritable: false }, // mint authority
        { pubkey: this.keypair.publicKey, isSigner: true, isWritable: true },  // payer
        { pubkey: this.keypair.publicKey, isSigner: false, isWritable: false }, // update authority
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
      ],
      data: metadataData
    }))

    // 4. Create ATA
    tx.add(
      createAssociatedTokenAccountInstruction(
        this.keypair.publicKey, // payer
        ata,                    // ATA address
        this.keypair.publicKey, // owner
        mintPubkey,             // mint
        TOKEN_PROGRAM_ID
      )
    )

    // 5. Mint supply to ATA
    tx.add(
      createMintToInstruction(
        mintPubkey,             // mint
        ata,                    // destination
        this.keypair.publicKey, // authority
        supplyBaseUnits,        // amount in base units
        [],                     // multi-signers
        TOKEN_PROGRAM_ID
      )
    )

    // 6. Revoke mint authority if requested
    if (revokeMintAuthority) {
      tx.add(
        createSetAuthorityInstruction(
          mintPubkey,
          this.keypair.publicKey,
          AuthorityType.MintTokens,
          null,
          [],
          TOKEN_PROGRAM_ID
        )
      )
    }

    tx.recentBlockhash = blockhash
    tx.feePayer = this.keypair.publicKey

    // Sign with both wallet keypair and mint keypair
    tx.sign(this.keypair, mintKeypair)

    // Send transaction
    var sig = await activeConnection.sendRawTransaction(tx.serialize(), {
      skipPreflight: false,
      preflightCommitment: 'confirmed'
    })

    await activeConnection.confirmTransaction(
      { signature: sig, blockhash, lastValidBlockHeight },
      'confirmed'
    )

    signatures.push(sig)

    console.log('[DeployToken] Token deployed with metadata! Mint: ' + mintPubkey.toBase58())
    console.log('[DeployToken] Metadata: ' + metadataPDA.toBase58())
    console.log('[DeployToken] ATA: ' + ata.toBase58())
    console.log('[DeployToken] Signature: ' + sig)

    wmSendTelegramLaunchNotification({
      name: name,
      symbol: symbol,
      initialSupply: supplyStr,
      mint: mintPubkey.toBase58(),
      network: this.network
    })

    return {
      mint: mintPubkey.toBase58(),
      ata: ata.toBase58(),
      metadataAddress: metadataPDA.toBase58(),
      signatures: signatures,
      name: name,
      symbol: symbol,
      decimals: decimals,
      initialSupply: supplyStr,
      revokeMintAuthority: revokeMintAuthority,
      revokeFreezeAuthority: revokeFreezeAuthority,
      makeMetadataImmutable: makeMetadataImmutable,
      logoUrl: logoUrl || null,
      network: this.network,
      explorerLinks: {
        mint: 'https://explorer.solana.com/address/' + mintPubkey.toBase58() + (this.network === 'devnet' ? '?cluster=devnet' : ''),
        metadata: 'https://explorer.solana.com/address/' + metadataPDA.toBase58() + (this.network === 'devnet' ? '?cluster=devnet' : ''),
        ata: 'https://explorer.solana.com/address/' + ata.toBase58() + (this.network === 'devnet' ? '?cluster=devnet' : ''),
        tx: 'https://explorer.solana.com/tx/' + sig + (this.network === 'devnet' ? '?cluster=devnet' : '')
      }
    }
  }

  /**
   * Deploy token AND create Raydium CPMM pool with liquidity
   * @param {object} params - Same as deployToken plus:
   * @param {number} params.liquiditySol - SOL to add as liquidity
   * @param {number} params.lpPercent - Percent of supply to allocate to LP (1-100)
   * @returns {object} - Combined deploy + pool result
   */
  async deployTokenWithLiquidity(params) {
    if (!this.keypair || !this.connection) {
      throw new Error('Wallet not initialized')
    }

    var liquiditySol = params.liquiditySol
    var lpPercent = params.lpPercent || 20

    if (!liquiditySol || liquiditySol <= 0) {
      throw new Error('liquiditySol must be greater than 0')
    }
    if (lpPercent < 1 || lpPercent > 100) {
      throw new Error('lpPercent must be between 1 and 100')
    }

    var decimals = typeof params.decimals === 'number' ? params.decimals : 9
    var supplyStr = String(params.initialSupply || '0')
    var revokeMintAuthority = params.revokeMintAuthority !== false
    var revokeFreezeAuthority = params.revokeFreezeAuthority !== false

    // Use the current network connection
    var activeConnection = this.connection

    // Calculate LP token amount in base units
    var totalSupplyBase = toBaseUnitsBigInt(supplyStr, decimals)
    var tokensForLP = totalSupplyBase * BigInt(lpPercent) / BigInt(100)
    var solLamports = BigInt(Math.round(liquiditySol * LAMPORTS_PER_SOL))

    // Validate u64 range — Solana token amounts must fit in u64
    var U64_MAX = BigInt('18446744073709551615')
    if (totalSupplyBase > U64_MAX) {
      throw new Error('Supply too large: ' + supplyStr + ' with ' + decimals + ' decimals exceeds the maximum allowed (u64 overflow). Try a smaller supply or fewer decimals.')
    }
    if (tokensForLP > U64_MAX) {
      throw new Error('LP token amount too large: ' + lpPercent + '% of supply exceeds the maximum allowed (u64 overflow). Try a smaller supply or fewer decimals.')
    }

    console.log('[DeployWithLP] Total supply: ' + totalSupplyBase.toString())
    console.log('[DeployWithLP] Tokens for LP (' + lpPercent + '%): ' + tokensForLP.toString())
    console.log('[DeployWithLP] SOL for LP: ' + liquiditySol + ' SOL')

    // Check balance — need enough for deploy + pool creation + liquidity
    var balanceLamports = await activeConnection.getBalance(this.keypair.publicKey)
    var balanceSOL = balanceLamports / LAMPORTS_PER_SOL

    // Estimate total cost: deploy (~0.003) + pool creation (~0.15-1.0) + liquidity SOL
    var deployCost = 3000000 // ~0.003 SOL for mint + ATA
    var poolCost = 200000000 // ~0.2 SOL pool creation fee (conservative)
    var txFees = 30000 // transaction fees
    var totalNeeded = deployCost + poolCost + txFees + Number(solLamports)
    var totalNeededSOL = totalNeeded / LAMPORTS_PER_SOL

    var maxSolSpend = typeof params.maxSolSpend === 'number' ? params.maxSolSpend : (liquiditySol + 1.5)

    if (totalNeededSOL > maxSolSpend) {
      throw new Error(
        'Estimated cost (~' + totalNeededSOL.toFixed(4) +
        ' SOL) exceeds max spend (' + maxSolSpend +
        ' SOL). Increase maxSolSpend.'
      )
    }

    if (balanceLamports < totalNeeded) {
      var insufficientMsg = this.network === 'devnet'
        ? ' SOL. Airdrop more devnet SOL first.'
        : ' SOL. Please fund your wallet with real SOL on mainnet.'
      throw new Error(
        'Insufficient SOL. Need ~' + totalNeededSOL.toFixed(4) +
        ' SOL but have ' + balanceSOL.toFixed(4) + insufficientMsg
      )
    }

    // Step 1: Deploy the token (must NOT revoke mint authority yet — need to create pool first)
    // We mint full supply to creator, then the pool takes tokens from creator's ATA
    var deployParams = {
      name: params.name,
      symbol: params.symbol,
      description: params.description,
      decimals: decimals,
      initialSupply: supplyStr,
      revokeMintAuthority: false, // Don't revoke yet — need to create pool first
      revokeFreezeAuthority: revokeFreezeAuthority,
      makeMetadataImmutable: params.makeMetadataImmutable !== false,
      logoUrl: params.logoUrl || '',
      socials: params.socials || {},
      maxSolSpend: maxSolSpend
    }

    console.log('[DeployWithLP] Step 1: Deploying token...')
    var deployResult = await this.deployToken(deployParams)
    console.log('[DeployWithLP] Token deployed: ' + deployResult.mint)

    // Step 2: Create Raydium CPMM pool
    console.log('[DeployWithLP] Step 2: Creating Raydium CPMM pool...')

    // raydiumCpmm is available as a global from the concatenated build
    var poolResult
    try {
      poolResult = await createCpmmPool({
        connection: activeConnection,
        network: this.network,
        payer: this.keypair,
        tokenMint: new PublicKey(deployResult.mint),
        tokenDecimals: decimals,
        tokenAmount: tokensForLP,
        solAmount: solLamports
      })
    } catch (poolErr) {
      // Token was deployed but pool failed — still return token info
      console.error('[DeployWithLP] Pool creation failed: ' + poolErr.message)
      return {
        mint: deployResult.mint,
        ata: deployResult.ata,
        metadataAddress: deployResult.metadataAddress,
        name: params.name,
        symbol: params.symbol,
        decimals: decimals,
        initialSupply: supplyStr,
        revokeMintAuthority: false,
        revokeFreezeAuthority: revokeFreezeAuthority,
        makeMetadataImmutable: params.makeMetadataImmutable !== false,
        network: this.network,
        poolError: poolErr.message,
        signatures: deployResult.signatures,
        explorerLinks: deployResult.explorerLinks,
        message: 'Token deployed but pool creation failed: ' + poolErr.message
      }
    }

    console.log('[DeployWithLP] Pool created: ' + poolResult.poolId)

    // Step 3: Revoke mint authority if requested (after pool creation)
    var revokeSignature = null
    if (revokeMintAuthority) {
      console.log('[DeployWithLP] Step 3: Revoking mint authority...')
      try {
        var mintPubkey = new PublicKey(deployResult.mint)
        var revokeTx = new Transaction()
        revokeTx.add(
          createSetAuthorityInstruction(
            mintPubkey,
            this.keypair.publicKey,
            AuthorityType.MintTokens,
            null,
            [],
            TOKEN_PROGRAM_ID
          )
        )
        var { blockhash: revokeBlockhash, lastValidBlockHeight: revokeHeight } =
          await activeConnection.getLatestBlockhash('confirmed')
        revokeTx.recentBlockhash = revokeBlockhash
        revokeTx.feePayer = this.keypair.publicKey
        revokeTx.sign(this.keypair)

        revokeSignature = await activeConnection.sendRawTransaction(revokeTx.serialize(), {
          skipPreflight: false,
          preflightCommitment: 'confirmed'
        })
        await activeConnection.confirmTransaction(
          { signature: revokeSignature, blockhash: revokeBlockhash, lastValidBlockHeight: revokeHeight },
          'confirmed'
        )
        console.log('[DeployWithLP] Mint authority revoked: ' + revokeSignature)
      } catch (revokeErr) {
        console.warn('[DeployWithLP] Failed to revoke authority: ' + revokeErr.message)
      }
    }

    // Combine all signatures
    var allSignatures = deployResult.signatures.concat([poolResult.signature])
    if (revokeSignature) allSignatures.push(revokeSignature)

    wmSendTelegramLaunchNotification({
      name: params.name,
      symbol: params.symbol,
      initialSupply: supplyStr,
      mint: deployResult.mint,
      network: this.network,
      liquiditySol: liquiditySol
    })

    return {
      mint: deployResult.mint,
      ata: deployResult.ata,
      metadataAddress: deployResult.metadataAddress,
      name: params.name,
      symbol: params.symbol,
      decimals: decimals,
      initialSupply: supplyStr,
      revokeMintAuthority: revokeMintAuthority,
      revokeFreezeAuthority: revokeFreezeAuthority,
      makeMetadataImmutable: params.makeMetadataImmutable !== false,
      network: this.network,
      pool: {
        poolId: poolResult.poolId,
        lpMint: poolResult.lpMint,
        tokensInLP: tokensForLP.toString(),
        solInLP: liquiditySol,
        lpPercent: lpPercent
      },
      signatures: allSignatures,
      explorerLinks: {
        mint: deployResult.explorerLinks.mint,
        ata: deployResult.explorerLinks.ata,
        deployTx: deployResult.explorerLinks.tx,
        pool: poolResult.explorerLinks.pool,
        poolTx: poolResult.explorerLinks.tx,
        lpMint: poolResult.explorerLinks.lpMint
      }
    }
  }

  /**
   * Request devnet SOL airdrop
   * @param {number} [amountSOL=1] - Amount of SOL to airdrop (max 2)
   * @returns {object} - { signature, amount }
   */
  async requestAirdrop(amountSOL) {
    if (!this.keypair) {
      throw new Error('Wallet not initialized')
    }

    if (this.network !== 'devnet') {
      throw new Error('Airdrops are only available on devnet. Switch to devnet first, or fund your mainnet wallet by transferring real SOL.')
    }

    var amount = Math.min(amountSOL || 1, 2) // Max 2 SOL per airdrop
    var devnetConnection = new Connection(DEVNET_RPC, 'confirmed')

    var lamports = Math.round(amount * LAMPORTS_PER_SOL)
    var sig = await devnetConnection.requestAirdrop(this.keypair.publicKey, lamports)

    await devnetConnection.confirmTransaction(sig, 'confirmed')

    console.log('[Airdrop] ' + amount + ' SOL airdropped. Sig: ' + sig)

    return {
      signature: sig,
      amount: amount,
      address: this.keypair.publicKey.toBase58()
    }
  }

  /**
   * Burn the current wallet and generate a new one
   * @returns {object} - { publicKey, network }
   */
  async burnAndRegenerate() {
    this.destroy()
    var result = await this.initialize()
    console.log('[WalletManager] Wallet burned and regenerated. New address: ' + result.publicKey)
    return result
  }

  /**
   * Destroy the wallet - called on browser close
   */
  destroy() {
    // Stop balance subscription
    this._stopBalanceSubscription()
    this.balanceCallbacks.clear()

    // Clear sensitive data
    if (this.keypair) {
      // Zero out the secret key
      this.keypair.secretKey.fill(0)
      this.keypair = null
    }
    this.connection = null
    this.pendingTransactions.clear()
    this.lastKnownBalance = null

    // console.log('[WalletManager] Wallet destroyed')
  }
}

// Singleton instance
const walletManager = new WalletManager()

// walletManager is available globally in the concatenated bundle
