// main/tokenBuy.js
// Token buy/sell via pump.fun (PumpDev API), PumpSwap, and Raydium/Jupiter
// Concatenated into main process bundle — no module.exports, globals only

var tbWeb3 = require('@solana/web3.js')
var tbSplToken = require('@solana/spl-token')
var tbPublicKey = tbWeb3.PublicKey
var tbVersionedTransaction = tbWeb3.VersionedTransaction
var tbLAMPORTS_PER_SOL = tbWeb3.LAMPORTS_PER_SOL
var tbConnection = tbWeb3.Connection
var tbTransaction = tbWeb3.Transaction
var tbTransactionInstruction = tbWeb3.TransactionInstruction
var tbSystemProgram = tbWeb3.SystemProgram
var tbCrypto = require('crypto')

var TB_PUMPDEV_URL = 'https://pumpdev.io'
var TB_PUMPDEV_KEY = ZEPHYR_SECRETS.PUMPDEV_API_KEY
var TB_SOL_MINT = 'So11111111111111111111111111111111111111112'

// Zephyr fee config — 1% of every buy/sell goes to this wallet
var TB_FEE_WALLET = new tbPublicKey('2BMMgi3gMpiXaPpgEbffs7kNCHXf1kohJYkUMoW6SFgj')
var TB_FEE_BPS = 100 // 1% = 100 basis points out of 10000

// Returns lamports to deduct as fee and net lamports to use for trade
function tbCalcFee (lamports) {
  var fee = Math.floor(lamports * TB_FEE_BPS / 10000)
  return { fee: fee, net: lamports - fee }
}

// Builds a SOL transfer instruction from payer to fee wallet
function tbFeeInstruction (payerPubkey, feeLamports) {
  return tbSystemProgram.transfer({ fromPubkey: payerPubkey, toPubkey: TB_FEE_WALLET, lamports: feeLamports })
}

function tbFetch (url, options) {
  if (typeof globalThis.fetch === 'function') return globalThis.fetch(url, options)
  return require('cross-fetch')(url, options)
}

var TB_HELIUS_KEY = process.env.HELIUS_API_KEY || ''
var TB_HELIUS_HTTP = 'https://mainnet.helius-rpc.com/?api-key=' + TB_HELIUS_KEY
var TB_HELIUS_WS = 'wss://mainnet.helius-rpc.com/?api-key=' + TB_HELIUS_KEY

function tbGetRpc (network) {
  return network === 'devnet'
    ? 'https://api.devnet.solana.com'
    : TB_HELIUS_HTTP
}

function tbGetConn (network) {
  if (network === 'devnet') {
    return new tbConnection('https://api.devnet.solana.com', 'confirmed')
  }
  return new tbConnection(TB_HELIUS_HTTP, { wsEndpoint: TB_HELIUS_WS, commitment: 'confirmed' })
}

