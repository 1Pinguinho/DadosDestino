# Gera o app para Windows em publish\DadosDestino e um .zip pronto para enviar.
# O DadosDestino.exe já traz o .NET dentro; as pastas site, launcher e docs ficam ao lado dele.
# O conector da Cloudflare (cloudflared.exe) vai junto em dados\conector, para quem
# baixar já poder hospedar sem esperar o download. Ele vem do GitHub oficial da
# Cloudflare e só entra no pacote se tiver a assinatura digital válida da Cloudflare.
Set-Location $PSScriptRoot
$ErrorActionPreference = 'Stop'
$output = Join-Path $PSScriptRoot 'publish\DadosDestino'
if (Test-Path $output) {
  Remove-Item -Recurse -Force $output
}

dotnet publish RolagemRpg.csproj `
  -c Release `
  -r win-x64 `
  --self-contained true `
  -p:PublishSingleFile=true `
  -p:IncludeNativeLibrariesForSelfExtract=true `
  -p:EnableCompressionInSingleFile=true `
  -p:DebugType=none `
  -o $output
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}

# Conector: baixado uma vez por semana para obj\cloudflared e reaproveitado.
$cache = Join-Path $PSScriptRoot 'obj\cloudflared'
$cachedTool = Join-Path $cache 'cloudflared.exe'
$cachedLicense = Join-Path $cache 'LICENSE-cloudflared.txt'
New-Item -ItemType Directory -Force $cache | Out-Null
if (-not (Test-Path $cachedTool) -or (Get-Item $cachedTool).LastWriteTime -lt (Get-Date).AddDays(-7)) {
  Write-Host 'Baixando o conector da Cloudflare...'
  $download = "$cachedTool.download"
  Invoke-WebRequest 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile $download -UseBasicParsing
  Move-Item -Force $download $cachedTool
  Invoke-WebRequest 'https://raw.githubusercontent.com/cloudflare/cloudflared/master/LICENSE' -OutFile $cachedLicense -UseBasicParsing
}
$signature = Get-AuthenticodeSignature $cachedTool
if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.GetNameInfo('SimpleName', $false) -ne 'Cloudflare, Inc.') {
  Remove-Item -Force $cachedTool
  throw 'O conector baixado não tem a assinatura digital válida da Cloudflare. Nada foi empacotado.'
}
$connector = Join-Path $output 'dados\conector'
New-Item -ItemType Directory -Force $connector | Out-Null
Copy-Item $cachedTool $connector
Copy-Item $cachedLicense $connector
Write-Host "Conector incluído (assinatura da Cloudflare conferida)"

$version = ([xml](Get-Content RolagemRpg.csproj)).Project.PropertyGroup.Version | Select-Object -First 1
$zip = Join-Path $PSScriptRoot "publish\DadosDestino-$version.zip"
if (Test-Path $zip) {
  Remove-Item -Force $zip
}
Compress-Archive -Path $output -DestinationPath $zip
Write-Host "Pronto: $output"
Write-Host "Zip:    $zip"
