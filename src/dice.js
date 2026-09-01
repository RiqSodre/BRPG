// Rolagem de dados: usada pelo painel do Mestre (barra de topo, painel de dados 3D) e
// pelo endpoint /api/roll. Não depende de nada além de si mesma.
export function rollDice(expr) {
  const clean = String(expr).toLowerCase().replace(/\s/g, '');
  const m = clean.match(/^(\d*)d(\d+)(?:([+-])(\d+))?$/);
  if (!m) return { error: 'Formato inválido. Use algo como 1d20+5 ou 2d6.' };
  const count = Math.min(parseInt(m[1] || '1', 10), 100);
  const sides = Math.min(parseInt(m[2], 10), 1000);
  const mod = m[3] ? (m[3] === '-' ? -1 : 1) * parseInt(m[4], 10) : 0;
  if (count < 1 || sides < 2) return { error: 'Dados inválidos.' };
  const rolls = Array.from({ length: count }, () => 1 + Math.floor(Math.random() * sides));
  const total = rolls.reduce((a, b) => a + b, 0) + mod;
  const detail = `[${rolls.join(', ')}]${mod ? (mod > 0 ? ` + ${mod}` : ` - ${-mod}`) : ''}`;
  return { rolls, mod, total, detail };
}
