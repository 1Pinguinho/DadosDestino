# Gera o app para Windows na pasta "publish".
# O resultado roda em qualquer Windows 10/11 64 bits sem instalar o .NET.
# Para distribuir, envie a pasta "publish" inteira (o .exe e a pasta wwwroot).
Set-Location $PSScriptRoot
dotnet publish RolagemRpg.csproj `
  -c Release `
  -r win-x64 `
  --self-contained true `
  -p:PublishSingleFile=true `
  -p:IncludeNativeLibrariesForSelfExtract=true `
  -p:EnableCompressionInSingleFile=true `
  -p:DebugType=none `
  -o publish
