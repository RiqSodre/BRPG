// Integração com a IA (Claude): o assistente recebe toda a campanha como
// contexto e ajuda o Mestre a consultar a história, improvisar e gerar recaps.
import Anthropic from '@anthropic-ai/sdk';
import { getDb, getItem } from './store.js';

const MODEL = 'claude-sonnet-4-6';

let anthropic = null;
function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY não definida no .env — a IA está desligada.');
  }
  if (!anthropic) anthropic = new Anthropic();
  return anthropic;
}

// Serializa toda a campanha em texto para servir de contexto à IA.
export function buildCampaignContext() {
  const db = getDb();
  const parts = [`# Campanha: ${db.settings.campaignName} (${db.settings.system})`];

  if (db.story.length) {
    parts.push('## História e Lore');
    for (const s of db.story) {
      parts.push(`### ${s.title} [${s.category || 'geral'}]\n${s.content}`);
    }
  }
  if (db.characters.length) {
    parts.push('## Personagens');
    for (const c of db.characters) {
      const tipo = c.type === 'pc' ? `PC (jogador: ${c.player || '?'})` : 'NPC';
      parts.push(
        `### ${c.name} — ${tipo}\n` +
        `${[c.race, c.klass, c.level ? `nível ${c.level}` : ''].filter(Boolean).join(', ')}\n` +
        (c.ac || c.maxHp ? `CA ${c.ac ?? '?'} | PV ${c.hp ?? '?'}/${c.maxHp ?? '?'}\n` : '') +
        (c.stats ? `Atributos: ${c.stats}\n` : '') +
        (c.voice ? `Voz/maneirismos: ${c.voice}\n` : '') +
        (c.description ? `${c.description}\n` : '') +
        (c.secrets ? `SEGREDOS (só o Mestre sabe): ${c.secrets}` : '')
      );
    }
  }
  if (db.scenes.length) {
    parts.push('## Cenas');
    for (const sc of db.scenes) {
      parts.push(`### ${sc.title}\nLeitura: ${sc.readAloud || '-'}\nNotas do Mestre: ${sc.gmNotes || '-'}`);
    }
  }
  if (db.sessions.length) {
    parts.push('## Sessões anteriores');
    for (const s of db.sessions) {
      parts.push(`### ${s.title || s.date}\n${s.recap || s.notes || '-'}`);
    }
  }
  return parts.join('\n\n');
}

const SYSTEM_PROMPT = `Você é o Assistente do Mestre de uma campanha de RPG de mesa (D&D 5e) jogada em português via Discord.
Você conhece TODA a campanha pelo contexto abaixo, incluindo segredos que os jogadores não sabem.
Suas funções: responder dúvidas sobre a história e os personagens, sugerir ganchos e consequências,
improvisar NPCs/diálogos/nomes/lojas/encontros no tom da campanha, ajudar com regras de D&D 5e,
e manter a coerência com o que já foi estabelecido.
Seja direto e prático — o Mestre pode estar no meio de uma sessão. Responda em português.
Quando inventar algo novo, sinalize com "(novo)" para o Mestre saber que não estava na campanha.

<campanha>
{CONTEXT}
</campanha>`;

async function ask(messages, maxTokens = 1500) {
  const system = SYSTEM_PROMPT.replace('{CONTEXT}', buildCampaignContext());
  const resp = await getClient().messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system,
    messages,
  });
  return resp.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
}

// Chat livre do Mestre com o assistente (history = [{role, content}])
export async function chat(history) {
  return ask(history.slice(-20));
}

// Gera o recap de uma sessão a partir das anotações do Mestre.
export async function generateRecap(sessionId) {
  const session = getItem('sessions', sessionId);
  if (!session) throw new Error('Sessão não encontrada.');
  return ask([{
    role: 'user',
    content: `Gere um recap épico e curto (2-4 parágrafos) da última sessão para eu postar no Discord antes da próxima. ` +
      `Tom de narrador, em português, SEM revelar segredos que os jogadores não descobriram. ` +
      `Anotações da sessão:\n\n${session.notes || '(sem anotações)'}`,
  }], 1000);
}

// Improvisa fala/reação de um NPC numa situação.
export async function improviseNpc(npcId, situation) {
  const npc = getItem('characters', npcId);
  if (!npc) throw new Error('NPC não encontrado.');
  return ask([{
    role: 'user',
    content: `Os jogadores estão interagindo com o NPC "${npc.name}". Situação: ${situation}\n` +
      `Me dê: (1) como o NPC reage, (2) 2-3 falas prontas no estilo/voz dele para eu ler, ` +
      `(3) o que ele NÃO vai contar e como desconversa se pressionado.`,
  }], 800);
}

// Sugere áudios da biblioteca para uma cena — a automação de som que o Mestre pediu.
export async function suggestSceneAudio(sceneId) {
  const db = getDb();
  const scene = getItem('scenes', sceneId);
  if (!scene) throw new Error('Cena não encontrada.');
  if (!db.audio.length) throw new Error('A biblioteca de áudio está vazia — envie alguns arquivos primeiro.');

  const library = db.audio.map((a) =>
    `- id:${a.id} | ${a.name} | tipo:${a.type} | tags: ${(a.tags || []).join(', ') || '-'}`
  ).join('\n');

  const resp = await getClient().messages.create({
    model: MODEL,
    max_tokens: 500,
    system: 'Você escolhe trilhas sonoras para cenas de RPG. Responda APENAS com JSON válido, sem markdown.',
    messages: [{
      role: 'user',
      content: `Cena: "${scene.title}"\nDescrição: ${scene.readAloud || ''}\nNotas: ${scene.gmNotes || ''}\n\n` +
        `Biblioteca de áudio disponível:\n${library}\n\n` +
        `Escolha o que melhor combina com a cena. Responda só com JSON:\n` +
        `{"ambientAudioId": "<id ou null>", "musicAudioId": "<id ou null>", "sfxIds": ["<ids de efeitos úteis nesta cena>"], "reasoning": "<1 frase>"}`,
    }],
  });
  const text = resp.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  const json = JSON.parse(text.replace(/```json?|```/g, '').trim());
  // Valida ids contra a biblioteca
  const valid = (id) => db.audio.some((a) => a.id === id);
  return {
    ambientAudioId: valid(json.ambientAudioId) ? json.ambientAudioId : null,
    musicAudioId: valid(json.musicAudioId) ? json.musicAudioId : null,
    sfxIds: (json.sfxIds || []).filter(valid),
    reasoning: json.reasoning || '',
  };
}
