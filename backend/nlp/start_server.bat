@echo off
REM Start the spaCy NLP server

echo Starting spaCy NLP Server...
call venv\Scripts\activate.bat
python spacy_server.py
