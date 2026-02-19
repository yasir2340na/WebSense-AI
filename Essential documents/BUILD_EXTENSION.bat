@echo off
echo.
echo ========================================
echo   Building WebSense-AI Extension
echo ========================================
echo.

REM Step 1: Build React popup with Vite
echo [1/4] Building React popup...
cd extension
call npm run build
if errorlevel 1 (
    echo ERROR: React build failed!
    pause
    exit /b 1
)

REM Step 2: Copy background script
echo [2/4] Copying background script...
copy src\background\background.js dist\background.js >nul
if not exist dist\background.js (
    echo ERROR: Failed to copy background.js
    pause
    exit /b 1
)

REM Step 3: Copy content script
echo [3/4] Copying content script...
copy src\content\content.js dist\content.js >nul

REM Step 4: Copy voice control script
echo [4/4] Copying voice control script...
copy src\features\voice\voiceControl.js dist\voiceControl.js >nul
if not exist dist\voiceControl.js (
    echo ERROR: Failed to copy voiceControl.js
    pause
    exit /b 1
)

echo.
echo ========================================
echo   Build Complete! ✅
echo ========================================
echo.
echo Extension built to: extension\dist\
echo.
echo Next steps:
echo 1. Open Chrome and go to chrome://extensions/
echo 2. Enable "Developer mode" (top right)
echo 3. Click "Load unpacked"
echo 4. Select folder: E:\WebSense-AI spaCy\extension\dist
echo.
echo Make sure backend servers are running:
echo   START_SERVERS.bat
echo.
pause
