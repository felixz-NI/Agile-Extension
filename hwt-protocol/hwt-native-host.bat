@echo off
REM hwt-native-host.bat
REM Wrapper that launches the PowerShell native messaging host. Native
REM messaging manifests must point to an executable; this .bat is that target.
REM %~dp0 is this file's folder (with trailing backslash).
powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0hwt-native-host.ps1"
