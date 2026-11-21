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
│   │   ├── i18n.js            troca de idioma
│   │   ├── settings.js        painel de configurações (idioma, tema, animações)
│   │   ├── boot.js            aplica tema e idioma antes de a página aparecer
│   │   ├── locales/           textos: pt-BR.js e en.js
│   │   ├── themes.css         cores dos temas
│   │   └── style.css          visual e layout
│   └── vendor/          bibliotecas de terceiros (rolagem, SignalR, fontes)
├── launcher/
│   └── launcher.html    a tela inicial do app (hospedar ou entrar)
├── docs/                este arquivo
├── config/              criada na primeira vez que o app abre
│   ├── config.json      ajustes do servidor (veja abaixo)
│   └── preferencias.json  idioma e tema escolhidos no app
└── dados/               criada na primeira vez que o app abre
    ├── navegador/       dados da janela do app (nome do jogador, histórico)
    └── conector/        o conector da Cloudflare (cloudflared.exe)
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
