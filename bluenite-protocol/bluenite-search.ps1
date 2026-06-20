<#
    bluenite-search.ps1
    Handler for the custom "bluenite://" URL protocol.

    Called by Windows as:
        powershell.exe ... -File bluenite-search.ps1 "bluenite://search/<term>"

    What it does:
        1. Parses the search term out of the URL.
        2. Finds the already-running BlueNITEConfigUI, or launches it.
        3. Brings its window to the foreground.
        4. Locates the search box via UI Automation (falls back to SendKeys).
        5. Types the term and presses Enter.

    SECURITY NOTE:
        The URL comes from the browser and is therefore untrusted input.
        This script only ever treats the payload as *text to type into a search
        box* -- it never passes it to a shell, Invoke-Expression, etc. Keep it
        that way. Do not add anything that executes the payload.
#>

param(
    [Parameter(Position = 0)]
    [string]$Url
)

$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------------------
# CONFIG -- adjust to taste
# ---------------------------------------------------------------------------
$ProcName = 'BlueNITEConfigUI'

# Where to launch the app from if it isn't already running.
# (If it's already running, we just attach to it regardless of path.)
$ExeCandidates = @(
    'W:\Tools\ConfigurationTool\BlueNITEConfigUI.exe',
    'C:\BlueNITE\21.0\production\Tools\ConfigurationTool\BlueNITEConfigUI.exe'
)

# Optional keyboard shortcut that focuses the app's search box, in SendKeys
# syntax (e.g. '^f' for Ctrl+F, '^e' for Ctrl+E). Leave $null if unknown --
# the script will try UI Automation first anyway.
$SearchHotkey = $null

# Keyboard shortcut that triggers "Open Production" before searching, in
# SendKeys syntax. The app uses Ctrl+P -> '^p'. Set to $null to skip.
$OpenProductionHotkey = '^p'

# How long to wait (seconds) for Production to finish loading after Ctrl+P,
# before typing the search term. Increase if the data loads slowly.
$OpenProductionWaitSec = 6

# Only send Ctrl+P when the app had to be launched fresh (recommended), so we
# don't reload production every time if it's already open. Set $true to always
# open production regardless.
$AlwaysOpenProduction = $false

# How we know Production is ALREADY open: the status bar at the bottom of the
# window shows the loaded file, e.g.
#   File:  \\us-aus-mfgtest\TestFwk\BlueNITE\Config\Production\bnProd.bncfg
# If a status-bar text control contains this marker, Production is loaded and we
# SKIP Ctrl+P. Otherwise (status bar empty or a different file) we send Ctrl+P
# to open Production. This is more reliable than the "was it just launched"
# heuristic, which could skip opening Production on an existing instance that had
# no config loaded (see 2nd screenshot) or reopen it needlessly.
$ProductionFileMarker = 'bnProd.bncfg'

# If UI Automation can identify the search box, prefer matching by these
# substrings (case-insensitive) against the control's Name / AutomationId.
$SearchNameHints = @('search', 'find', 'filter')

# The search box's exact AutomationId (most reliable target). Found via
# inspection: the main toolbar search box is 'txtTextBox'.
$SearchAutomationId = 'txtTextBox'

# Many apps only run their live search when the text actually changes via
# typing. Set $true to TYPE the term (fires TextChanged) instead of using
# the faster-but-sometimes-ignored ValuePattern.SetValue.
$TypeSearchTerm = $true

# --- Login handling ---------------------------------------------------------
# The handler never fills credentials. It simply brings the Login dialog to the
# front and WAITS for you to enter your username/password, pick the Location
# (e.g. NIC) server, and click OK. Once the dialog closes, it continues.

# How long (seconds) to wait for YOU to complete a manual login before giving
# up. Generous so you have time to type and pick the server.
$ManualLoginTimeoutSec = 300

# Title (or substring) of the Login dialog that appears after Ctrl+P.
$LoginWindowTitleHint = 'Login'

# How long to wait (seconds) for the Login dialog to appear after Ctrl+P.
$LoginAppearTimeoutSec = 15

# Wait (seconds) for a SECOND login prompt that Ctrl+P (Open Production) might
# raise. Also gives Production time to populate all products before searching.
$ProductionLoginWaitSec = 15

# Shorter wait (seconds) used to detect a Login dialog shown on app *startup*
# (before we send Ctrl+P). Kept small so we don't stall when there is none.
$StartupLoginWaitSec = 5

