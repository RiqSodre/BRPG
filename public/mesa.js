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

// ---------- HUD de turno: atributos + habilidades/magias/mochila de quem está jogando ----------
const ABILITIES = [
  { key: 'str', label: 'FOR' }, { key: 'dex', label: 'DES' }, { key: 'con', label: 'CON' },
  { key: 'int', label: 'INT' }, { key: 'wis', label: 'SAB' }, { key: 'cha', label: 'CAR' },
];
const abilityMod = (score) => Math.floor((Number(score) - 10) / 2);
const fmtSigned = (n) => (n >= 0 ? `+${n}` : `${n}`);
const ALIGNMENT_LABELS = {
  LB: 'Leal e Bom', NB: 'Neutro e Bom', CB: 'Caótico e Bom',
  LN: 'Leal e Neutro', N: 'Neutro', CN: 'Caótico e Neutro',
  LM: 'Leal e Mau', NM: 'Neutro e Mau', CM: 'Caótico e Mau',
};

let hudChar = null; // ficha pública (sem segredos) do personagem em foco no HUD
let hudTab = 'features';

function renderHudTab() {
  const list = el('turn-hud-list');
  if (!hudChar) { list.innerHTML = ''; return; }
  if (hudTab === 'features') {
    list.innerHTML = hudChar.features.length ? hudChar.features.map((f) => `
      <div class="hud-item">
        <div class="hud-item-name">${esc(f.name)}</div>
        <div class="hud-item-desc hidden">${esc(f.description || '').replace(/\n/g, '<br>') || '<i>Sem descrição.</i>'}</div>
      </div>`).join('') : '<div class="hud-empty">Nenhuma habilidade cadastrada.</div>';
    list.querySelectorAll('.hud-item').forEach((row) => row.onclick = () => row.querySelector('.hud-item-desc').classList.toggle('hidden'));
  } else if (hudTab === 'spells') {
    list.innerHTML = hudChar.spells.length ? hudChar.spells.map((s, i) => `
      <div class="hud-item" data-i="${i}">
        <div class="hud-item-name">${esc(s.name)} <span class="hud-item-tag">${s.level ? `Nv ${s.level}` : 'Truque'}</span></div>
      </div>`).join('') : '<div class="hud-empty">Nenhuma magia cadastrada.</div>';
    list.querySelectorAll('.hud-item').forEach((row) => row.onclick = () => openSpellPopup(hudChar.spells[Number(row.dataset.i)]));
  } else if (hudTab === 'inventory') {
    list.innerHTML = hudChar.inventory.length ? hudChar.inventory.map((l) => `
      <div class="hud-item">
        <div class="hud-item-name">${esc(l.name)} <span class="hud-item-tag">×${l.qty}</span></div>
        <div class="hud-item-desc hidden">${esc(l.description || '').replace(/\n/g, '<br>') || '<i>Sem descrição.</i>'}</div>
      </div>`).join('') : '<div class="hud-empty">Mochila vazia.</div>';
    list.querySelectorAll('.hud-item').forEach((row) => row.onclick = () => row.querySelector('.hud-item-desc').classList.toggle('hidden'));
  } else {
    const rows = [
      ['Traços de personalidade', hudChar.personalityTraits],
      ['Ideais', hudChar.ideals],
      ['Vínculos', hudChar.bonds],
      ['Defeitos', hudChar.flaws],
    ].filter(([, v]) => v);
    const alinhamento = hudChar.alignment
      ? `<div class="hud-item"><div class="hud-item-name">Alinhamento <span class="hud-item-tag">${esc(ALIGNMENT_LABELS[hudChar.alignment] || hudChar.alignment)}</span></div></div>` : '';
    list.innerHTML = alinhamento + (rows.length
      ? rows.map(([label, v]) => `
        <div class="hud-item">
          <div class="hud-item-name">${esc(label)}</div>
          <div class="hud-item-desc">${esc(v).replace(/\n/g, '<br>')}</div>
        </div>`).join('')
      : (alinhamento ? '' : '<div class="hud-empty">Nada cadastrado ainda.</div>'));
  }
}

function openSpellPopup(spell) {
  if (!spell) return;
  el('spell-popup-name').textContent = spell.name;
  el('spell-popup-desc').innerHTML = esc(spell.description || '').replace(/\n/g, '<br>') || '<i>Sem descrição.</i>';
  const img = el('spell-popup-img');
  if (spell.imageUrl) { img.src = spell.imageUrl; img.classList.remove('hidden'); } else { img.classList.add('hidden'); }
  el('spell-popup').classList.remove('hidden');
}

