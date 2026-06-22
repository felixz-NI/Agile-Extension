' launch-hidden.vbs
' Launches hwt-launch.ps1 with NO console window at all.
'
' powershell.exe is a console application, so even with -WindowStyle Hidden
' its console host (conhost) flashes for a moment. wscript.exe has no console,
' and WshShell.Run with window mode 0 starts PowerShell fully hidden.
'
' Invoked by the registry as:  wscript.exe "launch-hidden.vbs" "%1"

Option Explicit

Dim sh, fso, here, handler, url, cmd
Set sh  = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

here    = fso.GetParentFolderName(WScript.ScriptFullName)
handler = here & "\hwt-launch.ps1"

url = ""
If WScript.Arguments.Count > 0 Then
    url = WScript.Arguments(0)
End If

cmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & _
      handler & """ """ & url & """"

' 0 = hidden window, False = don't wait for it to finish.
sh.Run cmd, 0, False
