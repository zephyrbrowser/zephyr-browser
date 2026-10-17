var browserUI = require('browserUI.js')
var zephyrNavBar = require('zephyrNavBar.js')

var addTabButton = document.getElementById('add-tab-button')

function initialize () {
  addTabButton.addEventListener('click', function (e) {
    browserUI.addTab()
    setTimeout(function () {
      if (zephyrNavBar && zephyrNavBar.searchInput) {
        zephyrNavBar.searchInput.focus()
      }
    }, 100)
  })
}

module.exports = { initialize }
