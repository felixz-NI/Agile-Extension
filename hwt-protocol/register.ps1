<#
    register.ps1
    Registers the "hwt://" URL protocol for the CURRENT USER.
    No administrator rights required (writes to HKCU).

    Run from this folder:
        powershell -NoProfile -ExecutionPolicy Bypass -File .\register.ps1

    After this, opening a link like  hwt://start  will run hwt-launch.ps1,
    which starts the local HWT Config Creator server if it isn't already
    running. The Agile PLM extension fires this automatically when you pick
    "Local URL" from the HWT button.
#>

$ErrorActionPreference = 'Stop'

$scheme   = 'hwt'
$handler  = Join-Path $PSScriptRoot 'hwt-launch.ps1'
$launcher = Join-Path $PSScriptRoot 'launch-hidden.vbs'

if (-not (Test-Path $handler)) {
    throw "Cannot find handler script at: $handler"
}
if (-not (Test-Path $launcher)) {
    throw "Cannot find launcher script at: $launcher"
}

# Launch through wscript.exe + a VBScript shim so NO console window flashes.
# "%1" is the full URL the browser passes.
$wscript = Join-Path $env:WINDIR 'System32\wscript.exe'
$command = "`"$wscript`" `"$launcher`" `"%1`""

$base = "HKCU:\Software\Classes\$scheme"

New-Item -Path $base -Force | Out-Null
Set-ItemProperty -Path $base -Name '(default)'    -Value "URL:$scheme Protocol"
Set-ItemProperty -Path $base -Name 'URL Protocol' -Value ''

New-Item -Path "$base\shell\open\command" -Force | Out-Null
Set-ItemProperty -Path "$base\shell\open\command" -Name '(default)' -Value $command

Write-Host "hwt dataviewer registered" -ForegroundColor Green

# --- Native messaging host (hwt_urls_host) ---
# Lets the extension's background script ask this machine for its Network /
# External URLs (LAN IP + public IP) so the HWT button menu can list them
# without you reading them off the terminal. Registered per-user for both
# Firefox and Chromium-family browsers.
$hostName    = 'hwt_urls_host'
$hostScript  = Join-Path $PSScriptRoot 'hwt-native-host.ps1'
$hostBat     = Join-Path $PSScriptRoot 'hwt-native-host.bat'
$hostManifest = Join-Path $PSScriptRoot 'hwt_urls_host.json'

if (-not (Test-Path $hostScript)) { throw "Cannot find native host script at: $hostScript" }
if (-not (Test-Path $hostBat))    { throw "Cannot find native host wrapper at: $hostBat" }

# Firefox identifies the extension by its gecko id; Chromium by chrome-extension
# origin. Set CHROME_EXT_ID below if/when you load the Chromium build unpacked.
$geckoId      = 'agile-inline-preview@natinst.local'
$chromeExtId  = $env:HWT_CHROME_EXT_ID  # optional; e.g. 'abcdefghijklmnop...'

$manifest = [ordered]@{
    name        = $hostName
    description = 'Provides HWT Config Creator Network/External URLs to the extension'
    path        = $hostBat
    type        = 'stdio'
    allowed_extensions = @($geckoId)   # Firefox
}
# ConvertTo-Json escapes backslashes correctly for the Windows path.
($manifest | ConvertTo-Json -Depth 4) | Set-Content -Path $hostManifest -Encoding UTF8

# Firefox: HKCU\Software\Mozilla\NativeMessagingHosts\<name> -> manifest path
$ffKey = "HKCU:\Software\Mozilla\NativeMessagingHosts\$hostName"
New-Item -Path $ffKey -Force | Out-Null
Set-ItemProperty -Path $ffKey -Name '(default)' -Value $hostManifest

# Chromium (Chrome/Edge) use a separate manifest with allowed_origins. Only
# write it if a Chrome extension id was supplied via $env:HWT_CHROME_EXT_ID.
if ($chromeExtId) {
    $chromeManifestPath = Join-Path $PSScriptRoot 'hwt_urls_host.chromium.json'
    $chromeManifest = [ordered]@{
        name           = $hostName
        description    = 'Provides HWT Config Creator Network/External URLs to the extension'
        path           = $hostBat
        type           = 'stdio'
        allowed_origins = @("chrome-extension://$chromeExtId/")
    }
    ($chromeManifest | ConvertTo-Json -Depth 4) | Set-Content -Path $chromeManifestPath -Encoding UTF8
    foreach ($vendor in @('Google\Chrome', 'Microsoft\Edge')) {
        $key = "HKCU:\Software\$vendor\NativeMessagingHosts\$hostName"
        New-Item -Path $key -Force | Out-Null
        Set-ItemProperty -Path $key -Name '(default)' -Value $chromeManifestPath
    }
}
