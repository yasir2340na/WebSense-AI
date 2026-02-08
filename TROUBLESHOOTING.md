# 🔧 WebSense-AI Troubleshooting Guide

## Issue: Mic Icon Not Showing & App Not Listening

### **Quick Fix Checklist:**

#### 1. ✅ **Reload the Extension**
   ```
   1. Go to chrome://extensions/
   2. Find "WebSense-AI"
   3. Click the reload icon (🔄)
   4. Close and reopen any tabs where you want to use it
   ```

#### 2. ✅ **Activate Voice Control**
   - **Method 1:** Click the extension icon → Click "Activate Voice Control"
   - **Method 2:** Press `Ctrl+Shift+V` (or `Cmd+Shift+V` on Mac)
   - You should see a **blue mic button (🎤)** appear in the bottom-right corner

#### 3. ✅ **Check Browser Compatibility**
   - WebSense-AI requires **Google Chrome** or **Microsoft Edge**
   - Speech Recognition is NOT available in Firefox, Safari, or Brave
   - Must be on a regular webpage (NOT chrome://, edge://, or file:// URLs)

#### 4. ✅ **Test on the Test Page**
   - Open `e:\WebSense-AI spaCy\extension\test-page.html` in Chrome
   - Activate voice control
   - Look for the mic button
   - Check the console (F12) for diagnostic messages

---

## Common Errors & Solutions

### Error: "Cannot read properties of undefined (reading 'buttons')"
**Status:** ✅ FIXED (Latest Build)
- **Problem:** navigateWithSmartMatch was calling detectElements() which returns undefined
- **Solution:** Now uses elementCache directly with proper null checks
- **Action:** Reload extension: Go to `chrome://extensions/` → Click reload (🔄)
- This error should completely disappear after reload

### Error: "ReferenceError: clearHighlights is not defined"
**Status:** ✅ FIXED (Latest Build)
- **Problem:** Function was named removeHighlights but called as clearHighlights
- **Solution:** Changed all function calls to use correct name
- **Action:** Reload extension in Chrome
- Fixed in CANCEL command and "no/nope" handling

### Error: "Uncaught ReferenceError: userGesture is not defined"
**Status:** ✅ FIXED (Latest Build)
- **Problem:** Function parameter was missing
- **Solution:** Rebuilt extension with proper parameter definition
- **Action:** Reload extension: Go to `chrome://extensions/` → Click reload (🔄)
- This error should completely disappear after reload

### Issue: "Old highlights showing on new pages"
**Status:** ✅ FIXED (Latest Build)
- **Problem:** Highlights weren't cleaned up during page navigation
- **Solution:** Enhanced cleanup function to remove all highlights
- **Action:** Reload extension and test navigation
- Pages should be clean when loaded

### Error: "Permissions policy violation: unload is not allowed"
**Status:** ⚠️ NOT FROM OUR EXTENSION
- This error comes from the **website you're visiting**, not our extension
- Our extension uses `pagehide` and `visibilitychange` events (allowed)
- We removed all `beforeunload` event listeners
- **Safe to ignore** - doesn't affect extension functionality
- To verify: Check if error appears on different websites

### Error: "TTS ERROR: not-allowed"
**Status:** ✅ FIXED (Handled Gracefully)
- Chrome requires user interaction before playing audio (security policy)
- **Expected behavior:** Shows status message when auto-triggered
- **Solution:** Welcome message now plays AFTER you click the mic button
- Visual status message shows immediately: "Voice ready! Click mic to start"
- This is normal Chrome security - prevents websites from auto-playing audio
- **No console errors** after latest fix - handled gracefully

### Error: "Speech recognition error: aborted"
**Status:** ✅ FIXED (Auto-recovers)
- This happens during page navigation (normal behavior)
- Extension now auto-restarts recognition after navigation
- You won't notice any interruption - works seamlessly
- If it persists, check microphone permissions
- **No action needed** - automatic recovery

### Warning: "Canvas2D: Multiple readback operations..."
**Status:** ⚠️ NOT OUR ISSUE
- This warning comes from the **website you're visiting**
- The website is using Canvas API without optimization
- Our extension doesn't use Canvas
- Safe to ignore - doesn't affect extension functionality

### Error: "api/graphql 500" 
**Status:** ⚠️ NOT OUR ISSUE
- These errors come from the website you're visiting
- The website has its own GraphQL API that's failing
- Our extension doesn't use GraphQL
- Safe to ignore - doesn't affect extension functionality

### Error: "Could not load javascript 'content.js' for script"
**Status:** ✅ FIXED  - Build script now properly copies all required files
- Rebuild the extension: `cd extension && npm run build`

### Error: "Could not load manifest"
**Status:** ✅ FIXED
- Manifest now uses PNG icons instead of SVG
- Rebuild the extension: `cd extension && npm run build`

---

## Debugging Steps

### **Step 1: Check Console for Injection**
1. Open the webpage where you want to use voice control
2. Press `F12` to open DevTools
3. Go to **Console** tab
4. Activate voice control (extension icon or Ctrl+Shift+V)
5. Look for these messages:
   ```
   ✅ WebSense-AI Voice Control Injected ✅
   ✅ Voice control fully initialized and ready
   ```

### **Step 2: Verify Background Script**
1. Go to `chrome://extensions/`
2. Find WebSense-AI
3. Click "service worker" (or "background page")
4. Check console for messages:
   ```
   ✅ Voice control activated for domain: example.com
   📌 Attempting to inject into tab...
   ✅ Voice control injected into tab...
   ```

### **Step 3: Check Mic Button**
- Right-click the mic button → Inspect
- Verify the element ID is `ws-voice-btn`
- Check if it has proper styling (blue background, 60x60px, etc.)

### **Step 4: Test Speech Recognition**
1. Click the mic button
2. It should turn **green** and pulse
3. Say a command like "show me the buttons"
4. Check console for recognition events:
   ```
   🎤 Listening...
   🗣️ Heard: show me the buttons
   ```

---

## Files Generated During Build

After running `npm run build` in the extension folder, these files should exist:

```
extension/dist/
├── background.js          ✅ Service worker
├── content.js             ✅ Content script (minimal)
├── voiceControl.js        ✅ Main voice control logic (2760+ lines)
├── manifest.json          ✅ Extension manifest
├── index.html             ✅ Popup UI
├── icons/                 ✅ PNG icons
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── assets/                ✅ Built React app
    └── popup-*.js
```

**Missing voiceControl.js?**
- This was the main issue causing the mic not to appear
- Run: `cd extension && npm run build`
- Verify `dist/voiceControl.js` exists (should be ~2760 lines)

---

## Backend Server Status

Voice control requires the backend server for NLP processing:

### **Start Backend Server:**
```bash
cd backend
node server.js
```

### **Start NLP Server (spaCy):**
```bash
cd backend/nlp
python spacy_server.py
```

### **Verify Servers Are Running:**
- Backend: http://localhost:3000/health
- NLP: http://localhost:5000/health

---

## Step-by-Step: Fresh Installation

1. **Build Extension:**
   ```powershell
   cd "e:\WebSense-AI spaCy\extension"
   npm install
   npm run build
   ```

2. **Load in Chrome:**
   - Navigate to `chrome://extensions/`
   - Enable "Developer mode"
   - Click "Load unpacked"
   - Select: `e:\WebSense-AI spaCy\extension\dist`

3. **Start Backend Servers:**
   ```powershell
   # Terminal 1: Backend
   cd "e:\WebSense-AI spaCy\backend"
   npm install
   node server.js
   
   # Terminal 2: NLP Server
   cd "e:\WebSense-AI spaCy\backend\nlp"
   pip install -r requirements.txt
   python spacy_server.py
   ```

4. **Test the Extension:**
   - Open the test page: `extension/test-page.html`
   - Click extension icon → "Activate Voice Control"
   - Mic button should appear in bottom-right
   - Click mic and say "show me the buttons"

---

## Still Having Issues?

### Check these common mistakes:

1. **❌ Wrong URL Types:**
   - Extensions CANNOT run on: `chrome://`, `edge://`, `about:`, `file://`
   - ✅ Extensions CAN run on: `http://`, `https://`

2. **❌ Not Activated:**
   - You MUST click "Activate Voice Control" or press Ctrl+Shift+V
   - The extension doesn't auto-activate on every page

3. **❌ Microphone Permissions:**
   - Browser will ask for microphone permission
   - Check browser settings → Site Settings → Microphone

4. **❌ Port Conflicts:**
   - Backend must be on port 3000
   - NLP server must be on port 5000
   - Check if ports are already in use

5. **❌ Cache Issues:**
   - Clear browser cache
   - Hard refresh pages: `Ctrl+Shift+R`
   - Restart browser completely

---

## Console Errors Reference

| Error Message | Solution |
|--------------|----------|
| "Speech recognition not supported" | Use Chrome or Edge, not Firefox/Safari |
| "Failed to inject script" | Check if page allows extensions (not chrome://) |
| "Recognition already started" | This is normal, extension auto-retries |
| "Network error" | Check if backend servers are running |
| "CORS error" | Backend CORS is configured, restart servers |

---

## Performance Tips

1. **Extension only active on toggled domains:**
   - Voice control persists per domain after activation
   - Use Ctrl+Shift+V to toggle on/off

2. **Draggable mic button:**
   - Drag the mic button anywhere on screen
   - Position is saved per session

3. **Auto-pause when tab hidden:**
   - Voice recognition pauses when you switch tabs
   - Saves system resources automatically

---

## Need More Help?

Check these files for additional info:
- `QUICKSTART.md` - Quick setup guide  - `README.md` - Full documentation
- `TESTING_GUIDE.md` - Testing procedures
- `docs/USER_MANUAL.md` - Complete user manual
- `COMMANDS_CHEATSHEET.md` - All voice commands

**Console Commands for Debugging:**
```javascript
// In page console:
window.wsVoiceControlActive  // Should be true
window.wsRecognitionInstance // Should exist
document.getElementById('ws-voice-btn') // Should return button element

// In background service worker console:
chrome.storage.local.get(['activeDomains']) // Check active domains
```
