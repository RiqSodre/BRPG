# 🐉 Mesa do Mestre

Assistente do Mestre para campanhas de RPG de mesa. Centraliza **história, cenas,
personagens, mapa de batalha e sessões** — com um portal para cada jogador acompanhar a
própria ficha e o mapa ao vivo, e IA (GPT ou Llama, à sua escolha) que conhece toda a
campanha para te ajudar a mestrar. Roda inteiramente no navegador, sem depender de
nenhuma plataforma de terceiros.

## O que ele faz

- **🎭 Cenas** — organize a campanha em cenas, com texto de leitura, imagem e trilha
  sugerida. Ativar uma marca qual é a cena atual no painel.
- **🗺️ Mapa de batalha ao vivo** — grid, névoa de guerra, tokens, iniciativa, condições,
  death saves e dados 3D sincronizados — tudo em tempo real entre o painel do Mestre e a
  tela dos jogadores.
- **🎮 Portal do jogador** — cada jogador entra em `/jogador.html` com o próprio
  personagem e uma senha (login nativo, sem conta externa) e acompanha o mapa, a
  iniciativa e a **própria ficha completa** — sempre à mão, não só na sua vez.
- **✨ IA que entende a campanha** — chat do Mestre com acesso a toda a história, NPCs
  (e seus segredos), cenas e sessões. Pergunte "o que o taverneiro sabe sobre o culto?",
  improvise locais/NPCs/encontros, gere recaps épicos das sessões.
- **🤖 Sons escolhidos por IA** — o botão "✨ Sons IA" numa cena faz a IA escolher os
  áudios da sua biblioteca que combinam com ela (pelas tags e descrição).
- **🗣️ Prévia de voz de NPC (TTS)** — ouça no seu navegador como uma fala soaria, com
  voz, tom e ritmo configuráveis por NPC (Edge TTS, gratuito) — útil pra ensaiar antes
  da cena ou ler em voz alta na mesa.
- **🧙 Personagens** — fichas completas de PCs e NPCs (D&D 5e): atributos, perícias,
  proficiências, magias, habilidades, inventário, interpretação — com botão de
  **improvisar diálogo de NPC** na hora.
- **📚 Biblioteca de áudio** — organize efeitos por categoria e tags, importe do
  Freesound ou do YouTube (via yt-dlp, já incluso) direto pra biblioteca.
- **⚔️ Iniciativa esperta** — busque monstros no **bestiário SRD** (dnd5eapi.co), veja
  o stat block e adicione ao combate com iniciativa rolada.
- **🎲 Dados** — rolagem rápida na barra de topo ou o painel 3D sobre o mapa, visível
  para todos que estiverem olhando (painel do Mestre e portal do jogador).

## Instalação

### 1. Dependências

```powershell
npm install
```

### 2. Configurar o `.env`

```powershell
Copy-Item .env.example .env
```

Edite o `.env` e preencha:

- `OPENAI_API_KEY` **ou** `GROQ_API_KEY` — pelo menos uma das duas, para o Assistente do Mestre funcionar:
  - `OPENAI_API_KEY` — chave criada em https://platform.openai.com/api-keys (GPT, pago por uso — uma sessão típica custa centavos)
  - `GROQ_API_KEY` — chave criada em https://groq.com (Llama 3.3 70B, **gratuito**)
  - Se definir as duas, o GPT é usado por padrão; force uma com `AI_PROVIDER=openai` ou `AI_PROVIDER=groq`
