@echo off

echo Rebuilding newspaper

setlocal

cd /d "%~dp0"
node .\src\index.mjs

echo.
if errorlevel 1 (
  echo The daily rebuild did not finish successfully.
) else (
  echo The daily rebuild finished successfully.
)

echo Done.
pause