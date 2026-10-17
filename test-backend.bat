@echo off
echo ======================================================================
echo Zephyr Backend Service Test
echo ======================================================================
echo.

echo Test 1: Checking if backend is running...
curl -s http://localhost:5000/health >nul 2>&1
if %errorlevel% neq 0 (
    echo [FAIL] Backend is NOT running!
    echo.
    echo How to fix:
    echo 1. Open WSL terminal: wsl
    echo 2. cd /mnt/d/BBT_Projects/zephyr/zephyr-browser/adblockercustom
    echo 3. npm start
    echo.
    goto :end
)
echo [OK] Backend is running!
echo.

echo Test 2: Checking if engine is ready...
curl -s http://localhost:5000/health | findstr /C:"engineReady" >nul
if %errorlevel% neq 0 (
    echo [FAIL] Engine not ready!
    goto :end
)
echo [OK] Engine is ready!
echo.

echo Test 3: Testing YouTube ad blocking...
curl -s -X POST http://localhost:5000/check -H "Content-Type: application/json" -d "{\"url\":\"https://youtube.com/api/stats/ads\"}" | findstr /C:"shouldBlock" >nul
if %errorlevel% neq 0 (
    echo [FAIL] Ad blocking not working!
    echo Backend may need restart.
    goto :end
)

echo Checking if YouTube ad is blocked...
curl -s -X POST http://localhost:5000/check -H "Content-Type: application/json" -d "{\"url\":\"https://youtube.com/api/stats/ads\"}" | findstr /C:"\"shouldBlock\":true" >nul
if %errorlevel% neq 0 (
    echo [FAIL] YouTube ad not blocked!
    echo Backend may need restart.
    goto :end
)
echo [OK] YouTube ads will be blocked!
echo.

echo Test 4: Testing doubleclick ad blocking...
curl -s -X POST http://localhost:5000/check -H "Content-Type: application/json" -d "{\"url\":\"https://doubleclick.net/ad.js\"}" | findstr /C:"\"shouldBlock\":true" >nul
if %errorlevel% neq 0 (
    echo [FAIL] Doubleclick ad not blocked!
    echo Backend may need restart.
    goto :end
)
echo [OK] Doubleclick ads will be blocked!
echo.

echo ======================================================================
echo ALL TESTS PASSED!
echo ======================================================================
echo.
echo Backend service is working correctly!
echo.
echo Next steps:
echo 1. Start the browser: npm start
echo 2. Open DevTools (F12) and check console
echo 3. Look for: [UNIFIED BLOCKER] Connected to Brave engine backend!
echo 4. Test on YouTube - ads should be COMPLETELY BLOCKED!
echo.

:end
pause