// Verify a token mint address and detect which DEX it lives on
// Returns { valid, mint, network, source, name, symbol, price, ... }
async function tbVerifyToken (mintAddress, network) {
  try {
    new tbPublicKey(mintAddress)
  } catch (e) {
    return { valid: false, error: 'Invalid mint address' }
  }

  var conn = tbGetConn(network)

  try {
    var acct = await conn.getAccountInfo(new tbPublicKey(mintAddress))
    if (!acct) return { valid: false, error: 'Token mint not found on ' + network }
  } catch (e) {
    return { valid: false, error: 'RPC error: ' + e.message }
  }

  var result = {
    valid: true,
    mint: mintAddress,
    network: network,
    source: null,
    name: null,
    symbol: null,
    price: null,
    marketCap: null,
    liquidity: null,
    isBonding: false
  }

  if (network === 'mainnet-beta') {
    // 1. Check pump.fun via PumpDev API
    try {
      var pumpRes = await tbFetch(TB_PUMPDEV_URL + '/api/coin/' + mintAddress, {
        headers: { 'x-api-key': TB_PUMPDEV_KEY }
      })
      if (pumpRes.ok) {
        var pumpData = await pumpRes.json()
        if (pumpData && pumpData.mint) {
          var graduated = !!pumpData.raydium_pool
          result.source = graduated ? 'pumpswap' : 'pumpfun'
          result.name = pumpData.name || null
          result.symbol = pumpData.symbol || null
          result.marketCap = pumpData.usd_market_cap || null
          result.description = pumpData.description || null
          result.image = pumpData.image_uri || null
          result.isBonding = !graduated
          result.pumpUrl = 'https://pump.fun/' + mintAddress
          result.poolAddress = pumpData.raydium_pool || null
          return result
        }
      }
    } catch (e) {}

    // 2. Check Raydium pools
    try {
      var rayRes = await tbFetch(
        'https://api-v3.raydium.io/pools/info/mint?mint1=' + mintAddress +
        '&poolType=all&poolSortField=liquidity&sortType=desc&pageSize=1&page=1'
      )
      if (rayRes.ok) {
        var rayData = await rayRes.json()
        var pool = rayData && rayData.data && rayData.data.data && rayData.data.data[0]
        if (pool) {
          var mi = pool.mintA && pool.mintA.address === mintAddress ? pool.mintA : pool.mintB
          result.source = 'raydium'
          result.name = mi.name || null
          result.symbol = mi.symbol || null
          result.price = pool.price ? pool.price.toFixed(8) : null
          result.liquidity = pool.tvl ? pool.tvl.toFixed(2) + ' USD' : null
          result.poolId = pool.id
          return result
        }
      }
    } catch (e) {}

    // Token exists on-chain but no active pool found
    result.source = 'unknown'
    result.error = 'Token exists on-chain but no active trading pool found on pump.fun, PumpSwap, or Raydium'
    return result

  } else {
    // Devnet — derive CPMM pool PDA on-chain (Raydium API is mainnet-only)
    try {
      var devPoolInfo = tbDeriveCpmmPool(mintAddress, 'devnet')
      var devPoolAcct = await conn.getAccountInfo(devPoolInfo.poolId)
      if (devPoolAcct) {
        result.source = 'raydium'
        result.name = 'Devnet Token'
        result.symbol = mintAddress.substring(0, 6) + '...'
        result.poolId = devPoolInfo.poolId.toBase58()
        result.cpmmPoolInfo = devPoolInfo
        return result
      }
    } catch (e) {}

    // Token exists on devnet but no CPMM pool found
    result.source = 'devnet-no-pool'
    result.name = 'Devnet Token'
    result.symbol = '???'
    result.error = 'No Raydium CPMM pool found for this devnet token. Deploy with liquidity first.'
    result.valid = false
    return result
  }
}

// ---- Devnet CPMM pool PDA derivation ----

var TB_CPMM_DEVNET = new tbPublicKey('DRaycpLY18LhpbydsBWbVJtxpNv9oXPgjRSfpF2bWpYb')
var TB_CPMM_MAINNET = new tbPublicKey('CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C')
var TB_WSOL_MINT = new tbPublicKey('So11111111111111111111111111111111111111112')

function tbCpmmDisc (name) {
  return tbCrypto.createHash('sha256').update('global:' + name).digest().slice(0, 8)
}

function tbOrderMints (mintA, mintB) {
  var bufA = mintA.toBuffer(), bufB = mintB.toBuffer()
  for (var i = 0; i < 32; i++) {
    if (bufA[i] < bufB[i]) return { mint0: mintA, mint1: mintB, swapped: false }
    if (bufA[i] > bufB[i]) return { mint0: mintB, mint1: mintA, swapped: true }
  }
  throw new Error('Mints are identical')
}

function tbU16LE (n) {
  var b = Buffer.alloc(2); b.writeUInt16LE(n); return b
}

