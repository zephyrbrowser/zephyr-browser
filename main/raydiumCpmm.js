// main/raydiumCpmm.js
// Raydium CPMM (Constant Product Market Maker) pool creation for Devnet
// Constructs on-chain instructions directly — no SDK dependency needed

var { PublicKey, SystemProgram, TransactionInstruction, SYSVAR_RENT_PUBKEY, LAMPORTS_PER_SOL, Transaction, Keypair } = require('@solana/web3.js')
var {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createSyncNativeInstruction,
  createCloseAccountInstruction,
  NATIVE_MINT
} = require('@solana/spl-token')

// --- Program IDs ---

// Devnet CPMM program
var CPMM_PROGRAM_ID_DEVNET = new PublicKey('DRaycpLY18LhpbydsBWbVJtxpNv9oXPgjRSfpF2bWpYb')

// Devnet pool creation fee account
var CREATE_POOL_FEE_ACC_DEVNET = new PublicKey('3oE58BKVt8KuYkGxx8zBojugnymWmBiyafWgMrnb6eYy')

// Mainnet CPMM program
var CPMM_PROGRAM_ID_MAINNET = new PublicKey('CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C')

// Mainnet pool creation fee account
var CREATE_POOL_FEE_ACC_MAINNET = new PublicKey('DNXgeM9EiiaAbaWvwjHj9fQQLAX5ZsfHyvmYUNRAdNC8')

// WSOL mint (same on all networks)
var WSOL_MINT = NATIVE_MINT // So11111111111111111111111111111111111111112

// --- PDA Seeds ---

var AUTH_SEED = Buffer.from('vault_and_lp_mint_auth_seed')
var AMM_CONFIG_SEED = Buffer.from('amm_config')
var POOL_SEED = Buffer.from('pool')
var POOL_LP_MINT_SEED = Buffer.from('pool_lp_mint')
var POOL_VAULT_SEED = Buffer.from('pool_vault')
var OBSERVATION_SEED = Buffer.from('observation')

// Anchor instruction discriminators (sha256("global:<name>")[0..8])
var INITIALIZE_DISCRIMINATOR = Buffer.from([175, 175, 109, 31, 13, 152, 155, 237])

// --- PDA Derivation Helpers ---

function u16ToBytes (num) {
  var buf = Buffer.alloc(2)
  buf.writeUInt16LE(num)
  return buf
}

function getPdaPoolAuthority (programId) {
  return PublicKey.findProgramAddressSync([AUTH_SEED], programId)
}

function getCpmmPdaAmmConfigId (programId, index) {
  return PublicKey.findProgramAddressSync(
    [AMM_CONFIG_SEED, u16ToBytes(index)],
    programId
  )
}

function getCpmmPdaPoolId (programId, ammConfigId, mintA, mintB) {
  return PublicKey.findProgramAddressSync(
    [POOL_SEED, ammConfigId.toBuffer(), mintA.toBuffer(), mintB.toBuffer()],
    programId
  )
}

function getPdaLpMint (programId, poolId) {
  return PublicKey.findProgramAddressSync(
    [POOL_LP_MINT_SEED, poolId.toBuffer()],
    programId
  )
}

function getPdaVault (programId, poolId, mint) {
  return PublicKey.findProgramAddressSync(
    [POOL_VAULT_SEED, poolId.toBuffer(), mint.toBuffer()],
    programId
  )
}

function getPdaObservationId (programId, poolId) {
  return PublicKey.findProgramAddressSync(
    [OBSERVATION_SEED, poolId.toBuffer()],
    programId
  )
}

// --- Token Ordering ---
// Raydium requires token_0 < token_1 (lexicographic byte comparison)

function orderMints (mintA, mintB) {
  var bufA = mintA.toBuffer()
  var bufB = mintB.toBuffer()
  for (var i = 0; i < 32; i++) {
    if (bufA[i] < bufB[i]) return { mint0: mintA, mint1: mintB, swapped: false }
    if (bufA[i] > bufB[i]) return { mint0: mintB, mint1: mintA, swapped: true }
  }
  throw new Error('Mints are identical')
}

