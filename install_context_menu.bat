@echo off
title Antigravity - Context Menu Manager

echo ===================================================
echo   Antigravity - Right-Click Context Menu Manager
echo ===================================================
echo.
echo This tool manages the "Open with Antigravity (Debug)" option
echo in your Windows Right-Click context menu.
echo.
echo WHAT IT DOES:
echo   - Adds/Removes a new option when you right-click a folder
echo   - Clicking it will run: antigravity . --remote-debugging-port=9000
echo   - This launches Antigravity with debugging enabled for Phone Connect
echo.
echo REQUIREMENTS:
echo   - Antigravity CLI must be installed and in your PATH
echo   - Administrator access (UAC prompt will appear)
echo.
echo ===================================================
echo.
echo Choose an option:
echo   [1] Install   - Add Right-Click menu
echo   [2] Remove    - Remove Right-Click menu
echo   [3] Backup    - Export current registry keys before changes
echo   [4] Exit
echo.

set /p "choice=Enter choice (1-4): "

if "%choice%"=="1" goto install
if "%choice%"=="2" goto remove
if "%choice%"=="3" goto backup
if "%choice%"=="4" goto end
echo [ERROR] Invalid choice.
pause
exit /b

:backup
echo.
echo [BACKUP] Exporting registry keys...
set "BACKUP_FILE=%~dp0context_menu_backup_%date:~-4%%date:~3,2%%date:~0,2%.reg"
reg export "HKEY_CLASSES_ROOT\Directory\Background\shell\AntigravityDebug" "%BACKUP_FILE%" /y 2>nul
reg export "HKEY_CLASSES_ROOT\Directory\shell\AntigravityDebug" "%BACKUP_FILE%" /y 2>nul
if exist "%BACKUP_FILE%" (
    echo [SUCCESS] Backup saved to: %BACKUP_FILE%
) else (
    echo [INFO] No existing Antigravity context menu found to backup.
)
echo.
pause
exit /b

:install
echo.
echo [INSTALL] Adding registry entries...

:: Add to folder background (right-click empty space in folder)
powershell -Command "Start-Process reg -ArgumentList 'add \"HKEY_CLASSES_ROOT\Directory\Background\shell\AntigravityDebug\" /ve /d \"Open with Antigravity (Debug)\" /f' -Verb RunAs -Wait" 2>nul
powershell -Command "Start-Process reg -ArgumentList 'add \"HKEY_CLASSES_ROOT\Directory\Background\shell\AntigravityDebug\command\" /ve /d \"cmd /c cd /d %%V ^&^& antigravity . --remote-debugging-port=9000\" /f' -Verb RunAs -Wait" 2>nul

:: Add to folder itself (right-click on a folder)
powershell -Command "Start-Process reg -ArgumentList 'add \"HKEY_CLASSES_ROOT\Directory\shell\AntigravityDebug\" /ve /d \"Open with Antigravity (Debug)\" /f' -Verb RunAs -Wait" 2>nul
powershell -Command "Start-Process reg -ArgumentList 'add \"HKEY_CLASSES_ROOT\Directory\shell\AntigravityDebug\command\" /ve /d \"cmd /c cd /d %%1 ^&^& antigravity . --remote-debugging-port=9000\" /f' -Verb RunAs -Wait" 2>nul

echo.
echo [SUCCESS] Context menu installed!
echo.
echo You can now right-click any folder and select:
echo   "Open with Antigravity (Debug)"
echo.
pause
exit /b

:remove
echo.
echo [REMOVE] Deleting registry entries...

powershell -Command "Start-Process reg -ArgumentList 'delete \"HKEY_CLASSES_ROOT\Directory\Background\shell\AntigravityDebug\" /f' -Verb RunAs -Wait" 2>nul
powershell -Command "Start-Process reg -ArgumentList 'delete \"HKEY_CLASSES_ROOT\Directory\shell\AntigravityDebug\" /f' -Verb RunAs -Wait" 2>nul

echo.
echo [SUCCESS] Context menu removed!
echo.
echo The "Open with Antigravity (Debug)" option has been removed.
echo.
pause
exit /b

:end
echo [EXIT] No changes made.
exit /b
