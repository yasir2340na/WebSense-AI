# 🚀 Extension Testing Guide

## ✅ Extension Built Successfully!

The WebSense-AI Chrome Extension has been built and is ready for testing.

**Build Location:** `E:\WebSense-AI spaCy\extension\dist\`

---

## 📋 Pre-Testing Checklist

### 1. Backend Servers Must Be Running
```cmd
START_SERVERS.bat
```

**Verify servers are running:**
- ✅ spaCy NLP Server: http://localhost:5001
- ✅ Node.js API Gateway: http://localhost:3000

**Test the servers:**
- Open http://localhost:3000/health in browser
- Should see: `{"status":"healthy",...}`

---

## 🔧 Installation Steps

### Step 1: Open Chrome Extensions Page
1. Open Google Chrome
2. Navigate to: `chrome://extensions/`
3. Or click: **⋮** (three dots) → **Extensions** → **Manage Extensions**

### Step 2: Enable Developer Mode
1. Find the **"Developer mode"** toggle in the top-right corner
2. Click to enable it (should turn blue)

### Step 3: Load the Extension
1. Click **"Load unpacked"** button (appears after enabling Developer mode)
2. Navigate to: `E:\WebSense-AI spaCy\extension\dist`
3. Click **"Select Folder"**

### Step 4: Verify Installation
You should see:
- ✅ Extension card labeled "WebSense-AI"
- ✅ Version 1.0
- ✅ No errors in red text
- ✅ Extension icon in Chrome toolbar (top-right)

---

## 🧪 Testing the Extension

### Test 1: Open the Popup
1. Click the **WebSense-AI** icon in Chrome toolbar
2. Popup should open showing:
   - Header: "🎤 WebSense-AI Voice Control"
   - Tabs: Home | Voice Control | Settings
   - Server status indicator

**Expected Result:** ✅ Popup displays correctly with all tabs

---

### Test 2: Check Server Status
1. Open extension popup
2. Go to **Voice Control** tab
3. Look at the status card at top

**Expected Results:**
- 🟢 Green indicator if servers are running
- Status: "Connected (http://localhost:3000)"
- 🔴 Red indicator if servers are offline

**If servers are offline:**
```cmd
cd "E:\WebSense-AI spaCy"
START_SERVERS.bat
```

---

### Test 3: Test NLP Parser (Interactive)
1. Open extension popup
2. Go to **Voice Control** tab
3. Enable **"Test NLP Parser"** toggle
4. Click test command buttons like **"show all buttons"**

**Expected Results:**
- ✅ Command appears in result area
- ✅ Parsed data shows:
  - Action: show
  - Target: button
  - Confidence: ~70%
- ✅ Confidence bar displays correctly

**Try these test commands:**
- "show all buttons" → Action: show, Target: button
- "click the first link" → Action: click, Target: link, Direction: first
- "scroll down" → Action: scroll, Direction: down

---

