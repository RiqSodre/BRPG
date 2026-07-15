# 🐉 Mesa do Mestre

Assistente do Mestre para campanhas de RPG jogadas via Discord. Centraliza **história, cenas, personagens, sessões e áudios** — e usa IA (Claude) que conhece toda a sua campanha para te ajudar a mestrar.

## O que ele faz

- **🎭 Cenas com som automático** — ao ativar uma cena no painel, o bot posta a descrição + imagem no canal de texto do Discord e **toca o áudio ambiente/música automaticamente** no canal de voz, em loop, com **crossfade** entre cenas.
- **🎵 Mixer de verdade** — efeitos sonoros tocam **por cima** do ambiente sem interrompê-lo; volume master ao vivo. Busque e importe sons direto do **Freesound** pelo painel.
- **🗣️ Vozes de NPC (TTS)** — o bot **fala as falas dos NPCs** no canal de voz, com voz, tom e ritmo configuráveis por NPC (Edge TTS, gratuito). Ouça a prévia no navegador antes de soltar na mesa.
- **🎙️ Cabine do Mestre** — fale pelos NPCs com **a sua voz transformada em tempo real** (pitch, reverb, distorção), com preset salvo por NPC. O painel captura seu microfone, aplica os efeitos e transmite pelo bot, por cima da música. Use fones e mute-se no Discord enquanto encarna. *Para os jogadores terem voz própria, cada um usa um modificador local (Voicemod/Clownfish) com microfone virtual — o Discord não permite que um bot transforme a voz de outros usuários.*
- **✨ IA que entende a campanha** — chat do Mestre com acesso a toda a história, NPCs (e seus segredos), cenas e sessões. Pergunte "o que o taverneiro sabe sobre o culto?", improvise locais/NPCs/encontros, gere recaps épicos das sessões.
- **🤖 Sons escolhidos por IA** — o botão "✨ Sons IA" numa cena faz a IA escolher os áudios da sua biblioteca que combinam com ela (pelas tags e descrição).
- **🧙 Personagens** — fichas de PCs e NPCs (D&D 5e), com botão de **improvisar diálogo de NPC** na hora.
- **📨 Handouts e segredos** — envie cartas, mapas e segredos **por DM a um jogador específico** (o jogador se vincula ao personagem com `/vincular`) ou ao canal para todos.
- **⚔️ Iniciativa esperta** — busque monstros no **bestiário SRD** (dnd5eapi.co), veja o stat block e adicione ao combate com iniciativa rolada. Condições, death saves e lembrete de CD de concentração ao tomar dano.
- **🎲 Dados** — jogadores rolam com `/rolar 1d20+5` no Discord; o Mestre rola pelo painel.

## Instalação

### 1. Dependências

```powershell
npm install
```

### 2. Criar o bot no Discord

1. Acesse https://discord.com/developers/applications → **New Application** → dê um nome (ex: "Mesa do Mestre").
2. Na aba **Bot**: clique em **Reset Token** e copie o token (vai no `.env`).
3. Na aba **Installation** (ou OAuth2 → URL Generator): gere um link de convite com escopos `bot` + `applications.commands` e permissões: *Send Messages, Embed Links, Connect, Speak, Use Slash Commands*.
4. Abra o link gerado e adicione o bot ao servidor onde vocês jogam.
5. No Discord, ative o **Modo Desenvolvedor** (Configurações → Avançado), clique com o botão direito no seu servidor → **Copiar ID do servidor**.

### 3. Configurar o `.env`

```powershell
Copy-Item .env.example .env
```

Edite o `.env` e preencha:

- `DISCORD_TOKEN` — token do bot (passo 2)
- `DISCORD_GUILD_ID` — ID do servidor
- `ANTHROPIC_API_KEY` — chave criada em https://console.anthropic.com (a IA é paga por uso; uma sessão de jogo típica custa centavos)
- `FREESOUND_API_KEY` — opcional, para buscar sons pelo painel (grátis em https://freesound.org/apiv2/apply)

### 4. Rodar

```powershell
npm start
```

Abra **http://localhost:3000** — esse é o seu painel do Mestre (só você vê; os jogadores veem apenas o que o bot posta no Discord).

## Fluxo de uma sessão

1. **Antes:** escreva a história na aba 📜, cadastre NPCs na 🧙, monte as cenas na 🎭 com seus áudios (ou deixe a IA escolher com "✨ Sons IA"). Poste o recap da sessão anterior (aba 🗓️).
2. **Começando:** entre no canal de voz com seus amigos e use `/entrar` no Discord (ou o botão "Conectar voz" no painel).
3. **Durante:** ative as cenas conforme o jogo avança — descrição, imagem e som saem automaticamente. Dispare efeitos pelo soundboard da cena. Use o ✨ Assistente quando os jogadores te surpreenderem. Rode combates na aba ⚔️.
4. **Depois:** anote o que rolou na aba 🗓️ e gere o recap com um clique.

## Estrutura

```
src/
  index.js    # ponto de entrada (servidor + bot)
  server.js   # painel web + API REST
  bot.js      # bot do Discord (voz, cenas, /rolar, /vincular, handouts)
  mixer.js    # mixer PCM: ambiente + efeitos + voz ao vivo, crossfade, loop
  tts.js      # vozes de NPC via Edge TTS
  ai.js       # integração com Claude (contexto = campanha inteira)
  store.js    # armazenamento em JSON (data/campaign.json)
  realtime.js # mesa em tempo real: painel do Mestre <-> tela dos jogadores (WebSocket)
scripts/
  smoke-mixer.js # teste do mixer: node scripts/smoke-mixer.js
public/       # interface do painel (mesa.html = tela dos jogadores)
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
