# ============================================================
#  一键发版脚本（自写安装器版）
#  用法：powershell -ExecutionPolicy Bypass -File make-release.ps1
#
#  产物（build\dist）：
#    IllusionLauncher-Setup-<ver>.exe          自写安装器（含程序载荷，约 22MB）
#    IllusionLauncher-<ver>-win-x64.zip        自动更新包（只含程序本体）
#    IllusionLauncher-<ver>-win-x64.zip.sha256 更新包校验值
# ============================================================
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$root      = $PSScriptRoot
$project   = Join-Path $root 'IllusionLauncherWPF'
$setupProj = Join-Path $root 'IllusionLauncher.Setup'
$pubDir    = Join-Path $root 'build\publish'
$distDir   = Join-Path $root 'build\dist'
$setupOut  = Join-Path $root 'build\setup'

function Write-Step($msg) { Write-Host "`n== $msg ==" -ForegroundColor Cyan }

# ---------- 1. 读版本号 ----------
$csproj = Join-Path $project 'IllusionLauncherWPF.csproj'
$version = ([xml](Get-Content $csproj -Raw)).Project.PropertyGroup.Version | Where-Object { $_ } | Select-Object -First 1
if (-not $version) { throw '无法从 csproj 读取 <Version>' }
Write-Step "版本 $version"

# ---------- 2. 清理 ----------
foreach ($d in @($pubDir, $distDir, $setupOut)) {
    if (Test-Path $d) { Remove-Item $d -Recurse -Force }
}
New-Item -ItemType Directory -Force -Path $pubDir, $distDir, $setupOut | Out-Null

# ---------- 3. 发布主程序 ----------
Write-Step '发布主程序 (Release win-x64)'
dotnet publish $csproj -c Release -r win-x64 --self-contained false `
    -p:PublishSingleFile=false -p:Platform=x64 -o $pubDir --nologo -v q
if ($LASTEXITCODE -ne 0) { throw 'publish 失败' }
Get-ChildItem $pubDir -Recurse -Filter *.pdb | Remove-Item -Force
Write-Host ("   程序文件: {0} 个, {1} MB" -f (Get-ChildItem $pubDir -Recurse -File).Count,
    [math]::Round(((Get-ChildItem $pubDir -Recurse -File | Measure-Object Length -Sum).Sum)/1MB,1))

# ---------- 4. 打两个 zip ----------
Add-Type -AssemblyName System.IO.Compression.FileSystem

function New-ZipFromDir($srcDir, $zipPath, $excludePattern) {
    if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
    $zip = [System.IO.Compression.ZipFile]::Open($zipPath, 'Create')
    try {
        Get-ChildItem $srcDir -Recurse -File | Where-Object {
            -not $excludePattern -or $_.FullName -notlike $excludePattern
        } | ForEach-Object {
            $rel = $_.FullName.Substring($srcDir.Length + 1)
            [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $_.FullName, $rel, 'Optimal')
        }
    } finally { $zip.Dispose() }
}

Write-Step '打包更新包（不含 EasyTier）'
$updateZip = Join-Path $distDir "IllusionLauncher-$version-win-x64.zip"
New-ZipFromDir $pubDir $updateZip "*\EasyTier\*"

Write-Step '打包安装器载荷（含 EasyTier）'
$payloadZip = Join-Path $root 'build\payload.zip'
New-ZipFromDir $pubDir $payloadZip $null
Copy-Item $payloadZip (Join-Path $setupProj 'payload.zip') -Force

$sha = (Get-FileHash $updateZip -Algorithm SHA256).Hash.ToLower()
Set-Content -Path ($updateZip + '.sha256') -Value ("{0}  {1}" -f $sha, (Split-Path $updateZip -Leaf)) -Encoding ASCII

# ---------- 5. 编译自写安装器 ----------
Write-Step '编译安装器 (net48 WPF)'
dotnet publish (Join-Path $setupProj 'IllusionLauncher.Setup.csproj') -c Release --nologo -v q -o $setupOut
if ($LASTEXITCODE -ne 0) { throw '安装器编译失败' }

$setupExe = Join-Path $setupOut 'IllusionLauncherSetup.exe'
if (-not (Test-Path $setupExe)) { throw '找不到安装器输出 exe' }
$finalSetup = Join-Path $distDir "IllusionLauncher-Setup-$version.exe"
Copy-Item $setupExe $finalSetup -Force

# 清理临时载荷，避免下次误用
Remove-Item (Join-Path $setupProj 'payload.zip') -Force -ErrorAction SilentlyContinue

# ---------- 6. 汇总 ----------
Write-Step '完成'
Get-ChildItem $distDir | ForEach-Object {
    Write-Host ("  {0,-46} {1,8} MB" -f $_.Name, [math]::Round($_.Length/1MB, 2))
}
Write-Host ""
Write-Host ("GitHub Release 需要上传：安装器 + 更新包 zip + zip.sha256") -ForegroundColor Yellow
Write-Host ("Tag 建议：v" + $version) -ForegroundColor Yellow
