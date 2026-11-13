; Roomia Desktop — Windows installer (13 Nov 2026).
;
; A classic setup: welcome, choose the folder, install, finish (with "Lancer Roomia"). Per user (no admin rights asked):
; the default folder is %LOCALAPPDATA%\Programs\Roomia, where Roomia's own updater can write (Aide › Rechercher une mise
; à jour). Desktop and Start-menu shortcuts, the roomia:// link used by the SketchUp extension, and an entry in
; "Ajouter ou supprimer des programmes" with an uninstaller.
;
; The projects are NOT in the install folder: they live in %LOCALAPPDATA%\Roomia, and neither the installer nor the
; uninstaller ever touches that folder.
;
; Built on Linux by desktop/scripts/build-installer.mjs with the makensis that electron-builder downloads (no Wine):
;   makensis -DVERSION=0.4.7 -DSRC=<dist/win-unpacked> -DOUTFILE=<dist/Roomia-Setup-0.4.7.exe> roomia.nsi

Unicode true
SetCompressor /SOLID lzma
SetCompressorDictSize 64
RequestExecutionLevel user
ManifestDPIAware true

!ifndef VERSION
  !error "VERSION missing"
!endif
!ifndef SRC
  !error "SRC missing (the win-unpacked folder)"
!endif
!ifndef OUTFILE
  !define OUTFILE "Roomia-Setup-${VERSION}.exe"
!endif

!define APP "Roomia"
!define EXE "Roomia.exe"
!define UNINST "Désinstaller Roomia.exe"
!define UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\Roomia"

Name "${APP} ${VERSION}"
OutFile "${OUTFILE}"
; the last part ("Roomia") is added back by NSIS when the user browses to another folder
InstallDir "$LOCALAPPDATA\Programs\Roomia"
InstallDirRegKey HKCU "${UNINST_KEY}" "InstallLocation"
BrandingText "Roomia ${VERSION}"

VIProductVersion "${VERSION}.0"
VIAddVersionKey /LANG=1036 "ProductName" "${APP}"
VIAddVersionKey /LANG=1036 "FileDescription" "Installation de Roomia"
VIAddVersionKey /LANG=1036 "FileVersion" "${VERSION}"
VIAddVersionKey /LANG=1036 "ProductVersion" "${VERSION}"
VIAddVersionKey /LANG=1036 "CompanyName" "Roomia"
VIAddVersionKey /LANG=1036 "LegalCopyright" "Roomia"

!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"

!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "Installation de Roomia ${VERSION}"
!define MUI_WELCOMEPAGE_TEXT "Roomia transforme vos projets SketchUp en visite 360°, plans et photos réalistes, sur votre propre PC.$\r$\n$\r$\nFermez Roomia s'il est ouvert, puis cliquez sur Suivant."
!define MUI_DIRECTORYPAGE_TEXT_TOP "Roomia sera installé dans ce dossier. Le dossier proposé est recommandé : Roomia peut s'y mettre à jour tout seul.$\r$\n$\r$\nVos projets ne sont pas dans ce dossier : ils restent dans %LOCALAPPDATA%\Roomia."
!define MUI_FINISHPAGE_RUN "$INSTDIR\${EXE}"
!define MUI_FINISHPAGE_RUN_TEXT "Lancer Roomia"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "French"

; Roomia must be closed: its files are in use while it runs.
!macro WAIT_ROOMIA_CLOSED
  ${Do}
    nsExec::ExecToStack 'cmd.exe /c tasklist /FI "IMAGENAME eq ${EXE}" /NH | find /I "${EXE}"'
    Pop $0
    Pop $1
    ${If} $0 != 0
      ${Break}
    ${EndIf}
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "Roomia est ouvert. Fermez-le (et attendez qu'il ait fini une éventuelle mise à jour), puis cliquez sur Réessayer." IDRETRY +2
    Abort
  ${Loop}
!macroend

; Never install into the projects folder, or the uninstaller would remove the projects with it.
Function .onVerifyInstDir
  ${If} $INSTDIR == "$LOCALAPPDATA\Roomia"
  ${OrIf} $INSTDIR == "$LOCALAPPDATA\Roomia\"
    Abort
  ${EndIf}
FunctionEnd

Section "Roomia" SecMain
  SectionIn RO
  !insertmacro WAIT_ROOMIA_CLOSED

  SetOutPath "$INSTDIR"
  ; a reinstall over an older version: the app's own files are replaced, nothing else in the folder is touched
  RMDir /r "$INSTDIR\resources\app-server"
  File /r "${SRC}\*.*"

  WriteUninstaller "$INSTDIR\${UNINST}"

  CreateDirectory "$SMPROGRAMS\Roomia"
  CreateShortCut "$SMPROGRAMS\Roomia\Roomia.lnk" "$INSTDIR\${EXE}"
  CreateShortCut "$SMPROGRAMS\Roomia\Désinstaller Roomia.lnk" "$INSTDIR\${UNINST}"
  CreateShortCut "$DESKTOP\Roomia.lnk" "$INSTDIR\${EXE}"

  ; roomia:// (the SketchUp extension wakes Roomia with it; Roomia also registers it itself at start)
  WriteRegStr HKCU "Software\Classes\roomia" "" "URL:Roomia"
  WriteRegStr HKCU "Software\Classes\roomia" "URL Protocol" ""
  WriteRegStr HKCU "Software\Classes\roomia\shell\open\command" "" '"$INSTDIR\${EXE}" "%1"'

  ; "Ajouter ou supprimer des programmes"
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayName" "Roomia"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINST_KEY}" "Publisher" "Roomia"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayIcon" "$INSTDIR\${EXE}"
  WriteRegStr HKCU "${UNINST_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINST_KEY}" "UninstallString" '"$INSTDIR\${UNINST}"'
  WriteRegStr HKCU "${UNINST_KEY}" "QuietUninstallString" '"$INSTDIR\${UNINST}" /S'
  WriteRegDWORD HKCU "${UNINST_KEY}" "EstimatedSize" $0
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoRepair" 1
SectionEnd

Function un.onInit
  ; only ever remove a folder that really is a Roomia install, and never the projects folder
  ${IfNot} ${FileExists} "$INSTDIR\${EXE}"
  ${OrIf} $INSTDIR == "$LOCALAPPDATA\Roomia"
    MessageBox MB_OK|MB_ICONSTOP "Ce dossier ne ressemble pas à une installation de Roomia : rien n'a été supprimé."
    Abort
  ${EndIf}
FunctionEnd

Section "Uninstall"
  !insertmacro WAIT_ROOMIA_CLOSED

  Delete "$DESKTOP\Roomia.lnk"
  RMDir /r "$SMPROGRAMS\Roomia"
  DeleteRegKey HKCU "Software\Classes\roomia"
  DeleteRegKey HKCU "${UNINST_KEY}"

  ; the app's folder only; the projects (%LOCALAPPDATA%\Roomia) stay
  RMDir /r "$INSTDIR"
SectionEnd
