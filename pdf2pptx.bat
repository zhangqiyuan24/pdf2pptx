@echo off
rem ============================================================
rem  pdf2pptx - convert single-page vector PDF figures into
rem             natively editable PPTX (shapes / text boxes / images)
rem  usage: drag a PDF file or a folder onto this bat,
rem         or double-click and type a path
rem  needs: Node.js (https://nodejs.org) + npm install in this folder
rem ============================================================
setlocal enabledelayedexpansion
set "TOOL=%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] node not found. Install Node.js: https://nodejs.org
  pause
  exit /b 1
)
if not exist "%TOOL%node_modules\mupdf" (
  echo [ERROR] dependencies missing. Run: npm install
  pause
  exit /b 1
)

set "IN=%~1"
if "%IN%"=="" set /p "IN=Input PDF file or folder path: "
if "%IN%"=="" ( echo [ERROR] empty path & pause & exit /b 1 )
if not exist "%IN%" ( echo [ERROR] path not found: %IN% & pause & exit /b 1 )

set "TMPD=%TEMP%\pdf2pptx_%RANDOM%"
mkdir "%TMPD%" 2>nul

if exist "%IN%\*" goto dir

rem ---------- single PDF file ----------
echo Converting: %~nx1
node "%TOOL%pdf2svg.mjs" "%IN%" "%TMPD%\s001.svg"
if errorlevel 1 goto fail
node "%TOOL%svg2pptx.mjs" "%TMPD%" -o "%~dp1%~n1_editable.pptx"
if errorlevel 1 goto fail
set "FINAL=%~dp1%~n1_editable.pptx"
goto done

:dir
set N=0
for %%F in ("%IN%\*.pdf") do (
  set /a N+=1
  echo Converting [!N!]: %%~nxF
  node "%TOOL%pdf2svg.mjs" "%%~fF" "%TMPD%\%%~nF.svg"
  if errorlevel 1 goto fail
)
if %N%==0 ( echo [ERROR] no PDF in folder & rd /s /q "%TMPD%" 2>nul & pause & exit /b 1 )
for %%I in ("%IN%") do set "BASE=%%~nxI"
node "%TOOL%svg2pptx.mjs" "%TMPD%" -o "%IN%\%BASE%_editable.pptx"
if errorlevel 1 goto fail
set "FINAL=%IN%\%BASE%_editable.pptx"

:done
rd /s /q "%TMPD%" 2>nul
echo.
echo [OK] %FINAL%
echo      open-edit: curves = freeform shapes, text = text boxes, images = pictures
pause
exit /b 0

:fail
rd /s /q "%TMPD%" 2>nul
echo.
echo [ERROR] convert failed, see messages above.
pause
exit /b 1
