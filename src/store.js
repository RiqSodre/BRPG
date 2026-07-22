// Armazenamento simples em JSON — sem banco de dados externo.
// Tudo da campanha vive em data/campaign.json; áudios em data/audio/.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = path.join(__dirname, '..', 'data');
export const AUDIO_DIR = path.join(DATA_DIR, 'audio');
export const MAPS_DIR = path.join(DATA_DIR, 'maps');
export const IMAGES_DIR = path.join(DATA_DIR, 'images'); // retratos de personagens e tokens
// Mapas de exemplo: o usuário larga as imagens aqui e elas aparecem na galeria do painel.
// Fica fora do Git de propósito — é arte de terceiros, não redistribuímos no repositório.
export const SAMPLES_DIR = path.join(DATA_DIR, 'sample-maps');
const DB_FILE = path.join(DATA_DIR, 'campaign.json');

const DEFAULTS = {
  settings: {
    campaignName: 'Minha Campanha',
    system: 'D&D 5e',
    textChannelId: '',
    voiceChannelId: '',
    volume: 0.4,
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
  characters: [], // { id, name, type: 'pc'|'npc', player, race, klass, level, ac, hp, maxHp, stats, description, secrets, voice, imageUrl, inventory }
  scenes: [],     // { id, title, readAloud, gmNotes, imageUrl, ambientAudioId, musicAudioId, sfxIds, npcIds }
  audio: [],      // { id, name, filename, type: 'ambient'|'music'|'sfx', tags, volume }
  sessions: [],   // { id, date, title, notes, recap }
  combat: { active: false, round: 1, turn: 0, entries: [] },
  // Mapas de batalha: grid + imagem opcional. cellSize = metros por quadrado.
  maps: [],       // { id, name, cols, rows, cellSize, filename, imageUrl, img: { x, y, scale }, fog: { enabled, revealed: ['c,r'] } }
  // showEnemyHp: quando falso, os jogadores veem só a barra e o estado dos inimigos, não os números.
  // vision: campo de visão automático — cada PC revela um raio (em metros) ao redor de si.
  // turnDm: quando ligado, o bot manda uma DM pro jogador vinculado sempre que chega a vez dele.
  battle: { mapId: null, tokens: [], ping: null, showEnemyHp: false, vision: { enabled: false, radius: 12 }, turnDm: false },
  // tokens: { id, name, kind: 'pc'|'npc'|'enemy', col, row, size, color, imageUrl, hp, maxHp, hidden, charId, combatName }
  activeSceneId: null,
};

let db = null;

export function initStore() {
  fs.mkdirSync(AUDIO_DIR, { recursive: true });
  fs.mkdirSync(MAPS_DIR, { recursive: true });
  fs.mkdirSync(IMAGES_DIR, { recursive: true });
  fs.mkdirSync(SAMPLES_DIR, { recursive: true });
  if (fs.existsSync(DB_FILE)) {
    const saved = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    db = { ...structuredClone(DEFAULTS), ...saved };
    // Mescla settings profundamente para novos campos (ex: obsidian) não sumirem em arquivos antigos
    db.settings = { ...structuredClone(DEFAULTS.settings), ...saved.settings };
    if (saved.settings?.obsidian) {
      db.settings.obsidian = { ...structuredClone(DEFAULTS.settings.obsidian), ...saved.settings.obsidian };
    }
  } else {
    db = structuredClone(DEFAULTS);
    save();
  }
  return db;
}

export function getDb() {
  if (!db) initStore();
  return db;
}

export function save() {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
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
  // Apaga o arquivo físico (áudio ou imagem de mapa) junto com o registro
  const dir = collection === 'audio' ? AUDIO_DIR : collection === 'maps' ? MAPS_DIR : null;
  if (dir && removed.filename) {
    const f = path.join(dir, removed.filename);
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
  save();
  return true;
}
