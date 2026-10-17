// js/zephyrHome.js
// Zephyr centered home-screen agent. Replaces the old right-side agent panel.
// The agent now lives in the new-tab page: the user types in the centered
// search bar and the page turns into a conversation with the Zephyr Agent.

var agentCore = require('agentCore.js')
var agentTools = require('agentTools.js')
var webviews = require('webviews.js')

var zephyrHome = {
  elements: {},
  attachedImage: null, // { path, name, dataUrl, ... }
  hasConversation: false,
  pendingConfirmEl: null,
  recognition: null, // Web Speech API instance
  isListening: false,
  aiMode: false, // false = normal web search, true = chat with the agent

  initialize: function () {
    zephyrHome.elements = {
      home: document.getElementById('zephyr-home'),
      conversation: document.getElementById('zephyr-home-conversation'),
      input: document.getElementById('zephyr-home-input'),
      send: document.getElementById('zephyr-home-send'),
      mic: document.getElementById('zephyr-home-mic'),
      aiMode: document.getElementById('zephyr-home-ai-mode'),
      attach: document.getElementById('zephyr-home-attach'),
      fileInput: document.getElementById('zephyr-home-file'),
      imagePreview: document.getElementById('zephyr-home-image-preview'),
      imagePreviewImg: document.getElementById('zephyr-home-image-preview-img'),
      imagePreviewName: document.getElementById('zephyr-home-image-preview-name'),
      imageRemove: document.getElementById('zephyr-home-image-remove')
    }

    if (!zephyrHome.elements.home || !zephyrHome.elements.input) {
      // Home agent markup not present — nothing to wire up.
      return
    }

    zephyrHome.setupEventListeners()

    // Route tool confirmations through the inline confirm UI.
    agentTools.onConfirmationNeeded = zephyrHome.showConfirmation

    // Token hover-card "Trade" button (sent from the page preload): open a
    // fresh tab on the agent home and hand the buy request to the agent.
    webviews.bindIPC('tokenCardTrade', function (tabId, args) {
      var token = args && args[0]
      if (!token || !token.address) return

      var browserUI = require('browserUI.js')
      browserUI.addTab(tabs.add(), { enterEditMode: false })

      // Give the new-tab page a moment to become visible before asking.
      setTimeout(function () {
        zephyrHome.askAgent(
          'I want to buy ' + (token.symbol || 'this token') +
          ' (mint address ' + token.address + ') on Solana. ' +
          'Check the token first, then help me buy it with SOL.'
        )
      }, 250)
    })
  },

  setupEventListeners: function () {
    var els = zephyrHome.elements

    // Send button → same as pressing Enter
    if (els.send) {
      els.send.addEventListener('click', function () {
        zephyrHome.submit()
      })
    }

    // Mic button → toggle voice input
    if (els.mic) {
      els.mic.addEventListener('click', function () {
        zephyrHome.toggleVoice()
      })
    }

    // AI Mode button → toggle between web search and agent chat
    if (els.aiMode) {
      els.aiMode.addEventListener('click', function () {
        zephyrHome.toggleAiMode()
      })
    }

    if (els.input) {
      // Enter submits: web search in normal mode, agent chat in AI mode.
      // Shift+Enter for newline. Auto-grow.
      els.input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault()
          zephyrHome.submit()
        }
      })
      els.input.addEventListener('input', function () {
        els.input.style.height = 'auto'
        els.input.style.height = Math.min(els.input.scrollHeight, 120) + 'px'
      })
    }

    if (els.attach && els.fileInput) {
      els.attach.addEventListener('click', function () {
        els.fileInput.click()
      })
      els.fileInput.addEventListener('change', function (e) {
        var file = e.target.files && e.target.files[0]
        if (!file) return

        zephyrHome.attachedImage = {
          path: file.path || file.name,
          name: file.name,
          size: file.size,
          type: file.type
        }

        var reader = new FileReader()
        reader.onload = function (ev) {
          zephyrHome.attachedImage.dataUrl = ev.target.result
          if (els.imagePreviewImg) els.imagePreviewImg.src = ev.target.result
          if (els.imagePreviewName) els.imagePreviewName.textContent = file.name
          if (els.imagePreview) els.imagePreview.style.display = 'flex'
        }
        reader.readAsDataURL(file)

        e.target.value = ''
      })
    }

    if (els.imageRemove) {
      els.imageRemove.addEventListener('click', function () {
        zephyrHome.removeAttachedImage()
      })
    }
  },

  focusInput: function () {
    if (zephyrHome.elements.input) {
      zephyrHome.elements.input.focus()
    }
  },

  // Toggle AI Mode on/off and reflect it in the UI (button + placeholder).
  toggleAiMode: function () {
    zephyrHome.aiMode = !zephyrHome.aiMode

    if (zephyrHome.elements.aiMode) {
      zephyrHome.elements.aiMode.classList.toggle('active', zephyrHome.aiMode)
    }
    if (zephyrHome.elements.input) {
      zephyrHome.elements.input.placeholder = zephyrHome.aiMode ? 'Ask anything…' : 'Search now'
      zephyrHome.elements.input.focus()
    }
  },

  // Programmatic entry: switch into AI mode and send a message to the agent.
  // Used by the token hover-card "Trade" button and other features.
  askAgent: function (text) {
    if (!text) return
    if (!zephyrHome.aiMode) {
      zephyrHome.toggleAiMode()
    }
    if (zephyrHome.elements.input) {
      zephyrHome.elements.input.value = text
    }
    zephyrHome.sendMessage()
  },

  // Single entry point for Enter / mic. Routes to the agent in AI mode,
  // otherwise performs a normal web search like a regular browser.
  submit: function () {
    if (zephyrHome.aiMode) {
      zephyrHome.sendMessage()
    } else {
      zephyrHome.webSearch()
    }
  },

  // Normal browser search: navigate the current tab to a URL (if the text
  // looks like one) or to a Google search for the query.
  webSearch: function () {
    var input = zephyrHome.elements.input
    if (!input) return

    var text = input.value.trim()
    if (!text) return
    if (typeof tabs === 'undefined' || !tabs) return

    var isURL = text.includes('.') || text.startsWith('http://') ||
      text.startsWith('https://') || text.startsWith('localhost')

    var url
    if (isURL) {
      url = (text.startsWith('http://') || text.startsWith('https://')) ? text : 'https://' + text
    } else {
      url = 'https://www.google.com/search?q=' + encodeURIComponent(text)
    }

    var tabId = tabs.getSelected()
    input.value = ''
    tabs.update(tabId, { url: url })
    webviews.update(tabId, url)
    webviews.focus()
  },

  // ---- Voice input (record audio -> Whisper via main process) ----
  // We avoid the browser Web Speech API because it relies on Google's online
  // service, which fails with "network" errors inside Electron. Instead we
  // record with MediaRecorder and transcribe through the OpenAI API.
  mediaRecorder: null,
  mediaStream: null,
  audioChunks: [],

  toggleVoice: function () {
    if (zephyrHome.isListening) {
      zephyrHome.stopVoice()
    } else {
      zephyrHome.startVoice()
    }
  },

  startVoice: async function () {
    if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      zephyrHome.addMessage('error', 'Voice input is not supported in this build.')
      return
    }

    var stream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (e) {
      zephyrHome.addMessage('error', 'Microphone access was blocked. Allow microphone permission and try again.')
      return
    }

    zephyrHome.mediaStream = stream
    zephyrHome.audioChunks = []

    // Pick a mime type the platform supports.
    var mimeType = ''
    var candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']
    for (var i = 0; i < candidates.length; i++) {
      if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(candidates[i])) {
        mimeType = candidates[i]
        break
      }
    }

    var recorder
    try {
      recorder = mimeType ? new MediaRecorder(stream, { mimeType: mimeType }) : new MediaRecorder(stream)
    } catch (e) {
      recorder = new MediaRecorder(stream)
    }
    zephyrHome.mediaRecorder = recorder

    recorder.ondataavailable = function (e) {
      if (e.data && e.data.size > 0) zephyrHome.audioChunks.push(e.data)
    }

    recorder.onstop = function () {
      zephyrHome.cleanupStream()
      zephyrHome.isListening = false
      if (zephyrHome.elements.mic) zephyrHome.elements.mic.classList.remove('listening')
      if (zephyrHome.elements.input) zephyrHome.elements.input.placeholder = 'Search now'

      var blobType = (recorder.mimeType || mimeType || 'audio/webm')
      var blob = new Blob(zephyrHome.audioChunks, { type: blobType })
      zephyrHome.audioChunks = []
      if (!blob.size) return
      zephyrHome.transcribeAndSend(blob, blobType)
    }

    zephyrHome.isListening = true
    if (zephyrHome.elements.mic) zephyrHome.elements.mic.classList.add('listening')
    if (zephyrHome.elements.input) zephyrHome.elements.input.placeholder = 'Listening… (tap mic to stop)'

    recorder.start()
  },

  stopVoice: function () {
    if (zephyrHome.mediaRecorder && zephyrHome.mediaRecorder.state !== 'inactive') {
      try {
        zephyrHome.mediaRecorder.stop()
      } catch (e) {
        zephyrHome.cleanupStream()
      }
    }
  },

  cleanupStream: function () {
    if (zephyrHome.mediaStream) {
      zephyrHome.mediaStream.getTracks().forEach(function (t) { t.stop() })
      zephyrHome.mediaStream = null
    }
  },

  transcribeAndSend: async function (blob, mimeType) {
    if (zephyrHome.elements.input) zephyrHome.elements.input.placeholder = 'Transcribing…'

    // Convert blob -> base64 for IPC.
    var base64 = await new Promise(function (resolve) {
      var reader = new FileReader()
      reader.onload = function () {
        var res = reader.result || ''
        var comma = res.indexOf(',')
        resolve(comma !== -1 ? res.substring(comma + 1) : res)
      }
      reader.onerror = function () { resolve('') }
      reader.readAsDataURL(blob)
    })

    if (zephyrHome.elements.input) zephyrHome.elements.input.placeholder = 'Search now'

    if (!base64) {
      zephyrHome.addMessage('error', 'Could not read recorded audio.')
      return
    }

    var ipc = require('electron').ipcRenderer
    var result
    try {
      result = await ipc.invoke('agent:transcribe', { audioBase64: base64, mimeType: mimeType })
    } catch (e) {
      console.error('[zephyrHome] transcribe failed:', e)
      result = { error: 'Voice input failed. Please try again or type your message.' }
    }

    if (!result || result.error) {
      zephyrHome.addMessage('error', (result && result.error) || 'Transcription failed.')
      return
    }

    var text = (result.text || '').trim()
    if (!text) {
      return
    }

    if (zephyrHome.elements.input) zephyrHome.elements.input.value = text
    zephyrHome.submit()
  },

  removeAttachedImage: function () {
    zephyrHome.attachedImage = null
    if (zephyrHome.elements.imagePreview) {
      zephyrHome.elements.imagePreview.style.display = 'none'
    }
    if (zephyrHome.elements.imagePreviewImg) {
      zephyrHome.elements.imagePreviewImg.src = ''
    }
  },

  enterConversationMode: function () {
    if (zephyrHome.hasConversation) return
    zephyrHome.hasConversation = true
    zephyrHome.elements.home.classList.add('has-conversation')
  },

  addMessage: function (role, content, imageDataUrl) {
    var conv = zephyrHome.elements.conversation
    if (!conv) return

    var msg = document.createElement('div')
    msg.className = 'zh-message zh-message-' + role

    var bubble = document.createElement('div')
    bubble.className = 'zh-bubble'

    if (content && content.trim()) {
      var textNode = document.createElement('div')
      textNode.textContent = content
      bubble.appendChild(textNode)
    }

    if (imageDataUrl) {
      var wrap = document.createElement('div')
      wrap.className = 'zh-msg-img-wrap'
      var img = document.createElement('img')
      img.src = imageDataUrl
      img.alt = 'Attached'
      img.className = 'zh-msg-img'
      img.addEventListener('click', function () {
        zephyrHome.openImageOverlay(imageDataUrl)
      })
      wrap.appendChild(img)
      bubble.appendChild(wrap)
    }

    msg.appendChild(bubble)
    conv.appendChild(msg)
    conv.scrollTop = conv.scrollHeight
  },

  addToolActivity: function (toolName, args) {
    var conv = zephyrHome.elements.conversation
    if (!conv) return

    var el = document.createElement('div')
    el.className = 'zh-tool-activity'

    var label = (toolName || '').replace(/_/g, ' ')
    var detail = ''
    if (args) {
      if (args.url) detail = args.url
      else if (args.query) detail = args.query
      else if (args.text) detail = args.text
      else if (args.direction) detail = args.direction
      else if (args.channel) detail = args.channel
      else if (args.recipient) detail = String(args.recipient).substring(0, 12) + '...'
      else if (args.urls) detail = args.urls.length + ' tabs'
    }

    el.innerHTML = '<span class="zh-tool-icon">&#9889;</span> ' +
      '<span class="zh-tool-label">' + zephyrHome.escapeHtml(label) + '</span>' +
      (detail ? ' <span class="zh-tool-detail">' + zephyrHome.escapeHtml(detail) + '</span>' : '')

    conv.appendChild(el)
    conv.scrollTop = conv.scrollHeight
  },

  addTypingIndicator: function () {
    var conv = zephyrHome.elements.conversation
    if (!conv) return
    if (conv.querySelector('.zh-typing')) return

    var typing = document.createElement('div')
    typing.className = 'zh-typing'
    typing.innerHTML = '<span class="dot"></span><span class="dot"></span><span class="dot"></span>'
    conv.appendChild(typing)
    conv.scrollTop = conv.scrollHeight
  },

  removeTypingIndicator: function () {
    var conv = zephyrHome.elements.conversation
    if (!conv) return
    var existing = conv.querySelector('.zh-typing')
    if (existing) existing.remove()
  },

  sendMessage: async function () {
    if (agentCore.isProcessing) return

    var input = zephyrHome.elements.input
    if (!input) return

    var message = input.value.trim()
    if (!message) return

    input.value = ''
    input.style.height = 'auto'

    zephyrHome.enterConversationMode()

    // Capture attached image (if any) for vision/token tools
    var imageInfo = null
    var imageDataUrl = null
    if (zephyrHome.attachedImage) {
      imageInfo = zephyrHome.attachedImage
      imageDataUrl = imageInfo.dataUrl || null
      agentTools.lastAttachedImage = imageInfo
      zephyrHome.removeAttachedImage()
    }

    zephyrHome.addMessage('user', message, imageDataUrl)
    zephyrHome.addTypingIndicator()

    if (zephyrHome.elements.mic) zephyrHome.elements.mic.disabled = true

    var tools = agentTools.getToolDefinitions()

    var response = await agentCore.sendMessage(
      message,
      tools,
      agentTools.executeTool,
      zephyrHome.addToolActivity,
      imageDataUrl
    )

    zephyrHome.removeTypingIndicator()

    if (zephyrHome.elements.mic) zephyrHome.elements.mic.disabled = false

    if (response.error) {
      zephyrHome.addMessage('error', response.error)
    } else if (response.content) {
      zephyrHome.addMessage('assistant', response.content)
    }

    input.focus()
  },

  // Inline confirmation (replaces the old panel overlay). Resolves via
  // agentTools.handleConfirmation(true|false).
  showConfirmation: function (data) {
    var conv = zephyrHome.elements.conversation
    if (!conv) {
      // Fallback to native confirm if the conversation area is unavailable.
      var ok = window.confirm((data && data.message) || 'Confirm this action?')
      agentTools.handleConfirmation(!!ok)
      return
    }

    zephyrHome.enterConversationMode()

    var box = document.createElement('div')
    box.className = 'zh-confirm'

    var title = document.createElement('div')
    title.className = 'zh-confirm-title'
    title.innerHTML = '<i class="i carbon:warning"></i> Confirm Action'

    var msg = document.createElement('div')
    msg.className = 'zh-confirm-message'
    msg.textContent = (data && data.message) || 'Confirm this action?'

    var buttons = document.createElement('div')
    buttons.className = 'zh-confirm-buttons'

    var cancel = document.createElement('button')
    cancel.className = 'zh-confirm-cancel'
    cancel.textContent = 'Cancel'

    var approve = document.createElement('button')
    approve.className = 'zh-confirm-approve'
    approve.textContent = 'Confirm'

    function cleanup () {
      if (box && box.parentNode) box.parentNode.removeChild(box)
      zephyrHome.pendingConfirmEl = null
    }

    cancel.addEventListener('click', function () {
      cleanup()
      agentTools.handleConfirmation(false)
    })
    approve.addEventListener('click', function () {
      cleanup()
      agentTools.handleConfirmation(true)
    })

    buttons.appendChild(cancel)
    buttons.appendChild(approve)
    box.appendChild(title)
    box.appendChild(msg)
    box.appendChild(buttons)

    conv.appendChild(box)
    conv.scrollTop = conv.scrollHeight
    zephyrHome.pendingConfirmEl = box
  },

  escapeHtml: function (text) {
    var div = document.createElement('div')
    div.textContent = text
    return div.innerHTML
  },

  openImageOverlay: function (dataUrl) {
    var existing = document.getElementById('zh-image-overlay')
    if (existing) existing.remove()

    var overlay = document.createElement('div')
    overlay.id = 'zh-image-overlay'

    var closeBtn = document.createElement('button')
    closeBtn.className = 'zh-image-overlay-close'
    closeBtn.innerHTML = '&times;'
    closeBtn.addEventListener('click', function (e) {
      e.stopPropagation()
      overlay.remove()
    })

    var img = document.createElement('img')
    img.src = dataUrl

    overlay.appendChild(closeBtn)
    overlay.appendChild(img)

    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) overlay.remove()
    })

    var escHandler = function (e) {
      if (e.key === 'Escape') {
        overlay.remove()
        document.removeEventListener('keydown', escHandler)
      }
    }
    document.addEventListener('keydown', escHandler)

    document.body.appendChild(overlay)
  }
}

module.exports = zephyrHome
