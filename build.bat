@echo off
setlocal EnableDelayedExpansion

echo ===================================
echo   Building Skirk Macro App (Cryss)
echo ===================================

echo.
echo [1/2] Building Python backend (Cryss.exe)...

REM Create build folder if it doesn't exist
if not exist "build" mkdir "build"

REM Remove old build artifacts
if exist "build\temp" rmdir /s /q "build\temp"
if exist "build\dist" rmdir /s /q "build\dist"

cd build

REM PyInstaller flags:
REM  --collect-all pynput  : đảm bảo pynput bundled đầy đủ (Win10 compat)
REM  --hidden-import       : thêm các import ẩn cần cho runtime trên Win10
REM  --onefile --windowed  : build exe đơn, không hiện console
call pyinstaller ^
    --clean ^
    --noupx ^
    --onefile ^
    --windowed ^
    --name "Cryss" ^
    --workpath "temp" ^
    --specpath "temp" ^
    --distpath "dist" ^
    --collect-all pynput ^
    --hidden-import pynput.keyboard._win32 ^
    --hidden-import pynput.mouse._win32 ^
    "..\src\macro\main.py"

if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Failed to build Python backend!
    pause
    exit /b %errorlevel%
)

cd ..

echo.
echo [2/2] Building Electron UI...

cd src\UI

REM Remove previous Electron output
if exist "..\..\build\app" rmdir /s /q "..\..\build\app"

call pnpm package:win

if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Failed to build Electron UI!
    pause
    exit /b %errorlevel%
)

cd ..\..

echo.
echo ===================================
echo   BUILD SUCCESSFUL!
echo ===================================
echo.
echo Python backend:
echo   build\dist\Cryss.exe
echo.
echo Electron app:
echo   build\app\win-unpacked\Cryss.exe
echo.
pause