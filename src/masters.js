// Contas de Mestre — só existem no modo multi (versão pública/hospedada). No
// self-hosted o painel não tem login e este módulo nem é acionado.
//
// Autenticação por CÓDIGO DE CONVITE, sem e-mail nem senha escolhida pelo usuário: o
// operador minta um código com `npm run mint-master`, entrega ao Mestre, e o próprio
// código é a credencial persistente — o Mestre entra colando ele. Formato, no estilo
// de uma API key:  brpg_<id>_<secret>
//   - <id>     localiza a conta (8 hex) — evita varrer todas as contas no login.
//   - <secret> é verificado contra um hash scrypt salgado; só o hash fica em disco.
// Sem e-mail há recuperação de conta nenhuma: perdeu o código, o operador minta outro.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { DATA_DIR } from './store.js';

// Registro top-level, ao lado da pasta campaigns/ — não é dado de nenhuma campanha.
const FILE = path.join(DATA_DIR, 'masters.json');

// Sem cache em memória: o arquivo é minúsculo e o `mint-master` roda em OUTRO processo;
// reler do disco a cada operação evita servir uma lista velha depois de mintar com o
// servidor no ar. Toda mutação persiste na hora, então reler nunca perde alteração.
function load() {
  if (fs.existsSync(FILE)) return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  return { masters: [] };
}
function persist(data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2), 'utf8');
}

function scryptHash(secret, salt) {
  return crypto.scryptSync(secret, salt, 32).toString('hex');
}

// Cria uma conta e devolve o código de convite EM TEXTO PURO uma única vez — só o hash
// do secret é guardado, então não há como reexibi-lo depois.
export function createMaster(label = '') {
  const data = load();
  const id = crypto.randomBytes(4).toString('hex');       // 8 hex
  const secret = crypto.randomBytes(24).toString('base64url');
  const salt = crypto.randomBytes(16).toString('hex');
  data.masters.push({
    id,
    label,
    secretHash: scryptHash(secret, salt),
    salt,
    createdAt: new Date().toISOString(),
    lastLogin: null,
    campaignIds: [],
  });
  persist(data);
  return { id, code: `brpg_${id}_${secret}` };
}

export function findMaster(id) {
  return load().masters.find((m) => m.id === id) || null;
}

// Verifica um código de convite. Mensagem de erro única de propósito — não revela se
// foi o id ou o secret que não bateu.
export function login(code) {
  const m = /^brpg_([0-9a-f]{8})_(.+)$/.exec(String(code || '').trim());
  if (!m) return { ok: false, erro: 'Código inválido.' };
  const data = load();
  const master = data.masters.find((x) => x.id === m[1]);
  if (!master) return { ok: false, erro: 'Código inválido.' };
  const attempt = Buffer.from(scryptHash(m[2], master.salt), 'hex');
  const stored = Buffer.from(master.secretHash, 'hex');
  if (attempt.length !== stored.length || !crypto.timingSafeEqual(attempt, stored)) {
    return { ok: false, erro: 'Código inválido.' };
  }
  master.lastLogin = new Date().toISOString();
  persist(data);
  return { ok: true, master: { id: master.id } };
}

// Resolve o Mestre logado a partir da sessão — null se ninguém, ou se a conta sumiu.
export function masterSession(req) {
  const id = req.session?.masterId;
  if (!id) return null;
  const m = findMaster(id);
  return m ? { id: m.id } : null;
}

export function requireMaster(req, res, next) {
  if (!masterSession(req)) return res.status(401).json({ error: 'not_authenticated' });
  next();
}

// ---- Posse de campanhas (usado pelo CRUD de campanhas) ----
export function linkCampaign(masterId, campaignId) {
  const data = load();
  const m = data.masters.find((x) => x.id === masterId);
  if (m && !m.campaignIds.includes(campaignId)) { m.campaignIds.push(campaignId); persist(data); }
}
export function unlinkCampaign(masterId, campaignId) {
  const data = load();
  const m = data.masters.find((x) => x.id === masterId);
  if (m) { m.campaignIds = m.campaignIds.filter((c) => c !== campaignId); persist(data); }
}
export function ownsCampaign(masterId, campaignId) {
  const m = findMaster(masterId);
  return !!m && m.campaignIds.includes(campaignId);
}
export function campaignsOf(masterId) {
  const m = findMaster(masterId);
  return m ? m.campaignIds.slice() : [];
}