// --- Instruction Builder ---

function makeInitializeCpmmPoolInstruction (params) {
  var programId = params.programId
  var creator = params.creator
  var configId = params.configId
  var authority = params.authority
  var poolId = params.poolId
  var mint0 = params.mint0
  var mint1 = params.mint1
  var lpMint = params.lpMint
  var creatorToken0 = params.creatorToken0
  var creatorToken1 = params.creatorToken1
  var creatorLpToken = params.creatorLpToken
  var vault0 = params.vault0
  var vault1 = params.vault1
  var feeAccount = params.feeAccount
  var observationId = params.observationId
  var mintProgram0 = params.mintProgram0 || TOKEN_PROGRAM_ID
  var mintProgram1 = params.mintProgram1 || TOKEN_PROGRAM_ID
  var initAmount0 = params.initAmount0 // BigInt
  var initAmount1 = params.initAmount1 // BigInt
  var openTime = params.openTime || BigInt(0)

  // Check if poolId is a PDA (not a signer) or a generated keypair (signer)
  var poolIdIsSigner = params.poolIdIsSigner || false

  // Encode instruction data: discriminator + 3x u64 LE
  var data = Buffer.alloc(8 + 8 + 8 + 8)
  INITIALIZE_DISCRIMINATOR.copy(data, 0)
  data.writeBigUInt64LE(BigInt(initAmount0), 8)
  data.writeBigUInt64LE(BigInt(initAmount1), 16)
  data.writeBigUInt64LE(BigInt(openTime), 24)

  var keys = [
    { pubkey: creator, isSigner: true, isWritable: true },
    { pubkey: configId, isSigner: false, isWritable: false },
    { pubkey: authority, isSigner: false, isWritable: false },
    { pubkey: poolId, isSigner: poolIdIsSigner, isWritable: true },
    { pubkey: mint0, isSigner: false, isWritable: false },
    { pubkey: mint1, isSigner: false, isWritable: false },
    { pubkey: lpMint, isSigner: false, isWritable: true },
    { pubkey: creatorToken0, isSigner: false, isWritable: true },
    { pubkey: creatorToken1, isSigner: false, isWritable: true },
    { pubkey: creatorLpToken, isSigner: false, isWritable: true },
    { pubkey: vault0, isSigner: false, isWritable: true },
    { pubkey: vault1, isSigner: false, isWritable: true },
    { pubkey: feeAccount, isSigner: false, isWritable: true },
    { pubkey: observationId, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: mintProgram0, isSigner: false, isWritable: false },
    { pubkey: mintProgram1, isSigner: false, isWritable: false },
    { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false }
  ]

  return new TransactionInstruction({
    programId: programId,
    keys: keys,
    data: data
  })
}

// --- Main Pool Creation Function ---

/**
 * Create a Raydium CPMM pool on the specified network
 * @param {object} opts
 * @param {Connection} opts.connection - Solana connection (mainnet or devnet)
 * @param {string} [opts.network='mainnet-beta'] - Network: 'mainnet-beta' or 'devnet'
 * @param {Keypair} opts.payer - Wallet keypair (signs + pays)
 * @param {PublicKey} opts.tokenMint - The custom token mint
 * @param {number} opts.tokenDecimals - Decimals of the custom token
 * @param {BigInt} opts.tokenAmount - Amount of custom tokens for LP (base units)
 * @param {BigInt} opts.solAmount - Amount of SOL for LP (in lamports)
 * @param {number} [opts.ammConfigIndex=0] - AMM config index (fee tier)
 * @returns {object} - { poolId, lpMint, signatures, explorerLinks }
 */
