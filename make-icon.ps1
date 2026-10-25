# Build app.ico (multi-size, PNG-compressed entries)
# Visual: transparent background + white ring (+ soft shadow so it stays
# visible on white backgrounds). Rendered with WPF so the shadow is a real
# gaussian blur instead of stacked strokes.
# Usage: powershell -ExecutionPolicy Bypass -File make-icon.ps1

Add-Type -AssemblyName PresentationCore, PresentationFramework, WindowsBase

function Render-Ring([int]$size) {
    $visual = New-Object System.Windows.Media.DrawingVisual
    $dc = $visual.RenderOpen()

    $c = $size / 2.0
    # keep the ring small enough that the shadow stays inside the bitmap
    $radius = $size * 0.30
    $stroke = $size * 0.115

    $brush = New-Object System.Windows.Media.SolidColorBrush ([System.Windows.Media.Color]::FromArgb(255,255,255,255))
    $brush.Freeze()
    $pen = New-Object System.Windows.Media.Pen $brush, $stroke
    $pen.Freeze()

    $dc.DrawEllipse($null, $pen, (New-Object System.Windows.Point($c, $c)), $radius, $radius)
    $dc.Close()

    if ($size -ge 32) {
        $eff = New-Object System.Windows.Media.Effects.DropShadowEffect
        $eff.Color = [System.Windows.Media.Colors]::Black
        $eff.BlurRadius = [math]::Max(3, $size * 0.10)
        $eff.ShadowDepth = 0
        $eff.Opacity = 0.50
        $visual.Effect = $eff
    }

    $rtb = New-Object System.Windows.Media.Imaging.RenderTargetBitmap ($size, $size, 96, 96, [System.Windows.Media.PixelFormats]::Pbgra32)
    $rtb.Render($visual)
    return $rtb
}

function Encode-Png($bitmap, $path) {
    $enc = New-Object System.Windows.Media.Imaging.PngBitmapEncoder
    $enc.Frames.Add([System.Windows.Media.Imaging.BitmapFrame]::Create($bitmap))
    $fs = [System.IO.File]::Create($path)
    $enc.Save($fs)
    $fs.Close()
}

$sizes = @(16, 20, 24, 32, 40, 48, 64, 128, 256)
$root = $PSScriptRoot
$pngData = @()
$tmpDir = Join-Path $env:TEMP ("iconbuild_" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $tmpDir | Out-Null

foreach ($s in $sizes) {
    $bmp = Render-Ring $s
    $tmpPng = Join-Path $tmpDir "$s.png"
    Encode-Png $bmp $tmpPng
    $pngData += ,([System.IO.File]::ReadAllBytes($tmpPng))
}
Remove-Item $tmpDir -Recurse -Force -ErrorAction SilentlyContinue

# ---- assemble ICO (Vista+ supports PNG-compressed entries) ----
$out = Join-Path $root "app.ico"
$fs = [System.IO.File]::Create($out)
$bw = New-Object System.IO.BinaryWriter($fs)

$bw.Write([UInt16]0)
$bw.Write([UInt16]1)
$bw.Write([UInt16]$sizes.Count)

$offset = 6 + 16 * $sizes.Count
for ($i = 0; $i -lt $sizes.Count; $i++) {
    $s = $sizes[$i]
    $data = $pngData[$i]
    $dim = if ($s -ge 256) { 0 } else { $s }
    $bw.Write([Byte]$dim)
    $bw.Write([Byte]$dim)
    $bw.Write([Byte]0)
    $bw.Write([Byte]0)
    $bw.Write([UInt16]1)
    $bw.Write([UInt16]32)
    $bw.Write([UInt32]$data.Length)
    $bw.Write([UInt32]$offset)
    $offset += $data.Length
}
foreach ($d in $pngData) { $bw.Write($d) }

$bw.Flush()
$bw.Close()
$fs.Close()

Write-Host ("app.ico written: {0} ({1} sizes, {2:F1} KB)" -f $out, $sizes.Count, ((Get-Item $out).Length / 1KB))

$targets = @(
    (Join-Path $root "IllusionLauncherWPF\app.ico"),
    (Join-Path $root "IllusionLauncher.Setup\app.ico")
)
foreach ($t in $targets) {
    if (Test-Path (Split-Path $t)) {
        Copy-Item $out $t -Force
        Write-Host ("  -> {0}" -f $t)
    }
}
