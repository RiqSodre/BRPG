// Painel web do Mestre: serve a interface e a API REST.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import session from 'express-session';
import sessionFileStore from 'session-file-store';
import { EventEmitter } from 'events';
import multer from 'multer';
import youtubedl from 'youtube-dl-exec';
import ffmpegPath from 'ffmpeg-static';
import {
  getDb, save, listItems, getItem, addItem, updateItem, removeItem, newId,
  DATA_DIR, AUDIO_DIR, MAPS_DIR, IMAGES_DIR, SAMPLES_DIR, MULTI,
  withCampaign, dirsFor, forgetCampaign, activeDirs,
} from './store.js';
import { importFromVault, exportToVault } from './obsidian.js';
import { rollDice } from './dice.js';
import * as ai from './ai.js';
import * as tts from './tts.js';
import { createMesaWss, broadcastTable } from './realtime.js';
import * as auth from './auth.js';
import * as masters from './masters.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// which: 'AUDIO_DIR' | 'MAPS_DIR' | 'IMAGES_DIR'. No self-hosted a pasta é a global de
// sempre; no modo multi é a da campanha do Mestre que está subindo o arquivo — resolvida
// direto da sessão (uploads são sempre ação do Mestre logado numa campanha), sem depender
// do contexto AsyncLocalStorage, que não se propaga de forma garantida pro callback do
// multer (dirigido por eventos do stream da requisição).
const diskUpload = (which, allowed, maxMb) => multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      let dir;
      if (!MULTI) {
        dir = { AUDIO_DIR, MAPS_DIR, IMAGES_DIR }[which];
      } else {
        const cid = req.session?.campaignId;
        if (!cid) return cb(new Error('Nenhuma campanha selecionada.'));
        dir = dirsFor(cid)[which];
      }
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => cb(null, `${newId()}${path.extname(file.originalname).toLowerCase()}`),
  }),
  fileFilter: (req, file, cb) => {
    const ok = allowed.test(file.originalname);
    cb(ok ? null : new Error('Formato de arquivo não suportado'), ok);
  },
  limits: { fileSize: maxMb * 1024 * 1024 },
});

const upload = diskUpload('AUDIO_DIR', /\.(mp3|ogg|wav|m4a|webm|flac)$/i, 50);
const mapUpload = diskUpload('MAPS_DIR', /\.(png|jpe?g|webp|gif)$/i, 25);
const imageUpload = diskUpload('IMAGES_DIR', /\.(png|jpe?g|webp|gif)$/i, 10);