# After a login dialog closes, wait this long (seconds) for the main window to
# settle and regain focus before sending Ctrl+P. Manual logins need a beat.
$PostLoginSettleSec = 1.5

# How long to wait for the main window to appear after launching (seconds).
$LaunchTimeoutSec = 60

# Title (substring) of the modal progress dialog shown while Production loads
# (e.g. "Opening ...bnProd.bncfg"). The handler waits for this to CLOSE before
# typing the search term, so the products grid is populated first.
$OpeningDialogTitleHint = 'Opening'

# How long (seconds) to wait for the "Opening" progress dialog to appear after
# Ctrl+P, and then to disappear (i.e. Production finished loading).
$OpeningAppearTimeoutSec = 20
$OpeningCloseTimeoutSec  = 120

# Debug logging: writes a step-by-step trace next to this script so we can see
# exactly what the handler did. Safe to leave on; it never logs the password.
$DebugLog = $true
$DebugLogPath = Join-Path $PSScriptRoot 'bluenite-search.log'
# ---------------------------------------------------------------------------

Add-Type -AssemblyName System.Windows.Forms
try {
    Add-Type -AssemblyName UIAutomationClient
    Add-Type -AssemblyName UIAutomationTypes
    $uiaAvailable = $true
} catch {
    $uiaAvailable = $false
}

Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class Win32 {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);

    // Fast title-based detection of the modal "Opening ...bncfg" progress
    // dialog. EnumWindows + GetWindowText is far cheaper than a UIA FindAll on
    // every poll, so the close is detected with almost no lag.
    private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lParam);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr hWnd, StringBuilder s, int max);
    [DllImport("user32.dll")] private static extern int GetWindowTextLength(IntPtr hWnd);

    public static bool HasWindowWithTitle(uint targetPid, string titleSubstring) {
        bool found = false;
        EnumWindows((h, l) => {
            if (!IsWindowVisible(h)) return true;
            uint pid; GetWindowThreadProcessId(h, out pid);
            if (pid != targetPid) return true;
            int len = GetWindowTextLength(h);
            if (len <= 0) return true;
            var sb = new StringBuilder(len + 1);
            GetWindowText(h, sb, sb.Capacity);
            if (sb.ToString().IndexOf(titleSubstring, StringComparison.OrdinalIgnoreCase) >= 0) {
                found = true;
                return false; // stop enumerating
            }
            return true;
        }, IntPtr.Zero);
        return found;
    }
}
"@

function Get-ParsedUrl([string]$rawUrl) {
    # Returns @{ Term = <string>; Tab = <string or $null> }.
    # Supported forms:
    #   bluenite://search/<term>
    #   bluenite://search/<term>?tab=<TabName>
    $result = @{ Term = ''; Tab = $null }
    if ([string]::IsNullOrWhiteSpace($rawUrl)) { return $result }
    $s = $rawUrl.Trim()
    # Strip "<scheme>://"
    $s = $s -replace '^[a-zA-Z][a-zA-Z0-9+.\-]*://', ''

    # Split off a query string (everything after the first '?').
    $query = ''
    $qIdx = $s.IndexOf('?')
    if ($qIdx -ge 0) {
        $query = $s.Substring($qIdx + 1)
        $s = $s.Substring(0, $qIdx)
    }

    # Strip a leading "search/" prefix.
    if ($s -match '^(?i)search[/?]?') {
        $s = $s -replace '^(?i)search[/?]?', ''
        $s = $s -replace '^(?i)q=', ''
    }
    $s = $s.Trim('/')
    $result.Term = [System.Uri]::UnescapeDataString($s)

    # Parse the query for tab / q overrides.
    if ($query) {
        foreach ($pair in $query.Split('&')) {
            $kv = $pair.Split('=', 2)
            if ($kv.Count -ne 2) { continue }
            $key = $kv[0].ToLowerInvariant()
            $val = [System.Uri]::UnescapeDataString($kv[1])
            switch ($key) {
                'tab' { $result.Tab = $val }
                'q'   { if (-not $result.Term) { $result.Term = $val } }
            }
        }
    }
    return $result
}

