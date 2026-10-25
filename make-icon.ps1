# Build app.ico (multi-size, PNG-compressed entries)
# Visual matches assets\logo.svg: dark rounded square + white ring
# Usage: powershell -ExecutionPolicy Bypass -File make-icon.ps1

Add-Type -AssemblyName System.Drawing

Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @"
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;

public static class IconGen
{
    static GraphicsPath RoundedRect(float w, float h, float r)
    {
        var p = new GraphicsPath();
        p.AddArc(0, 0, r * 2, r * 2, 180, 90);
        p.AddArc(w - r * 2, 0, r * 2, r * 2, 270, 90);
        p.AddArc(w - r * 2, h - r * 2, r * 2, r * 2, 0, 90);
        p.AddArc(0, h - r * 2, r * 2, r * 2, 90, 90);
        p.CloseFigure();
        return p;
    }

    public static Bitmap Render(int size)
    {
        var bmp = new Bitmap(size, size, PixelFormat.Format32bppArgb);
        using (var g = Graphics.FromImage(bmp))
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.Clear(Color.Transparent);

            using (var path = RoundedRect(size, size, size * 0.23f))
            using (var brush = new LinearGradientBrush(
                       new Rectangle(-1, -1, size + 2, size + 2),
                       Color.FromArgb(255, 26, 26, 36),
                       Color.FromArgb(255, 10, 10, 15),
                       90f))
            {
                g.FillPath(brush, path);
            }

            float d = size * 0.50f;
            float stroke = size * 0.115f;
            var rect = new RectangleF((size - d) / 2f, (size - d) / 2f, d, d);
            using (var pen = new Pen(Color.FromArgb(255, 255, 255, 255), stroke))
            {
                g.DrawEllipse(pen, rect);
            }
        }
        return bmp;
    }
}
"@

$sizes = @(16, 20, 24, 32, 40, 48, 64, 128, 256)
$root = $PSScriptRoot
$pngData = @()

foreach ($s in $sizes) {
    $bmp = [IconGen]::Render($s)
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $pngData += ,$ms.ToArray()
    $ms.Dispose()
    $bmp.Dispose()
}

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
