// Hub de tempo real da mesa: o painel do Mestre publica, as telas dos jogadores escutam.
// Um único WebSocket em /mesa; cada cliente diz se é 'dm' ou 'player' ao conectar.
import { WebSocketServer } from 'ws';
import { getDb, save, getItem } from './store.js';

const clients = new Set(); // { ws, role }

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

function views() {
  const db = getDb();
  const map = db.battle.mapId ? getItem('maps', db.battle.mapId) : null;
  const showEnemyHp = Boolean(db.battle.showEnemyHp);
  const full = db.battle.tokens.map((t) => enrichToken(t, db));
  const isPc = (name) => full.some((t) => t.kind === 'pc' && (t.combatName || t.name) === name)
    || db.characters.some((c) => c.type === 'pc' && c.name === name);

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
        const base = { ...e, imageUrl: portraitOf(e.name, db) };
        return isPc(e.name) || showEnemyHp ? base : censorHp(base);
      }),
    },
    campaignName: db.settings.campaignName,
  };

  return { dm, player };
}

function send(ws, payload) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload));
}

// Reenvia o estado da mesa para todos — cada papel recebe a sua versão.
export function broadcastTable() {
  const { dm, player } = views();
  for (const c of clients) {
    send(c.ws, { type: 'table', ...(c.role === 'dm' ? dm : player) });
  }
}

// Eventos efêmeros (ping do Mestre no mapa) — não persistem no JSON.
function broadcastEvent(payload) {
  for (const c of clients) send(c.ws, payload);
}

// Devolve o WebSocketServer da mesa. Quem chama cuida do upgrade — o servidor HTTP
// tem mais de um endpoint WebSocket (/booth e /mesa) e eles precisam de um só despachante.
export function createMesaWss() {
  const wss = new WebSocketServer({ noServer: true });

  wss.on('connection', (ws) => {
    const client = { ws, role: 'player' };
    clients.add(client);

    ws.on('message', (data) => {
      let msg;
      try { msg = JSON.parse(data.toString()); } catch { return; }

      if (msg.type === 'hello') {
        client.role = msg.role === 'dm' ? 'dm' : 'player';
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
      }
    });

    ws.on('close', () => clients.delete(client));
    ws.on('error', () => clients.delete(client));
  });

  return wss;
}
