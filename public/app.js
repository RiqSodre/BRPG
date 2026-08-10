// Mesa do Mestre — lógica do painel
let state = null;
let chatHistory = [];
let ttsVoices = [];

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- API ----------
async function api(path, opts = {}) {
  const res = await fetch(`/api${path}`, {
    headers: opts.body instanceof FormData ? {} : { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body instanceof FormData ? opts.body : opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erro ${res.status}`);
  return data;
}

async function refresh() {
  state = await api('/state');
  renderAll();
}

function toast(msg, isError = false) {
  const el = $('#toast');
  el.textContent = msg;
  el.className = `toast${isError ? ' error' : ''}`;
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.add('hidden'), 4000);
}

const tryApi = async (fn, okMsg) => {
  try {
    const r = await fn();
    if (okMsg) toast(okMsg);
    return r;
  } catch (e) {
    toast(e.message, true);
    return null;
  }
};

// ---------- Modal ----------
// #modal fica com role="dialog"/aria-modal (ver index.html). Abrir/fechar sempre passa por
// estas duas funções pra manter foco, Escape e o "inert" do resto da página consistentes,
// mesmo com as várias funções *Modal() que montam o conteúdo e chamam openModalBackdrop()
// direto em vez de openModal().
let modalTrigger = null;
function openModalBackdrop() {
  modalTrigger = document.activeElement;
  $('#modal-backdrop').classList.remove('hidden');
  $('.sidebar')?.setAttribute('inert', '');
  $('.content')?.setAttribute('inert', '');
  const focusable = $('#modal').querySelector('input, textarea, select, button, a[href]');
  (focusable || $('#modal')).focus();
}
function closeModal() {
  $('#modal-backdrop').classList.add('hidden');
  $('.sidebar')?.removeAttribute('inert');
  $('.content')?.removeAttribute('inert');
  modalTrigger?.focus?.();
  modalTrigger = null;
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('#modal-backdrop').classList.contains('hidden')) closeModal();
});

function openModal(title, fieldsHtml, onSave, saveLabel = 'Salvar') {
  $('#modal').innerHTML = `
    <h3>${esc(title)}</h3>
    <form id="modal-form">${fieldsHtml}
      <div class="modal-actions">
        <button type="button" class="btn ghost" id="modal-cancel">Cancelar</button>
        <button type="submit" class="btn">${esc(saveLabel)}</button>
      </div>
    </form>`;
  openModalBackdrop();
  $('#modal-cancel').onclick = closeModal;
  $('#modal-form').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const data = Object.fromEntries(fd.entries());
    try {
      await onSave(data);
      closeModal();
      refresh();
    } catch (err) {
      toast(err.message || 'Erro ao salvar.', true);
    }
  };
}

const field = (label, name, value = '', type = 'text', placeholder = '') =>
  `<div class="field"><label>${esc(label)}</label><input name="${name}" type="${type}" value="${esc(value)}" placeholder="${esc(placeholder)}" /></div>`;
const fieldArea = (label, name, value = '', placeholder = '') =>
  `<div class="field"><label>${esc(label)}</label><textarea name="${name}" placeholder="${esc(placeholder)}">${esc(value)}</textarea></div>`;
const fieldSelect = (label, name, options, selected) =>
  `<div class="field"><label>${esc(label)}</label><select name="${name}">${options.map((o) =>
    `<option value="${esc(o.value)}" ${o.value === selected ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select></div>`;

// Editor de lista dinâmica (habilidades, magias...) dentro de um modal: cada linha tem
// nome + uma "tag" (fonte, pra habilidade; nível, pra magia) + descrição. O array
// (`list`) é a fonte da verdade pra estrutura (quantas linhas, em que ordem); o texto
// de cada campo é lido direto do DOM na hora de salvar, não fica sincronizado a cada
// tecla — evita perder o foco/cursor ao re-renderizar.
const listRowHtml = (item, kind) => `
  <div class="list-row">
    <div class="field-row">
      <input class="lr-name" placeholder="Nome" value="${esc(item.name || '')}" />
      ${kind === 'spell'
        ? `<input class="lr-level" type="number" min="0" max="9" placeholder="Nível (0=truque)" value="${item.level ?? ''}" />`
        : `<input class="lr-source" placeholder="Fonte (raça, classe...)" value="${esc(item.source || '')}" />`}
      <button type="button" class="btn small danger lr-remove" title="Remover"><svg class="icon"><use href="#i-x"/></svg></button>
    </div>
    <textarea class="lr-desc" placeholder="Descrição">${esc(item.description || '')}</textarea>
    ${kind === 'spell' ? `
    <div class="lr-image-row">
      ${item.imageUrl ? `<img class="lr-image-preview" src="${esc(item.imageUrl)}" alt="" />` : ''}
      <input type="text" class="lr-image-url" placeholder="URL da carta (opcional)" value="${esc(item.imageUrl || '')}" />
      <input type="file" class="lr-image-file" accept=".png,.jpg,.jpeg,.webp,.gif" title="ou escolha um arquivo" />
      ${item.imageUrl ? `<button type="button" class="btn small ghost lr-image-clear">Remover imagem</button>` : ''}
    </div>` : ''}
  </div>`;
// Uma habilidade/característica ou magia, na ficha somente-leitura: nome + uma tag
// (fonte, ou nível pra magia) + descrição.
const sheetFeatureHtml = (item, kind) => {
  const tag = kind === 'spell' ? (item.level ? `Nível ${item.level}` : 'Truque') : (item.source || '');
  const carta = kind === 'spell' && item.imageUrl
    ? `<a href="${esc(item.imageUrl)}" target="_blank" title="Ver carta em tamanho maior"><img class="sheet-feature-card" src="${esc(item.imageUrl)}" alt="Carta de ${esc(item.name)}" /></a>` : '';
  return `<div class="sheet-feature">${carta}<div class="sheet-feature-body"><b>${esc(item.name)}</b>${tag ? ` <span class="sheet-feature-tag">${esc(tag)}</span>` : ''}${item.description ? `<div class="sheet-feature-desc">${esc(item.description).replace(/\n/g, '<br>')}</div>` : ''}</div></div>`;
};
// Copia pro array o que já foi digitado nas linhas atuais — chamado sempre antes de
// mexer na estrutura (adicionar/remover), senão o re-render reconstrói a partir do
// array desatualizado e apaga o texto que ainda não tinha "voltado" pra ele.
function syncListRows(containerId, list, kind) {
  [...document.querySelectorAll(`#${containerId} .list-row`)].forEach((row, i) => {
    if (!list[i]) return;
    list[i].name = row.querySelector('.lr-name').value;
    list[i].description = row.querySelector('.lr-desc').value;
    if (kind === 'spell') {
      list[i].level = Number(row.querySelector('.lr-level').value) || 0;
      // O arquivo escolhido (ainda não enviado) não sobrevive a um re-render — só a
      // URL já salva é preservada. Enviar antes de mexer na estrutura evitaria isso,
      // mas complicaria demais um editor que já resolve a imagem só no salvar da ficha.
      list[i].imageUrl = row.querySelector('.lr-image-url')?.value || '';
    } else {
      list[i].source = row.querySelector('.lr-source').value;
    }
  });
}
function renderListRows(containerId, list, kind) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = list.length
    ? list.map((item) => listRowHtml(item, kind)).join('')
    : '<p class="help-text" style="margin:2px 0 6px;">Nada cadastrado ainda.</p>';
  el.querySelectorAll('.lr-remove').forEach((btn, i) => btn.onclick = () => {
    syncListRows(containerId, list, kind);
    list.splice(i, 1);
    renderListRows(containerId, list, kind);
  });
  const rows = [...el.querySelectorAll('.list-row')];
  el.querySelectorAll('.lr-image-clear').forEach((btn) => btn.onclick = () => {
    const i = rows.indexOf(btn.closest('.list-row'));
    syncListRows(containerId, list, kind);
    list[i].imageUrl = '';
    renderListRows(containerId, list, kind);
  });
}

// Campo de retrato: aceita arquivo do computador ou URL colada.
const fieldImage = (label, name, value = '') => `
  <div class="field">
    <label>${esc(label)}</label>
    <div class="row" style="align-items:center;">
      ${value ? `<img class="token-avatar" src="${esc(value)}" alt="" onerror="this.remove()" />` : ''}
      <input name="${name}" type="text" value="${esc(value)}" placeholder="cole uma URL ou escolha um arquivo →" style="flex:1;" />
      <input type="file" name="${name}File" accept=".png,.jpg,.jpeg,.webp,.gif" />
    </div>
  </div>`;

// Sobe o arquivo escolhido (se houver) e devolve a URL final do retrato.
async function resolveImage(name, data) {
  const file = $(`#modal-form [name="${name}File"]`)?.files?.[0];
  delete data[`${name}File`];
  if (!file) return data[name];
  const fd = new FormData();
  fd.append('file', file);
  const { url } = await api('/images', { method: 'POST', body: fd });
  return url;
}

const audioOptions = (type, selected) => [
  { value: '', label: '— nenhum —' },
  ...state.audio.filter((a) => !type || a.type === type).map((a) => ({ value: a.id, label: a.name })),
];

// ---------- Navegação ----------
$$('.nav-btn').forEach((btn) => {
  btn.onclick = () => {
    $$('.nav-btn').forEach((b) => b.classList.remove('active'));
    $$('.tab').forEach((t) => t.classList.remove('active'));
    btn.classList.add('active');
    $(`#tab-${btn.dataset.tab}`).classList.add('active');
    // O canvas só conhece seu tamanho quando a aba fica visível
    if (btn.dataset.tab === 'map' && bmap) {
      bmap.resize();
      if (!bmap.cam.fitted && bmap.map) { bmap.fit(); bmap.cam.fitted = true; }
    }
  };
});

function renderAll() {
  $('#campaign-name').textContent = state.settings.campaignName || 'Mesa do Mestre';
  $('#campaign-system').textContent = state.settings.system || '';
  renderBotStatus();
  renderScenes();
  renderStory();
  renderCharacters();
  renderItems();
  renderAudio();
  renderBoothTab();
  renderMapTab();
  renderBestiarioTab();
  renderSessions();
  renderAiTab();
  renderSettings();
  $('#volume').value = state.settings.volume ?? 0.4;
}

function renderBotStatus() {
  const b = state.bot;
  $('#bot-status').innerHTML = b.connected
    ? `<span class="dot on"></span> ${esc(b.tag)}${b.inVoice ? ' · <svg class="icon"><use href="#i-microphone"/></svg> em voz' : ''}`
    : '<span class="dot off"></span> Bot desconectado';
  $('#now-playing').innerHTML = b.nowPlaying
    ? `<svg class="icon"><use href="#i-music-notes"/></svg>Tocando: ${esc(b.nowPlaying.name)}`
    : '<svg class="icon"><use href="#i-speaker-slash"/></svg>Nenhum som tocando';
}

// ---------- Cenas ----------
function renderScenes() {
  const scenes = state.scenes;
  $('#tab-scenes').innerHTML = `
    <div class="tab-header">
      <h2><svg class="icon"><use href="#i-mask-happy"/></svg>Cenas</h2>
      <div class="actions"><button class="btn" id="btn-new-scene">+ Nova cena</button></div>
    </div>
    <p class="help-text">Ativar uma cena posta a descrição e a imagem no canal de texto do Discord e <b>toca o áudio dela automaticamente</b> no canal de voz.</p><br/>
    <div class="grid">${scenes.map((s) => {
      const amb = state.audio.find((a) => a.id === s.ambientAudioId);
      const mus = state.audio.find((a) => a.id === s.musicAudioId);
      const sfx = (s.sfxIds || []).map((id) => state.audio.find((a) => a.id === id)).filter(Boolean);
      return `
      <div class="card ${s.id === state.activeSceneId ? 'active-scene' : ''}">
        ${s.imageUrl ? `<img class="thumb" src="${esc(s.imageUrl)}" alt="" onerror="this.remove()" />` : ''}
        <h3>${s.id === state.activeSceneId ? '<svg class="icon" style="color:var(--accent2)"><use href="#i-star"/></svg> ' : ''}${esc(s.title)}</h3>
        <div class="desc">${esc(s.readAloud || '')}</div>
        <div>
          ${amb ? `<span class="badge gold"><svg class="icon"><use href="#i-cloud-fog"/></svg>${esc(amb.name)}</span>` : ''}
          ${mus ? `<span class="badge gold"><svg class="icon"><use href="#i-music-notes"/></svg>${esc(mus.name)}</span>` : ''}
        </div>
        ${sfx.length ? `<div class="row">${sfx.map((a) =>
          `<button class="btn small ghost" data-sfx="${a.id}" title="Tocar efeito no Discord"><svg class="icon"><use href="#i-waveform"/></svg>${esc(a.name)}</button>`).join('')}</div>` : ''}
        <div class="row">
          <button class="btn small gold" data-activate="${s.id}">▶ Ativar cena</button>
          <button class="btn small ghost" data-edit-scene="${s.id}">Editar</button>
          <button class="btn small ghost" data-suggest="${s.id}" title="A IA escolhe os sons da biblioteca para esta cena"><svg class="icon"><use href="#i-sparkle"/></svg>Sons IA</button>
          <button class="btn small danger" data-del-scene="${s.id}"><svg class="icon"><use href="#i-trash"/></svg></button>
        </div>
      </div>`;
    }).join('') || '<div class="empty">Nenhuma cena ainda. Crie a primeira!</div>'}</div>`;

  $('#btn-new-scene').onclick = () => sceneModal();
  $$('#tab-scenes [data-edit-scene]').forEach((b) => b.onclick = () => sceneModal(state.scenes.find((s) => s.id === b.dataset.editScene)));
  $$('#tab-scenes [data-del-scene]').forEach((b) => b.onclick = async () => {
    if (confirm('Excluir esta cena?')) { await api(`/scenes/${b.dataset.delScene}`, { method: 'DELETE' }); refresh(); }
  });
  $$('#tab-scenes [data-activate]').forEach((b) => b.onclick = async () => {
    const r = await tryApi(() => api(`/scenes/${b.dataset.activate}/activate`, { method: 'POST' }));
    if (r) {
      let msg = 'Cena ativada!';
      if (r.audio) msg += ` Tocando "${r.audio}".`;
      if (r.warnings?.length) msg += ` ${r.warnings.join(' ')}`;
      toast(msg, r.warnings?.length > 0 && !r.posted);
      refresh();
    }
  });
  $$('#tab-scenes [data-sfx]').forEach((b) => b.onclick = () =>
    tryApi(() => api(`/sound/play/${b.dataset.sfx}`, { method: 'POST' }), 'Efeito tocado!'));
  $$('#tab-scenes [data-suggest]').forEach((b) => b.onclick = async () => {
    b.disabled = true; b.textContent = 'Pensando...';
    const r = await tryApi(() => api(`/ai/suggest-audio/${b.dataset.suggest}`, { method: 'POST', body: { apply: true } }));
    if (r) { toast(`Sons aplicados à cena. ${r.reasoning || ''}`); refresh(); }
    else { b.disabled = false; b.textContent = 'Sons IA'; }
  });
}

function sceneModal(scene = {}) {
  openModal(scene.id ? 'Editar cena' : 'Nova cena', `
    ${field('Título', 'title', scene.title, 'text', 'A Taverna do Javali Dourado')}
    ${fieldArea('Texto de leitura (vai para o Discord ao ativar)', 'readAloud', scene.readAloud, 'O que os jogadores veem/ouvem/sentem...')}
    ${fieldArea('Notas do Mestre (privadas)', 'gmNotes', scene.gmNotes, 'Segredos, gatilhos, o que pode acontecer...')}
    ${field('URL da imagem (opcional)', 'imageUrl', scene.imageUrl, 'text', 'https://...')}
    <div class="field-row">
      ${fieldSelect('Som ambiente (loop automático)', 'ambientAudioId', audioOptions('ambient', scene.ambientAudioId), scene.ambientAudioId)}
      ${fieldSelect('Música', 'musicAudioId', audioOptions('music', scene.musicAudioId), scene.musicAudioId)}
    </div>
  `, async (data) => {
    if (scene.id) await api(`/scenes/${scene.id}`, { method: 'PUT', body: data });
    else await api('/scenes', { method: 'POST', body: { ...data, sfxIds: [] } });
  });
}

// ---------- História ----------
function renderStory() {
  $('#tab-story').innerHTML = `
    <div class="tab-header">
      <h2><svg class="icon"><use href="#i-scroll"/></svg>História & Lore</h2>
      <div class="actions"><button class="btn" id="btn-new-story">+ Nova anotação</button></div>
    </div>
    <div class="grid">${state.story.map((s) => `
      <div class="card">
        <h3>${esc(s.title)}</h3>
        <span class="badge purple">${esc(s.category || 'geral')}</span>
        <div class="desc">${esc(s.content || '')}</div>
        <div class="row">
          <button class="btn small ghost" data-edit-story="${s.id}">Editar</button>
          <button class="btn small danger" data-del-story="${s.id}"><svg class="icon"><use href="#i-trash"/></svg></button>
        </div>
      </div>`).join('') || '<div class="empty">Escreva aqui o mundo, as facções, os planos do vilão... A IA usa tudo isso como contexto.</div>'}</div>`;

  $('#btn-new-story').onclick = () => storyModal();
  $$('#tab-story [data-edit-story]').forEach((b) => b.onclick = () => storyModal(state.story.find((s) => s.id === b.dataset.editStory)));
  $$('#tab-story [data-del-story]').forEach((b) => b.onclick = async () => {
    if (confirm('Excluir esta anotação?')) { await api(`/story/${b.dataset.delStory}`, { method: 'DELETE' }); refresh(); }
  });
}

function storyModal(s = {}) {
  openModal(s.id ? 'Editar anotação' : 'Nova anotação', `
    ${field('Título', 'title', s.title, 'text', 'O Culto da Chama Negra')}
    ${field('Categoria', 'category', s.category, 'text', 'vilões, lugares, facções, trama...')}
    ${fieldArea('Conteúdo', 'content', s.content)}
  `, async (data) => {
    if (s.id) await api(`/story/${s.id}`, { method: 'PUT', body: data });
    else await api('/story', { method: 'POST', body: data });
  });
}

// ---------- Personagens ----------
function renderCharacters() {
  const chars = state.characters;
  const NPC_TYPES = {
    inimigo:   { icon: 'skull',      text: 'Inimigo',   color: 'var(--danger)' },
    quest:     { icon: 'scroll',     text: 'Quest',      color: 'var(--accent2)' },
    aleatorio: { icon: 'dice-six',   text: 'Aleatório',  color: 'var(--muted)' },
    npc:       { icon: 'mask-happy', text: 'NPC',        color: '#b79cff' },
  };
  const npcLabel = (tipo) => `<svg class="icon"><use href="#i-${tipo.icon}"/></svg>${tipo.text}`;

  const npcCard = (c) => {
    const tipo = NPC_TYPES[c.npcType] || NPC_TYPES.npc;
    return `
      <div class="card">
        ${c.imageUrl ? `<img class="thumb" src="${esc(c.imageUrl)}" alt="" onerror="this.remove()" />` : ''}
        <h3>${esc(c.name)}</h3>
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
          <span class="badge" style="color:${tipo.color};border-color:${tipo.color}20;">${npcLabel(tipo)}</span>
          <span class="badge purple">${esc([c.race, c.klass, c.level ? `nv.${c.level}` : ''].filter(Boolean).join(' · '))}</span>
        </div>
        ${c.ac || c.maxHp ? `<div class="meta"><svg class="icon"><use href="#i-shield"/></svg> CA ${esc(c.ac ?? '?')} · <svg class="icon"><use href="#i-heart-straight"/></svg> ${esc(c.hp ?? '?')}/${esc(c.maxHp ?? '?')} PV</div>` : ''}
        <div class="desc">${esc(c.description || '')}</div>
        <div class="row">
          <button class="btn small gold" data-improv="${c.id}"><svg class="icon"><use href="#i-mask-happy"/></svg>Improvisar</button>
          <button class="btn small" data-speak="${c.id}"><svg class="icon"><use href="#i-chat-circle-text"/></svg>Falar</button>
          <button class="btn small ghost" data-embody="${c.id}"><svg class="icon"><use href="#i-microphone"/></svg>Encarnar</button>
          <button class="btn small ghost" data-inv="${c.id}" title="Mochila deste NPC"><svg class="icon"><use href="#i-backpack"/></svg>${(c.inventory || []).length ? ` ${c.inventory.length}` : ''}</button>
          <button class="btn small ghost" data-sheet-char="${c.id}" title="Ver ficha"><svg class="icon"><use href="#i-clipboard-text"/></svg></button>
          <button class="btn small ghost" data-edit-char="${c.id}"><svg class="icon"><use href="#i-pencil-simple"/></svg></button>
          <button class="btn small danger" data-del-char="${c.id}"><svg class="icon"><use href="#i-trash"/></svg></button>
        </div>
      </div>`;
  };

  const pcCard = (c) => `
    <div class="card">
      ${c.imageUrl ? `<img class="thumb" src="${esc(c.imageUrl)}" alt="" onerror="this.remove()" />` : ''}
      <h3>${esc(c.name)}</h3>
      <div class="meta">${[esc([c.race, c.klass, c.level ? `nível ${c.level}` : ''].filter(Boolean).join(' · ')), c.player ? `<svg class="icon"><use href="#i-game-controller"/></svg>${esc(c.player)}` : ''].filter(Boolean).join(' · ')}</div>
      ${c.discordUserId
        ? `<button type="button" class="badge gold badge-btn" data-unlink-discord="${c.id}" title="Clique para desvincular do Discord"><svg class="icon"><use href="#i-link"/></svg>Discord: ${esc(c.discordTag || 'vinculado')}<svg class="icon"><use href="#i-x"/></svg></button>`
        : '<span class="badge" title="O jogador usa /vincular no Discord"><svg class="icon"><use href="#i-link-break"/></svg>sem vínculo</span>'}
      ${c.ac || c.maxHp ? `<div class="meta"><svg class="icon"><use href="#i-shield"/></svg> CA ${esc(c.ac ?? '?')} · <svg class="icon"><use href="#i-heart-straight"/></svg> ${esc(c.hp ?? '?')}/${esc(c.maxHp ?? '?')} PV</div>` : ''}
      <div class="desc">${esc(c.description || '')}</div>
      <div class="row">
        <button class="btn small gold" data-inv="${c.id}" title="Abrir a mochila e entregar itens"><svg class="icon"><use href="#i-backpack"/></svg>Mochila${(c.inventory || []).length ? ` (${c.inventory.length})` : ''}</button>
        <button class="btn small ghost" data-sheet-char="${c.id}" title="Ver ficha"><svg class="icon"><use href="#i-clipboard-text"/></svg>Ficha</button>
        <button class="btn small ghost" data-edit-char="${c.id}"><svg class="icon"><use href="#i-pencil-simple"/></svg>Editar</button>
        <button class="btn small danger" data-del-char="${c.id}"><svg class="icon"><use href="#i-trash"/></svg></button>
      </div>
    </div>`;

  // Filtragem de NPCs por tipo
  const npcFilter = $('#npc-filter-active') || null;
  const activeFilter = npcFilter?.value || 'todos';
  const pcs = chars.filter((c) => c.type === 'pc');
  const npcs = chars.filter((c) => c.type === 'npc');
  const npcGroups = [
    { key: 'inimigo',   npcs: npcs.filter((c) => c.npcType === 'inimigo') },
    { key: 'quest',     npcs: npcs.filter((c) => c.npcType === 'quest') },
    { key: 'aleatorio', npcs: npcs.filter((c) => c.npcType === 'aleatorio') },
    { key: 'npc',       npcs: npcs.filter((c) => !c.npcType || c.npcType === 'npc') },
  ].filter((g) => g.npcs.length);

  $('#tab-characters').innerHTML = `
    <div class="tab-header">
      <h2><svg class="icon"><use href="#i-users"/></svg>Personagens</h2>
      <div class="actions">
        <button class="btn ghost" id="btn-handout"><svg class="icon"><use href="#i-envelope-simple"/></svg>Handout</button>
        <button class="btn" id="btn-new-pc">+ Jogador</button>
        <button class="btn gold" id="btn-new-npc">+ NPC</button>
      </div>
    </div>
    <h2 style="margin:14px 0 10px;color:var(--accent2);font-size:17px;display:flex;align-items:center;gap:8px;"><svg class="icon"><use href="#i-game-controller"/></svg>Personagens dos Jogadores</h2>
    <div class="grid">${pcs.map(pcCard).join('') || '<div class="empty">Nenhum jogador ainda.</div>'}</div>
    <div style="display:flex;align-items:center;gap:10px;margin:20px 0 10px;">
      <h2 style="color:var(--accent2);font-size:17px;margin:0;display:flex;align-items:center;gap:8px;"><svg class="icon"><use href="#i-mask-happy"/></svg>NPCs</h2>
      <div style="display:flex;gap:4px;flex-wrap:wrap;">
        ${Object.entries(NPC_TYPES).map(([k, v]) =>
          `<button class="btn small ghost npc-type-filter" data-ntype="${k}" style="font-size:12px;">${npcLabel(v)}</button>`).join('')}
      </div>
    </div>
    ${npcGroups.map((g) => `
      <div class="npc-group" data-group="${g.key}">
        <div style="font-size:12px;font-weight:700;letter-spacing:0.06em;color:${NPC_TYPES[g.key].color};margin:10px 0 6px;opacity:0.8;display:flex;align-items:center;gap:6px;">
          <svg class="icon"><use href="#i-${NPC_TYPES[g.key].icon}"/></svg>${NPC_TYPES[g.key].text.toUpperCase()} (${g.npcs.length})
        </div>
        <div class="grid">${g.npcs.map(npcCard).join('')}</div>
      </div>`).join('') || '<div class="empty">Nenhum NPC ainda.</div>'}`;

  // Filtro por tipo: clique no label mostra/oculta aquele grupo
  $$('#tab-characters .npc-type-filter').forEach((btn) => btn.onclick = () => {
    const key = btn.dataset.ntype;
    const group = $(`#tab-characters [data-group="${key}"]`);
    if (!group) return;
    const hidden = group.style.display === 'none';
    group.style.display = hidden ? '' : 'none';
    btn.classList.toggle('active', hidden);
  });

  $('#btn-new-pc').onclick = () => charModal({ type: 'pc' });
  $('#btn-new-npc').onclick = () => charModal({ type: 'npc' });
  $('#btn-handout').onclick = () => handoutModal();
  $$('#tab-characters [data-edit-char]').forEach((b) => b.onclick = () => charModal(chars.find((c) => c.id === b.dataset.editChar)));
  $$('#tab-characters [data-sheet-char]').forEach((b) => b.onclick = () => characterSheetModal(chars.find((c) => c.id === b.dataset.sheetChar)));
  $$('#tab-characters [data-del-char]').forEach((b) => b.onclick = async () => {
    if (confirm('Excluir este personagem?')) { await api(`/characters/${b.dataset.delChar}`, { method: 'DELETE' }); refresh(); }
  });
  $$('#tab-characters [data-inv]').forEach((b) => b.onclick = () => inventoryModal(chars.find((c) => c.id === b.dataset.inv)));
  $$('#tab-characters [data-unlink-discord]').forEach((b) => b.onclick = async () => {
    const ch = chars.find((c) => c.id === b.dataset.unlinkDiscord);
    if (!confirm(`Desvincular o Discord de ${ch?.name}? O jogador precisará usar /vincular de novo.`)) return;
    const r = await tryApi(() => api(`/characters/${b.dataset.unlinkDiscord}`, { method: 'PUT', body: { discordUserId: null, discordTag: null } }), 'Vínculo com o Discord removido.');
    if (r) refresh();
  });
  $$('#tab-characters [data-improv]').forEach((b) => b.onclick = () => improvModal(chars.find((c) => c.id === b.dataset.improv)));
  $$('#tab-characters [data-speak]').forEach((b) => b.onclick = () => speakModal(chars.find((c) => c.id === b.dataset.speak)));
  $$('#tab-characters [data-embody]').forEach((b) => b.onclick = () => {
    const npc = chars.find((c) => c.id === b.dataset.embody);
    $('.nav-btn[data-tab="booth"]').click();
    $('#booth-npc').value = npc.id;
    boothLoadPreset(npc);
  });
}

// ---------- Itens: catálogo + mochila ----------
const RARIDADES = ['Comum', 'Incomum', 'Raro', 'Muito raro', 'Lendário', 'Artefato'];
const TIPOS_ITEM = ['Arma', 'Armadura', 'Poção', 'Pergaminho', 'Anel', 'Varinha', 'Maravilhoso', 'Tesouro', 'Equipamento', 'Outro'];
// Mesmas cores do embed do Discord — a linguagem de loot que os jogadores já conhecem.
const RARIDADE_COR = {
  'Comum': '#9d9d9d', 'Incomum': '#1eff00', 'Raro': '#0070dd',
  'Muito raro': '#a335ee', 'Lendário': '#ff8000', 'Artefato': '#e6cc80',
};
const corDaRaridade = (r) => RARIDADE_COR[r] || '#9d9d9d';

// Quem tem esse item na mochila (para mostrar e permitir tirar direto do catálogo)
const donosDoItem = (itemId) => state.characters
  .filter((c) => (c.inventory || []).some((l) => l.itemId === itemId))
  .map((c) => ({ id: c.id, nome: c.name, qty: (c.inventory.find((l) => l.itemId === itemId) || {}).qty }));

// Chip de vínculo com o X para tirar o item daquele personagem.
const chipVinculo = (charId, charNome, item, qty) => {
  const cor = corDaRaridade(item.rarity);
  return `<span class="inv-chip" style="border-color:${cor}55;">
    <span style="color:${cor};">${esc(item.name)}</span>
    <b>${qty}×</b>
    <button class="inv-chip-x" data-take="${charId}|${item.id}" title="Tirar de ${esc(charNome)}"><svg class="icon"><use href="#i-x"/></svg></button>
  </span>`;
};

// Tira um item da mochila de um personagem (usado nas duas visões).
function ligarBotoesTirar(escopo) {
  $$(`${escopo} [data-take]`).forEach((b) => b.onclick = async () => {
    const [charId, itemId] = b.dataset.take.split('|');
    const ch = state.characters.find((c) => c.id === charId);
    const it = (state.items || []).find((i) => i.id === itemId);
    if (!confirm(`Tirar "${it?.name}" da mochila de ${ch?.name}?`)) return;
    await tryApi(() => api(`/characters/${charId}/inventory/${itemId}`, { method: 'DELETE' }),
      `${it?.name} removido de ${ch?.name}.`);
    refresh();
  });
}

function renderItems() {
  const itens = state.items || [];
  const comMochila = state.characters.filter((c) => (c.inventory || []).some((l) => itens.some((i) => i.id === l.itemId)));
  const totalEntregue = state.characters.reduce((soma, c) =>
    soma + (c.inventory || []).reduce((s, l) => s + (itens.some((i) => i.id === l.itemId) ? l.qty : 0), 0), 0);

  $('#tab-items').innerHTML = `
    <div class="tab-header">
      <h2><svg class="icon"><use href="#i-backpack"/></svg>Itens</h2>
      <div class="actions"><button class="btn gold" id="btn-new-item">+ Novo item</button></div>
    </div>
    <p class="help-text">Crie o item uma vez aqui e entregue a quantos personagens quiser. Ao entregar, o jogador recebe um card do item por DM no Discord — e pode consultar a mochila a qualquer momento com <code>/inventario</code>.</p>

    <div class="settings-section" style="margin-top:14px;">
      <h3 style="display:flex;align-items:center;gap:8px;"><svg class="icon"><use href="#i-link"/></svg>Quem está com o quê</h3>
      <p class="help-text">Visão de todas as mochilas. Clique no <b>X</b> de um item para tirá-lo daquele personagem.</p>
      <div style="margin-top:10px;">
        ${comMochila.length ? comMochila.map((c) => `
          <div class="inv-owner-row">
            <span class="inv-owner-name">
              <svg class="icon"><use href="#i-${c.type === 'pc' ? 'game-controller' : 'mask-happy'}"/></svg> <b>${esc(c.name)}</b>
              ${c.type === 'pc' ? (c.discordUserId
                ? `<span class="badge gold" title="Recebe itens por DM e pode usar /inventario"><svg class="icon"><use href="#i-link"/></svg>${esc(c.discordTag || 'vinculado')}</span>`
                : '<span class="badge" title="O jogador precisa usar /vincular no Discord"><svg class="icon"><use href="#i-link-break"/></svg>sem vínculo</span>') : ''}
            </span>
            <div class="inv-chips">
              ${(c.inventory || []).map((l) => {
                const it = itens.find((i) => i.id === l.itemId);
                return it ? chipVinculo(c.id, c.name, it, l.qty) : '';
              }).join('')}
            </div>
            <button class="btn small ghost" data-open-bag="${c.id}" title="Abrir a mochila completa">Abrir</button>
          </div>`).join('')
          : '<div class="empty">Ninguém está com itens ainda. Use Entregar num item abaixo.</div>'}
      </div>
      ${totalEntregue ? `<p class="help-text" style="margin-top:8px;">${totalEntregue} item(ns) entregue(s) entre ${comMochila.length} personagem(ns).</p>` : ''}
    </div>

    <h2 style="margin:20px 0 10px;color:var(--accent2);font-size:17px;display:flex;align-items:center;gap:8px;"><svg class="icon"><use href="#i-package"/></svg>Catálogo</h2>
    <div class="grid">${itens.map((it) => {
      const cor = corDaRaridade(it.rarity);
      const donos = donosDoItem(it.id);
      return `
      <div class="card item-card" style="border-left:3px solid ${cor};">
        ${it.imageUrl ? `<img class="thumb" src="${esc(it.imageUrl)}" alt="" onerror="this.remove()" />` : ''}
        <h3>${esc(it.name)}</h3>
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
          ${it.rarity ? `<span class="badge" style="color:${cor};border-color:${cor}40;">${esc(it.rarity)}</span>` : ''}
          ${it.type ? `<span class="badge purple">${esc(it.type)}</span>` : ''}
        </div>
        <div class="desc">${esc(it.description || '')}</div>
        ${donos.length
          ? `<div class="inv-chips" style="margin-top:8px;">${donos.map((d) => `
              <span class="inv-chip" title="${esc(d.nome)} está com ${d.qty}">
                ${esc(d.nome)} <b>${d.qty}×</b>
                <button class="inv-chip-x" data-take="${d.id}|${it.id}" title="Tirar de ${esc(d.nome)}"><svg class="icon"><use href="#i-x"/></svg></button>
              </span>`).join('')}</div>`
          : '<div class="meta" style="opacity:0.55;">Ninguém está com este item.</div>'}
        <div class="row">
          <button class="btn small gold" data-give="${it.id}"><svg class="icon"><use href="#i-gift"/></svg>Entregar</button>
          <button class="btn small ghost" data-edit-item="${it.id}"><svg class="icon"><use href="#i-pencil-simple"/></svg></button>
          <button class="btn small danger" data-del-item="${it.id}"><svg class="icon"><use href="#i-trash"/></svg></button>
        </div>
      </div>`;
    }).join('') || '<div class="empty">Nenhum item ainda. Crie o primeiro — uma poção, uma espada, um bilhete...</div>'}</div>`;

  $('#btn-new-item').onclick = () => itemModal();
  $$('#tab-items [data-edit-item]').forEach((b) => b.onclick = () => itemModal(itens.find((x) => x.id === b.dataset.editItem)));
  $$('#tab-items [data-del-item]').forEach((b) => b.onclick = async () => {
    if (!confirm('Excluir este item do catálogo? Ele some das mochilas de todo mundo também.')) return;
    await tryApi(() => api(`/items/${b.dataset.delItem}`, { method: 'DELETE' }), 'Item excluído.');
    refresh();
  });
  $$('#tab-items [data-give]').forEach((b) => b.onclick = () => giveItemModal(itens.find((x) => x.id === b.dataset.give)));
  $$('#tab-items [data-open-bag]').forEach((b) => b.onclick = () => inventoryModal(state.characters.find((c) => c.id === b.dataset.openBag)));
  ligarBotoesTirar('#tab-items');
}

function itemModal(it = {}) {
  openModal(it.id ? `Editar ${esc(it.name)}` : 'Novo item', `
    ${field('Nome', 'name', it.name, 'text', 'Poção de Cura Maior')}
    <div class="field-row">
      ${fieldSelect('Raridade', 'rarity', RARIDADES.map((r) => ({ value: r, label: r })), it.rarity || 'Comum')}
      ${fieldSelect('Tipo', 'type', TIPOS_ITEM.map((t) => ({ value: t, label: t })), it.type || 'Outro')}
    </div>
    ${fieldArea('Descrição (o jogador vê isso no Discord)', 'description', it.description, 'Recupera 4d4+4 pontos de vida ao beber...')}
    ${fieldImage('Imagem do item', 'imageUrl', it.imageUrl ?? '')}
  `, async (data) => {
    data.imageUrl = await resolveImage('imageUrl', data);
    if (it.id) await api(`/items/${it.id}`, { method: 'PUT', body: data });
    else await api('/items', { method: 'POST', body: data });
    toast(it.id ? 'Item atualizado.' : 'Item criado no catálogo.');
  });
}

// Entrega um item a um personagem, avisando o jogador por DM se estiver vinculado.
function giveItemModal(it) {
  if (!it) return;
  const pcs = state.characters.filter((c) => c.type === 'pc');
  const npcs = state.characters.filter((c) => c.type === 'npc');
  if (!pcs.length && !npcs.length) return toast('Crie um personagem primeiro.', true);
  const opts = [
    ...pcs.map((c) => ({ value: c.id, label: `${c.name}${c.discordUserId ? '' : ' (sem vínculo no Discord)'}` })),
    ...npcs.map((c) => ({ value: c.id, label: c.name })),
  ];
  openModal(`Entregar ${esc(it.name)}`, `
    ${fieldSelect('Para quem', 'charId', opts, opts[0].value)}
    <div class="field">
      <label>Quantidade</label>
      <input name="qty" type="number" min="1" step="1" value="1" />
    </div>
    <label class="tool-check" style="margin:8px 0;">
      <input type="checkbox" name="notify" checked /> Avisar o jogador por DM no Discord (card do item)
    </label>
    <p class="help-text">Sem vínculo no Discord, o item entra na mochila mesmo assim — o jogador só não recebe o aviso. Ele vincula com <code>/vincular</code>. Para <b>tirar</b> itens, use o X na mochila.</p>
  `, async (data) => {
    const notify = $('#modal-form [name="notify"]').checked;
    // Lança em vez de "corrigir": o modal fica aberto mostrando o motivo,
    // e o Mestre não recebe o oposto do que pediu.
    const qty = Math.floor(Number(data.qty));
    if (!Number.isFinite(qty) || qty < 1) {
      throw new Error('A quantidade precisa ser um número inteiro de 1 para cima. Para tirar itens, use o X na mochila.');
    }
    const r = await api(`/characters/${data.charId}/inventory`, {
      method: 'POST',
      body: { itemId: it.id, qty, notify },
    });
    const quem = state.characters.find((c) => c.id === data.charId)?.name || 'personagem';
    if (r.aviso) toast(`${it.name} foi para a mochila de ${quem}, mas o DM falhou: ${r.aviso}`, true);
    else toast(`${it.name} entregue a ${quem}${notify ? ' e avisado no Discord!' : '.'}`);
  }, 'Entregar');
}

// Mochila de um personagem: quantidades, reenvio do card e remoção.
function inventoryModal(ch) {
  const inv = (ch.inventory || []).map((l) => ({ ...l, item: (state.items || []).find((i) => i.id === l.itemId) }))
    .filter((l) => l.item);

  $('#modal').innerHTML = `
    <h3 style="display:flex;align-items:center;gap:8px;"><svg class="icon"><use href="#i-backpack"/></svg>Mochila de ${esc(ch.name)}</h3>
    ${ch.discordUserId
      ? `<p class="help-text"><svg class="icon"><use href="#i-link"/></svg> Vinculado a <b>${esc(ch.discordTag || 'jogador')}</b> — ele pode ver isso com <code>/inventario</code>.</p>`
      : '<p class="help-text"><svg class="icon"><use href="#i-link-break"/></svg> Sem vínculo no Discord — o jogador precisa usar <code>/vincular</code> para receber itens e consultar a mochila.</p>'}
    <div id="inv-list" style="max-height:340px;overflow-y:auto;margin:10px 0;">
      ${inv.length ? inv.map((l) => {
        const cor = corDaRaridade(l.item.rarity);
        return `
        <div class="srd-result-row" style="border-left:3px solid ${cor};padding-left:8px;">
          ${l.item.imageUrl
            ? `<img class="cp-thumb" src="${esc(l.item.imageUrl)}" alt="" onerror="this.remove()" />`
            : '<span class="cp-thumb placeholder"><svg class="icon"><use href="#i-backpack"/></svg></span>'}
          <span>
            ${esc(l.item.name)}
            <small style="color:${cor};"> ${esc(l.item.rarity || '')}</small>
          </span>
          <input class="input inv-qty" type="number" min="0" value="${l.qty}" data-inv-qty="${l.itemId}" style="width:56px;text-align:center;" title="Quantidade (0 remove)" />
          <button class="btn small ghost" data-inv-send="${l.itemId}" title="Reenviar o card deste item por DM"><svg class="icon"><use href="#i-envelope-simple"/></svg></button>
          <button class="btn small danger" data-inv-del="${l.itemId}" title="Tirar da mochila"><svg class="icon"><use href="#i-trash"/></svg></button>
        </div>`;
      }).join('') : '<div class="empty" style="font-size:13px;">Mochila vazia.</div>'}
    </div>
    <div class="modal-actions">
      <button class="btn ghost" id="modal-cancel">Fechar</button>
      <button class="btn gold" id="inv-add">+ Dar um item</button>
    </div>`;
  openModalBackdrop();
  $('#modal-cancel').onclick = closeModal;

  $('#inv-add').onclick = () => {
    closeModal();
    catalogPickerModal(ch);
  };
  $$('#inv-list [data-inv-qty]').forEach((inp) => inp.onchange = async () => {
    await tryApi(() => api(`/characters/${ch.id}/inventory/${inp.dataset.invQty}`, {
      method: 'PUT', body: { qty: Number(inp.value) || 0 },
    }));
    await refresh();
    inventoryModal(state.characters.find((c) => c.id === ch.id));
  });
  $$('#inv-list [data-inv-del]').forEach((b) => b.onclick = async () => {
    await tryApi(() => api(`/characters/${ch.id}/inventory/${b.dataset.invDel}`, { method: 'DELETE' }));
    await refresh();
    inventoryModal(state.characters.find((c) => c.id === ch.id));
  });
  $$('#inv-list [data-inv-send]').forEach((b) => b.onclick = () =>
    tryApi(() => api(`/characters/${ch.id}/inventory/${b.dataset.invSend}/notify`, { method: 'POST' }), 'Card reenviado no Discord!'));
}

// Escolhe um item do catálogo para dar a um personagem específico.
function catalogPickerModal(ch) {
  const itens = state.items || [];
  $('#modal').innerHTML = `
    <h3>Dar um item a ${esc(ch.name)}</h3>
    <div id="cat-list" style="max-height:360px;overflow-y:auto;">
      ${itens.length ? itens.map((it) => {
        const cor = corDaRaridade(it.rarity);
        return `
        <div class="srd-result-row" style="border-left:3px solid ${cor};padding-left:8px;">
          ${it.imageUrl
            ? `<img class="cp-thumb" src="${esc(it.imageUrl)}" alt="" onerror="this.remove()" />`
            : '<span class="cp-thumb placeholder"><svg class="icon"><use href="#i-backpack"/></svg></span>'}
          <span>${esc(it.name)}<small style="color:${cor};"> ${esc(it.rarity || '')}</small></span>
          <button class="btn small gold" data-cat-give="${it.id}"><svg class="icon"><use href="#i-gift"/></svg>Entregar</button>
        </div>`;
      }).join('') : '<div class="help-text">Nenhum item no catálogo. Crie um na aba Itens.</div>'}
    </div>
    <div class="modal-actions"><button class="btn ghost" id="modal-cancel">Fechar</button></div>`;
  openModalBackdrop();
  $('#modal-cancel').onclick = closeModal;
  $$('#cat-list [data-cat-give]').forEach((b) => b.onclick = () => {
    closeModal();
    giveItemModal(itens.find((x) => x.id === b.dataset.catGive));
  });
}

function charModal(c = {}) {
  const isPc = c.type === 'pc';
  openModal(c.id ? `Editar ${esc(c.name)}` : (isPc ? 'Novo personagem de jogador' : 'Novo NPC'), `
    <input type="hidden" name="type" value="${c.type}" />
    ${field('Nome', 'name', c.name)}
    ${isPc ? field('Jogador (quem joga)', 'player', c.player) : ''}
    <div class="field-row">
      ${field('Raça', 'race', c.race)}
      ${field('Classe/Ocupação', 'klass', c.klass)}
      ${field('Nível', 'level', c.level, 'number')}
    </div>
    <div class="field-row">
      ${field('CA', 'ac', c.ac, 'number')}
      ${field('PV atual', 'hp', c.hp, 'number')}
      ${field('PV máximo', 'maxHp', c.maxHp, 'number')}
    </div>
    <div class="field">
      <label>Atributos</label>
      <div class="srd-ability-row">
        ${ABILITIES.map((a) => `
          <div class="srd-ability">
            <div class="srd-ab-label">${a.label}</div>
            <input type="number" id="charm-abil-${a.key}" min="1" max="30" value="${scoreOf(c, a.key)}" style="width:100%;text-align:center;padding:4px;margin-top:2px;" />
            <div class="srd-ab-val" id="charm-abil-mod-${a.key}">${fmtSigned(abilityMod(scoreOf(c, a.key)))}</div>
          </div>`).join('')}
      </div>
    </div>
    <div class="field">
      <label>Proficiência em testes de resistência</label>
      <div style="display:flex;flex-wrap:wrap;gap:4px 14px;">
        ${ABILITIES.map((a) => `<label class="tool-check"><input type="checkbox" id="charm-save-${a.key}" ${c.saveProf?.[a.key] ? 'checked' : ''} /> ${a.label}</label>`).join('')}
      </div>
    </div>
    <div class="field">
      <label>Perícias</label>
      ${ABILITIES.map((a) => {
        const group = SKILLS.filter((s) => s.ability === a.key);
        if (!group.length) return '';
        return `
          <div style="margin-bottom:6px;">
            <div style="font-size:10px;font-weight:700;letter-spacing:0.05em;color:var(--muted);text-transform:uppercase;margin-bottom:2px;">${a.label}</div>
            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:2px 10px;">
              ${group.map((s) => `<label class="tool-check"><input type="checkbox" id="charm-skill-${s.key}" ${c.skillProf?.[s.key] ? 'checked' : ''} /> ${esc(s.label)}</label>`).join('')}
            </div>
          </div>`;
      }).join('')}
    </div>
    <div class="field">
      <label>Habilidades e Características</label>
      <div id="charm-features-list"></div>
      <button type="button" class="btn small ghost" id="charm-add-feature"><svg class="icon"><use href="#i-plus"/></svg>Adicionar habilidade</button>
    </div>
    <div class="field">
      <label>Magias</label>
      <div id="charm-spells-list"></div>
      <button type="button" class="btn small ghost" id="charm-add-spell"><svg class="icon"><use href="#i-plus"/></svg>Adicionar magia</button>
    </div>
    ${isPc ? '' : fieldSelect('Tipo de NPC', 'npcType', [
      { value: 'inimigo',   label: 'Inimigo — combate e antagonistas' },
      { value: 'quest',     label: 'Quest — dão missões ou são objetivos' },
      { value: 'aleatorio', label: 'Aleatório — encontros ou figurantes' },
      { value: 'npc',       label: 'NPC — personagens de apoio' },
    ], c.npcType || 'npc')}
    ${isPc ? '' : field('Voz e maneirismos', 'voice', c.voice, 'text', 'Fala arrastado, coça a barba, nunca olha nos olhos...')}
    ${isPc ? '' : `<div class="field-row">
      ${fieldSelect('Voz sintetizada (TTS)', 'ttsVoice', ttsVoices.map((v) => ({ value: v.id, label: v.label })), c.ttsVoice || 'pt-BR-AntonioNeural')}
      ${field('Ritmo % (-50 a 50)', 'ttsRate', c.ttsRate ?? 0, 'number')}
      ${field('Tom Hz (-50 a 50)', 'ttsPitch', c.ttsPitch ?? 0, 'number')}
    </div>`}
    <div class="field">
      <label>Interpretação (roleplay)</label>
      ${fieldSelect('Alinhamento', 'alignment', [
        { value: '', label: '— nenhum —' },
        { value: 'LB', label: 'Leal e Bom' }, { value: 'NB', label: 'Neutro e Bom' }, { value: 'CB', label: 'Caótico e Bom' },
        { value: 'LN', label: 'Leal e Neutro' }, { value: 'N', label: 'Neutro' }, { value: 'CN', label: 'Caótico e Neutro' },
        { value: 'LM', label: 'Leal e Mau' }, { value: 'NM', label: 'Neutro e Mau' }, { value: 'CM', label: 'Caótico e Mau' },
      ], c.alignment || '')}
      ${fieldArea('Traços de personalidade', 'personalityTraits', c.personalityTraits, 'Sempre tem uma piada pronta, mesmo na hora errada...')}
      ${fieldArea('Ideais', 'ideals', c.ideals, 'Liberdade acima de tudo. Ninguém deveria viver acorrentado.')}
      ${fieldArea('Vínculos', 'bonds', c.bonds, 'Devo minha vida ao mestre que me criou.')}
      ${fieldArea('Defeitos', 'flaws', c.flaws, 'Não resiste a uma boa aposta, mesmo perdendo sempre.')}
    </div>
    ${fieldArea('Descrição', 'description', c.description)}
    ${isPc ? '' : fieldArea('Segredos (só o Mestre vê; a IA usa para coerência)', 'secrets', c.secrets)}
    ${fieldImage('Retrato (aparece no token e na tela dos jogadores)', 'imageUrl', c.imageUrl)}
  `, async (data) => {
    data.imageUrl = await resolveImage('imageUrl', data);
    // Checkbox desmarcado não aparece no FormData — monta os três objetos na mão em
    // vez de confiar na coleta genérica, senão desmarcar uma proficiência não "gruda".
    data.abilities = {};
    data.saveProf = {};
    ABILITIES.forEach((a) => {
      data.abilities[a.key] = Math.max(1, Math.min(30, Number($(`#charm-abil-${a.key}`)?.value) || 10));
      data.saveProf[a.key] = Boolean($(`#charm-save-${a.key}`)?.checked);
    });
    data.skillProf = {};
    SKILLS.forEach((s) => { data.skillProf[s.key] = Boolean($(`#charm-skill-${s.key}`)?.checked); });
    data.features = [...$$('#charm-features-list .list-row')].map((row) => ({
      name: row.querySelector('.lr-name').value.trim(),
      source: row.querySelector('.lr-source').value.trim(),
      description: row.querySelector('.lr-desc').value.trim(),
    })).filter((f) => f.name);
    data.spells = (await Promise.all([...$$('#charm-spells-list .list-row')].map(async (row) => {
      const file = row.querySelector('.lr-image-file')?.files?.[0];
      let imageUrl = row.querySelector('.lr-image-url')?.value || '';
      if (file) {
        const fd = new FormData();
        fd.append('file', file);
        imageUrl = (await api('/images', { method: 'POST', body: fd })).url;
      }
      return {
        name: row.querySelector('.lr-name').value.trim(),
        level: Math.max(0, Math.min(9, Number(row.querySelector('.lr-level').value) || 0)),
        description: row.querySelector('.lr-desc').value.trim(),
        imageUrl,
      };
    }))).filter((s) => s.name);
    if (c.id) await api(`/characters/${c.id}`, { method: 'PUT', body: data });
    else await api('/characters', { method: 'POST', body: data });
  });
  // Mostra o modificador atualizando junto enquanto o Mestre digita o atributo.
  ABILITIES.forEach((a) => {
    const inp = $(`#charm-abil-${a.key}`);
    const out = $(`#charm-abil-mod-${a.key}`);
    if (inp && out) inp.oninput = () => { out.textContent = fmtSigned(abilityMod(inp.value)); };
  });
  // Listas dinâmicas de habilidades e magias — o array local é a fonte da verdade da
  // estrutura (quantas linhas), o texto de cada uma é lido do DOM na hora de salvar.
  const featuresDraft = JSON.parse(JSON.stringify(c.features || []));
  const spellsDraft = JSON.parse(JSON.stringify(c.spells || []));
  renderListRows('charm-features-list', featuresDraft, 'feature');
  renderListRows('charm-spells-list', spellsDraft, 'spell');
  $('#charm-add-feature').onclick = () => {
    syncListRows('charm-features-list', featuresDraft, 'feature');
    featuresDraft.push({ name: '', source: '', description: '' });
    renderListRows('charm-features-list', featuresDraft, 'feature');
  };
  $('#charm-add-spell').onclick = () => {
    syncListRows('charm-spells-list', spellsDraft, 'spell');
    spellsDraft.push({ name: '', level: 0, description: '' });
    renderListRows('charm-spells-list', spellsDraft, 'spell');
  };
}

// Ficha completa, só de leitura — acesso rápido do Mestre durante a batalha, sem sair
// do mapa. Reaproveita o mesmo visual da ficha de monstro do bestiário (srd-*).
function characterSheetModal(ch) {
  if (!ch) return;
  const isPc = ch.type === 'pc';
  const pb = profBonus(ch.level || 1);
  const dexMod = abilityMod(scoreOf(ch, 'dex'));

  const saveLines = ABILITIES.map((a) => {
    const prof = Boolean(ch.saveProf?.[a.key]);
    const total = abilityMod(scoreOf(ch, a.key)) + (prof ? pb : 0);
    return `<div class="sheet-row${prof ? ' on' : ''}"><span class="dot"></span><span class="val">${fmtSigned(total)}</span> ${a.label}</div>`;
  }).join('');

  const skillLines = SKILLS.map((s) => {
    const prof = Boolean(ch.skillProf?.[s.key]);
    const total = abilityMod(scoreOf(ch, s.ability)) + (prof ? pb : 0);
    return `<div class="sheet-row${prof ? ' on' : ''}"><span class="dot"></span><span class="val">${fmtSigned(total)}</span> ${esc(s.label)} <span class="abbr">(${abilLabel(s.ability)})</span></div>`;
  }).join('');

  const passivePerception = 10 + abilityMod(scoreOf(ch, 'wis')) + (ch.skillProf?.perception ? pb : 0);
  const hpFrac = ch.maxHp > 0 ? Math.max(0, Math.min(1, (ch.hp ?? 0) / ch.maxHp)) : null;
  const initials = (ch.name || '?').trim().slice(0, 1).toUpperCase();

  openModal(`${esc(ch.name)} — Ficha`, `
    <div class="sheet-header">
      ${ch.imageUrl
        ? `<img class="sheet-portrait" src="${esc(ch.imageUrl)}" alt="${esc(ch.name)}" onerror="this.classList.add('placeholder');this.removeAttribute('src');this.textContent='${esc(initials)}';" />`
        : `<div class="sheet-portrait placeholder">${esc(initials)}</div>`}
      <div class="sheet-title">
        <h4>${esc(ch.name)}</h4>
        <div class="sheet-subtitle">${esc([ch.race, ch.klass, ch.level ? `nível ${ch.level}` : ''].filter(Boolean).join(' · ')) || '—'}${isPc && ch.player ? ` · joga ${esc(ch.player)}` : ''}</div>
      </div>
    </div>
    <div class="sheet-stats">
      <div class="sheet-stat ac"><div class="sheet-stat-label">CA</div><div class="sheet-stat-val">${esc(ch.ac ?? '—')}</div></div>
      <div class="sheet-stat hp">
        <div class="sheet-stat-label">PV</div>
        <div class="sheet-stat-val">${esc(ch.hp ?? '?')}/${esc(ch.maxHp ?? '?')}</div>
        ${hpFrac !== null ? `<div class="hp-bar"><span style="width:${hpFrac * 100}%;background:${hpFrac > 0.5 ? '#4a9d6f' : hpFrac > 0.25 ? '#b8925a' : '#c05650'}"></span></div>` : ''}
      </div>
      <div class="sheet-stat"><div class="sheet-stat-label">Iniciativa</div><div class="sheet-stat-val">${fmtSigned(dexMod)}</div></div>
      <div class="sheet-stat"><div class="sheet-stat-label">Prof.</div><div class="sheet-stat-val">${fmtSigned(pb)}</div></div>
      <div class="sheet-stat"><div class="sheet-stat-label">Perc. passiva</div><div class="sheet-stat-val">${passivePerception}</div></div>
    </div>
    <div class="sheet-abilities">
      ${ABILITIES.map((a) => `
        <div class="sheet-abil">
          <div class="sheet-abil-label">${a.label}</div>
          <div class="sheet-abil-mod">${fmtSigned(abilityMod(scoreOf(ch, a.key)))}</div>
          <div class="sheet-abil-score">${scoreOf(ch, a.key)}</div>
        </div>`).join('')}
    </div>
    <div class="sheet-cols">
      <div class="sheet-col">
        <div class="sheet-col-title">Testes de resistência</div>
        ${saveLines}
      </div>
      <div class="sheet-col">
        <div class="sheet-col-title">Perícias</div>
        ${skillLines}
      </div>
    </div>
    ${(ch.features || []).length ? `
      <div class="sheet-col-title" style="margin-top:14px;">Habilidades e Características</div>
      ${ch.features.map((f) => sheetFeatureHtml(f, 'feature')).join('')}` : ''}
    ${(ch.spells || []).length ? `
      <div class="sheet-col-title" style="margin-top:14px;">Magias</div>
      ${ch.spells.map((s) => sheetFeatureHtml(s, 'spell')).join('')}` : ''}
    ${sheetRoleplayHtml(ch)}
    ${ch.description ? `<div class="sheet-desc">${esc(ch.description).replace(/\n/g, '<br>')}</div>` : ''}
  `, async () => {}, 'Fechar');

  // Botão "Editar" fora do form/submit do modal — se fosse o botão principal, o
  // closeModal()+refresh() que o openModal roda depois do onSave fecharia a ficha de
  // edição que acabou de abrir.
  const actions = $('#modal-form .modal-actions');
  if (actions) {
    actions.insertAdjacentHTML('afterbegin', '<button type="button" class="btn ghost" id="sheet-edit"><svg class="icon"><use href="#i-pencil-simple"/></svg>Editar</button>');
    $('#sheet-edit').onclick = () => { closeModal(); charModal(ch); };
  }
}

function handoutModal() {
  const pcs = state.characters.filter((c) => c.type === 'pc');
  openModal('Enviar handout', `
    ${fieldSelect('Para quem?', 'target', [
      { value: 'all', label: 'Todos (no canal de texto)' },
      ...pcs.map((c) => ({
        value: c.id,
        label: `${c.name}${c.discordUserId ? ` — DM para ${c.discordTag || 'jogador'}` : ' — SEM VÍNCULO (use /vincular)'}`,
      })),
    ], 'all')}
    ${field('Título', 'title', '', 'text', 'Uma carta amassada')}
    ${fieldArea('Conteúdo', 'content', '', '"Encontre-me na cripta à meia-noite. Venha só. — V."')}
    ${field('URL da imagem (opcional)', 'imageUrl', '', 'text', 'mapa, carta, brasão...')}
  `, async (data) => {
    const r = await tryApi(() => api('/handout', { method: 'POST', body: data }));
    if (r) {
      let msg = r.sent?.length ? `Enviado para: ${r.sent.join(', ')}.` : '';
      if (r.failed?.length) msg += ` Falhou: ${r.failed.join('; ')}`;
      toast(msg || 'Nada foi enviado.', Boolean(r.failed?.length));
    }
  }, 'Enviar');
}

function speakModal(npc) {
  openModal(`${esc(npc.name)} fala...`, `
    ${fieldArea('O que o NPC diz?', 'text', '', '"Saiam da minha taverna, forasteiros!"')}
    <div class="row">
      <button type="button" class="btn ghost" id="btn-tts-preview"><svg class="icon"><use href="#i-headphones"/></svg>Ouvir aqui</button>
    </div>
    <audio id="tts-audio" controls style="width:100%; margin-top:8px; display:none;"></audio>
  `, async () => {}, 'Falar no Discord');

  const speak = async (discord) => {
    const text = $('#modal-form [name="text"]').value;
    if (!text.trim()) return toast('Escreva a fala primeiro.', true);
    const r = await tryApi(() => api('/tts/speak', { method: 'POST', body: { text, npcId: npc.id, discord } }));
    if (!r) return;
    if (discord) toast(r.warning || `${npc.name} falou no canal de voz!`, Boolean(r.warning));
    if (!discord) {
      const audio = $('#tts-audio');
      audio.src = r.url;
      audio.style.display = 'block';
      audio.play();
    }
  };
  $('#btn-tts-preview').onclick = () => speak(false);
  $('#modal-form').onsubmit = (e) => { e.preventDefault(); speak(true); };
}

function improvModal(npc) {
  openModal(`Improvisar: ${esc(npc.name)}`, `
    ${fieldArea('O que está acontecendo?', 'situation', '', 'Os jogadores ameaçam o taverneiro exigindo saber sobre o culto...')}
    <div id="improv-result" class="msg assistant" style="display:none; max-width:100%;"></div>
  `, async () => {}, 'Fechar');
  // Substitui o submit padrão: o botão consulta a IA sem fechar
  $('#modal-form').onsubmit = async (e) => {
    e.preventDefault();
    const situation = new FormData(e.target).get('situation');
    const out = $('#improv-result');
    out.style.display = 'block';
    out.textContent = 'Incorporando o personagem...';
    const r = await tryApi(() => api(`/ai/npc/${npc.id}`, { method: 'POST', body: { situation } }));
    out.textContent = r ? r.reply : 'Erro ao consultar a IA.';
  };
  $('#modal-form .modal-actions .btn:not(.ghost)').textContent = 'Improvisar';
}

// ---------- Áudio ----------
const TYPE_LABEL = {
  ambient: '<svg class="icon"><use href="#i-cloud-fog"/></svg>Ambiente',
  music: '<svg class="icon"><use href="#i-music-notes"/></svg>Música',
  sfx: '<svg class="icon"><use href="#i-waveform"/></svg>Efeito',
};

// Categorias só se aplicam a efeitos (sfx) — ambiente/música continuam soltos por cena.
// 'geral' é o catch-all pra efeitos antigos sem categoria ou que não se encaixam nas outras.
const SFX_CATEGORIES = [
  { value: 'combate', label: 'Combate', icon: 'sword' },
  { value: 'criaturas', label: 'Criaturas', icon: 'skull' },
  { value: 'objetos', label: 'Objetos', icon: 'package' },
  { value: 'ambiente', label: 'Ambiente', icon: 'waves' },
  { value: 'magia', label: 'Magia', icon: 'sparkle' },
  { value: 'social', label: 'Social', icon: 'mask-happy' },
  { value: 'geral', label: 'Geral', icon: 'waveform' },
];
const sfxCategory = (value) => SFX_CATEGORIES.find((c) => c.value === value) || SFX_CATEGORIES[SFX_CATEGORIES.length - 1];
// 'Geral' primeiro nos selects de cadastro — evita que tudo caia em 'Combate' por padrão
// só porque é a primeira opção da lista; o mestre escolhe uma categoria específica de propósito.
const sfxCategoryOptions = () => [SFX_CATEGORIES[SFX_CATEGORIES.length - 1], ...SFX_CATEGORIES.slice(0, -1)]
  .map((c) => ({ value: c.value, label: c.label }));
const sfxCategoryChip = (c, active) =>
  `<button class="sfx-cat-chip${active ? ' active' : ''}" data-cat="${c.value}" title="${esc(c.label)}">
    <svg class="icon"><use href="#i-${c.icon}"/></svg>${esc(c.label)}
  </button>`;

let libCategoria = 'todos';
let libFiltro = '';
let libSearchWasFocused = false;

const audioRowHtml = (a) => `
  <div class="audio-row">
    <span class="audio-row-badge">${a.type === 'sfx'
      ? `<svg class="icon"><use href="#i-${sfxCategory(a.category).icon}"/></svg>${esc(sfxCategory(a.category).label)}`
      : TYPE_LABEL[a.type] || a.type}</span>
    <span class="name"><b>${esc(a.name)}</b><br/><small style="color:var(--muted)">${(a.tags || []).map((t) => `#${esc(t)}`).join(' ')}</small></span>
    <audio controls preload="none" src="/audio-files/${esc(a.filename)}"></audio>
    <button class="btn small gold" data-play-discord="${a.id}" title="Tocar no canal de voz do Discord"><svg class="icon"><use href="#i-broadcast"/></svg>Discord</button>
    <button class="btn small ghost" data-edit-audio="${a.id}"><svg class="icon"><use href="#i-pencil-simple"/></svg></button>
    <button class="btn small danger" data-del-audio="${a.id}"><svg class="icon"><use href="#i-trash"/></svg></button>
  </div>`;

function renderAudio() {
  const ambientes = state.audio.filter((a) => a.type === 'ambient');
  const musicas = state.audio.filter((a) => a.type === 'music');
  const todosSfx = state.audio.filter((a) => a.type === 'sfx');
  const q = libFiltro.trim().toLowerCase();
  const sfx = todosSfx.filter((a) => (libCategoria === 'todos' || sfxCategory(a.category).value === libCategoria)
    && (!q || a.name.toLowerCase().includes(q) || (a.tags || []).some((t) => t.toLowerCase().includes(q))));

  $('#tab-audio').innerHTML = `
    <div class="tab-header">
      <h2><svg class="icon"><use href="#i-music-notes"/></svg>Biblioteca de Áudio</h2>
    </div>
    <div class="card" style="margin-bottom:16px;">
      <h3>Enviar novo áudio</h3>
      <form id="audio-upload-form" class="row" style="align-items:center;">
        <input type="file" name="file" accept=".mp3,.ogg,.wav,.m4a,.webm,.flac" required />
        <input name="name" placeholder="Nome (opcional)" />
        <select name="type" id="up-type">
          <option value="ambient">Ambiente (loop)</option>
          <option value="music">Música (loop)</option>
          <option value="sfx" selected>Efeito (uma vez)</option>
        </select>
        <select name="category" id="up-category">
          ${sfxCategoryOptions().map((o) => `<option value="${o.value}">${esc(o.label)}</option>`).join('')}
        </select>
        <input name="tags" placeholder="tags: taverna, chuva, combate..." />
        <button class="btn" type="submit"><svg class="icon"><use href="#i-upload-simple"/></svg>Enviar</button>
      </form>
      <p class="help-text">A categoria só vale para efeitos — é por ela (e pelas tags) que o soundboard de batalha filtra rápido.</p>
    </div>
    <div class="card" style="margin-bottom:16px;">
      <h3 style="display:flex;align-items:center;gap:8px;"><svg class="icon"><use href="#i-magnifying-glass"/></svg>Buscar no Freesound</h3>
      <div class="row" style="align-items:center;">
        <input id="fs-query" placeholder="rain, tavern, sword fight, thunder... (em inglês acha mais)" style="flex:1;" />
        <select id="fs-type">
          <option value="ambient">Ambiente</option>
          <option value="music">Música</option>
          <option value="sfx" selected>Efeito</option>
        </select>
        <select id="fs-category">
          ${sfxCategoryOptions().map((o) => `<option value="${o.value}">${esc(o.label)}</option>`).join('')}
        </select>
        <button class="btn" id="btn-fs-search"><svg class="icon"><use href="#i-magnifying-glass"/></svg>Buscar</button>
      </div>
      <div id="fs-results"></div>
      <p class="help-text">Requer FREESOUND_API_KEY no .env (grátis em freesound.org). O som é baixado direto para a sua biblioteca, já com as tags.</p>
    </div>
    <div class="card" style="margin-bottom:16px;">
      <h3 style="display:flex;align-items:center;gap:8px;"><svg class="icon"><use href="#i-broadcast"/></svg>Buscar no YouTube</h3>
      <div class="row" style="align-items:center;">
        <input id="yt-query" placeholder="trilha de taverna medieval, batalha épica, chuva na floresta..." style="flex:1;" />
        <select id="yt-type">
          <option value="ambient">Ambiente</option>
          <option value="music" selected>Música</option>
          <option value="sfx">Efeito</option>
        </select>
        <select id="yt-category">
          ${sfxCategoryOptions().map((o) => `<option value="${o.value}">${esc(o.label)}</option>`).join('')}
        </select>
        <button class="btn" id="btn-yt-search"><svg class="icon"><use href="#i-magnifying-glass"/></svg>Buscar</button>
      </div>
      <div id="yt-results"></div>
      <p class="help-text">Baixa só o áudio do vídeo (via yt-dlp) e importa pra biblioteca, igual o Freesound — ótimo pra trilhas sonoras mais elaboradas que os loops curtos.</p>
    </div>
    ${ambientes.length ? `<h3 class="audio-section-title">${TYPE_LABEL.ambient}</h3>${ambientes.map(audioRowHtml).join('')}` : ''}
    ${musicas.length ? `<h3 class="audio-section-title">${TYPE_LABEL.music}</h3>${musicas.map(audioRowHtml).join('')}` : ''}
    <h3 class="audio-section-title">${TYPE_LABEL.sfx}</h3>
    <div class="sfx-cat-bar">
      ${sfxCategoryChip({ value: 'todos', label: `Todos (${todosSfx.length})`, icon: 'waveform' }, libCategoria === 'todos')}
      ${SFX_CATEGORIES.map((c) => sfxCategoryChip(c, libCategoria === c.value)).join('')}
      <input id="lib-sfx-search" class="sb-search" style="max-width:220px;" placeholder="filtrar por nome ou tag..." value="${esc(libFiltro)}" />
    </div>
    ${sfx.length ? sfx.map(audioRowHtml).join('')
      : `<div class="empty">${todosSfx.length ? 'Nenhum efeito nessa categoria/filtro.' : 'Envie efeitos (porta, espadas, trovão) e organize por categoria.'}</div>`}
    ${!ambientes.length && !musicas.length && !todosSfx.length ? '<div class="empty">Envie áudios de ambiente (chuva, taverna, floresta), músicas e efeitos.</div>' : ''}`;

  $('#up-type').onchange = (e) => { $('#up-category').style.display = e.target.value === 'sfx' ? '' : 'none'; };
  $('#up-type').dispatchEvent(new Event('change'));
  $('#fs-type').onchange = (e) => { $('#fs-category').style.display = e.target.value === 'sfx' ? '' : 'none'; };
  $('#fs-type').dispatchEvent(new Event('change'));
  $('#yt-type').onchange = (e) => { $('#yt-category').style.display = e.target.value === 'sfx' ? '' : 'none'; };
  $('#yt-type').dispatchEvent(new Event('change'));

  $$('#tab-audio .sfx-cat-bar [data-cat]').forEach((b) => b.onclick = () => { libCategoria = b.dataset.cat; renderAudio(); });
  const libSearch = $('#lib-sfx-search');
  if (libSearch) {
    libSearch.oninput = (e) => { libFiltro = e.target.value; renderAudio(); };
    if (libSearchWasFocused) {
      libSearch.focus({ preventScroll: true });
      libSearch.setSelectionRange(libSearch.value.length, libSearch.value.length);
    }
    libSearch.onfocus = () => { libSearchWasFocused = true; };
    libSearch.onblur = () => { libSearchWasFocused = false; };
  }

  const fsSearch = async () => {
    const q = $('#fs-query').value.trim();
    if (!q) return;
    $('#fs-results').innerHTML = '<div class="help-text">Buscando no Freesound...</div>';
    const results = await tryApi(() => api(`/freesound/search?q=${encodeURIComponent(q)}`));
    if (!results) { $('#fs-results').innerHTML = ''; return; }
    $('#fs-results').innerHTML = results.length ? results.map((s, i) => `
      <div class="audio-row" style="margin-top:8px;">
        <span class="name"><b>${esc(s.name)}</b><br/>
          <small style="color:var(--muted)">${Math.round(s.duration)}s · por ${esc(s.username)} · ${s.tags.map((t) => `#${esc(t)}`).join(' ')}</small></span>
        <audio controls preload="none" src="${esc(s.previewUrl)}"></audio>
        <button class="btn small gold" data-fs-import="${i}"><svg class="icon"><use href="#i-download-simple"/></svg>Importar</button>
      </div>`).join('') : '<div class="help-text">Nada encontrado.</div>';

    $$('#fs-results [data-fs-import]').forEach((b) => b.onclick = async () => {
      const s = results[Number(b.dataset.fsImport)];
      b.disabled = true; b.textContent = 'Baixando...';
      const type = $('#fs-type').value;
      const r = await tryApi(() => api('/freesound/import', {
        method: 'POST',
        body: { name: s.name, previewUrl: s.previewUrl, type, category: type === 'sfx' ? $('#fs-category').value : undefined, tags: s.tags },
      }), `"${s.name}" importado para a biblioteca!`);
      if (r) refresh();
      else { b.disabled = false; b.textContent = 'Importar'; }
    });
  };
  $('#btn-fs-search').onclick = fsSearch;
  $('#fs-query').addEventListener('keydown', (e) => { if (e.key === 'Enter') fsSearch(); });

  const fmtDuration = (s) => s ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : '?:??';
  const ytSearch = async () => {
    const q = $('#yt-query').value.trim();
    if (!q) return;
    $('#yt-results').innerHTML = '<div class="help-text">Buscando no YouTube...</div>';
    const results = await tryApi(() => api(`/youtube/search?q=${encodeURIComponent(q)}`));
    if (!results) { $('#yt-results').innerHTML = ''; return; }
    $('#yt-results').innerHTML = results.length ? results.map((v, i) => `
      <div class="audio-row" style="margin-top:8px;">
        ${v.thumbnailUrl ? `<img src="${esc(v.thumbnailUrl)}" alt="" style="width:64px;height:36px;object-fit:cover;border-radius:6px;flex-shrink:0;" />` : ''}
        <span class="name"><b>${esc(v.title)}</b><br/>
          <small style="color:var(--muted)">${fmtDuration(v.duration)} · ${esc(v.channel)}</small></span>
        <button class="btn small gold" data-yt-import="${i}"><svg class="icon"><use href="#i-download-simple"/></svg>Importar</button>
      </div>`).join('') : '<div class="help-text">Nada encontrado.</div>';

    $$('#yt-results [data-yt-import]').forEach((b) => b.onclick = async () => {
      const v = results[Number(b.dataset.ytImport)];
      b.disabled = true; b.textContent = 'Baixando...';
      const type = $('#yt-type').value;
      const r = await tryApi(() => api('/youtube/import', {
        method: 'POST',
        body: { videoId: v.id, title: v.title, type, category: type === 'sfx' ? $('#yt-category').value : undefined },
      }), `"${v.title}" importado para a biblioteca!`);
      if (r) refresh();
      else { b.disabled = false; b.textContent = 'Importar'; }
    });
  };
  $('#btn-yt-search').onclick = ytSearch;
  $('#yt-query').addEventListener('keydown', (e) => { if (e.key === 'Enter') ytSearch(); });

  $('#audio-upload-form').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    await tryApi(() => api('/audio', { method: 'POST', body: fd }), 'Áudio enviado!');
    refresh();
  };
  $$('#tab-audio [data-play-discord]').forEach((b) => b.onclick = () =>
    tryApi(() => api(`/sound/play/${b.dataset.playDiscord}`, { method: 'POST' }), 'Tocando no Discord!').then(refresh));
  $$('#tab-audio [data-del-audio]').forEach((b) => b.onclick = async () => {
    if (confirm('Excluir este áudio?')) { await api(`/audio/${b.dataset.delAudio}`, { method: 'DELETE' }); refresh(); }
  });
  $$('#tab-audio [data-edit-audio]').forEach((b) => b.onclick = () => {
    const a = state.audio.find((x) => x.id === b.dataset.editAudio);
    openModal('Editar áudio', `
      ${field('Nome', 'name', a.name)}
      ${fieldSelect('Tipo', 'type', [
        { value: 'ambient', label: 'Ambiente (loop)' },
        { value: 'music', label: 'Música (loop)' },
        { value: 'sfx', label: 'Efeito (uma vez)' },
      ], a.type)}
      ${fieldSelect('Categoria (efeitos)', 'category', sfxCategoryOptions(), a.category || 'geral')}
      ${field('Tags (separadas por vírgula)', 'tags', (a.tags || []).join(', '))}
    `, async (data) => {
      data.tags = data.tags.split(',').map((t) => t.trim()).filter(Boolean);
      await api(`/audio/${a.id}`, { method: 'PUT', body: data });
    });
    const typeSel = $('#modal-form [name="type"]');
    const catField = $('#modal-form [name="category"]').closest('.field');
    const toggleCat = () => { catField.style.display = typeSel.value === 'sfx' ? '' : 'none'; };
    typeSel.onchange = toggleCat;
    toggleCat();
  });
}

// ---------- Cabine do Mestre ----------
// Tabela única dos controles: monta o HTML, liga os eventos, formata os valores e diz
// em que campo do NPC cada efeito é salvo. Com onze efeitos, manter essas quatro coisas
// em quatro lugares diferentes era garantia de um deles ficar para trás.
const pctFmt = (v) => `${Math.round(v * 100)}%`;
const stFmt = (v) => `${v > 0 ? '+' : ''}${v} st`;
const BOOTH_SLIDERS = [
  { key: 'pitch', npc: 'fxPitch', label: 'Tom (pitch)', min: -12, max: 12, step: 0.5, def: 0, fmt: stFmt },
  { key: 'timbre', npc: 'fxTimbre', label: 'Timbre (corpo ↔ fino)', min: -1, max: 1, step: 0.05, def: 0,
    fmt: (v) => (v === 0 ? 'neutro' : v < 0 ? `corpo ${Math.round(-v * 100)}%` : `fino ${Math.round(v * 100)}%`) },
  { key: 'reverb', npc: 'fxReverb', label: 'Reverb', min: 0, max: 1, step: 0.05, def: 0, fmt: pctFmt },
  { key: 'echo', npc: 'fxEcho', label: 'Eco', min: 0, max: 1, step: 0.05, def: 0, fmt: pctFmt },
  { key: 'distortion', npc: 'fxDist', label: 'Distorção', min: 0, max: 1, step: 0.05, def: 0, fmt: pctFmt },
  { key: 'robot', npc: 'fxRobot', label: 'Robô', min: 0, max: 1, step: 0.05, def: 0, fmt: pctFmt },
  { key: 'radio', npc: 'fxRadio', label: 'Rádio/comunicador', min: 0, max: 1, step: 0.05, def: 0, fmt: pctFmt },
  { key: 'tremor', npc: 'fxTremor', label: 'Tremor', min: 0, max: 1, step: 0.05, def: 0, fmt: pctFmt },
  { key: 'dual', npc: 'fxDual', label: 'Voz dupla', min: 0, max: 1, step: 0.05, def: 0, fmt: pctFmt },
  { key: 'dualPitch', npc: 'fxDualPitch', label: 'Intervalo da 2ª voz', min: -12, max: 12, step: 0.5, def: -12, fmt: stFmt },
  { key: 'gain', npc: 'fxGain', label: 'Ganho da voz', min: 0.5, max: 3.5, step: 0.1, def: 2, fmt: (v) => `${v.toFixed(1)}×` },
];

const VOICE_CATS = [
  { id: 'todas', label: 'Todas', icon: 'waveform' },
  { id: 'monstros', label: 'Monstros', icon: 'hand-fist' },
  { id: 'mortosvivos', label: 'Mortos-vivos', icon: 'skull' },
  { id: 'feericos', label: 'Feéricos', icon: 'sparkle' },
  { id: 'arcano', label: 'Arcano & construtos', icon: 'gear' },
  { id: 'divino', label: 'Divino & planar', icon: 'star' },
  { id: 'povo', label: 'Povo & vilões', icon: 'users' },
];

// Banco de vozes: cada preset lista só o que foge do padrão — o resto vem do `def` da
// tabela acima, então uma voz nunca herda sobra da anterior.
const VOICE_PRESETS = [
  // --- Monstros & feras ---
  { id: 'ogro', cat: 'monstros', name: 'Ogro brutamontes', hint: 'grave, encorpado e sujo',
    fx: { pitch: -7, timbre: -0.7, distortion: 0.25, reverb: 0.1, gain: 2.2 } },
  { id: 'dragao', cat: 'monstros', name: 'Dragão ancião', hint: 'duas gargantas, sala imensa',
    fx: { pitch: -9, timbre: -0.6, reverb: 0.45, echo: 0.15, distortion: 0.2, dual: 0.5, dualPitch: -12, gain: 2.4 } },
  { id: 'goblin', cat: 'monstros', name: 'Goblin esganiçado', hint: 'agudo, fino e rápido',
    fx: { pitch: 6, timbre: 0.5, distortion: 0.15, gain: 1.9 } },
  { id: 'kobold', cat: 'monstros', name: 'Kobold nervoso', hint: 'agudinho e trêmulo',
    fx: { pitch: 8, timbre: 0.6, tremor: 0.3 } },
  { id: 'aberracao', cat: 'monstros', name: 'Aberração sussurrante', hint: 'coro dissonante e errado',
    fx: { pitch: -3, timbre: -0.2, reverb: 0.5, echo: 0.2, dual: 0.6, dualPitch: 5 } },
  { id: 'lobisomem', cat: 'monstros', name: 'Lobisomem', hint: 'rosnado rasgado',
    fx: { pitch: -5, timbre: -0.4, distortion: 0.45, gain: 2.3 } },
  { id: 'troll', cat: 'monstros', name: 'Troll da ponte', hint: 'lerdo, cavernoso e nasalado',
    fx: { pitch: -6, timbre: -0.5, distortion: 0.15, reverb: 0.25, tremor: 0.15 } },

  // --- Mortos-vivos & espectros ---
  { id: 'fantasma', cat: 'mortosvivos', name: 'Fantasma', hint: 'distante, ecoando e instável',
    fx: { pitch: -2, timbre: 0.2, reverb: 0.85, echo: 0.4, tremor: 0.25, gain: 1.8 } },
  { id: 'lich', cat: 'mortosvivos', name: 'Lich', hint: 'grave, seca, com sombra de oitava',
    fx: { pitch: -6, timbre: -0.3, reverb: 0.6, echo: 0.25, dual: 0.4, dualPitch: -12 } },
  { id: 'zumbi', cat: 'mortosvivos', name: 'Zumbi', hint: 'arrastada e sem fôlego',
    fx: { pitch: -4, timbre: -0.5, distortion: 0.3, tremor: 0.45, gain: 2 } },
  { id: 'banshee', cat: 'mortosvivos', name: 'Banshee', hint: 'lamento agudo em duas alturas',
    fx: { pitch: 4, reverb: 0.7, echo: 0.3, tremor: 0.5, dual: 0.35, dualPitch: 7 } },
  { id: 'cripta', cat: 'mortosvivos', name: 'Voz da cripta', hint: 'saindo de dentro da pedra',
    fx: { pitch: -5, timbre: -0.45, reverb: 0.65, echo: 0.45, gain: 2.2 } },

  // --- Feéricos & pequenos ---
  { id: 'fada', cat: 'feericos', name: 'Fada', hint: 'aguda, cintilante e leve',
    fx: { pitch: 9, timbre: 0.4, reverb: 0.3, echo: 0.15 } },
  { id: 'gnomo', cat: 'feericos', name: 'Gnomo inventor', hint: 'miúda e tagarela',
    fx: { pitch: 5, timbre: 0.3 } },
  { id: 'duende', cat: 'feericos', name: 'Duende travesso', hint: 'agudinha, saltitante, com eco',
    fx: { pitch: 7, timbre: 0.2, echo: 0.25, tremor: 0.15 } },
  { id: 'crianca', cat: 'feericos', name: 'Criança', hint: 'clara e sem peso',
    fx: { pitch: 4, timbre: 0.25, gain: 1.8 } },
  { id: 'espirito-bosque', cat: 'feericos', name: 'Espírito do bosque', hint: 'ao longe, entre as árvores',
    fx: { pitch: 2, timbre: 0.15, reverb: 0.6, echo: 0.35, dual: 0.3, dualPitch: 12 } },

  // --- Arcano & construtos ---
  { id: 'automato', cat: 'arcano', name: 'Autômato', hint: 'metálica e mecânica',
    fx: { pitch: -1, robot: 0.7, radio: 0.25 } },
  { id: 'golem', cat: 'arcano', name: 'Golem de pedra', hint: 'lenta, pesada, quase sem agudos',
    fx: { pitch: -8, timbre: -0.8, distortion: 0.3, robot: 0.25, reverb: 0.2 } },
  { id: 'elemental-fogo', cat: 'arcano', name: 'Elemental de fogo', hint: 'crepitante e ondulante',
    fx: { pitch: -2, timbre: 0.1, distortion: 0.5, tremor: 0.2, reverb: 0.25 } },
  { id: 'mensagem', cat: 'arcano', name: 'Mensagem arcana', hint: 'chiado de comunicação à distância',
    fx: { radio: 0.9, echo: 0.2, gain: 2.2 } },
  { id: 'simulacro', cat: 'arcano', name: 'Simulacro', hint: 'a mesma voz, meio semitom fora',
    fx: { timbre: 0.05, reverb: 0.35, dual: 0.6, dualPitch: 0.5 } },
  { id: 'espelho', cat: 'arcano', name: 'Voz do espelho', hint: 'invertida, vindo do outro lado',
    fx: { pitch: -3, timbre: 0.2, reverb: 0.55, echo: 0.5, radio: 0.35 } },

  // --- Divino & planar ---
  { id: 'celestial', cat: 'divino', name: 'Celestial', hint: 'coro em oitava, catedral',
    fx: { pitch: 2, timbre: 0.2, reverb: 0.8, echo: 0.2, dual: 0.5, dualPitch: 12 } },
  { id: 'demonio', cat: 'divino', name: 'Demônio', hint: 'oitava abaixo, rasgada',
    fx: { pitch: -7, timbre: -0.5, distortion: 0.4, reverb: 0.3, dual: 0.55, dualPitch: -12, gain: 2.4 } },
  { id: 'deus-antigo', cat: 'divino', name: 'Deus antigo', hint: 'enorme, sem fim, com quinta',
    fx: { pitch: -10, timbre: -0.6, reverb: 0.9, echo: 0.35, dual: 0.45, dualPitch: 7, gain: 2.5 } },
  { id: 'astral', cat: 'divino', name: 'Voz do plano astral', hint: 'flutuante e desfocada',
    fx: { reverb: 0.7, echo: 0.5, radio: 0.3, tremor: 0.15 } },
  { id: 'juiz', cat: 'divino', name: 'Juiz dos mortos', hint: 'sentença dita numa sala vazia',
    fx: { pitch: -5, timbre: -0.35, reverb: 0.75, dual: 0.3, dualPitch: -12, gain: 2.3 } },

  // --- Povo & vilões ---
  { id: 'taverneiro', cat: 'povo', name: 'Taverneiro rouco', hint: 'grave, gasta de tanto gritar',
    fx: { pitch: -3, timbre: -0.3, distortion: 0.2 } },
  { id: 'nobre', cat: 'povo', name: 'Nobre afetado', hint: 'clara, empinada, nasal',
    fx: { pitch: 2, timbre: 0.35, reverb: 0.12 } },
  { id: 'velho-sabio', cat: 'povo', name: 'Velho sábio', hint: 'trêmula e pausada',
    fx: { pitch: -2, timbre: -0.15, tremor: 0.35, reverb: 0.15 } },
  { id: 'conspirador', cat: 'povo', name: 'Sussurro conspirador', hint: 'baixinha, colada no ouvido',
    fx: { pitch: -1, timbre: 0.15, echo: 0.1, reverb: 0.05, gain: 1.4 } },
  { id: 'arauto', cat: 'povo', name: 'Arauto do rei', hint: 'projetada, praça cheia',
    fx: { pitch: -1, timbre: -0.1, reverb: 0.4, echo: 0.15, gain: 2.6 } },
  { id: 'bruxa', cat: 'povo', name: 'Bruxa do pântano', hint: 'aguda, rachada e trêmula',
    fx: { pitch: 3, timbre: 0.3, distortion: 0.25, tremor: 0.4 } },
  { id: 'encapuzado', cat: 'povo', name: 'Vilão encapuzado', hint: 'grave e controlada',
    fx: { pitch: -4, timbre: -0.25, reverb: 0.2, gain: 2.1 } },
];

let boothRendered = false;
let boothPresetCat = 'todas';
let boothPresetBusca = '';
let boothPresetAtivo = '';

// Aplica um conjunto de efeitos de uma vez: completa o que o preset não define, atualiza
// os controles na tela e manda para o motor de áudio.
function boothSetFx(fx) {
  for (const s of BOOTH_SLIDERS) booth.fx[s.key] = fx[s.key] ?? s.def;
  for (const s of BOOTH_SLIDERS) {
    const el = $(`#booth-sl-${s.key}`);
    if (!el) continue;
    el.value = booth.fx[s.key];
    $(`#booth-sl-${s.key}-val`).textContent = s.fmt(booth.fx[s.key]);
  }
  boothApplyFx();
}

function renderVoicePresets() {
  $('#booth-preset-cats').innerHTML = VOICE_CATS.map((c) => `
    <button class="sfx-cat-chip ${c.id === boothPresetCat ? 'active' : ''}" data-vcat="${c.id}">
      <svg class="icon"><use href="#i-${c.icon}"/></svg>${c.label}
    </button>`).join('');

  const busca = boothPresetBusca.trim().toLowerCase();
  const lista = VOICE_PRESETS.filter((p) => {
    if (boothPresetCat !== 'todas' && p.cat !== boothPresetCat) return false;
    if (!busca) return true;
    const cat = VOICE_CATS.find((c) => c.id === p.cat)?.label || '';
    return `${p.name} ${p.hint} ${cat}`.toLowerCase().includes(busca);
  });

  $('#booth-preset-grid').innerHTML = lista.length
    ? lista.map((p) => `
      <button class="voice-preset ${p.id === boothPresetAtivo ? 'active' : ''}" data-vpreset="${p.id}">
        <span class="vp-name">${esc(p.name)}</span>
        <span class="vp-hint">${esc(p.hint)}</span>
      </button>`).join('')
    : '<p class="help-text">Nenhuma voz com esse nome.</p>';

  $$('#booth-preset-cats [data-vcat]').forEach((b) => b.onclick = () => {
    boothPresetCat = b.dataset.vcat;
    renderVoicePresets();
  });
  $$('#booth-preset-grid [data-vpreset]').forEach((b) => b.onclick = () => {
    const p = VOICE_PRESETS.find((x) => x.id === b.dataset.vpreset);
    boothPresetAtivo = p.id;
    boothSetFx(p.fx);
    renderVoicePresets();
    toast(`Voz "${p.name}" carregada.`);
  });
}

function renderBoothTab() {
  if (!boothRendered) {
    boothRendered = true;
    $('#tab-booth').innerHTML = `
      <div class="tab-header"><h2><svg class="icon"><use href="#i-microphone"/></svg>Cabine do Mestre</h2></div>
      <p class="help-text">Fale pelos NPCs com a sua voz transformada: o som sai pelo bot, por cima da música ambiente.
      <b>Use fones de ouvido</b> e, enquanto estiver no ar, <b>mute-se no Discord</b> para os jogadores não ouvirem sua voz dupla.</p><br/>
      <div class="booth-layout">
      <div class="card">
        <div class="row" style="align-items:center;">
          <button class="btn" id="booth-mic"><svg class="icon"><use href="#i-microphone"/></svg>Ativar microfone</button>
          <span id="booth-status" class="help-text">microfone desligado</span>
        </div>
        <div class="row" style="align-items:center; margin-top:8px;">
          <select id="booth-npc" style="flex:1;"></select>
          <button class="btn small ghost" id="booth-load"><svg class="icon"><use href="#i-arrow-elbow-down-right"/></svg>Carregar preset</button>
          <button class="btn small ghost" id="booth-save"><svg class="icon"><use href="#i-floppy-disk"/></svg>Salvar no NPC</button>
        </div>
        <div class="booth-sliders">
          ${BOOTH_SLIDERS.map((s) => `
            <label>${s.label} <span id="booth-sl-${s.key}-val">${s.fmt(s.def)}</span>
              <input type="range" id="booth-sl-${s.key}" min="${s.min}" max="${s.max}" step="${s.step}" value="${s.def}" /></label>`).join('')}
        </div>
        <label style="font-size:13px;"><input type="checkbox" id="booth-monitor" /> <svg class="icon"><use href="#i-headphones"/></svg> Ouvir minha voz transformada (só com fones!)</label>
        <button class="btn danger" id="booth-onair" style="margin-top:10px; font-size:16px;"><svg class="icon"><use href="#i-record"/></svg>ENTRAR NO AR</button>
        <p class="help-text" style="margin-top:6px;">O <b>timbre</b> muda o tamanho da criatura sem mexer no tom; a <b>voz dupla</b> soma uma segunda altura à sua (oitava abaixo = monstruoso, quinta acima = celestial, meio semitom = eco de outro mundo); o <b>tremor</b> faz a voz oscilar (velhos, assombrações, quem está com medo).</p>
      </div>

      <div class="card booth-bank">
        <div class="row" style="align-items:center; gap:8px;">
          <h3 style="margin:0; flex:1;"><svg class="icon"><use href="#i-users"/></svg>Banco de vozes</h3>
          <input type="text" id="booth-preset-busca" placeholder="buscar voz..." style="width:180px;" />
          <button class="btn small ghost" id="booth-preset-reset"><svg class="icon"><use href="#i-eraser"/></svg>Voz natural</button>
        </div>
        <p class="help-text">Um clique carrega a voz nos controles ao lado — dá para ajustar depois e salvar no NPC.</p>
        <div class="sfx-cat-bar" id="booth-preset-cats"></div>
        <div class="voice-preset-grid" id="booth-preset-grid"></div>
      </div>
      </div>`;

    booth.onStatus = (msg, isError) => {
      $('#booth-status').textContent = msg;
      if (isError) toast(msg, true);
      const onAirBtn = $('#booth-onair');
      onAirBtn.innerHTML = booth.onAir
        ? '<svg class="icon"><use href="#i-stop"/></svg>SAIR DO AR'
        : '<svg class="icon"><use href="#i-record"/></svg>ENTRAR NO AR';
      onAirBtn.classList.toggle('gold', booth.onAir);
    };

    $('#booth-mic').onclick = async () => {
      if (await boothInitMic()) $('#booth-status').textContent = 'Microfone pronto. Ajuste os efeitos e entre no ar.';
    };
    for (const s of BOOTH_SLIDERS) {
      const el = $(`#booth-sl-${s.key}`);
      el.oninput = () => {
        booth.fx[s.key] = Number(el.value);
        $(`#booth-sl-${s.key}-val`).textContent = s.fmt(booth.fx[s.key]);
        // Mexeu no controle, a voz deixou de ser exatamente a do banco.
        if (boothPresetAtivo) { boothPresetAtivo = ''; renderVoicePresets(); }
        boothApplyFx();
      };
    }
    $('#booth-preset-busca').oninput = (e) => { boothPresetBusca = e.target.value; renderVoicePresets(); };
    $('#booth-preset-reset').onclick = () => {
      boothPresetAtivo = '';
      boothSetFx({});
      renderVoicePresets();
      toast('Efeitos zerados — sua voz natural.');
    };
    renderVoicePresets();
    $('#booth-monitor').onchange = (e) => boothSetMonitor(e.target.checked);
    $('#booth-onair').onclick = async () => {
      if (booth.onAir) { boothOffAir(); return; }
      await boothGoOnAir();
    };
    $('#booth-load').onclick = () => {
      const npc = state.characters.find((c) => c.id === $('#booth-npc').value);
      if (npc) boothLoadPreset(npc);
    };
    $('#booth-save').onclick = async () => {
      const id = $('#booth-npc').value;
      if (!id) return toast('Escolha um NPC primeiro.', true);
      const body = {};
      for (const s of BOOTH_SLIDERS) body[s.npc] = booth.fx[s.key];
      await tryApi(() => api(`/characters/${id}`, { method: 'PUT', body }), 'Preset de voz salvo no NPC!');
      refresh();
    };
  }
  // Atualiza a lista de NPCs preservando a seleção
  const sel = $('#booth-npc');
  const current = sel.value;
  sel.innerHTML = '<option value="">— preset de NPC —</option>' +
    state.characters.filter((c) => c.type === 'npc').map((c) =>
      `<option value="${c.id}" ${c.id === current ? 'selected' : ''}>${esc(c.name)}${c.fxPitch != null ? ' (voz configurada)' : ''}</option>`).join('');
}

function boothLoadPreset(npc) {
  // NPCs salvos antes dos efeitos novos não têm esses campos: o `??` da tabela devolve
  // o padrão de cada um, então a voz antiga continua soando igual.
  const fx = {};
  for (const s of BOOTH_SLIDERS) fx[s.key] = npc[s.npc] ?? s.def;
  boothPresetAtivo = '';
  boothSetFx(fx);
  renderVoicePresets();
  toast(`Preset de "${npc.name}" carregado.`);
}

// ---------- Mapa de batalha ----------
let bmap = null;
let mesaWs = null;
let mapRendered = false;

// Envia o estado da batalha para o servidor, que repassa para as telas dos jogadores.
function pushBattle(battle = state.battle) {
  if (mesaWs?.readyState === WebSocket.OPEN) {
    mesaWs.send(JSON.stringify({ type: 'battle', battle }));
  } else {
    api('/battle', { method: 'PUT', body: battle }).catch(() => {});
  }
}
function pushMap(map) {
  if (mesaWs?.readyState === WebSocket.OPEN) mesaWs.send(JSON.stringify({ type: 'map', map }));
  else api(`/maps/${map.id}`, { method: 'PUT', body: map }).catch(() => {});
}

// Paleta de efeitos elementais que o Mestre dispara à mão (golpes, magias...).
const FX_PALETTE = [
  { kind: 'fire',      icon: 'fire',       label: 'Fogo' },
  { kind: 'ice',       icon: 'snowflake',  label: 'Gelo' },
  { kind: 'lightning', icon: 'lightning',  label: 'Raio' },
  { kind: 'holy',      icon: 'sparkle',    label: 'Sagrado' },
  { kind: 'poison',    icon: 'skull',      label: 'Veneno' },
  { kind: 'impact',    icon: 'hand-fist',  label: 'Impacto' },
];

// Dispara um efeito visual+sonoro na tela do Mestre E repassa para a dos jogadores.
function triggerFx(kind, col, row, opts = {}) {
  const fx = { type: kind, col, row, ...opts };
  if (bmap) bmap.playFx(fx);
  if (mesaWs?.readyState === WebSocket.OPEN) mesaWs.send(JSON.stringify({ type: 'fx', fx }));
}

// Repassa a área de efeito (o template do Mestre) para a tela dos jogadores verem
// a zona atingida e quem está dentro. null limpa a área nas telas.
function pushAoe(aoe) {
  if (mesaWs?.readyState === WebSocket.OPEN) {
    mesaWs.send(JSON.stringify({ type: 'aoe', aoe: aoe ? { col: aoe.col, row: aoe.row, radius: aoe.radius } : null }));
  }
}

function connectMesa() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  mesaWs = new WebSocket(`${proto}//${location.host}/mesa`);
  mesaWs.onopen = () => mesaWs.send(JSON.stringify({ type: 'hello', role: 'dm' }));
  mesaWs.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === 'table') {
      state.battle = msg.battle;
      state.combat = msg.combat;
      if (bmap) bmap.setData({ map: msg.map, battle: msg.battle, combat: msg.combat });
      renderMapSide();
    }
  };
  mesaWs.onclose = () => setTimeout(connectMesa, 2000); // servidor reiniciou: reconecta
}