async function createCpmmPool (opts) {
  var connection = opts.connection
  var payer = opts.payer
  var tokenMint = opts.tokenMint
  var tokenDecimals = opts.tokenDecimals
  var tokenAmount = opts.tokenAmount
  var solAmount = opts.solAmount
  var ammConfigIndex = opts.ammConfigIndex || 0
  var network = opts.network || 'mainnet-beta'
  var isMainnet = network === 'mainnet-beta'
  var programId = isMainnet ? CPMM_PROGRAM_ID_MAINNET : CPMM_PROGRAM_ID_DEVNET
  var feeAccount = isMainnet ? CREATE_POOL_FEE_ACC_MAINNET : CREATE_POOL_FEE_ACC_DEVNET

  console.log('[RaydiumCPMM] Creating pool: Token/' + tokenMint.toBase58().substring(0, 8) + '... + WSOL')
  console.log('[RaydiumCPMM] Token amount: ' + tokenAmount.toString() + ' base units')
  console.log('[RaydiumCPMM] SOL amount: ' + (Number(solAmount) / LAMPORTS_PER_SOL) + ' SOL')

  // Order mints (Raydium requires token_0 < token_1 lexicographically)
  var ordered = orderMints(tokenMint, WSOL_MINT)
  var mint0 = ordered.mint0
  var mint1 = ordered.mint1

  // Determine amounts based on ordering
  var isTokenMint0 = !ordered.swapped
  var amount0 = isTokenMint0 ? tokenAmount : solAmount
  var amount1 = isTokenMint0 ? solAmount : tokenAmount

  console.log('[RaydiumCPMM] Mint0 (token_0): ' + mint0.toBase58())
  console.log('[RaydiumCPMM] Mint1 (token_1): ' + mint1.toBase58())

  // Derive all PDAs
  var [authority] = getPdaPoolAuthority(programId)
  var [ammConfigId] = getCpmmPdaAmmConfigId(programId, ammConfigIndex)

  // Try PDA pool first
  var [poolIdPda] = getCpmmPdaPoolId(programId, ammConfigId, mint0, mint1)
  var poolId = poolIdPda
  var poolIdIsSigner = false

  // Check if PDA pool already exists
  var existingPool = await connection.getAccountInfo(poolIdPda)
  if (existingPool) {
    throw new Error('A pool for this token pair already exists at ' + poolIdPda.toBase58())
  }

  var [lpMint] = getPdaLpMint(programId, poolId)
  var [vault0] = getPdaVault(programId, poolId, mint0)
  var [vault1] = getPdaVault(programId, poolId, mint1)
  var [observationId] = getPdaObservationId(programId, poolId)

  // Get creator's token accounts
  var creatorToken0 = await getAssociatedTokenAddress(mint0, payer.publicKey, false, TOKEN_PROGRAM_ID)
  var creatorToken1 = await getAssociatedTokenAddress(mint1, payer.publicKey, false, TOKEN_PROGRAM_ID)
  var creatorLpToken = await getAssociatedTokenAddress(lpMint, payer.publicKey, false, TOKEN_PROGRAM_ID)

  // Build transaction
  var tx = new Transaction()
  var { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed')

  // 1. Create WSOL ATA if it doesn't exist and wrap SOL
  var wsolAta = isTokenMint0 ? creatorToken1 : creatorToken0
  var wsolAtaExists = false
  try {
    var wsolAcct = await connection.getAccountInfo(wsolAta)
    wsolAtaExists = wsolAcct !== null
  } catch (e) {
    // doesn't exist
  }

  if (!wsolAtaExists) {
    tx.add(
      createAssociatedTokenAccountInstruction(
        payer.publicKey,
        wsolAta,
        payer.publicKey,
        WSOL_MINT,
        TOKEN_PROGRAM_ID
      )
    )
  }

  // Transfer SOL to WSOL ATA and sync
  tx.add(
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: wsolAta,
      lamports: Number(solAmount)
    })
  )
  tx.add(createSyncNativeInstruction(wsolAta, TOKEN_PROGRAM_ID))

  // 2. Build the CPMM initialize instruction
  tx.add(
    makeInitializeCpmmPoolInstruction({
      programId: programId,
      creator: payer.publicKey,
      configId: ammConfigId,
      authority: authority,
      poolId: poolId,
      poolIdIsSigner: false, // PDA-based pool
      mint0: mint0,
      mint1: mint1,
      lpMint: lpMint,
      creatorToken0: creatorToken0,
      creatorToken1: creatorToken1,
      creatorLpToken: creatorLpToken,
      vault0: vault0,
      vault1: vault1,
      feeAccount: feeAccount,
      observationId: observationId,
      mintProgram0: TOKEN_PROGRAM_ID,
      mintProgram1: TOKEN_PROGRAM_ID,
      initAmount0: amount0,
      initAmount1: amount1,
      openTime: BigInt(0)
    })
  )

  // 3. Close WSOL account after pool creation to reclaim rent
  tx.add(
    createCloseAccountInstruction(
      wsolAta,
      payer.publicKey,
      payer.publicKey,
      [],
      TOKEN_PROGRAM_ID
    )
  )

  tx.recentBlockhash = blockhash
  tx.feePayer = payer.publicKey
  tx.sign(payer)

  console.log('[RaydiumCPMM] Sending pool creation transaction...')

  var sig = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    preflightCommitment: 'confirmed'
  })

  await connection.confirmTransaction(
    { signature: sig, blockhash, lastValidBlockHeight },
    'confirmed'
  )

  console.log('[RaydiumCPMM] Pool created! Signature: ' + sig)
  console.log('[RaydiumCPMM] Pool ID: ' + poolId.toBase58())
  console.log('[RaydiumCPMM] LP Mint: ' + lpMint.toBase58())

  var clusterParam = isMainnet ? '' : '?cluster=devnet'
  return {
    poolId: poolId.toBase58(),
    lpMint: lpMint.toBase58(),
    vault0: vault0.toBase58(),
    vault1: vault1.toBase58(),
    ammConfigId: ammConfigId.toBase58(),
    signature: sig,
    explorerLinks: {
      pool: 'https://explorer.solana.com/address/' + poolId.toBase58() + clusterParam,
      lpMint: 'https://explorer.solana.com/address/' + lpMint.toBase58() + clusterParam,
      tx: 'https://explorer.solana.com/tx/' + sig + clusterParam
    }
  }
}

