@echo off
title Build Atlas Chevalon — .exe
chcp 65001 >nul
echo.
echo  ╔═══════════════════════════════════════════════╗
echo  ║   BUILD — Atlas Chevalon                      ║
echo  ║   Génération de l'installateur Windows .exe   ║
echo  ╚═══════════════════════════════════════════════╝
echo.

node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo  ❌  Node.js manquant — https://nodejs.org
    pause & exit /b 1
)

echo  Installation des dépendances...
npm install
if %errorlevel% neq 0 ( echo  ❌  npm install a échoué & pause & exit /b 1 )

echo.
echo  Compilation Electron...
npx electron-builder --win --x64
if %errorlevel% neq 0 ( echo  ❌  Build échoué & pause & exit /b 1 )

echo.
echo  ✅  Build terminé !
echo  Le fichier installateur se trouve dans :  dist\
echo  Distribue le fichier  "Atlas Chevalon Setup X.X.X.exe"
echo.
pause
