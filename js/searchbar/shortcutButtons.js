const searchbar = require('searchbar/searchbar.js')
const searchbarPlugins = require('searchbar/searchbarPlugins.js')

const shortcuts = [
  {
    icon: 'recently-viewed',
    text: '!history '
  },
  {
    icon: 'star',
    text: '!bookmarks '
  },
  {
    icon: 'overflow-menu-horizontal',
    text: '!'
  }
]

function showShortcutButtons (text, input, inputFlags) {
  // PRIVACY MODE: Shortcut buttons disabled (history, bookmarks, bang commands)
  searchbarPlugins.reset('shortcutButtons')
  return
}

function initialize () {
  searchbarPlugins.register('shortcutButtons', {
    index: 10,
    trigger: function (text) {
      return !text
    },
    showResults: showShortcutButtons
  })
}

module.exports = { initialize }
