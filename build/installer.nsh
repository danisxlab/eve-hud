; SPDX-License-Identifier: GPL-3.0-or-later
; Extra steps for the Windows installer (electron-builder includes this file: nsis.include in
; electron-builder.config.cjs).
;
; Uninstalling (and every update, which uninstalls the old version first) removes only EVE HUD's
; own program files, by name, and then the program folder only when it is empty: anything else in
; that folder stays where it is. The list of files is made from the app itself when it's built
; (scripts/uninstall-files.cjs, written to dist/uninstall-files.nsh). This replaces
; electron-builder's default, which deletes the whole program folder.
;
; Uninstalling asks whether to delete your EVE HUD settings and data too: config.json (Client ID,
; Secret Key), data/ (EVE login, layout, star map) and the log file, in %APPDATA%\EVE HUD.
; Not asked when an update replaces the app, and "No" in a silent uninstall.
; Files moved elsewhere with Settings → Storage stay where they are.

!include "${PROJECT_DIR}/dist/uninstall-files.nsh"

!macro customRemoveFiles
  SetOutPath $TEMP ; out of the program folder, so it can be removed when empty
  !insertmacro eveHudRemoveProgramFiles
  Delete "$INSTDIR\${UNINSTALL_FILENAME}"
  !ifdef UNINSTALLER_ICON
    Delete "$INSTDIR\uninstallerIcon.ico"
  !endif
  RMDir "$INSTDIR" ; without /r: only when nothing else is in it
!macroend

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
