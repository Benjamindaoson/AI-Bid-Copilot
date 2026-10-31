$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$assetDir = Join-Path $PSScriptRoot '..\assets'
$sizes = @(16, 24, 32, 48, 64, 128, 256)
foreach ($size in $sizes) {
  $bitmap = [System.Drawing.Bitmap]::new($size, $size)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $background = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(51, 65, 85))
  $paper = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::White)
  $line = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(148, 163, 184), [Math]::Max(1, [Math]::Round($size / 27)))
  try {
    $graphics.FillRectangle($background, 0, 0, $size, $size)
    $margin = [Math]::Max(3, [Math]::Round($size * 0.25))
    $top = [Math]::Max(2, [Math]::Round($size * 0.17))
    $width = $size - $margin * 2
    $height = $size - $top * 2
    $graphics.FillRectangle($paper, $margin, $top, $width, $height)
    foreach ($fraction in @(0.40, 0.55, 0.70)) {
      $y = [Math]::Round($top + $height * $fraction)
      $graphics.DrawLine($line, $margin + [Math]::Max(2, $size * 0.07), $y, $margin + $width - [Math]::Max(2, $size * 0.07), $y)
    }
    $bitmap.Save((Join-Path $assetDir "icon_$size.png"), [System.Drawing.Imaging.ImageFormat]::Png)
  } finally {
    $line.Dispose(); $paper.Dispose(); $background.Dispose(); $graphics.Dispose(); $bitmap.Dispose()
  }
}
$png = [System.IO.File]::ReadAllBytes((Join-Path $assetDir 'icon_256.png'))
$icoFile = [System.IO.File]::Open((Join-Path $assetDir 'icon.ico'), [System.IO.FileMode]::Create)
$writer = [System.IO.BinaryWriter]::new($icoFile)
try {
  $writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]1)
  $writer.Write([byte]0); $writer.Write([byte]0); $writer.Write([byte]0); $writer.Write([byte]0)
  $writer.Write([uint16]1); $writer.Write([uint16]32)
  $writer.Write([uint32]$png.Length); $writer.Write([uint32]22)
  $writer.Write($png)
} finally { $writer.Dispose() }