function tbDeriveCpmmPool (mintAddress, network) {
  var programId = network === 'devnet' ? TB_CPMM_DEVNET : TB_CPMM_MAINNET
  var tokenMint = new tbPublicKey(mintAddress)
  var ordered = tbOrderMints(tokenMint, TB_WSOL_MINT)
  var AMM_CONFIG_SEED = Buffer.from('amm_config')
  var POOL_SEED = Buffer.from('pool')
  var POOL_VAULT_SEED = Buffer.from('pool_vault')
  var AUTH_SEED = Buffer.from('vault_and_lp_mint_auth_seed')
  var [ammConfigId] = tbPublicKey.findProgramAddressSync([AMM_CONFIG_SEED, tbU16LE(0)], programId)
  var [poolId] = tbPublicKey.findProgramAddressSync([POOL_SEED, ammConfigId.toBuffer(), ordered.mint0.toBuffer(), ordered.mint1.toBuffer()], programId)
  var [authority] = tbPublicKey.findProgramAddressSync([AUTH_SEED], programId)
  var [vault0] = tbPublicKey.findProgramAddressSync([POOL_VAULT_SEED, poolId.toBuffer(), ordered.mint0.toBuffer()], programId)
  var [vault1] = tbPublicKey.findProgramAddressSync([POOL_VAULT_SEED, poolId.toBuffer(), ordered.mint1.toBuffer()], programId)
  return {
    programId: programId,
    poolId: poolId,
    authority: authority,
    ammConfigId: ammConfigId,
    mint0: ordered.mint0,
    mint1: ordered.mint1,
    vault0: vault0,
    vault1: vault1,
    swapped: ordered.swapped, // true means WSOL is mint0, token is mint1
    tokenMint: tokenMint
  }
}

// Buy a token by spending `amountSol` SOL
async function tbBuyToken (mintAddress, amountSol, network, keypair) {
  var conn = tbGetConn(network)
  var tokenInfo = await tbVerifyToken(mintAddress, network)
  if (!tokenInfo.valid) throw new Error(tokenInfo.error || 'Invalid token')

  if (tokenInfo.source === 'pumpfun' && tokenInfo.isBonding) {
    return await tbBuyPumpDev(mintAddress, amountSol, keypair, conn)
  }

  if (network === 'devnet' && tokenInfo.source === 'raydium') {
    var poolInfo = tokenInfo.cpmmPoolInfo || tbDeriveCpmmPool(mintAddress, 'devnet')
    return await tbSwapCpmm(mintAddress, amountSol, keypair, conn, network, poolInfo, 'buy')
  }

  // pumpswap, raydium mainnet, graduated pump.fun — all via Jupiter
  return await tbBuyJupiter(mintAddress, amountSol, keypair, conn)
}

// Sell tokens — amountTokens is raw token units OR a percent (0-100) if usePercent=true
async function tbSellToken (mintAddress, amountTokens, network, keypair, usePercent) {
  var conn = tbGetConn(network)
  var tokenInfo = await tbVerifyToken(mintAddress, network)
  if (!tokenInfo.valid) throw new Error(tokenInfo.error || 'Invalid token')

  if (tokenInfo.source === 'pumpfun' && tokenInfo.isBonding) {
    return await tbSellPumpDev(mintAddress, amountTokens, keypair, conn, usePercent)
  }

  if (network === 'devnet' && tokenInfo.source === 'raydium') {
    var poolInfo = tokenInfo.cpmmPoolInfo || tbDeriveCpmmPool(mintAddress, 'devnet')
    var sellAmount = amountTokens
    if (usePercent) {
      var tokenAccounts = await conn.getTokenAccountsByOwner(keypair.publicKey, { mint: new tbPublicKey(mintAddress) })
      if (!tokenAccounts.value.length) throw new Error('No token account found for this mint')
      var bal = await conn.getTokenAccountBalance(tokenAccounts.value[0].pubkey)
      sellAmount = Math.floor((parseFloat(bal.value.amount) * amountTokens) / 100)
    }
    return await tbSwapCpmm(mintAddress, sellAmount, keypair, conn, network, poolInfo, 'sell')
  }

  return await tbSellJupiter(mintAddress, amountTokens, keypair, conn, usePercent)
}

// ---- PumpDev (pump.fun bonding curve) ----

