# Dados & Destino

Mesa de rolagem de dados para RPG, para jogar com amigos pela internet. Um jogador hospeda a mesa no próprio computador e os outros entram pelo link que ele mandar. Em português do Brasil e em inglês.

## Como jogar

1. **Quem hospeda** abre o `DadosDestino.exe`. O app já liga a mesa no computador dele e abre a tela inicial, com **Jogar**, **Fichas**, **Personalização** e **Configurações**. Em **Jogar** ficam criar sala, entrar com código ou link, procurar salas e as suas mesas.
2. Cria a sala: nome, quantos jogadores (2 a 12), **pública** (aparece na busca) ou **privada** (só com código ou convite), e se aceita **espectadores**.
3. No topo aparece **Link da mesa**, discreto: o olho mostra ou esconde o link, e o botão ao lado copia o convite (já com o código da sala).
4. **Os amigos** abrem o link no navegador, inclusive no celular, sem instalar nada, e entram como **jogador** ou **espectador**. Também podem procurar salas públicas em **Procurar salas**. Em **Entrar com código** vale só o código da sala ou o link inteiro da mesa de um amigo.
5. A mesa fica no ar enquanto o app do anfitrião estiver aberto. Ao fechar, tudo é desligado.

Cada jogador tem a própria mesa, duas por linha, e os dados rolam dentro da mesa de quem recebe a rolagem, ao mesmo tempo para todos. Espectadores veem tudo o que é público, não rolam dados e não ocupam vaga. O mestre (quem criou a sala) rola em qualquer mesa, faz rolagens privadas e pode mudar as configurações da sala depois.

Ao lado da rolagem há um guia rápido da notação (`2d20kh1` vantagem, `2d20kl1` desvantagem, `4d6dl1`, `1d6!` e outros); clicar num exemplo coloca ele no campo.

A engrenagem no topo guarda as configurações de cada pessoa: **idioma** (Português / English), **tema** (10 prontos ou **personalizado**, com fundo, destaque e degradê escolhidos por você), **zoom**, **cor da sua mesa**, **modelo dos seus dados** (12 materiais: clássico, cristal, metal, neon, pedra rúnica, galáxia, lava, gelo, madeira, pixel, dragão e osso), **cor dos seus dados** (prontas ou personalizadas, com borda e degradê), **tela cheia** (F11 no app), **animações** e **som dos dados** com **volume** (começa em 20%). **Restaurar padrões** volta tudo ao início. No app, tudo fica salvo em `config\preferencias.json` e vale também para a tela inicial; no navegador, fica no navegador de cada um.

Ao lado do histórico fica o **chat** da sala, para jogadores e espectadores. A conversa fica guardada enquanto a sala existir, então quem sai e volta continua vendo tudo; ela some quando a sala fecha. No cabeçalho da mesa de cada outro jogador há um botão de **reação**: o emoji escolhido aparece sobre aquela mesa, flutua e some, para todos.

**Conta e ficha:** em **Entrar**, no topo, cada um cria uma conta (fica no computador de quem hospeda; "Lembrar de mim" mantém o login por 90 dias) e põe uma **foto**, que aparece ao lado do nome na mesa. A ficha também pode ser editada fora da mesa, em **Fichas** na tela inicial. Na sala, a aba **Ficha** guarda as fichas do personagem no formato do sistema do grupo: HP, EA e San, os 5 atributos, as 27 perícias (o teste é calculado sozinho), resistências, elementos, pontos de habilidade, iniciativa, efeitos, habilidades, inventário e **rolagens rápidas** (no topo da ficha). Campo vazio conta como 0, e o botão **Renomear** troca o nome de vida, EA, atributos, perícias e outros campos só na sua ficha. A ficha não rola dados: as rolagens rápidas aparecem no rolador. Lá também dá para escolher o **tipo da rolagem**: dano físico, mágico (pergunta quanto de EA gastar e desconta da ficha) ou de perfuração, e **recuperação** (poção de vida ou de mana, em você ou em outro jogador, nunca passando do máximo). As fichas podem ser exportadas e importadas para jogar na mesa de outro mestre.

**Vantagem e desvantagem:** um clique ao lado do campo da rolagem troca o 1d20 por 2d20 e fica com o maior (ou o menor).

**Escudo do mestre:** aba só do mestre, com **teste às cegas** (o jogador rola e só o mestre vê o resultado; o mestre escolhe se o jogador também vê), **chefes prontos** guardados na conta do mestre e postos no combate com um clique, e **notas secretas** salvas com a mesa.

