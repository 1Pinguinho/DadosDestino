# Gera o app para Windows em publish\DadosDestino e um .zip pronto para enviar.
# O DadosDestino.exe já traz o .NET dentro; as pastas site, launcher e docs ficam ao lado dele.
Set-Location $PSScriptRoot
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

$version = ([xml](Get-Content RolagemRpg.csproj)).Project.PropertyGroup.Version | Select-Object -First 1
$zip = Join-Path $PSScriptRoot "publish\DadosDestino-$version.zip"
if (Test-Path $zip) {
  Remove-Item -Force $zip
}
Compress-Archive -Path $output -DestinationPath $zip
Write-Host "Pronto: $output"
Write-Host "Zip:    $zip"
