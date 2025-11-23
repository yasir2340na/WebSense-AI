@echo off
REM Setup script for spaCy NLP server (Windows)

echo ========================================
echo WebSense-AI spaCy NLP Server Setup
echo ========================================
echo.

REM Check if Python is installed
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Python is not installed or not in PATH
    echo Please install Python 3.8 or higher from https://python.org
    pause
    exit /b 1
)

echo [1/4] Creating virtual environment...
python -m venv venv

echo [2/4] Activating virtual environment...
call venv\Scripts\activate.bat

echo [3/4] Installing Python packages...
pip install --upgrade pip
pip install -r requirements.txt

echo [4/4] Downloading spaCy language model...
python -m spacy download en_core_web_sm

echo.
echo ========================================
echo Setup complete!
echo ========================================
echo.
echo To start the server:
echo   1. Run: venv\Scripts\activate.bat
echo   2. Run: python spacy_server.py
echo.
echo Or simply run: start_server.bat
echo.

pause