function Set-Foreground([IntPtr]$hWnd) {
    # SW_RESTORE = 9 (un-minimize)
    [Win32]::ShowWindow($hWnd, 9) | Out-Null

    # Foreground stealing is restricted; attach input threads to make it work.
    $fg = [Win32]::GetForegroundWindow()
    $fgThread = [Win32]::GetWindowThreadProcessId($fg, [ref]([uint32]0))
    $curThread = [Win32]::GetCurrentThreadId()
    [Win32]::AttachThreadInput($curThread, $fgThread, $true) | Out-Null
    [Win32]::SetForegroundWindow($hWnd) | Out-Null
    [Win32]::AttachThreadInput($curThread, $fgThread, $false) | Out-Null
    Start-Sleep -Milliseconds 250
}

function Confirm-Foreground([IntPtr]$hWnd, [int]$retries = 6) {
    # Bring $hWnd to the foreground and verify it actually took. Retries a few
    # times because right after a dialog closes the OS may not honor the first
    # SetForegroundWindow call. Returns $true if confirmed foreground.
    for ($i = 0; $i -lt $retries; $i++) {
        Set-Foreground $hWnd
        Start-Sleep -Milliseconds 200
        if ([Win32]::GetForegroundWindow() -eq $hWnd) { return $true }
    }
    return ([Win32]::GetForegroundWindow() -eq $hWnd)
}

function Send-LiteralKeys([string]$text) {
    # Escape SendKeys metacharacters so the term is typed verbatim.
    $escaped = $text -replace '([+^%~(){}\[\]])', '{$1}'
    [System.Windows.Forms.SendKeys]::SendWait($escaped)
}

function Write-DebugLog([string]$msg) {
    if (-not $DebugLog) { return }
    try {
        $line = "{0}  {1}" -f (Get-Date -Format 'HH:mm:ss.fff'), $msg
        Add-Content -Path $DebugLogPath -Value $line -ErrorAction SilentlyContinue
    } catch { }
}

function Select-Tab([IntPtr]$mainHwnd, [string]$tabName) {
    # Selects a TabItem by name in the main window. Returns $true on success.
    if (-not $uiaAvailable -or [string]::IsNullOrWhiteSpace($tabName)) { return $false }
    try {
        $root = [System.Windows.Automation.AutomationElement]::FromHandle($mainHwnd)
        $tabCond = New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
            [System.Windows.Automation.ControlType]::TabItem)
        $tabs = $root.FindAll(
            [System.Windows.Automation.TreeScope]::Descendants, $tabCond)
        foreach ($t in $tabs) {
            if ($t.Current.Name -eq $tabName) {
                $sip = $t.GetCurrentPattern(
                    [System.Windows.Automation.SelectionItemPattern]::Pattern)
                $sip.Select()
                Write-DebugLog "Tab: selected '$tabName'."
                return $true
            }
        }
        Write-DebugLog "Tab: '$tabName' not found among $($tabs.Count) tabs."
    } catch {
        Write-DebugLog "Tab: error selecting '$tabName': $_"
    }
    return $false
}

function Find-SearchBox([IntPtr]$mainHwnd) {
    # Returns the search-box AutomationElement (by AutomationId, then name
    # hints, then first edit) or $null. Used both to wait for readiness and
    # to focus before typing.
    if (-not $uiaAvailable) { return $null }
    try {
        $root = [System.Windows.Automation.AutomationElement]::FromHandle($mainHwnd)
        $editCond = New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
            [System.Windows.Automation.ControlType]::Edit)
        $edits = $root.FindAll(
            [System.Windows.Automation.TreeScope]::Descendants, $editCond)
        if ($SearchAutomationId) {
            foreach ($e in $edits) {
                if ($e.Current.AutomationId -eq $SearchAutomationId) { return $e }
            }
        }
        foreach ($e in $edits) {
            $hay = ("{0} {1}" -f $e.Current.Name, $e.Current.AutomationId)
            foreach ($hint in $SearchNameHints) {
                if ($hay -match [regex]::Escape($hint)) { return $e }
            }
        }
        if ($edits.Count -gt 0) { return $edits[0] }
    } catch { }
    return $null
}

