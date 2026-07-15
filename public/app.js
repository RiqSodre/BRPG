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
function openModal(title, fieldsHtml, onSave, saveLabel = 'Salvar') {
  $('#modal').innerHTML = `
    <h3>${esc(title)}</h3>
    <form id="modal-form">${fieldsHtml}
      <div class="modal-actions">
        <button type="button" class="btn ghost" id="modal-cancel">Cancelar</button>
        <button type="submit" class="btn">${esc(saveLabel)}</button>
      </div>
    </form>`;
  $('#modal-backdrop').classList.remove('hidden');
  $('#modal-cancel').onclick = closeModal;
  $('#modal-form').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const data = Object.fromEntries(fd.entries());
    await onSave(data);
    closeModal();
    refresh();
  };
}
function closeModal() { $('#modal-backdrop').classList.add('hidden'); }

const field = (label, name, value = '', type = 'text', placeholder = '') =>
  `<div class="field"><label>${esc(label)}</label><input name="${name}" type="${type}" value="${esc(value)}" placeholder="${esc(placeholder)}" /></div>`;
const fieldArea = (label, name, value = '', placeholder = '') =>
  `<div class="field"><label>${esc(label)}</label><textarea name="${name}" placeholder="${esc(placeholder)}">${esc(value)}</textarea></div>`;
