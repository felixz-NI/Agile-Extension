<#
    register.ps1
    Registers the "p4v://" URL protocol for the CURRENT USER (HKCU).
    No administrator rights required.

    Run from this folder:
        powershell -NoProfile -ExecutionPolicy Bypass -File .\register.ps1

    After this, links like  p4v://tree/%2F%2FManufacturing%2FBN%2F...
    launch p4v-go.ps1, which opens that depot path in P4V.
#>

$ErrorActionPreference = 'Stop'

$scheme  = 'p4v'
$handler = Join-Path $PSScriptRoot 'p4v-go.ps1'
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

Write-Host "Registered p4v for current user" -ForegroundColor Green
