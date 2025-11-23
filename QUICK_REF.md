# ⚡ Quick Reference Card - spaCy Voice Control

## 🚀 Installation (First Time)
```cmd
INSTALL.bat
```

## ▶️ Start Servers
```cmd
START_SERVERS.bat
```
Or manually in 2 terminals:
```cmd
# Terminal 1
cd backend\nlp && start_server.bat

# Terminal 2
cd backend && npm start
```

## ✅ Verify Running
```cmd
curl http://localhost:5001/health  # spaCy
curl http://localhost:3000/health  # Node.js
```

## 🧪 Test Commands
```cmd
cd backend\nlp
python test_nlp.py "show all buttons"  # Single test
python test_nlp.py -i                  # Interactive
python test_nlp.py -t                  # Run all tests
```

## 🎤 Voice Commands

### Elements
✅ show buttons | show links | show menus | show inputs

### Click
✅ click button three | click first button | click button submit

### Scroll
✅ scroll down | scroll up | go to top | go to bottom

### Navigate
✅ go back | go forward | reload | refresh

### Tabs
✅ new tab | close tab | duplicate tab

### Zoom
✅ zoom in | zoom out | reset zoom

### Control
✅ help | stop listening

## 🎯 Natural Language Examples
- "Could you please show me all the buttons?"
- "I want to see the links"
- "Can you click the first button?"
- "Please scroll down"
- "I would like to open a new tab"

## 🔧 Toggle NLP On/Off
Edit: `extension/src/features/voice/voiceControl.js`
```javascript
const USE_NLP_BACKEND = true; // false = pattern matching
```

## 📊 Check Parsing
Browser Console (F12):
```
🧠 NLP parsed: {action: "show", target: "button", confidence: 0.7}
```

## 🐛 Troubleshooting

| Issue | Fix |
|-------|-----|
| spaCy won't start | `cd backend\nlp && setup.bat` |
| "NLP unavailable" | Check port 5001 is free |
| Commands fail | Check both servers running |
| Extension error | F12 console for details |

## 📁 Key Files

| File | Purpose |
|------|---------|
| `INSTALL.bat` | Setup everything |
| `START_SERVERS.bat` | Start both servers |
| `backend/nlp/spacy_server.py` | NLP engine |
| `backend/server.js` | API gateway |
| `extension/src/features/voice/voiceControl.js` | Voice logic |

## 🔗 Endpoints
- spaCy Health: `http://localhost:5001/health`
- spaCy Parse: `http://localhost:5001/parse`
- API Health: `http://localhost:3000/health`
- API Parse: `http://localhost:3000/api/voice/parse`

## 📚 Documentation
- Quick Start: `QUICKSTART.md`
- Full Guide: `backend/nlp/README.md`
- Comparison: `docs/SPACY_VS_PATTERNS.md`
- Architecture: `docs/ARCHITECTURE_DIAGRAM.md`
- Summary: `PROJECT_SUMMARY.md`

## 💡 Tips
1. Keep server terminals open to see logs
2. Test with `test_nlp.py` before browser
3. Check browser console (F12) for debugging
4. Both servers must run simultaneously
5. Extension works even if NLP is down (fallback)

---

**Happy voice controlling! 🎤🧠**
