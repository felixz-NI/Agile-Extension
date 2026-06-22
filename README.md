# Agile Extension

# Install Extension
- download file as zip and extract to a local folder
## Chrome & Edge 
- go to extensions settings (chrome://extensions  or edge://extensions)
- enable developer mode
- select load unpacked
- select & open chrome/edge folder.
## Firefox
- Go to about:preferences
- Scroll down to Applications under General.
- Ensure Action is Open in Firefox for Portable Document Format(PDF)
- Go to about:debugging#/runtime/this-firefox
- select Load Temporary Add-On
- Select and open manifest.json file in the agile extension firefox folder

# BlueNite\HWT Data Viewer\p4v protocols
## Install
- Open terminal in directory where agile extension is installed.
- powershell -NoProfile -ExecutionPolicy Bypass -File ".\hwt-protocol\register.ps1"
- powershell -NoProfile -ExecutionPolicy Bypass -File ".\bluenite-protocol\register.ps1"
- powershell -NoProfile -ExecutionPolicy Bypass -File ".\p4v-protocol\register.ps1"
## Uninstall
- powershell -NoProfile -ExecutionPolicy Bypass -File ".\bluenite-protocol\unregister.ps1"
- powershell -NoProfile -ExecutionPolicy Bypass -File ".\p4v-protocol\unregister.ps1"
- powershell -NoProfile -ExecutionPolicy Bypass -File ".\hwt-protocol\unregister.ps1"
