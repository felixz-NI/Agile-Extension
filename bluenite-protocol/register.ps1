<#
    register.ps1
    Registers the "bluenite://" URL protocol for the CURRENT USER.
    No administrator rights required (writes to HKCU).

    Run from this folder:
        powershell -NoProfile -ExecutionPolicy Bypass -File .\register.ps1

    After this, links like  bluenite://search/widget123  will launch
    bluenite-search.ps1 with the URL as its argument.
#>

$ErrorActionPreference = 'Stop'

$scheme  = 'bluenite'
$handler = Join-Path $PSScriptRoot 'bluenite-search.ps1'
$launcher = Join-Path $PSScriptRoot 'launch-hidden.vbs'

if (-not (Test-Path $handler)) {
    throw "Cannot find handler script at: $handler"
}
if (-not (Test-Path $launcher)) {
    throw "Cannot find launcher script at: $launcher"
}

# Launch through wscript.exe + a VBScript shim so NO console window flashes.
# powershell.exe is a console app, so even -WindowStyle Hidden briefly shows
# its console host. wscript.exe has no console; the .vbs runs PowerShell fully
# hidden. "%1" is the full URL the browser passes.
$wscript = Join-Path $env:WINDIR 'System32\wscript.exe'
$command = "`"$wscript`" `"$launcher`" `"%1`""

$base = "HKCU:\Software\Classes\$scheme"

New-Item -Path $base -Force | Out-Null
Set-ItemProperty -Path $base -Name '(default)'    -Value "URL:$scheme Protocol"
Set-ItemProperty -Path $base -Name 'URL Protocol' -Value ''

New-Item -Path "$base\shell\open\command" -Force | Out-Null
Set-ItemProperty -Path "$base\shell\open\command" -Name '(default)' -Value $command

Write-Host "Registered BlueNite for current user" -ForegroundColor Green
