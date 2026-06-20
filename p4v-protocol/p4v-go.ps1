<#
    p4v-go.ps1
    Protocol handler for "p4v://".  Opens a depot path in the P4V application
    by launching P4V with its  -cmd "tree <path>"  option, which selects and
    reveals that path in the depot tree.

    URL format (the depot path is URL-encoded):
        p4v://tree/<url-encoded-depot-path>

    Example for the depot path:
        //Manufacturing/BN/Products/HTAP_RF/.../2.0.0f009
    becomes:
        p4v://tree/%2F%2FManufacturing%2FBN%2FProducts%2F...

    The browser passes the full URL as the first argument.
#>

param([string]$Url)

$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------------------
# Config (tune these)
# ---------------------------------------------------------------------------
$P4VExe   = 'C:\Program Files\Perforce\p4v.exe'

# Newer P4V uses the p4vc helper to drive the GUI:
#   p4vc workspacewindow -s <depot-or-local-path>
# selects the path in the (already-running) workspace window.
$P4VCExe  = 'C:\Program Files\Perforce\p4vc.bat'

# Connection. Leave blank to auto-detect from "p4 set" (P4PORT/P4USER/P4CLIENT).
# Fill in to force a specific server / workspace.
$P4Port   = ''   # e.g. 'perforce:1666' or 'ssl:host:1666'
$P4User   = ''   # e.g. 'fzeng'
$P4Client = ''   # workspace name, e.g. 'fzeng_ws'

$P4Exe    = 'C:\Program Files\Perforce\p4.exe'

$DebugLog     = $true
$DebugLogPath = Join-Path $PSScriptRoot 'p4v-go.log'

