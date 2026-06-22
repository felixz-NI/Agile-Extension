# Agile Extension

# Install Extension:
- download file as zip and extract to a local folder
## Chrome & edge 
- go to extensions settings (chrome://extensions  or edge://extensions)
- enable developer mode
- select load unpacked
- select & open chrome/edge folder.


# Install BlueNite\HWT Data Viewer\p4v protocols:
- Open terminal in directory where agile extension is installed.
- powershell -NoProfile -ExecutionPolicy Bypass -File ".\hwt-protocol\register.ps1"
- powershell -NoProfile -ExecutionPolicy Bypass -File ".\bluenite-protocol\register.ps1"
- powershell -NoProfile -ExecutionPolicy Bypass -File ".\p4v-protocol\register.ps1"


# Uninstall BlueNite\HWT DataViewer\p4v protocol:
- powershell -NoProfile -ExecutionPolicy Bypass -File ".\bluenite-protocol\unregister.ps1"
- powershell -NoProfile -ExecutionPolicy Bypass -File ".\p4v-protocol\unregister.ps1"
- powershell -NoProfile -ExecutionPolicy Bypass -File ".\hwt-protocol\unregister.ps1"
