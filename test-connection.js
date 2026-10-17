// Test if browser can connect to backend service
// Run this in Windows to verify connection before starting browser

const http = require('http');

// const BACKEND_URL = 'http://localhost:5000';
const BACKEND_URL = 'https://api.zephyrbrowser.com';
const TEST_AD_URL = 'https://googleads.g.doubleclick.net/pagead/ads';

console.log('='.repeat(70));
console.log('Zephyr Backend Connection Test');
console.log('='.repeat(70));
console.log('');

// Test 1: Health check
console.log('Test 1: Checking if backend service is running...');
console.log(`URL: ${BACKEND_URL}/health`);

const healthRequest = http.get(`${BACKEND_URL}/health`, (res) => {
  let data = '';

  res.on('data', chunk => data += chunk);

  res.on('end', () => {
    try {
      const health = JSON.parse(data);
      console.log('✅ Backend service is RUNNING!');
      console.log(`   Status: ${health.status}`);
      console.log(`   Engine Ready: ${health.engineReady}`);
      console.log(`   Engine Available: ${health.engineAvailable}`);
      console.log('');

      if (!health.engineReady) {
        console.log('⚠️  WARNING: Engine is not ready!');
        console.log('   Wait a few seconds for filter lists to download.');
        console.log('');
      }

      // Test 2: Check if it can block ads
      console.log('Test 2: Testing ad blocking...');
      console.log(`URL: ${TEST_AD_URL}`);

      const postData = JSON.stringify({
        url: TEST_AD_URL,
        sourceUrl: 'https://youtube.com',
        resourceType: 'script'
      });

      const options = {
        hostname: 'localhost',
        port: 5000,
        path: '/check',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        }
      };

      const checkRequest = http.request(options, (checkRes) => {
        let checkData = '';

        checkRes.on('data', chunk => checkData += chunk);

        checkRes.on('end', () => {
          try {
            const result = JSON.parse(checkData);

            if (result.shouldBlock) {
              console.log('✅ Ad blocking is WORKING!');
              console.log(`   URL: ${result.url.substring(0, 60)}...`);
              console.log(`   Should Block: ${result.shouldBlock}`);
              if (result.filter) {
                console.log(`   Matched Filter: ${result.filter.substring(0, 60)}...`);
              }
              console.log('');
              console.log('='.repeat(70));
              console.log('🎉 SUCCESS! Backend is ready for browser connection!');
              console.log('='.repeat(70));
              console.log('');
              console.log('Next steps:');
              console.log('1. Keep the backend service running (don\'t close WSL terminal)');
              console.log('2. Start the browser: npm start');
              console.log('3. Open DevTools (F12) and check console logs');
              console.log('4. Look for: [UNIFIED BLOCKER] ✅ CONNECTED to Brave engine backend!');
              console.log('');
            } else {
              console.log('⚠️  WARNING: Backend returned shouldBlock = false');
              console.log('   This might mean the engine is not fully loaded yet.');
              console.log('   Wait a few seconds and try again.');
              console.log('');
            }
          } catch (err) {
            console.error('❌ Error parsing check response:', err.message);
            console.log('');
          }
        });
      });

      checkRequest.on('error', (err) => {
        console.error('❌ Error testing ad blocking:', err.message);
        console.log('');
      });

      checkRequest.write(postData);
      checkRequest.end();

    } catch (err) {
      console.error('❌ Error parsing health response:', err.message);
      console.log('');
    }
  });
});

healthRequest.on('error', (err) => {
  console.error('❌ Backend service is NOT running!');
  console.error(`   Error: ${err.message}`);
  console.log('');
  console.log('='.repeat(70));
  console.log('💡 How to fix:');
  console.log('='.repeat(70));
  console.log('');
  console.log('1. Open WSL terminal:');
  console.log('   wsl');
  console.log('');
  console.log('2. Navigate to backend folder:');
  console.log('   cd /mnt/d/BBT_Projects/zephyr/zephyr-browser/adblockercustom');
  console.log('');
  console.log('3. Start the service:');
  console.log('   npm start');
  console.log('');
  console.log('4. Wait for:');
  console.log('   [Adblock Service] ✅ Brave adblock engine READY!');
  console.log('');
  console.log('5. Run this test again:');
  console.log('   node test-connection.js');
  console.log('');
});
