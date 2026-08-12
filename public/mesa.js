// Tela dos jogadores: só escuta o Mestre. Nada aqui altera a mesa.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const el = (id) => document.getElementById(id);

const bmap = new BattleMap(el('player-canvas'), { isDm: false });
let firstMapId = null;
let lastFocusKey = null;
let emCombate = false;
let ultimoCombate = null;

// Reenquadra do zero: na batalha em andamento, se houver; no mapa inteiro, se não.
function enquadrar({ smooth = true } = {}) {
  if (!focusCurrentTurn(ultimoCombate, { smooth })) bmap.fit();
}
// O canvas só ganha tamanho depois do primeiro layout — e muda de novo quando a janela
// muda. Nos dois casos o enquadramento anterior foi calculado com o tamanho errado.
bmap.onResize = () => { lastFocusKey = null; enquadrar({ smooth: false }); };

// Centraliza a câmera no combatente do turno, para os jogadores acompanharem a ação.
// Além de deslocar, entra no zoom de mesa: enquadrado no mapa inteiro, um token fica do
// tamanho de uma moeda e ninguém lê nome nem PV — e a tela dos jogadores não tem por que
// exigir que alguém mexa na roda do mouse pra enxergar o próprio turno.
function focusCurrentTurn(combat, { smooth = true } = {}) {
  if (!combat?.entries?.length) { lastFocusKey = null; return false; }
  const cur = combat.entries[combat.turn];
  if (!cur) return false;
  const key = `${combat.round}:${combat.turn}`;
  if (key === lastFocusKey) return true; // só reposiciona quando o turno realmente muda
  const tok = bmap.battle.tokens.find((t) => (t.combatName || t.name) === cur.name);
  if (!tok) return false; // combatente sem token no mapa (ou escondido): mantém o enquadramento
  lastFocusKey = key;
  bmap.focusToken(tok, { smooth, zoom: bmap.battleZoom() });
  return true;
}

function setStatus(ok, msg) {
  el('player-dot').className = `dot ${ok ? 'on' : 'off'}`;
  el('player-status').textContent = msg;
}

// ---------- HUD de turno: atributos + habilidades/magias/mochila de quem está jogando ----------
// ABILITIES, SKILLS e as contas do 5e vêm de sheet.js — as mesmas do painel do Mestre.

