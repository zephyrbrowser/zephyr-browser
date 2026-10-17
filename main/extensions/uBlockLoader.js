// uBlock Origin loader for Zephyr
const path = require('path');
const fs = require('fs');
const { app } = require('electron');

class UBlockLoader {
  constructor() {
    this.loaded = false;
    this.extensionId = null;
  }

  async loadUBlock(session) {
    const uBlockPath = path.join(app.getAppPath(), 'assets', 'extensions', 'uBlock0.chromium');

    if (!fs.existsSync(uBlockPath)) {
      console.error('[uBlock] ❌ Extension not found at:', uBlockPath);
      console.error('[uBlock] Download from: https://github.com/gorhill/uBlock/releases');
      return false;
    }

    try {
      const extension = await session.loadExtension(uBlockPath, { allowFileAccess: true });
      this.loaded = true;
      this.extensionId = extension.id;
      console.log('[uBlock] ✅ Loaded:', extension.name, 'ID:', extension.id);
      return true;
    } catch (error) {
      console.error('[uBlock] ❌ Load failed:', error.message);
      return false;
    }
  }

  isLoaded() {
    return this.loaded;
  }
}

module.exports = new UBlockLoader();