function activeMap() {
  return state.maps.find((m) => m.id === state.battle.mapId) || null;
}

function renderMapTab() {
  if (!mapRendered) {
    mapRendered = true;
    $('#tab-map').innerHTML = `
      <div class="map-layout">
        <div class="map-stage">
          <canvas id="map-canvas"></canvas>

          <!-- Barra de ferramentas flutuante no topo (quebra linha em telas estreitas) -->
          <div class="map-overlay ov-top">
            <div class="ov-panel">
              <span class="ov-group-label">Ferramentas</span>
              <button class="ov-btn tool active" data-tool="select" title="Arrastar tokens"><svg class="icon"><use href="#i-hand-palm"/></svg>Mover</button>
              <button class="ov-btn tool" data-tool="ruler" title="Medir distância (diagonal 5e)"><svg class="icon"><use href="#i-ruler"/></svg>Medir</button>
              <button class="ov-btn tool" data-tool="ping" title="Piscar um ponto na tela dos jogadores"><svg class="icon"><use href="#i-map-pin"/></svg>Ping</button>
              <button class="ov-btn tool" data-tool="aoe" title="Área de efeito (arraste do centro)"><svg class="icon"><use href="#i-target"/></svg>Área</button>
              <span class="ov-sep"></span>
              <button class="ov-btn tool" data-tool="reveal" title="Pincel: revelar névoa"><svg class="icon"><use href="#i-flashlight"/></svg>Revelar</button>
              <button class="ov-btn tool" data-tool="hide" title="Pincel: cobrir de névoa"><svg class="icon"><use href="#i-cloud-fog"/></svg>Cobrir</button>
              <span class="ov-sep"></span>
              <button class="ov-btn tool" data-tool="wall" title="Parede: arraste entre duas quinas do grid pra bloquear a visão"><svg class="icon"><use href="#i-wall"/></svg>Parede</button>
              <button class="ov-btn tool" data-tool="wall-erase" title="Apagar parede: clique numa parede pra remover"><svg class="icon"><use href="#i-eraser"/></svg>Apagar parede</button>
              <span class="ov-sep"></span>
              <button class="ov-btn" id="btn-dice-toggle" title="Painel de dados 3D — rola pra todo mundo ver"><svg class="icon"><use href="#i-dice-six"/></svg>Dados</button>
              <button class="ov-btn" id="ov-help" title="Clique num token para agir sobre ele · arraste para mover (mostra o deslocamento) · Espaço passa o turno · setas movem o selecionado · Del remove · Esc limpa a seleção"><svg class="icon"><use href="#i-question"/></svg>Ajuda</button>
            </div>
            <div class="ov-panel">
              <span class="ov-group-label">Mapa</span>
              <select id="map-select" title="Mapa em jogo"></select>
              <button class="ov-btn gold" id="btn-map-activate" title="Colocar este mapa em jogo">▶ Em jogo</button>
              <button class="ov-btn" id="btn-new-map" title="Criar um novo mapa">+ Novo</button>
              <button class="ov-btn" id="btn-sample-maps" title="Mapas prontos de exemplo"><svg class="icon"><use href="#i-books"/></svg>Exemplos</button>
              <button class="ov-btn" id="btn-edit-map" title="Editar o grid do mapa"><svg class="icon"><use href="#i-grid-four"/></svg>Grid</button>
              <button class="ov-btn" id="btn-img-toggle" title="Ajustar a imagem do mapa ao grid"><svg class="icon"><use href="#i-image"/></svg>Imagem</button>
              <span class="ov-sep"></span>
              <button class="ov-btn" id="btn-map-fit" title="Enquadrar o mapa na tela"><svg class="icon"><use href="#i-arrows-out"/></svg>Enquadrar</button>
              <button class="ov-btn danger" id="btn-del-map" title="Excluir este mapa"><svg class="icon"><use href="#i-trash"/></svg>Excluir</button>
            </div>
            <div class="ov-panel">
              <span class="ov-group-label">Visão dos jogadores</span>
              <label class="tool-check" title="Névoa de guerra pintada à mão"><input type="checkbox" id="fog-enabled" /> <svg class="icon"><use href="#i-cloud-fog"/></svg> Névoa</label>
              <button class="ov-btn" id="btn-fog-all" title="Revelar o mapa inteiro"><svg class="icon"><use href="#i-sun"/></svg>Revelar tudo</button>
              <button class="ov-btn" id="btn-fog-none" title="Cobrir o mapa inteiro"><svg class="icon"><use href="#i-moon"/></svg>Cobrir tudo</button>
              <span class="ov-sep"></span>
              <label class="tool-check" title="Cada personagem revela um raio ao redor de si; o resto fica na névoa"><input type="checkbox" id="vision-enabled" /> <svg class="icon"><use href="#i-eye"/></svg> Visão</label>
              <label class="sr-only" for="vision-radius">Raio de visão dos personagens (metros)</label>
              <input type="number" id="vision-radius" min="3" max="60" step="1" class="vision-radius-input" title="Raio de visão dos personagens (metros)" /><span class="ov-label">m</span>
              <span class="ov-sep"></span>
              <label class="tool-check" title="Mostrar os números de PV dos inimigos aos jogadores"><input type="checkbox" id="show-enemy-hp" /> <svg class="icon"><use href="#i-heart-straight"/></svg> PV inimigos</label>
            </div>
            <div class="ov-panel">
              <span class="ov-group-label">Jogadores</span>
              <a class="ov-btn" href="/mesa.html" target="_blank" title="Abrir a tela dos jogadores (segunda tela / Discord)"><svg class="icon"><use href="#i-desktop"/></svg>Tela dos jogadores</a>
              <span class="ov-sep"></span>
              <label class="tool-check" title="Manda uma DM no Discord pro jogador vinculado quando chega a vez dele — com PV, CA, condições e as magias/habilidades da ficha"><input type="checkbox" id="turn-dm" /> <svg class="icon"><use href="#i-paper-plane-tilt"/></svg> Avisar turno por DM</label>
              <span class="ov-sep"></span>
              <button class="ov-btn" id="btn-sound-toggle" title="Soundboard: solta efeitos no canal de voz (atalhos 1-9)"><svg class="icon"><use href="#i-speaker-high"/></svg>Sons</button>
            </div>
            <div class="ov-panel ov-img hidden" id="img-align">
              <span class="ov-label">Ajustar imagem:</span>
              <button class="ov-btn" data-img="left" title="Mover à esquerda">◀</button>
              <button class="ov-btn" data-img="right" title="Mover à direita">▶</button>
              <button class="ov-btn" data-img="up" title="Mover para cima">▲</button>
              <button class="ov-btn" data-img="down" title="Mover para baixo">▼</button>
              <button class="ov-btn" data-img="out" title="Diminuir"><svg class="icon"><use href="#i-minus"/></svg></button>
              <button class="ov-btn" data-img="in" title="Aumentar"><svg class="icon"><use href="#i-plus"/></svg></button>
              <button class="ov-btn" data-img="auto" title="Esticar para preencher o grid"><svg class="icon"><use href="#i-arrows-out"/></svg>Encaixar</button>
            </div>
          </div>

          <!-- Rodapé flutuante: soundboard sempre empilhado ACIMA da barra de dados (nunca
               ao lado, mesmo se o soundboard for redimensionado) — e o HUD de turno alinhado
               com a base desse empilhado, no canto inferior direito. -->
          <div class="map-overlay ov-bottom">
            <div class="ov-bottom-stack">
              <div class="ov-panel ov-sounds hidden" id="soundboard-panel"></div>
              <div class="ov-panel dice-panel hidden" id="dice-panel"></div>
            </div>
            <div id="combat-hud" class="combat-hud"></div>
          </div>

          <!-- Palco dos dados 3D — some quando não há rolagem ativa (só troca opacidade,
               nunca display:none, senão a biblioteca perde o tamanho do canvas). -->
          <div class="dice-tray-stage" id="dice-tray">
            <div class="dice-tray-box">
              <div id="dice-tray-canvas"></div>
              <div class="dice-tray-result" id="dice-tray-result"></div>
            </div>
          </div>
        </div>
        <div class="map-resize-handle" id="map-resize-handle"></div>
        <aside class="map-side" id="map-side">
          <div id="token-panel"></div>
          <div id="aoe-panel"></div>
          <div id="combat-order"></div>
          <div id="loose-tokens"></div>
          <div class="side-section combat-log-section" id="combat-log-panel"></div>
        </aside>
      </div>`;

    const canvas = $('#map-canvas');
    bmap = new BattleMap(canvas, { isDm: true });

    bmap.onTokenMove = (id, col, row) => {
      const t = state.battle.tokens.find((x) => x.id === id);
      if (t) { t.col = col; t.row = row; pushBattle(); }
    };
    bmap.onFogPaint = (cells, reveal) => {
      const map = activeMap();
      if (!map) return;
      const set = new Set(map.fog?.revealed || []);
      for (const c of cells) { if (reveal) set.add(c); else set.delete(c); }
      map.fog = { enabled: map.fog?.enabled ?? true, revealed: [...set] };
      pushMap(map);
    };
    bmap.onWallsChange = (walls) => {
      const map = activeMap();
      if (!map) return;
      map.walls = walls;
      pushMap(map);
    };
    bmap.onPing = (col, row) => {
      if (mesaWs?.readyState === WebSocket.OPEN) mesaWs.send(JSON.stringify({ type: 'ping', col, row }));
    };
    bmap.onTokenClick = (t) => tokenModal(t);
    bmap.onSelect = () => renderTokenPanel();
    bmap.onAoe = () => { renderAoePanel(); pushAoe(bmap.aoe); };

    // Atalhos: o Mestre roda o combate sem tirar a mão do mapa
    document.addEventListener('keydown', (e) => {
      const naAba = $('#tab-map').classList.contains('active');
      const digitando = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '');
      if (!naAba || digitando || $('#modal-backdrop').classList.contains('hidden') === false) return;

      const sel = bmap.tokenById(bmap.selectedId);
      // 1-9 soltam os efeitos do soundboard na voz, seguindo a lista visível
      // (filtrou "sword" e apertou 1 = primeiro resultado do filtro)
      if (/^[1-9]$/.test(e.key)) {
        const sfx = sbVisiveis()[Number(e.key) - 1];
        if (sfx) { e.preventDefault(); tocarSfx(sfx); }
        return;
      }
      if (e.key === ' ') { e.preventDefault(); nextTurn(1); }
      else if (e.key === 'Escape') { bmap.select(null); bmap.setAoe(null); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && sel) {
        e.preventDefault();
        removeToken(sel.id);
      } else if (sel && e.key.startsWith('Arrow')) {
        e.preventDefault();
        const dc = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
        const dr = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0;
        const map = activeMap();
        sel.col = Math.max(0, Math.min(map.cols - (sel.size || 1), sel.col + dc));
        sel.row = Math.max(0, Math.min(map.rows - (sel.size || 1), sel.row + dr));
        pushBattle();
        bmap.draw();
      }
    });

    $$('#tab-map .tool').forEach((b) => b.onclick = () => {
      $$('#tab-map .tool').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      bmap.tool = b.dataset.tool;
    });

    $('#btn-new-map').onclick = () => mapModal();
    $('#btn-sample-maps').onclick = () => sampleMapsModal();
    $('#btn-edit-map').onclick = () => {
      const m = state.maps.find((x) => x.id === $('#map-select').value);
      if (m) mapModal(m); else toast('Crie um mapa primeiro.', true);
    };
    $('#btn-del-map').onclick = async () => {
      const id = $('#map-select').value;
      if (!id) return;
      if (confirm('Excluir este mapa?')) {
        await tryApi(() => api(`/maps/${id}`, { method: 'DELETE' }), 'Mapa excluído.');
        refresh();
      }
    };
    $('#btn-map-activate').onclick = async () => {
      const mapId = $('#map-select').value;
      if (!mapId) return toast('Crie um mapa primeiro.', true);
      state.battle = { ...state.battle, mapId };
      await tryApi(() => api('/battle', { method: 'PUT', body: { mapId } }), 'Mapa em jogo — os jogadores já estão vendo.');
      refresh();
      setTimeout(() => bmap.fit(), 50);
    };
    $('#btn-map-fit').onclick = () => bmap.fit();

    $('#fog-enabled').onchange = (e) => {
      const map = activeMap();
      if (!map) return;
      map.fog = { enabled: e.target.checked, revealed: map.fog?.revealed || [] };
      pushMap(map);
      toast(e.target.checked ? 'Névoa ligada — use o pincel Revelar para abrir caminho.' : 'Névoa desligada.');
    };
    const setFogAll = (reveal) => {
      const map = activeMap();
      if (!map) return;
      const cells = [];
      if (reveal) for (let c = 0; c < map.cols; c++) for (let r = 0; r < map.rows; r++) cells.push(`${c},${r}`);
      map.fog = { enabled: map.fog?.enabled ?? true, revealed: cells };
      pushMap(map);
    };
    $('#btn-fog-all').onclick = () => setFogAll(true);
    $('#btn-fog-none').onclick = () => setFogAll(false);

    $('#vision-enabled').onchange = (e) => {
      const atual = state.battle.vision || { radius: 12 };
      state.battle.vision = { ...atual, enabled: e.target.checked };
      pushBattle();
      toast(e.target.checked
        ? 'Visão automática ligada — os jogadores só veem ao redor dos personagens.'
        : 'Visão automática desligada — os jogadores voltam a ver o mapa todo (ou a névoa manual).');
    };
    $('#vision-radius').onchange = (e) => {
      const r = Math.max(3, Math.min(60, Number(e.target.value) || 12));
      e.target.value = r;
      state.battle.vision = { ...(state.battle.vision || { enabled: true }), radius: r };
      pushBattle();
    };

    $('#show-enemy-hp').onchange = (e) => {
      state.battle.showEnemyHp = e.target.checked;
      pushBattle();
      toast(e.target.checked
        ? 'Os jogadores agora veem os PV exatos dos inimigos.'
        : 'Os jogadores voltam a ver só o estado dos inimigos (Ferido, Quase morto...).');
    };

    $('#turn-dm').onchange = (e) => {
      state.battle.turnDm = e.target.checked;
      pushBattle();
      toast(e.target.checked
        ? 'Vou avisar cada jogador por DM quando chegar a vez dele.'
        : 'Aviso de turno por DM desligado.');
    };

    // Botão de som mostra/esconde o soundboard de batalha
    $('#btn-sound-toggle').onclick = () => {
      const p = $('#soundboard-panel');
      p.classList.toggle('hidden');
      $('#btn-sound-toggle').classList.toggle('active', !p.classList.contains('hidden'));
    };

    // Botão de dados mostra/esconde o painel de rolagem 3D
    $('#btn-dice-toggle').onclick = () => {
      const p = $('#dice-panel');
      p.classList.toggle('hidden');
      $('#btn-dice-toggle').classList.toggle('active', !p.classList.contains('hidden'));
    };

    // Botão de imagem mostra/esconde os controles de alinhar a imagem do mapa
    $('#btn-img-toggle').onclick = () => {
      const p = $('#img-align');
      p.classList.toggle('hidden');
      $('#btn-img-toggle').classList.toggle('active', !p.classList.contains('hidden'));
    };

    // Alinhar a imagem ao grid (mapas gerados por IA quase nunca vêm no encaixe exato)
    $$('#img-align [data-img]').forEach((b) => b.onclick = () => {
      const map = activeMap();
      if (!map) return toast('Coloque um mapa em jogo primeiro.', true);
      const img = { x: 0, y: 0, scale: 1, ...(map.img || {}) };
      const step = 8;
      const a = b.dataset.img;
      if (a === 'left') img.x -= step;
      else if (a === 'right') img.x += step;
      else if (a === 'up') img.y -= step;
      else if (a === 'down') img.y += step;
      else if (a === 'in') img.scale *= 1.02;
      else if (a === 'out') img.scale /= 1.02;
      else if (a === 'auto') {
        const src = map.filename ? `/map-files/${map.filename}` : map.imageUrl;
        if (!src) return toast('Este mapa não tem imagem.', true);
        const probe = new Image();
        probe.onload = () => {
          const size = Grid.mapPixelSize(map);
          map.img = {
            x: 0,
            y: 0,
            scale: Math.max(size.w / probe.naturalWidth, size.h / probe.naturalHeight),
          };
          pushMap(map);
        };
        probe.src = src;
        return;
      }
      map.img = img;
      pushMap(map);
    });

    // Resize da sidebar arrastando a alça
    (() => {
      const handle = $('#map-resize-handle');
      const side = $('#map-side');
      if (!handle || !side) return;
      let dragging = false;
      let startX = 0;
      let startW = 0;
      handle.addEventListener('mousedown', (e) => {
        dragging = true;
        startX = e.clientX;
        startW = side.offsetWidth;
        handle.classList.add('dragging');
        document.body.style.userSelect = 'none';
        document.body.style.cursor = 'col-resize';
      });
      document.addEventListener('mousemove', (e) => {
        if (!dragging) return;
        const delta = startX - e.clientX;
        const newW = Math.max(220, Math.min(520, startW + delta));
        side.style.width = newW + 'px';
        side.style.minWidth = newW + 'px';
        if (bmap) bmap.resize();
      });
      document.addEventListener('mouseup', () => {
        if (!dragging) return;
        dragging = false;
        handle.classList.remove('dragging');
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
        if (bmap) bmap.resize();
      });
    })();
  }

  // Lista de mapas (preservando a seleção)
  const sel = $('#map-select');
  const current = sel.value || state.battle.mapId || '';
  sel.innerHTML = state.maps.length
    ? state.maps.map((m) => `<option value="${m.id}" ${m.id === current ? 'selected' : ''}>${m.id === state.battle.mapId ? '▶ ' : ''}${esc(m.name)} (${m.cols}×${m.rows})</option>`).join('')
    : '<option value="">— nenhum mapa —</option>';

  const map = activeMap();
  $('#fog-enabled').checked = Boolean(map?.fog?.enabled);
  $('#show-enemy-hp').checked = Boolean(state.battle.showEnemyHp);
  $('#turn-dm').checked = Boolean(state.battle.turnDm);
  $('#vision-enabled').checked = Boolean(state.battle.vision?.enabled);
  $('#vision-radius').value = state.battle.vision?.radius ?? 12;
  bmap.setData({ map, battle: state.battle, combat: state.combat });
  renderSoundboard();
  renderDicePanel();
  renderMapSide();
}

