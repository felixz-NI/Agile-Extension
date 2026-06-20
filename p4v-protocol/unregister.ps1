<#
    unregister.ps1
    Removes the "p4v://" URL protocol for the CURRENT USER (HKCU).

        powershell -NoProfile -ExecutionPolicy Bypass -File .\unregister.ps1
#>

$ErrorActionPreference = 'Stop'

$scheme = 'p4v'
$base   = "HKCU:\Software\Classes\$scheme"

if (Test-Path $base) {
    Remove-Item -Path $base -Recurse -Force
    Write-Host "Removed '${scheme}://' for current user." -ForegroundColor Green
} else {
    Write-Host "'${scheme}://' was not registered for current user." -ForegroundColor Yellow
}