/**
 * Estimate costs for pool creation
 * @param {Connection} connection
 * @param {BigInt} solAmountLamports - SOL to deposit as liquidity
 * @returns {object} - { rentCosts, feeCosts, liquidityCost, totalLamports, totalSOL }
 */
async function estimatePoolCreationCost (connection, solAmountLamports) {
  // Pool creation fee is ~0.15 SOL on devnet (can be up to ~1 SOL)
  var poolCreationFee = 150000000 // 0.15 SOL estimate

  // WSOL ATA rent (165 bytes) — will be reclaimed after close
  // LP token ATA rent (165 bytes)
  var ataRent = await connection.getMinimumBalanceForRentExemption(165)

  // Transaction fees (~3 signatures)
  var txFees = 15000

  // Total = pool fee + ata rent (LP only, WSOL is closed) + tx fees + liquidity SOL
  var totalLamports = poolCreationFee + ataRent + txFees + Number(solAmountLamports)

  return {
    poolCreationFee: poolCreationFee,
    ataRent: ataRent,
    txFees: txFees,
    liquidityCostLamports: Number(solAmountLamports),
    totalLamports: totalLamports,
    totalSOL: totalLamports / LAMPORTS_PER_SOL
  }
}

// Export for use in walletManager
if (typeof module !== 'undefined') {
  module.exports = {
    createCpmmPool: createCpmmPool,
    estimatePoolCreationCost: estimatePoolCreationCost,
    CPMM_PROGRAM_ID_DEVNET: CPMM_PROGRAM_ID_DEVNET,
    CPMM_PROGRAM_ID_MAINNET: CPMM_PROGRAM_ID_MAINNET,
    WSOL_MINT: WSOL_MINT
  }
}
