// Integração com IA via Groq (Llama 3.3 70B) — gratuito em groq.com.
// Para configurar: crie uma conta em groq.com, gere uma API key e adicione
// GROQ_API_KEY=sua_key no arquivo .env do projeto.
import Groq from 'groq-sdk';
import { getDb, getItem } from './store.js';

const MODEL = 'llama-3.3-70b-versatile';

let groq = null;
function getClient() {
  if (!process.env.GROQ_API_KEY) {
    throw new Error('GROQ_API_KEY não definida no .env — acesse groq.com, crie uma conta gratuita e gere uma API key.');
  }
  if (!groq) groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  return groq;
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
  const resp = await getClient().chat.completions.create({
    model: MODEL,
    max_tokens: maxTokens,
    messages: [
      { role: 'system', content: system },
      ...messages,
    ],
  });
  return resp.choices[0]?.message?.content?.trim() ?? '';
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

// Traduz os blocos de texto livre de um monstro do SRD (habilidades, ações...) para
// PT-BR. Recebe [{name, desc}] em inglês e devolve [{name, desc}] na MESMA ordem.
// Sem contexto de campanha — é tradução pura, para ficar barato e consistente.
export async function translateMonster(monsterName, blocks) {
  if (!blocks?.length) return [];
  const payload = blocks.map((b, i) => `[${i}] ${b.name}\n${b.desc}`).join('\n\n');
  const resp = await getClient().chat.completions.create({
    model: MODEL,
    max_tokens: 3000,
    temperature: 0.2,
    messages: [
      {
        role: 'system',
        content: 'Você traduz blocos de ficha de monstro de D&D 5e do inglês para o português brasileiro, ' +
          'com naturalidade e usando os termos OFICIAIS de D&D em PT-BR. Regras rígidas:\n' +
          '- Mantenha a notação de dados intacta: 2d6+3, 1d20, 3d8 etc.\n' +
          '- Converta pés para metros (1 pé ≈ 0,3 m; arredonde para valores redondos: 5 ft→1,5 m, 30 ft→9 m, 60 ft→18 m).\n' +
          '- Termos: saving throw=teste de resistência, DC=CD, hit points=pontos de vida, ' +
          'melee weapon attack=ataque de arma corpo a corpo, ranged=à distância, reach=alcance, Hit:=Acerto:, ' +
          'condições: prone=caído, grappled=agarrado, restrained=contido, poisoned=envenenado, stunned=atordoado, ' +
          'frightened=amedrontado, charmed=enfeitiçado, blinded=cego, prone=caído, unconscious=inconsciente.\n' +
          'Responda APENAS com JSON válido: um array na mesma ordem e quantidade da entrada, ' +
          'no formato [{"name":"...","desc":"..."}]. Sem markdown, sem comentários, sem texto fora do JSON.',
      },
      { role: 'user', content: `Monstro: ${monsterName}\n\nTraduza os ${blocks.length} blocos abaixo:\n\n${payload}` },
    ],
  });
  const text = resp.choices[0]?.message?.content?.trim() ?? '[]';
  const arr = JSON.parse(text.replace(/```json?|```/g, '').trim());
  if (!Array.isArray(arr)) throw new Error('Tradução da IA em formato inesperado.');
  return arr;
}

// Sugere áudios da biblioteca para uma cena.
export async function suggestSceneAudio(sceneId) {
  const db = getDb();
  const scene = getItem('scenes', sceneId);
  if (!scene) throw new Error('Cena não encontrada.');
  if (!db.audio.length) throw new Error('A biblioteca de áudio está vazia — envie alguns arquivos primeiro.');

  const library = db.audio.map((a) =>
    `- id:${a.id} | ${a.name} | tipo:${a.type} | tags: ${(a.tags || []).join(', ') || '-'}`
  ).join('\n');

  const resp = await getClient().chat.completions.create({
    model: MODEL,
    max_tokens: 500,
    messages: [
      {
        role: 'system',
        content: 'Você escolhe trilhas sonoras para cenas de RPG. Responda APENAS com JSON válido, sem markdown, sem explicação.',
      },
      {
        role: 'user',
        content: `Cena: "${scene.title}"\nDescrição: ${scene.readAloud || ''}\nNotas: ${scene.gmNotes || ''}\n\n` +
          `Biblioteca de áudio disponível:\n${library}\n\n` +
          `Escolha o que melhor combina com a cena. Responda SOMENTE com JSON no formato:\n` +
          `{"ambientAudioId": "<id ou null>", "musicAudioId": "<id ou null>", "sfxIds": [], "reasoning": "<1 frase>"}`,
      },
    ],
  });

  const text = resp.choices[0]?.message?.content?.trim() ?? '{}';
  let json;
  try {
    // Remove blocos de markdown caso o modelo os inclua mesmo com a instrução
    json = JSON.parse(text.replace(/```json?|```/g, '').trim());
  } catch {
    throw new Error('A IA retornou uma resposta inválida para a sugestão de áudio. Tente de novo.');
  }
  const valid = (id) => db.audio.some((a) => a.id === id);
  return {
    ambientAudioId: valid(json.ambientAudioId) ? json.ambientAudioId : null,
    musicAudioId: valid(json.musicAudioId) ? json.musicAudioId : null,
    sfxIds: (json.sfxIds || []).filter(valid),
    reasoning: json.reasoning || '',
  };
}