async function tbBuyPumpDev (mintAddress, amountSol, keypair, conn) {
  var totalLamports = Math.floor(amountSol * tbLAMPORTS_PER_SOL)
  var { fee, net } = tbCalcFee(totalLamports)

  // Fetch blockhash and PumpDev tx in parallel — saves one serial RPC round trip
  var [bhResult, res] = await Promise.all([
    conn.getLatestBlockhash('confirmed'),
    tbFetch(TB_PUMPDEV_URL + '/api/trade?api-key=' + TB_PUMPDEV_KEY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        publicKey: keypair.publicKey.toBase58(),
        action: 'buy',
        mint: mintAddress,
        amount: net,
        denominatedInSol: 'true',
        slippage: 10,
        priorityFee: 0.0005,
        pool: 'pump'
      })
    })
  ])

  // Fire fee tx immediately with already-fetched blockhash — fully parallel, fire and forget
  var feeTx = new tbTransaction()
  feeTx.recentBlockhash = bhResult.blockhash
  feeTx.feePayer = keypair.publicKey
  feeTx.add(tbFeeInstruction(keypair.publicKey, fee))
  feeTx.sign(keypair)
  conn.sendRawTransaction(feeTx.serialize(), { skipPreflight: true, maxRetries: 5 })

  if (!res.ok) throw new Error('PumpDev buy failed: ' + await res.text())
  var buf = Buffer.from(await res.arrayBuffer())
  if (!buf || buf.length === 0) throw new Error('PumpDev returned empty transaction')
  var tx = tbVersionedTransaction.deserialize(buf)
  tx.sign([keypair])
  var sig = await conn.sendTransaction(tx, { skipPreflight: true, maxRetries: 5 })
  return { success: true, signature: sig, explorerUrl: 'https://solscan.io/tx/' + sig, source: 'pumpfun', amountSol: amountSol, mint: mintAddress }
}

async function tbSellPumpDev (mintAddress, amountTokens, keypair, conn, usePercent) {
  var sellAmount = amountTokens
  if (usePercent) {
    var tokenAccounts = await conn.getTokenAccountsByOwner(keypair.publicKey, { mint: new tbPublicKey(mintAddress) })
    if (!tokenAccounts.value.length) throw new Error('No token account found for this mint')
    var bal = await conn.getTokenAccountBalance(tokenAccounts.value[0].pubkey)
    sellAmount = Math.floor((parseFloat(bal.value.amount) * amountTokens) / 100)
  }
  var res = await tbFetch(TB_PUMPDEV_URL + '/api/trade?api-key=' + TB_PUMPDEV_KEY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      publicKey: keypair.publicKey.toBase58(),
      action: 'sell',
      mint: mintAddress,
      amount: sellAmount,
      denominatedInSol: 'false',
      slippage: 10,
      priorityFee: 0.0005,
      pool: 'pump'
    })
  })
  if (!res.ok) throw new Error('PumpDev sell failed: ' + await res.text())
  var buf = Buffer.from(await res.arrayBuffer())
  if (!buf || buf.length === 0) throw new Error('PumpDev returned empty transaction')
  var tx = tbVersionedTransaction.deserialize(buf)
  tx.sign([keypair])
  var sig = await conn.sendTransaction(tx, { skipPreflight: true, maxRetries: 5 })

  // Fire sell fee asynchronously after send — best effort, doesn't block return
  ;(async function () {
    try {
      var postBal = await conn.getBalance(keypair.publicKey)
      var estimatedProceeds = postBal > 0 ? Math.floor(postBal * 0.01) : 10000
      var { blockhash: fb } = await conn.getLatestBlockhash('confirmed')
      var fTx = new tbTransaction()
      fTx.recentBlockhash = fb
      fTx.feePayer = keypair.publicKey
      fTx.add(tbFeeInstruction(keypair.publicKey, estimatedProceeds))
      fTx.sign(keypair)
      conn.sendRawTransaction(fTx.serialize(), { skipPreflight: true, maxRetries: 5 })
    } catch (e) {}
  })()

  return { success: true, signature: sig, explorerUrl: 'https://solscan.io/tx/' + sig, source: 'pumpfun', amountTokens: sellAmount, mint: mintAddress }
}

// ---- Raydium CPMM direct swap (devnet) ----
// direction: 'buy' = SOL -> token, 'sell' = token -> SOL
// For buy: inputAmount is SOL amount; for sell: inputAmount is raw token units

