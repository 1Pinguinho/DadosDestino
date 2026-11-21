# Dados & Destino

## App para Windows

O projeto é um app de Windows: ao abrir, ele mostra a mesa numa janela própria (WebView2, o motor do Edge) e liga o servidor da sala por dentro, na porta `8766`.

Para gerar o app, com o .NET 8 SDK instalado, execute na pasta do projeto:

```powershell
.\publicar.ps1
```

O resultado fica na pasta `publish`: `DadosDestino.exe` e a pasta `wwwroot`, que devem ficar juntos. Ele roda em Windows 10/11 64 bits sem instalar o .NET. O WebView2 Runtime já vem no Windows 11 e nas versões atualizadas do Windows 10; se faltar, o app oferece o link de download.

Na primeira vez, o Windows pode perguntar se o app pode usar a rede. Permita em redes privadas para que outras pessoas consigam entrar.

## Convidar amigos

Quem está na mesma rede não precisa do app: basta abrir no navegador o endereço que aparece no título da janela (por exemplo, `http://192.168.1.4:8766`) e informar o código da sala. O botão `COPIAR` já copia o convite com esse endereço.

## Desenvolvimento

```powershell
dotnet run --project RolagemRpg.csproj
```

Abre o app em modo de desenvolvimento. Para rodar só o servidor, sem janela (para usar no navegador em `http://localhost:8766`):

```powershell
dotnet run --project RolagemRpg.csproj -- --server
```

## Animações

Os dados caem girando, cada tipo com seu formato e cor, e os números embaralham até cada dado parar no valor real. Em seguida o total aparece contando. Um 20 natural no d20 mostra brilho dourado e faíscas, e um 1 natural faz a mesa tremer. O histórico, a mesa e os outros jogadores só recebem o resultado quando a animação o revela. O botão `ANIMAÇÕES` desliga os efeitos, e a escolha fica salva.

## Salas

Cada participante tem uma mesa própria. Focar uma mesa só muda a visualização local; `Sem foco` deixa todas do mesmo tamanho. Jogadores podem rolar apenas na própria mesa, com essa regra validada pelo servidor. Quem cria a sala é o mestre e pode rolar em qualquer mesa; na mesa do mestre, ele escolhe rolagem pública ou privada. A privada fica visível apenas para o mestre e não é salva no histórico persistente do navegador.

As salas comportam até 8 participantes e mantêm os últimos 20 resultados visíveis em memória. Salas e resultados expiram com a reinicialização do servidor; participantes desconectados podem retomar a identidade por até 30 minutos na mesma aba. Os resultados são calculados no navegador e compartilhados pelo servidor, então a mesa confia nos participantes; não há contas nem verificação antifraude.

O cliente de dados e o cliente SignalR são carregados de CDNs e precisam de acesso à internet. O backend usa ASP.NET Core SignalR do repositório oficial [dotnet/aspnetcore](https://github.com/dotnet/aspnetcore), sob licença MIT.