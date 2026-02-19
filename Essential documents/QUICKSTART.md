# Quick Start Guide - spaCy Voice Control

## 🚀 First Time Setup (5 minutes)

### 1. Install Python Dependencies
```cmd
cd backend\nlp
setup.bat
```
Wait for it to complete (~2-3 minutes)

### 2. Install Node.js Dependencies
```cmd
cd ..
npm install
```

### 3. Create Environment File
```cmd
copy .env.example .env
```

## ▶️ Running the System

### Terminal 1 - Start spaCy Server
```cmd
cd backend\nlp
start_server.bat
```
✅ Should show: "Server running on http://localhost:5001"

### Terminal 2 - Start Node.js Backend
```cmd
cd backend
npm start
```
✅ Should show: "Server running on http://localhost:3000"

### Terminal 3 (Optional) - Test NLP
```cmd
cd backend\nlp
python test_nlp.py -i
```
Type commands to test parsing

## ✅ Verify It's Working

### Test 1: spaCy Server
```cmd
curl http://localhost:5001/health
```
Should return: `{"status":"healthy"}`

### Test 2: Node.js API
```cmd
curl -X POST http://localhost:3000/api/voice/parse -H "Content-Type: application/json" -d "{\"text\":\"show buttons\"}"
```
Should return parsed command data

### Test 3: Extension
1. Load extension in Chrome
2. Enable voice control
3. Say "show buttons"
4. Should highlight all buttons

## 🐛 Troubleshooting

**Problem:** spaCy server won't start
**Fix:** Make sure Python is installed, run `setup.bat` again

**Problem:** Node.js server error
**Fix:** Run `npm install` in backend folder

**Problem:** Extension shows error
**Fix:** Check both servers are running (green ✅ in consoles)

## 📝 Daily Use

Once set up, just run these two commands:
```cmd
# Terminal 1
cd backend\nlp && start_server.bat

# Terminal 2  
cd backend && npm start
```

Then use the extension!

## 💡 Tips

- Keep both terminal windows open while using voice control
- Use `test_nlp.py -i` to test commands before trying in browser
- Check browser console (F12) for detailed logs
- Set `USE_NLP_BACKEND = false` in voiceControl.js to disable NLP

---

**Ready?** Start both servers and try saying:
- "show all buttons"
- "click the first link"  
- "scroll down"
- "help"
