// Hub de tempo real da mesa: o painel do Mestre publica, as telas dos jogadores escutam.
// Um único WebSocket em /mesa; cada cliente diz se é 'dm' ou 'player' ao conectar.
//
// No modo multi cada mesa é um "balde" separado (buckets), e um broadcast só alcança os
// clientes da mesma campanha — nada vaza de uma mesa pra outra. No self-hosted existe uma
// campanha só: todos caem no balde sentinela SINGLE e o comportamento é o de sempre.
import { WebSocketServer } from 'ws';
import { getDb, save, getItem, withCampaign, activeCampaignId } from './store.js';

// campaignId -> Set<client>. Chave SINGLE agrupa o self-hosted (sem campanha).
const SINGLE = '__single__';
const buckets = new Map();
const keyOf = (campaignId) => campaignId ?? SINGLE;
function bucket(key) {
  let s = buckets.get(key);
  if (!s) { s = new Set(); buckets.set(key, s); }
  return s;
}
// Roda fn no contexto da campanha (multi) ou direto (single). Deixa getDb()/save()
// mirarem a mesa certa dentro dos handlers de mensagem do WebSocket, que rodam fora
// do pipeline HTTP e por isso não herdam o withCampaign das rotas.
const inCampaign = (campaignId, fn) => (campaignId == null ? fn() : withCampaign(campaignId, fn));

// Estado do inimigo sem entregar o número: é o que a mesa enxerga olhando pra criatura.
export function hpLabel(pct) {
  if (pct == null) return '';
  if (pct <= 0) return 'Caído';
  if (pct <= 0.25) return 'Quase morto';
  if (pct <= 0.5) return 'Machucado';
  if (pct < 1) return 'Ferido';
  return 'Ileso';
}

// O token é a fonte da verdade visual: PV e condições vêm da iniciativa (quando ligado a ela),
// e o retrato, do personagem de mesmo nome, se o token não tiver um próprio.
function enrichToken(t, db) {
  const entry = db.combat.entries.find((e) => e.name === (t.combatName || t.name));
  const char = db.characters.find((c) => c.name === (t.charName || t.name));
  return {
    ...t,
    hp: entry ? entry.hp : t.hp,
    maxHp: entry ? entry.maxHp : t.maxHp,
    conditions: entry?.conditions || t.conditions || [],
    concentration: Boolean(entry?.concentration),
    imageUrl: t.imageUrl || char?.imageUrl || '',
  };
}

// Esconde os números de PV dos inimigos — o jogador recebe só a fração e o rótulo.
function censorHp(t) {
  const pct = t.maxHp > 0 ? Math.max(0, Math.min(1, (t.hp ?? 0) / t.maxHp)) : null;
  const { hp, maxHp, ...rest } = t;
  return { ...rest, hpPct: pct, hpLabel: hpLabel(pct) };
}

function portraitOf(name, db) {
  const t = db.battle.tokens.find((x) => (x.combatName || x.name) === name);
  const c = db.characters.find((x) => x.name === name);
  return t?.imageUrl || c?.imageUrl || '';
}

// Ficha "segura" pro jogador: só o que é público durante o jogo (pro HUD de turno) —
// nunca os segredos nem a voz/TTS (é coisa de NPC mesmo).
function publicSheet(c, db) {
  return {
    id: c.id,
    name: c.name,
    type: c.type,
    player: c.player || '',
    race: c.race,
    klass: c.klass,
    subclass: c.subclass,
    level: c.level,
    ac: c.ac,
    // PV do próprio grupo já é público na tela dos jogadores (os tokens de PC nunca
    // passam pelo censorHp) — esconder só na ficha seria incoerente.
    hp: c.hp,
    maxHp: c.maxHp,
    imageUrl: c.imageUrl || '',
    description: c.description || '',
    abilities: c.abilities || {},
    saveProf: c.saveProf || {},
    skillProf: c.skillProf || {},
    proficiencies: c.proficiencies || '',
    alignment: c.alignment || '',
    personalityTraits: c.personalityTraits || '',
    ideals: c.ideals || '',
    bonds: c.bonds || '',
    flaws: c.flaws || '',
    features: c.features || [],
    spells: c.spells || [],
    inventory: (c.inventory || []).map((l) => {
      const item = getItem('items', l.itemId);
      return item ? { itemId: l.itemId, qty: l.qty, name: item.name, description: item.description, rarity: item.rarity, type: item.type, imageUrl: item.imageUrl } : null;
    }).filter(Boolean),
  };
}

// Combatente escondido (token com 👁️ desligado) não deve nem aparecer na lista de
// iniciativa dos jogadores — hoje ele só era filtrado do mapa. Vira um "???" sem PV,
// retrato ou condições em vez de sumir da lista: sumir mudaria a posição de todo mundo
// depois dele e desalinharia o índice do turno, que aponta pra posição no array.
function redactEntry(e) {
  return {
    name: '???', init: e.init,
    hpPct: null, hpLabel: '', conditions: [], concentration: false, imageUrl: '',
  };
}