export function startServer() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  // Produção (hospedado) vs. self-hosted local. Em produção o host termina o TLS num
  // proxy à frente do app: sem confiar nesse proxy, o express-session vê a conexão como
  // "http" e recusa gravar um cookie secure — o login do Mestre e do jogador não gruda.
  const isProd = process.env.NODE_ENV === 'production';
  if (isProd) app.set('trust proxy', 1);

  // Chave de assinatura da sessão. Em casa (self-hosted, http) uma chave de dev serve e o
  // painel abre sem configurar nada. Hospedado, ela é obrigatória: um segredo fixo e
  // conhecido deixaria qualquer um forjar uma sessão — então falha alto no boot se faltar.
  const sessionSecret = process.env.SESSION_SECRET || (isProd ? null : 'dev-only-troque-no-.env');
  if (!sessionSecret) {
    throw new Error('SESSION_SECRET é obrigatório em produção (NODE_ENV=production). Gere um valor longo e aleatório e configure a variável de ambiente do host.');
  }
  if (sessionSecret === 'dev-only-troque-no-.env') {
    console.warn('[aviso] Usando SESSION_SECRET de desenvolvimento. Defina SESSION_SECRET antes de expor o painel além do localhost.');
  }

  // Onde guardar as sessões. Em produção, num arquivo no volume persistente (DATA_DIR/
  // sessions): sobrevive a redeploys — o Mestre e os jogadores não são deslogados a cada
  // atualização — e não vaza memória como o MemoryStore padrão. Em casa, MemoryStore
  // basta (some ao reiniciar, sem incomodar). logFn silencia o log verboso da lib.
  const FileStore = sessionFileStore(session);
  const sessionStore = isProd
    ? new FileStore({ path: path.join(DATA_DIR, 'sessions'), ttl: 30 * 24 * 60 * 60, retries: 1, logFn: () => {} })
    : undefined;

  // Sessão do PORTAL DO JOGADOR e do LOGIN DO MESTRE (modo multi). O painel do Mestre no
  // self-hosted não exige login — continua acessado direto. Fica numa variável porque o
  // handshake do WebSocket (/portal-ws, /mesa) roda esse mesmo middleware fora das rotas.
  const sessionMiddleware = session({
    name: 'brpg.sid',
    secret: sessionSecret,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    // secure só em produção (HTTPS via proxy do host); em http local quebraria o cookie.
    cookie: { httpOnly: true, sameSite: 'lax', secure: isProd, maxAge: 30 * 24 * 60 * 60 * 1000 },
  });
  app.use(sessionMiddleware);
  app.use(express.static(path.join(__dirname, '..', 'public')));

  // Existe uma campanha com esse id em disco? (só faz sentido no modo multi)
  const campanhaExiste = (cid) => !!cid && fs.existsSync(dirsFor(cid).file);

  // Mídia por campanha (áudio, mapas, retratos). No self-hosted é a pasta global de
  // sempre; no modo multi resolve a campanha pela sessão — do Mestre (campaignId), do
  // jogador (playerCid) ou, pra tela compartilhada sem cookie, do ?c= na URL. Reusa um
  // express.static por pasta (mantém range/etag/cache) em vez de reimplementar o envio.
  const staticPorPasta = new Map();
  const campaignStatic = (dir) => {
    let s = staticPorPasta.get(dir);
    if (!s) { s = express.static(dir); staticPorPasta.set(dir, s); }
    return s;
  };
  const serveMedia = (which) => (req, res, next) => {
    if (!MULTI) return campaignStatic({ AUDIO_DIR, MAPS_DIR, IMAGES_DIR }[which])(req, res, next);
    const cid = req.session?.campaignId || req.session?.playerCid
      || (typeof req.query.c === 'string' ? req.query.c : null);
    if (!campanhaExiste(cid)) return res.status(404).end();
    return campaignStatic(dirsFor(cid)[which])(req, res, next);
  };
  app.use('/audio-files', serveMedia('AUDIO_DIR'));
  app.use('/map-files', serveMedia('MAPS_DIR'));
  app.use('/images', serveMedia('IMAGES_DIR'));
  // Globais (dados genéricos, não privados de uma campanha): prévia de voz TTS e mapas de exemplo.
  app.use('/tts-files', express.static(tts.TTS_DIR));
  app.use('/sample-map-files', express.static(SAMPLES_DIR));

  const wrap = (fn) => (req, res) => {
    Promise.resolve(fn(req, res)).catch((err) => {
      console.error('[api]', err.message);
      res.status(400).json({ error: err.message });
    });
  };

  // Config pública que o front usa pra decidir o modo (existe nos dois modos).
  app.get('/api/config', (req, res) => res.json({ multi: MULTI }));

  // ---- Login do Mestre (só no modo multi — por código de convite) ----
  // No self-hosted o painel não tem login: estas rotas nem existem, pra não dar a
  // impressão de que há uma conta a criar quando roda em casa.
  if (MULTI) {
    app.post('/api/master/login', wrap(async (req, res) => {
      const r = masters.login(req.body.code);
      if (!r.ok) return res.status(401).json(r);
      req.session.masterId = r.master.id;
      req.session.save(() => res.json({ ok: true, master: r.master }));
    }));
    app.post('/api/master/logout', (req, res) => {
      // Tira só a identidade de Mestre e a campanha selecionada — não destrói a sessão
      // inteira, que num mesmo navegador poderia carregar também um login de jogador.
      delete req.session.masterId;
      delete req.session.campaignId;
      req.session.save(() => res.json({ ok: true }));
    });
    app.get('/api/master/me', (req, res) => {
      res.json({ master: masters.masterSession(req) });
    });

    // ---- Campanhas do Mestre (criar / listar / escolher / apagar) ----
    // O Mestre só enxerga e mexe nas próprias campanhas (masters.campaignIds).
    app.get('/api/campaigns', masters.requireMaster, wrap(async (req, res) => {
      const ids = masters.campaignsOf(req.session.masterId);
      const list = ids
        .filter((id) => fs.existsSync(dirsFor(id).file)) // não ressuscita campanha apagada fora do app
        .map((id) => {
          const db = withCampaign(id, () => getDb());
          return {
            id,
            name: db.settings.campaignName,
            system: db.settings.system,
            selected: id === req.session.campaignId,
          };
        });
      res.json(list);
    }));

    app.post('/api/campaigns', masters.requireMaster, wrap(async (req, res) => {
      const id = newId();
      const name = String(req.body.name || '').trim() || 'Nova Campanha';
      withCampaign(id, () => { getDb().settings.campaignName = name; save(); });
      masters.linkCampaign(req.session.masterId, id);
      req.session.campaignId = id; // já entra na campanha recém-criada
      req.session.save(() => res.json({ id, name }));
    }));

    app.post('/api/campaigns/:id/select', masters.requireMaster, wrap(async (req, res) => {
      if (!masters.ownsCampaign(req.session.masterId, req.params.id)) return res.status(403).json({ error: 'forbidden' });
      req.session.campaignId = req.params.id;
      req.session.save(() => res.json({ ok: true }));
    }));

    app.delete('/api/campaigns/:id', masters.requireMaster, wrap(async (req, res) => {
      if (!masters.ownsCampaign(req.session.masterId, req.params.id)) return res.status(403).json({ error: 'forbidden' });
      forgetCampaign(req.params.id);
      fs.rmSync(dirsFor(req.params.id).base, { recursive: true, force: true });
      masters.unlinkCampaign(req.session.masterId, req.params.id);
      if (req.session.campaignId === req.params.id) delete req.session.campaignId;
      req.session.save(() => res.json({ ok: true }));
    }));
  }

  // ---- Login do jogador (nativo — personagem + senha, sem conta externa) ----
  // No self-hosted há uma campanha só e o portal opera direto nela. No modo multi o
  // jogador chega por um link com a campanha (?c=<id>); ao entrar, a campanha fica presa
  // à sessão dele em session.playerCid — uma chave separada do campaignId do Mestre, pra
  // um Mestre e um jogador no mesmo navegador não se atropelarem.
  //
  // Resolve a campanha do portal: no multi, do ?c= (tela de login) ou da sessão (já
  // logado); no single, sempre null (uma campanha só). Devolve undefined se, no multi,
  // não veio campanha válida — o chamador responde 404.
  const resolvePortalCid = (req, hint) => {
    if (!MULTI) return null;
    const cid = hint || (typeof req.query.c === 'string' ? req.query.c : null) || req.session?.playerCid || null;
    return campanhaExiste(cid) ? cid : undefined;
  };

  // Lista pública pro seletor de personagem na tela de login.
  app.get('/api/portal/roster', wrap(async (req, res) => {
    if (!MULTI) return res.json(auth.rosterPublico());
    const cid = resolvePortalCid(req);
    if (!cid) return res.status(404).json({ error: 'campaign_not_found' });
    res.json(withCampaign(cid, () => auth.rosterPublico()));
  }));

  app.post('/api/portal/login', wrap(async (req, res) => {
    if (!MULTI) {
      const r = auth.login(req.body.characterId, req.body.passcode);
      if (!r.ok) return res.status(401).json(r);
      req.session.characterId = r.character.id;
      return req.session.save(() => res.json(r));
    }
    const cid = resolvePortalCid(req, req.body.c);
    if (!cid) return res.status(404).json({ error: 'campaign_not_found' });
    const r = withCampaign(cid, () => auth.login(req.body.characterId, req.body.passcode));
    if (!r.ok) return res.status(401).json(r);
    req.session.characterId = r.character.id;
    req.session.playerCid = cid; // prende o jogador a esta campanha
    req.session.save(() => res.json(r));
  }));

  app.post('/api/portal/logout', (req, res) => {
    req.session.destroy(() => res.json({ ok: true }));
  });

  // Quem está logado agora — null se ninguém (a tela de login decide sozinha o que mostrar).
  app.get('/api/portal/me', (req, res) => {
    if (!MULTI) return res.json({ character: auth.sessionCharacter(req) });
    const cid = req.session?.playerCid;
    if (!campanhaExiste(cid)) return res.json({ character: null });
    res.json({ character: withCampaign(cid, () => auth.sessionCharacter(req)) });
  });

  // ---- Portão de contexto de campanha (só no modo multi) ----
  // Daqui pra baixo estão as rotas do PAINEL DO MESTRE — inclusive /api/state, que
  // devolve o db inteiro (notas e segredos). No self-hosted isso roda em rede confiável
  // e fica aberto, como sempre. No modo público exige um Mestre logado, dono da campanha
  // selecionada, e roda tudo dentro dela (withCampaign). Rotas registradas ANTES daqui
  // (login do Mestre, CRUD de campanhas, portal do jogador) já responderam e não passam
  // por este portão.
  if (MULTI) {
    app.use('/api', masters.requireMaster, (req, res, next) => {
      const cid = req.session.campaignId;
      if (!cid) return res.status(409).json({ error: 'no_campaign', message: 'Escolha uma campanha primeiro.' });
      if (!masters.ownsCampaign(req.session.masterId, cid)) return res.status(403).json({ error: 'forbidden' });
      if (!fs.existsSync(dirsFor(cid).file)) return res.status(404).json({ error: 'campaign_not_found' });
      withCampaign(cid, () => next());
    });
  }

  // ---- Estado geral ----
  app.get('/api/state', wrap(async (req, res) => {
    res.json(getDb());
  }));

  app.put('/api/settings', wrap(async (req, res) => {
    Object.assign(getDb().settings, req.body);
    save();
    res.json(getDb().settings);
  }));

  // Excluir um item do catálogo também o tira das mochilas.
  // Registrado ANTES do CRUD genérico para ter precedência na mesma rota.
  app.delete('/api/items/:id', wrap(async (req, res) => {
    removeItem('items', req.params.id);
    for (const ch of getDb().characters) {
      if (Array.isArray(ch.inventory)) ch.inventory = ch.inventory.filter((l) => l.itemId !== req.params.id);
    }
    save();
    res.json({ ok: true });
  }));

  // ---- CRUD das coleções ----
  for (const col of ['story', 'characters', 'scenes', 'sessions', 'items']) {
    app.get(`/api/${col}`, wrap(async (req, res) => res.json(listItems(col))));
    app.post(`/api/${col}`, wrap(async (req, res) => {
      const item = addItem(col, req.body);
      // A ficha do personagem (habilidades, magias, mochila, roleplay...) alimenta o
      // HUD de turno na tela dos jogadores — sem isso, só atualizava na próxima ação
      // de mapa/combate, o que podia deixar dados velhos na tela por um bom tempo.
      if (col === 'characters') broadcastTable();
      res.json(item);
    }));
    app.put(`/api/${col}/:id`, wrap(async (req, res) => {
      const item = updateItem(col, req.params.id, req.body);
      if (!item) return res.status(404).json({ error: 'Não encontrado' });
      if (col === 'characters') broadcastTable();
      res.json(item);
    }));
    app.delete(`/api/${col}/:id`, wrap(async (req, res) => {
      removeItem(col, req.params.id);
      if (col === 'characters') broadcastTable();
      res.json({ ok: true });
    }));
  }

  // ---- Mochila dos personagens (aponta para o catálogo de itens) ----
  const acharPersonagem = (id) => {
    const ch = getItem('characters', id);
    if (!ch) throw new Error('Personagem não encontrado.');
    if (!Array.isArray(ch.inventory)) ch.inventory = [];
    return ch;
  };

  // Entrega um item (soma na quantidade se já tiver) e, se pedido, avisa o jogador por DM.
  app.post('/api/characters/:id/inventory', wrap(async (req, res) => {
    const ch = acharPersonagem(req.params.id);
    const item = getItem('items', req.body.itemId);
    if (!item) throw new Error('Item não encontrado no catálogo.');
    // Recusa quantidade inválida em vez de "consertar" no silêncio: antes um -1
    // virava +1 (Math.max) e o Mestre via o oposto do que pediu.
    const qty = Math.floor(Number(req.body.qty));
    if (!Number.isFinite(qty) || qty < 1) {
      throw new Error('A quantidade a entregar precisa ser um número inteiro de 1 para cima. Para tirar itens, use o ✕ na mochila.');
    }
    const linha = ch.inventory.find((l) => l.itemId === item.id);
    if (linha) linha.qty += qty; else ch.inventory.push({ itemId: item.id, qty });
    save();
    // O jogador já vê o item chegar ao vivo no próprio portal — não precisa de aviso à parte.
    res.json({ inventory: ch.inventory });
  }));

  // Ajusta a quantidade (0 ou menos remove o item da mochila).
  app.put('/api/characters/:id/inventory/:itemId', wrap(async (req, res) => {
    const ch = acharPersonagem(req.params.id);
    const qty = Math.floor(Number(req.body.qty));
    if (!Number.isFinite(qty)) throw new Error('Quantidade inválida.');
    const i = ch.inventory.findIndex((l) => l.itemId === req.params.itemId);
    if (i === -1) throw new Error('Esse item não está na mochila.');
    // Aqui a quantidade é absoluta (não um ajuste): zero ou menos tira da mochila.
    if (qty > 0) ch.inventory[i].qty = qty; else ch.inventory.splice(i, 1);
    save();
    res.json({ inventory: ch.inventory });
  }));

  app.delete('/api/characters/:id/inventory/:itemId', wrap(async (req, res) => {
    const ch = acharPersonagem(req.params.id);
    ch.inventory = ch.inventory.filter((l) => l.itemId !== req.params.itemId);
    save();
    res.json({ inventory: ch.inventory });
  }));

  // ---- Biblioteca de áudio ----
  app.get('/api/audio', wrap(async (req, res) => res.json(listItems('audio'))));
  app.post('/api/audio', upload.single('file'), wrap(async (req, res) => {
    const type = req.body.type || 'sfx';
    const item = addItem('audio', {
      name: req.body.name || path.parse(req.file.originalname).name,
      filename: req.file.filename,
      type,
      category: type === 'sfx' ? (req.body.category || 'geral') : undefined,
      tags: (req.body.tags || '').split(',').map((t) => t.trim()).filter(Boolean),
      volume: 1,
    });
    res.json(item);
  }));
  app.put('/api/audio/:id', wrap(async (req, res) => {
    res.json(updateItem('audio', req.params.id, req.body));
  }));
  app.delete('/api/audio/:id', wrap(async (req, res) => {
    removeItem('audio', req.params.id);
    res.json({ ok: true });
  }));

  // ---- Cenas: ativar marca qual é a cena corrente ----
  app.post('/api/scenes/:id/activate', wrap(async (req, res) => {
    const scene = getItem('scenes', req.params.id);
    if (!scene) throw new Error('Cena não encontrada.');
    const db = getDb();
    db.activeSceneId = scene.id;
    save();
    res.json({ ok: true });
  }));

  // ---- Vozes de NPC (TTS) — prévia local, tocada no navegador do Mestre ----
  app.get('/api/tts/voices', wrap(async (req, res) => res.json(tts.VOICES)));
  app.post('/api/tts/speak', wrap(async (req, res) => {
    const { text, npcId } = req.body;
    let voiceOpts = {};
    if (npcId) {
      const npc = getItem('characters', npcId);
      if (npc) voiceOpts = { voice: npc.ttsVoice || undefined, rate: npc.ttsRate || 0, pitch: npc.ttsPitch || 0 };
    }
    const result = await tts.synthesize(text, voiceOpts);
    res.json({ url: result.url });
  }));

  // ---- IA ----
  app.post('/api/ai/chat', wrap(async (req, res) => {
    res.json({ reply: await ai.chat(req.body.history || []) });
  }));
  app.post('/api/ai/recap/:sessionId', wrap(async (req, res) => {
    const recap = await ai.generateRecap(req.params.sessionId);
    updateItem('sessions', req.params.sessionId, { recap });
    res.json({ recap });
  }));
  app.post('/api/ai/npc/:npcId', wrap(async (req, res) => {
    res.json({ reply: await ai.improviseNpc(req.params.npcId, req.body.situation || '') });
  }));
  app.post('/api/ai/suggest-audio/:sceneId', wrap(async (req, res) => {
    const suggestion = await ai.suggestSceneAudio(req.params.sceneId);
    if (req.body.apply) {
      updateItem('scenes', req.params.sceneId, {
        ambientAudioId: suggestion.ambientAudioId,
        musicAudioId: suggestion.musicAudioId,
        sfxIds: suggestion.sfxIds,
      });
    }
    res.json(suggestion);
  }));

  // ---- Dados (rolagem local no painel) ----
  app.post('/api/roll', wrap(async (req, res) => {
    const result = rollDice(req.body.expr);
    if (result.error) throw new Error(result.error);
    res.json(result);
  }));

  // ---- Freesound: buscar e importar sons direto para a biblioteca ----
  const fsKey = () => {
    if (!process.env.FREESOUND_API_KEY) {
      throw new Error('FREESOUND_API_KEY não definida no .env — crie uma grátis em freesound.org/apiv2/apply');
    }
    return process.env.FREESOUND_API_KEY;
  };
  app.get('/api/freesound/search', wrap(async (req, res) => {
    const q = String(req.query.q || '').trim();
    if (!q) return res.json([]);
    const url = `https://freesound.org/apiv2/search/text/?query=${encodeURIComponent(q)}` +
      `&fields=id,name,previews,duration,tags,username&page_size=12&token=${fsKey()}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`Freesound respondeu ${r.status} — confira a FREESOUND_API_KEY.`);
    const data = await r.json();
    res.json((data.results || []).map((s) => ({
      id: s.id,
      name: s.name,
      duration: s.duration,
      tags: (s.tags || []).slice(0, 6),
      username: s.username,
      previewUrl: s.previews?.['preview-hq-mp3'] || s.previews?.['preview-lq-mp3'],
    })));
  }));
  app.post('/api/freesound/import', wrap(async (req, res) => {
    const { name, previewUrl, type, category, tags } = req.body;
    const host = new URL(previewUrl).hostname;
    if (!host.endsWith('freesound.org')) throw new Error('URL inválida.');
    const r = await fetch(`${previewUrl}${previewUrl.includes('?') ? '&' : '?'}token=${fsKey()}`);
    if (!r.ok) throw new Error(`Falha ao baixar o som (${r.status}).`);
    const filename = `${newId()}.mp3`;
    fs.writeFileSync(path.join(activeDirs().AUDIO_DIR, filename), Buffer.from(await r.arrayBuffer()));
    const item = addItem('audio', {
      name: name || 'Som do Freesound',
      filename,
      type: type || 'sfx',
      category: (type || 'sfx') === 'sfx' ? (category || 'geral') : undefined,
      tags: Array.isArray(tags) ? tags : [],
      volume: 1,
    });
    res.json(item);
  }));

  // ---- YouTube: buscar e importar áudio direto para a biblioteca (via yt-dlp) ----
  // yt-dlp já veio pronto (baixado no npm install, sem precisar de Python instalado —
  // no Windows é um .exe autocontido). Reaproveita o ffmpeg-static que o projeto já usa
  // pra outras coisas, então não depende de nada além do que já está no repositório.
  // O yt-dlp precisa de um runtime de JavaScript para responder aos desafios do YouTube
  // (sem ele, ele mesmo avisa que a extração está descontinuada). Acha o `deno` sozinho
  // se estiver no PATH; DENO_PATH existe para quando o painel roda como serviço ou de um
  // atalho que não herdou o PATH novo depois da instalação.
  const ytRuntime = () => (process.env.DENO_PATH ? { jsRuntimes: `deno:${process.env.DENO_PATH}` } : {});

  // O YouTube às vezes responde "Sign in to confirm you're not a bot" — a checagem dele
  // contra IPs que baixam muito (VPS, provedor compartilhado, rede com muita gente).
  // A saída que o próprio yt-dlp indica é mandar os cookies de uma conta logada; quem
  // hospeda escolhe entre apontar um arquivo cookies.txt ou ler direto do navegador.
  let avisouCookies = false;
  const ytCookies = () => {
    const arquivo = process.env.YOUTUBE_COOKIES;
    if (arquivo) {
      // Caminho errado faz o yt-dlp morrer com um traceback de Python e derruba até a
      // busca, que nem precisaria de login. Melhor ignorar e seguir sem cookies.
      if (fs.existsSync(arquivo)) return { cookies: arquivo };
      if (!avisouCookies) {
        avisouCookies = true;
        console.warn(`[youtube] YOUTUBE_COOKIES aponta para um arquivo que não existe (${arquivo}) — seguindo sem cookies.`);
      }
      return {};
    }
    if (process.env.YOUTUBE_COOKIES_FROM_BROWSER) return { cookiesFromBrowser: process.env.YOUTUBE_COOKIES_FROM_BROWSER };
    return {};
  };
  // Erro do yt-dlp vira uma frase que diz o que fazer — a mensagem crua sai em inglês,
  // com três links de documentação, e não ajuda quem só queria uma música de taverna.
  const ytErro = (prefixo, e) => {
    const bruto = (e.message || '').trim();
    if (/confirm\s+you.{0,3}re\s+not\s+a\s+bot|Sign in to confirm/i.test(bruto)) {
      return new Error(`${prefixo}: o YouTube está exigindo uma sessão logada nesta conexão. `
        + 'Configure YOUTUBE_COOKIES ou YOUTUBE_COOKIES_FROM_BROWSER no .env (veja o README) — '
        + 'e vale rodar `npm run update-ytdlp`, caso a sua cópia do yt-dlp esteja velha.');
    }
    // Quando o yt-dlp quebra de vez, a primeira linha é "Traceback (most recent call
    // last):" e não diz nada — a linha útil é a última.
    const linhas = bruto.split('\n').map((l) => l.trim()).filter(Boolean);
    const util = linhas.find((l) => l.startsWith('ERROR:')) || (/^Traceback/.test(linhas[0] || '') ? linhas[linhas.length - 1] : linhas[0]);
    return new Error(`${prefixo}: ${util || bruto}`);
  };

  app.get('/api/youtube/search', wrap(async (req, res) => {
    const q = String(req.query.q || '').trim();
    if (!q) return res.json([]);
    let data;
    try {
      data = await youtubedl(`ytsearch8:${q}`, {
        dumpSingleJson: true, flatPlaylist: true, noWarnings: true, noCheckCertificates: true,
        ...ytRuntime(),
        ...ytCookies(),
      });
    } catch (e) {
      throw ytErro('Busca no YouTube falhou', e);
    }
    res.json((data.entries || []).map((v) => ({
      id: v.id,
      title: v.title,
      duration: v.duration || 0,
      channel: v.channel || v.uploader || '',
      thumbnailUrl: v.thumbnails?.[v.thumbnails.length - 1]?.url || '',
    })));
  }));
  app.post('/api/youtube/import', wrap(async (req, res) => {
    const { videoId, title, type, category, tags } = req.body;
    if (!videoId) throw new Error('videoId ausente.');
    const filename = `${newId()}.mp3`;
    try {
      await youtubedl(`https://www.youtube.com/watch?v=${videoId}`, {
        extractAudio: true,
        audioFormat: 'mp3',
        output: path.join(activeDirs().AUDIO_DIR, filename),
        ffmpegLocation: ffmpegPath,
        noCheckCertificates: true,
        noWarnings: true,
        ...ytRuntime(),
        ...ytCookies(),
      });
    } catch (e) {
      throw ytErro('Falha ao baixar do YouTube', e);
    }
    const item = addItem('audio', {
      name: title || 'Áudio do YouTube',
      filename,
      type: type || 'music',
      category: (type || 'music') === 'sfx' ? (category || 'geral') : undefined,
      tags: Array.isArray(tags) ? tags : [],
      volume: 1,
    });
    res.json(item);
  }));

  // ---- Bestiário SRD (dnd5eapi.co) ----
  const srdCache = new Map();
  const srdFetch = async (p) => {
    if (srdCache.has(p)) return srdCache.get(p);
    const r = await fetch(`https://www.dnd5eapi.co${p}`);
    if (!r.ok) throw new Error('Falha ao consultar o bestiário SRD.');
    const json = await r.json();
    srdCache.set(p, json);
    return json;
  };
  app.get('/api/srd/monsters', wrap(async (req, res) => {
    const q = String(req.query.q || '').trim();
    const data = await srdFetch(`/api/2014/monsters${q ? `?name=${encodeURIComponent(q)}` : ''}`);
    res.json(data.results || []);
  }));
  app.get('/api/srd/monsters/:index', wrap(async (req, res) => {
    res.json(await srdFetch(`/api/2014/monsters/${encodeURIComponent(req.params.index)}`));
  }));
  // Baixa a arte oficial do monstro (quando existe) e guarda em data/images,
  // pra não depender do dnd5eapi.co em jogo e o token ficar com imagem permanente.
  app.get('/api/srd/monsters/:index/image', wrap(async (req, res) => {
    const safe = String(req.params.index).replace(/[^a-z0-9-]/gi, '');
    if (!safe) return res.json({ url: null });
    const filename = `srd-${safe}.png`;
    const dest = path.join(activeDirs().IMAGES_DIR, filename);
    const localUrl = `/images/${filename}`;
    if (fs.existsSync(dest)) return res.json({ url: localUrl });
    const m = await srdFetch(`/api/2014/monsters/${encodeURIComponent(req.params.index)}`);
    if (!m.image) return res.json({ url: null });
    const r = await fetch(`https://www.dnd5eapi.co${m.image}`);
    if (!r.ok) return res.json({ url: null });
    fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
    res.json({ url: localUrl });
  }));
  // Tradução PT-BR dos textos livres do monstro (habilidades/ações) via IA, cacheada
  // em disco por monstro. Se a IA não estiver configurada ou falhar, devolve blocks:null
  // e o cliente cai na tradução por dicionário. Nunca cacheia falha.
  app.get('/api/srd/monsters/:index/translate', wrap(async (req, res) => {
    const safe = String(req.params.index).replace(/[^a-z0-9-]/gi, '');
    if (!safe) return res.json({ blocks: null });
    const dir = path.join(DATA_DIR, 'srd-pt');
    fs.mkdirSync(dir, { recursive: true });
    const cacheFile = path.join(dir, `${safe}.json`);
    if (fs.existsSync(cacheFile)) return res.json(JSON.parse(fs.readFileSync(cacheFile, 'utf8')));

    const m = await srdFetch(`/api/2014/monsters/${encodeURIComponent(req.params.index)}`);
    const collect = (arr) => (arr || []).map((a) => ({ name: a.name, desc: a.desc }));
    const groups = {
      special_abilities: collect(m.special_abilities),
      actions: collect(m.actions),
      reactions: collect(m.reactions),
      legendary_actions: collect(m.legendary_actions),
    };
    // Achata numa lista só para uma única chamada de IA, guardando de que grupo veio.
    const flat = [];
    for (const [k, arr] of Object.entries(groups)) arr.forEach((b, i) => flat.push({ k, i, ...b }));
    if (!flat.length) {
      const out = { blocks: groups };
      fs.writeFileSync(cacheFile, JSON.stringify(out));
      return res.json(out);
    }
    let translated;
    try {
      translated = await ai.translateMonster(m.name, flat);
    } catch (e) {
      return res.json({ blocks: null, error: String(e.message || e) });
    }
    flat.forEach((b, idx) => {
      const t = translated[idx];
      if (t && groups[b.k][b.i]) {
        groups[b.k][b.i] = {
          name: t.name || groups[b.k][b.i].name,
          desc: t.desc || groups[b.k][b.i].desc,
        };
      }
    });
    const out = { blocks: groups };
    fs.writeFileSync(cacheFile, JSON.stringify(out));
    res.json(out);
  }));

  // ---- Retratos (personagens e tokens) ----
  app.post('/api/images', imageUpload.single('file'), wrap(async (req, res) => {
    if (!req.file) throw new Error('Nenhuma imagem enviada.');
    res.json({ url: `/images/${req.file.filename}` });
  }));

  // ---- Mapas de exemplo (pasta local do usuário: data/sample-maps) ----
  const IMG_RE = /\.(png|jpe?g|webp|gif)$/i;

  // O nome do arquivo costuma trazer o grid, tipo "Abandoned Airship Port [20x60].jpg".
  const gridFromName = (nome) => {
    const m = nome.match(/[[(](\d{1,3})\s*[x×]\s*(\d{1,3})[\])]/i);
    return m ? { cols: Number(m[1]), rows: Number(m[2]) } : null;
  };
  const prettyName = (arquivo) => path.parse(arquivo).name
    .replace(/[[(][^\])]*[\])]/g, '')   // tira "[20x60]" e "(DnDavid)"
    .replace(/[-_]+/g, ' ')
    .trim() || path.parse(arquivo).name;

  app.get('/api/sample-maps', wrap(async (req, res) => {
    const arquivos = fs.readdirSync(SAMPLES_DIR).filter((f) => IMG_RE.test(f));
    res.json(arquivos.map((f) => ({
      file: f,
      name: prettyName(f),
      url: `/sample-map-files/${encodeURIComponent(f)}`,
      grid: gridFromName(f), // null = o painel sugere pela proporção da imagem
    })));
  }));

  app.post('/api/sample-maps/import', wrap(async (req, res) => {
    const { file, name, cols, rows, cellSize, img } = req.body;
    // Só aceita um arquivo que realmente está na pasta — nada de "../../.env"
    const existe = fs.readdirSync(SAMPLES_DIR).includes(path.basename(file || ''));
    if (!existe) throw new Error('Mapa de exemplo não encontrado.');

    const origem = path.join(SAMPLES_DIR, path.basename(file));
    const filename = `${newId()}${path.extname(file).toLowerCase()}`;
    fs.copyFileSync(origem, path.join(activeDirs().MAPS_DIR, filename));

    const map = addItem('maps', {
      name: name || prettyName(file),
      cols: Math.max(1, Math.min(80, Number(cols) || 40)),
      rows: Math.max(1, Math.min(80, Number(rows) || 30)),
      cellSize: Number(cellSize) || 1.5,
      filename,
      imageUrl: '',
      img: img || { x: 0, y: 0, scale: 1 },
      fog: { enabled: false, revealed: [] },
    });
    res.json(map);
  }));

  // ---- Mapas de batalha ----
  app.get('/api/maps', wrap(async (req, res) => res.json(listItems('maps'))));
  app.post('/api/maps', mapUpload.single('file'), wrap(async (req, res) => {
    const b = req.body;
    // O cliente mede a imagem e manda a escala que a encaixa exatamente no grid.
    // Sem isso, a imagem entraria em escala 1 (1px da foto = 1px do grid) e estouraria.
    const scale = Number(b.imgScale) > 0 ? Number(b.imgScale) : 1;
    const map = addItem('maps', {
      name: b.name || 'Mapa sem nome',
      cols: Math.max(1, Math.min(80, Number(b.cols) || 20)),
      rows: Math.max(1, Math.min(80, Number(b.rows) || 15)),
      cellSize: Number(b.cellSize) || 1.5, // metros por quadrado (5 pés = 1,5 m)
      gridType: b.gridType === 'hex' ? 'hex' : 'square',
      filename: req.file?.filename || '',
      imageUrl: req.file ? '' : (b.imageUrl || ''),
      img: { x: Number(b.imgX) || 0, y: Number(b.imgY) || 0, scale },
      fog: { enabled: false, revealed: [] },
    });
    res.json(map);
  }));
  app.put('/api/maps/:id', wrap(async (req, res) => {
    const map = updateItem('maps', req.params.id, req.body);
    if (!map) return res.status(404).json({ error: 'Mapa não encontrado' });
    broadcastTable();
    res.json(map);
  }));
  app.delete('/api/maps/:id', wrap(async (req, res) => {
    removeItem('maps', req.params.id);
    const db = getDb();
    // Apagar o mapa em jogo só tira o mapa de cena — os tokens, a névoa e as
    // configurações da mesa continuam (antes isso zerava a batalha inteira).
    if (db.battle.mapId === req.params.id) {
      db.battle.mapId = null;
      save();
    }
    broadcastTable();
    res.json({ ok: true });
  }));

  // ---- Estado da batalha (mapa ativo + tokens) ----
  app.get('/api/battle', wrap(async (req, res) => res.json(getDb().battle)));
  app.put('/api/battle', wrap(async (req, res) => {
    getDb().battle = { ...getDb().battle, ...req.body };
    save();
    broadcastTable();
    res.json(getDb().battle);
  }));

  // ---- Combate / iniciativa ----
  app.put('/api/combat', wrap(async (req, res) => {
    const db = getDb();
    db.combat = req.body;
    save();
    // A ficha do turno já aparece ao vivo no portal e na tela dos jogadores — de quem
    // é a vez, PV, condições, tudo em tempo real, sem precisar de aviso à parte.
    broadcastTable();
    res.json(db.combat);
  }));

  // ---- Obsidian: importar / exportar dados da campanha ----
  app.post('/api/obsidian/import', wrap(async (req, res) => {
    const db = getDb();
    const obs = db.settings.obsidian || {};
    const result = importFromVault(db, obs);
    save();
    res.json(result);
  }));

  app.post('/api/obsidian/export', wrap(async (req, res) => {
    const db = getDb();
    const obs = db.settings.obsidian || {};
    const result = exportToVault(db, obs);
    res.json(result);
  }));

  const port = process.env.PORT || 3000;
  const server = app.listen(port, () => {
    console.log(`[painel] Mesa do Mestre rodando em http://localhost:${port}`);
    console.log(`[mesa]   Tela dos jogadores em http://localhost:${port}/mesa.html`);
  });

  // Mesa em tempo real (mapa de batalha) — painel do Mestre e telas dos jogadores
  const mesaWss = createMesaWss();

  // Handshake mínimo pra rodar o middleware de sessão fora do pipeline do Express: o
  // upgrade do WebSocket é uma requisição HTTP normal (cookie incluso), mas não passa
  // por app.use(). express-session só lê req.session daqui — nunca escreve resposta —
  // então um objeto falso com os métodos que ele espera encontrar basta.
  const respostaFalsa = () => {
    const res = new EventEmitter();
    res.writeHead = () => res;
    res.getHeader = () => undefined;
    res.setHeader = () => res;
    res.end = () => res;
    return res;
  };

  // Um único despachante de upgrade: /mesa (painel do Mestre e mesa.html) e
  // /portal-ws (jogador.html, autenticado) compartilham o mesmo mesaWss.
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://localhost');
    const { pathname } = url;
    if (pathname !== '/mesa' && pathname !== '/portal-ws') { socket.destroy(); return; }
    const conectar = () => mesaWss.handleUpgrade(req, socket, head, (ws) => mesaWss.emit('connection', ws, req));

    // Self-hosted: uma campanha só. /mesa segue aberto (rede confiável); /portal-ws
    // exige sessão de jogador válida. É o comportamento de sempre.
    if (!MULTI) {
      if (pathname !== '/portal-ws') { conectar(); return; }
      sessionMiddleware(req, respostaFalsa(), () => {
        req.brpgAuthRequired = true;
        req.brpgPlayer = auth.sessionCharacter(req); // null se a sessão não é de um jogador logado
        conectar();
      });
      return;
    }

    // Modo multi: a sessão (e ?c= pra tela compartilhada) decide a campanha e o papel.
    sessionMiddleware(req, respostaFalsa(), () => {
      if (pathname === '/portal-ws') {
        // Jogador: a campanha veio no login do portal (session.playerCid).
        const cid = req.session?.playerCid || null;
        req.brpgCampaignId = campanhaExiste(cid) ? cid : null;
        req.brpgAuthRequired = true;
        req.brpgPlayer = req.brpgCampaignId ? withCampaign(req.brpgCampaignId, () => auth.sessionCharacter(req)) : null;
        conectar();
        return;
      }
      // /mesa: painel do Mestre (dm) ou tela compartilhada (player, via ?c=).
      const qc = url.searchParams.get('c');
      const cid = req.session?.campaignId || qc || null;
      if (!campanhaExiste(cid)) { socket.destroy(); return; } // sem mesa válida não há o que espelhar
      req.brpgCampaignId = cid;
      req.brpgIsMaster = !!(req.session?.masterId && masters.ownsCampaign(req.session.masterId, cid));
      req.brpgDmRequiresMaster = true;
      conectar();
    });
  });

  return app;
}