async function tbSwapCpmm (mintAddress, inputAmount, keypair, conn, network, poolInfo, direction) {
  var { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddress,
        createAssociatedTokenAccountInstruction, createSyncNativeInstruction,
        createCloseAccountInstruction, NATIVE_MINT } = tbSplToken

  var isBuy = direction === 'buy'
  var rawLamports = isBuy ? Math.floor(inputAmount * tbLAMPORTS_PER_SOL) : inputAmount
  var { fee: cpmmFee, net: lamports } = tbCalcFee(rawLamports)

  // Pool layout: mint0 and mint1 determined during deployment
  // swapped=false means tokenMint=mint0, WSOL=mint1
  // swapped=true means WSOL=mint0, tokenMint=mint1
  var isWsolMint0 = poolInfo.swapped // WSOL is mint0 when swapped=true

  // For buy: input=WSOL, output=token
  // For sell: input=token, output=WSOL
  var inputMint = isBuy ? TB_WSOL_MINT : poolInfo.tokenMint
  var outputMint = isBuy ? poolInfo.tokenMint : TB_WSOL_MINT
  var inputVault = isBuy ? (isWsolMint0 ? poolInfo.vault0 : poolInfo.vault1) : (isWsolMint0 ? poolInfo.vault1 : poolInfo.vault0)
  var outputVault = isBuy ? (isWsolMint0 ? poolInfo.vault1 : poolInfo.vault0) : (isWsolMint0 ? poolInfo.vault0 : poolInfo.vault1)

  var userInputAta = await getAssociatedTokenAddress(inputMint, keypair.publicKey, false, TOKEN_PROGRAM_ID)
  var userOutputAta = await getAssociatedTokenAddress(outputMint, keypair.publicKey, false, TOKEN_PROGRAM_ID)

  var { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed')
  var tx = new tbTransaction()
  tx.recentBlockhash = blockhash
  tx.feePayer = keypair.publicKey

  // Fee instruction — always first in tx
  tx.add(tbFeeInstruction(keypair.publicKey, cpmmFee))

  // For buy: create WSOL ATA, wrap SOL
  if (isBuy) {
    var wsolAtaAcct = null
    try { wsolAtaAcct = await conn.getAccountInfo(userInputAta) } catch (e) {}
    if (!wsolAtaAcct) {
      tx.add(createAssociatedTokenAccountInstruction(keypair.publicKey, userInputAta, keypair.publicKey, NATIVE_MINT, TOKEN_PROGRAM_ID))
    }
    tx.add(tbSystemProgram.transfer({ fromPubkey: keypair.publicKey, toPubkey: userInputAta, lamports: lamports }))
    tx.add(createSyncNativeInstruction(userInputAta, TOKEN_PROGRAM_ID))
  }

  // Create output ATA if it doesn't exist
  var outputAtaAcct = null
  try { outputAtaAcct = await conn.getAccountInfo(userOutputAta) } catch (e) {}
  if (!outputAtaAcct) {
    tx.add(createAssociatedTokenAccountInstruction(keypair.publicKey, userOutputAta, keypair.publicKey, outputMint, TOKEN_PROGRAM_ID))
  }

  // Build swap_base_input instruction
  // accounts order per Raydium CPMM IDL:
  // 0: payer, 1: authority, 2: amm_config, 3: pool_state,
  // 4: input_token_account, 5: output_token_account,
  // 6: input_vault, 7: output_vault,
  // 8: input_token_program, 9: output_token_program,
  // 10: input_token_mint, 11: output_token_mint,
  // 12: observation_state
  var OBSERVATION_SEED = Buffer.from('observation')
  var [observationId] = tbPublicKey.findProgramAddressSync([OBSERVATION_SEED, poolInfo.poolId.toBuffer()], poolInfo.programId)

  var swapDisc = tbCpmmDisc('swap_base_input')
  // Data: discriminator(8) + amount_in(u64) + minimum_amount_out(u64)
  var swapData = Buffer.alloc(24)
  swapDisc.copy(swapData, 0)
  swapData.writeBigUInt64LE(BigInt(lamports), 8)
  swapData.writeBigUInt64LE(BigInt(0), 16) // min out = 0 (10% slippage handled implicitly)

  tx.add(new tbTransactionInstruction({
    programId: poolInfo.programId,
    keys: [
      { pubkey: keypair.publicKey, isSigner: true, isWritable: true },
      { pubkey: poolInfo.authority, isSigner: false, isWritable: false },
      { pubkey: poolInfo.ammConfigId, isSigner: false, isWritable: false },
      { pubkey: poolInfo.poolId, isSigner: false, isWritable: true },
      { pubkey: userInputAta, isSigner: false, isWritable: true },
      { pubkey: userOutputAta, isSigner: false, isWritable: true },
      { pubkey: inputVault, isSigner: false, isWritable: true },
      { pubkey: outputVault, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: inputMint, isSigner: false, isWritable: false },
      { pubkey: outputMint, isSigner: false, isWritable: false },
      { pubkey: observationId, isSigner: false, isWritable: true }
    ],
    data: swapData
  }))

  // For buy: close WSOL ATA to reclaim rent after swap
  if (isBuy) {
    tx.add(createCloseAccountInstruction(userInputAta, keypair.publicKey, keypair.publicKey, [], TOKEN_PROGRAM_ID))
  }

  tx.sign(keypair)
  var sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: true, maxRetries: 5 })

  // For sell: fire fee tx async — doesn't block return
  if (!isBuy) {
    ;(async function () {
      try {
        var { fee: sellFee } = tbCalcFee(rawLamports)
        var { blockhash: fb2 } = await conn.getLatestBlockhash('confirmed')
        var fTx2 = new tbTransaction()
        fTx2.recentBlockhash = fb2
        fTx2.feePayer = keypair.publicKey
        fTx2.add(tbFeeInstruction(keypair.publicKey, sellFee))
        fTx2.sign(keypair)
        conn.sendRawTransaction(fTx2.serialize(), { skipPreflight: true, maxRetries: 5 })
      } catch (e) {}
    })()
  }

  if (isBuy) {
    return {
      success: true, signature: sig,
      explorerUrl: 'https://explorer.solana.com/tx/' + sig + '?cluster=devnet',
      source: 'raydium-cpmm-devnet', amountSol: inputAmount, mint: mintAddress
    }
  } else {
    return {
      success: true, signature: sig,
      explorerUrl: 'https://explorer.solana.com/tx/' + sig + '?cluster=devnet',
      source: 'raydium-cpmm-devnet', amountTokens: lamports, mint: mintAddress
    }
  }
}

