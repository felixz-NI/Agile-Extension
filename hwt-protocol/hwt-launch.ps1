<#
    hwt-launch.ps1
    Starts the HWT Config Creator (Streamlit) server if it isn't already
    running, and captures the EXACT URLs the `hwt-config-creator` command
    prints (Local / Network / External) into hwt-urls.json so the browser
    extension can list them in the HWT button menu.

    Invoked by the "hwt://" URL protocol so the extension can boot the local
    viewer on demand instead of you running the terminal command yourself.

    Behaviour:
      * If TCP port 8501 is already listening, the server is left alone (the
        previously captured hwt-urls.json stays as-is).
      * Otherwise it launches `hwt-config-creator`, captures its stdout, parses
        the three "X URL: http://..." lines, and writes them to hwt-urls.json.

    The browser passes the whole URL (e.g. "hwt://start") as the first
    argument; its contents are ignored.
#>
param([string]$Url)

$ErrorActionPreference = 'SilentlyContinue'
$Port = 8501

$logFile  = Join-Path $PSScriptRoot 'hwt-launch.log'
$urlsFile = Join-Path $PSScriptRoot 'hwt-urls.json'
$capFile  = Join-Path $PSScriptRoot 'hwt-capture.log'
$errFile  = Join-Path $PSScriptRoot 'hwt-capture.err.log'
function Write-Log([string]$msg) {
    $ts = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    Add-Content -Path $logFile -Value "[$ts] $msg"
}

Write-Log "Invoked with URL: '$Url'"

# Quick TCP probe against localhost:<port>.
function Test-PortOpen([int]$p) {
    try {
        $client = New-Object System.Net.Sockets.TcpClient
        $async  = $client.BeginConnect('127.0.0.1', $p, $null, $null)
        $ok     = $async.AsyncWaitHandle.WaitOne(400)
        if ($ok -and $client.Connected) {
            $client.EndConnect($async)
            $client.Close()
            return $true
        }
        $client.Close()
        return $false
    } catch {
        return $false
    }
}

# Parse the three URL lines Streamlit prints from a captured-output file and
# write them to hwt-urls.json. Returns $true if at least Local was found.
function Save-UrlsFromCapture([string]$capturePath) {
    if (-not (Test-Path $capturePath)) { return $false }
    $text = Get-Content -Path $capturePath -Raw
    if (-not $text) { return $false }

    $local    = ([regex]'(?im)^\s*Local URL:\s*(\S+)').Match($text).Groups[1].Value
    $network  = ([regex]'(?im)^\s*Network URL:\s*(\S+)').Match($text).Groups[1].Value
    $external = ([regex]'(?im)^\s*External URL:\s*(\S+)').Match($text).Groups[1].Value

    if (-not $local) { return $false }

    $obj = [ordered]@{
        local    = $local
        network  = $network
        external = $external
    }
    ($obj | ConvertTo-Json -Compress) | Set-Content -Path $urlsFile -Encoding UTF8
    Write-Log "Saved URLs: local=$local network=$network external=$external"
    return $true
}

if (Test-PortOpen $Port) {
    Write-Log "Port $Port already listening - server is up; leaving hwt-urls.json as-is."
    exit 0
}

# Locate the console script installed by pipx (hwt-reports package).
$exe = $null
$cmd = Get-Command 'hwt-config-creator' -ErrorAction SilentlyContinue
if ($cmd) { $exe = $cmd.Source }
if (-not $exe) {
    $candidate = Join-Path $env:USERPROFILE '.local\bin\hwt-config-creator.exe'
    if (Test-Path $candidate) { $exe = $candidate }
}
if (-not $exe) {
    Write-Log "ERROR: could not find 'hwt-config-creator'. Install it with: pipx install hwt-reports"
    exit 1
}

Write-Log "Starting server: $exe (capturing -> $capFile)"
Remove-Item $capFile, $errFile -ErrorAction SilentlyContinue
Start-Process -FilePath $exe -WindowStyle Hidden `
    -RedirectStandardOutput $capFile -RedirectStandardError $errFile | Out-Null

# Wait (up to ~30s) for the server to answer AND for the URL lines to appear,
# then write them to hwt-urls.json.
$savedUrls = $false
for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Milliseconds 500
    if (-not $savedUrls) {
        if (Save-UrlsFromCapture $capFile) { $savedUrls = $true }
    }
    if ($savedUrls -and (Test-PortOpen $Port)) {
        Write-Log "Server is up and URLs captured after about $($i * 500) ms."
        exit 0
    }
}

if ($savedUrls) {
    Write-Log "URLs captured but port probe did not confirm within timeout."
} else {
    Write-Log "Server did not print URLs within the timeout window."
}
exit 0
