$ErrorActionPreference = 'Continue'
$proj = 'D:\illusion-C#\illusionLauncher\IllusionLauncherWPF\IllusionLauncherWPF'
$log  = Join-Path $proj 'build\rebuild.log'
$exe  = Join-Path $proj 'bin\Debug\net10.0-windows10.0.19041.0\IllusionLauncherWPF.exe'

New-Item -ItemType Directory -Force -Path (Split-Path $log) | Out-Null
Set-Location $proj

Get-Process IllusionLauncherWPF -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 1500

$out  = & dotnet build -v m --nologo 2>&1
$code = $LASTEXITCODE
$out | Out-File -FilePath $log -Encoding UTF8

if ($code -eq 0) {
    "BUILD OK" | Out-File -Append $log -Encoding UTF8
    if (Test-Path $exe) {
        Start-Process -FilePath $exe -WorkingDirectory (Split-Path $exe) | Out-Null
        "STARTED" | Out-File -Append $log -Encoding UTF8
    } else {
        "EXE NOT FOUND: $exe" | Out-File -Append $log -Encoding UTF8
    }
} else {
    "BUILD FAILED code=$code" | Out-File -Append $log -Encoding UTF8
}
