# Dados & Destino

Mesa de rolagem de dados para RPG, para jogar com amigos pela internet. Um jogador hospeda a mesa no próprio computador e os outros entram pelo link que ele mandar.

## Como jogar

1. **Quem hospeda** abre o `DadosDestino.exe` e clica em **Hospedar mesa**. O computador dele vira o servidor da mesa.
2. No topo da mesa aparece **Link para os amigos**, com o botão **COPIAR LINK**. Depois de criar a sala, o link já leva o código dela.
3. **Os amigos** abrem o link no navegador, inclusive no celular, sem instalar nada. Quem tiver o app também pode colar o link em **Entrar numa mesa**.
4. A mesa fica no ar enquanto o app do anfitrião estiver aberto. Ao fechar, tudo é desligado.

O link é gerado pela Cloudflare (quick tunnel): é gratuito, não precisa de conta, não precisa abrir portas no roteador e muda a cada vez que a mesa é hospedada. Na primeira vez, o app baixa o conector da Cloudflare (cerca de 55 MB, do GitHub oficial `cloudflare/cloudflared`) e o guarda em `%LOCALAPPDATA%\DadosDestino`. O servidor só aceita conexões do próprio computador, então o Windows não pede liberação no firewall.

Para abrir já hospedando, sem passar pela tela inicial, crie um atalho para o `.exe` com `--hospedar` no fim do destino.

## Gerar o app

Com o .NET 8 SDK instalado, execute na pasta do projeto:

```powershell
.\publicar.ps1
```

O resultado é um arquivo só: `publish\DadosDestino.exe`. O site vai embutido nele. Roda em Windows 10/11 64 bits sem instalar o .NET. O WebView2 Runtime já vem no Windows 11 e nas versões atualizadas do Windows 10; se faltar, o app oferece o link de download.

## Desenvolvimento

```powershell
dotnet run --project RolagemRpg.csproj
```

Os arquivos do site (`wwwroot`) vão embutidos no app, então uma mudança neles aparece depois de rodar de novo. Para rodar só o servidor, sem janela nem link da internet, aberto na rede local em `http://localhost:8766`:

```powershell
dotnet run --project RolagemRpg.csproj -- --server
```

## Animações

Os dados caem girando, cada tipo com seu formato e cor, e os números embaralham até cada dado parar no valor real. Em seguida o total aparece contando. Um 20 natural no d20 mostra brilho dourado e faíscas, e um 1 natural faz a mesa tremer. O histórico, a mesa e os outros jogadores só recebem o resultado quando a animação o revela. O botão `ANIMAÇÕES` desliga os efeitos, e a escolha fica salva.

## Salas

Cada participante tem uma mesa própria. Focar uma mesa só muda a visualização local; `Sem foco` deixa todas do mesmo tamanho. Jogadores podem rolar apenas na própria mesa, com essa regra validada pelo servidor. Quem cria a sala é o mestre e pode rolar em qualquer mesa; na mesa do mestre, ele escolhe rolagem pública ou privada. A privada fica visível apenas para o mestre e não é salva no histórico persistente do navegador.

As salas comportam até 8 participantes e mantêm os últimos 20 resultados visíveis em memória. Salas e resultados expiram quando o anfitrião fecha o app; participantes desconectados podem retomar a identidade por até 30 minutos na mesma aba. Os resultados são calculados no navegador e compartilhados pelo servidor, então a mesa confia nos participantes; não há contas nem verificação antifraude.

## Segurança

- **Sem cookies e sem contas.** O nome, o personagem e o histórico ficam só no navegador de cada um.
- **Nada de terceiros:** scripts, estilos e fontes são servidos pelo próprio app, então nenhum outro site recebe o IP de quem joga. Uma política de segurança de conteúdo (CSP) impede a página de carregar qualquer coisa de fora ou de ser embutida em outro site.
- **Proteção contra sites maliciosos:** o servidor recusa pedidos de outras origens (CSRF e sequestro de WebSocket) e, no modo anfitrião, endereços que fingem ser o localhost (DNS rebinding). O controle do link da internet só responde ao próprio computador do anfitrião.
- **Limites contra abuso:** cada pessoa (IP) tem limite de ações por segundo e de conexões, e quem erra o código da sala 10 vezes fica bloqueado por alguns minutos. Mensagens grandes e salas demais são recusadas.
- **Identidade protegida:** o token de reconexão tem 256 bits, é comparado em tempo constante e fica só na aba. Nomes com caracteres invisíveis (usados para imitar outro jogador) são recusados. Todo texto de outros jogadores é exibido como texto puro.
- **Conector verificado:** o app só executa o `cloudflared.exe` se ele tiver a assinatura digital válida da Cloudflare, conferida pelo Windows a cada uso.
- **Janela do app:** abre só a tela inicial e endereços de mesa (`*.trycloudflare.com`, localhost ou IP); outros sites vão para o navegador padrão. Downloads, câmera, microfone, localização, salvamento de senhas, preenchimento automático e ferramentas de desenvolvedor ficam bloqueados.

O que continua por conta da confiança na mesa: as rolagens são calculadas no navegador de quem rola, e quem tiver o link e o código pode entrar na sala.

## Bibliotecas

As bibliotecas ficam dentro do app, em `wwwroot/vendor`: [@dice-roller/rpg-dice-roller](https://github.com/dice-roller/rpg-dice-roller) 5.5.0 (MIT), o cliente [SignalR](https://github.com/dotnet/aspnetcore) 8.0.17 (MIT) e as fontes DM Mono, DM Sans e Fraunces (SIL Open Font License). O backend usa ASP.NET Core SignalR, do repositório oficial [dotnet/aspnetcore](https://github.com/dotnet/aspnetcore), sob licença MIT.