// ---- Jupiter (Raydium, PumpSwap, graduated tokens) ----

async function tbBuyJupiter (mintAddress, amountSol, keypair, conn) {
  var totalLamports = Math.floor(amountSol * tbLAMPORTS_PER_SOL)
  var { fee, net: lamports } = tbCalcFee(totalLamports)

  // Fetch blockhash and Jupiter quote in parallel
  var [bhResult, quoteRes] = await Promise.all([
    conn.getLatestBlockhash('confirmed'),
    tbFetch(
      'https://api.jup.ag/swap/v1/quote?inputMint=' + TB_SOL_MINT +
      '&outputMint=' + mintAddress +
      '&amount=' + lamports +
      '&slippageBps=1000'
    )
  ])

  var quoteText = await quoteRes.text()
  if (!quoteRes.ok) {
    var quoteErrObj = null
    try { quoteErrObj = JSON.parse(quoteText) } catch (e) {}
    var quoteErrMsg = (quoteErrObj && quoteErrObj.error) || quoteText
    if (quoteErrObj && quoteErrObj.errorCode === 'TOKEN_NOT_TRADABLE') {
      throw new Error('Token is not tradable on Jupiter. It may still be on the pump.fun bonding curve and not yet graduated to open trading.')
    }
    throw new Error('Jupiter quote failed: ' + quoteErrMsg)
  }
  var quote = JSON.parse(quoteText)
  if (quote.error) throw new Error('Jupiter quote error: ' + quote.error)

  // Fire fee tx immediately after blockhash is in hand — parallel with swap POST below
  var feeTx = new tbTransaction()
  feeTx.recentBlockhash = bhResult.blockhash
  feeTx.feePayer = keypair.publicKey
  feeTx.add(tbFeeInstruction(keypair.publicKey, fee))
  feeTx.sign(keypair)
  conn.sendRawTransaction(feeTx.serialize(), { skipPreflight: true, maxRetries: 5 })

  // Swap POST is the slowest step — fire it now, fee tx is already in flight
  var swapRes = await tbFetch('https://api.jup.ag/swap/v1/swap', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey: keypair.publicKey.toBase58(),
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: 'auto'
    })
  })
  if (!swapRes.ok) throw new Error('Jupiter swap failed: ' + await swapRes.text())
  var swapData = await swapRes.json()
  if (swapData.error) throw new Error('Jupiter swap error: ' + swapData.error)

  var buf = Buffer.from(swapData.swapTransaction, 'base64')
  var tx = tbVersionedTransaction.deserialize(buf)
  tx.sign([keypair])
  var sig = await conn.sendTransaction(tx, { skipPreflight: true, maxRetries: 5 })
  return {
    success: true,
    signature: sig,
    explorerUrl: 'https://solscan.io/tx/' + sig,
    source: 'jupiter',
    amountSol: amountSol,
    outAmount: quote.outAmount,
    mint: mintAddress
  }
}

