# Diagnostico: o host do projeto Supabase resolve? O supabase.com responde?
$ErrorActionPreference = 'Continue'

$nomes = @(
    'cfwyrzvnodaqgfutbcph.supabase.co',
    'supabase.co',
    'supabase.com',
    'ateliedalili-site.pages.dev'
)

Write-Host "=== resolucao de nomes (DNS)"
foreach ($n in $nomes) {
    try {
        $r = Resolve-DnsName -Name $n -Type A -ErrorAction Stop
        $ips = ($r | Where-Object { $_.IPAddress } | ForEach-Object { $_.IPAddress }) -join ', '
        if (-not $ips) { $ips = '(sem registro A)' }
        Write-Host ("  OK    {0,-45} {1}" -f $n, $ips)
    } catch {
        Write-Host ("  FALHA {0,-45} {1}" -f $n, $_.Exception.Message)
    }
}

Write-Host ""
Write-Host "=== servidores DNS em uso"
Get-DnsClientServerAddress -AddressFamily IPv4 | Where-Object { $_.ServerAddresses } | ForEach-Object {
    Write-Host ("  " + $_.InterfaceAlias + " -> " + ($_.ServerAddresses -join ', '))
}

Write-Host ""
Write-Host "=== teste direto pelo DNS publico do Google (8.8.8.8)"
try {
    $r = Resolve-DnsName -Name 'cfwyrzvnodaqgfutbcph.supabase.co' -Server 8.8.8.8 -Type A -ErrorAction Stop
    $ips = ($r | Where-Object { $_.IPAddress } | ForEach-Object { $_.IPAddress }) -join ', '
    Write-Host ("  resolveu: " + $ips)
    Write-Host "  => o projeto existe; o bloqueio esta no DNS da sua rede"
} catch {
    Write-Host ("  nao resolveu: " + $_.Exception.Message)
    Write-Host "  => o host nao existe no DNS publico: projeto pausado ou removido"
}
