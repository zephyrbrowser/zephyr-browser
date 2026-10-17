var searchbarPlugins = require('searchbar/searchbarPlugins.js')
var searchbarUtils = require('searchbar/searchbarUtils.js')
var urlParser = require('util/urlParser.js')

var places = require('places/places.js')

async function showPlaceSuggestions (text, input, inputFlags) {
  // PRIVACY MODE: No history suggestions - always return empty
  searchbarPlugins.reset('placeSuggestions')
  return
}

function initialize () {
  searchbarPlugins.register('placeSuggestions', {
    index: 1,
    trigger: function (text) {
      return !text
    },
    showResults: showPlaceSuggestions
  })
}

module.exports = { initialize }
