/*
Wraps APIs that are only available in the main process in IPC messages, so that the BrowserWindow can use them
*/

ipc.handle('startFileDrag', function (e, path) {
  app.getFileIcon(path, {}).then(function (icon) {
    e.sender.startDrag({
      file: path,
      icon: icon
    })
  })
})

function showFocusModeDialog1() {
  dialog.showMessageBox({
    type: 'info',
    buttons: [l('closeDialog')],
    message: l('isFocusMode'),
    detail: l('focusModeExplanation1') + ' ' + l('focusModeExplanation2')
  })
}

function showFocusModeDialog2() {
  dialog.showMessageBox({
    type: 'info',
    buttons: [l('closeDialog')],
    message: l('isFocusMode'),
    detail: l('focusModeExplanation2')
  })
}

ipc.handle('showFocusModeDialog2', showFocusModeDialog2)

ipc.handle('showOpenDialog', async function (e, options) {
  const result = await dialog.showOpenDialog(windows.windowFromContents(e.sender).win, options)
  return result.filePaths
})

ipc.handle('showSaveDialog', async function (e, options) {
  const result = await dialog.showSaveDialog(windows.windowFromContents(e.sender).win, options)
  return result.filePath
})

ipc.handle('addWordToSpellCheckerDictionary', function (e, word) {
  session.fromPartition('persist:webcontent').addWordToSpellCheckerDictionary(word)
})

// PRIVACY MODE: Comprehensive storage clearing function
async function clearAllBrowsingData() {
  // console.log('PRIVACY MODE: Clearing all browsing data...')

  try {
    // Clear main partition storage (cookies, localStorage, indexedDB, etc.)
    await session.fromPartition('persist:webcontent').clearStorageData()

    // Clear HTTP/HTTPS data from default session
    await session.defaultSession.clearStorageData({ origin: 'http://' })
    await session.defaultSession.clearStorageData({ origin: 'https://' })

    // Clear all caches
    await session.fromPartition('persist:webcontent').clearCache()
    await session.defaultSession.clearCache()

    // Clear DNS cache
    await session.fromPartition('persist:webcontent').clearHostResolverCache()
    await session.defaultSession.clearHostResolverCache()

    // Clear authentication cache
    await session.fromPartition('persist:webcontent').clearAuthCache()
    await session.defaultSession.clearAuthCache()

    // Clear cookies specifically
    await session.fromPartition('persist:webcontent').clearStorageData({ storages: ['cookies'] })
    await session.defaultSession.clearStorageData({ storages: ['cookies'] })

    // Clear all storage types comprehensively
    await session.defaultSession.clearStorageData({
      storages: ['appcache', 'cookies', 'filesystem', 'indexdb', 'localstorage', 'shadercache', 'websql', 'serviceworkers', 'cachestorage']
    })

    // On Windows, clear system DNS cache
    if (process.platform === 'win32') {
      const { exec } = require('child_process')
      exec('ipconfig /flushdns', (error, stdout, stderr) => {
        if (error) {
          console.error('PRIVACY MODE: Failed to flush Windows DNS cache:', error)
        } else {
          // console.log('PRIVACY MODE: Windows DNS cache flushed')
        }
      })
    }

    // console.log('PRIVACY MODE: All browsing data cleared successfully')
  } catch (error) {
    console.error('PRIVACY MODE: Error clearing browsing data:', error)
  }
}

ipc.handle('clearStorageData', clearAllBrowsingData)

/* window actions */

ipc.handle('minimize', function (e) {
  windows.windowFromContents(e.sender).win.minimize()
  // workaround for https://github.com/minbrowser/min/issues/1662
  e.sender.send('minimize')
})

ipc.handle('maximize', function (e) {
  windows.windowFromContents(e.sender).win.maximize()
  // workaround for https://github.com/minbrowser/min/issues/1662
  e.sender.send('maximize')
})

ipc.handle('unmaximize', function (e) {
  windows.windowFromContents(e.sender).win.unmaximize()
  // workaround for https://github.com/minbrowser/min/issues/1662
  e.sender.send('unmaximize')
})

ipc.handle('close', function (e) {
  windows.windowFromContents(e.sender).win.close()
})

ipc.handle('setFullScreen', function (e, fullScreen) {
  windows.windowFromContents(e.sender).win.setFullScreen(e, fullScreen)
})

//workaround for https://github.com/electron/electron/issues/38540
ipc.handle('showItemInFolder', function (e, path) {
  shell.showItemInFolder(path)
})

ipc.on('newWindow', function (e, customArgs) {
  createWindow(customArgs)
})