**Chefes completos:** no Escudo, cada chefe pronto tem vida, EA, **ações por turno**, Reflexos, resistências, **arma principal** (nome e dano fixo, o ataque básico), **perícias** com bônus e **habilidades** como as dos jogadores, com máximo de usos no combate. Editar um chefe que já está no combate atualiza na hora, sem mexer na vida e na EA atuais. Com o **combate automático** ligado, o chefe joga sozinho: respeita a vez, escolhe alvos **aleatórios** ou **evitando quem tem menos vida**, nunca ataca quem está caído, não usa habilidade sem EA nem em recarga, se cura quando está mal e, se tirar 20 na defesa, contra-ataca com a arma. O mestre liga e desliga o automático e muda o jeito de escolher alvos a qualquer momento; enquanto ele estiver ligado, só o mestre vê um aviso de que um chefe desbalanceado pode causar TPK.

**Habilidades:** na ficha, a seção **Habilidades** guarda ataques, magias e curas prontos, com rolagem, perícia do ataque, custo de EA, usos por turno, recarga (em turnos) e status. Na mesa elas aparecem no rolador, já mostrando o que dá para usar. Em combate, ataques rolam o teste contra o alvo escolhido e curas gastam a vez; uma cura vai em você, num aliado ou em **área** (todos os jogadores, nunca um chefe nem o mestre). Na cura, quem está caído só sobe até 0.

**Combate com turnos:** o mestre clica em **Iniciar combate**, cadastra os chefes (que ele controla, com vida, Reflexos e resistências) e todos rolam iniciativa. Na sua vez, você escolhe um alvo, o **tipo do ataque** (físico, mágico ou perfuração) e, se quiser, um **status**, e rola o ataque; o alvo rola **Reflexos** (empate é da defesa). **Magia** não deixa o alvo rolar contra. Se acertar, você rola o dano: a resistência do mesmo tipo é descontada, o resto sai direto da vida e o status escolhido entra junto. **20 natural** no ataque sempre acerta e é **crítico**: dano ×1,3 na magia e ×1,8 no físico e na perfuração (antes da resistência). **20 natural na defesa** faz o ataque falhar e dá ao defensor um **contra-ataque garantido**, sem defesa do atacante. Uma poção por turno não gasta a vez. Quem cai (vida 0 ou menos) só levanta com um teste de **Medicina** de outro jogador (DT 18, +1 a cada 5 de vida negativa); tem 3 chances, falha crítica gasta duas, e a rodada sem socorro também gasta uma. Na última chance, falhar é morte. O mestre pode dar **Piedade** (mais uma chance), reviver, mudar a ordem, passar a vez de alguém, **pausar** (as rolagens voltam ao normal e, ao continuar, a vez é da mesma pessoa) e **encerrar**. Tempos: 30 s para o alvo reagir (senão o ataque entra) e 1 min para quem está na vez.

**Visual da mesa:** nas configurações, "Visual da sua mesa" deixa cada mesa com a cara do jogador: **superfície** (feltro, madeira, pedra, couro, mármore, pergaminho, estrelas ou metal), **moldura** (dupla, entalhada, rúnica, dourada ou espinhos), **brasão** em marca-d'água, **efeito** (brasas, névoa, neve, faíscas ou pétalas) e **cores próprias** de fundo e detalhes. Há combinações prontas (Taverna, Cripta, Floresta, Arcano, Infernal e Real), e todos na sala veem a mesa de cada um.

**Trilha ambiente:** no Escudo, o mestre escolhe **chuva, fogueira, vento, taverna ou tensão**, e o som toca para todos da mesa. Os sons são gerados pelo próprio app, sem arquivos de áudio. Cada pessoa liga, desliga e ajusta o volume da trilha nas configurações, separado do som dos dados.

**Status de dano:** os 12 status do sistema (Queimando, Chama Infernal, Sangrando, Hemorragia Interna, Envenenado, Corroído, Eletrocutado, Congelamento, Necrose, Sobrecarga Arcana, Deterioração Abissal e Ruptura Espacial) aparecem como ícones na mesa e na faixa de combate. Quem acerta pode aplicar 1 stack no alvo; o mestre aplica e remove quando quiser. O dano é rolado pelo app no fim do turno de quem está afetado, com base, acréscimo por stack, máximo, duração e as regras de cada um (status ignoram qualquer resistência; Eletrocutado estoura +2d8 ao chegar a 4 stacks). Ao encerrar o combate, aparece um **resumo** (dano causado e recebido, acertos, 20 e 1 naturais, quedas e socorros), que também fica no chat.

**Notas e mesas salvas:** a aba **Notas** tem cartões que todos da sala veem; quem escreveu edita e apaga, e o mestre apaga qualquer um e pode **fixar** notas no topo (na ordem em que foram fixadas). Se o mestre criar a sala com conta, a mesa e as notas ficam salvas, e ele reabre com o mesmo código em **Minhas mesas**. Em **Configurações**, no app, quem hospeda vê as contas guardadas no computador e pode apagar uma.

