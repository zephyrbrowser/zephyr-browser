// main/adblockIPC.js
// IPC handlers for adblock

const { ipcMain, webContents: electronWebContents } = require('electron')

// Helper function to check debug flag at runtime (no const binding)
function isAdblockIPCDebug() {
  return process.env.ADBLOCK_DEBUG === '1'
}

function setupAdblockIPC() {
  const adblock = getAdblockManager()

  // Get adblock status
  ipcMain.handle('adblock:getStatus', async (event) => {
    try {
      const sender = event.sender
      const webContentsId = sender ? sender.id : null
      const url = sender && !sender.isDestroyed() ? sender.getURL() : null

      const status = adblock.getStatus(webContentsId, url)

      if (isAdblockIPCDebug()) console.log('[Adblock IPC] getStatus:', status)
      return { success: true, data: status }
    } catch (error) {
      console.error('[Adblock IPC] getStatus error:', error)
      return { success: false, error: error.message }
    }
  })

  // Toggle global adblock
  ipcMain.handle('adblock:toggleGlobal', async (event) => {
    try {
      const newState = adblock.toggleGlobal()

      if (isAdblockIPCDebug()) console.log('[Adblock IPC] toggleGlobal:', newState)
      return { success: true, data: { enabled: newState } }
    } catch (error) {
      console.error('[Adblock IPC] toggleGlobal error:', error)
      return { success: false, error: error.message }
    }
  })

  // Toggle site-specific adblock
  ipcMain.handle('adblock:toggleSite', async (event, hostname = null) => {
    try {
      // If no hostname provided, use current page's hostname
      if (!hostname) {
        const sender = event.sender
        if (sender && !sender.isDestroyed()) {
          try {
            const url = sender.getURL()
            hostname = new URL(url).hostname
          } catch (error) {
            return { success: false, error: 'Could not determine hostname' }
          }
        }
      }

      const result = adblock.toggleSite(hostname)

      if (isAdblockIPCDebug()) console.log('[Adblock IPC] toggleSite:', result)
      return { success: true, data: result }
    } catch (error) {
      console.error('[Adblock IPC] toggleSite error:', error)
      return { success: false, error: error.message }
    }
  })

  // Update filter lists
  ipcMain.handle('adblock:updateLists', async (event, force = false) => {
    try {
      if (isAdblockIPCDebug()) console.log('[Adblock IPC] updateLists (force:', force, ')')

      const result = await adblock.updateFilterLists(force)

      return { success: result.success, data: result }
    } catch (error) {
      console.error('[Adblock IPC] updateLists error:', error)
      return { success: false, error: error.message }
    }
  })

  // Get filter lists info
  ipcMain.handle('adblock:getListsInfo', async (event) => {
    try {
      const info = adblock.getListsInfo()

      if (isAdblockIPCDebug()) console.log('[Adblock IPC] getListsInfo:', info)
      return { success: true, data: info }
    } catch (error) {
      console.error('[Adblock IPC] getListsInfo error:', error)
      return { success: false, error: error.message }
    }
  })

  // Get blocked count for current page
  ipcMain.handle('adblock:getBlockedCount', async (event) => {
    try {
      const sender = event.sender
      const webContentsId = sender ? sender.id : null

      if (!webContentsId) {
        return { success: true, data: { blockedCount: 0 } }
      }

      const blockedCount = adblock.getBlockedCount(webContentsId)

      return { success: true, data: { blockedCount } }
    } catch (error) {
      console.error('[Adblock IPC] getBlockedCount error:', error)
      return { success: false, error: error.message }
    }
  })

  // YouTube skip button click - use Electron's sendInputEvent
  ipcMain.on('youtube-skip-click', (event, { x, y }) => {
    try {
      const sender = event.sender
      if (!sender || sender.isDestroyed()) return

      console.log('[YT-Skip] Sending click events at', x, y)

      // Use Electron's native input event injection
      // This creates trusted events that the page sees as real user input
      sender.sendInputEvent({
        type: 'mouseDown',
        x: x,
        y: y,
        button: 'left',
        clickCount: 1
      })

      sender.sendInputEvent({
        type: 'mouseUp',
        x: x,
        y: y,
        button: 'left',
        clickCount: 1
      })

      console.log('[YT-Skip] Click events sent')
    } catch (error) {
      console.error('[YT-Skip] Error:', error.message)
    }
  })

  if (isAdblockIPCDebug()) console.log('[Adblock IPC] Handlers registered')
}

module.exports = { setupAdblockIPC }
