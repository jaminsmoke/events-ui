; Opt-in de `eui` en el PATH del usuario.
;
; Se incluye desde installer.nsi antes de las páginas de MUI. La casilla nace
; desmarcada: instalar el CLI en el PATH nunca es el comportamiento por
; defecto. Si se marca, se copia `eui.exe` a los datos del usuario y se añade
; esa carpeta al PATH de HKCU. El MCP no depende de esto: puede arrancar el
; binario por ruta absoluta.

Var EUI_PathCheck
Var EUI_PathCheckState
Var EUI_PathPassive
Var EUI_PathUpdate

; Funciones de StrFunc para el desinstalador (las de instalación ya las
; declara installer.nsi antes de incluir este hook).
${UnStrCase}
${UnStrLoc}

Page custom EUI_PathPage EUI_PathPageLeave

Function EUI_PathPage
  ${If} ${Silent}
    Abort
  ${EndIf}
  ${GetOptions} $CMDLINE "/P" $EUI_PathPassive
  ${IfNot} ${Errors}
    Abort
  ${EndIf}

  !insertmacro MUI_HEADER_TEXT "Componentes opcionales" \
    "Puedes añadir el comando eui al PATH de tu usuario."

  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}

  ${NSD_CreateCheckbox} 0 0 100% 12u "Añadir eui al PATH de este usuario"
  Pop $EUI_PathCheck
  ${NSD_Uncheck} $EUI_PathCheck

  ${NSD_CreateLabel} 10u 20u 100% 34u \
    "Desmarcado por defecto. Solo modifica el PATH del usuario actual y copia eui.exe a %LOCALAPPDATA%\Events UI\bin. El MCP puede seguir usando una ruta absoluta sin esta opción."
  Pop $0

  nsDialogs::Show
FunctionEnd

Function EUI_PathPageLeave
  ${NSD_GetState} $EUI_PathCheck $EUI_PathCheckState
FunctionEnd

!macro NSIS_HOOK_PREINSTALL
  ; El updater hace ShellExecute de este instalador y acto seguido exit(0).
  ; CheckIfAppIsRunning (Restart Manager) corre justo después de este hook: si
  ; events-ui sigue vivo —sobre todo si la app iba elevada y el instalador no—
  ; aborta con «Insufficient permissions to close». Esperamos a que desaparezca
  ; (el exit del updater) y usamos taskkill solo como respaldo (instalación a
  ; mano). El sidecar onefile también debe soltar events-core.exe.
  StrCpy $R9 0
  eui_wait_ui:
    nsExec::ExecToStack 'cmd /c tasklist /FI "IMAGENAME eq events-ui.exe" /NH 2>nul | find /I "events-ui.exe" >nul'
    Pop $R7
    Pop $R8
    IntCmp $R7 0 eui_ui_viva eui_ui_fuera eui_ui_fuera
  eui_ui_viva:
    nsExec::Exec '"$SYSDIR\taskkill.exe" /F /T /IM events-ui.exe'
    Sleep 500
    IntOp $R9 $R9 + 1
    IntCmp $R9 40 eui_ui_fuera 0 eui_wait_ui
  eui_ui_fuera:

  StrCpy $R9 0
  eui_wait_core:
    nsExec::Exec '"$SYSDIR\taskkill.exe" /F /T /IM events-core.exe'
    nsExec::ExecToStack 'cmd /c tasklist /FI "IMAGENAME eq events-core.exe" /NH 2>nul | find /I "events-core.exe" >nul'
    Pop $R7
    Pop $R8
    IntCmp $R7 0 eui_core_vivo eui_core_fuera eui_core_fuera
  eui_core_vivo:
    Sleep 400
    IntOp $R9 $R9 + 1
    IntCmp $R9 25 eui_core_fuera 0 eui_wait_core
  eui_core_fuera:
  Sleep 300
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ${If} $EUI_PathCheckState == ${BST_CHECKED}
    Call EUI_EnablePath
  ${Else}
    ; En una actualización silenciosa la casilla no se ve. Si el usuario ya
    ; tenía `eui` en el PATH, se refresca el binario copiado sin tocar el PATH.
    Call EUI_RefreshPathIfEnabled
  ${EndIf}
  ; El relanzamiento tras updater lo hace `.onInstSuccess` con /R (passive y
  ; quiet). No se fuerza otro Exec aquí para no abrir dos instancias.
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; En una actualización el desinstalador se ejecuta con /UPDATE: no se toca
  ; el PATH para que la instalación nueva siga funcionando.
  ${GetOptions} $CMDLINE "/UPDATE" $EUI_PathUpdate
  ${If} ${Errors}
    Call un.EUI_DisablePath
  ${EndIf}
!macroend

Function EUI_RefreshPathIfEnabled
  StrCpy $0 "$LOCALAPPDATA\Events UI\bin"
  ReadRegStr $1 HKCU "Environment" "Path"
  ${StrCase} $2 "$0" "L"
  ${StrCase} $3 "$1" "L"
  ${StrLoc} $4 "$3" "$2" ">"
  ${If} $4 == ""
    Return
  ${EndIf}
  CreateDirectory "$0"
  CopyFiles /SILENT "$INSTDIR\eui.exe" "$0"
FunctionEnd

Function EUI_EnablePath
  StrCpy $0 "$LOCALAPPDATA\Events UI\bin"
  CreateDirectory "$0"
  CopyFiles /SILENT "$INSTDIR\eui.exe" "$0"

  ReadRegStr $1 HKCU "Environment" "Path"
  ${StrCase} $2 "$0" "L"
  ${StrCase} $3 "$1" "L"
  ${StrLoc} $4 "$3" "$2" ">"
  ${If} $4 != ""
    Return
  ${EndIf}

  ${If} $1 == ""
    StrCpy $1 "$0"
  ${Else}
    StrCpy $1 "$1;$0"
  ${EndIf}
  WriteRegExpandStr HKCU "Environment" "Path" "$1"

  ; Avisa a Explorer para que los procesos nuevos vean el PATH actualizado.
  System::Call 'user32::SendMessageTimeout(p 0xFFFF, i 0x001A, p 0, w "Environment", i 2, i 5000, *i .r0)'
FunctionEnd

Function un.EUI_DisablePath
  StrCpy $0 "$LOCALAPPDATA\Events UI\bin"
  ReadRegStr $1 HKCU "Environment" "Path"
  ${UnStrCase} $2 "$0" "L"
  ${UnStrCase} $3 "$1" "L"
  ${UnStrLoc} $4 "$3" "$2" ">"
  ${If} $4 == ""
    Return
  ${EndIf}

  ; La entrada que añadimos va al final. Si el usuario la movió, se deja tal
  ; cual: no se reescribe un PATH ajeno a ciegas.
  StrLen $5 "$0"
  StrLen $6 "$1"
  IntOp $7 $4 + $5
  ${If} $1 == "$0"
    StrCpy $1 ""
  ${ElseIf} $7 == $6
    IntOp $8 $4 - 1
    StrCpy $9 "$1" 1 $8
    ${If} $9 == ";"
      StrCpy $1 "$1" $8
    ${EndIf}
  ${EndIf}

  WriteRegExpandStr HKCU "Environment" "Path" "$1"
  RMDir /r "$0"
  System::Call 'user32::SendMessageTimeout(p 0xFFFF, i 0x001A, p 0, w "Environment", i 2, i 5000, *i .r0)'
FunctionEnd
