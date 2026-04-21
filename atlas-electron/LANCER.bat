@echo off
title Atlas Photographique — Chevalon
chcp 65001 >nul
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo  Node.js manquant — telecharger sur https://nodejs.org
    pause & exit /b 1
)
if not exist "node_modules" (
    echo  Installation des dependances...
    npm install --silent
)
findstr /C:"COLLE-TA-CLE-ICI" .env >nul 2>&1
if %errorlevel% equ 0 (
    echo.
    echo  Cle API manquante — ouvre .env et remplace COLLE-TA-CLE-ICI
    notepad .env
    pause & exit /b 1
)
echo  Lancement...
node server.js
pause
