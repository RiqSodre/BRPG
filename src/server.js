// Painel web do Mestre: serve a interface e a API REST.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import multer from 'multer';
import { WebSocketServer } from 'ws';
import {
  getDb, save, listItems, getItem, addItem, updateItem, removeItem, newId,
  DATA_DIR, AUDIO_DIR, MAPS_DIR, IMAGES_DIR, SAMPLES_DIR,
} from './store.js';
import { importFromVault, exportToVault } from './obsidian.js';
import * as bot from './bot.js';
import * as ai from './ai.js';
import * as tts from './tts.js';
import { createMesaWss, broadcastTable } from './realtime.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const diskUpload = (dir, allowed, maxMb) => multer({
  storage: multer.diskStorage({
    destination: dir,
    filename: (req, file, cb) => cb(null, `${newId()}${path.extname(file.originalname).toLowerCase()}`),
  }),
  fileFilter: (req, file, cb) => {
    const ok = allowed.test(file.originalname);
    cb(ok ? null : new Error('Formato de arquivo não suportado'), ok);
  },
  limits: { fileSize: maxMb * 1024 * 1024 },
});

const upload = diskUpload(AUDIO_DIR, /\.(mp3|ogg|wav|m4a|webm|flac)$/i, 50);
const mapUpload = diskUpload(MAPS_DIR, /\.(png|jpe?g|webp|gif)$/i, 25);
const imageUpload = diskUpload(IMAGES_DIR, /\.(png|jpe?g|webp|gif)$/i, 10);

