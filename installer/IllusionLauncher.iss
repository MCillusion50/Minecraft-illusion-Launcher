; ============================================================
;  Illusion Launcher 安装脚本（Inno Setup 6）
;  用法：先用 dotnet publish 生成 ..\publish，再编译本脚本
;  产物：..\dist\IllusionLauncher-Setup-<版本>.exe
; ============================================================

#define AppName        "Illusion Launcher"
#define AppPublisher   "MCillusion50"
#define AppURL         "https://github.com/MCillusion50/Minecraft-illusion-Launcher"
#define AppExe         "IllusionLauncherWPF.exe"
#define SourceDir      "..\build\publish"

; 版本号直接读发布出来的 exe，不用手工同步
#if FileExists(AddBackslash(SourcePath) + SourceDir + "\" + AppExe)
  #define AppVersion GetFileVersion(AddBackslash(SourcePath) + SourceDir + "\" + AppExe)
#else
  #define AppVersion "0.1.0"
#endif

; 依赖下载地址（想离线安装就换成你自己放的本地文件路径）
#define DotNetRuntimeUrl   "https://aka.ms/dotnet/10.0/windowsdesktop-runtime-win-x64.exe"
#define WebView2BootUrl    "https://go.microsoft.com/fwlink/p/?LinkId=2124703"

[Setup]
AppId={{9F3A7C2E-5B41-4D8A-9E6F-2C7B1D4A8E33}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher={#AppPublisher}
AppPublisherURL={#AppURL}
AppSupportURL={#AppURL}/issues
AppUpdatesURL={#AppURL}/releases
DefaultDirName={autopf}\IllusionLauncher
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
DisableDirPage=no
OutputDir=..\build\dist
OutputBaseFilename=IllusionLauncher-Setup-{#AppVersion}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=admin
UninstallDisplayIcon={app}\{#AppExe}
UninstallDisplayName={#AppName}
MinVersion=10.0
; SetupIconFile=icon.ico   ; 有图标就取消注释

[Languages]
Name: "en"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"; GroupDescription: "附加任务："; Flags: unchecked

[Files]
; 主程序本体
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

; 依赖 1：.NET 10 桌面运行时（缺失时才下载）
Source: "{#DotNetRuntimeUrl}"; DestDir: "{tmp}"; DestName: "dotnet-desktop-runtime.exe"; \
    ExternalSize: 60000000; Flags: external download ignoreversion deleteafterinstall; Check: not IsDotNetDesktopInstalled

; 依赖 2：WebView2 运行时（缺失时才下载）
Source: "{#WebView2BootUrl}"; DestDir: "{tmp}"; DestName: "webview2-setup.exe"; \
    ExternalSize: 1800000; Flags: external download ignoreversion deleteafterinstall; Check: not IsWebView2Installed

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\{#AppExe}"
Name: "{group}\卸载 {#AppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExe}"; Tasks: desktopicon

[Run]
; 先装依赖，再启动程序（顺序不能换）
Filename: "{tmp}\dotnet-desktop-runtime.exe"; Parameters: "/install /quiet /norestart"; \
    StatusMsg: "正在安装 .NET 10 桌面运行时（约 1-2 分钟）..."; \
    Flags: waituntilterminated; Check: not IsDotNetDesktopInstalled

Filename: "{tmp}\webview2-setup.exe"; Parameters: "/silent /install"; \
    StatusMsg: "正在安装 WebView2 运行时..."; \
    Flags: waituntilterminated; Check: not IsWebView2Installed

Filename: "{app}\{#AppExe}"; Description: "立即启动 {#AppName}"; \
    Flags: nowait postinstall skipifsilent

[UninstallDelete]
; 只清程序目录，用户配置在 %APPDATA%\\.illusionlauncher，卸载时保留
Type: filesandordirs; Name: "{app}\wwwroot\*.bak"

[Code]
{ 检测 .NET 10 桌面运行时：注册表里 sharedfx\Microsoft.WindowsDesktop.App 下是否有 10.x 的值 }
function IsDotNetDesktopInstalled: Boolean;
var
  Names: TArrayOfString;
  I: Integer;
begin
  Result := False;

  if RegGetValueNames(HKLM64, 'SOFTWARE\dotnet\Setup\InstalledVersions\x64\sharedfx\Microsoft.WindowsDesktop.App', Names) then
    for I := 0 to GetArrayLength(Names) - 1 do
      if Pos('10.', Names[I]) = 1 then
      begin
        Result := True;
        Exit;
      end;

  if RegGetValueNames(HKCU, 'SOFTWARE\dotnet\Setup\InstalledVersions\x64\sharedfx\Microsoft.WindowsDesktop.App', Names) then
    for I := 0 to GetArrayLength(Names) - 1 do
      if Pos('10.', Names[I]) = 1 then
      begin
        Result := True;
        Exit;
      end;
end;

{ 检测 WebView2 运行时（系统级或用户级安装都算） }
function IsWebView2Installed: Boolean;
begin
  Result :=
    RegKeyExists(HKLM64, 'SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}') or
    RegKeyExists(HKCU,   'Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}');
end;

{ 安装完成后做一次体检，缺文件就提示（不阻断卸载/修复） }
procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then
  begin
    if not FileExists(ExpandConstant('{app}\{#AppExe}')) then
      MsgBox('安装似乎不完整：找不到 {#AppExe}' + #13#10 +
             '请重新运行安装程序。', mbError, MB_OK);

    if not FileExists(ExpandConstant('{app}\wwwroot\index.html')) then
      MsgBox('安装似乎不完整：找不到 wwwroot\index.html' + #13#10 +
             '界面将无法显示，请重新运行安装程序。', mbError, MB_OK);

    if not FileExists(ExpandConstant('{app}\EasyTier\easytier-core.exe')) then
      MsgBox('安装似乎不完整：找不到 EasyTier\easytier-core.exe' + #13#10 +
             '联机功能将不可用，请重新运行安装程序。', mbError, MB_OK);
  end;
end;