function Wait-ForSearchReady([IntPtr]$mainHwnd, [int]$timeoutSec) {
    # Poll until the search box exists AND is enabled (a good signal that the
    # Production view has finished building its toolbar). Returns the element
    # when ready, else $null on timeout. This replaces blindly typing after a
    # fixed sleep, which raced ahead of Ctrl+P / Production loading.
    $deadline = (Get-Date).AddSeconds($timeoutSec)
    $stableHits = 0
    while ((Get-Date) -lt $deadline) {
        $box = Find-SearchBox $mainHwnd
        if ($box) {
            $enabled = $true
            try { $enabled = $box.Current.IsEnabled } catch { }
            if ($enabled) {
                # Require two consecutive ready reads so we don't catch the
                # toolbar mid-rebuild (it can briefly appear then get replaced).
                $stableHits++
                if ($stableHits -ge 2) {
                    Write-DebugLog "Production ready: search box present & enabled."
                    return $box
                }
            } else {
                $stableHits = 0
            }
        } else {
            $stableHits = 0
        }
        Start-Sleep -Milliseconds 300
    }
    Write-DebugLog "Production ready: timed out after $timeoutSec s waiting for search box."
    return $null
}

function Test-ProductionOpen([IntPtr]$mainHwnd) {
    # Returns $true if Production is ALREADY loaded, detected by reading the
    # status bar at the bottom of the window. The app shows the open file there
    # (e.g. "...\Production\bnProd.bncfg"); when that marker is present we don't
    # need to send Ctrl+P. Scans Text controls (the status bar is made of
    # TextBlocks) for the marker substring, case-insensitive.
    if (-not $uiaAvailable) { return $false }
    try {
        $root = [System.Windows.Automation.AutomationElement]::FromHandle($mainHwnd)
        $textCond = New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
            [System.Windows.Automation.ControlType]::Text)
        $texts = $root.FindAll(
            [System.Windows.Automation.TreeScope]::Descendants, $textCond)
        foreach ($t in $texts) {
            $name = ''
            try { $name = $t.Current.Name } catch { }
            if ($name -and ($name -match [regex]::Escape($ProductionFileMarker))) {
                Write-DebugLog "Production check: marker '$ProductionFileMarker' found in status text '$name'."
                return $true
            }
        }
        Write-DebugLog "Production check: marker '$ProductionFileMarker' not found in $($texts.Count) text controls (Production not open)."
    } catch {
        Write-DebugLog "Production check: error reading status bar: $_"
    }
    return $false
}

function Find-OpeningDialog([int]$procId, [string]$titleHint) {
    # Fast check: is the modal "Opening ...bncfg" progress dialog currently
    # shown for this process? Uses a cheap Win32 EnumWindows title scan instead
    # of UIA so each poll is near-instant.
    try {
        return [Win32]::HasWindowWithTitle([uint32]$procId, $titleHint)
    } catch {
        return $false
    }
}

function Wait-ForOpeningDialogToClose([int]$procId, [string]$titleHint, [int]$appearSec, [int]$closeSec) {
    # Wait briefly for the "Opening" progress dialog to appear, then wait for it
    # to disappear. Returns $true if we observed it open AND close (Production
    # finished loading); $false if it never appeared (so caller falls back to a
    # fixed wait). This is the reliable signal that the .bncfg has loaded and
    # the products grid is populated.
    $appearDeadline = (Get-Date).AddSeconds($appearSec)
    $seen = $false
    while ((Get-Date) -lt $appearDeadline) {
        if (Find-OpeningDialog $procId $titleHint) { $seen = $true; break }
        Start-Sleep -Milliseconds 100
    }
    if (-not $seen) {
        Write-DebugLog "Opening dialog: never appeared within $appearSec s."
        return $false
    }
    Write-DebugLog "Opening dialog: detected; waiting for it to close."
    $closeDeadline = (Get-Date).AddSeconds($closeSec)
    while ((Get-Date) -lt $closeDeadline) {
        if (-not (Find-OpeningDialog $procId $titleHint)) {
            Write-DebugLog "Opening dialog: closed (Production loaded)."
            return $true
        }
        Start-Sleep -Milliseconds 60
    }
    Write-DebugLog "Opening dialog: still open after $closeSec s; proceeding anyway."
    return $true
}

function Get-LoginEdits($loginWindow) {
    $editCond = New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
        [System.Windows.Automation.ControlType]::Edit)
    return $loginWindow.FindAll(
        [System.Windows.Automation.TreeScope]::Descendants, $editCond)
}

function Test-IsLoginWindow($win) {
    # A login window is identified by containing at least one password edit,
    # or by its title containing the hint.
    try {
        if ($win.Current.Name -match [regex]::Escape($LoginWindowTitleHint)) { return $true }
    } catch { }
    try {
        foreach ($e in (Get-LoginEdits $win)) {
            if ($e.Current.IsPassword) { return $true }
        }
    } catch { }
    return $false
}

