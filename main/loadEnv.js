// Load .env into process.env so all main-process modules can read it.
// Must run BEFORE any other module that references process.env at top-level.
try {
  var _envPath = require('path').join(__dirname, '.env')
  if (require('fs').existsSync(_envPath)) {
    require('dotenv').config({ path: _envPath })
  } else {
    // Fallback to default dotenv lookup (CWD)
    require('dotenv').config()
  }
} catch (e) {
  console.warn('[loadEnv] Failed to load .env:', e.message)
}
