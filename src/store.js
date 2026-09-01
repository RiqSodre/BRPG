// Armazenamento simples em JSON — sem banco de dados externo.
//
// Dois modos, decididos pelo flag BRPG_MULTI:
//  - self-hosted (padrão): UMA campanha só, vivendo direto em data/campaign.json,
//    com áudio/mapas/imagens em data/. É o comportamento de sempre — nada muda pra
//    quem roda em casa; não há login nem contexto de campanha.
//  - multi (BRPG_MULTI=1): VÁRIAS campanhas, cada uma isolada em
//    data/campaigns/<id>/ (campaign.json + audio/ + maps/ + images/). Cada requisição
//    roda dentro de withCampaign(id, ...) e o store resolve sozinho de qual mesa se
//    trata — sem precisar passar o id por toda função.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { AsyncLocalStorage } from 'async_hooks';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Liga o modo multi-campanha (versão pública/hospedada). Fora dele o store é
// single-tenant e todo o maquinário abaixo fica dormente.
export const MULTI = process.env.BRPG_MULTI === '1';

// BRPG_DATA_DIR permite apontar pra uma pasta de dados alternativa (ex: a demo em
// data-demo/) sem tocar na campanha real — usado pelo `npm run demo`.
export const DATA_DIR = process.env.BRPG_DATA_DIR
  ? path.resolve(__dirname, '..', process.env.BRPG_DATA_DIR)
  : path.join(__dirname, '..', 'data');

// Pastas COMPARTILHADAS por todas as campanhas — não são dados privados de uma mesa:
//  - sample-maps: arte que o operador larga na pasta, oferecida a qualquer campanha.
//    Fica fora do Git de propósito — é arte de terceiros, não redistribuímos.
//  - srd-pt (criada sob demanda pelo server): cache de tradução do bestiário, global por monstro.
export const SAMPLES_DIR = path.join(DATA_DIR, 'sample-maps');

// Dirs da campanha ÚNICA do modo self-hosted — exportados como sempre foram, pra
// server.js seguir usando direto (multer, arquivos estáticos) sem saber de multi-tenancy.
export const AUDIO_DIR = path.join(DATA_DIR, 'audio');
export const MAPS_DIR = path.join(DATA_DIR, 'maps');
export const IMAGES_DIR = path.join(DATA_DIR, 'images'); // retratos de personagens e tokens
const DB_FILE = path.join(DATA_DIR, 'campaign.json');
// Raiz das campanhas no modo multi: data/campaigns/<id>/
const CAMPAIGNS_ROOT = path.join(DATA_DIR, 'campaigns');

// Contexto de campanha por requisição (modo multi). Fora de um withCampaign(...) — que
// é o caso o tempo todo no self-hosted — o store opera na campanha única, exatamente
// como antes. É o que deixa a mudança ser aditiva: nada no single mode enxerga isto.
const als = new AsyncLocalStorage();
export function withCampaign(campaignId, fn) {
  return als.run({ campaignId }, fn);
}
export function activeCampaignId() {
  return als.getStore()?.campaignId ?? null;
}

// Pastas de uma campanha específica no modo multi.
export function dirsFor(campaignId) {
  const base = path.join(CAMPAIGNS_ROOT, campaignId);
  return {
    base,
    file: path.join(base, 'campaign.json'),
    AUDIO_DIR: path.join(base, 'audio'),
    MAPS_DIR: path.join(base, 'maps'),
    IMAGES_DIR: path.join(base, 'images'),
  };
}

// Pastas ativas conforme o contexto: as da campanha corrente (multi) ou as globais
// (single). server.js passa a consultar isto quando precisar do dir certo por requisição.
export function activeDirs() {
  const id = activeCampaignId();
  if (id == null) return { base: DATA_DIR, file: DB_FILE, AUDIO_DIR, MAPS_DIR, IMAGES_DIR };
  return dirsFor(id);
}

const DEFAULTS = {
  settings: {
    campaignName: 'Minha Campanha',
    system: 'D&D 5e',
    obsidian: {
      vaultPath: '',
      folderPlayers: 'Players',
      folderEnemies: 'Inimigos',
      folderNpcs: 'Facções e NPCs',
      folderScenes: 'Locais e Ganchos',
      folderSessions: 'Sessões',
      folderLore: 'Guia geral',
    },
  },
  story: [],      // { id, title, category, content, updatedAt }
  // Catálogo de itens: criado uma vez, entregue a quantos personagens quiser.
  items: [],      // { id, name, description, rarity, type, imageUrl, updatedAt }
  // characters[].inventory = [{ itemId, qty }] — a mochila aponta para o catálogo
  // passcode: só em PCs — a senha que o jogador usa pra entrar no portal (jogador.html).
  characters: [], // { id, name, type: 'pc'|'npc', player, passcode, race, klass, level, ac, hp, maxHp, stats, description, secrets, voice, imageUrl, inventory }
  scenes: [],     // { id, title, readAloud, gmNotes, imageUrl, ambientAudioId, musicAudioId, sfxIds, npcIds }
  audio: [],      // { id, name, filename, type: 'ambient'|'music'|'sfx', category, tags, volume }
                  // category só se aplica a sfx: 'combate'|'criaturas'|'objetos'|'ambiente'|'magia'|'social'|'geral'
  sessions: [],   // { id, date, title, notes, recap }
  combat: { active: false, round: 1, turn: 0, entries: [], log: [] },
  // log: [{ ts, round, turn, text }] — histórico de tudo que rola na luta (dano, cura,
  // condição, turno, morte...); sobrevive ao fim do combate, só limpa se o Mestre pedir.
  // Mapas de batalha: grid + imagem opcional. cellSize = metros por quadrado.
  maps: [],       // { id, name, cols, rows, cellSize, filename, imageUrl, img: { x, y, scale }, fog: { enabled, revealed: ['c,r'] } }
  // showEnemyHp: quando falso, os jogadores veem só a barra e o estado dos inimigos, não os números.
  // vision: campo de visão automático — cada PC revela um raio (em metros) ao redor de si.
  battle: { mapId: null, tokens: [], ping: null, showEnemyHp: false, vision: { enabled: false, radius: 12 } },
  // tokens: { id, name, kind: 'pc'|'npc'|'enemy', col, row, size, color, imageUrl, hp, maxHp, hidden, charId, combatName }
  activeSceneId: null,
};

