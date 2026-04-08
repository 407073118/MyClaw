!include "MUI2.nsh"
!include "nsDialogs.nsh"
!include "LogicLib.nsh"

!ifndef BUILD_UNINSTALLER
Var DataDirInput
Var DataDirBrowseButton
Var DataDirValue

!macro customPageAfterChangeDir
  PageEx custom
    PageCallbacks DataDirPageCreate DataDirPageLeave
    Caption " "
  PageExEnd
!macroend

; 中文注释：从当前安装目录读取上次保存的数据目录，便于升级时沿用原配置。
Function LoadInstallerDataDirValue
  StrCpy $DataDirValue ""
  IfFileExists "$INSTDIR\myclaw-data-root.txt" 0 done

  ClearErrors
  FileOpen $0 "$INSTDIR\myclaw-data-root.txt" r
  IfErrors done

  FileRead $0 $DataDirValue
  FileClose $0

done:
FunctionEnd

; 中文注释：为安装器准备默认数据目录，未命中旧配置时回退到当前用户 LocalAppData。
Function EnsureDefaultDataDirValue
  ${If} $DataDirValue == ""
    Call LoadInstallerDataDirValue
  ${EndIf}

  ${If} $DataDirValue == ""
    StrCpy $DataDirValue "$LOCALAPPDATA\MyClaw\data"
  ${EndIf}
FunctionEnd

; 中文注释：创建“数据目录”选择页，引导用户把会话、模型、技能等运行数据放到可写目录。
Function DataDirPageCreate
  !insertmacro MUI_HEADER_TEXT "选择数据目录" "请选择 MyClaw 的数据存储目录"
  nsDialogs::Create 1018
  Pop $0

  ${If} $0 == error
    Abort
  ${EndIf}

  Call EnsureDefaultDataDirValue

  ${NSD_CreateLabel} 0u 0u 100% 28u "安装目录只存放程序文件。请为技能、会话、模型和设置选择一个可写的数据目录，避免使用 Program Files。"
  Pop $0

  ${NSD_CreateLabel} 0u 42u 100% 12u "数据目录"
  Pop $0

  ${NSD_CreateDirRequest} 0u 58u 82% 14u "$DataDirValue"
  Pop $DataDirInput

  ${NSD_CreateBrowseButton} 84% 58u 16% 14u "浏览..."
  Pop $DataDirBrowseButton
  ${NSD_OnClick} $DataDirBrowseButton DataDirBrowse

  ${NSD_CreateLabel} 0u 84u 100% 30u "建议选择独立目录，例如 D:\MyClawData 或当前用户的 AppData\Local 目录。"
  Pop $0

  nsDialogs::Show
FunctionEnd

; 中文注释：点击“浏览”后弹出目录选择框，并把用户选中的路径回填到输入框。
Function DataDirBrowse
  ${NSD_GetText} $DataDirInput $DataDirValue
  nsDialogs::SelectFolderDialog "选择 MyClaw 数据目录" "$DataDirValue"
  Pop $0

  ${If} $0 != error
    StrCpy $DataDirValue $0
    ${NSD_SetText} $DataDirInput $DataDirValue
  ${EndIf}
FunctionEnd

; 中文注释：离开页面前校验并创建数据目录，确保安装完成后应用首次启动即可写入。
Function DataDirPageLeave
  ${NSD_GetText} $DataDirInput $DataDirValue

  ${If} $DataDirValue == ""
    MessageBox MB_ICONEXCLAMATION|MB_OK "请选择 MyClaw 数据目录。"
    Abort
  ${EndIf}

  ClearErrors
  CreateDirectory "$DataDirValue"
  IfErrors create_failed
  Goto done

create_failed:
  MessageBox MB_ICONSTOP|MB_OK "无法创建数据目录：$DataDirValue$\r$\n请重新选择一个有写权限的目录。"
  Abort

done:
FunctionEnd

!macro customInstall
  Call EnsureDefaultDataDirValue

  ClearErrors
  FileOpen $0 "$INSTDIR\myclaw-data-root.txt" w
  IfErrors write_failed

  FileWrite $0 "$DataDirValue"
  FileClose $0
  DetailPrint "MyClaw 数据目录: $DataDirValue"
  Goto write_done

write_failed:
  MessageBox MB_ICONSTOP|MB_OK "无法写入 MyClaw 数据目录配置文件：$INSTDIR\myclaw-data-root.txt"
  Abort

write_done:
!macroend
!endif
