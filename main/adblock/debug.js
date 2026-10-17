// main/adblock/debug.js
// Debug utility - function-based to avoid const redeclaration in bundled output

function isAdblockDebug() {
  return process.env.ADBLOCK_DEBUG === '1'
}

module.exports = { isAdblockDebug }
