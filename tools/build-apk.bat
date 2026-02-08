@echo off
REM Build and prepare Android APK for distribution

echo Building Android APK...

REM Build the debug APK
call npm run android:build

REM Copy to downloads directory
echo Copying APK to downloads directory...
copy android\app\build\outputs\apk\debug\app-debug.apk downloads\taskflow.apk

echo.
echo ✅ APK built and copied to downloads\taskflow.apk
echo.
echo Next steps:
echo 1. Upload to VPS: scp downloads\taskflow.apk user@simplytasks.simplifiedsuite.com:/path/to/todo_app/downloads/
echo 2. Download URL: https://simplytasks.simplifiedsuite.com/download/app