### Test 4: Inject Voice Control into Page
1. Open a test webpage (e.g., https://example.com)
2. Click WebSense-AI extension icon
3. Go to **Voice Control** tab
4. Click **"🎤 Start Voice Control"**

**Expected Results:**
- ✅ Button changes to "🔴 Listening..."
- ✅ Floating microphone button appears on webpage (bottom-right)
- ✅ You can drag the microphone button around
- ✅ No console errors

---

### Test 5: Voice Recognition
1. After injecting voice control (Test 4)
2. Click the **floating microphone button** on the webpage
3. Microphone should turn **red** (listening)
4. Say a command: **"show all buttons"**

**Expected Results:**
- ✅ Status popup appears above mic showing "Listening..."
- ✅ Your speech is recognized
- ✅ Command is sent to NLP backend
- ✅ Buttons on page are highlighted/outlined
- ✅ Status shows "Processing..." then result

**If speech recognition doesn't work:**
- Check browser permissions (mic access)
- Verify you're on HTTPS or localhost
- Try Chrome://flags and enable "Experimental Web Platform features"

---

### Test 6: Settings Configuration
1. Open extension popup
2. Go to **Settings** tab
3. Modify settings:
   - Backend URL: http://localhost:3000
   - Enable "Use NLP Backend"
   - Set confidence threshold: 60%
4. Click **"💾 Save Settings"**

**Expected Results:**
- ✅ Settings save successfully
- ✅ Alert shows: "✅ Settings saved successfully!"
- ✅ "Test Connection" button works

---

## 🎤 Voice Commands to Test

### Basic Navigation
```
"scroll down"
"scroll up"
"go back"
"go forward"
"refresh page"
```

### Element Discovery
```
"show all buttons"
"show all links"
"highlight input fields"
"find images on this page"
```

### Element Interaction
```
"click the first button"
"click the first link"
"press the submit button"
```

### Advanced Commands
```
"scroll down three times"
"click the second link"
"show me all red buttons"
```

---

## 🐛 Troubleshooting

### Issue: Extension won't load
**Symptoms:** Error when loading unpacked extension

**Solutions:**
1. Make sure you selected the `dist` folder, not `extension` folder
2. Check for errors in console: Right-click extension → Inspect popup
3. Rebuild extension:
   ```cmd
   cd "E:\WebSense-AI spaCy\extension"
   npm run build
   ```

---

### Issue: Server status shows "Offline"
**Symptoms:** Red status indicator, can't test commands

**Solutions:**
1. Start the servers:
   ```cmd
   START_SERVERS.bat
   ```
2. Verify servers:
   - Visit: http://localhost:3000/health
   - Visit: http://localhost:5001/health
3. Check firewall isn't blocking ports 3000 and 5001

---

### Issue: Voice recognition not working
**Symptoms:** Clicking mic does nothing, no "Listening..." status

**Solutions:**
1. Check microphone permissions:
   - Chrome Settings → Privacy → Site Settings → Microphone
   - Allow the website to use microphone
2. Use HTTPS or localhost (required for Web Speech API)
3. Try a different browser or update Chrome
4. Check browser console for errors (F12)

---

### Issue: Commands not executing
**Symptoms:** Voice recognized but nothing happens on page

**Solutions:**
1. Check confidence score - might be too low
2. Lower confidence threshold in Settings tab
3. Check browser console (F12) for errors
4. Verify NLP backend is responding:
   ```cmd
   curl -X POST http://localhost:3000/api/voice/parse -H "Content-Type: application/json" -d "{\"text\":\"show all buttons\"}"
   ```

---

### Issue: Floating button not appearing
**Symptoms:** Clicked "Start Voice Control" but no mic button on page

**Solutions:**
1. Refresh the page and try again
2. Check if script injection is blocked by CSP (Content Security Policy)
3. Try on a simple page first (like example.com)
4. Check browser console for injection errors
5. Verify extension permissions in chrome://extensions/

---

## 📊 Expected Performance

### Response Times
| Operation | Expected Time |
|-----------|---------------|
| Popup open | < 100ms |
| Server status check | < 200ms |
| NLP command parse | ~150ms |
| Voice recognition | 1-3 seconds |
| Element highlighting | < 50ms |

### Accuracy
| Command Type | Expected Accuracy |
|--------------|-------------------|
| Simple navigation | ~95% |
| Element selection | ~85% |
| Complex commands | ~80% |
| Overall average | ~85% |

---

## 🎯 Test Scenarios

### Scenario 1: Complete Workflow Test
1. ✅ Start backend servers
2. ✅ Load extension in Chrome
3. ✅ Open test webpage
4. ✅ Inject voice control
5. ✅ Click floating mic button
6. ✅ Say "show all buttons"
7. ✅ Verify buttons are highlighted
8. ✅ Say "click the first button"
9. ✅ Verify button is clicked

**Success Criteria:** All steps complete without errors

---

### Scenario 2: NLP Accuracy Test
1. ✅ Enable test mode in popup
2. ✅ Test all 6 example commands
3. ✅ Verify parsed results:
   - Actions extracted correctly
   - Targets identified properly
   - Confidence scores reasonable (>50%)

**Success Criteria:** 5 out of 6 commands parse correctly

---

### Scenario 3: Settings Persistence Test
1. ✅ Change settings (backend URL, confidence, etc.)
2. ✅ Save settings
3. ✅ Close popup
4. ✅ Reopen popup
5. ✅ Verify settings persisted

**Success Criteria:** Settings saved and restored correctly

---

## 📝 Test Results Template

```
Test Date: ___________
Tester: ___________

Backend Servers:
[ ] spaCy Server Running (Port 5001)
[ ] Node.js Server Running (Port 3000)

Extension Installation:
[ ] Extension loaded successfully
[ ] No errors in chrome://extensions/
[ ] Popup opens correctly

Voice Control Tests:
[ ] Mic button appears on page
[ ] Voice recognition works
[ ] Commands execute correctly
[ ] Status updates displayed

NLP Parser Tests:
[ ] "show all buttons" → Correct parsing
[ ] "click the first link" → Correct parsing
[ ] "scroll down" → Correct parsing
[ ] Confidence scores reasonable

Issues Found:
1. ___________________________
2. ___________________________
3. ___________________________

Overall Assessment:
[ ] ✅ PASS - Extension works as expected
[ ] ⚠️ PARTIAL - Works with minor issues
[ ] ❌ FAIL - Critical issues prevent usage

Notes:
_________________________________
_________________________________
```

---

## 🎉 Success Indicators

You'll know everything is working when:

1. ✅ **Server Status:** Green indicator in popup
2. ✅ **Extension Icon:** Visible in Chrome toolbar
3. ✅ **Popup UI:** All tabs load without errors
4. ✅ **Test Commands:** Parse correctly with confidence >50%
5. ✅ **Voice Button:** Appears on page when injected
6. ✅ **Voice Recognition:** Mic turns red when listening
7. ✅ **Command Execution:** Page elements respond to commands
8. ✅ **No Console Errors:** F12 console shows no red errors

---

## 📚 Additional Resources

- **Command Reference:** See `COMMANDS_CHEATSHEET.md`
- **API Documentation:** See `docs/API_DOCUMENTATION.md`
- **Architecture Details:** See `PROJECT_SUMMARY.md`
- **Troubleshooting:** See `INSTALLATION_COMPLETE.md`

---

## 🆘 Getting Help

If you encounter issues:

1. Check browser console (F12) for errors
2. Check extension service worker logs:
   - chrome://extensions/
   - Click "service worker" under WebSense-AI
3. Check server logs in terminal windows
4. Review this testing guide's troubleshooting section
5. Verify all files exist in `extension/dist/`:
   - index.html
   - background.js
   - content.js
   - voiceControl.js
   - manifest.json
   - assets/ folder

---

**Ready to test? Start here:**

```cmd
REM 1. Start servers
START_SERVERS.bat

REM 2. Open Chrome
start chrome chrome://extensions/

REM 3. Load extension from:
E:\WebSense-AI spaCy\extension\dist
```

**Happy Testing! 🎤✨**