// ---------- Soundboard de batalha ----------
// Efeitos one-shot no canal de voz, sem sair do mapa. As abas de categoria filtram por
// contexto (combate, criaturas...) e o campo de busca refina por nome/tag dentro dela.
// Se não achar, o mesmo termo vai ao Freesound: importa (já na categoria da aba aberta)
// e toca na hora. Os 9 primeiros da lista visível ganham atalho numérico.
let sbFiltro = '';
let sbCategoria = 'todos';
let sbPreview = null;

const sbVisiveis = () => {
  const porCategoria = (state.audio || []).filter((a) => a.type === 'sfx'
    && (sbCategoria === 'todos' || sfxCategory(a.category).value === sbCategoria));
  const q = sbFiltro.trim().toLowerCase();
  if (!q) return porCategoria;
  return porCategoria.filter((a) => a.name.toLowerCase().includes(q)
    || (a.tags || []).some((t) => t.toLowerCase().includes(q)));
};

function tocarSfx(audio) {
  if (!audio) return;
  if (!state.bot?.connected) return toast('O bot está desconectado — sem som no Discord.', true);
  tryApi(() => api(`/sound/play/${audio.id}`, { method: 'POST' }), audio.name);
}

// Busca no Freesound o que está no filtro e deixa importar na hora.
async function sbBuscarFreesound() {
  const q = sbFiltro.trim();
  const box = $('#sb-fs-results');
  if (!box) return;
  if (!q) return toast('Digite o que procura — ex: sword, thunder, scream (em inglês acha mais).', true);
  box.innerHTML = '<span class="ov-label">Buscando no Freesound…</span>';
  const results = await tryApi(() => api(`/freesound/search?q=${encodeURIComponent(q)}`));
  if (!results) { box.innerHTML = ''; return; }
  if (!results.length) { box.innerHTML = '<span class="ov-label">Nada encontrado no Freesound.</span>'; return; }

  box.innerHTML = results.slice(0, 6).map((s, i) => `
    <div class="sb-fs-row">
      <button class="ov-btn" data-fs-prev="${i}" title="Ouvir só na sua máquina (a mesa não escuta)">▶</button>
      <span class="sb-fs-name" title="${esc(s.name)} · ${Math.round(s.duration)}s · por ${esc(s.username)}">
        ${esc(s.name.replace(/_/g, ' ').slice(0, 30))}${s.name.length > 30 ? '…' : ''}
        <small>${Math.round(s.duration)}s</small>
      </span>
      <button class="ov-btn gold" data-fs-use="${i}" title="Baixar para a biblioteca e já usar"><svg class="icon"><use href="#i-download-simple"/></svg>Usar</button>
    </div>`).join('')
    + '<button class="ov-btn" id="sb-fs-close" title="Fechar os resultados"><svg class="icon"><use href="#i-x"/></svg>Fechar busca</button>';

  $$('#sb-fs-results [data-fs-prev]').forEach((b) => b.onclick = () => {
    const s = results[Number(b.dataset.fsPrev)];
    if (sbPreview) sbPreview.pause();
    sbPreview = new Audio(s.previewUrl);
    sbPreview.play().catch(() => toast('Não consegui tocar a prévia.', true));
  });

  $$('#sb-fs-results [data-fs-use]').forEach((b) => b.onclick = async () => {
    const s = results[Number(b.dataset.fsUse)];
    b.disabled = true; b.textContent = 'Baixando…';
    const r = await tryApi(() => api('/freesound/import', {
      method: 'POST',
      body: { name: s.name, previewUrl: s.previewUrl, type: 'sfx', category: sbCategoria === 'todos' ? 'geral' : sbCategoria, tags: s.tags },
    }));
    if (!r) { b.disabled = false; b.textContent = 'Usar'; return; }
    if (sbPreview) { sbPreview.pause(); sbPreview = null; }
    box.innerHTML = '';
    await refresh(); // a biblioteca recarrega e o som já aparece no soundboard
    toast(`"${s.name}" está no soundboard — aperte a tecla dele para tocar!`);
  });

  $('#sb-fs-close').onclick = () => { box.innerHTML = ''; };
}