function Find-LoginWindow([int]$procId, [string]$titleHint) {
    # Search top-level windows of the process for the login dialog.
    if (-not $uiaAvailable) { return $null }
    try {
        $root = [System.Windows.Automation.AutomationElement]::RootElement
        $pidCond = New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::ProcessIdProperty, $procId)
        $wins = $root.FindAll(
            [System.Windows.Automation.TreeScope]::Children, $pidCond)
        # Prefer a window that actually has a password box.
        foreach ($w in $wins) {
            try {
                foreach ($e in (Get-LoginEdits $w)) {
                    if ($e.Current.IsPassword) { return $w }
                }
            } catch { }
        }
        # Fallback: match by title hint.
        foreach ($w in $wins) {
            if ($w.Current.Name -match [regex]::Escape($titleHint)) { return $w }
        }
    } catch { }
    return $null
}

function Wait-ForLoginWindow([int]$procId, [string]$titleHint, [int]$timeoutSec) {
    $deadline = (Get-Date).AddSeconds($timeoutSec)
    while ((Get-Date) -lt $deadline) {
        $w = Find-LoginWindow $procId $titleHint
        if ($w) { return $w }
        Start-Sleep -Milliseconds 300
    }
    return $null
}

function Wait-ForLoginToClose($loginWindow, [int]$procId, [string]$titleHint, [int]$timeoutSec) {
    $deadline = (Get-Date).AddSeconds($timeoutSec)
    while ((Get-Date) -lt $deadline) {
        $still = Find-LoginWindow $procId $titleHint
        if (-not $still) { return $true }
        Start-Sleep -Milliseconds 400
    }
    return $false
}

function Resolve-LoginIfPresent([int]$procId, [string]$label, [int]$appearSec) {
    # If a login dialog shows up within $appearSec, bring it to the front and
    # WAIT for the user to log in manually (incl. picking the Location server),
    # then wait for it to close. Returns $true if a login was handled.
    $loginWin = Wait-ForLoginWindow $procId $LoginWindowTitleHint $appearSec
    if (-not $loginWin) {
        Write-DebugLog "${label}: no login dialog appeared within $appearSec s."
        return $false
    }

    Write-DebugLog "${label}: login dialog detected; waiting for manual sign-in."
    # Bring the dialog to the foreground so the user can type immediately.
    try {
        $hwnd = [IntPtr]$loginWin.Current.NativeWindowHandle
        if ($hwnd -ne [IntPtr]::Zero) { Set-Foreground $hwnd }
    } catch { }
    $closed = Wait-ForLoginToClose $loginWin $procId $LoginWindowTitleHint $ManualLoginTimeoutSec
    Write-DebugLog "${label}: manual login closed=$closed."
    if (-not $closed) {
        # User didn't finish in time -- abort so we don't type into a dialog.
        Write-DebugLog "${label}: manual login timed out after $ManualLoginTimeoutSec s; aborting."
        exit 0
    }
    Start-Sleep -Milliseconds 600
    return $true
}

# --- 1. Parse ---------------------------------------------------------------
$parsed = Get-ParsedUrl $Url
$term = $parsed.Term
$tab  = $parsed.Tab
if ([string]::IsNullOrWhiteSpace($term)) {
    # Nothing to search for -- exit quietly.
    exit 0
}

if ($DebugLog) {
    "==== bluenite handler run $(Get-Date) ====" | Set-Content -Path $DebugLogPath
}
Write-DebugLog "URL='$Url'  term='$term'  tab='$tab'  uiaAvailable=$uiaAvailable"

# --- 2. Find or launch ------------------------------------------------------
$launched = $false
$proc = Get-Process -Name $ProcName -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $proc) {
    $exe = $ExeCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
    if (-not $exe) {
        [System.Windows.Forms.MessageBox]::Show(
            "BlueNITEConfigUI.exe was not found in any known location.",
            "bluenite:// handler") | Out-Null
        exit 1
    }
    $proc = Start-Process -FilePath $exe -PassThru
    $launched = $true
    $deadline = (Get-Date).AddSeconds($LaunchTimeoutSec)
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Milliseconds 400
        $proc.Refresh()
        if ($proc.MainWindowHandle -ne [IntPtr]::Zero) { break }
    }
    # Give the UI a moment to finish drawing its controls.
    Start-Sleep -Milliseconds 800
}

