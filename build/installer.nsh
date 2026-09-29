; Goldfinch NSIS include (wired via package.json build.nsis.include; electron-builder
; would also pick build/installer.nsh up from buildResources on its own).
;
; Why: Windows 10/11 lists a browser under Settings > Apps > Default apps only when it
; publishes RegisteredApplications + Capabilities keys. Electron's
; setAsDefaultProtocolClient cannot make the choice (UserChoice is user-confirmed), and
; the NSIS target ignores build.protocols, so this include writes the registration.
;
; Scope: ADDITIVE ONLY. Touches no shortcut, no AUMID, no appId (com.goldfinch.browser).
; Keys go under SHELL_CONTEXT (HKCU for "only me", HKLM for "all users").
;
; Update safety: electron-builder runs the OLD uninstaller during an update
; (${isUpdated} true). Deleting the ProgID then would reset the operator's default
; browser choice on every update (same uninstall-during-update mechanism as #65 /
; squawk 0002), so every delete below sits inside ${ifNot} ${isUpdated}. customInstall
; re-runs on every install and update and rewrites the keys idempotently.
; Upgrading FROM a version that predates this include runs that OLD uninstaller, which
; has no customUnInstall macro - expected, and harmless.
;
; The "Goldfinch" RegisteredApplications value name is referenced by the literal in
; src/main/default-browser.js (ms-settings:defaultapps?registeredAppUser=Goldfinch);
; test/unit/default-browser-packaging.test.js guards the two against drift.

!macro customInstall
  WriteRegStr SHELL_CONTEXT "Software\Classes\GoldfinchHTML" "" "Goldfinch HTML Document"
  WriteRegStr SHELL_CONTEXT "Software\Classes\GoldfinchHTML" "FriendlyTypeName" "Goldfinch HTML Document"
  WriteRegStr SHELL_CONTEXT "Software\Classes\GoldfinchHTML\DefaultIcon" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr SHELL_CONTEXT "Software\Classes\GoldfinchHTML\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'

  WriteRegStr SHELL_CONTEXT "Software\Clients\StartMenuInternet\Goldfinch" "" "Goldfinch"
  WriteRegStr SHELL_CONTEXT "Software\Clients\StartMenuInternet\Goldfinch\DefaultIcon" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr SHELL_CONTEXT "Software\Clients\StartMenuInternet\Goldfinch\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}"'
  WriteRegStr SHELL_CONTEXT "Software\Clients\StartMenuInternet\Goldfinch\Capabilities" "ApplicationName" "Goldfinch"
  WriteRegStr SHELL_CONTEXT "Software\Clients\StartMenuInternet\Goldfinch\Capabilities" "ApplicationDescription" "Goldfinch web browser"
  WriteRegStr SHELL_CONTEXT "Software\Clients\StartMenuInternet\Goldfinch\Capabilities" "ApplicationIcon" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr SHELL_CONTEXT "Software\Clients\StartMenuInternet\Goldfinch\Capabilities\StartMenu" "StartMenuInternet" "Goldfinch"
  WriteRegStr SHELL_CONTEXT "Software\Clients\StartMenuInternet\Goldfinch\Capabilities\URLAssociations" "http" "GoldfinchHTML"
  WriteRegStr SHELL_CONTEXT "Software\Clients\StartMenuInternet\Goldfinch\Capabilities\URLAssociations" "https" "GoldfinchHTML"

  WriteRegStr SHELL_CONTEXT "Software\RegisteredApplications" "Goldfinch" "Software\Clients\StartMenuInternet\Goldfinch\Capabilities"
!macroend

!macro customUnInstall
  ${ifNot} ${isUpdated}
    DeleteRegKey SHELL_CONTEXT "Software\Classes\GoldfinchHTML"
    DeleteRegKey SHELL_CONTEXT "Software\Clients\StartMenuInternet\Goldfinch"
    DeleteRegValue SHELL_CONTEXT "Software\RegisteredApplications" "Goldfinch"
  ${endIf}
!macroend
