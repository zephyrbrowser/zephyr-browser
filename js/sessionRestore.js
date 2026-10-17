var browserUI = require('browserUI.js')
var webviews = require('webviews.js')
var tabEditor = require('navbar/tabEditor.js')
var tabState = require('tabState.js')
var settings = require('util/settings/settings.js')
var taskOverlay = require('taskOverlay/taskOverlay.js')
const writeFileAtomic = require('write-file-atomic')
const statistics = require('js/statistics.js')

const sessionRestore = {
  savePath: window.globalArgs['user-data-path'] + (platformType === 'windows' ? '\\sessionRestore.json' : '/sessionRestore.json'),
  previousState: null,
  save: function (forceSave, sync) {
    // PRIVACY MODE: Session restore is completely disabled
    // No session data will be saved to disk
    return
  },
  restoreFromFile: function () {
    // PRIVACY MODE: Always start with a fresh session
    // Delete any existing session data file
    try {
      if (fs.existsSync(sessionRestore.savePath)) {
        fs.unlinkSync(sessionRestore.savePath)
      }
    } catch (e) {
      console.warn('failed to delete session restore file', e)
    }

    // Zephyr always lands on the blank tab, which renders the centered
    // home agent ("How can I help you?"). The welcome page is no longer the
    // startup page.
    tasks.setSelected(tasks.add())
    browserUI.addTab(tasks.getSelected().tabs.add())
  },
  syncWithWindow: function () {
    // PRIVACY MODE: Don't sync with other windows, always start fresh
    tasks.setSelected(tasks.add())
    browserUI.addTab(tasks.getSelected().tabs.add())
  },
  restore: function () {
    if (Object.hasOwn(window.globalArgs, 'initial-window')) {
      sessionRestore.restoreFromFile()
    } else {
      sessionRestore.syncWithWindow()
    }
    if (settings.get('newWindowOption') === 2 && !Object.hasOwn(window.globalArgs, 'launch-window') && !Object.hasOwn(window.globalArgs, 'initial-task')) {
      taskOverlay.show()
    }
  },
  initialize: function () {
    setInterval(sessionRestore.save, 30000)

    window.onbeforeunload = function (e) {
      sessionRestore.save(true, true)
      //workaround for notifying the other windows that the task open in this window isn't open anymore.
      //This should ideally be done in windowSync, but it needs to run synchronously, which windowSync doesn't
      ipc.send('tab-state-change', [
        ['task-updated', tasks.getSelected().id, 'selectedInWindow', null]
      ])
    }

    ipc.on('read-tab-state', function (e) {
      ipc.send('return-tab-state', tasks.getCopyableState())
    })
  }
}

module.exports = sessionRestore
