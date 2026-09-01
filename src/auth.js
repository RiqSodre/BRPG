// Login dos jogadores: nativo, sem nenhuma conta externa. Cada personagem de jogador
// ganha uma senha definida pelo Mestre na ficha (aba Personagens → Editar); o jogador
// entra no portal escolhendo o próprio personagem numa lista e digitando essa senha.
// O sistema roda inteiramente sozinho — nada aqui depende do Discord estar no ar,
// configurado ou sequer instalado.
import { getDb, getItem } from './store.js';

// Trava simples contra tentativa de força bruta num PIN curto — não é criptografia (a
// senha fica em texto puro no campaign.json, como o resto dos dados da campanha; é o
// mesmo nível de proteção que qualquer outro campo do arquivo). Só desacelera quem
// fica chutando números. Fica em memória — reseta ao reiniciar o servidor, o que é
// aceitável pro tamanho do problema (um jogo caseiro, não um serviço público).
const tentativas = new Map(); // characterId -> { falhas, bloqueadoAte }
const MAX_TENTATIVAS = 8;
const BLOQUEIO_MS = 5 * 60 * 1000;

// Lista pública pro seletor de personagem na tela de login — nunca a senha nem
// qualquer outro dado sensível da ficha.
export function rosterPublico() {
  return getDb().characters
    .filter((c) => c.type === 'pc')
    .map((c) => ({ id: c.id, name: c.name, imageUrl: c.imageUrl || '' }));
}

export function login(characterId, passcode) {
  const ch = getItem('characters', characterId);
  if (!ch || ch.type !== 'pc') return { ok: false, erro: 'Personagem não encontrado.' };

  const t = tentativas.get(characterId);
  if (t?.bloqueadoAte && t.bloqueadoAte > Date.now()) {
    const min = Math.ceil((t.bloqueadoAte - Date.now()) / 60000);
    return { ok: false, erro: `Muitas tentativas erradas — espere ${min} minuto(s) e tente de novo.` };
  }

  if (!ch.passcode) return { ok: false, erro: `O Mestre ainda não definiu uma senha para ${ch.name}.` };
  if (String(passcode || '') !== String(ch.passcode)) {
    const falhas = (t?.falhas || 0) + 1;
    tentativas.set(characterId, {
      falhas,
      bloqueadoAte: falhas >= MAX_TENTATIVAS ? Date.now() + BLOQUEIO_MS : (t?.bloqueadoAte ?? null),
    });
    return { ok: false, erro: 'Senha incorreta.' };
  }

  tentativas.delete(characterId);
  return { ok: true, character: { id: ch.id, name: ch.name } };
}

export function requireAuth(req, res, next) {
  if (!req.session?.characterId) return res.status(401).json({ error: 'not_authenticated' });
  next();
}

// A partir do id salvo na sessão, resolve o personagem — null se ele foi excluído (ou
// deixou de ser PC) depois do login, em vez de a sessão apontar pra um fantasma.
export function sessionCharacter(req) {
  const id = req.session?.characterId;
  if (!id) return null;
  const ch = getItem('characters', id);
  return ch && ch.type === 'pc' ? { id: ch.id, name: ch.name } : null;
}
