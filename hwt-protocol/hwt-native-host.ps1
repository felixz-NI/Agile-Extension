<#
    hwt-native-host.ps1
    Native messaging host for the Agile PLM Inline Preview extension.

    Speaks Chrome/Firefox native-messaging stdio framing (4-byte little-endian
    length prefix + UTF-8 JSON). For any request it replies with the HWT Config
    Creator URLs that were captured from the `hwt-config-creator` command's own
    output (see hwt-launch.ps1, which writes hwt-urls.json):

        { "network": "http://<lan-ip>:8501/mfg-debug-config-create",
          "external": "http://<public-ip>:8501/mfg-debug-config-create" }

    These are the EXACT "Network URL" / "External URL" the command prints on
    startup - nothing is recomputed or guessed here. If hwt-urls.json does not
    exist yet (the server has never been auto-started), empty strings are
    returned and the menu shows only the Local option.
#>

$ErrorActionPreference = 'Stop'

$urlsFile = Join-Path $PSScriptRoot 'hwt-urls.json'
$capFile  = Join-Path $PSScriptRoot 'hwt-capture.log'
$errFile  = Join-Path $PSScriptRoot 'hwt-capture.err.log'
$logFile  = Join-Path $PSScriptRoot 'hwt-native-host.log'
$Port     = 8501
function Write-Log([string]$msg) {
    try {
        $ts = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
        Add-Content -Path $logFile -Value "[$ts] $msg"
    } catch { }
}

# Read the captured URLs written when the server was started. Returns
# network/external strings (empty if the file is missing or unparseable).
function Get-CapturedUrls {
    $result = [ordered]@{ network = ''; external = '' }
    try {
        if (Test-Path $urlsFile) {
            $json = Get-Content -Path $urlsFile -Raw | ConvertFrom-Json
            if ($json.network)  { $result.network  = [string]$json.network }
            if ($json.external) { $result.external = [string]$json.external }
        }
    } catch {
        Write-Log "Failed to read $urlsFile : $($_.Exception.Message)"
    }
    return $result
}

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
    } catch { return $false }
}

# Parse the three URL lines Streamlit prints from the captured output file and
# write them to hwt-urls.json. Returns $true if at least Local was found.
function Save-UrlsFromCapture {
    if (-not (Test-Path $capFile)) { return $false }
    $text = Get-Content -Path $capFile -Raw
    if (-not $text) { return $false }
    $local    = ([regex]'(?im)^\s*Local URL:\s*(\S+)').Match($text).Groups[1].Value
    $network  = ([regex]'(?im)^\s*Network URL:\s*(\S+)').Match($text).Groups[1].Value
    $external = ([regex]'(?im)^\s*External URL:\s*(\S+)').Match($text).Groups[1].Value
    if (-not $local) { return $false }
    $obj = [ordered]@{ local = $local; network = $network; external = $external }
    ($obj | ConvertTo-Json -Compress) | Set-Content -Path $urlsFile -Encoding UTF8
    Write-Log "Saved URLs: local=$local network=$network external=$external"
    return $true
}

# Start the local hwt-config-creator server if it isn't already listening, then
# capture the URLs it prints. Returns once the URLs are saved (or it times out).
# This replaces the hwt:// protocol so no browser "open external link" prompt
# appears.
function Start-HwtServer {
    if (Test-PortOpen $Port) {
        Write-Log "Port $Port already listening - server up; leaving hwt-urls.json as-is."
        return
    }
    $exe = $null
    $cmd = Get-Command 'hwt-config-creator' -ErrorAction SilentlyContinue
    if ($cmd) { $exe = $cmd.Source }
    if (-not $exe) {
        $candidate = Join-Path $env:USERPROFILE '.local\bin\hwt-config-creator.exe'
        if (Test-Path $candidate) { $exe = $candidate }
    }
    if (-not $exe) {
        Write-Log "ERROR: could not find 'hwt-config-creator'. Install it with: pipx install hwt-reports"
        return
    }
    Remove-Item $capFile, $errFile -ErrorAction SilentlyContinue
    Write-Log "Starting server: $exe (capturing -> $capFile)"
    Start-Process -FilePath $exe -WindowStyle Hidden `
        -RedirectStandardOutput $capFile -RedirectStandardError $errFile | Out-Null
    for ($i = 0; $i -lt 60; $i++) {
        Start-Sleep -Milliseconds 500
        if (Save-UrlsFromCapture) {
            Write-Log "Server up and URLs captured after about $($i * 500) ms."
            return
        }
    }
    Write-Log "Server did not print URLs within the timeout window."
}

# --- Native messaging stdio I/O (4-byte LE length prefix + UTF-8 JSON). ---
function Read-Message($stream) {
    $lenBytes = New-Object byte[] 4
    $read = 0
    while ($read -lt 4) {
        $n = $stream.Read($lenBytes, $read, 4 - $read)
        if ($n -le 0) { return $null }  # EOF — browser closed the pipe
        $read += $n
    }
    $len = [BitConverter]::ToInt32($lenBytes, 0)
    if ($len -le 0) { return '' }
    $buf = New-Object byte[] $len
    $got = 0
    while ($got -lt $len) {
        $n = $stream.Read($buf, $got, $len - $got)
        if ($n -le 0) { break }
        $got += $n
    }
    return [System.Text.Encoding]::UTF8.GetString($buf, 0, $got)
}

function Write-Message($stream, [string]$json) {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
    $lenBytes = [BitConverter]::GetBytes([int]$bytes.Length)  # LE on Windows
    $stream.Write($lenBytes, 0, 4)
    $stream.Write($bytes, 0, $bytes.Length)
    $stream.Flush()
}

try {
    $stdin = [Console]::OpenStandardInput()
    $stdout = [Console]::OpenStandardOutput()

    while ($true) {
        $incoming = Read-Message $stdin
        if ($null -eq $incoming) { break }  # EOF
        Write-Log "Request: $incoming"

        # Optional command: { "cmd": "start" } boots the local server (no popup);
        # anything else (e.g. "get") just returns the captured URLs.
        $cmd = ''
        try { $cmd = ([string](($incoming | ConvertFrom-Json).cmd)).ToLower() } catch { }
        if ($cmd -eq 'start') { Start-HwtServer }

        $urls = Get-CapturedUrls
        $respObj = [ordered]@{ network = $urls.network; external = $urls.external }
        $respJson = $respObj | ConvertTo-Json -Compress
        Write-Message $stdout $respJson
        Write-Log "Reply: $respJson"
    }
} catch {
    Write-Log "ERROR: $($_.Exception.Message)"
}
