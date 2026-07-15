// Integração com o Obsidian: importa e exporta dados da campanha como arquivos Markdown.
// O usuário aponta para a pasta da campanha no vault e o painel lê/escreve os .md.
import fs from 'fs';
import path from 'path';
import { newId } from './store.js';

// ---------- Parser de frontmatter YAML simples (key: value, uma linha por campo) ----------
function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { data: {}, body: content.trim() };
  const data = {};
  for (const line of match[1].split(/\r?\n/)) {
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    const val = line.slice(colon + 1).trim();
    if (key) data[key] = val;
  }
  return { data, body: match[2].trim() };
}

function serializeFrontmatter(data) {
  const lines = Object.entries(data)
    .filter(([, v]) => v !== null && v !== undefined && v !== '' && v !== 0)
    .map(([k, v]) => `${k}: ${v}`);
  return lines.length ? `---\n${lines.join('\n')}\n---\n\n` : '';
}

function safeFilename(name) {
  return name.replace(/[\\/:*?"<>|]/g, '-').trim();
}

function readFolder(folderPath) {
  if (!folderPath || !fs.existsSync(folderPath)) return [];
  try {
    return fs.readdirSync(folderPath)
      .filter((f) => f.endsWith('.md'))
      .map((f) => {
        try {
          const content = fs.readFileSync(path.join(folderPath, f), 'utf8');
          const { data, body } = parseFrontmatter(content);
          const name = data.name || path.basename(f, '.md');
          return { file: f, name, data, body };
        } catch { return null; }
      })
      .filter(Boolean);
  } catch { return []; }
}

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function sub(vaultPath, folderName) {
  return folderName ? path.join(vaultPath, folderName) : null;
}

// ---------- Mapeamento: arquivo .md → objeto BRPG ----------

function mapCharacters(files, type, defaultKind) {
  return files.map((f) => {
    const d = f.data;
    return {
      name: f.name,
      type,
      kind: d.kind || defaultKind,
      player: d.player || '',
      race: d.race || d.raca || '',
      klass: d.class || d.classe || d.klass || '',
      level: Number(d.level || d.nivel || 0) || 0,
      ac: Number(d.ac || 0) || 0,
      hp: Number(d.hp || 0) || 0,
      maxHp: Number(d.maxHp || d.maxhp || d.hp_max || 0) || 0,
      stats: d.stats || '',
      description: f.body,
      secrets: d.secrets || d.segredos || '',
      voice: d.voice || d.voz || '',
      imageUrl: d.imageUrl || d.image || '',
    };
  });
}

function mapScenes(files) {
  return files.map((f) => {
    let readAloud = f.body;
    let gmNotes = '';
    // Separa corpo pela seção "Notas do Mestre" se existir
    const m = f.body.match(/^([\s\S]*?)^#{1,3}\s*(?:notas do mestre|gm notes?)[^\n]*\n([\s\S]*)$/im);
    if (m) { readAloud = m[1].trim(); gmNotes = m[2].trim(); }
    return {
      title: f.name,
      readAloud,
      gmNotes: gmNotes || f.data.gmNotes || '',
      imageUrl: f.data.imageUrl || f.data.image || '',
    };
  });
}

function mapSessions(files) {
  return files.map((f) => ({
    title: f.name,
    date: f.data.date || f.data.data || '',
    notes: f.body,
    recap: f.data.recap || '',
  }));
}

function mapLore(files) {
  return files.map((f) => ({
    title: f.name,
    category: f.data.category || f.data.categoria || 'geral',
    content: f.body,
  }));
}

// ---------- Importação ----------

export function importFromVault(db, obsidianSettings) {
  const v = obsidianSettings.vaultPath;
  if (!v) throw new Error('Caminho do vault não configurado.');
  if (!fs.existsSync(v)) throw new Error(`Pasta não encontrada: ${v}`);

  const result = { created: 0, updated: 0, details: [] };

  const merge = (collection, incoming, keyField = 'name') => {
    for (const item of incoming) {
      if (!item[keyField]) continue;
      const idx = db[collection].findIndex(
        (x) => x[keyField]?.toLowerCase() === item[keyField]?.toLowerCase()
      );
      if (idx >= 0) {
        db[collection][idx] = {
          ...db[collection][idx],
          ...item,
          id: db[collection][idx].id,
          updatedAt: new Date().toISOString(),
        };
        result.updated++;
        result.details.push(`✏️ ${item[keyField]}`);
      } else {
        db[collection].push({ id: newId(), ...item, updatedAt: new Date().toISOString() });
        result.created++;
        result.details.push(`➕ ${item[keyField]}`);
      }
    }
  };

  merge('characters', mapCharacters(readFolder(sub(v, obsidianSettings.folderPlayers)), 'pc', 'pc'));
  merge('characters', mapCharacters(readFolder(sub(v, obsidianSettings.folderEnemies)), 'npc', 'enemy'));
  merge('characters', mapCharacters(readFolder(sub(v, obsidianSettings.folderNpcs)), 'npc', 'npc'));
  merge('scenes', mapScenes(readFolder(sub(v, obsidianSettings.folderScenes))), 'title');
  merge('sessions', mapSessions(readFolder(sub(v, obsidianSettings.folderSessions))), 'title');

  // Lore: pode ser uma pasta ou um arquivo único na raiz do vault
  const loreFolder = obsidianSettings.folderLore;
  if (loreFolder) {
    const lorePath = sub(v, loreFolder);
    let loreFiles = [];
    if (fs.existsSync(lorePath) && fs.statSync(lorePath).isDirectory()) {
      loreFiles = readFolder(lorePath);
    } else {
      const singleFile = lorePath + '.md';
      if (fs.existsSync(singleFile)) {
        const { data, body } = parseFrontmatter(fs.readFileSync(singleFile, 'utf8'));
        loreFiles = [{ name: loreFolder, data, body }];
      }
    }
    merge('story', mapLore(loreFiles), 'title');
  }

  return result;
}

// ---------- Exportação ----------

function renderCharacter(char) {
  const fm = serializeFrontmatter({
    brpg: char.type === 'pc' ? 'pc' : 'npc',
    kind: char.kind,
    player: char.player,
    race: char.race,
    class: char.klass,
    level: char.level,
    ac: char.ac,
    hp: char.hp,
    maxHp: char.maxHp,
    stats: char.stats,
    imageUrl: char.imageUrl,
    secrets: char.secrets,
    voice: char.voice,
  });
  return fm + (char.description || '');
}

function renderScene(scene) {
  const fm = serializeFrontmatter({ brpg: 'scene', imageUrl: scene.imageUrl });
  const parts = [fm];
  if (scene.readAloud) parts.push(`## Descrição\n${scene.readAloud}`);
  if (scene.gmNotes) parts.push(`## Notas do Mestre\n${scene.gmNotes}`);
  return parts.join('\n\n').trim();
}

function renderSession(session) {
  const fm = serializeFrontmatter({ brpg: 'session', date: session.date, recap: session.recap });
  return fm + (session.notes || '');
}

function renderLore(entry) {
  const fm = serializeFrontmatter({ brpg: 'lore', category: entry.category });
  return fm + (entry.content || '');
}

export function exportToVault(db, obsidianSettings) {
  const v = obsidianSettings.vaultPath;
  if (!v) throw new Error('Caminho do vault não configurado.');

  const result = { written: 0, details: [] };

  const write = (folderName, name, content) => {
    if (!folderName || !name) return;
    const filePath = path.join(v, folderName, safeFilename(name) + '.md');
    writeFile(filePath, content);
    result.written++;
    result.details.push(`${folderName}/${safeFilename(name)}.md`);
  };

  for (const c of db.characters || []) {
    if (c.type === 'pc') write(obsidianSettings.folderPlayers, c.name, renderCharacter(c));
    else if (c.kind === 'enemy') write(obsidianSettings.folderEnemies, c.name, renderCharacter(c));
    else write(obsidianSettings.folderNpcs, c.name, renderCharacter(c));
  }

  for (const s of db.scenes || []) {
    write(obsidianSettings.folderScenes, s.title, renderScene(s));
  }

  for (const s of db.sessions || []) {
    write(obsidianSettings.folderSessions, s.title || s.date || 'Sessão', renderSession(s));
  }

  const loreFolder = obsidianSettings.folderLore;
  if (loreFolder) {
    for (const l of db.story || []) {
      write(loreFolder, l.title, renderLore(l));
    }
  }

  return result;
}
