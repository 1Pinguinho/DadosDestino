# Dados & Destino

Mesa de rolagem de dados para RPG, para jogar com amigos pela internet. Um jogador hospeda a mesa no próprio computador e os outros entram pelo link que ele mandar. Em português do Brasil e em inglês.

## Como jogar

1. **Quem hospeda** abre o `DadosDestino.exe` e clica em **Hospedar mesa**. O computador dele vira o servidor da mesa.
2. Cria a sala: nome, quantos jogadores (2 a 12), **pública** (aparece na busca) ou **privada** (só com código ou convite), e se aceita **espectadores**.
3. No topo aparece **Link da mesa**, discreto: o olho mostra ou esconde o link, e o botão ao lado copia o convite (já com o código da sala).
4. **Os amigos** abrem o link no navegador, inclusive no celular, sem instalar nada, e entram como **jogador** ou **espectador**. Também podem procurar salas públicas em **Procurar salas**.
5. A mesa fica no ar enquanto o app do anfitrião estiver aberto. Ao fechar, tudo é desligado.

Cada jogador tem a própria mesa, duas por linha, e os dados rolam dentro da mesa de quem recebe a rolagem, ao mesmo tempo para todos. Espectadores veem tudo o que é público, não rolam dados e não ocupam vaga. O mestre (quem criou a sala) rola em qualquer mesa, faz rolagens privadas e pode mudar as configurações da sala depois.

Ao lado da rolagem há um guia rápido da notação (`2d20kh1` vantagem, `2d20kl1` desvantagem, `4d6dl1`, `1d6!` e outros); clicar num exemplo coloca ele no campo.

A engrenagem no topo troca o **idioma** (Português / English), o **tema** (roxo, vermelho, verde, branco, cinza, preto) e liga ou desliga as **animações**. No app, a escolha vale também para a tela inicial.

O link é gerado pela Cloudflare (quick tunnel): é gratuito, não precisa de conta, não precisa abrir portas no roteador e muda a cada vez que a mesa é hospedada. Na primeira vez, o app baixa o conector da Cloudflare (cerca de 55 MB, do GitHub oficial `cloudflare/cloudflared`). O servidor só aceita conexões do próprio computador, então o Windows não pede liberação no firewall.

Para abrir já hospedando, sem passar pela tela inicial, crie um atalho para o `.exe` com `--hospedar` no fim do destino.

## O app em pastas

O app não é mais um arquivo só: o `.exe` (que já traz o .NET) fica ao lado das pastas `site/` (a mesa), `launcher/` (a tela inicial) e `docs/`. Ao abrir, ele cria `config/` (com `config.json` para porta e limites das salas, e `preferencias.json` para idioma e tema) e `dados/` (dados do navegador do app e o conector da Cloudflare). O que tem em cada pasta, e como mudar textos, cores e limites, está em [docs/COMO-FUNCIONA.md](docs/COMO-FUNCIONA.md).

## Gerar o app

Com o .NET 8 SDK instalado, execute na pasta do projeto:

```powershell
.\publicar.ps1
```

O resultado vai para `publish\DadosDestino\`, junto de um `publish\DadosDestino-<versão>.zip` pronto para enviar. Roda em Windows 10/11 64 bits sem instalar o .NET. O WebView2 Runtime já vem no Windows 11 e nas versões atualizadas do Windows 10; se faltar, o app oferece o link de download.

## Código

| Pasta | O que tem |
|---|---|
| `App/` | `Program.cs` (início), `MainWindow.cs` (janela e tela inicial), `HostSession.cs` (liga o servidor e o link) |
| `Server/` | `ServerBuilder.cs` (servidor), `TableHub.cs` (salas em tempo real), `Contracts.cs` (mensagens), `Security.cs` (proteções) |
| `Tunnel/` | `TunnelManager.cs` (link da Cloudflare), `Authenticode.cs` (confere a assinatura do conector) |
| `Config/` | `AppPaths.cs` (onde fica cada pasta), `AppConfig.cs` (config.json e preferencias.json) |
| `site/` | a mesa: `index.html`, `src/` (JavaScript, CSS, temas e textos em `locales/`) e `vendor/` |
| `launcher/` | a tela inicial do app |
| `docs/` | como o app funciona |

## Desenvolvimento

```powershell
dotnet run --project RolagemRpg.csproj
```

Os arquivos de `site/` são copiados para a pasta do build; o servidor confere se mudaram a cada pedido, então basta compilar de novo e recarregar a página. Para rodar só o servidor, sem janela nem link da internet, aberto na rede local em `http://localhost:8766`:

```powershell
dotnet run --project RolagemRpg.csproj -- --server
```

## Animações

Os dados caem girando dentro da mesa do jogador, cada tipo com seu formato e cor, e os números embaralham até cada dado parar no valor real. Em seguida o total aparece contando. Um 20 natural no d20 mostra brilho dourado e faíscas, e um 1 natural faz a mesa tremer. Os dados da última rolagem ficam parados na mesa. O histórico só recebe o resultado quando a animação o revela, e tem rolagem própria, sem esticar a página.

## Segurança

- **Sem cookies e sem contas.** O nome, o personagem e o histórico ficam só no navegador de cada um.
- **Nada de terceiros:** scripts, estilos e fontes são servidos pelo próprio app, então nenhum outro site recebe o IP de quem joga. Uma política de segurança de conteúdo (CSP) impede a página de carregar qualquer coisa de fora ou de ser embutida em outro site.
- **Proteção contra sites maliciosos:** o servidor recusa pedidos de outras origens (CSRF e sequestro de WebSocket) e, no modo anfitrião, endereços que fingem ser o localhost (DNS rebinding). O controle do link da internet só responde ao próprio computador do anfitrião.
- **Limites contra abuso:** cada pessoa (IP) tem limite de ações por segundo e de conexões, e quem erra o código da sala 10 vezes fica bloqueado por alguns minutos. Mensagens grandes e salas demais são recusadas. Salas privadas não aparecem na busca.
- **Identidade protegida:** o token de reconexão tem 256 bits, é comparado em tempo constante e fica só na aba. Nomes com caracteres invisíveis (usados para imitar outro jogador) são recusados. Todo texto de outros jogadores é exibido como texto puro.
- **Conector verificado:** o app só executa o `cloudflared.exe` se ele tiver a assinatura digital válida da Cloudflare, conferida pelo Windows a cada uso.
- **Janela do app:** abre só a tela inicial e endereços de mesa (`*.trycloudflare.com`, localhost ou IP); outros sites vão para o navegador padrão. Downloads, câmera, microfone, localização, salvamento de senhas, preenchimento automático e ferramentas de desenvolvedor ficam bloqueados. Idioma e tema vindos da página só são aceitos se forem valores da lista.

O que continua por conta da confiança na mesa: as rolagens são calculadas no navegador de quem rola, e quem tiver o link e o código pode entrar na sala.

## Bibliotecas

As bibliotecas ficam dentro do app, em `site/vendor`: [@dice-roller/rpg-dice-roller](https://github.com/dice-roller/rpg-dice-roller) 5.5.0 (MIT), o cliente [SignalR](https://github.com/dotnet/aspnetcore) 8.0.17 (MIT) e as fontes DM Mono, DM Sans e Fraunces (SIL Open Font License). O backend usa ASP.NET Core SignalR, do repositório oficial [dotnet/aspnetcore](https://github.com/dotnet/aspnetcore), sob licença MIT. Nenhum repositório de terceiros foi copiado para estas mudanças: idiomas, temas, busca de salas e espectadores foram escritos aqui.
