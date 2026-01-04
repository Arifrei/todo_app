#!/bin/bash
# Build and prepare Android APK for distribution

echo "Building Android APK..."

# Build the release APK
npm run android:build

# Copy to downloads directory
echo "Copying APK to downloads directory..."
cp android/app/build/outputs/apk/debug/app-debug.apk downloads/taskflow.apk

echo "✅ APK built and copied to downloads/taskflow.apk"
echo ""
echo "Next steps:"
echo "1. Upload to VPS: scp downloads/taskflow.apk user@simplytasks.simplifiedsuite.com:/path/to/todo_app/downloads/"
echo "2. Download URL: https://simplytasks.simplifiedsuite.com/download/app"