const fieldSelect = (label, name, options, selected) =>
  `<div class="field"><label>${esc(label)}</label><select name="${name}">${options.map((o) =>
    `<option value="${esc(o.value)}" ${o.value === selected ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select></div>`;

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
  renderAudio();
  renderBoothTab();
  renderMapTab();
  renderSessions();
  renderCombat();
  renderAiTab();
  renderSettings();
  $('#volume').value = state.settings.volume ?? 0.4;
}

function renderBotStatus() {
  const b = state.bot;
  $('#bot-status').innerHTML = b.connected
    ? `<span class="dot on"></span> ${esc(b.tag)}${b.inVoice ? ' · 🎙️ em voz' : ''}`
    : '<span class="dot off"></span> Bot desconectado';
  $('#now-playing').textContent = b.nowPlaying ? `🎵 Tocando: ${b.nowPlaying.name}` : '🔇 Nenhum som tocando';
}

// ---------- Cenas ----------
function renderScenes() {
  const scenes = state.scenes;
  $('#tab-scenes').innerHTML = `
    <div class="tab-header">
      <h2>🎭 Cenas</h2>
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
        <h3>${s.id === state.activeSceneId ? '⭐ ' : ''}${esc(s.title)}</h3>
        <div class="desc">${esc(s.readAloud || '')}</div>
        <div>
          ${amb ? `<span class="badge gold">🌫️ ${esc(amb.name)}</span>` : ''}
          ${mus ? `<span class="badge gold">🎶 ${esc(mus.name)}</span>` : ''}
        </div>
        ${sfx.length ? `<div class="row">${sfx.map((a) =>
          `<button class="btn small ghost" data-sfx="${a.id}" title="Tocar efeito no Discord">💥 ${esc(a.name)}</button>`).join('')}</div>` : ''}
        <div class="row">
          <button class="btn small gold" data-activate="${s.id}">▶ Ativar cena</button>
          <button class="btn small ghost" data-edit-scene="${s.id}">Editar</button>
          <button class="btn small ghost" data-suggest="${s.id}" title="A IA escolhe os sons da biblioteca para esta cena">✨ Sons IA</button>
          <button class="btn small danger" data-del-scene="${s.id}">🗑</button>
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
      let msg = '🎭 Cena ativada!';
      if (r.audio) msg += ` Tocando "${r.audio}".`;
      if (r.warnings?.length) msg += ` ⚠️ ${r.warnings.join(' ')}`;
      toast(msg, r.warnings?.length > 0 && !r.posted);
      refresh();
    }
  });
  $$('#tab-scenes [data-sfx]').forEach((b) => b.onclick = () =>
    tryApi(() => api(`/sound/play/${b.dataset.sfx}`, { method: 'POST' }), '💥 Efeito tocado!'));
  $$('#tab-scenes [data-suggest]').forEach((b) => b.onclick = async () => {
    b.disabled = true; b.textContent = '✨ Pensando...';
    const r = await tryApi(() => api(`/ai/suggest-audio/${b.dataset.suggest}`, { method: 'POST', body: { apply: true } }));
    if (r) { toast(`✨ Sons aplicados à cena. ${r.reasoning || ''}`); refresh(); }
    else { b.disabled = false; b.textContent = '✨ Sons IA'; }
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
      <h2>📜 História & Lore</h2>
      <div class="actions"><button class="btn" id="btn-new-story">+ Nova anotação</button></div>
    </div>
    <div class="grid">${state.story.map((s) => `
      <div class="card">
        <h3>${esc(s.title)}</h3>
        <span class="badge purple">${esc(s.category || 'geral')}</span>
        <div class="desc">${esc(s.content || '')}</div>
        <div class="row">
          <button class="btn small ghost" data-edit-story="${s.id}">Editar</button>
          <button class="btn small danger" data-del-story="${s.id}">🗑</button>
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
    inimigo:   { label: '👹 Inimigo',   color: 'var(--danger)' },
    quest:     { label: '📜 Quest',     color: 'var(--accent2)' },
    aleatorio: { label: '🎲 Aleatório', color: 'var(--muted)' },
    npc:       { label: '🎭 NPC',       color: '#b79cff' },
  };

  const npcCard = (c) => {
    const tipo = NPC_TYPES[c.npcType] || NPC_TYPES.npc;
    return `
      <div class="card">
        ${c.imageUrl ? `<img class="thumb" src="${esc(c.imageUrl)}" alt="" onerror="this.remove()" />` : ''}
        <h3>${esc(c.name)}</h3>
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
          <span class="badge" style="color:${tipo.color};border-color:${tipo.color}20;">${tipo.label}</span>
          <span class="badge purple">${esc([c.race, c.klass, c.level ? `nv.${c.level}` : ''].filter(Boolean).join(' · '))}</span>
        </div>
        ${c.ac || c.maxHp ? `<div class="meta">🛡️ CA ${esc(c.ac ?? '?')} · ❤️ ${esc(c.hp ?? '?')}/${esc(c.maxHp ?? '?')} PV</div>` : ''}
        <div class="desc">${esc(c.description || '')}</div>
        <div class="row">
          <button class="btn small gold" data-improv="${c.id}">🎭 Improvisar</button>
          <button class="btn small" data-speak="${c.id}">🗣️ Falar</button>
          <button class="btn small ghost" data-embody="${c.id}">🎙️ Encarnar</button>
          <button class="btn small ghost" data-edit-char="${c.id}">✏️</button>
          <button class="btn small danger" data-del-char="${c.id}">🗑</button>
        </div>
      </div>`;
  };

  const pcCard = (c) => `
    <div class="card">
      ${c.imageUrl ? `<img class="thumb" src="${esc(c.imageUrl)}" alt="" onerror="this.remove()" />` : ''}
      <h3>${esc(c.name)}</h3>
      <div class="meta">${esc([c.race, c.klass, c.level ? `nível ${c.level}` : '', c.player ? `🎮 ${c.player}` : ''].filter(Boolean).join(' · '))}</div>
      ${c.discordUserId
        ? `<span class="badge gold">🔗 Discord: ${esc(c.discordTag || 'vinculado')}</span>`
        : '<span class="badge" title="O jogador usa /vincular no Discord">⛓️ sem vínculo</span>'}
      ${c.ac || c.maxHp ? `<div class="meta">🛡️ CA ${esc(c.ac ?? '?')} · ❤️ ${esc(c.hp ?? '?')}/${esc(c.maxHp ?? '?')} PV</div>` : ''}
      <div class="desc">${esc(c.description || '')}</div>
      <div class="row">
        <button class="btn small ghost" data-edit-char="${c.id}">✏️ Editar</button>
        <button class="btn small danger" data-del-char="${c.id}">🗑</button>
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
      <h2>🧙 Personagens</h2>
      <div class="actions">
        <button class="btn ghost" id="btn-handout">📨 Handout</button>
        <button class="btn" id="btn-new-pc">+ Jogador</button>
        <button class="btn gold" id="btn-new-npc">+ NPC</button>
      </div>
    </div>
    <h2 style="margin:14px 0 10px;color:var(--accent2);font-size:17px;">🎮 Personagens dos Jogadores</h2>
    <div class="grid">${pcs.map(pcCard).join('') || '<div class="empty">Nenhum jogador ainda.</div>'}</div>
    <div style="display:flex;align-items:center;gap:10px;margin:20px 0 10px;">
      <h2 style="color:var(--accent2);font-size:17px;margin:0;">🎭 NPCs</h2>
      <div style="display:flex;gap:4px;flex-wrap:wrap;">
        ${Object.entries(NPC_TYPES).map(([k, v]) =>
          `<button class="btn small ghost npc-type-filter" data-ntype="${k}" style="font-size:12px;">${v.label}</button>`).join('')}
      </div>
    </div>
    ${npcGroups.map((g) => `
      <div class="npc-group" data-group="${g.key}">
        <div style="font-size:12px;font-weight:700;letter-spacing:0.06em;color:${NPC_TYPES[g.key].color};margin:10px 0 6px;opacity:0.8;">
          ${NPC_TYPES[g.key].label.toUpperCase()} (${g.npcs.length})
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
  $$('#tab-characters [data-del-char]').forEach((b) => b.onclick = async () => {
    if (confirm('Excluir este personagem?')) { await api(`/characters/${b.dataset.delChar}`, { method: 'DELETE' }); refresh(); }
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
    ${field('Atributos (texto livre)', 'stats', c.stats, 'text', 'FOR 16, DES 12, CON 14, INT 10, SAB 13, CAR 8')}
    ${isPc ? '' : fieldSelect('Tipo de NPC', 'npcType', [
      { value: 'inimigo',   label: '👹 Inimigo — combate e antagonistas' },
      { value: 'quest',     label: '📜 Quest — dão missões ou são objetivos' },
      { value: 'aleatorio', label: '🎲 Aleatório — encontros ou figurantes' },
      { value: 'npc',       label: '🎭 NPC — personagens de apoio' },
    ], c.npcType || 'npc')}
    ${isPc ? '' : field('Voz e maneirismos', 'voice', c.voice, 'text', 'Fala arrastado, coça a barba, nunca olha nos olhos...')}
    ${isPc ? '' : `<div class="field-row">
      ${fieldSelect('Voz sintetizada (TTS)', 'ttsVoice', ttsVoices.map((v) => ({ value: v.id, label: v.label })), c.ttsVoice || 'pt-BR-AntonioNeural')}
      ${field('Ritmo % (-50 a 50)', 'ttsRate', c.ttsRate ?? 0, 'number')}
      ${field('Tom Hz (-50 a 50)', 'ttsPitch', c.ttsPitch ?? 0, 'number')}
    </div>`}
    ${fieldArea('Descrição', 'description', c.description)}
    ${isPc ? '' : fieldArea('Segredos (só o Mestre vê; a IA usa para coerência)', 'secrets', c.secrets)}
    ${fieldImage('Retrato (aparece no token e na tela dos jogadores)', 'imageUrl', c.imageUrl)}
  `, async (data) => {
    data.imageUrl = await resolveImage('imageUrl', data);
    if (c.id) await api(`/characters/${c.id}`, { method: 'PUT', body: data });
    else await api('/characters', { method: 'POST', body: data });
  });
}

function handoutModal() {
  const pcs = state.characters.filter((c) => c.type === 'pc');
  openModal('📨 Enviar handout', `
    ${fieldSelect('Para quem?', 'target', [
      { value: 'all', label: '📢 Todos (no canal de texto)' },
      ...pcs.map((c) => ({
        value: c.id,
        label: `🤫 ${c.name}${c.discordUserId ? ` — DM para ${c.discordTag || 'jogador'}` : ' — SEM VÍNCULO (use /vincular)'}`,
      })),
    ], 'all')}
    ${field('Título', 'title', '', 'text', 'Uma carta amassada')}
    ${fieldArea('Conteúdo', 'content', '', '"Encontre-me na cripta à meia-noite. Venha só. — V."')}
    ${field('URL da imagem (opcional)', 'imageUrl', '', 'text', 'mapa, carta, brasão...')}
  `, async (data) => {
    const r = await tryApi(() => api('/handout', { method: 'POST', body: data }));
    if (r) {
      let msg = r.sent?.length ? `📨 Enviado para: ${r.sent.join(', ')}.` : '';
      if (r.failed?.length) msg += ` ⚠️ Falhou: ${r.failed.join('; ')}`;
      toast(msg || 'Nada foi enviado.', Boolean(r.failed?.length));
    }
  }, '📨 Enviar');
}

function speakModal(npc) {
  openModal(`🗣️ ${esc(npc.name)} fala...`, `
    ${fieldArea('O que o NPC diz?', 'text', '', '"Saiam da minha taverna, forasteiros!"')}
    <div class="row">
      <button type="button" class="btn ghost" id="btn-tts-preview">🎧 Ouvir aqui</button>
    </div>
    <audio id="tts-audio" controls style="width:100%; margin-top:8px; display:none;"></audio>
  `, async () => {}, '📡 Falar no Discord');

  const speak = async (discord) => {
    const text = $('#modal-form [name="text"]').value;
    if (!text.trim()) return toast('Escreva a fala primeiro.', true);
    const r = await tryApi(() => api('/tts/speak', { method: 'POST', body: { text, npcId: npc.id, discord } }));
    if (!r) return;
    if (discord) toast(r.warning ? `⚠️ ${r.warning}` : `🗣️ ${npc.name} falou no canal de voz!`, Boolean(r.warning));
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
  openModal(`🎭 Improvisar: ${esc(npc.name)}`, `
    ${fieldArea('O que está acontecendo?', 'situation', '', 'Os jogadores ameaçam o taverneiro exigindo saber sobre o culto...')}
    <div id="improv-result" class="msg assistant" style="display:none; max-width:100%;"></div>
  `, async () => {}, 'Fechar');
  // Substitui o submit padrão: o botão consulta a IA sem fechar
  $('#modal-form').onsubmit = async (e) => {
    e.preventDefault();
    const situation = new FormData(e.target).get('situation');
    const out = $('#improv-result');
    out.style.display = 'block';
    out.textContent = '✨ Incorporando o personagem...';
    const r = await tryApi(() => api(`/ai/npc/${npc.id}`, { method: 'POST', body: { situation } }));
    out.textContent = r ? r.reply : 'Erro ao consultar a IA.';
  };
  $('#modal-form .modal-actions .btn:not(.ghost)').textContent = '✨ Improvisar';
}

// ---------- Áudio ----------
const TYPE_LABEL = { ambient: '🌫️ Ambiente', music: '🎶 Música', sfx: '💥 Efeito' };

function renderAudio() {
  $('#tab-audio').innerHTML = `
    <div class="tab-header">
      <h2>🎵 Biblioteca de Áudio</h2>
    </div>
    <div class="card" style="margin-bottom:16px;">
      <h3>Enviar novo áudio</h3>
      <form id="audio-upload-form" class="row" style="align-items:center;">
        <input type="file" name="file" accept=".mp3,.ogg,.wav,.m4a,.webm,.flac" required />
        <input name="name" placeholder="Nome (opcional)" />
        <select name="type">
          <option value="ambient">🌫️ Ambiente (loop)</option>
          <option value="music">🎶 Música (loop)</option>
          <option value="sfx">💥 Efeito (uma vez)</option>
        </select>
        <input name="tags" placeholder="tags: taverna, chuva, combate..." />
        <button class="btn" type="submit">⬆ Enviar</button>
      </form>
      <p class="help-text">Dica: use tags descritivas — é por elas que a IA escolhe os sons certos para cada cena.</p>
    </div>
    <div class="card" style="margin-bottom:16px;">
      <h3>🔎 Buscar no Freesound</h3>
      <div class="row" style="align-items:center;">
        <input id="fs-query" placeholder="rain, tavern, sword fight, thunder... (em inglês acha mais)" style="flex:1;" />
        <select id="fs-type">
          <option value="ambient">🌫️ Ambiente</option>
          <option value="music">🎶 Música</option>
          <option value="sfx" selected>💥 Efeito</option>
        </select>
        <button class="btn" id="btn-fs-search">🔍 Buscar</button>
      </div>
      <div id="fs-results"></div>
      <p class="help-text">Requer FREESOUND_API_KEY no .env (grátis em freesound.org). O som é baixado direto para a sua biblioteca, já com as tags.</p>
    </div>
    ${state.audio.map((a) => `
      <div class="audio-row">
        <span>${TYPE_LABEL[a.type] || a.type}</span>
        <span class="name"><b>${esc(a.name)}</b><br/><small style="color:var(--muted)">${(a.tags || []).map((t) => `#${esc(t)}`).join(' ')}</small></span>
        <audio controls preload="none" src="/audio-files/${esc(a.filename)}"></audio>
        <button class="btn small gold" data-play-discord="${a.id}" title="Tocar no canal de voz do Discord">📡 Discord</button>
        <button class="btn small ghost" data-edit-audio="${a.id}">✏️</button>
        <button class="btn small danger" data-del-audio="${a.id}">🗑</button>
      </div>`).join('') || '<div class="empty">Envie áudios de ambiente (chuva, taverna, floresta), músicas e efeitos (porta, espadas, trovão).</div>'}`;

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
        <button class="btn small gold" data-fs-import="${i}">⬇ Importar</button>
      </div>`).join('') : '<div class="help-text">Nada encontrado.</div>';

    $$('#fs-results [data-fs-import]').forEach((b) => b.onclick = async () => {
      const s = results[Number(b.dataset.fsImport)];
      b.disabled = true; b.textContent = '⬇ Baixando...';
      const r = await tryApi(() => api('/freesound/import', {
        method: 'POST',
        body: { name: s.name, previewUrl: s.previewUrl, type: $('#fs-type').value, tags: s.tags },
      }), `🎵 "${s.name}" importado para a biblioteca!`);
      if (r) refresh();
      else { b.disabled = false; b.textContent = '⬇ Importar'; }
    });
  };
  $('#btn-fs-search').onclick = fsSearch;
  $('#fs-query').addEventListener('keydown', (e) => { if (e.key === 'Enter') fsSearch(); });

  $('#audio-upload-form').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    await tryApi(() => api('/audio', { method: 'POST', body: fd }), '🎵 Áudio enviado!');
    refresh();
  };
  $$('#tab-audio [data-play-discord]').forEach((b) => b.onclick = () =>
    tryApi(() => api(`/sound/play/${b.dataset.playDiscord}`, { method: 'POST' }), '📡 Tocando no Discord!').then(refresh));
  $$('#tab-audio [data-del-audio]').forEach((b) => b.onclick = async () => {
    if (confirm('Excluir este áudio?')) { await api(`/audio/${b.dataset.delAudio}`, { method: 'DELETE' }); refresh(); }
  });
  $$('#tab-audio [data-edit-audio]').forEach((b) => b.onclick = () => {
    const a = state.audio.find((x) => x.id === b.dataset.editAudio);
    openModal('Editar áudio', `
      ${field('Nome', 'name', a.name)}
      ${fieldSelect('Tipo', 'type', [
        { value: 'ambient', label: '🌫️ Ambiente (loop)' },
        { value: 'music', label: '🎶 Música (loop)' },
        { value: 'sfx', label: '💥 Efeito (uma vez)' },
      ], a.type)}
      ${field('Tags (separadas por vírgula)', 'tags', (a.tags || []).join(', '))}
    `, async (data) => {
      data.tags = data.tags.split(',').map((t) => t.trim()).filter(Boolean);
      await api(`/audio/${a.id}`, { method: 'PUT', body: data });
    });
  });
}

// ---------- Cabine do Mestre ----------
let boothRendered = false;

function renderBoothTab() {
  if (!boothRendered) {
    boothRendered = true;
    $('#tab-booth').innerHTML = `
      <div class="tab-header"><h2>🎙️ Cabine do Mestre</h2></div>
      <p class="help-text">Fale pelos NPCs com a sua voz transformada: o som sai pelo bot, por cima da música ambiente.
      <b>Use fones de ouvido</b> e, enquanto estiver no ar, <b>mute-se no Discord</b> para os jogadores não ouvirem sua voz dupla.</p><br/>
      <div class="card" style="max-width:640px;">
        <div class="row" style="align-items:center;">
          <button class="btn" id="booth-mic">🎤 Ativar microfone</button>
          <span id="booth-status" class="help-text">microfone desligado</span>
        </div>
        <div class="row" style="align-items:center; margin-top:8px;">
          <select id="booth-npc" style="flex:1;"></select>
          <button class="btn small ghost" id="booth-load">⤵ Carregar preset</button>
          <button class="btn small ghost" id="booth-save">💾 Salvar no NPC</button>
        </div>
        <div class="booth-sliders">
          <label>Tom (pitch) <span id="booth-pitch-val">0 st</span>
            <input type="range" id="booth-pitch" min="-12" max="12" step="0.5" value="0" /></label>
          <label>Reverb <span id="booth-reverb-val">0%</span>
            <input type="range" id="booth-reverb" min="0" max="1" step="0.05" value="0" /></label>
          <label>Distorção <span id="booth-dist-val">0%</span>
            <input type="range" id="booth-dist" min="0" max="1" step="0.05" value="0" /></label>
          <label>Ganho da voz <span id="booth-gain-val">2.0×</span>
            <input type="range" id="booth-gain" min="0.5" max="3.5" step="0.1" value="2" /></label>
        </div>
        <label style="font-size:13px;"><input type="checkbox" id="booth-monitor" /> 🎧 Ouvir minha voz transformada (só com fones!)</label>
        <button class="btn danger" id="booth-onair" style="margin-top:10px; font-size:16px;">🔴 ENTRAR NO AR</button>
        <p class="help-text" style="margin-top:6px;">Dicas: ogro/gigante = tom -6 a -9 · gnomo/fada = +5 a +8 · fantasma = reverb alto + tom -2 · demônio = tom -7 + distorção 40%.</p>
      </div>`;

    booth.onStatus = (msg, isError) => {
      $('#booth-status').textContent = msg;
      if (isError) toast(msg, true);
      const onAirBtn = $('#booth-onair');
      onAirBtn.textContent = booth.onAir ? '⏹ SAIR DO AR' : '🔴 ENTRAR NO AR';
      onAirBtn.classList.toggle('gold', booth.onAir);
    };

    $('#booth-mic').onclick = async () => {
      if (await boothInitMic()) $('#booth-status').textContent = '🎤 Microfone pronto. Ajuste os efeitos e entre no ar.';
    };
    const bindSlider = (id, valId, key, fmt) => {
      $(id).oninput = () => {
        booth.fx[key] = Number($(id).value);
        $(valId).textContent = fmt(booth.fx[key]);
        boothApplyFx();
      };
    };
    bindSlider('#booth-pitch', '#booth-pitch-val', 'pitch', (v) => `${v > 0 ? '+' : ''}${v} st`);
    bindSlider('#booth-reverb', '#booth-reverb-val', 'reverb', (v) => `${Math.round(v * 100)}%`);
    bindSlider('#booth-dist', '#booth-dist-val', 'distortion', (v) => `${Math.round(v * 100)}%`);
    bindSlider('#booth-gain', '#booth-gain-val', 'gain', (v) => `${v.toFixed(1)}×`);
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
      await tryApi(() => api(`/characters/${id}`, {
        method: 'PUT',
        body: { fxPitch: booth.fx.pitch, fxReverb: booth.fx.reverb, fxDist: booth.fx.distortion, fxGain: booth.fx.gain },
      }), '💾 Preset de voz salvo no NPC!');
      refresh();
    };
  }
  // Atualiza a lista de NPCs preservando a seleção
  const sel = $('#booth-npc');
  const current = sel.value;
  sel.innerHTML = '<option value="">— preset de NPC —</option>' +
    state.characters.filter((c) => c.type === 'npc').map((c) =>
      `<option value="${c.id}" ${c.id === current ? 'selected' : ''}>${esc(c.name)}${c.fxPitch != null ? ' 🎙️' : ''}</option>`).join('');
}

function boothLoadPreset(npc) {
  booth.fx.pitch = npc.fxPitch ?? 0;
  booth.fx.reverb = npc.fxReverb ?? 0;
  booth.fx.distortion = npc.fxDist ?? 0;
  booth.fx.gain = npc.fxGain ?? 2;
  $('#booth-pitch').value = booth.fx.pitch;
  $('#booth-reverb').value = booth.fx.reverb;
  $('#booth-dist').value = booth.fx.distortion;
  $('#booth-gain').value = booth.fx.gain;
  $('#booth-pitch-val').textContent = `${booth.fx.pitch > 0 ? '+' : ''}${booth.fx.pitch} st`;
  $('#booth-reverb-val').textContent = `${Math.round(booth.fx.reverb * 100)}%`;
  $('#booth-dist-val').textContent = `${Math.round(booth.fx.distortion * 100)}%`;
  $('#booth-gain-val').textContent = `${booth.fx.gain.toFixed(1)}×`;
  boothApplyFx();
  toast(`🎙️ Preset de "${npc.name}" carregado.`);
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
      <div class="tab-header">
        <h2>🗺️ Mapa de Batalha</h2>
        <div class="actions">
          <select id="map-select" title="Mapa em jogo"></select>
          <button class="btn small gold" id="btn-map-activate">▶ Colocar em jogo</button>
          <button class="btn small" id="btn-sample-maps" title="Mapas prontos da sua pasta data/sample-maps">📚 Exemplos</button>
          <button class="btn small" id="btn-new-map">+ Novo mapa</button>
          <button class="btn small ghost" id="btn-edit-map">Editar grid</button>
          <button class="btn small danger" id="btn-del-map">🗑</button>
          <a class="btn small ghost" href="/mesa.html" target="_blank" title="Abra numa segunda tela ou compartilhe pelo Discord">🖥️ Tela dos jogadores</a>
        </div>
      </div>
      <div class="map-layout">
        <div class="map-stage">
          <div class="map-toolbar">
            <div class="tool-group">
              <button class="btn small tool active" data-tool="select" title="Arrastar tokens">✋ Mover</button>
              <button class="btn small tool" data-tool="ruler" title="Medir distância (regra da diagonal 5e)">📏 Medir</button>
              <button class="btn small tool" data-tool="ping" title="Piscar um ponto na tela dos jogadores">📍 Ping</button>
              <button class="btn small tool" data-tool="aoe" title="Área de efeito: arraste do centro para fora (bola de fogo, explosão...)">🎯 Área</button>
              <button class="btn small tool" data-tool="reveal" title="Pincel: revelar área">🔦 Revelar</button>
              <button class="btn small tool" data-tool="hide" title="Pincel: cobrir de névoa">🌫️ Cobrir</button>
            </div>
            <div class="tool-group">
              <label class="tool-check"><input type="checkbox" id="fog-enabled" /> Névoa de guerra</label>
              <button class="btn small ghost" id="btn-fog-all">Revelar tudo</button>
              <button class="btn small ghost" id="btn-fog-none">Cobrir tudo</button>
              <button class="btn small ghost" id="btn-map-fit">⤢ Enquadrar</button>
            </div>
            <div class="tool-group">
              <label class="tool-check" title="Desligado, os jogadores veem só a barra e o estado (Ferido, Quase morto...) dos inimigos">
                <input type="checkbox" id="show-enemy-hp" /> PV dos inimigos aos jogadores
              </label>
            </div>
            <div class="tool-group" id="img-align">
              <span class="help-text">Imagem:</span>
              <button class="btn small ghost" data-img="left">◀</button>
              <button class="btn small ghost" data-img="right">▶</button>
              <button class="btn small ghost" data-img="up">▲</button>
              <button class="btn small ghost" data-img="down">▼</button>
              <button class="btn small ghost" data-img="out">➖</button>
              <button class="btn small ghost" data-img="in">➕</button>
              <button class="btn small ghost" data-img="auto" title="Esticar a imagem para preencher o grid">⤢ Encaixar</button>
            </div>
          </div>
          <div id="combat-hud" class="combat-hud"></div>
          <canvas id="map-canvas"></canvas>
          <p class="help-text">Clique num token para agir sobre ele · arraste para mover (mostra o deslocamento) · <b>Espaço</b> passa o turno · <b>setas</b> movem o selecionado · <b>Del</b> remove · <b>Esc</b> limpa a seleção.</p>
        </div>
        <aside class="map-side">
          <div id="token-panel"></div>
          <div id="aoe-panel"></div>
          <div id="combat-order"></div>
          <div class="side-section">
            <div class="side-section-label">
              <span>TOKENS NO MAPA</span>
            </div>
            <div class="row" style="margin-bottom:8px;gap:4px;">
              <button class="btn small gold" id="btn-tokens-init" title="Traz todo mundo que está na aba Iniciativa">⚔️ Iniciativa</button>
              <button class="btn small" id="btn-tokens-pcs">🎮 Jogadores</button>
              <button class="btn small ghost" id="btn-token-new">+ Avulso</button>
            </div>
            <div id="token-list"></div>
          </div>
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
    bmap.onPing = (col, row) => {
      if (mesaWs?.readyState === WebSocket.OPEN) mesaWs.send(JSON.stringify({ type: 'ping', col, row }));
    };
    bmap.onTokenClick = (t) => tokenModal(t);
    bmap.onSelect = () => renderTokenPanel();
    bmap.onAoe = () => renderAoePanel();

    // Atalhos: o Mestre roda o combate sem tirar a mão do mapa
    document.addEventListener('keydown', (e) => {
      const naAba = $('#tab-map').classList.contains('active');
      const digitando = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '');
      if (!naAba || digitando || $('#modal-backdrop').classList.contains('hidden') === false) return;

      const sel = bmap.tokenById(bmap.selectedId);
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
        await tryApi(() => api(`/maps/${id}`, { method: 'DELETE' }), '🗑 Mapa excluído.');
        refresh();
      }
    };
    $('#btn-map-activate').onclick = async () => {
      const mapId = $('#map-select').value;
      if (!mapId) return toast('Crie um mapa primeiro.', true);
      state.battle = { ...state.battle, mapId };
      await tryApi(() => api('/battle', { method: 'PUT', body: { mapId } }), '🗺️ Mapa em jogo — os jogadores já estão vendo.');
      refresh();
      setTimeout(() => bmap.fit(), 50);
    };
    $('#btn-map-fit').onclick = () => bmap.fit();

    $('#fog-enabled').onchange = (e) => {
      const map = activeMap();
      if (!map) return;
      map.fog = { enabled: e.target.checked, revealed: map.fog?.revealed || [] };
      pushMap(map);
      toast(e.target.checked ? '🌫️ Névoa ligada — use o pincel 🔦 para revelar.' : '☀️ Névoa desligada.');
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

    $('#show-enemy-hp').onchange = (e) => {
      state.battle.showEnemyHp = e.target.checked;
      pushBattle();
      toast(e.target.checked
        ? '👁️ Os jogadores agora veem os PV exatos dos inimigos.'
        : '🎭 Os jogadores voltam a ver só o estado dos inimigos (Ferido, Quase morto...).');
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
          map.img = {
            x: 0,
            y: 0,
            scale: Math.max(
              (map.cols * MAP_CELL) / probe.naturalWidth,
              (map.rows * MAP_CELL) / probe.naturalHeight,
            ),
          };
          pushMap(map);
        };
        probe.src = src;
        return;
      }
      map.img = img;
      pushMap(map);
    });

    $('#btn-token-new').onclick = () => tokenModal();
    $('#btn-tokens-pcs').onclick = () => {
      const pcs = state.characters.filter((c) => c.type === 'pc');
      addTokens(pcs.map((c) => ({
        name: c.name, kind: 'pc', imageUrl: c.imageUrl || '',
        hp: Number(c.hp) || 0, maxHp: Number(c.maxHp) || 0, charId: c.id, combatName: c.name,
      })));
    };
    $('#btn-tokens-init').onclick = () => {
      addTokens(state.combat.entries.map((e) => ({
        name: e.name,
        kind: e.isPc ? 'pc' : 'enemy',
        hp: e.hp, maxHp: e.maxHp,
        combatName: e.name,
        imageUrl: state.characters.find((c) => c.name === e.name)?.imageUrl || '',
      })));
    };
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
  bmap.setData({ map, battle: state.battle, combat: state.combat });
  renderMapSide();
}

// ---------- Gerenciamento do combate pelo mapa ----------
function renderMapSide() {
  renderCombatHud();
  renderTokenPanel();
  renderAoePanel();
  renderCombatOrder();
  renderTokenList();
}

const tokenOf = (name) => state.battle.tokens.find((t) => (t.combatName || t.name) === name);
const entryOf = (t) => state.combat.entries.find((e) => e.name === (t.combatName || t.name));

async function saveCombatState() {
  await tryApi(() => api('/combat', { method: 'PUT', body: state.combat }));
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
  if (atual?.conditions?.length) toast(`⚠️ ${atual.name} está: ${atual.conditions.join(', ')}`);
  await saveCombatState();
  renderMapSide();
  focusTurn();
}

// Rola a iniciativa dos inimigos e ordena a mesa inteira
async function rollInitiative() {
  const c = state.combat;
  if (!c.entries.length) return toast('Adicione combatentes na aba ⚔️ Iniciativa primeiro.', true);
  for (const e of c.entries) {
    if (!e.isPc) e.init = d20() + (e.initMod || 0);
  }
  c.entries.sort((a, b) => b.init - a.init);
  c.turn = 0;
  c.round = 1;
  await saveCombatState();
  renderMapSide();
  await refresh();
  toast('🎲 Iniciativa rolada! Ordem: ' + c.entries.map((e) => e.name).join(' → '));
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

    if (delta < 0 && alvo.concentration) {
      avisos.push(`🧠 ${t.name}: salvaguarda de CON CD ${Math.max(10, Math.floor(-delta / 2))} para manter a concentração`);
    }
    if (novo <= 0 && atual > 0) {
      alvo.deathSaves = { s: 0, f: 0 };
      avisos.push(`💀 ${t.name} caiu`);
    }
    alvo.hp = novo;
    if (e) {
      t.hp = novo; // espelha no token para o canvas repintar imediatamente
      mexeuNoCombate = true;
    } else {
      mexeuNoToken = true;
    }
  }

  if (mexeuNoCombate) await saveCombatState();
  if (mexeuNoToken) pushBattle();
  if (bmap) bmap.draw();
  renderMapSide();

  const verbo = delta < 0 ? `💥 ${-delta} de dano` : `💚 ${delta} de cura`;
  const alvosTxt = tokens.map((t) => t.name).join(', ');
  toast([`${verbo} em ${alvosTxt}.`, ...avisos].join(' · '), avisos.length > 0);
}

async function toggleCondition(t, cond) {
  const alvo = entryOf(t) || t;
  const atuais = alvo.conditions || [];
  alvo.conditions = atuais.includes(cond) ? atuais.filter((x) => x !== cond) : [...atuais, cond];
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
  toast(`➕ ${newName} duplicado no mapa.`);
}

function renderCombatHud() {
  const el = $('#combat-hud');
  if (!el) return;
  const c = state.combat;
  const atual = c.entries[c.turn];
  const proximo = c.entries.length > 1 ? c.entries[(c.turn + 1) % c.entries.length] : null;
  const t = atual ? tokenOf(atual.name) : null;
  const retrato = t?.imageUrl || state.characters.find((x) => x.name === atual?.name)?.imageUrl;
  const retratoProx = proximo ? (tokenOf(proximo.name)?.imageUrl || state.characters.find((x) => x.name === proximo?.name)?.imageUrl) : null;

  const hpFrac = atual?.maxHp > 0 ? Math.max(0, Math.min(1, (atual.hp ?? 0) / atual.maxHp)) : null;
  const hpCor = hpFrac > 0.5 ? '#4ade80' : hpFrac > 0.25 ? '#c4a747' : '#e05252';
  const conds = (atual?.conditions || []);

  el.innerHTML = `
    <div class="hud-left">
      <div class="hud-turn">
        ${atual ? `
          ${retrato ? `<img class="hud-avatar" src="${esc(retrato)}" alt="" onerror="this.style.display='none'" />` : '<span class="hud-avatar placeholder"></span>'}
          <div class="hud-turn-info">
            <small>Rodada ${c.round} &nbsp;·&nbsp; vez de</small>
            <b>${esc(atual.name)}</b>
            ${hpFrac !== null ? `
              <div class="hud-hp-bar"><span style="width:${hpFrac*100}%;background:${hpCor}"></span></div>
              <span class="hud-hp-text">${esc(atual.hp)}/${esc(atual.maxHp)} PV</span>` : ''}
            ${conds.length ? `<div class="hud-conds">${conds.map((cd) => `<span class="cond-chip">${condIcon(cd)} ${esc(cd)}</span>`).join('')}</div>` : ''}
          </div>` : '<div class="hud-turn-info"><small>Sem combate</small><b>Traga a iniciativa para começar</b></div>'}
      </div>
      ${proximo ? `
        <div class="hud-next-up">
          ${retratoProx ? `<img class="hud-next-avatar" src="${esc(retratoProx)}" alt="" onerror="this.style.display='none'" />` : ''}
          <div>
            <small>A SEGUIR</small>
            <span>${esc(proximo.name)}${proximo.maxHp ? ` · ${esc(proximo.hp)}/${esc(proximo.maxHp)} PV` : ''}</span>
          </div>
        </div>` : ''}
    </div>
    <div class="hud-actions">
      <button class="btn small ghost" id="hud-prev" title="Voltar um turno">◀</button>
      <button class="btn gold" id="hud-next" title="Próximo turno (Espaço)">▶ Próximo</button>
      <button class="btn small" id="hud-roll" title="Rola a iniciativa dos inimigos e reordena">🎲 Rolar init</button>
      <button class="btn small ghost" id="hud-announce" title="Postar a ordem no Discord">📤</button>
      <button class="btn small danger" id="hud-end" title="Encerrar o combate">⏹</button>
    </div>`;

  $('#hud-next').onclick = () => nextTurn(1);
  $('#hud-prev').onclick = () => nextTurn(-1);
  $('#hud-roll').onclick = rollInitiative;
  $('#hud-announce').onclick = () => tryApi(() => api('/combat/announce', { method: 'POST' }), '📤 Iniciativa postada!');
  $('#hud-end').onclick = async () => {
    if (!confirm('Encerrar o combate? A iniciativa é limpa; os tokens continuam no mapa.')) return;
    state.combat = { active: false, round: 1, turn: 0, entries: [] };
    await saveCombatState();
    toast('⏹ Combate encerrado.');
  };
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
  const cor = frac > 0.5 ? '#4ade80' : frac > 0.25 ? '#c4a747' : '#e05252';
  const conds = fonte.conditions || [];
  const conc = fonte.concentration || false;

  el.innerHTML = `
    <div class="act-panel">
      <div class="act-head">
        ${t.imageUrl ? `<img class="token-avatar" src="${esc(t.imageUrl)}" alt="" onerror="this.remove()" />` : ''}
        <div class="act-name">
          <b>${esc(t.name)}</b>
          ${entry ? `<small style="color:var(--muted);font-size:11px;">⚔️ na iniciativa</small>` : ''}
          ${frac !== null ? `
            <div class="hp-bar"><span style="width:${frac * 100}%; background:${cor}"></span></div>
            <small class="hp-text">${hp}/${maxHp} PV</small>` : '<small class="hp-text">sem PV definidos</small>'}
        </div>
      </div>
      <div class="act-hp">
        <input type="number" id="act-amount" min="1" placeholder="0" />
        <button class="btn small danger" id="act-dmg" title="Enter aplica dano">💥 Dano</button>
        <button class="btn small" id="act-heal">💚 Cura</button>
      </div>
      <div class="act-conds">
        ${CONDITIONS.map((c) => {
          const on = conds.includes(c);
          return `<button class="cond-toggle ${on ? 'on' : ''}" data-cond="${esc(c)}" title="${esc(c)}">${condIcon(c)}</button>`;
        }).join('')}
      </div>
      <label class="tool-check"><input type="checkbox" id="act-conc" ${conc ? 'checked' : ''} /> 🧠 Concentrando</label>
      <div class="row">
        <button class="btn small ghost" id="act-dup" title="Cria uma cópia do token com PV cheios">📋 Duplicar</button>
        <button class="btn small ghost" id="act-hide">${t.hidden ? '🙈 Mostrar' : '👁️ Esconder'}</button>
        <button class="btn small ghost" id="act-edit">✏️ Editar</button>
        <button class="btn small danger" id="act-del">🗑</button>
      </div>
    </div>`;

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
      <div class="act-head"><b>🎯 Área — raio ${aoe.radius.toFixed(1)} m</b></div>
      ${alvos.length ? `<div class="aoe-targets">${alvos.map((t) =>
        `<span class="cond-chip">${t.kind === 'pc' ? '🎮' : '👹'} ${esc(t.name)}</span>`).join('')}</div>`
        : '<div class="help-text">Ninguém dentro da área.</div>'}
      <div class="act-hp">
        <input type="number" id="aoe-amount" min="1" placeholder="8d6 = 28" />
        <button class="btn small danger" id="aoe-dmg" title="Dano cheio em todos">💥 Todos</button>
        <button class="btn small" id="aoe-half" title="Metade do dano — para quem passou na salvaguarda">½ Salvou</button>
      </div>
      <button class="btn small ghost" id="aoe-clear">Limpar área</button>
    </div>`;

  // Captura os IDs no momento em que a área foi desenhada; resolve os tokens ao vivo no clique
  // para garantir que operam sobre o state atual (não referências obsoletas de antes de um broadcast).
  const alvosIds = new Set(alvos.map((t) => t.id));
  const liveAlvos = () => state.battle.tokens.filter((t) => alvosIds.has(t.id));
  const valor = () => Math.abs(Number($('#aoe-amount').value) || 0);
  $('#aoe-dmg').onclick = () => applyHp(liveAlvos(), -valor());
  $('#aoe-half').onclick = () => applyHp(liveAlvos(), -Math.floor(valor() / 2));
  $('#aoe-clear').onclick = () => bmap.setAoe(null);
}

// Coloca tokens novos no mapa, sem duplicar quem já está lá. Entram em fila na borda esquerda.
function addTokens(defs) {
  const map = activeMap();
  if (!map) return toast('Coloque um mapa em jogo primeiro.', true);
  const tokens = state.battle.tokens;
  let added = 0;
  for (const def of defs) {
    if (tokens.some((t) => t.name === def.name)) continue;
    const i = tokens.length;
    tokens.push({
      id: Math.random().toString(16).slice(2, 10),
      col: i % map.cols,
      row: Math.min(map.rows - 1, Math.floor(i / map.cols)),
      size: 1, hidden: false, color: '', ...def,
    });
    added++;
  }
  pushBattle();
  toast(added ? `➕ ${added} token(s) no mapa.` : 'Todos já estavam no mapa.');
  renderMapSide();
}

// Painel de ordem de iniciativa na sidebar do mapa — exibido quando o combate está ativo.
// Mostra todos os combatentes em ordem, HP, condições e salvaguardas de morte.
// Clicar na linha seleciona e centraliza o token correspondente no canvas.
function renderCombatOrder() {
  const el = $('#combat-order');
  if (!el) return;
  const c = state.combat;
  if (!c.entries?.length) { el.innerHTML = ''; return; }

  el.innerHTML = `
    <div class="side-section co-section">
      <div class="side-section-label co-label">
        <span>⚔️ INICIATIVA · Rodada ${c.round}</span>
      </div>
      ${c.entries.map((e, i) => {
        const isTurn = i === c.turn;
        const frac = e.maxHp > 0 ? Math.max(0, Math.min(1, (e.hp ?? 0) / e.maxHp)) : null;
        const hpColor = frac > 0.5 ? 'var(--ok)' : frac > 0.25 ? 'var(--accent2)' : 'var(--danger)';
        const downed = e.maxHp > 0 && (e.hp ?? 0) <= 0;
        const conds = (e.conditions || []).map((cd) => `<span class="co-cond" title="${esc(cd)}">${condIcon(cd)}</span>`).join('');
        const tok = tokenOf(e.name);
        const retrato = tok?.imageUrl || state.characters.find((x) => x.name === e.name)?.imageUrl || '';
        return `
          <div class="co-row ${isTurn ? 'is-turn' : ''} ${downed ? 'downed' : ''}" data-co-i="${i}">
            <span class="co-turn-arrow">${isTurn ? '▶' : ''}</span>
            <span class="co-init-num">${esc(e.init)}</span>
            ${retrato
              ? `<img class="co-avatar" src="${esc(retrato)}" alt="" onerror="this.style.display='none'" />`
              : `<span class="co-avatar placeholder"></span>`}
            <div class="co-info">
              <div class="co-name">${esc(e.name)}${e.concentration ? ' <span title="Concentrando">🧠</span>' : ''}</div>
              ${frac !== null ? `
                <div class="hp-bar"><span style="width:${Math.round(frac * 100)}%;background:${hpColor}"></span></div>
                <span class="hp-text">${esc(e.hp)}/${esc(e.maxHp)} PV${conds ? ' · ' + conds : ''}</span>
              ` : (conds ? `<span class="hp-text">${conds}</span>` : '')}
              ${downed ? `
                <div class="death-saves" style="margin-top:4px;">
                  ☠️ ✅${'●'.repeat(e.deathSaves?.s || 0)}${'○'.repeat(3 - (e.deathSaves?.s || 0))}
                  <button class="btn small ghost" data-co-dss="${i}" style="padding:0 5px;">+</button>
                  ❌${'●'.repeat(e.deathSaves?.f || 0)}${'○'.repeat(3 - (e.deathSaves?.f || 0))}
                  <button class="btn small ghost" data-co-dsf="${i}" style="padding:0 5px;">+</button>
                </div>` : ''}
            </div>
          </div>`;
      }).join('')}
    </div>`;

  $$('#combat-order .co-row').forEach((row) => {
    row.onclick = (e) => {
      if (e.target.closest('button')) return;
      const i = Number(row.dataset.coI);
      const t = tokenOf(c.entries[i]?.name);
      if (t) { bmap.select(t.id); bmap.centerOn(t.col, t.row); }
    };
  });
  $$('#combat-order [data-co-dss]').forEach((b) => b.onclick = async () => {
    const e = c.entries[Number(b.dataset.coDss)];
    if (!e) return;
    e.deathSaves = { ...(e.deathSaves || { s: 0, f: 0 }), s: Math.min(3, (e.deathSaves?.s || 0) + 1) };
    await saveCombatState();
    renderMapSide();
  });
  $$('#combat-order [data-co-dsf]').forEach((b) => b.onclick = async () => {
    const e = c.entries[Number(b.dataset.coDsf)];
    if (!e) return;
    e.deathSaves = { ...(e.deathSaves || { s: 0, f: 0 }), f: Math.min(3, (e.deathSaves?.f || 0) + 1) };
    await saveCombatState();
    renderMapSide();
  });
}

function renderTokenList() {
  const el = $('#token-list');
  if (!el) return;
  const tokens = state.battle.tokens || [];
  const icon = { pc: '🎮', npc: '🎭', enemy: '👹' };
  const kindColor = { pc: '#4ade80', npc: '#c4a747', enemy: '#e05252' };
  const currentName = state.combat.entries[state.combat.turn]?.name;
  el.innerHTML = tokens.length ? tokens.map((t) => {
    const cor = t.color || kindColor[t.kind] || '#8b5cf6';
    const frac = t.maxHp > 0 ? Math.max(0, Math.min(1, (t.hp ?? 0) / t.maxHp)) : null;
    const conds = (t.conditions || []).map((c) => `<span class="cond-chip" title="${esc(c)}">${condIcon(c)}</span>`).join('');
    const isTurn = currentName && (t.combatName || t.name) === currentName;
    return `
    <div class="token-row ${t.hidden ? 'hidden-token' : ''} ${isTurn ? 'is-turn' : ''}">
      ${t.imageUrl
        ? `<img class="token-avatar" style="border-color:${esc(cor)}" src="${esc(t.imageUrl)}" alt="" onerror="this.remove()" />`
        : `<span class="token-dot" style="background:${esc(cor)}"></span>`}
      <span class="name">
        ${isTurn ? '⚔️ ' : (icon[t.kind] || '⚪ ')}${esc(t.name)}${t.concentration ? ' 🧠' : ''}
        ${frac !== null ? `<small>${esc(t.hp)}/${esc(t.maxHp)} PV</small>` : ''}
        ${conds ? `<div class="cond-list">${conds}</div>` : ''}
      </span>
      <button class="btn small ghost" data-tok-dup="${t.id}" title="Duplicar este token com PV cheios">📋</button>
      <button class="btn small ghost" data-tok-hide="${t.id}" title="${t.hidden ? 'Mostrar aos jogadores' : 'Esconder dos jogadores'}">${t.hidden ? '🙈' : '👁️'}</button>
      <button class="btn small ghost" data-tok-edit="${t.id}">✏️</button>
      <button class="btn small danger" data-tok-del="${t.id}">🗑</button>
    </div>`;
  }).join('') : '<div class="empty">Nenhum token. Traga a iniciativa ou os jogadores.</div>';

  $$('#token-list [data-tok-dup]').forEach((b) => b.onclick = (e) => { e.stopPropagation(); duplicateToken(b.dataset.tokDup); });
  $$('#token-list [data-tok-hide]').forEach((b) => b.onclick = () => {
    const t = state.battle.tokens.find((x) => x.id === b.dataset.tokHide);
    t.hidden = !t.hidden;
    pushBattle();
    renderMapSide();
  });
  $$('#token-list [data-tok-edit]').forEach((b) => b.onclick = () =>
    tokenModal(state.battle.tokens.find((x) => x.id === b.dataset.tokEdit)));
  $$('#token-list [data-tok-del]').forEach((b) => b.onclick = () => removeToken(b.dataset.tokDel));
  $$('#token-list .token-row').forEach((row, i) => row.onclick = (e) => {
    if (e.target.closest('button')) return;
    const t = tokens[i];
    bmap.select(t.id);
    bmap.centerOn(t.col, t.row);
  });
}

// Galeria dos mapas prontos que o Mestre deixou em data/sample-maps/.
// Estes mapas não têm grade desenhada: o Mestre escolhe as colunas e as linhas saem
// da proporção da imagem, para o quadrado ficar quadrado e a imagem encaixar exata.
async function sampleMapsModal() {
  const mapas = await tryApi(() => api('/sample-maps'));
  if (!mapas) return;

  openModal('📚 Mapas de exemplo', mapas.length ? `
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
    toast(`🗺️ "${map.name}" está em jogo (${map.cols}×${map.rows}).`);
    closeModal();
    await refresh();
    setTimeout(() => bmap.fit(), 100);
  });
}

function mapModal(m = {}) {
  const isNew = !m.id;
  openModal(isNew ? 'Novo mapa' : `Editar ${esc(m.name)}`, `
    ${field('Nome', 'name', m.name, 'text', 'Cripta do Rei Esquecido')}
    <div class="field-row">
      ${field('Colunas (quadrados)', 'cols', m.cols ?? 20, 'number')}
      ${field('Linhas (quadrados)', 'rows', m.rows ?? 15, 'number')}
      ${field('Metros por quadrado', 'cellSize', m.cellSize ?? 1.5, 'number')}
    </div>
    ${isNew ? `
      <div class="field"><label>Imagem do mapa (upload — PNG/JPG/WebP, até 25 MB)</label>
        <input type="file" name="file" accept=".png,.jpg,.jpeg,.webp,.gif" /></div>
      ${field('...ou URL da imagem', 'imageUrl', '', 'text', 'https://... (mapa gerado por IA)')}
      <p class="help-text">Sem imagem = grid limpo. Depois, use os botões "Imagem" na barra para encaixar o desenho nos quadrados.</p>
    ` : '<p class="help-text">O tamanho do grid pode mudar a qualquer momento — os tokens continuam onde estão.</p>'}
  `, async (data) => {
    data.cols = Number(data.cols);
    data.rows = Number(data.rows);
    data.cellSize = Number(data.cellSize);
    if (isNew) {
      const fileInput = $('#modal-form [name="file"]');
      const fd = new FormData();
      for (const [k, v] of Object.entries(data)) if (k !== 'file') fd.append(k, v);
      if (fileInput?.files[0]) fd.append('file', fileInput.files[0]);
      const map = await api('/maps', { method: 'POST', body: fd });
      await api('/battle', { method: 'PUT', body: { mapId: map.id } });
      toast('🗺️ Mapa criado e em jogo!');
      setTimeout(() => bmap.fit(), 100);
    } else {
      delete data.file;
      await api(`/maps/${m.id}`, { method: 'PUT', body: data });
    }
  });
}

function tokenModal(t = null) {
  const isNew = !t;
  const combatNames = state.combat.entries.map((e) => e.name);
  openModal(isNew ? 'Novo token' : `Editar ${esc(t.name)}`, `
    ${field('Nome', 'name', t?.name ?? '', 'text', 'Goblin 3')}
    <div class="field-row">
      ${fieldSelect('Tipo', 'kind', [
        { value: 'pc', label: '🎮 Jogador' },
        { value: 'npc', label: '🎭 NPC' },
        { value: 'enemy', label: '👹 Inimigo' },
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
      ${field('Cor', 'color', t?.color || '#8b5cf6', 'color')}
    </div>
    ${fieldSelect('Ligar à iniciativa (PV e condições sincronizados)', 'combatName',
      [{ value: '', label: '— não ligar —' }, ...combatNames.map((n) => ({ value: n, label: n }))], t?.combatName ?? '')}
    ${fieldImage('Retrato do token', 'imageUrl', t?.imageUrl ?? '')}
    <label style="font-size:13px;"><input type="checkbox" name="hidden" ${t?.hidden ? 'checked' : ''} /> 🙈 Escondido dos jogadores</label>
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
      <h2>🗓️ Sessões</h2>
      <div class="actions"><button class="btn" id="btn-new-session">+ Nova sessão</button></div>
    </div>
    <p class="help-text">Anote o que aconteceu em cada sessão. A IA gera um <b>recap épico</b> para você postar no Discord antes da próxima.</p><br/>
    <div class="grid">${[...state.sessions].reverse().map((s) => `
      <div class="card">
        <h3>${esc(s.title || 'Sessão')}</h3>
        <span class="badge">${esc(s.date || '')}</span>
        <div class="desc">${esc(s.recap || s.notes || '')}</div>
        <div class="row">
          <button class="btn small gold" data-recap="${s.id}">✨ Gerar recap</button>
          ${s.recap ? `<button class="btn small" data-post-recap="${s.id}">📤 Postar no Discord</button>` : ''}
          <button class="btn small ghost" data-edit-session="${s.id}">Editar</button>
          <button class="btn small danger" data-del-session="${s.id}">🗑</button>
        </div>
      </div>`).join('') || '<div class="empty">Nenhuma sessão registrada.</div>'}</div>`;

  $('#btn-new-session').onclick = () => sessionModal();
  $$('#tab-sessions [data-edit-session]').forEach((b) => b.onclick = () => sessionModal(state.sessions.find((s) => s.id === b.dataset.editSession)));
  $$('#tab-sessions [data-del-session]').forEach((b) => b.onclick = async () => {
    if (confirm('Excluir esta sessão?')) { await api(`/sessions/${b.dataset.delSession}`, { method: 'DELETE' }); refresh(); }
  });
  $$('#tab-sessions [data-recap]').forEach((b) => b.onclick = async () => {
    b.disabled = true; b.textContent = '✨ Escrevendo...';
    await tryApi(() => api(`/ai/recap/${b.dataset.recap}`, { method: 'POST' }), '✨ Recap gerado!');
    refresh();
  });
  $$('#tab-sessions [data-post-recap]').forEach((b) => b.onclick = async () => {
    const s = state.sessions.find((x) => x.id === b.dataset.postRecap);
    await tryApi(() => api('/discord/post', { method: 'POST', body: { content: `📜 **Recap — ${s.title || s.date}**\n\n${s.recap}` } }), '📤 Recap postado!');
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
const d20 = () => 1 + Math.floor(Math.random() * 20);
const abilityMod = (score) => Math.floor((Number(score) - 10) / 2);

function renderCombat() {
  const c = state.combat;
  $('#tab-combat').innerHTML = `
    <div class="tab-header">
      <h2>⚔️ Iniciativa — Rodada ${c.round}</h2>
      <div class="actions">
        <button class="btn small ghost" id="btn-add-combatant">+ Adicionar</button>
        <button class="btn small ghost" id="btn-add-pcs">+ Jogadores</button>
        <button class="btn small" id="btn-sort-init">Ordenar</button>
        <button class="btn small gold" id="btn-next-turn">▶ Próximo turno</button>
        <button class="btn small" id="btn-announce">📤 Postar no Discord</button>
        <button class="btn small danger" id="btn-end-combat">Encerrar</button>
      </div>
    </div>
    <div class="card" style="margin-bottom:14px;">
      <h3>📖 Bestiário (SRD)</h3>
      <div class="row" style="align-items:center;">
        <input id="srd-query" placeholder="goblin, dragon, skeleton... (em inglês)" style="flex:1;" />
        <button class="btn small" id="btn-srd-search">🔍 Buscar</button>
      </div>
      <div id="srd-results"></div>
    </div>
    <table class="combat-table">
      <thead><tr><th>Init</th><th>Nome</th><th>PV</th><th>PV máx</th><th title="Concentração">🧠</th><th>Condições</th><th></th></tr></thead>
      <tbody>${c.entries.map((e, i) => `
        <tr class="${i === c.turn ? 'current' : ''}">
          <td><input type="number" value="${esc(e.init)}" data-ci="${i}" data-cf="init" /></td>
          <td><input class="name-input" value="${esc(e.name)}" data-ci="${i}" data-cf="name" />
            ${e.hp <= 0 && e.maxHp ? `<div class="death-saves" data-ds="${i}">☠️
              <span title="Sucessos">✅${'●'.repeat(e.deathSaves?.s || 0)}${'○'.repeat(3 - (e.deathSaves?.s || 0))}</span>
              <button class="btn small ghost" data-ds-s="${i}">+</button>
              <span title="Falhas">❌${'●'.repeat(e.deathSaves?.f || 0)}${'○'.repeat(3 - (e.deathSaves?.f || 0))}</span>
              <button class="btn small ghost" data-ds-f="${i}">+</button>
            </div>` : ''}
          </td>
          <td><input type="number" value="${esc(e.hp)}" data-ci="${i}" data-cf="hp" /></td>
          <td><input type="number" value="${esc(e.maxHp)}" data-ci="${i}" data-cf="maxHp" /></td>
          <td><input type="checkbox" ${e.concentration ? 'checked' : ''} data-conc="${i}" title="Concentrando em magia" /></td>
          <td>
            ${(e.conditions || []).map((cond) => `<span class="badge purple cond-badge" data-rm-cond="${i}|${esc(cond)}" title="Clique para remover">${esc(cond)} ✕</span>`).join(' ')}
            <select data-add-cond="${i}" class="cond-select">
              <option value="">+ condição</option>
              ${CONDITIONS.filter((x) => !(e.conditions || []).includes(x)).map((x) => `<option>${x}</option>`).join('')}
            </select>
          </td>
          <td><button class="btn small danger" data-remove-combatant="${i}">🗑</button></td>
        </tr>`).join('')}</tbody>
    </table>
    ${c.entries.length ? '' : '<div class="empty">Adicione combatentes manualmente, traga os jogadores ou busque monstros no bestiário acima.</div>'}`;

  const saveCombat = async () => { await api('/combat', { method: 'PUT', body: c }); refresh(); };

  // Bestiário SRD
  const doSearch = async () => {
    const q = $('#srd-query').value.trim();
    if (!q) return;
    $('#srd-results').innerHTML = '<div class="help-text">Buscando...</div>';
    const results = await tryApi(() => api(`/srd/monsters?q=${encodeURIComponent(q)}`));
    if (!results) return;
    $('#srd-results').innerHTML = results.length ? results.slice(0, 12).map((m) => `
      <div class="row" style="align-items:center; padding:4px 0;">
        <span style="flex:1;">${esc(m.name)}</span>
        <button class="btn small ghost" data-srd-view="${esc(m.index)}">📋 Ficha</button>
        <button class="btn small" data-srd-add="${esc(m.index)}">➕ Iniciativa</button>
        <button class="btn small gold" data-srd-map="${esc(m.index)}" title="Entra na iniciativa e já aparece no mapa">🗺️ Iniciativa + mapa</button>
      </div>`).join('') : '<div class="help-text">Nada encontrado — a busca é pelo nome em inglês (SRD).</div>';

    $$('#srd-results [data-srd-view]').forEach((b) => b.onclick = () => showMonster(b.dataset.srdView));
    $$('#srd-results [data-srd-add]').forEach((b) => b.onclick = () => addMonster(b.dataset.srdAdd, false));
    $$('#srd-results [data-srd-map]').forEach((b) => b.onclick = () => addMonster(b.dataset.srdMap, true));
  };
  $('#btn-srd-search').onclick = doSearch;
  $('#srd-query').addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });

  // Controles do combate
  $('#btn-add-combatant').onclick = () => { c.entries.push({ name: 'Monstro', init: 10, hp: 10, maxHp: 10, conditions: [], deathSaves: { s: 0, f: 0 } }); saveCombat(); };
  $('#btn-add-pcs').onclick = () => {
    for (const pc of state.characters.filter((x) => x.type === 'pc')) {
      if (!c.entries.some((e) => e.name === pc.name)) {
        c.entries.push({ name: pc.name, init: 10, hp: pc.hp ?? 0, maxHp: pc.maxHp ?? 0, conditions: [], deathSaves: { s: 0, f: 0 }, isPc: true });
      }
    }
    saveCombat();
  };
  $('#btn-sort-init').onclick = () => { c.entries.sort((a, b) => b.init - a.init); c.turn = 0; saveCombat(); };
  $('#btn-next-turn').onclick = () => {
    if (!c.entries.length) return;
    c.turn = (c.turn + 1) % c.entries.length;
    if (c.turn === 0) c.round += 1;
    const cur = c.entries[c.turn];
    if (cur?.conditions?.length) toast(`⚠️ ${cur.name} está: ${cur.conditions.join(', ')}`);
    saveCombat();
  };
  $('#btn-end-combat').onclick = () => {
    if (confirm('Encerrar o combate e limpar a lista?')) { c.entries = []; c.round = 1; c.turn = 0; saveCombat(); }
  };
  $('#btn-announce').onclick = () => tryApi(() => api('/combat/announce', { method: 'POST' }), '📤 Iniciativa postada!');

  $$('#tab-combat [data-ci]').forEach((inp) => inp.onchange = () => {
    const e = c.entries[Number(inp.dataset.ci)];
    const fieldName = inp.dataset.cf;
    const newVal = inp.type === 'number' ? Number(inp.value) : inp.value;
    if (fieldName === 'hp') {
      const dmg = (e.hp ?? 0) - newVal;
      if (dmg > 0 && e.concentration) {
        toast(`🧠 ${e.name} tomou ${dmg} de dano concentrando: salvaguarda de CON CD ${Math.max(10, Math.floor(dmg / 2))}!`);
      }
      if (newVal <= 0 && e.hp > 0) e.deathSaves = { s: 0, f: 0 };
    }
    e[fieldName] = newVal;
    if (fieldName === 'hp') { saveCombat(); return; } // re-renderiza para mostrar/ocultar death saves
    api('/combat', { method: 'PUT', body: c });
  });
  $$('#tab-combat [data-conc]').forEach((inp) => inp.onchange = () => {
    c.entries[Number(inp.dataset.conc)].concentration = inp.checked;
    api('/combat', { method: 'PUT', body: c });
  });
  $$('#tab-combat [data-add-cond]').forEach((sel) => sel.onchange = () => {
    if (!sel.value) return;
    const e = c.entries[Number(sel.dataset.addCond)];
    e.conditions = [...(e.conditions || []), sel.value];
    saveCombat();
  });
  $$('#tab-combat [data-rm-cond]').forEach((b) => b.onclick = () => {
    const [i, cond] = b.dataset.rmCond.split('|');
    const e = c.entries[Number(i)];
    e.conditions = (e.conditions || []).filter((x) => x !== cond);
    saveCombat();
  });
  $$('#tab-combat [data-ds-s]').forEach((b) => b.onclick = () => {
    const e = c.entries[Number(b.dataset.dsS)];
    e.deathSaves = e.deathSaves || { s: 0, f: 0 };
    e.deathSaves.s = (e.deathSaves.s + 1) % 4;
    if (e.deathSaves.s === 3) toast(`💚 ${e.name} estabilizou!`);
    saveCombat();
  });
  $$('#tab-combat [data-ds-f]').forEach((b) => b.onclick = () => {
    const e = c.entries[Number(b.dataset.dsF)];
    e.deathSaves = e.deathSaves || { s: 0, f: 0 };
    e.deathSaves.f = (e.deathSaves.f + 1) % 4;
    if (e.deathSaves.f === 3) toast(`💀 ${e.name} morreu...`);
    saveCombat();
  });
  $$('#tab-combat [data-remove-combatant]').forEach((b) => b.onclick = () => {
    c.entries.splice(Number(b.dataset.removeCombatant), 1);
    if (c.turn >= c.entries.length) c.turn = 0;
    saveCombat();
  });
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

  c.entries.push({
    name: nome,
    init: d20() + mod,
    initMod: mod,
    hp: m.hit_points, maxHp: m.hit_points,
    conditions: [], deathSaves: { s: 0, f: 0 },
    srdIndex: m.index,
  });
  await tryApi(() => api('/combat', { method: 'PUT', body: c }));

  if (aoMapa) {
    const map = activeMap();
    if (!map) return toast('➕ Entrou na iniciativa, mas não há mapa em jogo para receber o token.', true);
    const i = state.battle.tokens.length;
    state.battle.tokens.push({
      id: Math.random().toString(16).slice(2, 10),
      name: nome, kind: 'enemy', combatName: nome,
      col: Math.min(map.cols - 1, i % map.cols),
      row: Math.min(map.rows - 1, Math.floor(i / map.cols)),
      size: SRD_SIZE[m.size] || 1,
      speed: metros,
      hp: m.hit_points, maxHp: m.hit_points,
      hidden: false, color: '', imageUrl: '',
    });
    pushBattle();
    toast(`🗺️ ${nome} entrou na iniciativa (d20${mod >= 0 ? '+' : ''}${mod}) e está no mapa.`);
  } else {
    toast(`➕ ${nome} entrou na iniciativa (d20${mod >= 0 ? '+' : ''}${mod}).`);
  }
  refresh();
}

async function showMonster(index) {
  const m = await tryApi(() => api(`/srd/monsters/${index}`));
  if (!m) return;
  const mods = ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'];
  const modLabels = ['FOR', 'DES', 'CON', 'INT', 'SAB', 'CAR'];
  const fmtMod = (v) => { const mod = abilityMod(v); return `${v} (${mod >= 0 ? '+' : ''}${mod})`; };
  const list = (arr, key = 'name') => (arr || []).map((x) => x[key] || x).join(', ') || '—';
  const block = (title, items) => (items || []).length
    ? `<h4 style="color:var(--accent2); margin:10px 0 4px;">${title}</h4>` +
      items.map((a) => `<p style="margin:4px 0;"><b>${esc(a.name)}.</b> ${esc(a.desc)}</p>`).join('')
    : '';
  openModal(`📋 ${m.name}`, `
    <div class="help-text" style="font-size:13.5px; line-height:1.55;">
      <i>${esc(m.size)} ${esc(m.type)}, ${esc(m.alignment)}</i><br/>
      <b>CA</b> ${esc(m.armor_class?.[0]?.value ?? '?')} · <b>PV</b> ${esc(m.hit_points)} (${esc(m.hit_dice)}) ·
      <b>Deslocamento</b> ${esc(Object.entries(m.speed || {}).map(([k, v]) => `${k} ${v}`).join(', '))}<br/>
      ${mods.map((k, i) => `<b>${modLabels[i]}</b> ${fmtMod(m[k])}`).join(' · ')}<br/>
      <b>Sentidos</b> ${esc(Object.entries(m.senses || {}).map(([k, v]) => `${k.replace(/_/g, ' ')} ${v}`).join(', ') || '—')} ·
      <b>Idiomas</b> ${esc(m.languages || '—')} · <b>CR</b> ${esc(m.challenge_rating)} (${esc(m.xp)} XP)<br/>
      ${m.damage_resistances?.length ? `<b>Resistências</b> ${esc(list(m.damage_resistances))}<br/>` : ''}
      ${m.damage_immunities?.length ? `<b>Imunidades</b> ${esc(list(m.damage_immunities))}<br/>` : ''}
      ${m.condition_immunities?.length ? `<b>Imune a condições</b> ${esc(list(m.condition_immunities))}<br/>` : ''}
      ${block('Habilidades', m.special_abilities)}
      ${block('Ações', m.actions)}
      ${block('Ações Lendárias', m.legendary_actions)}
    </div>
  `, async () => {}, 'Fechar');
  // Sem campos para salvar — o submit apenas fecha
  $('#modal-form').onsubmit = (e) => { e.preventDefault(); closeModal(); };
}

// ---------- Assistente IA ----------
let aiRendered = false;
function renderAiTab() {
  if (aiRendered) return; // não re-renderiza para não perder o chat
  aiRendered = true;
  $('#tab-ai').innerHTML = `
    <div class="tab-header"><h2>✨ Assistente do Mestre</h2></div>
    <div class="ai-shortcuts">
      <button class="btn small ghost" data-prompt="Me dê um resumo rápido de onde a campanha parou e quais ganchos estão em aberto.">📍 Onde paramos?</button>
      <button class="btn small ghost" data-prompt="Os jogadores foram para um lugar que eu não preparei. Improvise um local interessante coerente com a campanha, com 1 NPC e 1 gancho.">🎲 Improvisar local</button>
      <button class="btn small ghost" data-prompt="Crie um NPC rápido coerente com a campanha: nome, aparência, voz, motivação e um segredo.">🧙 NPC rápido</button>
      <button class="btn small ghost" data-prompt="Monte um encontro de combate balanceado para o grupo atual, com tática dos inimigos.">⚔️ Encontro</button>
      <button class="btn small ghost" data-prompt="Sugira 3 consequências interessantes para as últimas ações dos jogadores.">🌊 Consequências</button>
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
    box.insertAdjacentHTML('beforeend', `<div class="msg assistant thinking" id="thinking">✨ Consultando os tomos...</div>`);
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
      box.insertAdjacentHTML('beforeend', `<div class="msg assistant">❌ ${esc(e.message)}</div>`);
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
  $('#tab-settings').innerHTML = `
    <div class="tab-header"><h2>⚙️ Configurações</h2></div>
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
    </div>`;

  loadChannels();
  $('#settings-form').onsubmit = async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target).entries());
    await tryApi(() => api('/settings', { method: 'PUT', body: data }), '⚙️ Configurações salvas!');
    refresh();
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
      voice.map((ch) => `<option value="${ch.id}" ${ch.id === state.settings.voiceChannelId ? 'selected' : ''}>🔊 ${esc(ch.name)}</option>`).join('');
  } catch { /* bot offline */ }
}

// ---------- Barra de som ----------
$('#btn-join').onclick = async () => {
  const channelId = $('#voice-channel-select').value;
  if (!channelId) return toast('Escolha um canal de voz primeiro.', true);
  const r = await tryApi(() => api('/discord/join', { method: 'POST', body: { channelId } }));
  if (r) { toast(`🎙️ Conectado em ${r.channel}!`); refresh(); }
};
$('#btn-leave').onclick = () => tryApi(() => api('/discord/leave', { method: 'POST' }), '👋 Saí do canal de voz.').then(refresh);
$('#btn-stop-sound').onclick = () => tryApi(() => api('/sound/stop', { method: 'POST' }), '⏹ Som parado.').then(refresh);
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