function renderSoundboard() {
  const el = $('#soundboard-panel');
  if (!el) return;
  // A estrutura é montada uma vez só: assim o campo de busca não perde o texto
  // nem o foco a cada atualização da mesa. Depois só a lista é redesenhada.
  if (!el.dataset.built) {
    el.dataset.built = '1';
    el.innerHTML = `
      <div class="sb-head">
        <span class="ov-label"><svg class="icon"><use href="#i-speaker-high"/></svg> Efeitos</span>
        <label class="sr-only" for="sb-search">Filtrar efeitos ou buscar som novo</label>
        <input id="sb-search" class="sb-search" placeholder="filtrar ou buscar som novo…" />
        <button class="ov-btn" id="sb-fs" title="Buscar este termo no Freesound e usar na hora"><svg class="icon"><use href="#i-magnifying-glass"/></svg>Freesound</button>
        <button class="ov-btn danger" id="sb-stop" title="Parar tudo que está tocando"><svg class="icon"><use href="#i-stop"/></svg></button>
      </div>
      <div class="sfx-cat-bar sb-cat-bar" id="sb-cat-bar"></div>
      <div class="sb-list" id="sb-list"></div>
      <div class="sb-fs-results" id="sb-fs-results"></div>`;
    $('#sb-search').oninput = (e) => { sbFiltro = e.target.value; renderSbList(); };
    $('#sb-search').onkeydown = (e) => { if (e.key === 'Enter') sbBuscarFreesound(); };
    $('#sb-fs').onclick = () => sbBuscarFreesound();
    $('#sb-stop').onclick = () => tryApi(() => api('/sound/stop', { method: 'POST' }), 'Som parado.');

    $('#sb-cat-bar').innerHTML = [{ value: 'todos', label: 'Todos', icon: 'waveform' }, ...SFX_CATEGORIES]
      .map((c) => sfxCategoryChip(c, sbCategoria === c.value)).join('');
    $('#sb-cat-bar').onclick = (e) => {
      const b = e.target.closest('[data-cat]');
      if (!b) return;
      sbCategoria = b.dataset.cat;
      $$('#sb-cat-bar [data-cat]').forEach((x) => x.classList.toggle('active', x.dataset.cat === sbCategoria));
      renderSbList();
    };
  }
  renderSbList();
}

