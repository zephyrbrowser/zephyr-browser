const webviews = require('webviews.js')
const browserUI = require('browserUI.js')
const tabState = require('tabState.js')
const mixerPanel = require('mixerPanel.js')
const walletPanel = require('walletPanel.js')

const zephyrNavBar = {
  bar: null,
  searchInput: null,
  walletButton: null,
  mixerButton: null,
  vpnButton: null,
  barHeight: 52,

  initialize: function () {

    zephyrNavBar.bar = document.getElementById('zephyr-nav-bar')
    zephyrNavBar.searchInput = document.getElementById('zephyr-search-input')
    zephyrNavBar.walletButton = document.getElementById('wallet-button')
    zephyrNavBar.mixerButton = document.getElementById('mixer-button')
    zephyrNavBar.vpnButton = document.getElementById('vpn-button')
    var logoContainer = document.getElementById('zephyr-logo-container')

    if (!zephyrNavBar.bar || !zephyrNavBar.searchInput) {
      console.error('Zephyr NavBar: Required elements not found!')
      return
    }

    if (logoContainer) {
      logoContainer.addEventListener('click', function () {
        // Home button → go to the Zephyr agent home (the blank new-tab page
        // with the centered "How can I help you?" agent). We reset the current
        // tab back to the empty NTP state rather than loading the welcome page.
        zephyrNavBar.goHome()
      })
    }

    // console.log('Zephyr NavBar: Elements found, setting up event listeners...')

    // Initialize search input functionality
    zephyrNavBar.searchInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault()
        // console.log('Zephyr NavBar: Enter key pressed, handling search...')
        zephyrNavBar.handleSearch()
      } else if (e.key === 'Escape') {
        zephyrNavBar.searchInput.blur()
      }
    })

    // Wallet button click handler
    if (zephyrNavBar.walletButton) {
      zephyrNavBar.walletButton.addEventListener('click', function () {
        // console.log('Zephyr NavBar: Wallet button clicked')
        zephyrNavBar.handleWalletClick()
      })
    }

    // Mixer button click handler
    if (zephyrNavBar.mixerButton) {
      zephyrNavBar.mixerButton.addEventListener('click', function () {
        // console.log('Zephyr NavBar: Mixer button clicked')
        zephyrNavBar.handleMixerClick()
      })
    }

    // VPN button click handler
    if (zephyrNavBar.vpnButton) {
      zephyrNavBar.vpnButton.addEventListener('click', function () {
        // console.log('Zephyr NavBar: VPN button clicked')
        zephyrNavBar.handleVPNClick()
      })
    }

    // Adjust webview margin to account for the nav bar
    webviews.adjustMargin([zephyrNavBar.barHeight, 0, 0, 0])

    // Update search input with current tab URL when tab changes
    tasks.on('tab-selected', function (tabId) {
      if (!tabs) return
      var currentTab = tabs.get(tabId)
      if (currentTab && currentTab.url && !currentTab.url.startsWith('zephyr://')) {
        zephyrNavBar.searchInput.value = currentTab.url
      } else {
        zephyrNavBar.searchInput.value = ''
      }
    })

    // Update search input when tab URL changes
    tasks.on('tab-updated', function (tabId, key) {
      if (!tabs || key !== 'url') return
      if (tabs.getSelected() === tabId) {
        var currentTab = tabs.get(tabId)
        if (currentTab && currentTab.url && !currentTab.url.startsWith('zephyr://')) {
          zephyrNavBar.searchInput.value = currentTab.url
        } else {
          zephyrNavBar.searchInput.value = ''
        }
      }
    })

    // Focus search input when clicking on it
    zephyrNavBar.searchInput.addEventListener('focus', function () {
      zephyrNavBar.searchInput.select()
    })

    // console.log('Zephyr NavBar: Initialization complete!')
  },

  handleSearch: function () {
    // console.log('Zephyr NavBar: handleSearch called')
    var searchText = zephyrNavBar.searchInput.value.trim()
    // console.log('Zephyr NavBar: Search text:', searchText)

    if (!searchText) {
      // console.log('Zephyr NavBar: Empty search text, returning')
      return
    }

    // Check if tabs is available
    if (!tabs) {
      console.error('Zephyr NavBar: tabs is not available yet!')
      return
    }

    var currentTab = tabs.get(tabs.getSelected())
    // console.log('Zephyr NavBar: Current tab:', currentTab)

    // Determine if it's a URL or search query
    var isURL = searchText.includes('.') || searchText.startsWith('http://') ||
                searchText.startsWith('https://') || searchText.startsWith('localhost')

    var urlToNavigate

    if (isURL) {
      // Add protocol if missing
      if (!searchText.startsWith('http://') && !searchText.startsWith('https://')) {
        urlToNavigate = 'https://' + searchText
      } else {
        urlToNavigate = searchText
      }
    } else {
      // Use default search engine (Google)
      urlToNavigate = 'https://www.google.com/search?q=' + encodeURIComponent(searchText)
    }

    // console.log('Zephyr NavBar: Navigating to:', urlToNavigate)

    // Navigate current tab to the URL
    if (currentTab) {
      var tabId = tabs.getSelected()
      tabs.update(tabId, { url: urlToNavigate })
      webviews.update(tabId, urlToNavigate)
      webviews.focus()
      // console.log('Zephyr NavBar: Tab updated and webview navigated')
    } else {
      console.error('Zephyr NavBar: No current tab found!')
    }

    // Blur the search input
    zephyrNavBar.searchInput.blur()
  },

  handleWalletClick: function () {
    // Close other side panels first
    if (mixerPanel && mixerPanel.isOpen) mixerPanel.close()
    // Toggle wallet panel
    if (walletPanel && walletPanel.toggle) {
      walletPanel.toggle()
    } else {
      console.error('Wallet panel not available')
    }
  },

  handleMixerClick: function () {
    // Close other side panels first
    if (walletPanel && walletPanel.isOpen) walletPanel.close()
    // Toggle mixer panel
    if (mixerPanel && mixerPanel.toggle) {
      mixerPanel.toggle()
    } else {
      console.error('Mixer panel not available')
    }
  },

  handleVPNClick: function () {
    // console.log('VPN button clicked - Feature to be implemented')
    // TODO: Implement VPN functionality
    // This could include:
    // - Connect to VPN service
    // - Show VPN status
    // - Select VPN server location
    // - etc.

    // For now, show a notification
    alert('VPN Feature\n\nThis feature will allow you to connect to a VPN service for enhanced privacy.\n\nComing soon!')
  },

  updateSearchInput: function (url) {
    // Update search input with current URL
    if (url && !url.startsWith('zephyr://')) {
      zephyrNavBar.searchInput.value = url
    } else {
      zephyrNavBar.searchInput.value = ''
    }
  },

  focusSearchInput: function () {
    zephyrNavBar.searchInput.focus()
    zephyrNavBar.searchInput.select()
  },

  // Reset the current tab back to the blank agent home (new-tab page).
  goHome: function () {
    if (!tabs) return
    var tabId = tabs.getSelected()
    var currentTab = tabs.get(tabId)

    // Already on the agent home — nothing to do.
    if (currentTab && !currentTab.url) {
      if (browserUI && browserUI.switchToTab) browserUI.switchToTab(tabId)
      zephyrNavBar.searchInput.value = ''
      return
    }

    // Clear the tab's navigation state and tear down its webview so the
    // new-tab page (the centered agent) renders, then re-select the tab.
    tabs.update(tabId, { url: '', title: '' })
    webviews.destroy(tabId)
    webviews.add(tabId)
    if (browserUI && browserUI.switchToTab) {
      browserUI.switchToTab(tabId)
    } else {
      document.body.classList.add('is-ntp')
    }
    zephyrNavBar.searchInput.value = ''
  }
}

// Handle window resize
window.addEventListener('resize', function () {
  var oldHeight = zephyrNavBar.barHeight
  zephyrNavBar.barHeight = zephyrNavBar.bar.getBoundingClientRect().height
  webviews.adjustMargin([zephyrNavBar.barHeight - oldHeight, 0, 0, 0])
})

module.exports = zephyrNavBar
