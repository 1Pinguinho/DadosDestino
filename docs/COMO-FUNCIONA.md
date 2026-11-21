# Como o Dados & Destino funciona

## As pastas do app

```
DadosDestino/
├── DadosDestino.exe     o app (já traz o .NET dentro; não precisa instalar nada)
├── LEIA-ME.txt          primeiros passos
├── site/                a mesa: o que você e seus amigos veem
│   ├── index.html       a estrutura da página
│   ├── src/
│   │   ├── main.js            rolagens, mesa da campanha e histórico
│   │   ├── rooms.js           salas: criar, entrar, procurar, espectadores, convite
│   │   ├── dice-animation.js  animação dos dados
│   │   ├── dice-shapes.js     desenho de cada dado (faces lapidadas) e dos materiais
│   │   ├── shortcuts.js       atalhos de rolagem (padrões e os criados pelo jogador)
│   │   ├── sound.js           som dos dados (gerado na hora, sem arquivos de áudio)
│   │   ├── titlebar.js        barra de título do app, na cor do tema
│   │   ├── i18n.js            troca de idioma
│   │   ├── settings.js        configurações: tema, cores, zoom, som, volume, atalhos
│   │   ├── palette.js         monta o tema personalizado a partir de 3 cores
│   │   ├── boot.js            aplica tema, zoom e idioma antes de a página aparecer
│   │   ├── locales/           textos: pt-BR.js e en.js
│   │   ├── themes.css         cores dos temas
│   │   └── style.css          visual e layout
│   └── vendor/          bibliotecas de terceiros (rolagem, SignalR, fontes)
├── launcher/
│   └── launcher.html    a tela inicial do app (hospedar ou entrar)
├── docs/                este arquivo
├── config/              criada na primeira vez que o app abre
│   ├── config.json      ajustes do servidor (veja abaixo)
│   └── preferencias.json  as suas configurações no app (veja abaixo)
└── dados/               vem com o conector; o resto é criado ao abrir o app
    ├── navegador/       dados da janela do app (nome do jogador, histórico)
    └── conector/        o conector da Cloudflare (cloudflared.exe) e a licença dele
```

Se a pasta do app não aceitar escrita (por exemplo, dentro de "Arquivos de Programas"),
`config/` e `dados/` vão para `%LOCALAPPDATA%\DadosDestino`.

## config/config.json

Edite com o app fechado. Valores fora do limite voltam ao padrão.

| Campo | Padrão | O que faz |
|---|---|---|
| `port` | 8766 | Porta do servidor neste computador (1024 a 65535). |
| `maxRooms` | 50 | Quantas salas podem existir ao mesmo tempo (1 a 200). |
| `maxPlayersPerRoom` | 12 | O maior limite de jogadores que alguém pode escolher ao criar uma sala (2 a 16). |
| `maxSpectatorsPerRoom` | 10 | Quantos espectadores cada sala aceita (0 desliga os espectadores). |

## Suas configurações

Ficam na engrenagem do topo e são salvas sozinhas, para cada pessoa:

- **No app:** em `config/preferencias.json`. Vale para a mesa, para a tela inicial e para as
  mesas de amigos abertas pelo app.
- **No navegador** (quem entra pelo link): no próprio navegador daquela pessoa.

| Configuração | Padrão |
|---|---|
| Idioma | o do Windows (Português ou English) |
| Tema | roxo; há 10 prontos e o **personalizado**, em que você escolhe fundo, destaque e degradê |
| Zoom | 100% (de 70% a 150%) |
| Cor da sua mesa | automática (todos na sala veem a cor escolhida) |
| Modelo dos seus dados | clássico; há 12 materiais (cristal, metal, neon, pedra rúnica, galáxia, lava, gelo, madeira, pixel, dragão, osso), com as faces lapidadas de cada tipo de dado, e todos aceitam qualquer cor (todos veem) |
| Cor dos seus dados | clássico, uma cor por tipo de dado; ou uma das prontas, ou personalizada com borda e degradê (todos veem) |
| Tela cheia | desligada; no app é sem bordas, e o F11 liga e desliga |
| Animações | ligadas |
| Som dos dados | ligado, com **volume em 20%** para não assustar |
| Atalhos | Percepção, Vantagem, Desvantagem e os que você criar (até 12) |

**Restaurar padrões** (no fim do painel, com um segundo clique para confirmar) volta tudo ao
padrão, menos o idioma e os atalhos.

## O caminho de uma rolagem

1. Quem hospeda clica em **Hospedar mesa**. O app liga um servidor que só aceita conexões
   do próprio computador e abre um túnel da Cloudflare, que gera um link `https://….trycloudflare.com`.
2. Os amigos abrem o link no navegador. A Cloudflare leva cada pedido até o servidor do anfitrião.
3. Quem rola calcula o resultado no próprio navegador, vê a animação e só então envia o resultado
   para a sala. O servidor confere se a pessoa pode rolar naquela mesa e repassa para todos.

## Salas

- **Nome, limite e visibilidade** são escolhidos ao criar. O mestre pode mudar depois em
  **Configurar sala**.
- **Pública** aparece em **Procurar salas** (só neste servidor). **Privada** só entra quem tiver
  o código ou o convite.
- **Espectadores** veem a mesa e as rolagens públicas em tempo real, não rolam dados e não
  ocupam vaga de jogador. Não precisam de personagem.
- O mestre é quem cria a sala. Se ele sair, o jogador mais antigo vira mestre.
- **Remover alguém:** o mestre clica em `⋯` ao lado da pessoa, na lista da sala. **Remover**
  tira da sala; **Remover e bloquear** também impede a volta dela (pelo IP) àquela sala.
- **Voltar para a vaga:** quem fecha o navegador sem querer e abre o mesmo link de novo volta
  como a mesma pessoa, na mesma mesa.

## Mudando textos, cores e visual

- **Textos:** `site/src/locales/pt-BR.js` e `en.js`. Mude só o texto entre aspas.
- **Cores de um tema:** `site/src/themes.css`. Cada tema é um bloco de variáveis.
- **Layout:** `site/src/style.css`.

As mudanças aparecem ao recarregar a mesa (F5 no navegador, ou voltar ao início e hospedar
de novo no app).

## Segurança, em resumo

- Sem contas e sem cookies. Nome, personagem e histórico ficam no navegador de cada um.
- A página só carrega arquivos do próprio app (política de segurança de conteúdo).
- O servidor recusa pedidos vindos de outros sites e endereços falsos.
- Há limite de ações por segundo, de conexões e de tentativas com código errado.
- O app só executa o conector da Cloudflare se ele tiver a assinatura digital da Cloudflare.
