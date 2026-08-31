// Portal do jogador. Login nativo: escolhe o próprio personagem numa lista e digita a
// senha que o Mestre deu — sem conta externa nenhuma, o sistema roda sozinho. Um
// personagem logado sai do card e entra na visão ao vivo (mapa + iniciativa + a própria
// ficha sempre à mão) — a mesma tela que mesa.html mostra, só que atrás do login.
const card = document.getElementById('portal-card');
const wrap = document.getElementById('portal-wrap');
const live = document.getElementById('portal-live');

const escPortal = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Um script por vez, na ordem certa: <script> criado por JS não garante ordem de
// execução sozinho (isso só vale para tags estáticas do HTML), então cada um só é
// inserido depois que o anterior terminou de carregar.
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Falha ao carregar ${src}`));
    document.body.appendChild(s);
  });
}

// Monta a visão ao vivo: define pro mesa.js qual WebSocket usar (autenticado, não o
// /mesa público) e qual personagem é "meu" (destaca o chip e liga o botão "Minha
// ficha") — os dois via globais lidos por mesa.js antes de conectar.
async function bootLiveView(character) {
  window.MESA_WS_PATH = '/portal-ws';
  window.MEU_PERSONAGEM_ID = character?.id || null;
  document.getElementById('btn-portal-logout').onclick = async () => {
    await fetch('/api/portal/logout', { method: 'POST' });
    location.reload();
  };
  try {
    for (const src of ['battlemap.js', 'dice3d.js', 'sheet.js', 'mesa.js']) {
      await loadScript(src); // eslint-disable-line no-await-in-loop
    }
  } catch (e) {
    live.innerHTML = `<div class="portal-wrap"><div class="portal-card"><h1>Não consegui carregar a mesa</h1><p>${escPortal(e.message)} — recarregue a página.</p></div></div>`;
  }
}

// Tela de login: um personagem por botão (retrato + nome) e um campo de senha embaixo.
function renderLoginForm(roster, erro) {
  if (!roster.length) {
    card.innerHTML = `
      <h1>Portal do Jogador</h1>
      <p>O Mestre ainda não criou nenhum personagem de jogador. Peça pra ele cadastrar sua ficha no painel.</p>`;
    return;
  }
  card.innerHTML = `
    <h1>Portal do Jogador</h1>
    <p>Escolha seu personagem e digite a senha que o Mestre te deu.</p>
    <div class="portal-roster">
      ${roster.map((c) => `
        <button type="button" class="portal-roster-item" data-id="${escPortal(c.id)}">
          ${c.imageUrl ? `<img src="${escPortal(c.imageUrl)}" alt="" />` : `<span class="portal-roster-initial">${escPortal((c.name || '?').trim().slice(0, 1).toUpperCase())}</span>`}
          <span class="portal-roster-name">${escPortal(c.name)}</span>
        </button>`).join('')}
    </div>
    <form class="portal-login-form" id="portal-login-form">
      <input type="password" name="passcode" placeholder="Senha" autocomplete="current-password" required />
      <button class="portal-btn" type="submit" id="portal-login-submit" disabled>Entrar</button>
    </form>
    ${erro ? `<p class="portal-login-erro">${escPortal(erro)}</p>` : ''}`;

  let selecionado = null;
  const submitBtn = document.getElementById('portal-login-submit');
  document.querySelectorAll('.portal-roster-item').forEach((btn) => btn.onclick = () => {
    selecionado = btn.dataset.id;
    document.querySelectorAll('.portal-roster-item').forEach((b) => b.classList.toggle('selected', b === btn));
    submitBtn.disabled = false;
  });

  document.getElementById('portal-login-form').onsubmit = async (e) => {
    e.preventDefault();
    if (!selecionado) return;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Entrando...';
    const passcode = new FormData(e.target).get('passcode');
    const r = await fetch('/api/portal/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ characterId: selecionado, passcode }),
    }).then((r2) => r2.json()).catch(() => ({ ok: false, erro: 'Não consegui falar com o servidor.' }));

    if (r.ok) { await entrarComoJogador(r.character); return; }
    renderLoginForm(roster, r.erro || 'Não foi possível entrar.');
  };
}

async function entrarComoJogador(character) {
  wrap.classList.add('hidden');
  live.classList.remove('hidden');
  await bootLiveView(character);
}

async function init() {
  const me = await fetch('/api/portal/me').then((r) => r.json()).catch(() => null);
  if (me?.character) { await entrarComoJogador(me.character); return; }

  const roster = await fetch('/api/portal/roster').then((r) => r.json()).catch(() => []);
  renderLoginForm(roster);
}

init();