// Mescla um campaign.json salvo sobre os defaults, cuidando de settings (e do
// sub-objeto obsidian) em profundidade pra campos novos não sumirem em arquivos antigos.
function mergeDefaults(saved) {
  const d = { ...structuredClone(DEFAULTS), ...saved };
  d.settings = { ...structuredClone(DEFAULTS.settings), ...saved.settings };
  if (saved.settings?.obsidian) {
    d.settings.obsidian = { ...structuredClone(DEFAULTS.settings.obsidian), ...saved.settings.obsidian };
  }
  return d;
}

// Garante as pastas de mídia e carrega (ou cria) o campaign.json de um conjunto de dirs.
function loadOrCreate(file, dirs) {
  for (const dir of [dirs.AUDIO_DIR, dirs.MAPS_DIR, dirs.IMAGES_DIR]) fs.mkdirSync(dir, { recursive: true });
  if (fs.existsSync(file)) return mergeDefaults(JSON.parse(fs.readFileSync(file, 'utf8')));
  const fresh = structuredClone(DEFAULTS);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(fresh, null, 2), 'utf8');
  return fresh;
}

// db da campanha única (single mode) — o "db" de sempre.
let singleDb = null;
// Registro do modo multi: campaignId -> db em memória, carregado sob demanda.
const multi = new Map();

export function initStore() {
  fs.mkdirSync(SAMPLES_DIR, { recursive: true });
  if (MULTI) {
    // No modo multi não existe "a" campanha no boot — cada mesa carrega quando é acessada.
    fs.mkdirSync(CAMPAIGNS_ROOT, { recursive: true });
    return null;
  }
  singleDb = loadOrCreate(DB_FILE, { AUDIO_DIR, MAPS_DIR, IMAGES_DIR });
  return singleDb;
}

function multiDb(id) {
  let db = multi.get(id);
  if (!db) {
    const dirs = dirsFor(id);
    db = loadOrCreate(dirs.file, dirs);
    multi.set(id, db);
  }
  return db;
}

// Descarrega uma campanha da memória (ex: ao ser excluída). Não mexe em disco.
export function forgetCampaign(id) {
  multi.delete(id);
}

export function getDb() {
  const id = activeCampaignId();
  if (id == null) {
    // Chamar o store sem campanha ativa no modo multi é erro de programação (uma rota
    // que esqueceu de resolver a mesa) — falha alto e claro em vez de mexer no db errado.
    if (MULTI) throw new Error('getDb() sem campanha ativa no modo multi — envolva a requisição em withCampaign().');
    if (!singleDb) initStore();
    return singleDb;
  }
  return multiDb(id);
}

export function save() {
  const id = activeCampaignId();
  const db = id == null ? singleDb : multi.get(id);
  if (!db) return;
  fs.writeFileSync(activeDirs().file, JSON.stringify(db, null, 2), 'utf8');
}

export function newId() {
  return crypto.randomBytes(6).toString('hex');
}

// CRUD genérico para coleções (story, characters, scenes, audio, sessions)
export function listItems(collection) {
  return getDb()[collection];
}

export function getItem(collection, id) {
  return getDb()[collection].find((x) => x.id === id);
}

export function addItem(collection, data) {
  const item = { id: newId(), ...data, updatedAt: new Date().toISOString() };
  getDb()[collection].push(item);
  save();
  return item;
}

export function updateItem(collection, id, data) {
  const items = getDb()[collection];
  const i = items.findIndex((x) => x.id === id);
  if (i === -1) return null;
  items[i] = { ...items[i], ...data, id, updatedAt: new Date().toISOString() };
  save();
  return items[i];
}

export function removeItem(collection, id) {
  const items = getDb()[collection];
  const i = items.findIndex((x) => x.id === id);
  if (i === -1) return false;
  const [removed] = items.splice(i, 1);
  // Apaga o arquivo físico (áudio ou imagem de mapa) junto com o registro — na pasta
  // da campanha corrente (multi) ou nas pastas globais (single).
  const dirs = activeDirs();
  const dir = collection === 'audio' ? dirs.AUDIO_DIR : collection === 'maps' ? dirs.MAPS_DIR : null;
  if (dir && removed.filename) {
    const f = path.join(dir, removed.filename);
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
  save();
  return true;
}