document.querySelectorAll('.turn-hud-tab').forEach((b) => b.onclick = () => {
  hudTab = b.dataset.hudTab;
  document.querySelectorAll('.turn-hud-tab').forEach((x) => x.classList.toggle('active', x === b));
  renderHudTab();
});
el('spell-popup-close').onclick = () => el('spell-popup').classList.add('hidden');
el('spell-popup').onclick = (e) => { if (e.target.id === 'spell-popup') el('spell-popup').classList.add('hidden'); };

// Só aparece quando é a vez de um personagem de jogador (o Mestre e os NPCs não têm ficha pública).
function updateTurnHud(combat, characters) {
  const hud = el('turn-hud');
  const cur = combat?.entries?.[combat.turn];
  const ch = cur ? (characters || []).find((c) => c.name === (cur.name)) : null;
  if (!ch) { hud.classList.add('hidden'); hudChar = null; return; }

  const mesmoPersonagem = hudChar?.id === ch.id;
  hudChar = ch;
  hud.classList.remove('hidden');
  if (!mesmoPersonagem) {
    hudTab = 'features';
    document.querySelectorAll('.turn-hud-tab').forEach((x) => x.classList.toggle('active', x.dataset.hudTab === 'features'));
  }
  const portrait = el('turn-hud-portrait');
  if (cur.imageUrl) { portrait.src = cur.imageUrl; portrait.style.visibility = 'visible'; } else { portrait.style.visibility = 'hidden'; }
  el('turn-hud-name').textContent = ch.name;
  el('turn-hud-sub').textContent = [ch.race, ch.klass, ch.level ? `nível ${ch.level}` : '', ch.ac ? `CA ${ch.ac}` : ''].filter(Boolean).join(' · ');
  el('turn-hud-abilities').innerHTML = ABILITIES.map((a) => {
    const score = Number(ch.abilities?.[a.key]) || 10;
    return `<div class="hud-abil"><span class="hud-abil-label">${a.label}</span><span class="hud-abil-val">${fmtSigned(abilityMod(score))}</span></div>`;
  }).join('');
  renderHudTab();
}

function renderInitiative(combat) {
  const box = el('player-init-list');
  if (!combat?.entries?.length) {
    box.innerHTML = '<div class="empty">Sem combate.</div>';
    el('player-turn').textContent = 'Sem combate em andamento';
    return;
  }
  const cur = combat.entries[combat.turn];
  el('player-turn').innerHTML = `<svg class="icon"><use href="#i-sword"/></svg> Rodada ${combat.round} — vez de <b>${esc(cur?.name || '?')}</b>`;

  box.innerHTML = '<h3>Iniciativa</h3>' + combat.entries.map((e, i) => {
    const frac = hpFraction(e);
    const cor = frac > 0.5 ? '#4a9d6f' : frac > 0.25 ? '#b8925a' : '#c05650';
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
        <b>${esc(e.name)}</b>${morto ? ' <svg class="icon"><use href="#i-skull"/></svg>' : ''}${e.concentration ? ' <span title="Concentrando em uma magia"><svg class="icon"><use href="#i-brain"/></svg></span>' : ''}
        ${bar}
        ${vida ? `<small class="hp-text">${vida}</small>` : ''}
        ${conds ? `<div class="cond-list">${conds}</div>` : ''}
      </span>
    </div>`;
  }).join('');
}

// ---------- Log de combate — só leitura, mesma fonte que o Mestre vê ----------
const fmtLogTime = (ts) => {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
let lastLogLen = 0;
function renderCombatLog(log) {
  const el2 = el('player-combat-log');
  if (!el2) return;
  log = log || [];
  if (!el2.dataset.built) {
    el2.dataset.built = '1';
    el2.innerHTML = `<div class="side-section-label"><span>Log de combate</span></div><div class="combat-log-list" id="player-combat-log-list"></div>`;
  }
  const list = el('player-combat-log-list');
  list.innerHTML = log.length
    ? log.map((l) => `<div class="combat-log-row"><span class="combat-log-time">R${l.round} · ${fmtLogTime(l.ts)}</span>${esc(l.text)}</div>`).join('')
    : '<div class="help-text" style="padding:6px 2px;">Nada registrado ainda.</div>';
  // Só rola pro fim quando chega linha nova — assim não atrapalha quem tá lendo pra cima.
  if (log.length !== lastLogLen) { list.scrollTop = list.scrollHeight; lastLogLen = log.length; }
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
      renderCombatLog(msg.combat?.log);
      updateTurnHud(msg.combat, msg.characters);
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
    } else if (msg.type === 'diceRoll' && msg.dice) {
      Dice3D.roll(msg.dice);
    }
  };
  ws.onclose = () => {
    setStatus(false, 'reconectando...');
    setTimeout(connect, 2000);
  };
  ws.onerror = () => ws.close();
}

connect();
