// main/secrets.js — private keys for the main process. Template — safe to commit.
// Copy main/secrets.example.js to main/secrets.js and fill in the values.
// Concatenated into main.build.js by scripts/buildMain.js.

var ZEPHYR_SECRETS = {
  // Base58 private key of the launch fee wallet (Wallet A) — signs the 5-min auto-sell
  FEE_WALLET_SECRET: '',

  // pumpdev.io API key — pump.fun launch / buy / sell transactions
  PUMPDEV_API_KEY: '',

  // Telegram bot token — launch notifications
  TELEGRAM_BOT_TOKEN: '',

  // imgbb.com API key — logo hosting for plain SPL token deploys
  IMGBB_API_KEY: ''
}
