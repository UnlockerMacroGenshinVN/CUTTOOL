@echo off
:: ============================================================
:: CUTTOOL UnlockerIsland - Launch Script
:: Chỉnh sửa GAME_PATH bên dưới thành đường dẫn đúng của bạn
:: ============================================================

set GAME_PATH=C:\Program Files\HoYoPlay\games\Genshin Impact game\GenshinImpact.exe

:: ============================================================
:: KHÔNG cần sửa gì bên dưới đây
:: ============================================================

set LAUNCHER=%~dp0Launcher_2.exe
set PLUGINS_DIR=%~dp0Plugins\UnlockerIsland

:: Kiểm tra game tồn tại
if not exist "%GAME_PATH%" (
    echo [ERROR] Khong tim thay game tai:
    echo         %GAME_PATH%
    echo.
    echo Hay chinh sua GAME_PATH trong file nay cho dung.
    pause
    exit /b 1
)

:: Kiểm tra launcher tồn tại
if not exist "%LAUNCHER%" (
    echo [ERROR] Khong tim thay Launcher_2.exe
    echo Chay build.bat truoc de build du an.
    pause
    exit /b 1
)

:: Tạo thư mục Plugins\UnlockerIsland nếu chưa có
if not exist "%PLUGINS_DIR%" (
    mkdir "%PLUGINS_DIR%"
)

:: Tao config.ini cho plugin neu chua co
if not exist "%PLUGINS_DIR%\config.ini" (
    if exist "%~dp0config.ini" (
        copy /Y "%~dp0config.ini" "%PLUGINS_DIR%\config.ini" >nul 2>&1
    ) else (
        (
        echo File=CUTTOOL.UnlockerIsland.dll
        echo.
        echo [DebugConsole]
        echo Value=0
        echo.
        echo [FpsUnlock]
        echo Value=0
        echo.
        echo [TargetFps]
        echo Value=60
        echo.
        echo [VSync]
        echo Value=1
        echo.
        echo [FovUnlock]
        echo Value=0
        echo.
        echo [FovValue]
        echo Value=45.0
        echo.
        echo [DisableCameraMove]
        echo Value=0
        echo.
        echo [RemoveTeamAnim]
        echo Value=0
        echo.
        echo [DisableFog]
        echo Value=0
        echo.
        echo [HideUID]
        echo Value=0
        echo.
        echo [BlockNetwork]
        echo Value=0
        echo.
        echo [EnableNetworkToggle]
        echo Value=0
        echo.
        echo [NetworkToggleKey]
        echo Value=122
        echo.
        echo [ToggleKey]
        echo Value=36
        echo.
        echo [DumpOffsets]
        echo Value=0
        ) > "%PLUGINS_DIR%\config.ini"
    )
    echo [INFO] Da tao Plugins\UnlockerIsland\config.ini
)

:: Copy DLL vào thư mục plugin nếu chưa có
if not exist "%PLUGINS_DIR%\CUTTOOL.UnlockerIsland.dll" (
    copy /Y "%~dp0CUTTOOL.UnlockerIsland.dll" "%PLUGINS_DIR%\" >nul 2>&1
    if exist "%PLUGINS_DIR%\CUTTOOL.UnlockerIsland.dll" (
        echo [INFO] Da copy DLL vao thu muc plugin.
    ) else (
        echo [WARN] Khong the copy DLL. Hay copy thu cong:
        echo        CUTTOOL.UnlockerIsland.dll ^> Plugins\UnlockerIsland\
    )
)

echo [*] Dang khoi dong game voi DLL injection...
start "" "%LAUNCHER%" "%GAME_PATH%"