function renderSbList() {
  const box = $('#sb-list');
  if (!box) return;
  const sfx = sbVisiveis();
  const total = (state.audio || []).filter((a) => a.type === 'sfx').length;
  box.innerHTML = sfx.length
    ? sfx.map((a, i) => `
      <button class="ov-btn sfx-btn" data-sfx-play="${a.id}" title="${esc(a.name)}${(a.tags || []).length ? ` · ${esc(a.tags.join(', '))}` : ''}">
        ${i < 9 ? `<kbd class="sfx-key">${i + 1}</kbd>` : ''}${esc(a.name.replace(/_/g, ' ').slice(0, 22))}${a.name.length > 22 ? '…' : ''}
      </button>`).join('')
    : `<span class="ov-label">${total
        ? `Nenhum som ${sbFiltro ? `com “${esc(sbFiltro)}” ` : ''}${sbCategoria !== 'todos' ? `em ${esc(sfxCategory(sbCategoria).label)} ` : ''}— use o Freesound para achar um novo.`
        : 'Biblioteca vazia — busque um som no Freesound.'}</span>`;

  $$('#sb-list [data-sfx-play]').forEach((b) => b.onclick = () =>
    tocarSfx(sfx.find((a) => a.id === b.dataset.sfxPlay)));
}

// ---------- Dados 3D ----------
// Painel de rolagem rápida sobre o mapa: escolhe o dado, ajusta quantidade/modificador
// e rola. O resultado sai do mesmo /api/roll da rolagem rápida da barra de som — o dado
// 3D nunca mostra um número diferente do que foi de fato sorteado (e, se marcado,
// anunciado no Discord). A animação 3D é só a "pele": physics real em cada tela, mas
// forçada (via Dice3D) a pousar nos valores que o servidor já sorteou.
const DICE_SET = [4, 6, 8, 10, 12, 20, 100];
let diceSides = 20;
let diceQty = 1;
let diceMod = 0;

function renderDicePanel() {
  const el = $('#dice-panel');
  if (!el) return;
  if (!el.dataset.built) {
    el.dataset.built = '1';
    el.innerHTML = `
      <span class="ov-label"><svg class="icon"><use href="#i-dice-six"/></svg> Dados</span>
      <div class="dice-face-row">
        ${DICE_SET.map((s) => `<button class="ov-btn dice-face${s === diceSides ? ' active' : ''}" data-sides="${s}">d${s}</button>`).join('')}
      </div>
      <input type="number" id="dice-qty" class="dice-num" min="1" max="20" value="${diceQty}" title="Quantidade de dados" />
      <span class="ov-label">×</span>
      <input type="number" id="dice-mod" class="dice-num" value="${diceMod}" title="Modificador (+/-)" />
      <label class="tool-check" title="Também posta o resultado no canal de texto do Discord"><input type="checkbox" id="dice-announce" /> Discord</label>
      <button class="ov-btn gold" id="dice-roll-btn"><svg class="icon"><use href="#i-dice-six"/></svg>Rolar</button>`;

    $$('#dice-panel .dice-face').forEach((b) => b.onclick = () => {
      diceSides = Number(b.dataset.sides);
      $$('#dice-panel .dice-face').forEach((x) => x.classList.toggle('active', Number(x.dataset.sides) === diceSides));
    });
    $('#dice-qty').onchange = (e) => { diceQty = Math.max(1, Math.min(20, Number(e.target.value) || 1)); e.target.value = diceQty; };
    $('#dice-mod').onchange = (e) => { diceMod = Number(e.target.value) || 0; };
    $('#dice-roll-btn').onclick = rollDice3d;
  }
}

async function rollDice3d() {
  const sinal = diceMod > 0 ? '+' : '';
  const expr = `${diceQty}d${diceSides}${diceMod ? `${sinal}${diceMod}` : ''}`;
  const announce = Boolean($('#dice-announce')?.checked);
  const r = await tryApi(() => api('/roll', { method: 'POST', body: { expr, announce } }));
  if (!r) return;
  const dice = { sides: diceSides, count: diceQty, rolls: r.rolls, mod: r.mod, total: r.total, roller: 'Mestre' };
  Dice3D.roll(dice);
  if (mesaWs?.readyState === WebSocket.OPEN) mesaWs.send(JSON.stringify({ type: 'diceRoll', dice }));
}

// ---------- Gerenciamento do combate pelo mapa ----------
function renderMapSide() {
  renderCombatHud();
  renderTokenPanel();
  renderAoePanel();
  renderCombatOrder();
  renderLooseTokens();
  renderCombatLog();
}

const tokenOf = (name) => state.battle.tokens.find((t) => (t.combatName || t.name) === name);
const entryOf = (t) => state.combat.entries.find((e) => e.name === (t.combatName || t.name));

// Busca (e cacheia no servidor) a arte oficial do monstro do SRD. Silencioso: se não
// houver imagem, devolve vazio sem incomodar o Mestre.
async function srdImage(index) {
  if (!index) return '';
  try { const r = await api(`/srd/monsters/${index}/image`); return r?.url || ''; }
  catch { return ''; }
}

// Retrato de um combatente: token > arte guardada no entry > retrato do personagem.
function retratoDe(entry, tok) {
  return tok?.imageUrl || entry?.imageUrl || state.characters.find((c) => c.name === entry?.name)?.imageUrl || '';
}

// Personagem vinculado a um entry (por id, ou pelo nome como fallback).
const charDoEntry = (e) => (e?.charId && state.characters.find((c) => c.id === e.charId))
  || state.characters.find((c) => c.name === e?.name)
  || null;

// Personagem vinculado a um token do mapa — via o entry da iniciativa, o charId do
// próprio token, ou o nome como último recurso (token solto, ainda fora do combate).
const charDoToken = (t) => charDoEntry(entryOf(t))
  || (t?.charId && state.characters.find((c) => c.id === t.charId))
  || state.characters.find((c) => c.name === (t?.combatName || t?.name))
  || null;

// A partir de um entry da iniciativa, monta os campos do token (tipo, retrato...).
async function tokenSeed(e) {
  const ch = charDoEntry(e);
  let kind = 'enemy';
  if (e.isPc) kind = 'pc';
  else if (ch) kind = kindDoPersonagem(ch);
  const imageUrl = ch?.imageUrl || e.imageUrl || await srdImage(e.srdIndex);
  return { kind, imageUrl, charId: e.charId };
}

// Coloca no mapa o token de um combatente da iniciativa (se ainda não estiver lá).
async function placeOnMap(entry) {
  const map = activeMap();
  if (!map) return toast('Coloque um mapa em jogo primeiro.', true);
  if (tokenOf(entry.name)) return; // já está no mapa
  const seed = await tokenSeed(entry);
  state.battle.tokens.push({
    id: Math.random().toString(16).slice(2, 10),
    name: entry.name,
    combatName: entry.name,
    ...nextTokenSlot(map, occupiedCells()),
    size: 1, hidden: false, color: '',
    hp: entry.hp, maxHp: entry.maxHp,
    ...seed,
  });
  pushBattle();
  renderMapSide();
}

// Coloca no mapa todos os combatentes que ainda não têm token.
async function placeAllOnMap() {
  const map = activeMap();
  if (!map) return toast('Coloque um mapa em jogo primeiro.', true);
  const faltando = state.combat.entries.filter((e) => !tokenOf(e.name));
  if (!faltando.length) return;
  const defs = await Promise.all(faltando.map(async (e) => ({
    name: e.name,
    hp: e.hp, maxHp: e.maxHp,
    combatName: e.name,
    ...(await tokenSeed(e)),
  })));
  addTokens(defs);
}

async function saveCombatState() {
  await tryApi(() => api('/combat', { method: 'PUT', body: state.combat }));
}

// ---------- Log de combate ----------
// Um histórico de tudo que rola na luta (dano, cura, condição, turno, morte...). Vive
// dentro de state.combat pra viajar junto no mesmo PUT/broadcast que já existe — sem
// rota nova, sem diffing no servidor. Sobrevive ao fim do combate (só limpa se o Mestre
// pedir): é justamente o "ficou registrado" que se quer depois da luta.
function logCombat(text) {
  if (!state.combat.log) state.combat.log = [];
  state.combat.log.push({ ts: Date.now(), round: state.combat.round, turn: state.combat.turn, text });
  if (state.combat.log.length > 500) state.combat.log.splice(0, state.combat.log.length - 500);
  renderCombatLog();
}

function fmtLogTime(ts) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function renderCombatLog() {
  const el = $('#combat-log-panel');
  if (!el) return;
  const log = state.combat.log || [];
  if (!el.dataset.built) {
    el.dataset.built = '1';
    el.innerHTML = `
      <div class="side-section-label">
        <span>Log de combate</span>
        <span class="row" style="gap:4px;margin:0;">
          <button class="btn small ghost" id="log-copy" title="Copiar o log inteiro"><svg class="icon"><use href="#i-clipboard-text"/></svg></button>
          <button class="btn small ghost danger" id="log-clear" title="Limpar o log"><svg class="icon"><use href="#i-trash"/></svg></button>
        </span>
      </div>
      <div class="combat-log-list" id="combat-log-list"></div>`;
    $('#log-copy').onclick = () => {
      const text = (state.combat.log || []).map((l) => `[R${l.round}] ${fmtLogTime(l.ts)} — ${l.text}`).join('\n');
      navigator.clipboard.writeText(text || '(log vazio)')
        .then(() => toast('Log copiado!'))
        .catch(() => toast('Não consegui copiar — copie manualmente.', true));
    };
    $('#log-clear').onclick = () => {
      if (!(state.combat.log || []).length) return;
      if (confirm('Limpar o log de combate? Não dá pra desfazer.')) {
        state.combat.log = [];
        saveCombatState();
        renderCombatLog();
      }
    };
  }
  const list = $('#combat-log-list');
  list.innerHTML = log.length
    ? log.map((l) => `<div class="combat-log-row"><span class="combat-log-time">R${l.round} · ${fmtLogTime(l.ts)}</span>${esc(l.text)}</div>`).join('')
    : '<div class="help-text" style="padding:6px 2px;">Nada registrado ainda — as ações da luta vão aparecer aqui.</div>';
  list.scrollTop = list.scrollHeight;
}

function focusTurn() {
  const e = state.combat.entries[state.combat.turn];
  if (!e) return;
  const t = tokenOf(e.name);
  if (t) { bmap.select(t.id); bmap.centerOn(t.col, t.row); }
}

async function nextTurn(dir) {
  const c = state.combat;
  if (!c.entries.length) return toast('Ninguém na iniciativa ainda.', true);
  const n = c.entries.length;
  const antes = c.turn;
  c.turn = (c.turn + dir + n) % n;
  if (dir > 0 && c.turn === 0) c.round += 1;
  if (dir < 0 && antes === 0) c.round = Math.max(1, c.round - 1);

  const atual = c.entries[c.turn];
  if (atual?.conditions?.length) toast(`${atual.name} está: ${atual.conditions.join(', ')}`);
  logCombat(`Rodada ${c.round} — vez de ${atual?.name || '?'}`);
  await saveCombatState();
  renderMapSide();
  focusTurn();
}

// Rola a iniciativa dos inimigos e ordena a mesa inteira
async function rollInitiative() {
  const c = state.combat;
  if (!c.entries.length) return toast('Adicione combatentes à lista de iniciativa primeiro.', true);
  // Rola d20 (+ modificador, quando houver) para TODO mundo do combate e ordena.
  for (const e of c.entries) {
    e.init = d20() + (e.initMod || 0);
  }
  c.entries.sort((a, b) => b.init - a.init);
  c.turn = 0;
  c.round = 1;
  logCombat(`Iniciativa rolada: ${c.entries.map((e) => `${e.name} (${e.init})`).join(' → ')}`);
  await saveCombatState();
  renderMapSide();
  await refresh();
  toast('Iniciativa rolada para todos! Ordem: ' + c.entries.map((e) => `${e.name} (${e.init})`).join(' → '));
  focusTurn();
}

// Dano (negativo) ou cura (positivo). Escreve na iniciativa quando o token está ligado a ela,
// senão no próprio token — assim o mapa e a aba Iniciativa nunca divergem.
async function applyHp(tokens, delta) {
  if (!tokens.length || !delta) return;
  let mexeuNoCombate = false;
  let mexeuNoToken = false;
  // Um aviso só: concentração e quedas precisam aparecer junto com o dano, não no lugar dele.
  const avisos = [];

  for (const t of tokens) {
    const e = entryOf(t);
    const alvo = e || t;
    const max = Number(alvo.maxHp) || 0;
    const atual = Number(alvo.hp) || 0;
    const novo = Math.max(0, max ? Math.min(max, atual + delta) : atual + delta);

    let linha = delta < 0
      ? `${t.name} tomou ${-delta} de dano (${novo}${max ? `/${max}` : ''} PV)`
      : `${t.name} recuperou ${delta} PV (${novo}${max ? `/${max}` : ''} PV)`;
    if (delta < 0 && alvo.concentration) {
      const cd = Math.max(10, Math.floor(-delta / 2));
      avisos.push(`${t.name}: salvaguarda de CON CD ${cd} para manter a concentração`);
      linha += ` — CD ${cd} de concentração`;
    }
    if (novo <= 0 && atual > 0) {
      alvo.deathSaves = { s: 0, f: 0 };
      avisos.push(`${t.name} caiu`);
      linha += ' — caiu!';
    }
    logCombat(linha);
    alvo.hp = novo;
    if (e) {
      t.hp = novo; // espelha no token para o canvas repintar imediatamente
      mexeuNoCombate = true;
    } else {
      mexeuNoToken = true;
    }
    // Feedback visual + sonoro no token (número flutuante e impacto/cura)
    if (delta < 0) triggerFx('impact', t.col, t.row, { size: t.size || 1, text: `-${-delta}`, textCol: '#ff6b6b' });
    else triggerFx('heal', t.col, t.row, { size: t.size || 1, text: `+${delta}`, textCol: '#86efac' });
  }

  // pushBattle ANTES do await para capturar o HP mutado antes que um broadcast reverta o state.battle
  if (mexeuNoToken || mexeuNoCombate) pushBattle();
  if (mexeuNoCombate) await saveCombatState();
  if (bmap) bmap.draw();
  renderMapSide();

  const verbo = delta < 0 ? `${-delta} de dano` : `${delta} de cura`;
  const alvosTxt = tokens.map((t) => t.name).join(', ');
  toast([`${verbo} em ${alvosTxt}.`, ...avisos].join(' · '), avisos.length > 0);
}

async function toggleCondition(t, cond) {
  const alvo = entryOf(t) || t;
  const atuais = alvo.conditions || [];
  const ligando = !atuais.includes(cond);
  alvo.conditions = ligando ? [...atuais, cond] : atuais.filter((x) => x !== cond);
  logCombat(`${t.name} ${ligando ? 'ficou' : 'não está mais'} ${cond}`);
  if (entryOf(t)) await saveCombatState(); else pushBattle();
  renderMapSide();
}

function removeToken(id) {
  state.battle.tokens = state.battle.tokens.filter((x) => x.id !== id);
  if (bmap.selectedId === id) bmap.select(null);
  pushBattle();
  renderMapSide();
}

function duplicateToken(id) {
  const t = state.battle.tokens.find((x) => x.id === id);
  if (!t) return;
  const map = activeMap();
  if (!map) return toast('Coloque um mapa em jogo primeiro.', true);
  const baseName = t.name.replace(/\s+\d+$/, '');
  const count = state.battle.tokens.filter((x) => x.name === baseName || x.name.match(new RegExp(`^${baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+\\d+$`))).length;
  const newName = `${baseName} ${count + 1}`;
  const copy = {
    ...t,
    id: Math.random().toString(16).slice(2, 10),
    name: newName,
    combatName: '',
    col: Math.min(map.cols - 1, t.col + (t.size || 1)),
    row: t.row,
    hp: t.maxHp,
    conditions: [],
    concentration: false,
  };
  state.battle.tokens.push(copy);
  pushBattle();
  renderMapSide();
  toast(`${newName} duplicado no mapa.`);
}

function renderCombatHud() {
  const el = $('#combat-hud');
  if (!el) return;
  const c = state.combat;
  // Sem combate, o HUD some do mapa (:empty) — só aparece quando há iniciativa rolando.
  if (!c.entries.length) { el.innerHTML = ''; return; }
  const atual = c.entries[c.turn];
  const proximo = c.entries.length > 1 ? c.entries[(c.turn + 1) % c.entries.length] : null;
  const t = atual ? tokenOf(atual.name) : null;
  const retrato = atual ? retratoDe(atual, t) : null;
  const retratoProx = proximo ? retratoDe(proximo, tokenOf(proximo.name)) : null;

  const hpFrac = atual?.maxHp > 0 ? Math.max(0, Math.min(1, (atual.hp ?? 0) / atual.maxHp)) : null;
  const hpCor = hpFrac > 0.5 ? '#4a9d6f' : hpFrac > 0.25 ? '#b8925a' : '#c05650';
  const conds = (atual?.conditions || []);

  el.innerHTML = `
    <div class="hud-turn">
      ${retrato ? `<img class="hud-avatar" src="${esc(retrato)}" alt="" onerror="this.style.display='none'" />` : '<span class="hud-avatar placeholder"></span>'}
      <div class="hud-info">
        <span class="hud-top">Rodada ${c.round} · vez de</span>
        <b>${esc(atual.name)}</b>
        ${hpFrac !== null ? `<div class="hud-hp-bar"><span style="width:${hpFrac*100}%;background:${hpCor}"></span></div>` : ''}
        ${(hpFrac !== null || conds.length) ? `<div class="hud-meta">
          ${hpFrac !== null ? `<span class="hud-hp-text">${esc(atual.hp)}/${esc(atual.maxHp)} PV</span>` : ''}
          ${conds.length ? `<div class="hud-conds">${conds.map((cd) => `<span class="cond-chip" title="${esc(condTitle(cd))}">${condImg(cd)}</span>`).join('')}</div>` : ''}
        </div>` : ''}
      </div>
    </div>
    ${proximo ? `
      <div class="hud-next">
        ${retratoProx ? `<img class="hud-next-avatar" src="${esc(retratoProx)}" alt="" onerror="this.style.display='none'" />` : ''}
        <div><small>A seguir</small><span>${esc(proximo.name)}</span></div>
      </div>` : ''}
    <div class="hud-actions">
      <button class="btn small ghost" id="hud-prev" title="Voltar um turno">◀</button>
      <button class="btn gold" id="hud-next" title="Próximo turno (Espaço)">▶ Próximo</button>
      <button class="btn small" id="hud-roll" title="Rola a iniciativa de TODOS os combatentes e reordena"><svg class="icon"><use href="#i-dice-six"/></svg>Rolar iniciativa</button>
      <button class="btn small ghost" id="hud-announce" title="Postar a ordem no Discord"><svg class="icon"><use href="#i-paper-plane-tilt"/></svg>Postar</button>
      <button class="btn small ghost danger" id="hud-end" title="Encerrar o combate"><svg class="icon"><use href="#i-stop"/></svg>Fim</button>
    </div>`;

  $('#hud-next').onclick = () => nextTurn(1);
  $('#hud-prev').onclick = () => nextTurn(-1);
  $('#hud-roll').onclick = rollInitiative;
  $('#hud-announce').onclick = () => tryApi(() => api('/combat/announce', { method: 'POST' }), 'Iniciativa postada!');
  $('#hud-end').onclick = () => endCombat();
}

function renderTokenPanel() {
  const el = $('#token-panel');
  if (!el) return;
  const t = bmap.tokenById(bmap.selectedId);
  if (!t) {
    el.innerHTML = '<div class="help-text panel-hint">Clique num token do mapa para aplicar dano, cura e condições.</div>';
    return;
  }
  // Para tokens ligados à iniciativa, PV e condições vivem no entry, não no token
  const entry = entryOf(t);
  const fonte = entry || t;
  const hp = Number(fonte.hp ?? t.hp ?? 0);
  const maxHp = Number(fonte.maxHp ?? t.maxHp ?? 0);
  const frac = maxHp > 0 ? Math.max(0, Math.min(1, hp / maxHp)) : null;
  const cor = frac > 0.5 ? '#4a9d6f' : frac > 0.25 ? '#b8925a' : '#c05650';
  const conds = fonte.conditions || [];
  const conc = fonte.concentration || false;
  const personagem = charDoToken(t);

  el.innerHTML = `
    <div class="act-panel">
      <div class="act-head">
        ${t.imageUrl ? `<img class="token-avatar" src="${esc(t.imageUrl)}" alt="" onerror="this.remove()" />` : ''}
        <div class="act-name">
          <b>${esc(t.name)}</b>
          ${personagem ? `<button type="button" class="btn small gold" id="act-sheet" title="Ver a ficha completa" style="padding:1px 7px;margin-left:6px;"><svg class="icon"><use href="#i-clipboard-text"/></svg>Ficha</button>` : ''}
          ${entry ? `<small style="color:var(--muted);font-size:11px;"><svg class="icon"><use href="#i-sword"/></svg> na iniciativa</small>` : ''}
          ${frac !== null ? `
            <div class="hp-bar"><span style="width:${frac * 100}%; background:${cor}"></span></div>
            <small class="hp-text">${hp}/${maxHp} PV</small>` : '<small class="hp-text">sem PV definidos</small>'}
        </div>
      </div>
      <div class="act-hp">
        <input type="number" id="act-amount" min="1" placeholder="0" />
        <button class="btn small danger" id="act-dmg" title="Enter aplica dano"><svg class="icon"><use href="#i-hand-fist"/></svg>Dano</button>
        <button class="btn small" id="act-heal"><svg class="icon"><use href="#i-heart-straight"/></svg>Cura</button>
      </div>
      <div class="fx-palette" title="Dispara um efeito visual e sonoro no token, na sua tela e na dos jogadores">
        ${FX_PALETTE.map((f) => `<button class="fx-btn" data-fx="${f.kind}" title="${esc(f.label)}"><svg class="icon"><use href="#i-${f.icon}"/></svg></button>`).join('')}
      </div>
      <div class="act-conds">
        ${CONDITIONS.map((c) => {
          const on = conds.includes(c);
          return `<button class="cond-toggle ${on ? 'on' : ''}" data-cond="${esc(c)}" title="${esc(condTitle(c))}">${condImg(c)}</button>`;
        }).join('')}
      </div>
      <label class="tool-check"><input type="checkbox" id="act-conc" ${conc ? 'checked' : ''} /> <svg class="icon"><use href="#i-brain"/></svg> Concentrando</label>
      <div class="row">
        <button class="btn small ghost" id="act-dup" title="Cria uma cópia do token com PV cheios"><svg class="icon"><use href="#i-clipboard-text"/></svg>Duplicar</button>
        <button class="btn small ghost" id="act-hide"><svg class="icon"><use href="#i-${t.hidden ? 'eye-slash' : 'eye'}"/></svg>${t.hidden ? 'Mostrar' : 'Esconder'}</button>
        <button class="btn small ghost" id="act-edit"><svg class="icon"><use href="#i-pencil-simple"/></svg>Editar</button>
        <button class="btn small danger" id="act-del"><svg class="icon"><use href="#i-trash"/></svg></button>
      </div>
    </div>`;

  if (personagem) $('#act-sheet').onclick = () => characterSheetModal(personagem);
  const valor = () => Math.abs(Number($('#act-amount').value) || 0);
  $('#act-dmg').onclick = () => applyHp([t], -valor());
  $('#act-heal').onclick = () => applyHp([t], valor());
  $('#act-amount').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); applyHp([t], e.shiftKey ? valor() : -valor()); }
  });
  $$('#token-panel [data-cond]').forEach((b) => b.onclick = () => toggleCondition(t, b.dataset.cond));
  $('#act-conc').onchange = async (e) => {
    const alvo = entryOf(t) || t;
    alvo.concentration = e.target.checked;
    if (entryOf(t)) await saveCombatState(); else pushBattle();
    renderMapSide();
  };
  $$('#token-panel [data-fx]').forEach((b) => b.onclick = () =>
    triggerFx(b.dataset.fx, t.col, t.row, { size: t.size || 1 }));
  $('#act-dup').onclick = () => duplicateToken(t.id);
  $('#act-hide').onclick = () => { t.hidden = !t.hidden; pushBattle(); renderMapSide(); };
  $('#act-edit').onclick = () => tokenModal(t);
  $('#act-del').onclick = () => removeToken(t.id);
}

function renderAoePanel() {
  const el = $('#aoe-panel');
  if (!el) return;
  const aoe = bmap.aoe;
  if (!aoe) { el.innerHTML = ''; return; }
  const alvos = bmap.tokensInAoe();

  el.innerHTML = `
    <div class="act-panel aoe">
      <div class="act-head"><b><svg class="icon"><use href="#i-target"/></svg> Área — raio ${aoe.radius.toFixed(1)} m</b></div>
      ${alvos.length
        ? `<div class="aoe-targets">${alvos.map((t) => `<span class="cond-chip"><svg class="icon"><use href="#i-${t.kind === 'pc' ? 'game-controller' : 'mask-happy'}"/></svg> ${esc(t.name)}</span>`).join('')}</div>`
        : '<div class="help-text">Ninguém dentro da área.</div>'}
      <div class="fx-palette" title="Dispara o efeito em todos na área — na sua tela e na dos jogadores">
        ${FX_PALETTE.map((f) => `<button class="fx-btn" data-aoefx="${f.kind}" title="${esc(f.label)} na área"><svg class="icon"><use href="#i-${f.icon}"/></svg></button>`).join('')}
      </div>
      <div class="aoe-roll-row">
        <label class="aoe-roll-label" for="aoe-expr">Dano:</label>
        <input type="text" id="aoe-expr" placeholder="8d6" class="aoe-expr-input" />
        <button class="btn small ghost" id="aoe-roll" title="Rolar dano"><svg class="icon"><use href="#i-dice-six"/></svg>Rolar</button>
        <span class="aoe-result" id="aoe-result"></span>
      </div>
      <div class="act-hp">
        <button class="btn small danger" id="aoe-dmg" title="Dano cheio em todos" disabled><svg class="icon"><use href="#i-hand-fist"/></svg>Todos</button>
        <button class="btn small" id="aoe-half" title="Metade do dano" disabled>½ Salvou</button>
      </div>
      <button class="btn small ghost" id="aoe-clear">Limpar área</button>
    </div>`;

  const alvosIds = new Set(alvos.map((t) => t.id));
  const liveAlvos = () => state.battle.tokens.filter((t) => alvosIds.has(t.id));

  // Paleta de efeitos na área: um estouro em cada alvo, em cascata (ou no centro se vazia).
  $$('#aoe-panel [data-aoefx]').forEach((b) => b.onclick = () => {
    const kind = b.dataset.aoefx;
    const vivos = liveAlvos();
    if (!vivos.length) { triggerFx(kind, aoe.col, aoe.row, { size: 2 }); return; }
    vivos.forEach((t, i) => setTimeout(() => triggerFx(kind, t.col, t.row, { size: t.size || 1 }), i * 90));
  });

  let rolledValue = 0;

  const setResult = (total, expr, breakdown) => {
    rolledValue = total;
    const resEl = $('#aoe-result');
    if (resEl) {
      resEl.innerHTML = `<span class="aoe-total">${total}</span>${breakdown ? `<span class="aoe-breakdown">${esc(breakdown)}</span>` : ''}`;
    }
    const dmgBtn = $('#aoe-dmg');
    const halfBtn = $('#aoe-half');
    if (dmgBtn) dmgBtn.disabled = false;
    if (halfBtn) halfBtn.disabled = false;
  };

  $('#aoe-roll').onclick = async () => {
    const expr = $('#aoe-expr').value.trim() || '1d6';
    const r = await tryApi(() => api('/roll', { method: 'POST', body: { expr } }));
    if (!r) return;
    setResult(r.total, expr, r.detail || null);
    logCombat(`Área de efeito: ${expr} = ${r.total}${r.detail ? ` (${r.detail})` : ''}`);
  };

  $('#aoe-expr').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#aoe-roll').click(); });

  $('#aoe-dmg').onclick = () => {
    if (!rolledValue) return toast('Role o dano primeiro.', true);
    applyHp(liveAlvos(), -rolledValue);
  };
  $('#aoe-half').onclick = () => {
    if (!rolledValue) return toast('Role o dano primeiro.', true);
    applyHp(liveAlvos(), -Math.floor(rolledValue / 2));
  };
  $('#aoe-clear').onclick = () => bmap.setAoe(null);
}

// Anéis quadrados crescentes ao redor de um centro — usado pra achar onde encaixar um
// token novo perto de onde o Mestre está olhando, sem empilhar em cima de quem já tá lá.
function* spiralCells(centerCol, centerRow) {
  yield [centerCol, centerRow];
  for (let ring = 1; ring < 60; ring++) {
    for (let dx = -ring; dx <= ring; dx++) { yield [centerCol + dx, centerRow - ring]; yield [centerCol + dx, centerRow + ring]; }
    for (let dy = -ring + 1; dy <= ring - 1; dy++) { yield [centerCol - ring, centerRow + dy]; yield [centerCol + ring, centerRow + dy]; }
  }
}
// Conjunto de células já ocupadas no mapa agora — pra próxima célula livre não pisar em ninguém.
const occupiedCells = () => new Set(state.battle.tokens.map((t) => `${t.col},${t.row}`));
// Próxima célula livre a partir do centro da área visível do mapa (onde o Mestre está
// olhando/com zoom aplicado) — em vez de sempre encher a partir do canto superior esquerdo.
// `occupied` é mutado: cada chamada dentro do mesmo lote já reserva a célula escolhida.
function nextTokenSlot(map, occupied) {
  const center = bmap?.map ? bmap.centerCell() : { col: Math.floor(map.cols / 2), row: Math.floor(map.rows / 2) };
  for (const [col, row] of spiralCells(center.col, center.row)) {
    if (col < 0 || row < 0 || col >= map.cols || row >= map.rows) continue;
    const key = `${col},${row}`;
    if (!occupied.has(key)) { occupied.add(key); return { col, row }; }
  }
  return { col: center.col, row: center.row }; // mapa lotado — improvável, mas não trava
}

// Coloca tokens novos no mapa, sem duplicar quem já está lá. Entram perto de onde o
// Mestre está olhando no momento, em vez de sempre no canto superior esquerdo.
function addTokens(defs) {
  const map = activeMap();
  if (!map) return toast('Coloque um mapa em jogo primeiro.', true);
  const tokens = state.battle.tokens;
  const occupied = occupiedCells();
  let added = 0;
  for (const def of defs) {
    if (tokens.some((t) => t.name === def.name)) continue;
    tokens.push({
      id: Math.random().toString(16).slice(2, 10),
      ...nextTokenSlot(map, occupied),
      size: 1, hidden: false, color: '', ...def,
    });
    added++;
  }
  pushBattle();
  toast(added ? `${added} token(s) no mapa.` : 'Todos já estavam no mapa.');
  renderMapSide();
}

