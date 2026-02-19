@echo off
REM Start both spaCy NLP server and Node.js backend in separate windows

echo Starting WebSense-AI Voice Control Servers...
echo.

REM Start spaCy server in new window
echo [1/2] Starting spaCy NLP Server...
start "spaCy NLP Server" cmd /k "cd backend\nlp && call venv\Scripts\activate.bat && python spacy_server.py"

REM Wait a bit for spaCy to start
timeout /t 3 /nobreak >nul

REM Start Node.js backend in new window
echo [2/2] Starting Node.js Backend...
start "Node.js Backend" cmd /k "cd backend && npm start"

echo.
echo ✅ Both servers are starting in separate windows!
echo.
echo You should see:
echo   - spaCy NLP Server on http://localhost:5001
echo   - Node.js Backend on http://localhost:3000
echo.
echo Press any key to close this window (servers will keep running)
pause >nul
