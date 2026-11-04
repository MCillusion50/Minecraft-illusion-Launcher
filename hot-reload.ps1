# hot-reload.ps1 —— 双击桌面快捷方式：提权杀进程 -> dotnet build -> 启动
$ErrorActionPreference = 'Continue'

# --- 1. 自提权 ---
$isAdmin = ([Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Start-Process powershell -Verb RunAs -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-WindowStyle','Hidden','-File', $PSCommandPath)
    exit
}

$proj = 'D:\illusion-C#\illusionLauncher\IllusionLauncherWPF\IllusionLauncherWPF'
$log  = Join-Path $proj 'build\hot-reload.log'
$exe  = Join-Path $proj 'bin\Debug\net10.0-windows10.0.19041.0\IllusionLauncherWPF.exe'

New-Item -ItemType Directory -Force -Path (Split-Path $log) | Out-Null
Set-Location $proj

# --- 2. 杀进程 ---
Get-Process IllusionLauncherWPF -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 1200

# --- 3. 构建 ---
$out  = & dotnet build -v m --nologo 2>&1
$code = $LASTEXITCODE
$out | Out-File -FilePath $log -Encoding UTF8

if ($code -eq 0) {
    'BUILD OK' | Out-File -Append $log -Encoding UTF8
    if (Test-Path $exe) {
        Start-Process -FilePath $exe -WorkingDirectory (Split-Path $exe) | Out-Null
        'STARTED' | Out-File -Append $log -Encoding UTF8
    } else {
        "EXE NOT FOUND: $exe" | Out-File -Append $log -Encoding UTF8
    }
} else {
    "BUILD FAILED code=$code" | Out-File -Append $log -Encoding UTF8
}
