# ============================================================
#  一键发版脚本
#  用法：powershell -ExecutionPolicy Bypass -File make-release.ps1
#        powershell ... -File make-release.ps1 -IncludeEasyTier   （联机组件有更新时才需要）
#
#  产物（dist 目录）：
#    IllusionLauncher-Setup-<ver>.exe           给新用户安装（含 EasyTier）
#    IllusionLauncher-<ver>-win-x64.zip         给自动更新（只含程序本体，约 2.5MB）
#    IllusionLauncher-<ver>-win-x64.zip.sha256  更新包校验值
#    EasyTier-core.zip                          联机组件单独包（可选上传）
# ============================================================
param(
    [switch]$IncludeEasyTier  # 联机组件有变动时加上此开关，更新包会包含 EasyTier
)
$ErrorActionPreference = 'Stop'

$root     = $PSScriptRoot
$project  = Join-Path $root 'IllusionLauncherWPF'
$csproj   = Join-Path $project 'IllusionLauncherWPF.csproj'
$pubDir   = Join-Path $root 'build\publish'
$distDir  = Join-Path $root 'build\dist'
$iss      = Join-Path $root 'installer\IllusionLauncher.iss'
$iscc     = 'D:\Inno Setup 6\ISCC.exe'

# ---------- 1. 读版本号 ----------
[xml]$proj = Get-Content $csproj -Raw
$version = ($proj.Project.PropertyGroup | Where-Object { $_.Version } | Select-Object -First 1).Version
if (-not $version) { $version = '0.0.0' }
Write-Host "[1/5] 版本号：$version" -ForegroundColor Cyan

# ---------- 2. 发布 ----------
Write-Host '[2/5] 正在 publish...' -ForegroundColor Cyan
if (Test-Path $pubDir) { Remove-Item $pubDir -Recurse -Force }
dotnet publish $csproj -c Release -r win-x64 --self-contained false `
    -p:PublishSingleFile=false -p:Platform=x64 -o $pubDir --nologo -v q
if ($LASTEXITCODE -ne 0) { throw 'publish 失败' }
Get-ChildItem $pubDir -Recurse -Filter *.pdb -ErrorAction SilentlyContinue | Remove-Item -Force

# ---------- 3. 打自动更新用的 zip（默认不含 EasyTier） ----------
Write-Host '[3/5] 正在打更新包...' -ForegroundColor Cyan
if (-not (Test-Path $distDir)) { New-Item -ItemType Directory -Path $distDir -Force | Out-Null }
$zipName = "IllusionLauncher-$version-win-x64.zip"
$zipPath = Join-Path $distDir $zipName
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }

Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::Open($zipPath, 'Create')
try {
    $files = Get-ChildItem $pubDir -Recurse -File | Where-Object {
        $IncludeEasyTier -or ($_.FullName -notlike "*\EasyTier\*")
    }
    foreach ($f in $files) {
        $rel = $f.FullName.Substring($pubDir.Length + 1).Replace('\', '/')
        [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $f.FullName, $rel, 'Optimal')
    }
} finally { $zip.Dispose() }

$zipSize = [math]::Round((Get-Item $zipPath).Length / 1MB, 2)
Write-Host ("      更新包 {0} ({1} MB，{2})" -f $zipName, $zipSize, $(if ($IncludeEasyTier) { '含 EasyTier' } else { '不含 EasyTier' })) -ForegroundColor Gray

# ---------- 4. SHA256 ----------
Write-Host '[4/5] 计算 SHA256...' -ForegroundColor Cyan
$hash = (Get-FileHash $zipPath -Algorithm SHA256).Hash.ToLower()
"$hash  $zipName" | Set-Content (Join-Path $distDir ($zipName + '.sha256')) -Encoding ASCII

# 联机组件单独包（安装包里已含，这个只是给需要单独更新联机组件时用）
$etDir = Join-Path $pubDir 'EasyTier'
if (Test-Path $etDir) {
    $etZip = Join-Path $distDir 'EasyTier-core.zip'
    if (Test-Path $etZip) { Remove-Item $etZip -Force }
    Compress-Archive -Path (Join-Path $etDir '*') -DestinationPath $etZip -CompressionLevel Optimal
    Write-Host ("      EasyTier-core.zip ({0} MB)" -f [math]::Round((Get-Item $etZip).Length / 1MB, 2)) -ForegroundColor Gray
}

# ---------- 5. 编译安装包 ----------
Write-Host '[5/5] 正在编译安装包...' -ForegroundColor Cyan
& $iscc $iss | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Inno Setup 编译失败' }

# ---------- 汇总 ----------
Write-Host ''
Write-Host '========== 发版完成 ==========' -ForegroundColor Green
Get-ChildItem $distDir | Sort-Object Name | ForEach-Object {
    '{0,-45} {1,8} MB' -f $_.Name, [math]::Round($_.Length / 1MB, 2)
}
Write-Host ''
Write-Host '上传到 GitHub Release：' -ForegroundColor Yellow
Write-Host ("  1) {0}          <- 自动更新必需" -f $zipName)
Write-Host ("  2) {0}.sha256   <- 校验必需" -f $zipName)
Write-Host ("  3) IllusionLauncher-Setup-{0}.exe   <- 新用户安装" -f $version)
Write-Host ("Tag 建议：v{0}" -f $version) -ForegroundColor Yellow