// Roster unificado: a lista de iniciativa É o elenco de combatentes, e cada linha
// carrega a presença no mapa (colocar / localizar / esconder). Assim mapa e combate
// deixam de ser duas listas paralelas.
function renderCombatOrder() {
  const el = $('#combat-order');
  if (!el) return;
  const c = state.combat;

  const saveCombat = async () => { await tryApi(() => api('/combat', { method: 'PUT', body: c })); refresh(); };

  const temMapa = !!activeMap();
  const foraDoMapa = c.entries.filter((e) => !tokenOf(e.name)).length;

  el.innerHTML = `
    <div class="co-header">
      <span class="co-label-text"><svg class="icon"><use href="#i-sword"/></svg> COMBATENTES · R.${c.round}</span>
      <div class="co-controls">
        <button class="btn small ghost co-btn" id="co-add" title="Combatente em branco">+</button>
        <button class="btn small ghost co-btn" id="co-pcs" title="Adicionar personagens (jogadores e NPCs)"><svg class="icon"><use href="#i-users"/></svg></button>
        <button class="btn small ghost co-btn" id="co-sort" title="Ordenar por iniciativa"><svg class="icon"><use href="#i-arrows-down-up"/></svg></button>
        <button class="btn small ghost co-btn" id="co-srd" title="Bestiário SRD"><svg class="icon"><use href="#i-book-open-text"/></svg></button>
      </div>
    </div>
    ${c.entries.length ? `
    <div class="co-turn-bar">
      <button class="btn small co-btn" id="co-next">▶ Próximo</button>
      <button class="btn small ghost co-btn" id="co-announce" title="Postar no Discord"><svg class="icon"><use href="#i-paper-plane-tilt"/></svg></button>
      <button class="btn small danger co-btn" id="co-end" title="Encerrar combate"><svg class="icon"><use href="#i-x"/></svg>Fim</button>
    </div>` : ''}
    ${c.entries.length && temMapa && foraDoMapa ? `
    <button class="co-place-all" id="co-place-all" title="Coloca no mapa todos que ainda não têm token">
      <svg class="icon"><use href="#i-map-trifold"/></svg> ${foraDoMapa} fora do mapa · <b>Colocar todos</b>
    </button>` : ''}
    <div id="co-list">
      ${c.entries.map((e, i) => {
        const isTurn = i === c.turn;
        const downed = e.maxHp > 0 && (e.hp ?? 0) <= 0;
        const tok = tokenOf(e.name);
        const onMap = !!tok;
        const retrato = retratoDe(e, tok);
        const conds = (e.conditions || []).map((cd) =>
          `<span class="cond-chip ie-cond" data-rm-cond="${i}|${esc(cd)}" title="${esc(`Clique para remover — ${condTitle(cd)}`)}">${condImg(cd)}</span>`
        ).join('');
        return `
          <div class="init-entry ${isTurn ? 'is-turn' : ''} ${downed ? 'downed' : ''} ${onMap ? '' : 'offmap'}" data-ie-i="${i}">
            <span class="ie-arrow">${isTurn ? '▶' : ''}</span>
            <input class="input ie-init" type="number" value="${esc(e.init)}" data-ci="${i}" data-cf="init" title="Iniciativa" />
            ${retrato
              ? `<img class="ie-avatar" src="${esc(retrato)}" alt="" onerror="this.src=''" />`
              : `<span class="ie-avatar placeholder" style="font-size:12px;display:flex;align-items:center;justify-content:center;"><svg class="icon"><use href="#i-${e.isPc ? 'game-controller' : 'mask-happy'}"/></svg></span>`}
            <div class="ie-main">
              <div class="ie-name-row">
                <input class="input ie-name" value="${esc(e.name)}" data-ci="${i}" data-cf="name" title="Nome" />
                ${onMap
                  ? `<button class="ie-mapbtn on" data-locate="${i}" title="Localizar no mapa"><svg class="icon"><use href="#i-map-pin"/></svg></button>
                     <button class="ie-mapbtn" data-hide="${i}" title="${tok.hidden ? 'Mostrar aos jogadores' : 'Esconder dos jogadores'}"><svg class="icon"><use href="#i-${tok.hidden ? 'eye-slash' : 'eye'}"/></svg></button>`
                  : `<button class="ie-mapbtn place" data-place="${i}" title="Colocar no mapa"><svg class="icon"><use href="#i-map-trifold"/></svg></button>`}
                <button class="ie-mapbtn del" data-remove-combatant="${i}" title="Remover do combate e do mapa"><svg class="icon"><use href="#i-trash"/></svg></button>
              </div>
              <div class="ie-row2">
                <input class="input ie-hp" type="number" value="${esc(e.hp ?? '')}" data-ci="${i}" data-cf="hp" title="PV atual" />
                <span class="ie-sep">/</span>
                <input class="input ie-maxhp" type="number" value="${esc(e.maxHp ?? '')}" data-ci="${i}" data-cf="maxHp" title="PV máximo" />
                <span class="ie-pv">PV</span>
                <button class="btn small ghost ie-conc${e.concentration ? ' on' : ''}" data-conc="${i}" title="Concentração"><svg class="icon"><use href="#i-brain"/></svg></button>
                <select class="input ie-cond-sel" data-add-cond="${i}" title="Adicionar condição">
                  <option value="">+</option>
                  ${CONDITIONS.filter((x) => !(e.conditions || []).includes(x)).map((x) => `<option value="${esc(x)}">${esc(x)}</option>`).join('')}
                </select>
              </div>
              ${conds ? `<div class="ie-conds">${conds}</div>` : ''}
              ${downed && e.maxHp ? `
                <div class="death-saves">
                  <svg class="icon"><use href="#i-skull"/></svg> <svg class="icon"><use href="#i-check-circle"/></svg>${'●'.repeat(e.deathSaves?.s || 0)}${'○'.repeat(3 - (e.deathSaves?.s || 0))}
                  <button class="btn small ghost" data-ds-s="${i}">+</button>
                  <svg class="icon"><use href="#i-x-circle"/></svg>${'●'.repeat(e.deathSaves?.f || 0)}${'○'.repeat(3 - (e.deathSaves?.f || 0))}
                  <button class="btn small ghost" data-ds-f="${i}">+</button>
                </div>` : ''}
            </div>
          </div>`;
      }).join('')}
    </div>
    ${!c.entries.length ? '<div class="empty" style="font-size:12px;padding:8px 4px;">Traga seus jogadores e NPCs, busque no bestiário ou crie um combatente em branco com o +.</div>' : ''}`;

  $$('#co-list .init-entry').forEach((row) => {
    row.onclick = (e) => {
      if (e.target.closest('button, input, select')) return;
      const i = Number(row.dataset.ieI);
      const t = tokenOf(c.entries[i]?.name);
      if (t) { bmap.select(t.id); bmap.centerOn(t.col, t.row); }
    };
  });

  $$('#co-list [data-ci]').forEach((inp) => inp.onchange = () => {
    const e = c.entries[Number(inp.dataset.ci)];
    const fn = inp.dataset.cf;
    const val = inp.type === 'number' ? Number(inp.value) : inp.value;
    if (fn === 'hp') {
      const dmg = (e.hp ?? 0) - val;
      if (dmg > 0 && e.concentration) toast(`${e.name} tomou ${dmg} de dano concentrando: CD ${Math.max(10, Math.floor(dmg / 2))}!`);
      if (val <= 0 && e.hp > 0) e.deathSaves = { s: 0, f: 0 };
      if (dmg !== 0) logCombat(dmg > 0 ? `${e.name} tomou ${dmg} de dano (${val}${e.maxHp ? `/${e.maxHp}` : ''} PV)` : `${e.name} recuperou ${-dmg} PV (${val}${e.maxHp ? `/${e.maxHp}` : ''} PV)`);
    }
    const nomeAntigo = e.name;
    e[fn] = val;
    // Sincroniza de volta para o token do mapa: HP/maxHp sempre; nome mantém o vínculo.
    const tok = tokenOf(nomeAntigo);
    if (tok) {
      if (fn === 'hp' || fn === 'maxHp') { tok[fn] = val; pushBattle(); }
      else if (fn === 'name') { tok.name = val; if (tok.combatName) tok.combatName = val; pushBattle(); }
    }
    saveCombat();
  });

  $$('#co-list [data-conc]').forEach((btn) => btn.onclick = (ev) => {
    ev.stopPropagation();
    const e = c.entries[Number(btn.dataset.conc)];
    e.concentration = !e.concentration;
    saveCombat();
  });

  $$('#co-list [data-add-cond]').forEach((sel) => sel.onchange = () => {
    if (!sel.value) return;
    const e = c.entries[Number(sel.dataset.addCond)];
    e.conditions = [...(e.conditions || []), sel.value];
    logCombat(`${e.name} ficou ${sel.value}`);
    sel.value = '';
    saveCombat();
  });

  $$('#co-list [data-rm-cond]').forEach((b) => b.onclick = (ev) => {
    ev.stopPropagation();
    const [i, cond] = b.dataset.rmCond.split('|');
    const e = c.entries[Number(i)];
    e.conditions = (e.conditions || []).filter((x) => x !== cond);
    logCombat(`${e.name} não está mais ${cond}`);
    saveCombat();
  });

  // Colocar um combatente no mapa
  $$('#co-list [data-place]').forEach((b) => b.onclick = (ev) => {
    ev.stopPropagation();
    placeOnMap(c.entries[Number(b.dataset.place)]);
  });

  // Localizar (centraliza a câmera e seleciona o token)
  $$('#co-list [data-locate]').forEach((b) => b.onclick = (ev) => {
    ev.stopPropagation();
    const t = tokenOf(c.entries[Number(b.dataset.locate)]?.name);
    if (t) { bmap.select(t.id); bmap.centerOn(t.col, t.row); }
  });

  // Esconder/mostrar o token aos jogadores
  $$('#co-list [data-hide]').forEach((b) => b.onclick = (ev) => {
    ev.stopPropagation();
    const t = tokenOf(c.entries[Number(b.dataset.hide)]?.name);
    if (t) { t.hidden = !t.hidden; pushBattle(); renderMapSide(); }
  });

  // Remover do combate — e também o token do mapa (um combatente é uma coisa só)
  $$('#co-list [data-remove-combatant]').forEach((b) => b.onclick = (ev) => {
    ev.stopPropagation();
    const i = Number(b.dataset.removeCombatant);
    const e = c.entries[i];
    const tok = e && tokenOf(e.name);
    if (tok) {
      state.battle.tokens = state.battle.tokens.filter((t) => t.id !== tok.id);
      if (bmap.selectedId === tok.id) bmap.select(null);
      pushBattle();
    }
    if (e) logCombat(`${e.name} saiu do combate`);
    c.entries.splice(i, 1);
    if (c.turn >= c.entries.length) c.turn = 0;
    saveCombat();
  });

  $$('#co-list [data-ds-s]').forEach((b) => b.onclick = (ev) => {
    ev.stopPropagation();
    const e = c.entries[Number(b.dataset.dsS)];
    e.deathSaves = e.deathSaves || { s: 0, f: 0 };
    e.deathSaves.s = Math.min(3, (e.deathSaves.s || 0) + 1);
    if (e.deathSaves.s >= 3) { toast(`${e.name} estabilizou!`); logCombat(`${e.name} estabilizou (3 sucessos)`); }
    else logCombat(`${e.name}: sucesso na resistência contra a morte (${e.deathSaves.s}/3)`);
    saveCombat();
  });

  $$('#co-list [data-ds-f]').forEach((b) => b.onclick = (ev) => {
    ev.stopPropagation();
    const e = c.entries[Number(b.dataset.dsF)];
    e.deathSaves = e.deathSaves || { s: 0, f: 0 };
    e.deathSaves.f = Math.min(3, (e.deathSaves.f || 0) + 1);
    if (e.deathSaves.f >= 3) { toast(`${e.name} morreu...`); logCombat(`${e.name} morreu (3 falhas)`); }
    else logCombat(`${e.name}: falha na resistência contra a morte (${e.deathSaves.f}/3)`);
    saveCombat();
  });

  const coPlaceAll = $('#co-place-all');
  if (coPlaceAll) coPlaceAll.onclick = () => placeAllOnMap();

  const coAdd = $('#co-add');
  const coPcs = $('#co-pcs');
  const coSort = $('#co-sort');
  const coSrd = $('#co-srd');
  const coNext = $('#co-next');
  const coAnnounce = $('#co-announce');
  const coEnd = $('#co-end');

  if (coAdd) coAdd.onclick = () => {
    c.entries.push({ name: 'Monstro', init: 10, hp: 10, maxHp: 10, conditions: [], deathSaves: { s: 0, f: 0 } });
    logCombat('Monstro (em branco) entrou no combate');
    saveCombat();
  };
  if (coPcs) coPcs.onclick = () => charPickerModal();
  if (coSort) coSort.onclick = () => { c.entries.sort((a, b) => b.init - a.init); c.turn = 0; saveCombat(); };
  if (coSrd) coSrd.onclick = () => srdModal();
  if (coNext) coNext.onclick = () => nextTurn(1);
  if (coAnnounce) coAnnounce.onclick = () => tryApi(() => api('/combat/announce', { method: 'POST' }), 'Iniciativa postada!');
  if (coEnd) coEnd.onclick = () => endCombat();
}

// Encerra o combate: limpa a iniciativa, mas o log de combate fica — é o que o Mestre
// quer poder revisar depois da luta. Compartilhado pelo botão do HUD e o da sidebar.
function endCombat() {
  if (!confirm('Encerrar o combate? A iniciativa é limpa; os tokens continuam no mapa.')) return;
  logCombat('Combate encerrado');
  state.combat = { active: false, round: 1, turn: 0, entries: [], log: state.combat.log };
  saveCombatState();
  renderMapSide();
  toast('Combate encerrado.');
}

// Seção subordinada: tokens no mapa que NÃO estão na iniciativa (objetos, NPCs de cenário,
// coisas ainda não reveladas). Fica escondida quando não há nenhum.
// Promove um token avulso a combatente: cria a entry ligada (por nome) e ele sobe
// automaticamente da seção "OUTROS NO MAPA" para a lista de combatentes.
function looseToCombat(tokenId) {
  const t = state.battle.tokens.find((x) => x.id === tokenId);
  if (!t) return;
  const c = state.combat;
  const nome = t.combatName || t.name;
  if (c.entries.some((e) => e.name === nome)) return toast(`${nome} já está no combate.`, true);
  const ch = t.charId ? state.characters.find((x) => x.id === t.charId) : state.characters.find((x) => x.name === nome);
  const dexMod = abilityMod(scoreOf(ch, 'dex'));
  c.entries.push({
    name: nome, init: d20() + dexMod, initMod: dexMod,
    hp: t.hp ?? 0, maxHp: t.maxHp ?? 0,
    conditions: [], deathSaves: { s: 0, f: 0 },
    isPc: t.kind === 'pc',
    charId: ch?.id,
    imageUrl: t.imageUrl || '',
  });
  // Garante o vínculo pelo combatName, mesmo que o token seja renomeado depois.
  if (!t.combatName) { t.combatName = nome; pushBattle(); }
  tryApi(() => api('/combat', { method: 'PUT', body: c })).then(() => renderMapSide());
  toast(`${nome} entrou no combate.`);
}

function renderLooseTokens() {
  const el = $('#loose-tokens');
  if (!el) return;
  const soltos = (state.battle.tokens || []).filter((t) => !entryOf(t));
  const icon = { pc: 'game-controller', npc: 'mask-happy', enemy: 'skull' };
  const kindColor = { pc: '#4a9d6f', npc: '#b8925a', enemy: '#c05650' };

  el.innerHTML = `
    <div class="side-section">
      <div class="side-section-label">
        <span>OUTROS NO MAPA</span>
        <button class="btn small gold" id="btn-loose-add" title="Adicionar personagem cadastrado ou um token avulso">+ Adicionar</button>
      </div>
      ${soltos.length ? `<div id="loose-list">${soltos.map((t) => {
        const cor = t.color || kindColor[t.kind] || '#6e5bc4';
        const frac = t.maxHp > 0 ? Math.max(0, Math.min(1, (t.hp ?? 0) / t.maxHp)) : null;
        const conds = (t.conditions || []).map((cd) => `<span class="cond-chip" title="${esc(condTitle(cd))}">${condImg(cd)}</span>`).join('');
        return `
        <div class="token-row ${t.hidden ? 'hidden-token' : ''}" data-tok-id="${t.id}" role="button" tabindex="0" aria-label="Selecionar ${esc(t.name)} no mapa">
          ${t.imageUrl
            ? `<img class="token-avatar" style="border-color:${esc(cor)}" src="${esc(t.imageUrl)}" alt="" onerror="this.remove()" />`
            : `<span class="token-dot" style="background:${esc(cor)}"></span>`}
          <span class="name">
            <svg class="icon"><use href="#i-${icon[t.kind] || 'square'}"/></svg> ${esc(t.name)}${t.concentration ? ' <svg class="icon"><use href="#i-brain"/></svg>' : ''}
            ${frac !== null ? `<small>${esc(t.hp)}/${esc(t.maxHp)} PV</small>` : ''}
            ${conds ? `<div class="cond-list">${conds}</div>` : ''}
          </span>
          <button class="btn small gold" data-tok-combat="${t.id}" title="Adicionar ao combate (entra na iniciativa)"><svg class="icon"><use href="#i-sword"/></svg></button>
          <button class="btn small ghost" data-tok-dup="${t.id}" title="Duplicar este token com PV cheios"><svg class="icon"><use href="#i-clipboard-text"/></svg></button>
          <button class="btn small ghost" data-tok-hide="${t.id}" title="${t.hidden ? 'Mostrar aos jogadores' : 'Esconder dos jogadores'}"><svg class="icon"><use href="#i-${t.hidden ? 'eye-slash' : 'eye'}"/></svg></button>
          <button class="btn small ghost" data-tok-edit="${t.id}"><svg class="icon"><use href="#i-pencil-simple"/></svg></button>
          <button class="btn small danger" data-tok-del="${t.id}"><svg class="icon"><use href="#i-trash"/></svg></button>
        </div>`;
      }).join('')}</div>` : '<div class="empty" style="font-size:12px;padding:6px 4px;">Nenhum token avulso. Os combatentes ficam na lista acima.</div>'}
    </div>`;

  $('#btn-loose-add').onclick = () => charPickerModal();
  $$('#loose-tokens [data-tok-combat]').forEach((b) => b.onclick = (e) => { e.stopPropagation(); looseToCombat(b.dataset.tokCombat); });
  $$('#loose-tokens [data-tok-dup]').forEach((b) => b.onclick = (e) => { e.stopPropagation(); duplicateToken(b.dataset.tokDup); });
  $$('#loose-tokens [data-tok-hide]').forEach((b) => b.onclick = () => {
    const t = state.battle.tokens.find((x) => x.id === b.dataset.tokHide);
    t.hidden = !t.hidden;
    pushBattle();
    renderMapSide();
  });
  $$('#loose-tokens [data-tok-edit]').forEach((b) => b.onclick = () =>
    tokenModal(state.battle.tokens.find((x) => x.id === b.dataset.tokEdit)));
  $$('#loose-tokens [data-tok-del]').forEach((b) => b.onclick = () => removeToken(b.dataset.tokDel));
  const selectLooseToken = (row) => {
    const t = state.battle.tokens.find((x) => x.id === row.dataset.tokId);
    if (t) { bmap.select(t.id); bmap.centerOn(t.col, t.row); }
  };
  $$('#loose-tokens .token-row').forEach((row) => {
    row.onclick = (e) => { if (!e.target.closest('button')) selectLooseToken(row); };
    row.onkeydown = (e) => {
      if (e.target.closest('button')) return;
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectLooseToken(row); }
    };
  });
}

// Galeria dos mapas prontos que o Mestre deixou em data/sample-maps/.
// Estes mapas não têm grade desenhada: o Mestre escolhe as colunas e as linhas saem
// da proporção da imagem, para o quadrado ficar quadrado e a imagem encaixar exata.
async function sampleMapsModal() {
  const mapas = await tryApi(() => api('/sample-maps'));
  if (!mapas) return;

  openModal('Mapas de exemplo', mapas.length ? `
    <p class="help-text">Escolha as colunas — as linhas se ajustam sozinhas à proporção da imagem.
    O DnDavid publica os mapas dele sem grade, geralmente em 30×40, 40×40 ou 40×30.</p>
    <div class="sample-grid">${mapas.map((m, i) => `
      <div class="sample-card" data-i="${i}">
        <img src="${esc(m.url)}" alt="" data-thumb="${i}" />
        <b>${esc(m.name)}</b>
        <div class="sample-controls">
          <label>Colunas <input type="number" min="5" max="80" data-cols="${i}" value="${m.grid?.cols ?? 40}" /></label>
          <span class="sample-rows" data-rows-label="${i}">× ${m.grid?.rows ?? '…'} linhas</span>
        </div>
        <button class="btn small gold" data-use="${i}">▶ Usar este mapa</button>
      </div>`).join('')}</div>
  ` : `
    <p class="help-text">Nenhum mapa de exemplo ainda.<br/><br/>
    Copie as imagens para a pasta <code>data/sample-maps/</code> do projeto e abra esta janela de novo.
    Elas ficam só na sua máquina — não vão para o repositório.</p>
  `, async () => {}, 'Fechar');
  $('#modal-form').onsubmit = (e) => { e.preventDefault(); closeModal(); };

  // Cada imagem, ao carregar, define quantas linhas aquele número de colunas produz
  const proporcao = {};
  const recalcRows = (i) => {
    const p = proporcao[i];
    if (!p) return null;
    const cols = Number($(`[data-cols="${i}"]`).value) || 40;
    const rows = mapas[i].grid?.rows && Number($(`[data-cols="${i}"]`).value) === mapas[i].grid.cols
      ? mapas[i].grid.rows
      : Math.max(1, Math.round(cols * p.h / p.w));
    $(`[data-rows-label="${i}"]`).textContent = `× ${rows} linhas`;
    return { cols, rows, ...p };
  };

  const medir = (img) => {
    const i = Number(img.dataset.thumb);
    proporcao[i] = { w: img.naturalWidth, h: img.naturalHeight };
    // Sem grid no nome: retrato sugere 30 colunas, paisagem 40 (as proporções do autor)
    if (!mapas[i].grid) $(`[data-cols="${i}"]`).value = img.naturalWidth >= img.naturalHeight ? 40 : 30;
    recalcRows(i);
  };
  $$('#modal [data-thumb]').forEach((img) => {
    // Imagem em cache já vem pronta: o onload não dispararia e o card ficava sem as linhas
    if (img.complete && img.naturalWidth) medir(img);
    else img.onload = () => medir(img);
  });
  $$('#modal [data-cols]').forEach((inp) => inp.oninput = () => recalcRows(Number(inp.dataset.cols)));

  $$('#modal [data-use]').forEach((b) => b.onclick = async () => {
    const i = Number(b.dataset.use);
    const info = recalcRows(i);
    if (!info) return toast('Espere a miniatura carregar.', true);
    b.disabled = true;
    b.textContent = 'Importando...';

    // Escala que faz a imagem cobrir exatamente a largura do grid
    const scale = (info.cols * MAP_CELL) / info.w;
    const map = await tryApi(() => api('/sample-maps/import', {
      method: 'POST',
      body: {
        file: mapas[i].file,
        name: mapas[i].name,
        cols: info.cols,
        rows: info.rows,
        cellSize: 1.5,
        img: { x: 0, y: 0, scale },
      },
    }));
    if (!map) { b.disabled = false; b.textContent = '▶ Usar este mapa'; return; }

    await tryApi(() => api('/battle', { method: 'PUT', body: { mapId: map.id } }));
    toast(`"${map.name}" está em jogo (${map.cols}×${map.rows}).`);
    closeModal();
    await refresh();
    setTimeout(() => bmap.fit(), 100);
  });
}

function mapModal(m = {}) {
  const isNew = !m.id;
  const temImagem = Boolean(m.filename || m.imageUrl);
  let imgDim = null; // { w, h } — medido da imagem escolhida

  openModal(isNew ? 'Novo mapa' : `Editar ${esc(m.name)}`, `
    ${field('Nome', 'name', m.name, 'text', 'Cripta do Rei Esquecido')}
    ${isNew ? `
      <div class="field"><label>Imagem do mapa (upload — PNG/JPG/WebP, até 25 MB)</label>
        <input type="file" name="file" accept=".png,.jpg,.jpeg,.webp,.gif" /></div>
      ${field('...ou URL da imagem', 'imageUrl', '', 'text', 'https://... (mapa gerado por IA)')}
    ` : ''}
    <div id="map-img-info" class="map-img-info"></div>
    <div class="field-row">
      ${field('Colunas', 'cols', m.cols ?? 20, 'number')}
      ${field('Linhas', 'rows', m.rows ?? 15, 'number')}
      ${field('Metros por célula', 'cellSize', m.cellSize ?? 1.5, 'number')}
    </div>
    ${fieldSelect('Tipo de grid', 'gridType', [
      { value: 'square', label: 'Quadrado' },
      { value: 'hex', label: 'Hexágono' },
    ], m.gridType || 'square')}
    ${(isNew || temImagem) ? `
      <label class="tool-check" style="margin-bottom:8px;" title="As linhas seguem a proporção da foto e a imagem é esticada para preencher o grid exatamente">
        <input type="checkbox" id="map-autofit" checked /> Encaixar a imagem no grid automaticamente
      </label>` : ''}
    <p class="help-text">${isNew
      ? 'Escolha a imagem: o tamanho dela é detectado e as linhas se ajustam sozinhas à proporção. Você só decide quantas colunas. Sem imagem = grid limpo.'
      : 'Mude as colunas e as linhas acompanham a proporção da foto. Os tokens continuam onde estão.'}</p>
  `, async (data) => {
    data.cols = Number(data.cols);
    data.rows = Number(data.rows);
    data.cellSize = Number(data.cellSize);
    // Escala que faz a imagem cobrir exatamente a largura do grid.
    const encaixar = $('#map-autofit')?.checked;
    const gw = Grid.mapPixelSize({ cols: data.cols, rows: data.rows, gridType: data.gridType }).w;
    const escala = (imgDim && encaixar) ? gw / imgDim.w : null;

    if (isNew) {
      const fileInput = $('#modal-form [name="file"]');
      const fd = new FormData();
      for (const [k, v] of Object.entries(data)) if (k !== 'file') fd.append(k, v);
      if (escala) { fd.append('imgScale', String(escala)); fd.append('imgX', '0'); fd.append('imgY', '0'); }
      if (fileInput?.files[0]) fd.append('file', fileInput.files[0]);
      const map = await api('/maps', { method: 'POST', body: fd });
      await api('/battle', { method: 'PUT', body: { mapId: map.id } });
      toast('Mapa criado e em jogo!');
      setTimeout(() => bmap.fit(), 100);
    } else {
      delete data.file;
      if (escala) data.img = { x: 0, y: 0, scale: escala };
      const updated = await api(`/maps/${m.id}`, { method: 'PUT', body: data });
      // Atualiza o mapa em state.maps imediatamente (sem esperar o refresh completo)
      const idx = state.maps.findIndex((x) => x.id === updated.id);
      if (idx >= 0) state.maps[idx] = updated;
      // Se esse mapa for o ativo, redesenha o canvas e refaz o fit
      if (state.battle.mapId === updated.id) {
        bmap.setData({ map: updated, battle: state.battle, combat: state.combat });
        bmap.fit();
      }
      toast('Grid atualizado!');
    }
  });

  // ---- Detecta o tamanho da imagem e ajusta o grid sozinho ----
  const info = $('#map-img-info');
  const colsInput = $('#modal-form [name="cols"]');
  const rowsInput = $('#modal-form [name="rows"]');
  const autofit = $('#map-autofit');

  const aplicarProporcao = () => {
    if (!imgDim || !autofit?.checked) return;
    const cols = Math.max(1, Math.min(80, Number(colsInput.value) || 20));
    rowsInput.value = Math.max(1, Math.min(80, Math.round(cols * imgDim.h / imgDim.w)));
    mostrarInfo();
  };
  const mostrarInfo = () => {
    if (!info) return;
    if (!imgDim) { info.innerHTML = ''; return; }
    const cols = Math.max(1, Number(colsInput.value) || 20);
    const px = Math.round(imgDim.w / cols);
    info.innerHTML = `<svg class="icon"><use href="#i-image"/></svg> Imagem detectada: <b>${imgDim.w}×${imgDim.h}px</b>`
      + `${autofit?.checked ? ` · as linhas seguem a proporção · cada quadrado ≈ <b>${px}px</b> da foto` : ''}`;
  };
  const medir = (src) => {
    const probe = new Image();
    probe.onload = () => { imgDim = { w: probe.naturalWidth, h: probe.naturalHeight }; aplicarProporcao(); mostrarInfo(); };
    probe.onerror = () => { imgDim = null; mostrarInfo(); };
    probe.src = src;
  };

  if (isNew) {
    $('#modal-form [name="file"]').onchange = (e) => {
      const f = e.target.files?.[0];
      if (f) medir(URL.createObjectURL(f));
    };
    $('#modal-form [name="imageUrl"]').onchange = (e) => {
      const u = e.target.value.trim();
      if (u) medir(u);
    };
  } else if (temImagem) {
    medir(m.filename ? `/map-files/${m.filename}` : m.imageUrl);
  }
  colsInput.oninput = aplicarProporcao;
  if (autofit) autofit.onchange = () => { aplicarProporcao(); mostrarInfo(); };
}

function tokenModal(t = null) {
  const isNew = !t;
  const combatNames = state.combat.entries.map((e) => e.name);
  openModal(isNew ? 'Novo token' : `Editar ${esc(t.name)}`, `
    ${field('Nome', 'name', t?.name ?? '', 'text', 'Goblin 3')}
    <div class="field-row">
      ${fieldSelect('Tipo', 'kind', [
        { value: 'pc', label: 'Jogador' },
        { value: 'npc', label: 'NPC' },
        { value: 'enemy', label: 'Inimigo' },
      ], t?.kind ?? 'enemy')}
      ${fieldSelect('Tamanho', 'size', [
        { value: '1', label: 'Médio (1×1)' },
        { value: '2', label: 'Grande (2×2)' },
        { value: '3', label: 'Enorme (3×3)' },
        { value: '4', label: 'Imenso (4×4)' },
      ], String(t?.size ?? 1))}
    </div>
    <div class="field-row">
      ${field('PV', 'hp', t?.hp ?? '', 'number')}
      ${field('PV máx', 'maxHp', t?.maxHp ?? '', 'number')}
      ${field('Deslocamento (m)', 'speed', t?.speed ?? 9, 'number')}
      ${field('Cor', 'color', t?.color || '#6e5bc4', 'color')}
    </div>
    ${fieldSelect('Ligar à iniciativa (PV e condições sincronizados)', 'combatName',
      [{ value: '', label: '— não ligar —' }, ...combatNames.map((n) => ({ value: n, label: n }))], t?.combatName ?? '')}
    ${fieldImage('Retrato do token', 'imageUrl', t?.imageUrl ?? '')}
    <label style="font-size:13px;"><input type="checkbox" name="hidden" ${t?.hidden ? 'checked' : ''} /> <svg class="icon"><use href="#i-eye-slash"/></svg> Escondido dos jogadores</label>
  `, async (data) => {
    const map = activeMap();
    if (!map) return toast('Coloque um mapa em jogo primeiro.', true);
    data.imageUrl = await resolveImage('imageUrl', data);
    const patch = {
      name: data.name,
      kind: data.kind,
      size: Number(data.size),
      hp: Number(data.hp) || 0,
      maxHp: Number(data.maxHp) || 0,
      speed: Number(data.speed) || 9,
      color: data.color,
      combatName: data.combatName,
      imageUrl: data.imageUrl,
      hidden: Boolean($('#modal-form [name="hidden"]').checked),
    };
    if (isNew) {
      state.battle.tokens.push({ id: Math.random().toString(16).slice(2, 10), col: 0, row: 0, ...patch });
    } else {
      Object.assign(state.battle.tokens.find((x) => x.id === t.id), patch);
    }
    pushBattle();
    renderMapSide();
  });
}

