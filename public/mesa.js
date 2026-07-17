// Tela dos jogadores: só escuta o Mestre. Nada aqui altera a mesa.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const el = (id) => document.getElementById(id);

const bmap = new BattleMap(el('player-canvas'), { isDm: false });
let firstMapId = null;
let lastFocusKey = null;

// Centraliza a câmera no combatente do turno, para os jogadores acompanharem a ação.
function focusCurrentTurn(combat) {
  if (!combat?.entries?.length) { lastFocusKey = null; return; }
  const cur = combat.entries[combat.turn];
  if (!cur) return;
  const key = `${combat.round}:${combat.turn}`;
  if (key === lastFocusKey) return; // só reposiciona quando o turno realmente muda
  lastFocusKey = key;
  const tok = bmap.battle.tokens.find((t) => (t.combatName || t.name) === cur.name);
  if (tok) bmap.focusToken(tok, { smooth: true });
}

function setStatus(ok, msg) {
  el('player-dot').className = `dot ${ok ? 'on' : 'off'}`;
  el('player-status').textContent = msg;
}

function renderInitiative(combat) {
  const box = el('player-initiative');
  if (!combat?.entries?.length) {
    box.innerHTML = '<div class="empty">Sem combate.</div>';
    el('player-turn').textContent = 'Sem combate em andamento';
    return;
  }
  const cur = combat.entries[combat.turn];
  el('player-turn').innerHTML = `⚔️ Rodada ${combat.round} — vez de <b>${esc(cur?.name || '?')}</b>`;

  box.innerHTML = '<h3>Iniciativa</h3>' + combat.entries.map((e, i) => {
    const frac = hpFraction(e);
    const cor = frac > 0.5 ? '#4ade80' : frac > 0.25 ? '#c4a747' : '#e05252';
    const bar = frac === null ? ''
      : `<div class="hp-bar"><span style="width:${frac * 100}%; background:${cor}"></span></div>`;
    // PV exato para os personagens dos jogadores; para os inimigos, o estado que dá para
    // estimar olhando (o Mestre decide se libera os números).
    const vida = e.hp != null && e.maxHp > 0 ? `${esc(e.hp)}/${esc(e.maxHp)} PV`
      : e.hpLabel ? esc(e.hpLabel) : '';
    const conds = (e.conditions || []).map((c) =>
      `<span class="cond-chip" title="${esc(c)}">${esc(c)}</span>`).join('');
    const morto = frac === 0;

    return `<div class="init-row ${i === combat.turn ? 'current' : ''} ${morto ? 'downed' : ''}">
      <span class="init-num">${esc(e.init)}</span>
      ${e.imageUrl
        ? `<img class="init-avatar" src="${esc(e.imageUrl)}" alt="" onerror="this.style.visibility='hidden'" />`
        : '<span class="init-avatar placeholder"></span>'}
      <span class="init-name">
        <b>${esc(e.name)}</b>${morto ? ' ☠️' : ''}${e.concentration ? ' <span title="Concentrando em uma magia">🧠</span>' : ''}
        ${bar}
        ${vida ? `<small class="hp-text">${vida}</small>` : ''}
        ${conds ? `<div class="cond-list">${conds}</div>` : ''}
      </span>
    </div>`;
  }).join('');
}

function connect() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${proto}//${location.host}/mesa`);

  ws.onopen = () => {
    setStatus(true, 'ao vivo');
    ws.send(JSON.stringify({ type: 'hello', role: 'player' }));
  };
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === 'table') {
      el('player-campaign').textContent = msg.campaignName || 'Mesa';
      el('player-map').textContent = msg.map ? msg.map.name : '';
      bmap.setData({ map: msg.map, battle: msg.battle, combat: msg.combat });
      renderInitiative(msg.combat);
      // Enquadra sozinho quando o Mestre troca de mapa
      if (msg.map && msg.map.id !== firstMapId) {
        firstMapId = msg.map.id;
        lastFocusKey = null;
        bmap.fit();
      } else {
        // Segue o turno atual conforme o combate avança
        focusCurrentTurn(msg.combat);
      }
    } else if (msg.type === 'ping') {
      bmap.addPing(msg.col, msg.row);
    } else if (msg.type === 'fx' && msg.fx) {
      bmap.playFx(msg.fx);
    } else if (msg.type === 'aoe') {
      bmap.setAoe(msg.aoe || null);
    }
  };
  ws.onclose = () => {
    setStatus(false, 'reconectando...');
    setTimeout(connect, 2000);
  };
  ws.onerror = () => ws.close();
}

connect();
