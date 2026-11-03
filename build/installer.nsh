; SPDX-License-Identifier: GPL-3.0-or-later
; Extra steps for the Windows installer (electron-builder includes this file: nsis.include in
; electron-builder.config.cjs).
;
; Uninstalling asks whether to delete your EVE HUD settings and data too: config.json (Client ID,
; Secret Key), data/ (EVE login, layout, star map) and the log file, in %APPDATA%\EVE HUD.
; Not asked when an update replaces the app, and "No" in a silent uninstall.
; Files moved elsewhere with Settings → Storage stay where they are.

!macro customUnInstall
  ${ifNot} ${isUpdated}
    MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "Also delete your EVE HUD settings and data?$\r$\n$\r$\nThat is your EVE login, Client ID and Secret Key, layout and the star map. Choose No to keep them for a later installation." /SD IDNO IDNO eveHudKeepData
      ; the settings are per user, also when the app was installed for everyone
      ${if} $installMode == "all"
        SetShellVarContext current
      ${endif}
      RMDir /r "$APPDATA\${APP_FILENAME}"
      !ifdef APP_PRODUCT_FILENAME
        RMDir /r "$APPDATA\${APP_PRODUCT_FILENAME}"
      !endif
      ${if} $installMode == "all"
        SetShellVarContext all
      ${endif}
    eveHudKeepData:
  ${endIf}
!macroend
