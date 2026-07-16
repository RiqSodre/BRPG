// Login dos jogadores via Discord OAuth2 + resolução de papel (Mestre x jogador).
// Não mexe em nada do painel do Mestre: esta é uma superfície nova e paralela.
// Enquanto DISCORD_CLIENT_ID/SECRET não estiverem no .env, o portal do jogador
// mostra um aviso de "não configurado" em vez de quebrar — o painel do Mestre
// (que não passa por aqui) continua funcionando normalmente.
import { getDb } from './store.js';

const AUTH_BASE = 'https://discord.com/api/oauth2';
const API_BASE = 'https://discord.com/api/v10';

export function oauthConfigured() {
  return Boolean(process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_SECRET);
}

function redirectUri(req) {
  // Permite configurar explicitamente (necessário atrás de túnel/domínio público);
  // em localhost, deduz do próprio request.
  if (process.env.DISCORD_REDIRECT_URI) return process.env.DISCORD_REDIRECT_URI;
  return `${req.protocol}://${req.get('host')}/auth/discord/callback`;
}

export function buildAuthUrl(req) {
  const params = new URLSearchParams({
    client_id: process.env.DISCORD_CLIENT_ID,
    redirect_uri: redirectUri(req),
    response_type: 'code',
    scope: 'identify',
    prompt: 'none',
  });
  return `${AUTH_BASE}/authorize?${params}`;
}

export async function exchangeCode(req, code) {
  const body = new URLSearchParams({
    client_id: process.env.DISCORD_CLIENT_ID,
    client_secret: process.env.DISCORD_CLIENT_SECRET,
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri(req),
  });
  const r = await fetch(`${AUTH_BASE}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!r.ok) throw new Error(`Discord recusou o login (${r.status}).`);
  return r.json(); // { access_token, ... }
}

export async function fetchDiscordUser(accessToken) {
  const r = await fetch(`${API_BASE}/users/@me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!r.ok) throw new Error('Não consegui confirmar sua identidade no Discord.');
  const u = await r.json();
  return {
    id: u.id,
    username: u.username,
    globalName: u.global_name || u.username,
    avatarUrl: u.avatar
      ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=128`
      : null,
  };
}

// IDs do(s) Mestre(s): GM_DISCORD_ID aceita um id ou uma lista separada por vírgula.
function gmIds() {
  return String(process.env.GM_DISCORD_ID || '').split(',').map((s) => s.trim()).filter(Boolean);
}

// A partir do id do Discord já autenticado, decide o papel e, se for jogador,
// qual personagem é o dele. Nunca devolve segredos — só a decisão de acesso.
export function resolveRole(discordUserId) {
  if (gmIds().includes(discordUserId)) return { role: 'dm', character: null };
  const ch = getDb().characters.find((c) => c.type === 'pc' && c.discordUserId === discordUserId);
  if (ch) return { role: 'player', character: { id: ch.id, name: ch.name } };
  return { role: 'unlinked', character: null };
}

// ---------- Middlewares ----------

export function requireAuth(req, res, next) {
  if (!req.session?.discordUser) return res.status(401).json({ error: 'not_authenticated' });
  next();
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session?.discordUser) return res.status(401).json({ error: 'not_authenticated' });
    const { role } = resolveRole(req.session.discordUser.id);
    if (!roles.includes(role)) return res.status(403).json({ error: 'forbidden' });
    req.playerRole = role;
    next();
  };
}
