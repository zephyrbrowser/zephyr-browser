// All mixer API calls are proxied through the main process via IPC
// to avoid CORS errors from the zephyr://app origin.

async function getAvailableCurrencies(fixedRate = false, active = true) {
  try {
    const result = await ipc.invoke('mixer:getCurrencies', { fixedRate, active })
    return result
  } catch (error) {
    console.error('Error fetching currencies:', error)
    return { success: false, error: error.message }
  }
}

async function getMinimumExchangeAmount(fromCurrency, toCurrency, fromNetwork, toNetwork) {
  try {
    const result = await ipc.invoke('mixer:getMinAmount', {
      fromCurrency, toCurrency, fromNetwork, toNetwork
    })
    return result
  } catch (error) {
    console.error('Error getting minimum amount:', error)
    return { success: false, error: error.message }
  }
}

async function getEstimatedExchange(fromCurrency, toCurrency, fromNetwork, toNetwork, fromAmount, flow = 'standard') {
  try {
    const result = await ipc.invoke('mixer:getEstimate', {
      fromCurrency, toCurrency, fromNetwork, toNetwork, fromAmount, flow
    })
    return result
  } catch (error) {
    console.error('Error getting estimate:', error)
    return { success: false, error: error.message }
  }
}

async function createExchange({ fromCurrency, toCurrency, fromNetwork, toNetwork, fromAmount, address, refundAddress = '', contactEmail = '' }) {
  try {
    const result = await ipc.invoke('mixer:createExchange', {
      fromCurrency, toCurrency, fromNetwork, toNetwork, fromAmount, address, refundAddress, contactEmail
    })
    return result
  } catch (error) {
    console.error('Error creating exchange:', error)
    return { success: false, error: error.message }
  }
}

async function getTransactionStatus(transactionId) {
  try {
    const result = await ipc.invoke('mixer:getStatus', { transactionId })
    return result
  } catch (error) {
    console.error('Error fetching transaction status:', error)
    return { success: false, error: error.message }
  }
}

function getStatusText(status) {
  const statusMap = {
    new: 'Waiting for deposit',
    waiting: 'Waiting for deposit',
    confirming: 'Confirming transaction',
    exchanging: 'Exchanging',
    sending: 'Sending to your wallet',
    finished: 'Completed',
    failed: 'Failed',
    refunded: 'Refunded',
    expired: 'Expired'
  }
  return statusMap[status] || status
}

function getNetworkForCurrency(currency) {
  const networkMap = {
    sol: 'sol',
    usdt: 'eth',
    eth: 'eth',
    btc: 'btc',
    bnb: 'bsc',
    matic: 'matic',
    usdc: 'eth',
    dai: 'eth'
  }
  return networkMap[currency.toLowerCase()] || currency.toLowerCase()
}

module.exports = {
  getAvailableCurrencies,
  getMinimumExchangeAmount,
  getEstimatedExchange,
  createExchange,
  getTransactionStatus,
  getStatusText,
  getNetworkForCurrency
}