$proc.Refresh()
$hWnd = $proc.MainWindowHandle
if ($hWnd -eq [IntPtr]::Zero) {
    [System.Windows.Forms.MessageBox]::Show(
        "BlueNITEConfigUI is running but has no visible window yet.",
        "bluenite:// handler") | Out-Null
    exit 1
}

# --- 3. Foreground ----------------------------------------------------------
Set-Foreground $hWnd

# Tracks whether the Products tab was already selected during the Open
# Production step, so the fallback below doesn't select it twice.
$tabSelected = $false

# --- 3b. Open Production (Ctrl+P), log in, and wait for it to load ----------
# Decide whether Production needs opening by reading the status bar: if it
# already shows the Production file (\...\Production\bnProd.bncfg) we skip Ctrl+P
# entirely; otherwise we open it. On a fresh launch a startup login dialog may
# cover the window so the marker won't be present yet -- that correctly counts
# as "not open" and we proceed to open Production.
$prodAlreadyOpen = Test-ProductionOpen $hWnd
Write-DebugLog "Production already open: $prodAlreadyOpen (launched=$launched, alwaysOpen=$AlwaysOpenProduction)."
$needOpenProduction = $AlwaysOpenProduction -or (-not $prodAlreadyOpen)

if ($OpenProductionHotkey -and $needOpenProduction) {

    # On a fresh launch the app may show a Login dialog on startup. Clear that
    # FIRST so our Ctrl+P doesn't get swallowed by the login dialog.
    if ($launched) {
        Resolve-LoginIfPresent $proc.Id 'startup-login' $StartupLoginWaitSec | Out-Null
        # Let the main window settle after the login dialog closes, then make
        # sure it is truly the foreground window before sending the hotkey.
        Start-Sleep -Seconds $PostLoginSettleSec
        $proc.Refresh()
        if ($proc.MainWindowHandle -ne [IntPtr]::Zero) {
            $hWnd = $proc.MainWindowHandle
            $ok = Confirm-Foreground $hWnd
            Write-DebugLog "Post-login foreground confirmed=$ok before Ctrl+P."
        }
    }

    # Now actually open Production. Always re-confirm the main window is the
    # foreground window IMMEDIATELY before the keystroke, otherwise Ctrl+P can
    # land on whatever else has focus (the glitch where it "isn't focused").
    $proc.Refresh()
    if ($proc.MainWindowHandle -ne [IntPtr]::Zero) { $hWnd = $proc.MainWindowHandle }
    $fgOk = Confirm-Foreground $hWnd
    Write-DebugLog "Foreground confirmed=$fgOk immediately before Ctrl+P."
    if (-not $fgOk) {
        # One more forceful attempt; small pause lets the OS settle focus.
        Start-Sleep -Milliseconds 400
        $fgOk = Confirm-Foreground $hWnd
        Write-DebugLog "Foreground retry before Ctrl+P=$fgOk."
    }
    Write-DebugLog "Sending Open Production hotkey '$OpenProductionHotkey'."
    [System.Windows.Forms.SendKeys]::SendWait($OpenProductionHotkey)

    # Opening Production may itself prompt for login -- handle that too.
    $handled = Resolve-LoginIfPresent $proc.Id 'production-login' $ProductionLoginWaitSec

    # Whether or not a login was involved, Production shows a modal
    # "Opening ...bncfg" progress dialog while it loads the products grid. Wait
    # for THAT dialog to CLOSE before typing, so the search runs against the
    # populated grid (typing earlier raced ahead of the load).
    $sawOpening = Wait-ForOpeningDialogToClose $proc.Id $OpeningDialogTitleHint `
        $OpeningAppearTimeoutSec $OpeningCloseTimeoutSec
    if (-not $sawOpening -and -not $handled) {
        # Dialog never seen and no login (already loaded / too fast). Fixed wait.
        Write-DebugLog "Production: no Opening dialog; waiting $OpenProductionWaitSec s as fallback."
        Start-Sleep -Seconds $OpenProductionWaitSec
    }

    # Re-assert foreground in case the dialog/refresh changed focus.
    $proc.Refresh()
    if ($proc.MainWindowHandle -ne [IntPtr]::Zero) {
        $hWnd = $proc.MainWindowHandle
        Confirm-Foreground $hWnd | Out-Null
    }

    # Switch to the requested tab RIGHT AWAY (before any readiness polling) so
    # there's no lag between the Opening dialog closing and the Products tab
    # appearing.
    if ($tab) {
        if (Select-Tab $hWnd $tab) { $tabSelected = $true }
    }
}

# --- 3c. Select the requested tab (e.g. Products) ---------------------------
# Fallback: if we didn't already select it above (e.g. Production wasn't
# (re)opened this run), select it now.
if ($tab -and -not $tabSelected) {
    Select-Tab $hWnd $tab | Out-Null
}

# --- 4. Focus the search box ------------------------------------------------
$focused = $false
$valueSet = $false

if ($uiaAvailable) {
    try {
        $root = [System.Windows.Automation.AutomationElement]::FromHandle($hWnd)
        $editCond = New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
            [System.Windows.Automation.ControlType]::Edit)
        $edits = $root.FindAll(
            [System.Windows.Automation.TreeScope]::Descendants, $editCond)
        Write-DebugLog "Search: found $($edits.Count) edit controls."

        $target = $null
        # 1) Prefer the exact AutomationId of the search box.
        if ($SearchAutomationId) {
            foreach ($e in $edits) {
                if ($e.Current.AutomationId -eq $SearchAutomationId) { $target = $e; break }
            }
            if ($target) { Write-DebugLog "Search: matched by AutomationId '$SearchAutomationId'." }
        }
        # 2) Otherwise match by name/id hint.
        if (-not $target) {
            foreach ($e in $edits) {
                $hay = ("{0} {1}" -f $e.Current.Name, $e.Current.AutomationId)
                foreach ($hint in $SearchNameHints) {
                    if ($hay -match [regex]::Escape($hint)) { $target = $e; break }
                }
                if ($target) { break }
            }
            if ($target) { Write-DebugLog "Search: matched by name hint." }
        }
        # 3) Last resort: first edit.
        if (-not $target -and $edits.Count -gt 0) {
            $target = $edits[0]
            Write-DebugLog "Search: falling back to first edit control."
        }

        if ($target) {
            # Confirm the main window is foreground before we drive focus +
            # typing, so the keystrokes can't leak to another window if focus
            # drifted while Production was loading.
            Confirm-Foreground $hWnd | Out-Null
            $target.SetFocus()
            Start-Sleep -Milliseconds 150
            # Verify focus actually landed on the search box; retry once.
            try {
                $focusedEl = [System.Windows.Automation.AutomationElement]::FocusedElement
                if (-not ($focusedEl -and $focusedEl.Current.AutomationId -eq $target.Current.AutomationId)) {
                    Write-DebugLog "Search: focus not on search box; retrying SetFocus."
                    Confirm-Foreground $hWnd | Out-Null
                    $target.SetFocus()
                    Start-Sleep -Milliseconds 150
                }
            } catch { }
            $focused = $true
            if (-not $TypeSearchTerm) {
                # Fast path: set value directly (may not trigger live search).
                try {
                    $vp = $target.GetCurrentPattern(
                        [System.Windows.Automation.ValuePattern]::Pattern)
                    $vp.SetValue($term)
                    $valueSet = $true
                    Write-DebugLog "Search: set value via ValuePattern."
                } catch { }
            }
        } else {
            Write-DebugLog "Search: NO target edit control found."
        }
    } catch {
        Write-DebugLog "Search: UIA error: $_"
    }
}

# --- 5. Type + Enter --------------------------------------------------------
if (-not $focused -and $SearchHotkey) {
    [System.Windows.Forms.SendKeys]::SendWait($SearchHotkey)
    Start-Sleep -Milliseconds 200
}

if (-not $valueSet) {
    # Clear whatever is there, then TYPE the term so the app's live search
    # (TextChanged) actually fires.
    Write-DebugLog "Search: typing term '$term'."
    [System.Windows.Forms.SendKeys]::SendWait('^a')
    Start-Sleep -Milliseconds 60
    [System.Windows.Forms.SendKeys]::SendWait('{DELETE}')
    Start-Sleep -Milliseconds 60
    Send-LiteralKeys $term
}

Start-Sleep -Milliseconds 150
[System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
Write-DebugLog "Search: pressed ENTER. Done."
exit 0