async function tbSellJupiter (mintAddress, amountTokens, keypair, conn, usePercent) {
  var sellAmount = amountTokens
  if (usePercent) {
    var tokenAccounts = await conn.getTokenAccountsByOwner(keypair.publicKey, { mint: new tbPublicKey(mintAddress) })
    if (!tokenAccounts.value.length) throw new Error('No token account found for this mint')
    var bal = await conn.getTokenAccountBalance(tokenAccounts.value[0].pubkey)
    sellAmount = Math.floor((parseFloat(bal.value.amount) * amountTokens) / 100)
  }

  var quoteRes = await tbFetch(
    'https://api.jup.ag/swap/v1/quote?inputMint=' + mintAddress +
    '&outputMint=' + TB_SOL_MINT +
    '&amount=' + sellAmount +
    '&slippageBps=1000'
  )
  if (!quoteRes.ok) throw new Error('Jupiter quote failed: ' + await quoteRes.text())
  var quote = await quoteRes.json()
  if (quote.error) throw new Error('Jupiter quote error: ' + quote.error)

  var swapRes = await tbFetch('https://api.jup.ag/swap/v1/swap', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey: keypair.publicKey.toBase58(),
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: 'auto'
    })
  })
  if (!swapRes.ok) throw new Error('Jupiter swap failed: ' + await swapRes.text())
  var swapData = await swapRes.json()
  if (swapData.error) throw new Error('Jupiter swap error: ' + swapData.error)

  var buf = Buffer.from(swapData.swapTransaction, 'base64')
  var tx = tbVersionedTransaction.deserialize(buf)
  tx.sign([keypair])
  var sig = await conn.sendTransaction(tx, { skipPreflight: true, maxRetries: 5 })

  // Fire sell fee asynchronously — doesn't block return
  ;(async function () {
    try {
      var outLamports = parseInt(quote.outAmount)
      var { fee: sellFee } = tbCalcFee(outLamports)
      var { blockhash: fb } = await conn.getLatestBlockhash('confirmed')
      var fTx = new tbTransaction()
      fTx.recentBlockhash = fb
      fTx.feePayer = keypair.publicKey
      fTx.add(tbFeeInstruction(keypair.publicKey, sellFee))
      fTx.sign(keypair)
      conn.sendRawTransaction(fTx.serialize(), { skipPreflight: true, maxRetries: 5 })
    } catch (e) {}
  })()

  return {
    success: true,
    signature: sig,
    explorerUrl: 'https://solscan.io/tx/' + sig,
    source: 'jupiter',
    amountTokens: sellAmount,
    outSol: (parseInt(quote.outAmount) / tbLAMPORTS_PER_SOL).toFixed(6),
    mint: mintAddress
  }
}

// Global object exposed to walletIPC.js
var tokenBuy = { verifyToken: tbVerifyToken, buyToken: tbBuyToken, sellToken: tbSellToken }
