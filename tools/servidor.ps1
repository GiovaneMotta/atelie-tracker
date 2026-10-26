param(
    [string]$Root = "ateliedalili-site",
    [int]$Port = 8790
)

$ErrorActionPreference = "Stop"
$Root = (Resolve-Path $Root).Path

$types = @{
    '.html'='text/html; charset=utf-8'; '.css'='text/css; charset=utf-8'
    '.js'='application/javascript; charset=utf-8'; '.json'='application/json; charset=utf-8'
    '.svg'='image/svg+xml'; '.jpg'='image/jpeg'; '.jpeg'='image/jpeg'; '.png'='image/png'
    '.webp'='image/webp'; '.gif'='image/gif'; '.ico'='image/x-icon'
    '.xml'='application/xml'; '.txt'='text/plain; charset=utf-8'; '.woff2'='font/woff2'
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "servindo $Root em http://localhost:$Port/"

while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $rel = [System.Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath).TrimStart('/')
    if ($rel -eq '') { $rel = 'index.html' }

    $file = Join-Path $Root ($rel -replace '/', '\')
    # o Cloudflare Pages serve /catalogo a partir de catalogo.html
    if (-not (Test-Path $file -PathType Leaf)) {
        if (Test-Path "$file.html" -PathType Leaf) { $file = "$file.html" }
        elseif (Test-Path (Join-Path $file 'index.html') -PathType Leaf) { $file = Join-Path $file 'index.html' }
    }

    try {
        if (Test-Path $file -PathType Leaf) {
            $ext = [System.IO.Path]::GetExtension($file).ToLower()
            if ($types.ContainsKey($ext)) { $ctx.Response.ContentType = $types[$ext] }
            # sem cache: recarregar mostra o CSS recem-editado
            $ctx.Response.Headers.Add('Cache-Control', 'no-store')
            # dev: deixa uma pagina externa ler estes arquivos (usado para
            # carregar migrations no SQL Editor sem redigitar nada)
            $ctx.Response.Headers.Add('Access-Control-Allow-Origin', '*')
            $bytes = [System.IO.File]::ReadAllBytes($file)
            $ctx.Response.StatusCode = 200
            $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
        } else {
            $ctx.Response.StatusCode = 404
            $msg = [System.Text.Encoding]::UTF8.GetBytes("404 $rel")
            $ctx.Response.OutputStream.Write($msg, 0, $msg.Length)
            Write-Host "404 $rel"
        }
    } catch {
        Write-Host ("ERRO " + $rel + " : " + $_.Exception.Message)
    } finally {
        $ctx.Response.Close()
    }
}