Cada jogador pode criar os próprios **atalhos** de rolagem (como "Espada longa = 1d20+7"). O mestre pode **remover** alguém da sala, com a opção de **bloquear** a volta. Quem fecha o navegador sem querer e abre o mesmo link volta para a mesma vaga.

O link é gerado pela Cloudflare (quick tunnel): é gratuito, não precisa de conta, não precisa abrir portas no roteador e muda a cada vez que a mesa é hospedada. O conector da Cloudflare (`cloudflared.exe`, do GitHub oficial `cloudflare/cloudflared`, licença Apache 2.0) já vem no pacote, em `dados/conector`, então qualquer pessoa que baixar o app pode hospedar na hora. Se ele faltar, o app baixa sozinho na primeira vez que hospedar. O servidor só aceita conexões do próprio computador, então o Windows não pede liberação no firewall.

## O app em pastas

O app não é mais um arquivo só: o `.exe` (que já traz o .NET) fica ao lado das pastas `site/` (a mesa), `launcher/` (tela de reserva, se a mesa não ligar) e `docs/`. Ao abrir, ele cria `config/` (com `config.json` para porta e limites das salas, e `preferencias.json` com as suas configurações) e `dados/` (dados do navegador do app e o conector da Cloudflare). O que tem em cada pasta, e como mudar textos, cores e limites, está em [docs/COMO-FUNCIONA.md](docs/COMO-FUNCIONA.md).

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
| `launcher/` | tela de reserva do app (aparece só se a mesa não ligar) |
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

- **Contas com senha protegida.** As contas ficam no computador de quem hospeda (`dados/contas/`). A senha é guardada só como hash PBKDF2-SHA256 (210 mil iterações, com salt) e o token de sessão só como hash SHA-256; depois de 10 senhas erradas em 10 minutos, o login fica bloqueado. A sessão vai no cabeçalho `Authorization`, sem cookies. Sem conta, nome, personagem e histórico ficam só no navegador de cada um.
- **Nada de terceiros:** scripts, estilos e fontes são servidos pelo próprio app, então nenhum outro site recebe o IP de quem joga. Uma política de segurança de conteúdo (CSP) impede a página de carregar qualquer coisa de fora ou de ser embutida em outro site.
- **Proteção contra sites maliciosos:** o servidor recusa pedidos de outras origens (CSRF e sequestro de WebSocket) e, no modo anfitrião, endereços que fingem ser o localhost (DNS rebinding). O controle do link da internet só responde ao próprio computador do anfitrião.
- **Limites contra abuso:** cada pessoa (IP) tem limite de ações por segundo e de conexões, e quem erra o código da sala 10 vezes fica bloqueado por alguns minutos. Mensagens grandes e salas demais são recusadas. Salas privadas não aparecem na busca.
- **Identidade protegida:** o token de reconexão tem 256 bits, é comparado em tempo constante e fica só no navegador de quem entrou (para voltar à mesma vaga). Nomes com caracteres invisíveis (usados para imitar outro jogador) são recusados. Todo texto de outros jogadores é exibido como texto puro.
- **Conector verificado:** o app só executa o `cloudflared.exe` se ele tiver a assinatura digital válida da Cloudflare, conferida pelo Windows a cada uso.
- **Janela do app:** tem barra de título própria, na cor do tema, e tela cheia sem bordas. Abre só a tela inicial e endereços de mesa (`*.trycloudflare.com`, localhost ou IP); outros sites vão para o navegador padrão. Downloads, câmera, microfone, localização, salvamento de senhas, preenchimento automático e ferramentas de desenvolvedor ficam bloqueados. Configurações vindas da página são conferidas pelo app (valores da lista, cores em hexadecimal, limites) antes de serem salvas.

O que continua por conta da confiança na mesa: as rolagens são calculadas no navegador de quem rola, e quem tiver o link e o código pode entrar na sala.

## Bibliotecas

As bibliotecas ficam dentro do app, em `site/vendor`: [@dice-roller/rpg-dice-roller](https://github.com/dice-roller/rpg-dice-roller) 5.5.0 (MIT), o cliente [SignalR](https://github.com/dotnet/aspnetcore) 8.0.17 (MIT) e as fontes DM Mono, DM Sans e Fraunces (SIL Open Font License). O backend usa ASP.NET Core SignalR, do repositório oficial [dotnet/aspnetcore](https://github.com/dotnet/aspnetcore), sob licença MIT. Nenhum repositório de terceiros foi copiado para estas mudanças: idiomas, temas, busca de salas e espectadores foram escritos aqui.
