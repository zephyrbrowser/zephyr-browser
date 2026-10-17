/* global tabs */

var webviews = require('webviews.js')
const searchEngine = require('util/searchEngine.js')
const urlParser = require('util/urlParser.js')

const places = {
  messagePort: null,
  sendMessage: function (data) {
    places.messagePort.postMessage(data)
  },
  pendingPromises: {},
  invokeWithPromise: function (data) {
    const callbackId = Math.random()
    const { promise, resolve, reject } = Promise.withResolvers()
    places.pendingPromises[callbackId] = { promise, resolve, reject }
    places.messagePort.postMessage({
      ...data,
      callbackId
    })
    return promise
  },
  replyToPromise: function (callbackId, result) {
    if (places.pendingPromises[callbackId]) {
      places.pendingPromises[callbackId].resolve(result)
      delete places.pendingPromises[callbackId]
    } else {
      throw new Error('places is missing callbackId')
    }
  },
  savePage: function (tabId, extractedText) {
    /* this prevents pages that are immediately left from being saved to history, and also gives the page-favicon-updated event time to fire (so the colors saved to history are correct). */
    setTimeout(function () {
      const tab = tabs.get(tabId)
      if (tab) {
        const data = {
          url: urlParser.removeTextFragment(urlParser.getSourceURL(tab.url)), // for PDF viewer and reader mode, save the original page URL and not the viewer URL
          title: tab.title,
          color: tab.backgroundColor,
          extractedText: extractedText
        }

        places.sendMessage({
          action: 'updatePlace',
          pageData: data,
          flags: {
            isNewVisit: true
          }
        })
      }
    }, 500)
  },
  receiveHistoryData: function (tabId, args) {
    // PRIVACY MODE: History saving is completely disabled
    // No browsing history will be saved regardless of private mode setting
    return
  },
  deleteHistory: function (url) {
    places.sendMessage({
      action: 'deleteHistory',
      pageData: {
        url: url
      }
    })
  },
  deleteAllHistory: function () {
    places.sendMessage({
      action: 'deleteAllHistory'
    })
  },
  searchPlaces: function (text, options) {
    return places.invokeWithPromise({
      action: 'searchPlaces',
      text: text,
      options: options
    })
  },
  searchPlacesFullText: function (text) {
    return places.invokeWithPromise({
      action: 'searchPlacesFullText',
      text: text
    })
  },
  getPlaceSuggestions: function (url) {
    return places.invokeWithPromise({
      action: 'getPlaceSuggestions',
      text: url
    })
  },
  onMessage: function (e) {
    if (e.data.callbackId) {
      places.replyToPromise(e.data.callbackId, e.data.result)
    }
  },
  getItem: function (url) {
    return places.invokeWithPromise({
      action: 'getPlace',
      pageData: {
        url: url
      }
    })
  },
  getAllItems: function () {
    return places.invokeWithPromise({
      action: 'getAllPlaces'
    })
  },
  updateItem: function (url, fields) {
    return places.invokeWithPromise({
      action: 'updatePlace',
      pageData: {
        url: url,
        ...fields
      }
    })
  },
  toggleTag: function (url, tag) {
    return places.getItem(url)
      .then(function (item) {
        if (!item) {
          return
        }
        if (item.tags.includes(tag)) {
          item.tags = item.tags.filter(t => t !== tag)
        } else {
          item.tags.push(tag)
        }
        places.sendMessage({
          action: 'updatePlace',
          pageData: {
            url: url,
            tags: item.tags
          }
        })
      })
  },
  getSuggestedTags: function (url) {
    return places.invokeWithPromise({
      action: 'getSuggestedTags',
      pageData: {
        url: url
      }
    })
  },
  getAllTagsRanked: function (url) {
    return places.invokeWithPromise({
      action: 'getAllTagsRanked',
      pageData: {
        url: url
      }
    })
  },
  getSuggestedItemsForTags: function (tags) {
    return places.invokeWithPromise({
      action: 'getSuggestedItemsForTags',
      pageData: {
        tags: tags
      }
    })
  },
  autocompleteTags: function (tags) {
    return places.invokeWithPromise({
      action: 'autocompleteTags',
      pageData: {
        tags: tags
      }
    })
  },
  initialize: function () {
    const { port1, port2 } = new MessageChannel()

    ipc.postMessage('places-connect', null, [port1])
    places.messagePort = port2
    port2.addEventListener('message', places.onMessage)
    port2.start()

    webviews.bindIPC('pageData', places.receiveHistoryData)
  }
}

places.initialize()
module.exports = places
