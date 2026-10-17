const pendingApprovals = new Map()

function setupWalletIPC() {
  // console.log('[WalletIPC] Setting up IPC handlers...')

  // Initialize wallet on app start
  ipc.handle('wallet:initialize', async () => {
    try {
      const result = walletManager.initialize()
      return { success: true, data: result }
    } catch (error) {
      return { success: false, error: sanitizeUserError(error.message) }
    }
  })
  // ipc.handle('wallet:initialize', async () => {
  //   try {
  //     const result = walletManager.initialize()
  //     return { success: true, data: result }
  //   } catch (error) {
  //     return { success: false, error: sanitizeUserError(error.message) }
  //   }
  // })

  // Get public key
  ipc.handle('wallet:getPublicKey', async () => {
    try {
      const publicKey = walletManager.getPublicKey()
      return { success: true, data: { publicKey } }
    } catch (error) {
      return { success: false, error: sanitizeUserError(error.message) }
    }
  })

  // Get balance
  ipc.handle('wallet:getBalance', async () => {
    try {
      const balance = await walletManager.getBalance()
      return { success: true, data: balance }
    } catch (error) {
      return { success: false, error: sanitizeUserError(error.message) }
    }
  })

  // Export private key (user action from wallet panel)
  ipc.handle('wallet:exportPrivateKey', async () => {
    try {
      const secretKey = walletManager.getSecretKey()
      const secretKeyBase58 = walletManager.getSecretKeyBase58()
      return {
        success: true,
        data: {
          secretKeyArray: secretKey,      // Phantom-compatible format
          secretKeyBase58: secretKeyBase58 // Base58 format
        }
      }
    } catch (error) {
      return { success: false, error: sanitizeUserError(error.message) }
    }
  })

  // Import wallet from Base58 private key
  ipc.handle('wallet:importWallet', async (event, privateKeyBase58) => {
    try {
      var result = await walletManager.importWallet(privateKeyBase58)
      return { success: true, data: result }
    } catch (error) {
      return { success: false, error: sanitizeUserError(error.message) }
    }
  })

  // Get network
  ipc.handle('wallet:getNetwork', async () => {
    try {
      return { success: true, data: { network: walletManager.network } }
    } catch (error) {
      return { success: false, error: sanitizeUserError(error.message) }
    }
  })

  // Get Helius API key (renderer reads from .env via this IPC — single source of truth)
  ipc.handle('wallet:getHeliusKey', async () => {
    return { success: true, data: { key: process.env.HELIUS_API_KEY || '' } }
  })

  // Switch network
  ipc.handle('wallet:switchNetwork', async (event, network) => {
    try {
      const result = walletManager.switchNetwork(network)
      return { success: true, data: result }
    } catch (error) {
      return { success: false, error: sanitizeUserError(error.message) }
    }
  })

  // Request connection approval from dApp
  ipc.handle('wallet:requestConnect', async (event, { origin, tabId }) => {
    try {
      const requestId = `connect_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

      // Store pending request WITH the sender webContents so we can respond later
      pendingApprovals.set(requestId, {
        type: 'connect',
        origin,
        tabId,
        sender: event.sender, // Store the webview that made the request
        timestamp: Date.now()
      })

      // Send to renderer to show approval UI
      // Use focused window since webview's parent can't be found via fromWebContents
      const win = BaseWindow.getFocusedWindow() || BaseWindow.getAllWindows()[0]
      // console.log('[WalletIPC] Window found:', !!win)
      if (win) {
        // BaseWindow uses contentView property, not getContentView()
        const contentView = win.contentView
        // console.log('[WalletIPC] Content view:', !!contentView)
        // console.log('[WalletIPC] Children count:', contentView?.children?.length)
        if (contentView && contentView.children && contentView.children[0]) {
          const mainView = contentView.children[0]
          mainView.webContents.send('wallet:showConnectApproval', {
            requestId,
            origin,
            tabId,
            publicKey: walletManager.getPublicKey()
          })
          // console.log('[WalletIPC] Sent showConnectApproval to renderer')
        } else {
          console.error('[WalletIPC] Could not find main view')
        }
      } else {
        console.error('[WalletIPC] Could not find window')
      }

      return { success: true, data: { requestId } }
    } catch (error) {
      return { success: false, error: sanitizeUserError(error.message) }
    }
  })

  // User approves connection
  ipc.handle('wallet:approveConnect', async (event, { requestId }) => {
    try {
      const request = pendingApprovals.get(requestId)
      if (!request) {
        return { success: false, error: 'Request not found or expired' }
      }

      const publicKey = walletManager.getPublicKey()

      // Send approval back to the webview that requested it
      if (request.sender && !request.sender.isDestroyed()) {
        request.sender.send('wallet:connectApproved', {
          requestId,
          publicKey
        })
      }

      pendingApprovals.delete(requestId)

      return {
        success: true,
        data: {
          publicKey
        }
      }
    } catch (error) {
      return { success: false, error: sanitizeUserError(error.message) }
    }
  })

  // User rejects connection
  ipc.handle('wallet:rejectConnect', async (event, { requestId }) => {
    try {
      const request = pendingApprovals.get(requestId)

      // Send rejection back to the webview that requested it
      if (request && request.sender && !request.sender.isDestroyed()) {
        request.sender.send('wallet:connectRejected', {
          requestId
        })
      }

      pendingApprovals.delete(requestId)
      return { success: true }
    } catch (error) {
      return { success: false, error: sanitizeUserError(error.message) }
    }
  })

  // Request transaction signing approval
  ipc.handle('wallet:requestSignTransaction', async (event, { transaction, origin, tabId }) => {
    try {
      const requestId = `sign_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

      // Decode transaction for display
      const decoded = walletManager.decodeTransaction(transaction)

      // Store pending request WITH sender
      pendingApprovals.set(requestId, {
        type: 'signTransaction',
        transaction,
        decoded,
        origin,
        tabId,
        sender: event.sender,
        timestamp: Date.now()
      })

      // Send to renderer to show approval UI
      const win = BaseWindow.getFocusedWindow() || BaseWindow.getAllWindows()[0]
      if (win) {
        const contentView = win.contentView
        if (contentView && contentView.children && contentView.children[0]) {
          const mainView = contentView.children[0]
          mainView.webContents.send('wallet:showTransactionApproval', {
            requestId,
            origin,
            tabId,
            decoded
          })
        }
      }

      return { success: true, data: { requestId } }
    } catch (error) {
      return { success: false, error: sanitizeUserError(error.message) }
    }
  })

  // User approves transaction signing
  ipc.handle('wallet:approveSignTransaction', async (event, { requestId }) => {
    try {
      const request = pendingApprovals.get(requestId)
      if (!request) {
        return { success: false, error: 'Request not found or expired' }
      }

      const signedTransaction = await walletManager.signTransaction(request.transaction)

      // Send approval back to the webview that requested it
      if (request.sender && !request.sender.isDestroyed()) {
        request.sender.send('wallet:transactionApproved', {
          requestId,
          signedTransaction
        })
      }

      pendingApprovals.delete(requestId)

      return {
        success: true,
        data: {
          signedTransaction
        }
      }
    } catch (error) {
      return { success: false, error: sanitizeUserError(error.message) }
    }
  })

  // User rejects transaction
  ipc.handle('wallet:rejectSignTransaction', async (event, { requestId }) => {
    try {
      const request = pendingApprovals.get(requestId)

      // Send rejection back to the webview
      if (request && request.sender && !request.sender.isDestroyed()) {
        request.sender.send('wallet:transactionRejected', {
          requestId
        })
      }

      pendingApprovals.delete(requestId)
      return { success: true }
    } catch (error) {
      return { success: false, error: sanitizeUserError(error.message) }
    }
  })

  // Request signing multiple transactions
  ipc.handle('wallet:requestSignAllTransactions', async (event, { transactions, origin, tabId }) => {
    try {
      const requestId = `signAll_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

      // Decode all transactions
      const decodedTransactions = transactions.map(tx => walletManager.decodeTransaction(tx))

      // Store pending request WITH sender
      pendingApprovals.set(requestId, {
        type: 'signAllTransactions',
        transactions,
        decoded: decodedTransactions,
        origin,
        tabId,
        sender: event.sender,
        timestamp: Date.now()
      })

      // Send to renderer to show approval UI
      const win = BaseWindow.getFocusedWindow() || BaseWindow.getAllWindows()[0]
      if (win) {
        const contentView = win.contentView
        if (contentView && contentView.children && contentView.children[0]) {
          const mainView = contentView.children[0]
          mainView.webContents.send('wallet:showMultiTransactionApproval', {
            requestId,
            origin,
            tabId,
            decoded: decodedTransactions,
            count: transactions.length
          })
        }
      }

      return { success: true, data: { requestId } }
    } catch (error) {
      return { success: false, error: sanitizeUserError(error.message) }
    }
  })

  // User approves all transactions
  ipc.handle('wallet:approveSignAllTransactions', async (event, { requestId }) => {
    try {
      const request = pendingApprovals.get(requestId)
      if (!request) {
        return { success: false, error: 'Request not found or expired' }
      }

      const signedTransactions = await walletManager.signAllTransactions(request.transactions)

      // Send approval back to the webview
      if (request.sender && !request.sender.isDestroyed()) {
        request.sender.send('wallet:allTransactionsApproved', {
          requestId,
          signedTransactions
        })
      }

      pendingApprovals.delete(requestId)

      return {
        success: true,
        data: {
          signedTransactions
        }
      }
    } catch (error) {
      return { success: false, error: sanitizeUserError(error.message) }
    }
  })

  // User rejects all transactions
  ipc.handle('wallet:rejectSignAllTransactions', async (event, { requestId }) => {
    try {
      const request = pendingApprovals.get(requestId)

      // Send rejection back to the webview
      if (request && request.sender && !request.sender.isDestroyed()) {
        request.sender.send('wallet:allTransactionsRejected', {
          requestId
        })
      }

      pendingApprovals.delete(requestId)
      return { success: true }
    } catch (error) {
      return { success: false, error: sanitizeUserError(error.message) }
    }
  })

  // Request message signing
  ipc.handle('wallet:requestSignMessage', async (event, { message, origin, tabId }) => {
    try {
      const requestId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

      // Try to decode message as text
      let messageText
      try {
        messageText = new TextDecoder().decode(new Uint8Array(message))
      } catch {
        messageText = '[Binary data]'
      }

      // Store pending request WITH sender
      pendingApprovals.set(requestId, {
        type: 'signMessage',
        message,
        messageText,
        origin,
        tabId,
        sender: event.sender,
        timestamp: Date.now()
      })

      // Send to renderer to show approval UI
      const win = BaseWindow.getFocusedWindow() || BaseWindow.getAllWindows()[0]
      if (win) {
        const contentView = win.contentView
        if (contentView && contentView.children && contentView.children[0]) {
          const mainView = contentView.children[0]
          mainView.webContents.send('wallet:showMessageApproval', {
            requestId,
            origin,
            tabId,
            messageText
          })
        }
      }

      return { success: true, data: { requestId } }
    } catch (error) {
      return { success: false, error: sanitizeUserError(error.message) }
    }
  })

  // User approves message signing
  ipc.handle('wallet:approveSignMessage', async (event, { requestId }) => {
    try {
      const request = pendingApprovals.get(requestId)
      if (!request) {
        return { success: false, error: 'Request not found or expired' }
      }

      const signature = await walletManager.signMessage(request.message)

      // Send approval back to the webview
      if (request.sender && !request.sender.isDestroyed()) {
        request.sender.send('wallet:messageApproved', {
          requestId,
          signature
        })
      }

      pendingApprovals.delete(requestId)

      return {
        success: true,
        data: {
          signature
        }
      }
    } catch (error) {
      return { success: false, error: sanitizeUserError(error.message) }
    }
  })

  // User rejects message signing
  ipc.handle('wallet:rejectSignMessage', async (event, { requestId }) => {
    try {
      const request = pendingApprovals.get(requestId)

      // Send rejection back to the webview
      if (request && request.sender && !request.sender.isDestroyed()) {
        request.sender.send('wallet:messageRejected', {
          requestId
        })
      }

      pendingApprovals.delete(requestId)
      return { success: true }
    } catch (error) {
      return { success: false, error: sanitizeUserError(error.message) }
    }
  })

  // Direct sign transaction (from wallet panel, already approved)
  ipc.handle('wallet:signTransaction', async (event, { transaction }) => {
    try {
      const signedTransaction = await walletManager.signTransaction(transaction)
      return { success: true, data: { signedTransaction } }
    } catch (error) {
      return { success: false, error: sanitizeUserError(error.message) }
    }
  })

  // Direct sign message (from wallet panel, already approved)
  ipc.handle('wallet:signMessage', async (event, { message }) => {
    try {
      const signature = await walletManager.signMessage(message)
      return { success: true, data: { signature } }
    } catch (error) {
      return { success: false, error: sanitizeUserError(error.message) }
    }
  })

  // Send transaction
  ipc.handle('wallet:sendTransaction', async (event, { signedTransaction }) => {
    try {
      const signature = await walletManager.sendTransaction(signedTransaction)
      return { success: true, data: { signature } }
    } catch (error) {
      return { success: false, error: sanitizeUserError(error.message) }
    }
  })

  // Decode transaction (for inspection)
  ipc.handle('wallet:decodeTransaction', async (event, { transaction }) => {
    try {
      const decoded = walletManager.decodeTransaction(transaction)
      return { success: true, data: decoded }
    } catch (error) {
      return { success: false, error: sanitizeUserError(error.message) }
    }
  })

  // Subscribe to balance changes - sends updates to renderer
  // Uses both WebSocket subscription AND polling as fallback
  let balancePollingInterval = null
  let lastPolledBalance = null

  ipc.handle('wallet:subscribeBalance', async (event) => {
    try {
      // Set up WebSocket subscription that sends balance updates to renderer
      walletManager.subscribeToBalance((balance) => {
        // Send balance update to the renderer that requested it
        const win = BaseWindow.getFocusedWindow() || BaseWindow.getAllWindows()[0]
        if (win) {
          const contentView = win.contentView
          if (contentView && contentView.children && contentView.children[0]) {
            const mainView = contentView.children[0]
            mainView.webContents.send('wallet:balanceChanged', balance)
            lastPolledBalance = balance.lamports
          }
        }
      })

      // Also start polling as fallback (WebSocket only works for existing accounts)
      // Poll every 5 seconds
      if (balancePollingInterval) {
        clearInterval(balancePollingInterval)
      }

      var pollErrorCount = 0
      var pollBackoff = 5000

      balancePollingInterval = setInterval(async () => {
        // Exponential backoff: skip polls if we've had consecutive errors
        if (pollErrorCount > 0) {
          pollBackoff = Math.min(5000 * Math.pow(2, pollErrorCount), 120000) // Max 2 min
        }
        try {
          const balance = await walletManager.getBalance()
          pollErrorCount = 0 // Reset on success
          pollBackoff = 5000
          // Only send update if balance actually changed
          if (lastPolledBalance !== balance.lamports) {
            lastPolledBalance = balance.lamports
            const win = BaseWindow.getFocusedWindow() || BaseWindow.getAllWindows()[0]
            if (win) {
              const contentView = win.contentView
              if (contentView && contentView.children && contentView.children[0]) {
                const mainView = contentView.children[0]
                mainView.webContents.send('wallet:balanceChanged', balance)
              }
            }
          }
        } catch (error) {
          pollErrorCount++
          if (pollErrorCount === 1) {
            console.log('[WalletIPC] Balance poll failed, backing off (error: ' + (error.message || '').substring(0, 80) + ')')
          }
          // After 3 consecutive failures, stop polling and retry with longer interval
          if (pollErrorCount >= 3 && balancePollingInterval) {
            clearInterval(balancePollingInterval)
            balancePollingInterval = setInterval(async () => {
              try {
                const balance = await walletManager.getBalance()
                pollErrorCount = 0
                console.log('[WalletIPC] Balance poll recovered, balance: ' + balance.sol + ' SOL')
                // Restore normal polling
                if (balancePollingInterval) clearInterval(balancePollingInterval)
                balancePollingInterval = null // Will be restarted on next subscribeBalance call
                const win = BaseWindow.getFocusedWindow() || BaseWindow.getAllWindows()[0]
                if (win) {
                  const contentView = win.contentView
                  if (contentView && contentView.children && contentView.children[0]) {
                    contentView.children[0].webContents.send('wallet:balanceChanged', balance)
                  }
                }
              } catch (e) {
                // Still failing, stay in slow poll mode
              }
            }, 60000) // Retry every 60 seconds when in error state
          }
        }
      }, 5000) // Poll every 5 seconds

      // console.log('[WalletIPC] Balance subscription + polling started')
      return { success: true }
    } catch (error) {
      return { success: false, error: sanitizeUserError(error.message) }
    }
  })

  // Get last known balance (synchronous, from cache)
  ipc.handle('wallet:getLastKnownBalance', async () => {
    try {
      const balance = walletManager.lastKnownBalance
      return { success: true, data: balance }
    } catch (error) {
      return { success: false, error: sanitizeUserError(error.message) }
    }
  })

  // Get all token accounts and balances
  ipc.handle('wallet:getTokens', async () => {
    try {
      const tokens = await walletManager.getTokenAccounts()
      return { success: true, data: tokens }
    } catch (error) {
      return { success: false, error: sanitizeUserError(error.message) }
    }
  })

  // Look up a single token by mint (Add Token modal)
  ipc.handle('wallet:lookupToken', async (event, { contractAddress }) => {
    try {
      if (!walletManager.isValidAddress(contractAddress)) {
        return { success: false, error: 'Invalid mint address.' }
      }
      const token = await walletManager.lookupToken(contractAddress)
      return { success: true, data: token }
    } catch (error) {
      return { success: false, error: sanitizeUserError(error.message) }
    }
  })

  // Send SOL to recipient
  ipc.handle('wallet:sendSOL', async (event, { recipient, amount }) => {
    try {
      // Validate address
      if (!walletManager.isValidAddress(recipient)) {
        return { success: false, error: 'Invalid recipient address' }
      }

      const signature = await walletManager.sendSOL(recipient, amount)
      return { success: true, data: { signature } }
    } catch (error) {
      return { success: false, error: sanitizeUserError(error.message) }
    }
  })

  // Send SPL token to recipient
  ipc.handle('wallet:sendToken', async (event, { mint, recipient, amount, decimals }) => {
    try {
      // Validate address
      if (!walletManager.isValidAddress(recipient)) {
        return { success: false, error: 'Invalid recipient address' }
      }

      const signature = await walletManager.sendToken(mint, recipient, amount, decimals)
      return { success: true, data: { signature } }
    } catch (error) {
      return { success: false, error: sanitizeUserError(error.message) }
    }
  })

  // Validate Solana address
  ipc.handle('wallet:validateAddress', async (event, { address }) => {
    try {
      const isValid = walletManager.isValidAddress(address)
      return { success: true, data: { isValid } }
    } catch (error) {
      return { success: false, error: sanitizeUserError(error.message) }
    }
  })

  // Estimate transaction fee
  ipc.handle('wallet:estimateFee', async () => {
    try {
      const fee = await walletManager.estimateFee()
      return { success: true, data: { fee } }
    } catch (error) {
      return { success: false, error: sanitizeUserError(error.message) }
    }
  })

  // Deploy token on devnet
  ipc.handle('wallet:deployToken', async (event, params) => {
    try {
      var result = await walletManager.deployToken(params)
      return { success: true, data: result }
    } catch (error) {
      return { success: false, error: sanitizeUserError(error.message) }
    }
  })

  // Deploy token with Raydium CPMM liquidity pool on devnet
  ipc.handle('wallet:deployTokenWithLiquidity', async (event, params) => {
    try {
      var result = await walletManager.deployTokenWithLiquidity(params)
      return { success: true, data: result }
    } catch (error) {
      return { success: false, error: sanitizeUserError(error.message) }
    }
  })

  // Deploy token on pump.fun
  ipc.handle('wallet:deployPumpfunToken', async (event, params) => {
    try {
      var result = await deployPumpfunToken(params)
      return { success: true, data: result }
    } catch (error) {
      return { success: false, error: sanitizeUserError(error.message) }
    }
  })

  // Get rich token info: name, symbol, price, market cap, supply, holders, created date
  ipc.handle('wallet:getTokenInfo', async (event, { mintAddress, network }) => {
    try {
      var fetchFn = typeof globalThis.fetch === 'function' ? globalThis.fetch : require('cross-fetch')
      var rpc = network === 'devnet' ? 'https://api.devnet.solana.com' : 'https://api.mainnet-beta.solana.com'
      var info = { mint: mintAddress, network: network }

      // 1. DexScreener — name, symbol, price, marketCap, liquidity, pairCreatedAt, dex
      try {
        var dexRes = await fetchFn('https://api.dexscreener.com/latest/dex/tokens/' + mintAddress)
        if (dexRes.ok) {
          var dexData = await dexRes.json()
          var pair = dexData.pairs && dexData.pairs[0]
          if (pair) {
            info.name = pair.baseToken.name || null
            info.symbol = pair.baseToken.symbol || null
            info.price = pair.priceUsd ? parseFloat(pair.priceUsd) : null
            info.marketCap = pair.marketCap || null
            info.liquidity = pair.liquidity && pair.liquidity.usd ? pair.liquidity.usd : null
            info.dex = pair.dexId || null
            info.createdAt = pair.pairCreatedAt ? new Date(pair.pairCreatedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : null
          }
        }
      } catch (e) {}

      // 2. RPC — total supply
      try {
        var supplyRes = await fetchFn(rpc, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getTokenSupply', params: [mintAddress] })
        })
        if (supplyRes.ok) {
          var supplyData = await supplyRes.json()
          if (supplyData.result && supplyData.result.value) {
            info.totalSupply = supplyData.result.value.uiAmountString || null
            info.decimals = supplyData.result.value.decimals
          }
        }
      } catch (e) {}

      // 3. RPC — holder count approximation via getLargestAccounts
      try {
        var holdersRes = await fetchFn(rpc, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'getTokenLargestAccounts', params: [mintAddress] })
        })
        if (holdersRes.ok) {
          var holdersData = await holdersRes.json()
          if (holdersData.result && holdersData.result.value) {
            info.topHolders = holdersData.result.value.length
          }
        }
      } catch (e) {}

      return { success: true, data: info }
    } catch (error) {
      return { success: false, error: sanitizeUserError(error.message) }
    }
  })

  // Verify a token mint address and detect its DEX
  ipc.handle('wallet:verifyToken', async (event, { mintAddress, network }) => {
    try {
      var result = await tokenBuy.verifyToken(mintAddress, network)
      return { success: true, data: result }
    } catch (error) {
      return { success: false, error: sanitizeUserError(error.message) }
    }
  })

  // Buy a token
  ipc.handle('wallet:buyToken', async (event, { mintAddress, amountSol, network }) => {
    try {
      var keypair = walletManager.getKeypair()
      // Check SOL balance before attempting buy
      var conn = new (require('@solana/web3.js').Connection)(
        network === 'devnet' ? 'https://api.devnet.solana.com' : ('https://mainnet.helius-rpc.com/?api-key=' + BOT_HELIUS_KEY),
        'confirmed'
      )
      var balanceLamports = await conn.getBalance(keypair.publicKey)
      var balanceSol = balanceLamports / 1e9
      var requiredSol = amountSol + 0.001 // small buffer for network tx fees only; our 1% fee is deducted from the amount
      if (balanceSol < requiredSol) {
        return { success: false, error: 'Insufficient SOL balance. Have ' + balanceSol.toFixed(4) + ' SOL, need ' + amountSol.toFixed(4) + ' SOL' }
      }
      var result = await tokenBuy.buyToken(mintAddress, amountSol, network, keypair)
      return { success: true, data: result }
    } catch (error) {
      return { success: false, error: sanitizeUserError(error.message) }
    }
  })

  // Sell a token
  ipc.handle('wallet:sellToken', async (event, { mintAddress, amountTokens, network, usePercent }) => {
    try {
      var keypair = walletManager.getKeypair()
      var result = await tokenBuy.sellToken(mintAddress, amountTokens, network, keypair, usePercent)
      return { success: true, data: result }
    } catch (error) {
      return { success: false, error: sanitizeUserError(error.message) }
    }
  })

  // Request devnet airdrop
  ipc.handle('wallet:requestAirdrop', async (event, { amount }) => {
    try {
      var result = await walletManager.requestAirdrop(amount)
      return { success: true, data: result }
    } catch (error) {
      return { success: false, error: sanitizeUserError(error.message) }
    }
  })

  // Burn wallet and generate a new one
  ipc.handle('wallet:burnAndRegenerate', async () => {
    try {
      var result = await walletManager.burnAndRegenerate()

      // Notify renderer that wallet address changed
      var win = BaseWindow.getFocusedWindow() || BaseWindow.getAllWindows()[0]
      if (win) {
        var contentView = win.contentView
        if (contentView && contentView.children && contentView.children[0]) {
          var mainView = contentView.children[0]
          mainView.webContents.send('wallet:addressChanged', {
            publicKey: result.publicKey,
            network: result.network
          })
          // Also send a zero balance update
          mainView.webContents.send('wallet:balanceChanged', { sol: 0, lamports: 0, usd: 0 })
        }
      }

      return { success: true, data: result }
    } catch (error) {
      return { success: false, error: sanitizeUserError(error.message) }
    }
  })

  // ---- Trading Bot IPC Handlers ----

  var botCopyTradeSubscription = null
  var botCopyConn = null // keep connection alive at module scope

  var BOT_HELIUS_KEY = process.env.HELIUS_API_KEY || ''
  var BOT_HELIUS_HTTP = 'https://mainnet.helius-rpc.com/?api-key=' + BOT_HELIUS_KEY
  var BOT_HELIUS_WS = 'wss://mainnet.helius-rpc.com/?api-key=' + BOT_HELIUS_KEY
  process.env.BOT_RPC_MODE = 'helius'

  ipc.handle('bot:updateRpc', async (event, { rpc }) => {
    try {
      process.env.BOT_RPC_MODE = rpc || 'helius'
      return { success: true }
    } catch (error) {
      return { success: false, error: sanitizeUserError(error.message) }
    }
  })

  // Start copy trade — watch a wallet via WebSocket, mirror buys
  ipc.handle('bot:startCopyTrade', async (event, { walletAddress, copyMode, buyPct, fixedSol, copySells, network }) => {
    try {
      var web3 = require('@solana/web3.js')
      var splToken = require('@solana/spl-token')
      var rpcUrl = network === 'devnet' ? 'https://api.devnet.solana.com' : BOT_HELIUS_HTTP
      var wsUrl = network === 'devnet' ? 'wss://api.devnet.solana.com' : BOT_HELIUS_WS
      // Persist connection at module scope so it isn't GC'd after handler returns
      botCopyConn = new web3.Connection(rpcUrl, { wsEndpoint: wsUrl, commitment: 'confirmed' })
      var conn = botCopyConn
      var watchPubkey = new web3.PublicKey(walletAddress)
      var keypair = walletManager.getKeypair()
      var recentlyCopied = {} // mint -> timestamp, debounce same mint within 30s

      function sendCopyEvent (data) {
        var win = BaseWindow.getFocusedWindow() || BaseWindow.getAllWindows()[0]
        if (win && win.contentView && win.contentView.children[0]) {
          win.contentView.children[0].webContents.send('bot:copyTradeEvent', data)
        }
      }

      // Confirm subscription is live
      sendCopyEvent({ action: 'info', mint: null, reason: 'Subscribed — watching ' + walletAddress.substring(0, 8) + '...' })

      botCopyTradeSubscription = conn.onLogs(watchPubkey, async function (logs) {
        try {
          if (!logs) return
          var sig = logs.signature
          sendCopyEvent({ action: 'info', mint: null, reason: 'Tx detected: ' + sig.substring(0, 12) + '...' + (logs.err ? ' [failed tx, skipping]' : '') })
          if (logs.err) return

          // Fetch full parsed transaction to inspect token balance changes
          var tx = null
          for (var attempt = 0; attempt < 3; attempt++) {
            try {
              tx = await conn.getParsedTransaction(sig, { maxSupportedTransactionVersion: 0, commitment: 'confirmed' })
              if (tx) break
            } catch (e) {}
            await new Promise(function (r) { setTimeout(r, 800) })
          }
          if (!tx || !tx.meta) {
            sendCopyEvent({ action: 'info', mint: null, reason: 'Could not fetch tx ' + sig.substring(0, 12) + '...' })
            return
          }

          var preTokenBals = tx.meta.preTokenBalances || []
          var postTokenBals = tx.meta.postTokenBalances || []

          // Resolve watched wallet's account index for SOL balance tracking
          var watchStr = walletAddress
          var accounts = tx.transaction && tx.transaction.message && tx.transaction.message.accountKeys
          var watchIdx = -1
          if (accounts) {
            accounts.forEach(function (acc, idx) {
              var key = (acc.pubkey && acc.pubkey.toBase58) ? acc.pubkey.toBase58() : String(acc.pubkey || acc)
              if (key === watchStr) watchIdx = idx
            })
          }

          var solPre = watchIdx >= 0 ? (tx.meta.preBalances[watchIdx] || 0) : 0
          var solPost = watchIdx >= 0 ? (tx.meta.postBalances[watchIdx] || 0) : 0
          var solDelta = solPre - solPost

          // Debug: log everything so we can diagnose
          console.log('[CopyTrade] sig=' + sig.substring(0, 16) + ' watchIdx=' + watchIdx + ' solDelta=' + solDelta + ' preTokenBals=' + preTokenBals.length + ' postTokenBals=' + postTokenBals.length)
          console.log('[CopyTrade] postTokenBals owners:', postTokenBals.map(function(p){ return p.owner + '/' + p.mint }))
          sendCopyEvent({ action: 'info', mint: null, reason: 'Parsed: solDelta=' + (solDelta/1e9).toFixed(4) + ' SOL, tokens=' + postTokenBals.length + ', watchIdx=' + watchIdx })

          // Classify token balance changes
          // Note: owner field may be missing on some RPCs — fall back to accountIndex match
          var boughtMints = []
          var soldMints = []

          postTokenBals.forEach(function (post) {
            // Accept if owner matches watched wallet, OR if owner is missing but watchIdx is in accounts
            var ownerMatch = post.owner === watchStr || (!post.owner && watchIdx >= 0)
            if (!ownerMatch) return
            if (!post.mint || post.mint === 'So11111111111111111111111111111111111111112') return
            var postAmt = parseFloat((post.uiTokenAmount && post.uiTokenAmount.uiAmount) || 0)
            var pre = preTokenBals.find(function (p) { return p.accountIndex === post.accountIndex })
            var preAmt = parseFloat((pre && pre.uiTokenAmount && pre.uiTokenAmount.uiAmount) || 0)
            if (postAmt > preAmt) boughtMints.push(post.mint)
          })

          preTokenBals.forEach(function (pre) {
            var ownerMatch = pre.owner === watchStr || (!pre.owner && watchIdx >= 0)
            if (!ownerMatch) return
            if (!pre.mint || pre.mint === 'So11111111111111111111111111111111111111112') return
            var preAmt = parseFloat((pre.uiTokenAmount && pre.uiTokenAmount.uiAmount) || 0)
            if (preAmt <= 0) return
            var post = postTokenBals.find(function (p) { return p.accountIndex === pre.accountIndex })
            var postAmt = parseFloat((post && post.uiTokenAmount && post.uiTokenAmount.uiAmount) || 0)
            if (postAmt < preAmt) soldMints.push(pre.mint)
          })

          console.log('[CopyTrade] boughtMints=' + boughtMints + ' soldMints=' + soldMints)
          sendCopyEvent({ action: 'info', mint: null, reason: 'Bought mints: ' + (boughtMints.length ? boughtMints.map(function(m){return m.substring(0,8)}).join(',') : 'none') })

          // Watched wallet spent SOL → buy
          if (solDelta > 5000 && boughtMints.length > 0) {
            var watchedSpendSol = solDelta / 1e9
            // pct mode: mirror X% of what they spent. fixed mode: always spend fixedSol
            var mirrorSol = (copyMode === 'fixed')
              ? (fixedSol || 0.1)
              : watchedSpendSol * (buyPct / 100)
            if (mirrorSol < 0.001) mirrorSol = 0.001

            for (var i = 0; i < boughtMints.length; i++) {
              var mint = boughtMints[i]
              var now = Date.now()
              if (recentlyCopied[mint + '_buy'] && now - recentlyCopied[mint + '_buy'] < 30000) continue
              recentlyCopied[mint + '_buy'] = now

              var ourBalance = await conn.getBalance(keypair.publicKey)
              if (ourBalance / 1e9 < mirrorSol + 0.001) {
                sendCopyEvent({ action: 'error', mint: mint, reason: 'Insufficient SOL (' + (ourBalance / 1e9).toFixed(4) + ' available, need ' + mirrorSol.toFixed(4) + ')' })
                continue
              }

              sendCopyEvent({ action: 'copying', mint: mint, amountSol: mirrorSol })
              try {
                var buyResult = await tokenBuy.buyToken(mint, mirrorSol, network, keypair)
                sendCopyEvent({ action: 'buy', mint: mint, amountSol: mirrorSol, signature: buyResult.signature, symbol: buyResult.symbol || null })
              } catch (buyErr) {
                sendCopyEvent({ action: 'error', mint: mint, reason: buyErr.message })
              }
            }
          }

          // Watched wallet received SOL → sell (only if copySells enabled)
          if (copySells && solDelta < -5000 && soldMints.length > 0) {
            for (var j = 0; j < soldMints.length; j++) {
              var sellMint = soldMints[j]
              var nowS = Date.now()
              if (recentlyCopied[sellMint + '_sell'] && nowS - recentlyCopied[sellMint + '_sell'] < 30000) continue
              recentlyCopied[sellMint + '_sell'] = nowS

              // Determine sell percentage from how much of pre-balance was sold
              var preSellEntry = preTokenBals.find(function (p) { return p.mint === sellMint && p.owner === watchStr })
              var postSellEntry = postTokenBals.find(function (p) { return p.mint === sellMint && p.owner === watchStr })
              var preAmt2 = parseFloat((preSellEntry && preSellEntry.uiTokenAmount && preSellEntry.uiTokenAmount.uiAmount) || 0)
              var postAmt2 = parseFloat((postSellEntry && postSellEntry.uiTokenAmount && postSellEntry.uiTokenAmount.uiAmount) || 0)
              var sellPct = preAmt2 > 0 ? Math.round(((preAmt2 - postAmt2) / preAmt2) * 100) : 100
              if (sellPct < 1) continue

              sendCopyEvent({ action: 'copying', mint: sellMint, amountSol: 0, extra: 'sell ' + sellPct + '%' })
              try {
                var sellResult = await tokenBuy.sellToken(sellMint, sellPct, network, keypair, true)
                sendCopyEvent({ action: 'sell', mint: sellMint, amountSol: sellResult.outSol || 0, signature: sellResult.signature, symbol: null })
              } catch (sellErr) {
                sendCopyEvent({ action: 'error', mint: sellMint, reason: sellErr.message })
              }
            }
          }
        } catch (e) {
          sendCopyEvent({ action: 'error', mint: null, reason: e.message })
        }
      }, 'confirmed')

      return { success: true }
    } catch (error) {
      return { success: false, error: sanitizeUserError(error.message) }
    }
  })

  // Stop copy trade
  ipc.handle('bot:stopCopyTrade', async () => {
    try {
      if (botCopyTradeSubscription !== null && botCopyConn) {
        try { await botCopyConn.removeOnLogsListener(botCopyTradeSubscription) } catch (e) {}
      }
      botCopyTradeSubscription = null
      botCopyConn = null
      return { success: true }
    } catch (error) {
      return { success: false, error: sanitizeUserError(error.message) }
    }
  })

  // Clean up expired pending approvals periodically
  setInterval(() => {
    const now = Date.now()
    const timeout = 5 * 60 * 1000 // 5 minutes

    for (const [requestId, request] of pendingApprovals.entries()) {
      if (now - request.timestamp > timeout) {
        pendingApprovals.delete(requestId)
        // console.log(`[WalletIPC] Expired pending request: ${requestId}`)
      }
    }
  }, 60 * 1000) // Check every minute

  // console.log('[WalletIPC] IPC handlers ready')
}

function destroyWallet() {
  walletManager.destroy()
  pendingApprovals.clear()
}

// Functions setupWalletIPC and destroyWallet are available globally in the concatenated bundle