# ---------------------------------------------------------------------------
function Write-DebugLog {
    param([string]$Message)
    if ($DebugLog) {
        Add-Content -Path $DebugLogPath -Value ('[{0}] {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message)
    }
}

# Read a "p4 set" value (P4PORT/P4USER/P4CLIENT). Empty when p4 is unavailable.
function Get-P4Set {
    param([string]$Name)
    if (-not (Test-Path $P4Exe)) { return '' }
    try {
        $line = (& $P4Exe set $Name 2>$null) | Select-Object -First 1
        if ($line -match '=(.+?)(\s+\(.*\))?$') { return $matches[1].Trim() }
    } catch { }
    return ''
}

# Build the common  -p -u -c  connection args from whatever is set.
function Get-P4ConnArgs {
    $a = @()
    $port   = if ($P4Port)   { $P4Port }   else { Get-P4Set 'P4PORT' }
    $user   = if ($P4User)   { $P4User }   else { Get-P4Set 'P4USER' }
    $client = if ($P4Client) { $P4Client } else { Get-P4Set 'P4CLIENT' }
    if ($port)   { $a += @('-p', $port) }
    if ($user)   { $a += @('-u', $user) }
    if ($client) { $a += @('-c', $client) }
    return ,$a
}

# Folder-diff two depot revisions using P4V's OWN native diff:
#   p4vc [conn] diff -f <leftDepotPath> <rightDepotPath>
# This launches P4V's "Diff Files" window directly on the two depot folders
# (the same dialog you'd get from P4V's Diff toolbar), so P4V handles the folder
# comparison natively — no temp files, no syncing, no P4Merge folder-mode quirks.
function Invoke-P4Diff {
    param([string]$LeftDepot, [string]$RightDepot)

    if (-not (Test-Path $P4VCExe)) {
        Write-DebugLog "p4vc not found at $P4VCExe; cannot launch P4V diff."
        return
    }

    $conn = Get-P4ConnArgs
    # Strip any trailing slash; P4V wants the folder path itself.
    $left  = $LeftDepot.TrimEnd('/')
    $right = $RightDepot.TrimEnd('/')

    $argList = @()
    $argList += $conn
    $argList += @('diff', '-f', $left, $right)
    Write-DebugLog ("Launching P4V diff: `"$P4VCExe`" " + ($argList -join ' '))
    try {
        Start-Process -FilePath $P4VCExe -ArgumentList $argList -WindowStyle Hidden
        Write-DebugLog "P4V diff launched."
    } catch {
        Write-DebugLog "P4V diff launch failed: $($_.Exception.Message)"
    }
}

Write-DebugLog "----- handler start -----"
Write-DebugLog "Raw URL: $Url"

if ([string]::IsNullOrWhiteSpace($Url)) {
    Write-DebugLog "No URL passed. Exiting."
    exit 1
}

# ---------------------------------------------------------------------------
# Parse  p4v://tree/<encoded path>   ->   //depot/path
# ---------------------------------------------------------------------------
# Strip the scheme ("p4v:") then any leading slashes the browser added.
$rest = $Url -replace '^[A-Za-z][A-Za-z0-9+.\-]*:', ''
$rest = $rest.TrimStart('/')

# ---------------------------------------------------------------------------
# Diff command:  p4v://diff?l=<encoded-left>&r=<encoded-right>
# Folder-diff two depot revisions (older on the left, newer on the right).
# Handled here and then we exit, so the tree-navigation path below is skipped.
# ---------------------------------------------------------------------------
if ($rest -match '^(?i)diff[/?]*(.*)$') {
    # After "diff" the browser may insert "/?" before the query, so strip any
    # leading slashes/question marks before splitting l=/r=.
    $query = $matches[1].TrimStart('/', '?')
    $left = ''; $right = ''
    foreach ($pair in ($query -split '&')) {
        if ($pair -match '^(?i)l=(.*)$') { $left  = [System.Uri]::UnescapeDataString($matches[1]) }
        elseif ($pair -match '^(?i)r=(.*)$') { $right = [System.Uri]::UnescapeDataString($matches[1]) }
    }
    # Keep the leading "//" on depot paths.
    foreach ($v in 'left', 'right') {
        $p = (Get-Variable $v).Value
        if ($p -and ($p -notmatch '^//') -and ($p -match '^/[^/]')) { Set-Variable $v ('/' + $p) }
    }
    Write-DebugLog "Diff request: left='$left' right='$right'"
    if ([string]::IsNullOrWhiteSpace($left) -or [string]::IsNullOrWhiteSpace($right)) {
        Write-DebugLog "Diff missing a path. Exiting."
        exit 1
    }
    Invoke-P4Diff -LeftDepot $left -RightDepot $right
    Write-DebugLog "----- handler end (diff) -----"
    exit 0
}

# Optional "tree/" command prefix.
if ($rest -match '^(?i)tree/(.*)$') {
    $encoded = $matches[1]
} else {
    $encoded = $rest
}
$encoded   = $encoded.TrimEnd('/')
$depotPath = [System.Uri]::UnescapeDataString($encoded)

# Make sure depot paths keep their leading "//".
if ($depotPath -and ($depotPath -notmatch '^//')) {
    if ($depotPath -match '^/[^/]') { $depotPath = '/' + $depotPath }   # "/x" -> "//x"
}

Write-DebugLog "Decoded depot path: $depotPath"

if ([string]::IsNullOrWhiteSpace($depotPath)) {
    Write-DebugLog "Empty depot path after decode. Exiting."
    exit 1
}

if (-not (Test-Path $P4VExe)) {
    Write-DebugLog "p4v.exe not found at: $P4VExe"
    exit 1
}

# ---------------------------------------------------------------------------
# Auto-detect connection from "p4 set" when not explicitly configured.
# P4V routes a -cmd to an already-running instance ONLY when the connection
# (-p -u -c) matches that instance, so we must supply it. (Get-P4Set is defined
# near the top of this script.)
# ---------------------------------------------------------------------------
if (-not $P4Port)   { $P4Port   = Get-P4Set 'P4PORT' }
if (-not $P4User)   { $P4User   = Get-P4Set 'P4USER' }
if (-not $P4Client) { $P4Client = Get-P4Set 'P4CLIENT' }

Write-DebugLog "Connection: port='$P4Port' user='$P4User' client='$P4Client'"

# ---------------------------------------------------------------------------
# Ensure there is a valid Perforce session. P4V/p4vc cannot navigate to a path
# without a cached login ticket; when the session is missing or expired the
# command silently does nothing. In that case we first open P4V (which raises
# its Login dialog) and WAIT for the user to sign in before issuing the
# navigation command.
# ---------------------------------------------------------------------------

# How long (seconds) to wait for the user to complete the P4V login.
$LoginWaitSec = 180

function Test-P4LoggedIn {
    # Returns $true if a valid login ticket exists (or if we can't check, so we
    # don't block when p4.exe is unavailable). "p4 login -s" exits non-zero
    # when the session is unset/expired.
    if (-not (Test-Path $P4Exe)) { return $true }
    $checkArgs = @()
    if ($P4Port) { $checkArgs += @('-p', $P4Port) }
    if ($P4User) { $checkArgs += @('-u', $P4User) }
    $checkArgs += @('login', '-s')
    try {
        & $P4Exe @checkArgs 2>&1 | Out-Null
        return ($LASTEXITCODE -eq 0)
    } catch {
        return $false
    }
}

if (-not (Test-P4LoggedIn)) {
    Write-DebugLog "No cached Perforce session; opening P4V for login."

    # Launch P4V with the connection so its Login dialog appears.
    $p4vArgs = @()
    if ($P4Port)   { $p4vArgs += @('-p', $P4Port) }
    if ($P4User)   { $p4vArgs += @('-u', $P4User) }
    if ($P4Client) { $p4vArgs += @('-c', $P4Client) }
    try {
        Start-Process -FilePath $P4VExe -ArgumentList $p4vArgs
        Write-DebugLog "P4V launched for login prompt."
    } catch {
        Write-DebugLog "Failed to launch P4V for login: $($_.Exception.Message)"
    }

    # Poll until the user signs in (a valid ticket appears) or we time out.
    $deadline = (Get-Date).AddSeconds($LoginWaitSec)
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Seconds 2
        if (Test-P4LoggedIn) { break }
    }

    if (-not (Test-P4LoggedIn)) {
        Write-DebugLog "Login not completed within $LoginWaitSec s; leaving P4V open. Exiting."
        Write-DebugLog "----- handler end -----"
        exit 0
    }
    Write-DebugLog "Perforce login confirmed; proceeding to navigate."
}

# ---------------------------------------------------------------------------
# Build arguments and launch P4V via the p4vc helper.
#   p4vc [-p -u -c] workspacewindow -s <path>
# selects <path> in the workspace/depot browser and foregrounds the window.
# Launched non-blocking (p4vc.bat otherwise stays attached to the console).
# ---------------------------------------------------------------------------
$argList = @()
if ($P4Port)   { $argList += @('-p', $P4Port) }
if ($P4User)   { $argList += @('-u', $P4User) }
if ($P4Client) { $argList += @('-c', $P4Client) }
$argList += @('workspacewindow', '-s', $depotPath)

Write-DebugLog ("Launching: `"$P4VCExe`" " + ($argList -join ' '))

try {
    if (Test-Path $P4VCExe) {
        Start-Process -FilePath $P4VCExe -ArgumentList $argList -WindowStyle Hidden
        Write-DebugLog "Launch issued OK (p4vc)."
    } else {
        Write-DebugLog "p4vc not found at $P4VCExe; falling back to p4v.exe (no path selection)."
        Start-Process -FilePath $P4VExe
    }
}
catch {
    Write-DebugLog "Launch failed: $($_.Exception.Message)"
    exit 1
}

Write-DebugLog "----- handler end -----"
