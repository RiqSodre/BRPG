// Portal do jogador — Fase 0: só o login e a resolução de papel.
// A ficha, o inventário e o resto (Fase 2+) substituem este placeholder.
const card = document.getElementById('portal-card');
const params = new URLSearchParams(location.search);

const ROLE_MSG = {
  dm: () => `
    <div class="portal-badge">👑 Mestre</div>
    <h1>Você é o Mestre</h1>
    <p>Este portal é para os jogadores acompanharem a campanha. Use o painel principal para gerenciar a mesa.</p>
    <a class="portal-btn" href="/" style="background:var(--accent);">Ir para o painel</a>`,
  unlinked: (u) => `
    <div class="portal-badge">⛓️ Sem vínculo</div>
    <h1>Olá, ${esc(u.globalName)}!</h1>
    <p>Você entrou com o Discord, mas ainda não tem um personagem vinculado. No servidor da campanha, use <code>/vincular</code> e escolha seu personagem — depois volte aqui.</p>`,
  player: (u, ch) => `
    <div class="portal-badge">🎮 ${esc(ch.name)}</div>
    <h1>Bem-vindo(a) de volta, ${esc(u.globalName)}!</h1>
    <p>O portal completo (ficha, inventário e status ao vivo) está a caminho. Por enquanto, isto confirma que seu login e vínculo estão funcionando.</p>`,
};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function init() {
  const r = await fetch('/api/auth-status').then((r) => r.json()).catch(() => null);

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
  const avatar = u.avatarUrl ? `<img class="portal-avatar" src="${esc(u.avatarUrl)}" alt="" />` : '';
  const body = ROLE_MSG[r.role](u, r.character);
  card.innerHTML = `${avatar}${body}<br/><button class="portal-logout" id="btn-logout">Sair</button>`;
  document.getElementById('btn-logout').onclick = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    location.reload();
  };
}

init();