// ---------- Sessões ----------
function renderSessions() {
  $('#tab-sessions').innerHTML = `
    <div class="tab-header">
      <h2><svg class="icon"><use href="#i-calendar"/></svg>Sessões</h2>
      <div class="actions"><button class="btn" id="btn-new-session">+ Nova sessão</button></div>
    </div>
    <p class="help-text">Anote o que aconteceu em cada sessão. A IA gera um <b>recap épico</b> para você postar no Discord antes da próxima.</p><br/>
    <div class="grid">${[...state.sessions].reverse().map((s) => `
      <div class="card">
        <h3>${esc(s.title || 'Sessão')}</h3>
        <span class="badge">${esc(s.date || '')}</span>
        <div class="desc">${esc(s.recap || s.notes || '')}</div>
        <div class="row">
          <button class="btn small gold" data-recap="${s.id}"><svg class="icon"><use href="#i-sparkle"/></svg>Gerar recap</button>
          ${s.recap ? `<button class="btn small" data-post-recap="${s.id}"><svg class="icon"><use href="#i-paper-plane-tilt"/></svg>Postar no Discord</button>` : ''}
          <button class="btn small ghost" data-edit-session="${s.id}">Editar</button>
          <button class="btn small danger" data-del-session="${s.id}"><svg class="icon"><use href="#i-trash"/></svg></button>
        </div>
      </div>`).join('') || '<div class="empty">Nenhuma sessão registrada.</div>'}</div>`;

  $('#btn-new-session').onclick = () => sessionModal();
  $$('#tab-sessions [data-edit-session]').forEach((b) => b.onclick = () => sessionModal(state.sessions.find((s) => s.id === b.dataset.editSession)));
  $$('#tab-sessions [data-del-session]').forEach((b) => b.onclick = async () => {
    if (confirm('Excluir esta sessão?')) { await api(`/sessions/${b.dataset.delSession}`, { method: 'DELETE' }); refresh(); }
  });
  $$('#tab-sessions [data-recap]').forEach((b) => b.onclick = async () => {
    b.disabled = true; b.textContent = 'Escrevendo...';
    await tryApi(() => api(`/ai/recap/${b.dataset.recap}`, { method: 'POST' }), 'Recap gerado!');
    refresh();
  });
  $$('#tab-sessions [data-post-recap]').forEach((b) => b.onclick = async () => {
    const s = state.sessions.find((x) => x.id === b.dataset.postRecap);
    await tryApi(() => api('/discord/post', { method: 'POST', body: { content: `**Recap — ${s.title || s.date}**\n\n${s.recap}` } }), 'Recap postado!');
  });
}

function sessionModal(s = {}) {
  openModal(s.id ? 'Editar sessão' : 'Nova sessão', `
    ${field('Título', 'title', s.title, 'text', 'Sessão 3 — A Cripta')}
    ${field('Data', 'date', s.date || new Date().toISOString().slice(0, 10), 'date')}
    ${fieldArea('Anotações do Mestre (base para o recap)', 'notes', s.notes, 'O grupo entrou na cripta, Theo quase morreu para o esqueleto guardião...')}
    ${s.recap ? fieldArea('Recap gerado (editável)', 'recap', s.recap) : ''}
  `, async (data) => {
    if (s.id) await api(`/sessions/${s.id}`, { method: 'PUT', body: data });
    else await api('/sessions', { method: 'POST', body: data });
  });
}

// ---------- Iniciativa ----------
const CONDITIONS = ['Agarrado', 'Amedrontado', 'Atordoado', 'Caído', 'Cego', 'Contido', 'Enfeitiçado', 'Envenenado', 'Exausto', 'Incapacitado', 'Inconsciente', 'Invisível', 'Paralisado', 'Petrificado', 'Surdo'];
// Ícone real da condição (game-icons.net) — a descrição completa (efeitos + página do livro) fica no title.
const condImg = (cd, cls = '') => `<img class="cond-icon${cls ? ` ${cls}` : ''}" src="${esc(condIcon(cd))}" alt="${esc(cd)}" />`;
const d20 = () => 1 + Math.floor(Math.random() * 20);
const abilityMod = (score) => Math.floor((Number(score) - 10) / 2);

// ---------- Ficha de personagem: atributos, testes de resistência e perícias ----------
const ABILITIES = [
  { key: 'str', label: 'FOR' }, { key: 'dex', label: 'DES' }, { key: 'con', label: 'CON' },
  { key: 'int', label: 'INT' }, { key: 'wis', label: 'SAB' }, { key: 'cha', label: 'CAR' },
];
const ALIGNMENT_LABELS = {
  LB: 'Leal e Bom', NB: 'Neutro e Bom', CB: 'Caótico e Bom',
  LN: 'Leal e Neutro', N: 'Neutro', CN: 'Caótico e Neutro',
  LM: 'Leal e Mau', NM: 'Neutro e Mau', CM: 'Caótico e Mau',
};
// Bloco de interpretação (traços/ideais/vínculos/defeitos) na ficha somente-leitura —
// só entra se tiver pelo menos um campo preenchido, pra não poluir fichas sem isso.
function sheetRoleplayHtml(ch) {
  const rows = [
    ['Traços de personalidade', ch.personalityTraits],
    ['Ideais', ch.ideals],
    ['Vínculos', ch.bonds],
    ['Defeitos', ch.flaws],
  ].filter(([, v]) => v);
  if (!ch.alignment && !rows.length) return '';
  return `
    <div class="sheet-col-title" style="margin-top:14px;">Interpretação${ch.alignment ? ` <span class="sheet-feature-tag">${esc(ALIGNMENT_LABELS[ch.alignment] || ch.alignment)}</span>` : ''}</div>
    ${rows.map(([label, v]) => `<div class="sheet-feature"><div class="sheet-feature-body"><b>${label}</b><div class="sheet-feature-desc">${esc(v).replace(/\n/g, '<br>')}</div></div></div>`).join('')}`;
}
const SKILLS = [
  { key: 'athletics', label: 'Atletismo', ability: 'str' },
  { key: 'acrobatics', label: 'Acrobacia', ability: 'dex' },
  { key: 'sleightOfHand', label: 'Prestidigitação', ability: 'dex' },
  { key: 'stealth', label: 'Furtividade', ability: 'dex' },
  { key: 'arcana', label: 'Arcanismo', ability: 'int' },
  { key: 'history', label: 'História', ability: 'int' },
  { key: 'investigation', label: 'Investigação', ability: 'int' },
  { key: 'nature', label: 'Natureza', ability: 'int' },
  { key: 'religion', label: 'Religião', ability: 'int' },
  { key: 'animalHandling', label: 'Lidar com Animais', ability: 'wis' },
  { key: 'insight', label: 'Intuição', ability: 'wis' },
  { key: 'medicine', label: 'Medicina', ability: 'wis' },
  { key: 'perception', label: 'Percepção', ability: 'wis' },
  { key: 'survival', label: 'Sobrevivência', ability: 'wis' },
  { key: 'deception', label: 'Enganação', ability: 'cha' },
  { key: 'intimidation', label: 'Intimidação', ability: 'cha' },
  { key: 'performance', label: 'Atuação', ability: 'cha' },
  { key: 'persuasion', label: 'Persuasão', ability: 'cha' },
];
const abilLabel = (key) => ABILITIES.find((a) => a.key === key)?.label || key;
// Bônus de proficiência pelo nível — tabela padrão do 5e (1-4 → +2, 5-8 → +3, ...).
const profBonus = (level) => Math.floor((Math.max(1, Number(level) || 1) - 1) / 4) + 2;
const fmtSigned = (n) => (n >= 0 ? `+${n}` : `${n}`);
const scoreOf = (ch, key) => Number(ch?.abilities?.[key]) || 10;

// ---------- Bestiário (aba dedicada — mesma ficha/ações do modal SRD da Batalha) ----------
let bestiarioMonsters = null; // cache: null = ainda não carregado
let bestiarioFiltered = [];
let bestiarioPage = 1;
let bestiarioQuery = '';
let bestiarioShellRendered = false;
const BESTIARIO_PAGE_SIZE = 12;

async function renderBestiarioTab() {
  if (!$('#tab-bestiario')) return;

  if (!bestiarioShellRendered) {
    bestiarioShellRendered = true;
    $('#tab-bestiario').innerHTML = `
      <div class="tab-header">
        <h2><svg class="icon"><use href="#i-book-open-text"/></svg>Bestiário SRD</h2>
        <div class="actions">
          <input id="bestiario-query" placeholder="Filtrar por nome ou tipo (inglês)..." style="min-width:240px;" />
        </div>
      </div>
      <p class="help-text">Clique num card para abrir a ficha completa (traduzida por IA) — os botões enviam direto pra iniciativa/mapa sem sair da lista.</p>
      <div id="bestiario-results"></div>
      <div id="bestiario-pagination" style="display:flex;align-items:center;justify-content:center;gap:8px;margin-top:14px;flex-wrap:wrap;"></div>`;

    $('#bestiario-query').addEventListener('input', (e) => {
      bestiarioQuery = e.target.value.trim().toLowerCase();
      applyBestiarioFilter();
    });
  }

  if (bestiarioMonsters === null) {
    $('#bestiario-results').innerHTML = '<p class="help-text">Carregando bestiário...</p>';
    bestiarioMonsters = (await tryApi(() => api('/srd/monsters'))) || [];
    bestiarioMonsters.sort((a, b) => a.name.localeCompare(b.name));
    applyBestiarioFilter();
  }
}

function applyBestiarioFilter() {
  bestiarioFiltered = bestiarioQuery
    ? bestiarioMonsters.filter((m) =>
        m.name.toLowerCase().includes(bestiarioQuery) ||
        (m.type || '').toLowerCase().includes(bestiarioQuery))
    : bestiarioMonsters;
  bestiarioPage = 1;
  renderBestiarioList();
}

let bestiarioLoadToken = 0; // descarta respostas de páginas que o Mestre já deixou

async function renderBestiarioList() {
  const totalPages = Math.max(1, Math.ceil(bestiarioFiltered.length / BESTIARIO_PAGE_SIZE));
  bestiarioPage = Math.min(Math.max(1, bestiarioPage), totalPages);
  const start = (bestiarioPage - 1) * BESTIARIO_PAGE_SIZE;
  const pageItems = bestiarioFiltered.slice(start, start + BESTIARIO_PAGE_SIZE);

  $('#bestiario-pagination').innerHTML = `
    <button class="btn small ghost" id="best-first" ${bestiarioPage === 1 ? 'disabled' : ''}>« Primeira</button>
    <button class="btn small ghost" id="best-prev" ${bestiarioPage === 1 ? 'disabled' : ''}>‹ Anterior</button>
    <span class="help-text">Página ${bestiarioPage} de ${totalPages} · ${bestiarioFiltered.length} monstro(s)</span>
    <button class="btn small ghost" id="best-next" ${bestiarioPage === totalPages ? 'disabled' : ''}>Próxima ›</button>
    <button class="btn small ghost" id="best-last" ${bestiarioPage === totalPages ? 'disabled' : ''}>Última »</button>`;
  $('#best-first').onclick = () => { bestiarioPage = 1; renderBestiarioList(); };
  $('#best-prev').onclick = () => { bestiarioPage -= 1; renderBestiarioList(); };
  $('#best-next').onclick = () => { bestiarioPage += 1; renderBestiarioList(); };
  $('#best-last').onclick = () => { bestiarioPage = totalPages; renderBestiarioList(); };

  if (!pageItems.length) {
    $('#bestiario-results').innerHTML = '<div class="help-text">Nada encontrado.</div>';
    return;
  }

  // Busca ficha (CA/PV/CR) e arte de cada monstro da página — 12 por vez, tudo cacheado no servidor.
  const myToken = ++bestiarioLoadToken;
  $('#bestiario-results').innerHTML = '<p class="help-text">Carregando fichas...</p>';

  const cards = await Promise.all(pageItems.map(async (m) => {
    try {
      const [detail, imgRes] = await Promise.all([
        api(`/srd/monsters/${m.index}`),
        api(`/srd/monsters/${m.index}/image`).catch(() => ({ url: null })),
      ]);
      return { index: m.index, name: m.name, detail, art: imgRes?.url || '' };
    } catch {
      return { index: m.index, name: m.name, detail: null, art: '' };
    }
  }));
  if (myToken !== bestiarioLoadToken) return; // o Mestre já virou a página / mudou o filtro

  $('#bestiario-results').innerHTML = `<div class="grid">${cards.map(bestiarioCardHtml).join('')}</div>`;

  $$('#bestiario-results .bestiario-card').forEach((el) => { el.onclick = () => showMonster(el.dataset.index); });
  $$('#bestiario-results [data-srd-add]').forEach((b) => b.onclick = (e) => { e.stopPropagation(); addMonster(b.dataset.srdAdd, false); });
  $$('#bestiario-results [data-srd-map]').forEach((b) => b.onclick = (e) => { e.stopPropagation(); addMonster(b.dataset.srdMap, true); });
}

// Card no estilo ficha (igual aos de Personagens): foto, tipo/tamanho/alinhamento, CA/PV/CR.
// O card inteiro é clicável e abre a ficha completa (showMonster); os botões de ação
// param a propagação pra não abrir o modal junto.
function bestiarioCardHtml({ index, name, detail, art }) {
  if (!detail) {
    return `
      <div class="card bestiario-card" data-index="${esc(index)}">
        <h3>${esc(name)}</h3>
        <div class="meta">Ficha indisponível no momento — tente de novo.</div>
      </div>`;
  }
  const size = _PT_SIZES[detail.size] || detail.size;
  const type = _PT_TYPES[detail.type?.toLowerCase()] || detail.type;
  const align = _PT_ALIGNS[detail.alignment?.toLowerCase()] || detail.alignment;
  const ac = detail.armor_class?.[0]?.value ?? '?';
  return `
    <div class="card bestiario-card" data-index="${esc(index)}">
      ${art ? `<img class="thumb" src="${esc(art)}" alt="" onerror="this.remove()" />` : '<div class="thumb thumb-placeholder"><svg class="icon" style="font-size:32px;"><use href="#i-skull"/></svg></div>'}
      <h3>${esc(name)}</h3>
      <div class="meta">${esc(size)} ${esc(type)}, ${esc(align)}</div>
      <div class="meta"><svg class="icon"><use href="#i-shield"/></svg> CA ${esc(ac)} · <svg class="icon"><use href="#i-heart-straight"/></svg> ${esc(detail.hit_points)} PV · CR ${esc(detail.challenge_rating)}</div>
      <div class="row">
        <button class="btn small ghost"><svg class="icon"><use href="#i-clipboard-text"/></svg>Ficha completa</button>
        <button class="btn small" data-srd-add="${esc(index)}">+ Iniciativa</button>
        <button class="btn small gold" data-srd-map="${esc(index)}" title="Iniciativa + mapa"><svg class="icon"><use href="#i-map-trifold"/></svg></button>
      </div>
    </div>`;
}

function srdModal() {
  $('#modal').innerHTML = `
    <h3>Bestiário SRD</h3>
    <div class="row" style="align-items:center;margin-bottom:10px;">
      <input id="srd-query" placeholder="goblin, dragon, skeleton... (nome em inglês)" style="flex:1;" />
      <button class="btn small" id="btn-srd-search"><svg class="icon"><use href="#i-magnifying-glass"/></svg>Buscar</button>
    </div>
    <div id="srd-results" style="max-height:340px;overflow-y:auto;"></div>
    <div class="modal-actions">
      <button class="btn ghost" id="modal-cancel">Fechar</button>
    </div>`;
  openModalBackdrop();
  $('#modal-cancel').onclick = closeModal;

  const doSearch = async () => {
    const q = $('#srd-query').value.trim();
    if (!q) return;
    $('#srd-results').innerHTML = '<div class="help-text">Buscando...</div>';
    const results = await tryApi(() => api(`/srd/monsters?q=${encodeURIComponent(q)}`));
    if (!results) return;
    $('#srd-results').innerHTML = results.length
      ? results.slice(0, 12).map((m) => `
          <div class="srd-result-row">
            <span>${esc(m.name)}</span>
            <button class="btn small ghost" data-srd-view="${esc(m.index)}"><svg class="icon"><use href="#i-clipboard-text"/></svg>Ficha</button>
            <button class="btn small" data-srd-add="${esc(m.index)}">+ Iniciativa</button>
            <button class="btn small gold" data-srd-map="${esc(m.index)}" title="Iniciativa + mapa"><svg class="icon"><use href="#i-map-trifold"/></svg></button>
          </div>`).join('')
      : '<div class="help-text">Nada encontrado — busque pelo nome em inglês (ex: goblin, dragon, skeleton).</div>';

    $$('#srd-results [data-srd-view]').forEach((b) => b.onclick = () => showMonster(b.dataset.srdView));
    $$('#srd-results [data-srd-add]').forEach((b) => b.onclick = () => { closeModal(); addMonster(b.dataset.srdAdd, false); });
    $$('#srd-results [data-srd-map]').forEach((b) => b.onclick = () => { closeModal(); addMonster(b.dataset.srdMap, true); });
  };
  $('#btn-srd-search').onclick = doSearch;
  $('#srd-query').addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });
  setTimeout(() => $('#srd-query')?.focus(), 50);
}

// Quadrados que a criatura ocupa, pelo tamanho do SRD
const SRD_SIZE = { Tiny: 1, Small: 1, Medium: 1, Large: 2, Huge: 3, Gargantuan: 4 };

// Traz o monstro do bestiário para a iniciativa e, se pedido, já como token no mapa.
async function addMonster(index, aoMapa) {
  const m = await tryApi(() => api(`/srd/monsters/${index}`));
  if (!m) return;
  const c = state.combat;
  const mod = abilityMod(m.dexterity);
  const iguais = c.entries.filter((e) => e.name.startsWith(m.name)).length;
  const nome = iguais ? `${m.name} ${iguais + 1}` : m.name;
  // O SRD fala em pés ("30 ft."); a mesa fala em metros.
  const pes = parseInt(String(m.speed?.walk || '30'), 10) || 30;
  const metros = Math.round((pes / 5) * 1.5 * 10) / 10;
  const arte = await srdImage(m.index);

  c.entries.push({
    name: nome,
    init: d20() + mod,
    initMod: mod,
    hp: m.hit_points, maxHp: m.hit_points,
    conditions: [], deathSaves: { s: 0, f: 0 },
    srdIndex: m.index,
    imageUrl: arte,
  });
  logCombat(`${nome} entrou no combate (iniciativa d20${mod >= 0 ? '+' : ''}${mod})`);
  await tryApi(() => api('/combat', { method: 'PUT', body: c }));

  if (aoMapa) {
    const map = activeMap();
    if (!map) return toast('Entrou na iniciativa, mas não há mapa em jogo para receber o token.', true);
    state.battle.tokens.push({
      id: Math.random().toString(16).slice(2, 10),
      name: nome, kind: 'enemy', combatName: nome,
      ...nextTokenSlot(map, occupiedCells()),
      size: SRD_SIZE[m.size] || 1,
      speed: metros,
      hp: m.hit_points, maxHp: m.hit_points,
      hidden: false, color: '', imageUrl: arte,
    });
    pushBattle();
    toast(`${nome} entrou na iniciativa (d20${mod >= 0 ? '+' : ''}${mod}) e está no mapa.`);
  } else {
    toast(`${nome} entrou na iniciativa (d20${mod >= 0 ? '+' : ''}${mod}).`);
  }
  refresh();
}

// A que "espécie" de token um personagem vira no mapa (cor/ícone).
function kindDoPersonagem(ch) {
  if (!ch) return 'enemy';
  if (ch.type === 'pc') return 'pc';
  return ch.npcType === 'inimigo' ? 'enemy' : 'npc';
}

// Traz um personagem criado (jogador ou NPC) para a batalha e, se pedido, já pro mapa.
// É o elo que faltava: antes só PCs (em bloco) e monstros do SRD entravam no combate.
async function addCharacter(charId, aoMapa) {
  const ch = state.characters.find((c) => c.id === charId);
  if (!ch) return;
  const c = state.combat;
  const iguais = c.entries.filter((e) => e.name === ch.name || e.name.startsWith(`${ch.name} `)).length;
  const nome = iguais ? `${ch.name} ${iguais + 1}` : ch.name;
  const isPc = ch.type === 'pc';
  const dexMod = abilityMod(scoreOf(ch, 'dex'));

  c.entries.push({
    name: nome,
    init: d20() + dexMod,
    initMod: dexMod,
    hp: Number(ch.hp) || 0, maxHp: Number(ch.maxHp) || 0,
    conditions: [], deathSaves: { s: 0, f: 0 },
    isPc,
    charId: ch.id,
    imageUrl: ch.imageUrl || '',
  });
  logCombat(`${nome} entrou no combate (iniciativa d20${dexMod >= 0 ? '+' : ''}${dexMod})`);
  await tryApi(() => api('/combat', { method: 'PUT', body: c }));

  if (aoMapa) {
    const map = activeMap();
    if (!map) { toast('Entrou na batalha, mas não há mapa em jogo para receber o token.', true); return refresh(); }
    state.battle.tokens.push({
      id: Math.random().toString(16).slice(2, 10),
      name: nome, kind: kindDoPersonagem(ch), combatName: nome,
      ...nextTokenSlot(map, occupiedCells()),
      size: 1, speed: 9,
      hp: Number(ch.hp) || 0, maxHp: Number(ch.maxHp) || 0,
      hidden: false, color: '', imageUrl: ch.imageUrl || '', charId: ch.id,
    });
    pushBattle();
    toast(`${nome} entrou na batalha e está no mapa.`);
  } else {
    toast(`${nome} entrou na batalha.`);
  }
  refresh();
}

// Coloca o token de um personagem cadastrado no mapa, SEM entrar no combate (fica em
// "OUTROS NO MAPA"). Útil para NPCs de cenário, figurantes, etc.
function placeCharacterToken(charId) {
  const ch = state.characters.find((c) => c.id === charId);
  if (!ch) return;
  const map = activeMap();
  if (!map) return toast('Coloque um mapa em jogo primeiro.', true);
  state.battle.tokens.push({
    id: Math.random().toString(16).slice(2, 10),
    name: ch.name, kind: kindDoPersonagem(ch), combatName: '',
    ...nextTokenSlot(map, occupiedCells()),
    size: 1, speed: 9,
    hp: Number(ch.hp) || 0, maxHp: Number(ch.maxHp) || 0,
    hidden: false, color: '', imageUrl: ch.imageUrl || '', charId: ch.id,
  });
  pushBattle();
  renderMapSide();
  toast(`${ch.name} colocado no mapa.`);
}

// Seletor dos personagens do Mestre (jogadores e NPCs) para jogar na batalha.
function charPickerModal() {
  const chars = state.characters || [];
  const pcs = chars.filter((c) => c.type === 'pc');
  const npcs = chars.filter((c) => c.type === 'npc');
  const NPC_ICON = { inimigo: 'skull', quest: 'scroll', aleatorio: 'dice-six', npc: 'mask-happy' };
  const iconSvg = (name) => `<svg class="icon"><use href="#i-${name}"/></svg>`;

  const row = (ch) => {
    const isPc = ch.type === 'pc';
    const icon = isPc ? 'game-controller' : (NPC_ICON[ch.npcType] || 'mask-happy');
    const hpTxt = ch.maxHp ? ` · ${ch.hp ?? ch.maxHp}/${ch.maxHp} PV` : '';
    return `
      <div class="srd-result-row">
        ${ch.imageUrl
          ? `<img class="cp-thumb" src="${esc(ch.imageUrl)}" alt="" data-fallback-icon="${icon}" />`
          : `<span class="cp-thumb placeholder">${iconSvg(icon)}</span>`}
        <span>${esc(ch.name)}<small style="color:var(--muted);">${esc(hpTxt)}</small></span>
        <button class="btn small" data-cp-add="${ch.id}" title="Entra só na iniciativa (sem token no mapa)"><svg class="icon"><use href="#i-sword"/></svg>Combate</button>
        <button class="btn small gold" data-cp-map="${ch.id}" title="Entra na iniciativa E vira token no mapa"><svg class="icon"><use href="#i-map-trifold"/></svg>Combate + mapa</button>
        <button class="btn small ghost" data-cp-token="${ch.id}" title="Só coloca o token no mapa, sem entrar no combate"><svg class="icon"><use href="#i-map-pin"/></svg>Só mapa</button>
      </div>`;
  };
  const section = (titulo, arr) => arr.length
    ? `<div class="cp-section-label">${titulo}</div>${arr.map(row).join('')}` : '';

  $('#modal').innerHTML = `
    <h3>Adicionar personagem</h3>
    <div class="row" style="gap:6px;margin-bottom:10px;flex-wrap:wrap;">
      ${pcs.length ? '<button class="btn small ghost" id="cp-all-pcs"><svg class="icon"><use href="#i-users"/></svg>Todos os jogadores</button>' : ''}
      <button class="btn small ghost" id="cp-blank"><svg class="icon"><use href="#i-square"/></svg>Token em branco</button>
    </div>
    <div id="cp-list" style="max-height:360px;overflow-y:auto;">
      ${chars.length
        ? section('Jogadores', pcs) + section('NPCs', npcs)
        : '<div class="help-text">Nenhum personagem cadastrado ainda. Crie na aba Personagens.</div>'}
    </div>
    <div class="modal-actions"><button class="btn ghost" id="modal-cancel">Fechar</button></div>`;
  openModalBackdrop();
  $('#modal-cancel').onclick = closeModal;
  $('#cp-blank').onclick = () => { closeModal(); tokenModal(); };

  // Retrato que falha ao carregar (rede) ou "carrega" corrompido/vazio (naturalWidth 0,
  // sem disparar erro) vira o mesmo placeholder redondo com o ícone — nunca fica em branco.
  $$('#cp-list img.cp-thumb').forEach((img) => {
    const swap = () => {
      if (!img.isConnected) return;
      const span = document.createElement('span');
      span.className = 'cp-thumb placeholder';
      span.innerHTML = iconSvg(img.dataset.fallbackIcon || 'mask-happy');
      img.replaceWith(span);
    };
    img.addEventListener('error', swap, { once: true });
    const checkDecoded = () => { if (img.naturalWidth === 0) swap(); };
    if (img.complete) checkDecoded();
    else img.addEventListener('load', checkDecoded, { once: true });
  });

  const allPcs = $('#cp-all-pcs');
  if (allPcs) allPcs.onclick = async () => {
    const c = state.combat;
    for (const pc of pcs) {
      if (!c.entries.some((e) => e.name === pc.name)) {
        const dexMod = abilityMod(scoreOf(pc, 'dex'));
        c.entries.push({
          name: pc.name, init: d20() + dexMod, initMod: dexMod, hp: pc.hp ?? 0, maxHp: pc.maxHp ?? 0,
          conditions: [], deathSaves: { s: 0, f: 0 }, isPc: true,
          charId: pc.id, imageUrl: pc.imageUrl || '',
        });
        logCombat(`${pc.name} entrou no combate (iniciativa d20${dexMod >= 0 ? '+' : ''}${dexMod})`);
      }
    }
    await tryApi(() => api('/combat', { method: 'PUT', body: c }));
    closeModal();
    refresh();
  };
  $$('#cp-list [data-cp-add]').forEach((b) => b.onclick = () => { closeModal(); addCharacter(b.dataset.cpAdd, false); });
  $$('#cp-list [data-cp-map]').forEach((b) => b.onclick = () => { closeModal(); addCharacter(b.dataset.cpMap, true); });
  $$('#cp-list [data-cp-token]').forEach((b) => b.onclick = () => { closeModal(); placeCharacterToken(b.dataset.cpToken); });
}

// ---------- Glossário PT-BR do Bestiário SRD ----------
const _PT_SIZES = { Tiny:'Minúsculo', Small:'Pequeno', Medium:'Médio', Large:'Grande', Huge:'Enorme', Gargantuan:'Colossal' };
const _PT_TYPES = { aberration:'aberração', beast:'besta', celestial:'celestial', construct:'constructo', dragon:'dragão', elemental:'elemental', fey:'feérico', fiend:'demônio', giant:'gigante', humanoid:'humanoide', monstrosity:'monstruosidade', ooze:'gosma', plant:'planta', undead:'morto-vivo' };
const _PT_ALIGNS = { 'lawful good':'leal e bom','neutral good':'neutro e bom','chaotic good':'caótico e bom','lawful neutral':'leal e neutro','true neutral':'neutro verdadeiro','neutral':'neutro','chaotic neutral':'caótico e neutro','lawful evil':'leal e mau','neutral evil':'neutro e mau','chaotic evil':'caótico e mau','unaligned':'sem alinhamento','any alignment':'qualquer alinhamento','any chaotic alignment':'qualquer alinhamento caótico','any evil alignment':'qualquer alinhamento mau','any non-good alignment':'qualquer alinhamento não-bom','any non-lawful alignment':'qualquer alinhamento não-leal' };
const _PT_SPEEDS = { walk:'', fly:'Voo', swim:'Natação', climb:'Escalada', burrow:'Escavação', hover:'Pairar' };
const _PT_SENSES = { darkvision:'Visão no Escuro', blindsight:'Visão às Cegas', tremorsense:'Tremorsense', truesight:'Visão Verdadeira', passive_perception:'Percepção Passiva' };
const _PT_SKILLS = { acrobatics:'Acrobacia', 'animal handling':'Adestrar Animais', arcana:'Arcanismo', athletics:'Atletismo', deception:'Enganação', history:'História', insight:'Perspicácia', intimidation:'Intimidação', investigation:'Investigação', medicine:'Medicina', nature:'Natureza', perception:'Percepção', performance:'Atuação', persuasion:'Persuasão', religion:'Religião', 'sleight of hand':'Prestidigitação', stealth:'Furtividade', survival:'Sobrevivência' };

