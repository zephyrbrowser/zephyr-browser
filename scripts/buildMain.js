const path = require('path')
const fs = require('fs')

const outFile = path.resolve(__dirname, '../main.build.js')

const modules = [
  'main/secrets.js', // gitignored — copy from main/secrets.example.js
  'main/loadEnv.js',
  'dist/localization.build.js',
  'main/windowManagement.js',
  'js/util/keyMap.js',
  'main/menu.js',
  'main/touchbar.js',
  'main/registryConfig.js',
  'js/util/settings/settingsMain.js',
  'main/errorSanitizer.js',
  'main/raydiumCpmm.js',
  'main/pumpfunDeploy.js',
  'main/tokenBuy.js',
  'main/walletManager.js',
  'main/adblock/debug.js',
  'main/adblock/storage.js',
  'main/adblock/lists.js',
  'main/adblock/engine.js',
  'main/adblock/youtube.js',
  'main/adblock/inject.js',
  'main/adblock/index.js',
  'main/main.js',
  'main/walletIPC.js',
  'main/mixerIPC.js',
  'main/adblockIPC.js',
  'main/agentIPC.js',
  'main/tokenCardIPC.js',
  'main/minInternalProtocol.js',
  'main/filtering.js',
  'main/viewManager.js',
  'main/download.js',
  'main/UASwitcher.js',
  'main/permissionManager.js',
  'main/prompt.js',
  'main/remoteMenu.js',
  'main/remoteActions.js',
  'main/keychainService.js',
  'js/util/proxy.js',
  'main/themeMain.js'
]

function buildMain () {
  // build localization support first, since it is included in the bundle
  require('./buildLocalization.js')()

  if (!fs.existsSync(path.resolve(__dirname, '../main/secrets.js'))) {
    throw new Error('main/secrets.js is missing. Copy main/secrets.example.js to main/secrets.js and fill in the keys.')
  }

  /* concatenate modules */
  let output = ''
  modules.forEach(function (script) {
    output += fs.readFileSync(path.resolve(__dirname, '../', script)) + ';\n'
  })

  fs.writeFileSync(outFile, output, 'utf-8')
}

if (module.parent) {
  module.exports = buildMain
} else {
  buildMain()
}