export function startServer() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use(express.static(path.join(__dirname, '..', 'public')));
  app.use('/audio-files', express.static(AUDIO_DIR));
  app.use('/tts-files', express.static(tts.TTS_DIR));
  app.use('/map-files', express.static(MAPS_DIR));
  app.use('/images', express.static(IMAGES_DIR));
  app.use('/sample-map-files', express.static(SAMPLES_DIR));

  const wrap = (fn) => (req, res) => {
    Promise.resolve(fn(req, res)).catch((err) => {
      console.error('[api]', err.message);
      res.status(400).json({ error: err.message });
    });
  };

  // ---- Estado geral ----
  app.get('/api/state', wrap(async (req, res) => {
    res.json({ ...getDb(), bot: bot.botStatus() });
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
    app.post(`/api/${col}`, wrap(async (req, res) => res.json(addItem(col, req.body))));
    app.put(`/api/${col}/:id`, wrap(async (req, res) => {
      const item = updateItem(col, req.params.id, req.body);
      if (!item) return res.status(404).json({ error: 'Não encontrado' });
      res.json(item);
    }));
    app.delete(`/api/${col}/:id`, wrap(async (req, res) => {
      removeItem(col, req.params.id);
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

    let aviso = null;
    if (req.body.notify) {
      try { await bot.sendItemToPlayer(ch, item, qty); }
      catch (e) { aviso = e.message; }
    }
    res.json({ inventory: ch.inventory, aviso });
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

  // Reenvia o item por DM, sem mexer na quantidade.
  app.post('/api/characters/:id/inventory/:itemId/notify', wrap(async (req, res) => {
    const ch = acharPersonagem(req.params.id);
    const item = getItem('items', req.params.itemId);
    if (!item) throw new Error('Item não encontrado no catálogo.');
    const linha = ch.inventory.find((l) => l.itemId === item.id);
    await bot.sendItemToPlayer(ch, item, linha?.qty ?? 1);
    res.json({ ok: true });
  }));

  // ---- Biblioteca de áudio ----
  app.get('/api/audio', wrap(async (req, res) => res.json(listItems('audio'))));
  app.post('/api/audio', upload.single('file'), wrap(async (req, res) => {
    const item = addItem('audio', {
      name: req.body.name || path.parse(req.file.originalname).name,
      filename: req.file.filename,
      type: req.body.type || 'sfx',
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

  // ---- Controles de som no Discord ----
  app.post('/api/sound/play/:id', wrap(async (req, res) => {
    const audio = getItem('audio', req.params.id);
    if (!audio) throw new Error('Áudio não encontrado.');
    if (audio.type === 'sfx') bot.playSfx(audio);
    else bot.playAmbient(audio);
    res.json({ ok: true });
  }));
  app.post('/api/sound/stop', wrap(async (req, res) => {
    bot.stopAll();
    res.json({ ok: true });
  }));
  app.post('/api/sound/volume', wrap(async (req, res) => {
    bot.setVolume(Number(req.body.volume));
    res.json({ ok: true });
  }));

  // ---- Cenas: ativação = posta no Discord + toca o som automaticamente ----
  app.post('/api/scenes/:id/activate', wrap(async (req, res) => {
    const scene = getItem('scenes', req.params.id);
    if (!scene) throw new Error('Cena não encontrada.');
    const db = getDb();
    db.activeSceneId = scene.id;
    save();

    const result = { posted: false, audio: null, warnings: [] };
    try {
      result.posted = await bot.postScene(scene);
      if (!result.posted) result.warnings.push('Defina o canal de texto nas configurações para postar a cena.');
    } catch (e) {
      result.warnings.push(`Falha ao postar no Discord: ${e.message}`);
    }

    const trackId = scene.ambientAudioId || scene.musicAudioId;
    if (trackId) {
      const audio = getItem('audio', trackId);
      if (audio) {
        try {
          if (!bot.isInVoice()) {
            result.warnings.push('O bot não está no canal de voz — use /entrar no Discord ou conecte pelo painel.');
          } else {
            bot.playAmbient(audio);
            result.audio = audio.name;
          }
        } catch (e) {
          result.warnings.push(e.message);
        }
      }
    }
    res.json(result);
  }));

  // ---- Discord ----
  app.get('/api/discord/channels', wrap(async (req, res) => res.json(await bot.listChannels())));
  app.post('/api/discord/join', wrap(async (req, res) => {
    const name = await bot.joinChannel(req.body.channelId);
    res.json({ ok: true, channel: name });
  }));
  app.post('/api/discord/leave', wrap(async (req, res) => {
    bot.leaveVoice();
    res.json({ ok: true });
  }));
  app.post('/api/discord/post', wrap(async (req, res) => {
    const reason = bot.postBlockedReason();
    if (reason) throw new Error(reason);
    const ok = await bot.postMessage(req.body.content);
    if (!ok) throw new Error('Não foi possível postar no Discord. Confira o canal de texto em ⚙️ Config.');
    res.json({ ok });
  }));

  // ---- Vozes de NPC (TTS) ----
  app.get('/api/tts/voices', wrap(async (req, res) => res.json(tts.VOICES)));
  app.post('/api/tts/speak', wrap(async (req, res) => {
    const { text, npcId, discord } = req.body;
    let voiceOpts = {};
    if (npcId) {
      const npc = getItem('characters', npcId);
      if (npc) voiceOpts = { voice: npc.ttsVoice || undefined, rate: npc.ttsRate || 0, pitch: npc.ttsPitch || 0 };
    }
    const result = await tts.synthesize(text, voiceOpts);
    let warning = null;
    if (discord) {
      try { bot.playFile(result.filePath, 1); } catch (e) { warning = e.message; }
    }
    res.json({ url: result.url, warning });
  }));

  // ---- Handouts ----
  app.post('/api/handout', wrap(async (req, res) => {
    const { target, title, content, imageUrl } = req.body;
    const result = await bot.sendHandout({
      toChannel: target === 'all',
      characterIds: target === 'all' ? [] : [target],
      title, content, imageUrl,
    });
    res.json(result);
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
    const result = bot.rollDice(req.body.expr);
    if (result.error) throw new Error(result.error);
    if (req.body.announce) {
      await bot.postMessage(`🎲 O Mestre rolou \`${req.body.expr}\`: ${result.detail} = **${result.total}**`).catch(() => {});
    }
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
    const { name, previewUrl, type, tags } = req.body;
    const host = new URL(previewUrl).hostname;
    if (!host.endsWith('freesound.org')) throw new Error('URL inválida.');
    const r = await fetch(`${previewUrl}${previewUrl.includes('?') ? '&' : '?'}token=${fsKey()}`);
    if (!r.ok) throw new Error(`Falha ao baixar o som (${r.status}).`);
    const filename = `${newId()}.mp3`;
    fs.writeFileSync(path.join(AUDIO_DIR, filename), Buffer.from(await r.arrayBuffer()));
    const item = addItem('audio', {
      name: name || 'Som do Freesound',
      filename,
      type: type || 'sfx',
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
    const dest = path.join(IMAGES_DIR, filename);
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
    fs.copyFileSync(origem, path.join(MAPS_DIR, filename));

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
    getDb().combat = req.body;
    save();
    broadcastTable(); // a mesa mostra de quem é o turno e os PV
    res.json(getDb().combat);
  }));
  app.post('/api/combat/announce', wrap(async (req, res) => {
    const reason = bot.postBlockedReason();
    if (reason) throw new Error(reason);
    const { combat } = getDb();
    if (!combat.entries.length) throw new Error('Não há combatentes na iniciativa para postar.');
    const lines = combat.entries
      .map((e, i) => {
        const conds = (e.conditions || []).length ? ` · _${e.conditions.join(', ')}_` : '';
        const down = e.hp <= 0 && e.maxHp ? ' ☠️' : '';
        return `${i === combat.turn ? '▶️' : '▫️'} **${e.init}** — ${e.name}${e.maxHp ? ` (${e.hp}/${e.maxHp} PV)` : ''}${down}${conds}`;
      })
      .join('\n');
    const ok = await bot.postMessage(`⚔️ **Iniciativa — Rodada ${combat.round}**\n${lines}`);
    if (!ok) throw new Error('Não foi possível postar a iniciativa no Discord.');
    res.json({ ok });
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

  // Cabine do Mestre: o navegador envia PCM (s16le 48kHz estéreo) já com efeitos
  const boothWss = new WebSocketServer({ noServer: true });
  boothWss.on('connection', (ws) => {
    ws.on('message', (data, isBinary) => {
      if (isBinary) { bot.boothPush(Buffer.from(data)); return; }
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'start') {
          try {
            bot.boothStart(msg.gain ?? 2);
            ws.send(JSON.stringify({ type: 'started' }));
          } catch (e) {
            ws.send(JSON.stringify({ type: 'error', error: e.message }));
          }
        } else if (msg.type === 'gain') {
          bot.boothSetGain(msg.gain);
        } else if (msg.type === 'stop') {
          bot.boothStop();
        }
      } catch { /* mensagem inválida, ignora */ }
    });
    ws.on('close', () => bot.boothStop());
  });

  // Um único despachante de upgrade: dois WebSocketServer presos ao mesmo servidor
  // HTTP recusariam o handshake um do outro.
  server.on('upgrade', (req, socket, head) => {
    const { pathname } = new URL(req.url, 'http://localhost');
    const target = pathname === '/mesa' ? mesaWss : pathname === '/booth' ? boothWss : null;
    if (!target) { socket.destroy(); return; }
    target.handleUpgrade(req, socket, head, (ws) => target.emit('connection', ws, req));
  });

  return app;
}