// Substituições ordenadas do mais específico ao mais genérico
const _PT_PHRASES = [
  [/Melee or Ranged Weapon Attack/gi,'Ataque de Arma CâC ou à Distância'],
  [/Melee Weapon Attack/gi,'Ataque de Arma Corpo a Corpo'],
  [/Ranged Weapon Attack/gi,'Ataque de Arma à Distância'],
  [/Melee Spell Attack/gi,'Ataque Mágico Corpo a Corpo'],
  [/Ranged Spell Attack/gi,'Ataque Mágico à Distância'],
  [/\+(\d+) to hit/gi,'+$1 para acertar'],
  [/reach (\d+) ft\.?/gi,(_,n)=>`alcance ${(+n*0.3).toFixed(1).replace('.',',')} m`],
  [/range (\d+)\/(\d+) ft\.?/gi,(_,a,b)=>`alcance ${Math.round(+a*0.3)}/${Math.round(+b*0.3)} m`],
  [/(\d+) ft\.?/gi,(_,n)=>`${Math.round(+n*0.3)} m`],
  [/\bone target\b/gi,'um alvo'],[/\bone creature\b/gi,'uma criatura'],[/\bone object\b/gi,'um objeto'],
  [/\bthe target\b/gi,'o alvo'],[/\beach creature\b/gi,'cada criatura'],[/\bcreatures\b/gi,'criaturas'],[/\bcreature\b/gi,'criatura'],
  [/\bHit:/g,'Acerto:'],[/\bMiss:/g,'Erro:'],
  [/\bSaving Throw:/gi,'Teste de Resistência:'],[/\bsaving throw\b/gi,'teste de resistência'],
  [/\bDC (\d+)\b/g,'CD $1'],
  [/\bStrength\b/g,'Força'],[/\bDexterity\b/g,'Destreza'],[/\bConstitution\b/g,'Constituição'],
  [/\bIntelligence\b/g,'Inteligência'],[/\bWisdom\b/g,'Sabedoria'],[/\bCharisma\b/g,'Carisma'],
  [/\bslashing damage\b/gi,'dano cortante'],[/\bpiercing damage\b/gi,'dano perfurante'],[/\bbludgeoning damage\b/gi,'dano contundente'],
  [/\bfire damage\b/gi,'dano de fogo'],[/\bcold damage\b/gi,'dano de frio'],[/\blightning damage\b/gi,'dano de raio'],
  [/\bthunder damage\b/gi,'dano de trovão'],[/\bacid damage\b/gi,'dano de ácido'],[/\bpoison damage\b/gi,'dano de veneno'],
  [/\bradiant damage\b/gi,'dano radiante'],[/\bnecrotic damage\b/gi,'dano necrótico'],[/\bpsychic damage\b/gi,'dano psíquico'],[/\bforce damage\b/gi,'dano de força'],
  [/\bslashing\b/gi,'cortante'],[/\bpiercing\b/gi,'perfurante'],[/\bbludgeoning\b/gi,'contundente'],
  [/\bfire\b/gi,'fogo'],[/\bcold\b/gi,'frio'],[/\blightning\b/gi,'raio'],[/\bthunder\b/gi,'trovão'],
  [/\bacid\b/gi,'ácido'],[/\bradiant\b/gi,'radiante'],[/\bnecrotic\b/gi,'necrótico'],[/\bpsychic\b/gi,'psíquico'],
  [/\bblinded\b/gi,'cego'],[/\bcharmed\b/gi,'enfeitiçado'],[/\bdeafened\b/gi,'surdo'],[/\bfrightened\b/gi,'amedrontado'],
  [/\bgrappled\b/gi,'agarrado'],[/\bincapacitated\b/gi,'incapacitado'],[/\binvisible\b/gi,'invisível'],
  [/\bparalyzed\b/gi,'paralisado'],[/\bpetrified\b/gi,'petrificado'],[/\bpoisoned\b/gi,'envenenado'],
  [/\bprone\b/gi,'caído'],[/\brestrained\b/gi,'contido'],[/\bstunned\b/gi,'atordoado'],[/\bunconscious\b/gi,'inconsciente'],
  [/\bMultiattack\b/g,'Ataque Múltiplo'],[/\bSpellcasting\b/g,'Conjuração'],[/\bInnate Spellcasting\b/g,'Conjuração Inata'],
  [/\bPack Tactics\b/g,'Táticas de Matilha'],[/\bLegendary Resistance\b/g,'Resistência Lendária'],[/\bMagic Resistance\b/g,'Resistência à Magia'],
  [/\bMagic Weapons\b/g,'Armas Mágicas'],[/\bSunlight Sensitivity\b/g,'Sensibilidade à Luz Solar'],[/\bUndead Fortitude\b/g,'Fortitude dos Mortos-Vivos'],
  [/\bCharge\b/g,'Investida'],[/\bEvasion\b/g,'Esquiva'],[/\bSneak Attack\b/g,'Ataque Furtivo'],[/\bAggressive\b/g,'Agressivo'],
  [/\bAmbusher\b/g,'Emboscador'],[/\bFalse Appearance\b/g,'Aparência Falsa'],[/\bShapechanger\b/g,'Metamorfo'],
  [/\bKeen Sight\b/g,'Visão Aguçada'],[/\bKeen Smell\b/g,'Olfato Aguçado'],[/\bKeen Hearing\b/g,'Audição Aguçada'],[/\bKeen Senses\b/g,'Sentidos Aguçados'],
  [/\bWeb Sense\b/g,'Sentido de Teia'],[/\bWeb Walker\b/g,'Caminhante de Teia'],[/\bDeath Burst\b/g,'Explosão de Morte'],
  [/\bBites?\b/gi,(m)=>/s$/i.test(m)?'Mordidas':'Mordida'],[/\bClaws?\b/gi,(m)=>/s$/i.test(m)?'Garras':'Garra'],[/\bTail\b/gi,'Cauda'],[/\bTentacles?\b/gi,(m)=>/s$/i.test(m)?'Tentáculos':'Tentáculo'],
  [/\bSlam\b/g,'Pancada'],[/\bFist\b/g,'Soco'],[/\bGreatsword\b/g,'Espadão'],[/\bLongsword\b/g,'Espada Longa'],[/\bShortsword\b/g,'Espada Curta'],
  [/\bScimitar\b/g,'Cimitarra'],[/\bShortbow\b/g,'Arco Curto'],[/\bLongbow\b/g,'Arco Longo'],[/\bHandaxe\b/g,'Machadinha'],
  [/\bJavelin\b/g,'Dardo'],[/\bSpear\b/g,'Lança'],[/\bDagger\b/g,'Adaga'],[/\bMace\b/g,'Maça'],[/\bGlaive\b/g,'Glaive'],
  [/\bhit points?\b/gi,(m)=>m==='hit points'?'pontos de vida':'ponto de vida'],
  [/\bArmor Class\b/gi,'Classe de Armadura'],[/\bopportunity attack\b/gi,'ataque de oportunidade'],
  [/\bbonus action\b/gi,'ação bônus'],[/\breaction\b/gi,'reação'],[/\battack roll\b/gi,'rolagem de ataque'],
  [/\bproficiency bonus\b/gi,'bônus de proficiência'],[/\bhalf damage\b/gi,'metade do dano'],[/\bno damage\b/gi,'nenhum dano'],
  [/\bspell slot\b/gi,'espaço de magia'],[/\bspell slots\b/gi,'espaços de magia'],
  [/\bcantrips?\b/gi,(m)=>m==='cantrips'?'truques':'truque'],
  [/\bspells?\b/gi,(m)=>m==='spells'?'magias':'magia'],
  [/\brounds?\b/gi,(m)=>m.toLowerCase()==='rounds'?'rodadas':'rodada'],
  [/\bturns?\b/gi,(m)=>m.toLowerCase()==='turns'?'turnos':'turno'],
  [/\bhours?\b/gi,(m)=>m.toLowerCase()==='hours'?'horas':'hora'],
  [/\bminutes?\b/gi,(m)=>m.toLowerCase()==='minutes'?'minutos':'minuto'],
  [/\bdays?\b/gi,(m)=>m.toLowerCase()==='days'?'dias':'dia'],
  [/\bmagical\b/gi,'mágico'],[/\bweapon\b/gi,'arma'],[/\bdamage\b/gi,'dano'],[/\bmovement\b/gi,'movimento'],
  // Sentidos em texto corrido
  [/\bdarkvision\b/gi,'visão no escuro'],[/\bblindsite\b/gi,'visão às cegas'],[/\bblindsight\b/gi,'visão às cegas'],
  [/\btremorsense\b/gi,'tremorsense'],[/\btruesight\b/gi,'visão verdadeira'],
  // Padrões de frase frequentes em blocos de ação
  [/\bor be ([a-z]+ed)\b/gi,(_,cond)=>`ou ficar ${_srdPt(cond)}`],
  [/\buntil the end of its next turn\b/gi,'até o final do seu próximo turno'],
  [/\buntil the start of its next turn\b/gi,'até o início do seu próximo turno'],
  [/\buntil the end of your next turn\b/gi,'até o final do seu próximo turno'],
  [/\bat the start of each of its turns\b/gi,'no início de cada um dos seus turnos'],
  [/\bat the end of each of its turns\b/gi,'no final de cada um dos seus turnos'],
  [/\bonce per day\b/gi,'uma vez por dia'],[/\bonce per turn\b/gi,'uma vez por turno'],
  [/\bon a failed save\b/gi,'em uma falha no teste'],[/\bon a successful save\b/gi,'em um sucesso no teste'],
  [/\bwhile it is\b/gi,'enquanto está'],[/\bwhile it has\b/gi,'enquanto tem'],
  [/\bif it fails\b/gi,'se falhar'],[/\bif it succeeds\b/gi,'se tiver sucesso'],
  [/\bfor the duration\b/gi,'pela duração'],[/\buntil dispelled\b/gi,'até ser dissipado'],
  [/\bin addition\b/gi,'além disso'],[/\binstead\b/gi,'em vez disso'],[/\bhowever\b/gi,'porém'],
  [/\bup to\b/gi,'até'],[/\bat least\b/gi,'pelo menos'],[/\bat most\b/gi,'no máximo'],
  [/\bwithin (\d+ m)\b/gi,'a $1 de distância'],
  // Frases seguras (tradução de frase inteira, sem quebrar concordância)
  [/\bon each of its turns\b/gi,'em cada um de seus turnos'],
  [/\bas a bonus action\b/gi,'como uma ação bônus'],
  [/\bas an action\b/gi,'como uma ação'],[/\bas a reaction\b/gi,'como uma reação'],
  [/\bopportunity attacks?\b/gi,(m)=>/s$/i.test(m)?'ataques de oportunidade':'ataque de oportunidade'],
  [/\bdifficult terrain\b/gi,'terreno difícil'],
  [/\bhas advantage on\b/gi,'tem vantagem em'],[/\bhas disadvantage on\b/gi,'tem desvantagem em'],
  [/\badvantage on\b/gi,'vantagem em'],[/\bdisadvantage on\b/gi,'desvantagem em'],
  [/\bis immune to\b/gi,'é imune a'],[/\bare immune to\b/gi,'são imunes a'],
  [/\bcan breathe air and water\b/gi,'pode respirar ar e água'],
  [/\bthe Disengage or Hide action\b/gi,'a ação Desengajar ou Esconder-se'],
  [/\bDisengage\b/g,'Desengajar'],[/\bDodge\b/g,'Esquivar'],[/\bDash\b/g,'Disparar'],
  [/\bregains? (\d+) hit points?\b/gi,(_,n)=>`recupera ${n} pontos de vida`],
  [/\bdoesn't provoke\b/gi,'não provoca'],[/\bcan't be\b/gi,'não pode ser'],
  [/\bcan see\b/gi,'pode ver'],[/\bcan move\b/gi,'pode se mover'],
];

function _srdPt(text) {
  if (!text) return text;
  let t = String(text);
  for (const [re, rep] of _PT_PHRASES) t = t.replace(re, rep);
  return t;
}

let _srdLang = 'pt'; // estado global do toggle no modal

async function showMonster(index) {
  const [m, arte] = await Promise.all([
    tryApi(() => api(`/srd/monsters/${index}`)),
    srdImage(index),
  ]);
  if (!m) return;

  let ptBlocks = null;   // tradução completa da IA (chega depois, se disponível)
  let ptLoading = false;

  const renderMonster = (lang) => {
    const pt = lang === 'pt';
    const T = (s) => pt ? _srdPt(s) : s;
    const Tname = (s) => pt ? _srdPt(s) : s;

    const mods = ['strength','dexterity','constitution','intelligence','wisdom','charisma'];
    const modLabels = ['FOR','DES','CON','INT','SAB','CAR'];
    const fmtMod = (v) => { const mod = abilityMod(v); return `${v} (${mod >= 0 ? '+' : ''}${mod})`; };

    const size   = pt ? (_PT_SIZES[m.size] || m.size) : m.size;
    const type   = pt ? (_PT_TYPES[m.type?.toLowerCase()] || m.type) : m.type;
    const align  = pt ? (_PT_ALIGNS[m.alignment?.toLowerCase()] || m.alignment) : m.alignment;

    const ftToM = (s) => String(s).replace(/(\d+)\s*ft\.?/gi, (_, n) => `${Math.round(+n * 0.3)} m`);

    const speedStr = Object.entries(m.speed || {}).map(([k, v]) => {
      const label = pt ? (_PT_SPEEDS[k] ?? k) : k;
      const val   = pt ? ftToM(v) : v;
      return label ? `${label} ${val}` : String(val);
    }).join(', ');

    const sensesStr = Object.entries(m.senses || {}).map(([k, v]) => {
      const label = pt ? (_PT_SENSES[k] || k.replace(/_/g,' ')) : k.replace(/_/g,' ');
      const val   = pt ? ftToM(v) : v;
      return `${label} ${val}`;
    }).join(', ') || '—';

    const dmgList = (arr) => (arr || []).map((x) => {
      const s = x.name || x;
      return pt ? (_srdPt(s)) : s;
    }).join(', ') || '—';

    // Prefere a tradução da IA (ptBlocks) quando já chegou; senão, o dicionário regex.
    const block = (title, key, rawItems) => {
      const usarIA = pt && ptBlocks && (ptBlocks[key] || []).length;
      const items = usarIA ? ptBlocks[key] : (rawItems || []);
      if (!items.length) return '';
      const nome = usarIA ? (s) => s : Tname;
      const desc = usarIA ? (s) => s : T;
      return `<h4 class="srd-block-title">${esc(title)}</h4>` +
        items.map((a) => `<p class="srd-block-item"><b>${esc(nome(a.name))}.</b> ${esc(desc(a.desc))}</p>`).join('');
    };

    const skillsStr = Object.entries(m.proficiencies?.reduce((acc, p) => {
      if (p.proficiency?.name?.startsWith('Skill:')) {
        const sk = p.proficiency.name.replace('Skill: ','');
        acc[sk] = (p.value >= 0 ? '+' : '') + p.value;
      }
      return acc;
    }, {}) || {}).map(([k,v]) => {
      const label = pt ? (_PT_SKILLS[k.toLowerCase()] || k) : k;
      return `${label} ${v}`;
    }).join(', ');

    const savesStr = Object.entries(m.proficiencies?.reduce((acc, p) => {
      if (p.proficiency?.name?.startsWith('Saving Throw:')) {
        const sv = p.proficiency.name.replace('Saving Throw: ','');
        acc[sv] = (p.value >= 0 ? '+' : '') + p.value;
      }
      return acc;
    }, {}) || {}).map(([k,v]) => {
      const labels = {Strength:'FOR',STR:'FOR',Dexterity:'DES',DEX:'DES',Constitution:'CON',CON:'CON',Intelligence:'INT',INT:'INT',Wisdom:'SAB',WIS:'SAB',Charisma:'CAR',CHA:'CAR'};
      return `${(pt ? labels[k] : k) || k} ${v}`;
    }).join(', ');

    const langToggleLabel = pt ? '🇺🇸 Ver em inglês' : '🇧🇷 Ver em português';

    return `
      ${arte ? `<div class="srd-hero"><img src="${esc(arte)}" alt="${esc(m.name)}" onerror="this.closest('.srd-hero').remove()" /></div>` : ''}
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px;">
        <i style="font-size:13px;color:var(--muted);">${esc(size)} ${esc(type)}, ${esc(align)}</i>
        <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">
          <span id="srd-ai-status" class="srd-ai-status"></span>
          <button class="btn small ghost" id="srd-lang-toggle" style="font-size:11px;">${langToggleLabel}</button>
        </div>
      </div>
      <div class="srd-stat-bar">
        <span><b>CA</b> ${esc(m.armor_class?.[0]?.value ?? '?')}</span>
        <span><b>PV</b> ${esc(m.hit_points)} <small>(${esc(m.hit_dice)})</small></span>
        <span><b>${pt ? 'Desl.' : 'Speed'}</b> ${esc(speedStr)}</span>
      </div>
      <div class="srd-ability-row">
        ${mods.map((k, i) => `<div class="srd-ability"><div class="srd-ab-label">${modLabels[i]}</div><div class="srd-ab-val">${fmtMod(m[k])}</div></div>`).join('')}
      </div>
      <div class="srd-meta">
        ${savesStr ? `<div><b>${pt ? 'TR' : 'Saves'}</b> ${esc(savesStr)}</div>` : ''}
        ${skillsStr ? `<div><b>${pt ? 'Perícias' : 'Skills'}</b> ${esc(skillsStr)}</div>` : ''}
        ${m.damage_resistances?.length ? `<div><b>${pt ? 'Resistências' : 'Resistances'}</b> ${esc(dmgList(m.damage_resistances))}</div>` : ''}
        ${m.damage_immunities?.length ? `<div><b>${pt ? 'Imunidades' : 'Immunities'}</b> ${esc(dmgList(m.damage_immunities))}</div>` : ''}
        ${m.condition_immunities?.length ? `<div><b>${pt ? 'Imune a' : 'Immune to'}</b> ${esc(dmgList(m.condition_immunities))}</div>` : ''}
        <div><b>${pt ? 'Sentidos' : 'Senses'}</b> ${esc(sensesStr)}</div>
        <div><b>${pt ? 'Idiomas' : 'Languages'}</b> ${esc(m.languages || '—')}</div>
        <div><b>CR</b> ${esc(m.challenge_rating)} (${esc(m.xp)} XP)</div>
      </div>
      ${block(pt ? 'Habilidades' : 'Traits', 'special_abilities', m.special_abilities)}
      ${block(pt ? 'Ações' : 'Actions', 'actions', m.actions)}
      ${block(pt ? 'Reações' : 'Reactions', 'reactions', m.reactions)}
      ${block(pt ? 'Ações Lendárias' : 'Legendary Actions', 'legendary_actions', m.legendary_actions)}`;
  };

  // Busca a tradução completa da IA e, quando chega, re-renderiza a ficha em PT.
  const ensurePt = async () => {
    if (_srdLang !== 'pt' || ptBlocks || ptLoading) return;
    ptLoading = true;
    const status = $('#srd-ai-status');
    if (status) status.textContent = 'traduzindo…';
    try {
      const r = await api(`/srd/monsters/${index}/translate`);
      if (r?.blocks) { ptBlocks = r.blocks; if (_srdLang === 'pt') buildModal('pt'); }
    } catch { /* mantém o dicionário */ }
    ptLoading = false;
    const s2 = $('#srd-ai-status');
    if (s2 && !ptBlocks) s2.textContent = '';
  };

  const buildModal = (lang) => {
    $('#modal').innerHTML = `
      <h3><svg class="icon"><use href="#i-clipboard-text"/></svg> ${esc(m.name)}</h3>
      <div id="srd-sheet" style="font-size:13px;line-height:1.6;max-height:65vh;overflow-y:auto;">${renderMonster(lang)}</div>
      <div class="modal-actions">
        <button class="btn ghost" id="modal-cancel">Fechar</button>
        <button class="btn small" id="srd-add-quick">+ Iniciativa</button>
        <button class="btn small gold" id="srd-map-quick" title="Iniciativa + mapa"><svg class="icon"><use href="#i-map-trifold"/></svg> + Mapa</button>
      </div>`;
    openModalBackdrop();
    $('#modal-cancel').onclick = closeModal;
    $('#srd-lang-toggle').onclick = () => { _srdLang = _srdLang === 'pt' ? 'en' : 'pt'; buildModal(_srdLang); };
    $('#srd-add-quick').onclick = () => { closeModal(); addMonster(m.index, false); };
    $('#srd-map-quick').onclick = () => { closeModal(); addMonster(m.index, true); };
    // Marca a tradução da IA quando já está ativa; senão dispara a busca.
    const status = $('#srd-ai-status');
    if (status && lang === 'pt' && ptBlocks) status.textContent = 'tradução por IA';
    if (lang === 'pt') ensurePt();
  };

  buildModal(_srdLang);
}

// ---------- Assistente IA ----------
let aiRendered = false;
function renderAiTab() {
  if (aiRendered) return; // não re-renderiza para não perder o chat
  aiRendered = true;
  $('#tab-ai').innerHTML = `
    <div class="tab-header"><h2><svg class="icon"><use href="#i-sparkle"/></svg>Assistente do Mestre</h2></div>
    <div class="ai-shortcuts">
      <button class="btn small ghost" data-prompt="Me dê um resumo rápido de onde a campanha parou e quais ganchos estão em aberto."><svg class="icon"><use href="#i-map-pin"/></svg>Onde paramos?</button>
      <button class="btn small ghost" data-prompt="Os jogadores foram para um lugar que eu não preparei. Improvise um local interessante coerente com a campanha, com 1 NPC e 1 gancho."><svg class="icon"><use href="#i-dice-six"/></svg>Improvisar local</button>
      <button class="btn small ghost" data-prompt="Crie um NPC rápido coerente com a campanha: nome, aparência, voz, motivação e um segredo."><svg class="icon"><use href="#i-users"/></svg>NPC rápido</button>
      <button class="btn small ghost" data-prompt="Monte um encontro de combate balanceado para o grupo atual, com tática dos inimigos."><svg class="icon"><use href="#i-sword"/></svg>Encontro</button>
      <button class="btn small ghost" data-prompt="Sugira 3 consequências interessantes para as últimas ações dos jogadores."><svg class="icon"><use href="#i-waves"/></svg>Consequências</button>
    </div>
    <div class="chat-box">
      <div class="chat-messages" id="chat-messages">
        <div class="msg assistant">Salve, Mestre! Conheço toda a sua campanha — história, NPCs, segredos e sessões. Pergunte qualquer coisa: "o que o taverneiro sabe sobre o culto?", "improvise uma loja", "que regra cobre agarrão?"...</div>
      </div>
      <div class="chat-input">
        <textarea id="chat-text" placeholder="Pergunte ao assistente... (Enter envia, Shift+Enter quebra linha)"></textarea>
        <button class="btn" id="btn-send-chat">Enviar</button>
      </div>
    </div>`;

  const send = async (text) => {
    if (!text.trim()) return;
    const box = $('#chat-messages');
    chatHistory.push({ role: 'user', content: text });
    box.insertAdjacentHTML('beforeend', `<div class="msg user">${esc(text)}</div>`);
    box.insertAdjacentHTML('beforeend', `<div class="msg assistant thinking" id="thinking"><svg class="icon"><use href="#i-sparkle"/></svg> Consultando os tomos...</div>`);
    box.scrollTop = box.scrollHeight;
    $('#chat-text').value = '';
    try {
      const r = await api('/ai/chat', { method: 'POST', body: { history: chatHistory } });
      chatHistory.push({ role: 'assistant', content: r.reply });
      $('#thinking').remove();
      box.insertAdjacentHTML('beforeend', `<div class="msg assistant">${esc(r.reply)}</div>`);
    } catch (e) {
      $('#thinking').remove();
      chatHistory.pop();
      box.insertAdjacentHTML('beforeend', `<div class="msg assistant"><svg class="icon"><use href="#i-x-circle"/></svg> ${esc(e.message)}</div>`);
    }
    box.scrollTop = box.scrollHeight;
  };

  $('#btn-send-chat').onclick = () => send($('#chat-text').value);
  $('#chat-text').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send($('#chat-text').value); }
  });
  $$('#tab-ai [data-prompt]').forEach((b) => b.onclick = () => send(b.dataset.prompt));
}

// ---------- Configurações ----------
function renderSettings() {
  const s = state.settings;
  const obs = s.obsidian || {};
  $('#tab-settings').innerHTML = `
    <div class="tab-header"><h2><svg class="icon"><use href="#i-gear"/></svg>Configurações</h2></div>
    <form class="settings-form" id="settings-form">
      <div><label>Nome da campanha</label><input name="campaignName" value="${esc(s.campaignName)}" /></div>
      <div><label>Sistema</label><input name="system" value="${esc(s.system)}" /></div>
      <div><label>Canal de texto para cenas e recaps</label><select name="textChannelId" id="text-channel-select"><option value="">— carregando —</option></select></div>
      <button class="btn" type="submit">Salvar</button>
    </form>
    <br/>
    <div class="help-text">
      <b>Status do bot:</b> ${state.bot.connected ? `conectado como ${esc(state.bot.tag)}` : 'desconectado — confira o DISCORD_TOKEN no arquivo .env e reinicie.'}<br/>
      Use <code>/entrar</code> no Discord (estando em um canal de voz) ou o botão "Conectar voz" na barra acima.
    </div>

    <div class="settings-section">
      <h3 style="display:flex;align-items:center;gap:8px;"><svg class="icon"><use href="#i-note"/></svg>Obsidian</h3>
      <p class="help-text">Aponte para a pasta da campanha no seu vault e importe/exporte personagens, cenas, sessões e lore como arquivos Markdown.</p>
      <form class="settings-form" id="obs-form">
        <div>
          <label>Caminho da pasta da campanha</label>
          <input name="vaultPath" placeholder="Ex: C:\\Users\\Você\\Documents\\Obsidian Vault\\Campanha" value="${esc(obs.vaultPath || '')}" />
        </div>
        <div class="settings-folders">
          <div><label>Pasta → Jogadores (PCs)</label><input name="folderPlayers" value="${esc(obs.folderPlayers || 'Players')}" /></div>
          <div><label>Pasta → Inimigos</label><input name="folderEnemies" value="${esc(obs.folderEnemies || 'Inimigos')}" /></div>
          <div><label>Pasta → NPCs / Facções</label><input name="folderNpcs" value="${esc(obs.folderNpcs || 'Facções e NPCs')}" /></div>
          <div><label>Pasta → Locais / Cenas</label><input name="folderScenes" value="${esc(obs.folderScenes || 'Locais e Ganchos')}" /></div>
          <div><label>Pasta → Sessões</label><input name="folderSessions" value="${esc(obs.folderSessions || 'Sessões')}" /></div>
          <div><label>Pasta ou arquivo → Lore geral</label><input name="folderLore" value="${esc(obs.folderLore || 'Guia geral')}" /></div>
        </div>
        <button class="btn" type="submit">Salvar configuração do Obsidian</button>
      </form>
      <div class="obs-actions">
        <button class="btn btn-outline" id="btn-obs-import"><svg class="icon"><use href="#i-arrows-clockwise"/></svg>Importar do Obsidian</button>
        <button class="btn btn-outline" id="btn-obs-export"><svg class="icon"><use href="#i-paper-plane-tilt"/></svg>Exportar para Obsidian</button>
      </div>
      <div id="obs-result" class="obs-result" style="display:none"></div>
    </div>`;

  loadChannels();

  $('#settings-form').onsubmit = async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target).entries());
    await tryApi(() => api('/settings', { method: 'PUT', body: data }), 'Configurações salvas!');
    refresh();
  };

  $('#obs-form').onsubmit = async (e) => {
    e.preventDefault();
    const fields = Object.fromEntries(new FormData(e.target).entries());
    await tryApi(() => api('/settings', { method: 'PUT', body: { obsidian: fields } }), 'Configuração do Obsidian salva!');
    refresh();
  };

  $('#btn-obs-import').onclick = async () => {
    const r = await tryApi(() => api('/obsidian/import', { method: 'POST' }));
    if (!r) return;
    const res = $('#obs-result');
    res.style.display = 'block';
    res.innerHTML = `<b>Importação concluída:</b> ${r.created} criados, ${r.updated} atualizados.<br/>`
      + (r.details.length ? `<div class="obs-detail">${r.details.join('<br/>')}</div>` : '');
    refresh();
  };

  $('#btn-obs-export').onclick = async () => {
    const r = await tryApi(() => api('/obsidian/export', { method: 'POST' }));
    if (!r) return;
    const res = $('#obs-result');
    res.style.display = 'block';
    res.innerHTML = `<b>Exportação concluída:</b> ${r.written} arquivo(s) escritos no vault.<br/>`
      + (r.details.length ? `<div class="obs-detail">${r.details.join('<br/>')}</div>` : '');
  };
}

async function loadChannels() {
  try {
    const { text, voice } = await api('/discord/channels');
    const tSel = $('#text-channel-select');
    if (tSel) {
      tSel.innerHTML = `<option value="">— nenhum —</option>` +
        text.map((ch) => `<option value="${ch.id}" ${ch.id === state.settings.textChannelId ? 'selected' : ''}># ${esc(ch.name)}</option>`).join('');
    }
    const vSel = $('#voice-channel-select');
    vSel.innerHTML = `<option value="">canal de voz...</option>` +
      voice.map((ch) => `<option value="${ch.id}" ${ch.id === state.settings.voiceChannelId ? 'selected' : ''}>${esc(ch.name)}</option>`).join('');
  } catch { /* bot offline */ }
}

// ---------- Barra de som ----------
$('#btn-join').onclick = async () => {
  const channelId = $('#voice-channel-select').value;
  if (!channelId) return toast('Escolha um canal de voz primeiro.', true);
  const r = await tryApi(() => api('/discord/join', { method: 'POST', body: { channelId } }));
  if (r) { toast(`Conectado em ${r.channel}!`); refresh(); }
};
$('#btn-leave').onclick = () => tryApi(() => api('/discord/leave', { method: 'POST' }), 'Saí do canal de voz.').then(refresh);
$('#btn-stop-sound').onclick = () => tryApi(() => api('/sound/stop', { method: 'POST' }), 'Som parado.').then(refresh);
$('#volume').onchange = (e) => tryApi(() => api('/sound/volume', { method: 'POST', body: { volume: Number(e.target.value) } }));
$('#btn-roll').onclick = async () => {
  const expr = $('#dice-expr').value || '1d20';
  const r = await tryApi(() => api('/roll', { method: 'POST', body: { expr } }));
  if (r) $('#dice-result').textContent = `= ${r.total}`;
};
$('#dice-expr').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#btn-roll').click(); });

// ---------- Início ----------
api('/tts/voices').then((v) => { ttsVoices = v; }).catch(() => {});
refresh()
  .then(connectMesa)
  .catch((e) => toast(`Erro ao carregar: ${e.message}`, true));
setInterval(async () => {
  // mantém status do bot/som atualizado sem recarregar as abas de edição
  try {
    const fresh = await api('/state');
    state.bot = fresh.bot;
    renderBotStatus();
  } catch { /* servidor reiniciando */ }
}, 5000);
