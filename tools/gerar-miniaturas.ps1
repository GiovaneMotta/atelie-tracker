# Gera miniaturas na mesma convencao das ja existentes: 500px de largura, JPEG.
# Uso: gerar-miniaturas.ps1 -Pasta "ateliedalili-site\images\menino"
param(
    [Parameter(Mandatory = $true)][string]$Pasta,
    [int]$Largura = 500,
    [int]$Qualidade = 82
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$origem = (Resolve-Path $Pasta).Path
$destino = Join-Path $origem 'thumb'
if (-not (Test-Path $destino)) { New-Item -ItemType Directory -Path $destino -Force | Out-Null }

$codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
$params = New-Object System.Drawing.Imaging.EncoderParameters 1
$params.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality), ([long]$Qualidade)

$feitos = 0
foreach ($arq in Get-ChildItem $origem -File -Filter *.jpg) {
    $saida = Join-Path $destino $arq.Name

    $img = [System.Drawing.Image]::FromFile($arq.FullName)
    try {
        $w = $Largura
        $h = [int][math]::Round($img.Height * ($Largura / $img.Width))

        $bmp = New-Object System.Drawing.Bitmap $w, $h
        $g   = [System.Drawing.Graphics]::FromImage($bmp)
        $g.InterpolationMode  = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $g.PixelOffsetMode    = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $g.SmoothingMode      = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
        $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
        $g.DrawImage($img, 0, 0, $w, $h)
        $g.Dispose()

        $bmp.Save($saida, $codec, $params)
        $bmp.Dispose()

        $antes  = [math]::Round($arq.Length / 1KB)
        $depois = [math]::Round((Get-Item $saida).Length / 1KB)
        Write-Host ("  {0,-10} {1,4}x{2,-4} {3,4} KB  ->  {4}x{5}  {6,3} KB" -f $arq.Name, $img.Width, $img.Height, $antes, $w, $h, $depois)
        $feitos++
    } finally {
        $img.Dispose()
    }
}

Write-Host ""
$totalAntes  = (Get-ChildItem $origem -File -Filter *.jpg | Measure-Object Length -Sum).Sum
$totalDepois = (Get-ChildItem $destino -File -Filter *.jpg | Measure-Object Length -Sum).Sum
Write-Host ("$feitos miniaturas geradas em $destino")
Write-Host ("peso do conjunto: {0:N1} MB  ->  {1:N1} MB  ({2}% menor)" -f ($totalAntes/1MB), ($totalDepois/1MB), [math]::Round(100 - ($totalDepois/$totalAntes*100)))
