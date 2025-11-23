@echo off
REM Complete setup script for WebSense-AI with spaCy integration

echo.
echo ================================================================
echo    WebSense-AI Voice Control - Complete Setup with spaCy
echo ================================================================
echo.
echo This will install everything needed for intelligent voice control:
echo   - Node.js backend dependencies
echo   - Python virtual environment
echo   - Flask web server
echo   - spaCy NLP library
echo   - English language model
echo.
echo Estimated time: 5-10 minutes
echo.
pause

REM Check for Python
echo [1/6] Checking Python installation...
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo ❌ ERROR: Python not found!
    echo.
    echo Please install Python 3.8 or higher from:
    echo https://www.python.org/downloads/
    echo.
    echo Make sure to check "Add Python to PATH" during installation
    pause
    exit /b 1
)
python --version
echo ✅ Python is installed

REM Check for Node.js
echo.
echo [2/6] Checking Node.js installation...
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo ❌ ERROR: Node.js not found!
    echo.
    echo Please install Node.js from:
    echo https://nodejs.org/
    pause
    exit /b 1
)
node --version
npm --version
echo ✅ Node.js is installed

REM Install Node.js dependencies
echo.
echo [3/6] Installing Node.js dependencies...
cd backend
if not exist "package.json" (
    echo ❌ ERROR: package.json not found in backend folder
    pause
    exit /b 1
)
call npm install
if %errorlevel% neq 0 (
    echo ❌ Failed to install Node.js dependencies
    pause
    exit /b 1
)
echo ✅ Node.js dependencies installed
cd ..

REM Set up Python environment
echo.
echo [4/6] Setting up Python virtual environment...
cd backend\nlp
if not exist "requirements.txt" (
    echo ❌ ERROR: requirements.txt not found
    pause
    exit /b 1
)

echo Creating virtual environment...
python -m venv venv
if %errorlevel% neq 0 (
    echo ❌ Failed to create virtual environment
    pause
    exit /b 1
)

echo Activating virtual environment...
call venv\Scripts\activate.bat

echo Installing Python packages...
python -m pip install --upgrade pip
pip install -r requirements.txt
if %errorlevel% neq 0 (
    echo ❌ Failed to install Python packages
    pause
    exit /b 1
)
echo ✅ Python packages installed

REM Download spaCy model
echo.
echo [5/6] Downloading spaCy English language model...
echo This may take 2-3 minutes...
python -m spacy download en_core_web_sm
if %errorlevel% neq 0 (
    echo ⚠️  Warning: Failed to download model
    echo You can try manually: python -m spacy download en_core_web_sm
    pause
) else (
    echo ✅ spaCy model downloaded
)

REM Create .env file
echo.
echo [6/6] Setting up environment configuration...
cd ..\..
if not exist "backend\.env" (
    if exist "backend\.env.example" (
        copy backend\.env.example backend\.env
        echo ✅ Created .env file from example
    ) else (
        echo PORT=3000 > backend\.env
        echo SPACY_SERVER_URL=http://localhost:5001 >> backend\.env
        echo ✅ Created default .env file
    )
) else (
    echo ℹ️  .env file already exists, skipping
)

REM Success message
echo.
echo ================================================================
echo                    🎉 SETUP COMPLETE! 🎉
echo ================================================================
echo.
echo Everything is installed and ready to use!
echo.
echo NEXT STEPS:
echo.
echo 1. Start the spaCy NLP server:
echo    ^> cd backend\nlp
echo    ^> start_server.bat
echo.
echo 2. In a NEW terminal, start the Node.js backend:
echo    ^> cd backend
echo    ^> npm start
echo.
echo 3. Load the Chrome extension:
echo    - Open chrome://extensions
echo    - Enable "Developer mode"
echo    - Click "Load unpacked"
echo    - Select the "extension" folder
echo.
echo 4. Test your voice control!
echo    - Say "show buttons"
echo    - Say "scroll down"
echo    - Say "help"
echo.
echo ================================================================
echo.
echo 📖 Documentation:
echo    - Quick Start: QUICKSTART.md
echo    - Full Guide:  backend\nlp\README.md
echo    - Comparison:  docs\SPACY_VS_PATTERNS.md
echo.
echo 🧪 Test the NLP:
echo    ^> cd backend\nlp
echo    ^> python test_nlp.py -i
echo.
echo ================================================================
echo.
pause
