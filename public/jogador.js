// Portal do jogador. Fase 0 resolvia só o login; a partir daqui (Fase 1), um jogador
// vinculado sai do card e entra na visão ao vivo (mapa + iniciativa + a própria ficha
// sempre à mão) — a mesma tela que mesa.html mostra, só que atrás do login e com o
// personagem da sessão já identificado. Quem é Mestre ou ainda não tem vínculo continua
// vendo só a mensagem de orientação.
const card = document.getElementById('portal-card');
const wrap = document.getElementById('portal-wrap');
const live = document.getElementById('portal-live');
const params = new URLSearchParams(location.search);

const escPortal = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ROLE_MSG = {
  dm: () => `
    <div class="portal-badge">👑 Mestre</div>
    <h1>Você é o Mestre</h1>
    <p>Este portal é para os jogadores acompanharem a campanha. Use o painel principal para gerenciar a mesa.</p>
    <a class="portal-btn" href="/" style="background:var(--accent);">Ir para o painel</a>`,
  unlinked: (u) => `
    <div class="portal-badge">⛓️ Sem vínculo</div>
    <h1>Olá, ${escPortal(u.globalName)}!</h1>
    <p>Você entrou com o Discord, mas ainda não tem um personagem vinculado. No servidor da campanha, use <code>/vincular</code> e escolha seu personagem — depois volte aqui.</p>
    <button class="portal-btn" id="btn-checar-vinculo" style="background:var(--accent);">Já vinculei, checar de novo</button>`,
};

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
    await fetch('/api/auth/logout', { method: 'POST' });
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

async function init() {
  const r = await fetch('/api/auth-status').then((r2) => r2.json()).catch(() => null);

  if (!r || !r.configured) {
    card.innerHTML = `
      <h1>Portal ainda não configurado</h1>
      <p>O Mestre precisa configurar o login com Discord (DISCORD_CLIENT_ID e DISCORD_CLIENT_SECRET no .env) antes que os jogadores possam entrar.</p>`;
    return;
  }

  if (!r.loggedIn) {
    const erro = params.get('erro') === 'acesso_negado'
      ? '<p style="color:var(--danger);">Login cancelado ou negado. Tente novamente.</p>' : '';
    card.innerHTML = `
      <h1>Portal do Jogador</h1>
      <p>Entre com sua conta do Discord para acompanhar sua ficha, inventário e a campanha em tempo real.</p>
      ${erro}
      <a class="portal-btn" href="/auth/discord">🎮 Entrar com Discord</a>`;
    return;
  }

  const u = r.discordUser;

  if (r.role === 'player') {
    // A visão ao vivo já tem seu próprio "Sair" no cabeçalho — o card de login não
    // aparece mais enquanto a sessão for válida.
    wrap.classList.add('hidden');
    live.classList.remove('hidden');
    await bootLiveView(r.character);
    return;
  }

  const avatar = u.avatarUrl ? `<img class="portal-avatar" src="${escPortal(u.avatarUrl)}" alt="" />` : '';
  card.innerHTML = `${avatar}${ROLE_MSG[r.role](u, r.character)}<br/><button class="portal-logout" id="btn-logout">Sair</button>`;
  document.getElementById('btn-logout').onclick = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    location.reload();
  };
  if (r.role === 'unlinked') {
    document.getElementById('btn-checar-vinculo').onclick = () => init();
  }
}

init();