- `FREESOUND_API_KEY` — opcional, para buscar sons pelo painel (grátis em https://freesound.org/apiv2/apply)
- `YOUTUBE_COOKIES` / `YOUTUBE_COOKIES_FROM_BROWSER` — opcionais, só se a importação do YouTube reclamar (veja abaixo)
- `SESSION_SECRET` — a chave que assina a sessão dos jogadores no portal (veja abaixo)

#### Quando o YouTube pede login ("Sign in to confirm you're not a bot")

O YouTube exige uma sessão logada quando não confia na conexão de onde vem o pedido — acontece
em VPS, em internet compartilhada e em redes com muita gente atrás do mesmo IP. Não é um defeito
do painel, e por isso pode acontecer na máquina de um e não na de outro. A saída é dar a ele os
cookies de uma conta logada, de um destes dois jeitos no `.env`:

- `YOUTUBE_COOKIES=C:\caminho\cookies.txt` — um arquivo exportado no formato Netscape (dá pra
  gerar com uma extensão de exportar cookies). Para o arquivo durar, exporte de uma janela
  anônima: faça login, exporte, e **feche a janela sem deslogar** — deslogar invalida o cookie.
- `YOUTUBE_COOKIES_FROM_BROWSER=firefox` — lê direto do navegador instalado (`chrome`,
  `firefox`, `edge`, `brave`, `opera`...). Mais simples, mas o Chrome recente costuma dar
  trabalho por causa da criptografia dos cookies; o Firefox costuma funcionar melhor.

Duas coisas importantes: **use uma conta descartável**, porque é ela que vai aparecer baixando e
pode ser bloqueada por isso; e os cookies expiram, então uma hora será preciso exportar de novo.

Antes de mexer em cookies, valem dois testes mais baratos. O primeiro é `npm run update-ytdlp`,
que baixa a última versão do yt-dlp. O segundo é **instalar o [Deno](https://deno.com)**, que não
envolve conta nenhuma:

```powershell
winget install DenoLand.Deno
```

O yt-dlp usa um runtime de JavaScript para responder aos desafios do YouTube e avisa que a
extração sem ele está descontinuada. Ele encontra o `deno` sozinho quando está no PATH — só
**feche e reabra o terminal** depois de instalar, senão o `npm start` continua sem enxergá-lo.
Se o painel roda como serviço ou por um atalho que não vê o PATH novo, aponte o caminho no
`.env`: `DENO_PATH=C:\...\deno.exe`.

Quem não quiser lidar com isso tem dois caminhos que não dependem do YouTube: enviar o arquivo
de áudio direto pela aba 🎵 do painel, ou usar a busca do Freesound.

#### Portal do jogador

Cada jogador acompanha a própria ficha, o mapa e a iniciativa em tempo real — sem precisar de
compartilhamento de tela nem de conta em nenhuma plataforma. O login é nativo:

1. Defina `SESSION_SECRET` no `.env` (qualquer texto longo e aleatório) — assina o
   cookie de sessão dos jogadores.
2. Na aba **Personagens → Editar** de cada PC, defina uma **senha do portal** e
   avise o jogador.
3. O jogador abre `/jogador.html`, escolhe o próprio personagem numa lista e digita
   a senha.

Sem `SESSION_SECRET` definido, uma chave de desenvolvimento é usada — funciona para
testar localmente, mas troque antes de expor o painel além do seu computador.

Se preferir uma tela compartilhada única (TV física na mesa, por exemplo) em vez de cada
jogador na própria tela, `/mesa.html` continua disponível — mostra o mesmo mapa e
iniciativa, sem exigir login.

### 3. Rodar

```powershell
npm start
```

Abra **http://localhost:3000** — esse é o seu painel do Mestre. Os jogadores acessam
`http://localhost:3000/jogador.html` (ou o endereço da sua rede/hospedagem).

## Hospedar online

O BRPG mantém uma conexão WebSocket ao vivo com cada jogador e guarda os dados em disco —
então ele precisa de um host que roda um **processo Node persistente com um volume de
disco**: **Render**, **Railway** ou **Fly.io** (ou um VPS). Ele **não** cabe em
plataformas serverless como a Vercel, onde não há processo fixo pra segurar os WebSockets
nem disco que persista entre requisições.

O repositório já vem com um **`Dockerfile`** (portável pra qualquer um desses hosts) e um
**`render.yaml`** pronto pro Render.

### Grátis: Oracle Cloud (Always Free)

Uma VM gratuita e permanente, com disco, + Cloudflare Tunnel pro HTTPS. O repositório traz
um `docker-compose.yml` que sobe tudo com um comando. Passo a passo em
[`docs/deploy-oracle.md`](docs/deploy-oracle.md).

### Deploy no Render (pago, o mais simples)

1. Suba este repositório pro GitHub.
2. No Render: **New → Blueprint**, aponte pro repositório. Ele lê o `render.yaml`, cria o
   serviço Docker, um disco persistente de 1 GB em `/data` e gera o `SESSION_SECRET`.
   (O disco persistente exige um plano pago — o gratuito não tem disco.)
3. Depois do primeiro deploy, abra a aba **Shell** do serviço e crie a sua conta de Mestre:
   ```bash
   node scripts/mint-master.js "Seu nome"
   ```
   Copie o **código de convite** que aparece (só aparece uma vez) e use pra entrar no painel.
4. (Opcional) Preencha `OPENAI_API_KEY`/`GROQ_API_KEY` e `FREESOUND_API_KEY` no dashboard
   pra ligar o Assistente de IA e a busca de sons.

Variáveis que o deploy usa: `NODE_ENV=production` (liga HTTPS/cookie seguro),
`BRPG_DATA_DIR=/data` (o volume), `BRPG_MULTI=1` (modo público, vários Mestres) e
`SESSION_SECRET` (obrigatório em produção). Veja o `.env.example`.

> **Uma instância só.** O BRPG transmite o estado da mesa a partir de um único processo.
> Não ligue autoscaling nem múltiplas instâncias — os jogadores presos numa segunda
> instância não receberiam as atualizações do Mestre.

> **Importar do YouTube num servidor** costuma esbarrar no "Sign in to confirm you're not
> a bot" (IP de datacenter). Se precisar, configure `YOUTUBE_COOKIES` — veja a seção do
> `.env` acima. Freesound e upload direto de arquivos funcionam sem isso.

## Fluxo de uma sessão

1. **Antes:** escreva a história na aba 📜, cadastre NPCs e PCs na 🧙 (com senha do
   portal pra cada jogador), monte as cenas na 🎭 com seus áudios (ou deixe a IA
   escolher com "✨ Sons IA"). Poste o recap da sessão anterior (aba 🗓️).
2. **Começando:** cada jogador abre `/jogador.html` no próprio dispositivo e entra com
   o personagem.
3. **Durante:** ative as cenas conforme o jogo avança. Use o ✨ Assistente quando os
   jogadores te surpreenderem. Rode combates na aba ⚔️ — mapa, iniciativa e ficha do
   turno aparecem ao vivo pra todo mundo.
4. **Depois:** anote o que rolou na aba 🗓️ e gere o recap com um clique.

## Estrutura

```
src/
  index.js    # ponto de entrada (inicia o armazenamento e o servidor)
  server.js   # painel web + API REST + WebSocket da mesa
  auth.js     # login nativo do portal (personagem + senha)
  dice.js     # rolagem de dados
  tts.js      # prévia de voz de NPC via Edge TTS
  ai.js       # integração com GPT/Groq (contexto = campanha inteira)
  store.js    # armazenamento em JSON (data/campaign.json)
  realtime.js # mesa em tempo real: painel do Mestre <-> tela dos jogadores <-> portal (WebSocket)
public/       # interface do painel; mesa.html = tela compartilhada; jogador.html = portal do jogador
data/
  campaign.json  # sua campanha (faça backup deste arquivo!)
  audio/         # seus arquivos de áudio
  maps/          # imagens dos mapas em uso
  images/        # retratos de personagens e tokens
  sample-maps/   # seus mapas prontos, para a galeria "📚 Exemplos"
```

## Mapas de exemplo

A aba 🗺️ tem o botão **📚 Exemplos**: ele mostra uma galeria dos mapas que estiverem em
`data/sample-maps/`. Escolha as colunas, as linhas saem sozinhas da proporção da imagem
(quadrado sempre quadrado, imagem encaixada no grid), e um clique põe o mapa em jogo.

Basta copiar os arquivos de imagem para essa pasta. Se o nome trouxer o grid — como
`Abandoned Airship Port [20x60].jpg` — ele é lido automaticamente.

Esses arquivos **não são versionados** (a pasta `data/` está no `.gitignore`). É de
propósito: mapas de artistas como o DnDavid são gratuitos para você **usar na sua mesa**,
mas isso não autoriza republicá-los dentro de um repositório público. Use à vontade
localmente; não commite a arte de terceiros.

## Dicas de imersão

- Sites como [Tabletop Audio](https://tabletopaudio.com) e [Freesound](https://freesound.org) têm ótimos áudios de ambiente gratuitos — baixe e envie para a biblioteca.
- Use **tags caprichadas** nos áudios (`taverna`, `floresta-noite`, `combate-épico`, `tensão`) — é assim que a IA acerta na escolha dos sons das cenas.
- Preencha os **segredos** dos NPCs: a IA os usa para manter coerência, mas nunca os revela nos recaps.
