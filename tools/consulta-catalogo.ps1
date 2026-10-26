# Consulta o catalogo publico no Supabase (somente leitura, mesma chamada que o site faz)
$ErrorActionPreference = 'Stop'
$raiz = Split-Path $PSScriptRoot -Parent
$js   = Get-Content (Join-Path $raiz 'ateliedalili-site\js\catalog-data.js') -Raw

$url  = [regex]::Match($js, "SUPABASE_URL\s*=\s*'([^']+)'").Groups[1].Value
$anon = [regex]::Match($js, "SUPABASE_ANON\s*=\s*'([^']+)'").Groups[1].Value
$h    = @{ apikey = $anon; Authorization = "Bearer $anon"; 'Content-Type' = 'application/json' }

$resultado = [ordered]@{}

Write-Host "consultando $url/rest/v1/rpc/public_catalog ..."
$rows = Invoke-RestMethod -Method Post -Uri "$url/rest/v1/rpc/public_catalog" -Headers $h -Body '{}' -TimeoutSec 30

$resultado.total   = $rows.Count
$resultado.menino  = @($rows | Where-Object { $_.sku -like 'SM-M*' }).Count
$resultado.menina  = @($rows | Where-Object { $_.sku -like 'SM-G*' }).Count
$resultado.campos  = @(($rows | Select-Object -First 1).PSObject.Properties.Name)
$resultado.skus    = @($rows | ForEach-Object { $_.sku } | Sort-Object)

Write-Host ""
Write-Host ("produtos no banco : " + $resultado.total)
Write-Host ("  linha menina    : " + $resultado.menina)
Write-Host ("  linha menino    : " + $resultado.menino)
Write-Host ""
Write-Host ("campos: " + ($resultado.campos -join ', '))

$saida = Join-Path $PSScriptRoot 'catalogo-estado.json'
$resultado | ConvertTo-Json -Depth 5 | Out-File $saida -Encoding utf8
Write-Host ""
Write-Host "resultado salvo em $saida"
