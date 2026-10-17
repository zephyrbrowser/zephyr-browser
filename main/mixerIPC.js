// Mixer API proxy — all fetch calls go through main process via net.fetch
// so the zephyr://app origin never hits the CORS preflight.

const MIXER_BASE = 'https://api.zephyrbrowser.com/api/zephyrbrowser'

function mixerFetch (url, options) {
  return new Promise(function (resolve, reject) {
    var reqOptions = {
      method: options && options.method ? options.method : 'GET',
      headers: Object.assign({ 'Content-Type': 'application/json' }, (options && options.headers) || {})
    }
    if (options && options.body) reqOptions.body = options.body

    net.fetch(url, reqOptions).then(function (res) {
      res.json().then(function (data) {
        resolve({ ok: res.ok, status: res.status, data: data })
      }).catch(function (err) {
        reject(err)
      })
    }).catch(function (err) {
      reject(err)
    })
  })
}

function setupMixerIPC () {
  ipc.handle('mixer:getCurrencies', async (event, { fixedRate, active }) => {
    try {
      var params = new URLSearchParams()
      if (fixedRate) params.append('fixedRate', 'true')
      if (active) params.append('active', 'true')
      var res = await mixerFetch(MIXER_BASE + '/currencies?' + params.toString())
      if (!res.ok) return { success: false, error: 'HTTP ' + res.status }
      if (res.data.success && res.data.data) return { success: true, data: res.data.data }
      return res.data
    } catch (e) {
      return { success: false, error: sanitizeUserError(e.message) }
    }
  })

  ipc.handle('mixer:getMinAmount', async (event, { fromCurrency, toCurrency, fromNetwork, toNetwork }) => {
    try {
      var params = new URLSearchParams({
        fromCurrency: fromCurrency.toLowerCase(),
        toCurrency: toCurrency.toLowerCase(),
        fromNetwork: fromNetwork.toLowerCase(),
        toNetwork: toNetwork.toLowerCase(),
        flow: 'standard'
      })
      var res = await mixerFetch(MIXER_BASE + '/min-amount?' + params.toString())
      if (!res.ok) return { success: false, error: (res.data && (res.data.error || res.data.message)) || 'HTTP ' + res.status }
      if (res.data.success && res.data.data) return { success: true, data: res.data.data }
      return res.data
    } catch (e) {
      return { success: false, error: sanitizeUserError(e.message) }
    }
  })

  ipc.handle('mixer:getEstimate', async (event, { fromCurrency, toCurrency, fromNetwork, toNetwork, fromAmount, flow }) => {
    try {
      var params = new URLSearchParams({
        fromCurrency: fromCurrency.toLowerCase(),
        toCurrency: toCurrency.toLowerCase(),
        fromNetwork: fromNetwork.toLowerCase(),
        toNetwork: toNetwork.toLowerCase(),
        fromAmount: fromAmount.toString(),
        flow: flow || 'standard',
        type: 'direct'
      })
      var res = await mixerFetch(MIXER_BASE + '/estimated-amount?' + params.toString())
      if (!res.ok) return { success: false, error: (res.data && (res.data.error || res.data.message)) || 'HTTP ' + res.status }
      if (res.data.success && res.data.data) return { success: true, data: res.data.data }
      return res.data
    } catch (e) {
      return { success: false, error: sanitizeUserError(e.message) }
    }
  })

  ipc.handle('mixer:createExchange', async (event, params) => {
    try {
      var body = {
        fromCurrency: params.fromCurrency.toLowerCase(),
        toCurrency: params.toCurrency.toLowerCase(),
        fromNetwork: params.fromNetwork.toLowerCase(),
        toNetwork: params.toNetwork.toLowerCase(),
        fromAmount: params.fromAmount.toString(),
        address: params.address,
        flow: 'standard',
        type: 'direct',
        rateId: ''
      }
      if (params.refundAddress) body.refundAddress = params.refundAddress
      if (params.contactEmail) body.contactEmail = params.contactEmail

      var res = await mixerFetch(MIXER_BASE + '/exchange', {
        method: 'POST',
        body: JSON.stringify(body)
      })
      if (!res.ok) return { success: false, error: (res.data && (res.data.error || res.data.message)) || 'HTTP ' + res.status }
      if (res.data.success && res.data.data) return { success: true, data: res.data.data }
      return res.data
    } catch (e) {
      return { success: false, error: sanitizeUserError(e.message) }
    }
  })

  ipc.handle('mixer:getStatus', async (event, { transactionId }) => {
    try {
      var res = await mixerFetch(MIXER_BASE + '/transaction/' + transactionId)
      if (!res.ok) return { success: false, error: (res.data && (res.data.error || res.data.message)) || 'HTTP ' + res.status }
      if (res.data.success && res.data.data) return { success: true, data: res.data.data }
      return res.data
    } catch (e) {
      return { success: false, error: sanitizeUserError(e.message) }
    }
  })
}

// setupMixerIPC is available globally in the concatenated bundle
