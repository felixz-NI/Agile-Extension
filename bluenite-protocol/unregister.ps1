<#
    unregister.ps1
    Removes the "bluenite://" URL protocol for the current user.

    Run:
        powershell -NoProfile -ExecutionPolicy Bypass -File .\unregister.ps1
#>

$ErrorActionPreference = 'Stop'
$scheme = 'bluenite'
$base   = "HKCU:\Software\Classes\$scheme"

if (Test-Path $base) {
    Remove-Item -Path $base -Recurse -Force
    Write-Host "Removed '${scheme}://' protocol for current user." -ForegroundColor Yellow
} else {
    Write-Host "'${scheme}://' was not registered for current user."
}
