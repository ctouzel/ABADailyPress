@echo off
echo Deleting contents of News folder...
rd /s /q "D:\ABADailyPress\News"
mkdir "D:\ABADailyPress\News"

echo Copying new content...
xcopy "C:\Users\rockn\OneDrive\Documents\Out of the Park Developments\OOTP Baseball 26\saved_games\American Baseball Association2.lg\news\html\*" "D:\ABADailyPress\News\" /E /H /C /I /Y

echo Copy completed!

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