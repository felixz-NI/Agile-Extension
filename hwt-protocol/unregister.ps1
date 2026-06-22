<#
    unregister.ps1
    Removes the "hwt://" URL protocol for the current user.

    Run:
        powershell -NoProfile -ExecutionPolicy Bypass -File .\unregister.ps1
#>

$ErrorActionPreference = 'Stop'
$scheme = 'hwt'
$base   = "HKCU:\Software\Classes\$scheme"

if (Test-Path $base) {
    Remove-Item -Path $base -Recurse -Force
    Write-Host "Removed '${scheme}://' protocol for current user." -ForegroundColor Yellow
} else {
    Write-Host "'${scheme}://' was not registered for current user."
}

# --- Native messaging host (hwt_urls_host) ---
$hostName = 'hwt_urls_host'
foreach ($key in @(
    "HKCU:\Software\Mozilla\NativeMessagingHosts\$hostName",
    "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$hostName",
    "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\$hostName"
)) {
    if (Test-Path $key) {
        Remove-Item -Path $key -Recurse -Force
        Write-Host "Removed native host registry: $key" -ForegroundColor Yellow
    }
}