function views() {
  const db = getDb();
  const map = db.battle.mapId ? getItem('maps', db.battle.mapId) : null;
  const showEnemyHp = Boolean(db.battle.showEnemyHp);
  const full = db.battle.tokens.map((t) => enrichToken(t, db));
  const isPc = (name) => full.some((t) => t.kind === 'pc' && (t.combatName || t.name) === name)
    || db.characters.some((c) => c.type === 'pc' && c.name === name);
  const tokenFor = (name) => full.find((t) => (t.combatName || t.name) === name);

  const dm = {
    map,
    battle: { ...db.battle, tokens: full },
    combat: {
      ...db.combat,
      entries: db.combat.entries.map((e) => ({ ...e, imageUrl: portraitOf(e.name, db) })),
    },
    campaignName: db.settings.campaignName,
  };

  const player = {
    map,
    battle: {
      ...db.battle,
      tokens: full
        .filter((t) => !t.hidden)
        .map((t) => (t.kind === 'pc' || showEnemyHp ? t : censorHp(t))),
    },
    combat: {
      ...db.combat,
      entries: db.combat.entries.map((e) => {
        if (tokenFor(e.name)?.hidden) return redactEntry(e);
        const base = { ...e, imageUrl: portraitOf(e.name, db) };
        return isPc(e.name) || showEnemyHp ? base : censorHp(base);
      }),
    },
    characters: db.characters.filter((c) => c.type === 'pc').map((c) => publicSheet(c, db)),
    campaignName: db.settings.campaignName,
  };

  return { dm, player };
}

function send(ws, payload) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload));
}

// Reenvia o estado da mesa para todos os clientes DA MESMA campanha — cada papel recebe
// a sua versão. A campanha vem do contexto ativo (a rota HTTP já roda dentro dela; o
// handler de WebSocket é envolvido em inCampaign antes de chamar aqui).
export function broadcastTable(campaignId = activeCampaignId()) {
  const set = buckets.get(keyOf(campaignId));
  if (!set || !set.size) return;
  const { dm, player } = views();
  for (const c of set) {
    send(c.ws, { type: 'table', ...(c.role === 'dm' ? dm : player) });
  }
}

// Eventos efêmeros (ping do Mestre no mapa) — não persistem no JSON. Só para a campanha corrente.
function broadcastEvent(payload) {
  const set = buckets.get(keyOf(activeCampaignId()));
  if (set) for (const c of set) send(c.ws, payload);
}

// Devolve o WebSocketServer da mesa. Quem chama cuida do upgrade — o servidor HTTP
// tem mais de um endpoint WebSocket (/booth e /mesa) e eles precisam de um só despachante.
export function createMesaWss() {
  const wss = new WebSocketServer({ noServer: true });

  wss.on('connection', (ws, req) => {
    // Campanha resolvida no upgrade (null no self-hosted → balde SINGLE).
    const campaignId = req?.brpgCampaignId ?? null;
    const key = keyOf(campaignId);
    const client = { ws, role: 'player', campaignId };
    bucket(key).add(client);

    ws.on('message', (data) => inCampaign(campaignId, () => {
      let msg;
      try { msg = JSON.parse(data.toString()); } catch { return; }

      if (msg.type === 'hello') {
        const papelPedido = msg.role === 'dm' ? 'dm' : 'player';
        // O portal do jogador (req.brpgAuthRequired, ligado no upgrade de /portal-ws)
        // exige sessão de login válida — e só resolve pra "player", nunca "dm".
        if (req?.brpgAuthRequired && (!req.brpgPlayer || papelPedido === 'dm')) {
          ws.close(4001, 'not_authorized');
          return;
        }
        // No modo multi, o papel de Mestre por /mesa exige uma sessão de Mestre dona
        // desta campanha — senão qualquer um abriria o painel de mesa alheia. No
        // self-hosted (brpgDmRequiresMaster ausente) /mesa segue aberto, como sempre.
        if (papelPedido === 'dm' && req?.brpgDmRequiresMaster && !req?.brpgIsMaster) {
          ws.close(4001, 'not_authorized');
          return;
        }
        client.role = papelPedido;
        const v = views();
        send(ws, { type: 'table', ...(client.role === 'dm' ? v.dm : v.player) });
        return;
      }

      // Só o Mestre altera a mesa. As telas dos jogadores são somente leitura.
      if (client.role !== 'dm') return;

      if (msg.type === 'battle') {
        // Movimento de token e afins chegam por aqui, para o arrasto ser fluido.
        getDb().battle = { ...getDb().battle, ...msg.battle };
        save();
        broadcastTable();
      } else if (msg.type === 'map') {
        const map = getItem('maps', msg.map?.id);
        if (map) {
          Object.assign(map, msg.map);
          save();
          broadcastTable();
        }
      } else if (msg.type === 'ping') {
        broadcastEvent({ type: 'ping', col: msg.col, row: msg.row });
      } else if (msg.type === 'fx' && msg.fx) {
        // Efeito de combate efêmero — repassa para as telas dos jogadores.
        broadcastEvent({ type: 'fx', fx: msg.fx });
      } else if (msg.type === 'aoe') {
        // Área de efeito (o template) — repassa; null limpa nas telas.
        broadcastEvent({ type: 'aoe', aoe: msg.aoe || null });
      } else if (msg.type === 'diceRoll' && msg.dice) {
        // Rolagem 3D do Mestre — repassa os valores já sorteados pra todo mundo animar
        // o mesmo resultado (cada tela roda sua própria física, mas pousa nos mesmos números).
        broadcastEvent({ type: 'diceRoll', dice: msg.dice });
      }
    }));

    ws.on('close', () => bucket(key).delete(client));
    ws.on('error', () => bucket(key).delete(client));
  });

  return wss;
}