let party = []; // fichas públicas de todos os personagens de jogador
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
  } else if (hudTab === 'skills') {
    // Os totais já somados: no meio do turno ninguém quer somar modificador com
    // proficiência de cabeça. Bolinha cheia = treinado.
    const linha = (total, label, extra = '') =>
      `<div class="sheet-row${extra ? ' on' : ''}"><span class="dot"></span><span class="val">${fmtSigned(total)}</span> ${label}</div>`;
    list.innerHTML = `
      <div class="hud-sheet-title">Testes de resistência</div>
      ${ABILITIES.map((a) => linha(saveTotal(hudChar, a.key), a.label, hudChar.saveProf?.[a.key] ? 'on' : '')).join('')}
      <div class="hud-sheet-title" style="margin-top:10px;">Perícias</div>
      ${SKILLS.map((s) => linha(skillTotal(hudChar, s), `${esc(s.label)} <span class="abbr">(${abilLabel(s.ability)})</span>`, hudChar.skillProf?.[s.key] ? 'on' : '')).join('')}
      ${hudChar.proficiencies ? `
        <div class="hud-sheet-title" style="margin-top:10px;">Idiomas e outras proficiências</div>
        <div class="sheet-prof-text">${esc(hudChar.proficiencies).replace(/\n/g, '<br>')}</div>` : ''}`;
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

// Enquanto um overlay (carta de magia ou ficha) está aberto, o resto da tela sai do
// fluxo de foco — nem Tab nem leitor de tela devem passear pelo mapa atrás do modal.
const OVERLAYS = ['spell-popup', 'sheet-modal'];
let overlayTrigger = null;
function openOverlay(id, focusEl) {
  overlayTrigger = document.activeElement;
  el(id).classList.remove('hidden');
  document.querySelector('.player-bar')?.setAttribute('inert', '');
  document.querySelector('.player-stage')?.setAttribute('inert', '');
  focusEl?.focus();
}
function closeOverlay(id) {
  el(id).classList.add('hidden');
  if (OVERLAYS.every((x) => el(x).classList.contains('hidden'))) {
    document.querySelector('.player-bar')?.removeAttribute('inert');
    document.querySelector('.player-stage')?.removeAttribute('inert');
  }
  overlayTrigger?.focus?.();
  overlayTrigger = null;
}

function openSpellPopup(spell) {
  if (!spell) return;
  el('spell-popup-name').textContent = spell.name;
  el('spell-popup-meta').innerHTML = `<span class="spell-type">${esc(spellTypeLine(spell))}</span>`
    + SPELL_META.filter(([k]) => spell[k]).map(([k, label]) => `<span><b>${label}:</b> ${esc(spell[k])}</span>`).join('');
  el('spell-popup-desc').innerHTML = esc(spell.description || '').replace(/\n/g, '<br>') || '<i>Sem descrição.</i>';
  const img = el('spell-popup-img');
  if (spell.imageUrl) { img.src = spell.imageUrl; img.classList.remove('hidden'); } else { img.classList.add('hidden'); }
  openOverlay('spell-popup', el('spell-popup-close'));
}
const closeSpellPopup = () => closeOverlay('spell-popup');

// ---------- Ficha completa (a mesma que o Mestre vê, sem os segredos) ----------
let sheetOpenId = null;

function renderSheet() {
  const ch = party.find((c) => c.id === sheetOpenId);
  if (!ch) return;
  el('sheet-modal-name').textContent = `${ch.name} — Ficha`;
  el('sheet-modal-body').innerHTML = characterSheetHtml(ch, { inventory: true });
}

function openSheet(id) {
  sheetOpenId = id;
  renderSheet();
  el('sheet-modal-body').scrollTop = 0;
  openOverlay('sheet-modal', el('sheet-modal-close'));
}
function closeSheet() {
  sheetOpenId = null;
  closeOverlay('sheet-modal');
}

// Fichas do grupo na barra de cima: qualquer jogador abre a ficha completa de qualquer
// personagem a qualquer momento, sem depender de ser a vez dele.
function renderParty(characters) {
  party = characters || [];
  const bar = el('player-sheets');
  bar.innerHTML = party.map((c) => `
    <button class="party-chip" data-sheet="${esc(c.id)}" title="Ver a ficha de ${esc(c.name)}">
      ${c.imageUrl ? `<img src="${esc(c.imageUrl)}" alt="" />` : '<span class="party-chip-initial">' + esc((c.name || '?').trim().slice(0, 1).toUpperCase()) + '</span>'}
      ${esc(c.name)}
    </button>`).join('');
  bar.querySelectorAll('[data-sheet]').forEach((b) => b.onclick = () => openSheet(b.dataset.sheet));
  // A ficha aberta segue o estado da mesa (PV, itens que o Mestre acabou de entregar).
  if (sheetOpenId) {
    if (party.some((c) => c.id === sheetOpenId)) renderSheet(); else closeSheet();
  }
}

document.querySelectorAll('.turn-hud-tab').forEach((b) => b.onclick = () => {
  hudTab = b.dataset.hudTab;
  document.querySelectorAll('.turn-hud-tab').forEach((x) => x.classList.toggle('active', x === b));
  renderHudTab();
});
el('turn-hud-sheet').onclick = () => { if (hudChar) openSheet(hudChar.id); };
el('spell-popup-close').onclick = closeSpellPopup;
el('spell-popup').onclick = (e) => { if (e.target.id === 'spell-popup') closeSpellPopup(); };
el('sheet-modal-close').onclick = closeSheet;
el('sheet-modal').onclick = (e) => { if (e.target.id === 'sheet-modal') closeSheet(); };
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!el('spell-popup').classList.contains('hidden')) closeSpellPopup();
  else if (!el('sheet-modal').classList.contains('hidden')) closeSheet();
});

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
  el('turn-hud-sub').textContent = [ch.race, ch.klass, ch.subclass, ch.level ? `nível ${ch.level}` : ''].filter(Boolean).join(' · ');
  el('turn-hud-stats').innerHTML = [
    ['CA', ch.ac ?? '—'],
    ...(ch.maxHp != null ? [['PV', `${ch.hp ?? '?'}/${ch.maxHp}`]] : []),
    ['Inic.', fmtSigned(abilityMod(scoreOf(ch, 'dex')))],
    ['Prof.', fmtSigned(profBonus(ch.level))],
    ['Perc. pass.', passivePerception(ch)],
  ].map(([label, v]) => `<div class="hud-stat"><span>${esc(label)}</span><b>${esc(String(v))}</b></div>`).join('');
  el('turn-hud-abilities').innerHTML = ABILITIES.map((a) => {
    const score = scoreOf(ch, a.key);
    return `<div class="hud-abil">
      <span class="hud-abil-label">${a.label}</span>
      <span class="hud-abil-val">${fmtSigned(abilityMod(score))}</span>
      <span class="hud-abil-score">${score}</span>
    </div>`;
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
      renderParty(msg.characters);
      updateTurnHud(msg.combat, msg.characters);
      // Enquadra sozinho quando o Mestre troca de mapa: já entra na cena de batalha se
      // houver combate rolando, sem passar pelo mapa inteiro (o "de onde eu estou?"
      // vale no começo da cena, não no meio de um turno).
      ultimoCombate = msg.combat;
      const temCombate = Boolean(msg.combat?.entries?.length);
      if (msg.map && msg.map.id !== firstMapId) {
        firstMapId = msg.map.id;
        lastFocusKey = null;
        if (!focusCurrentTurn(msg.combat, { smooth: false })) bmap.fit();
      } else if (emCombate && !temCombate) {
        // Acabou o combate: volta pro mapa inteiro, em vez de deixar a câmera colada em
        // quem jogou por último.
        bmap.fit();
      } else {
        // Segue o turno atual conforme o combate avança
        focusCurrentTurn(msg.combat);
      }
      emCombate = temCombate;
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
