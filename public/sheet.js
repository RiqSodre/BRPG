// Ficha de personagem: as regras do 5e (modificador, bônus de proficiência, perícias) e
// o HTML da ficha somente-leitura. Vive fora do app.js porque a tela do Mestre e a dos
// jogadores mostram a MESMA ficha — se a tabela de perícias ou a conta do bônus fossem
// copiadas nos dois arquivos, uma hora as telas mostrariam números diferentes.
// Carregado antes de app.js e de mesa.js; usa o `esc` que cada uma delas define.

const ABILITIES = [
  { key: 'str', label: 'FOR' }, { key: 'dex', label: 'DES' }, { key: 'con', label: 'CON' },
  { key: 'int', label: 'INT' }, { key: 'wis', label: 'SAB' }, { key: 'cha', label: 'CAR' },
];

const SKILLS = [
  { key: 'athletics', label: 'Atletismo', ability: 'str' },
  { key: 'acrobatics', label: 'Acrobacia', ability: 'dex' },
  { key: 'sleightOfHand', label: 'Prestidigitação', ability: 'dex' },
  { key: 'stealth', label: 'Furtividade', ability: 'dex' },
  { key: 'arcana', label: 'Arcanismo', ability: 'int' },
  { key: 'history', label: 'História', ability: 'int' },
  { key: 'investigation', label: 'Investigação', ability: 'int' },
  { key: 'nature', label: 'Natureza', ability: 'int' },
  { key: 'religion', label: 'Religião', ability: 'int' },
  { key: 'animalHandling', label: 'Lidar com Animais', ability: 'wis' },
  { key: 'insight', label: 'Intuição', ability: 'wis' },
  { key: 'medicine', label: 'Medicina', ability: 'wis' },
  { key: 'perception', label: 'Percepção', ability: 'wis' },
  { key: 'survival', label: 'Sobrevivência', ability: 'wis' },
  { key: 'deception', label: 'Enganação', ability: 'cha' },
  { key: 'intimidation', label: 'Intimidação', ability: 'cha' },
  { key: 'performance', label: 'Atuação', ability: 'cha' },
  { key: 'persuasion', label: 'Persuasão', ability: 'cha' },
];

const ALIGNMENT_LABELS = {
  LB: 'Leal e Bom', NB: 'Neutro e Bom', CB: 'Caótico e Bom',
  LN: 'Leal e Neutro', N: 'Neutro', CN: 'Caótico e Neutro',
  LM: 'Leal e Mau', NM: 'Neutro e Mau', CM: 'Caótico e Mau',
};

const abilityMod = (score) => Math.floor((Number(score) - 10) / 2);
const fmtSigned = (n) => (n >= 0 ? `+${n}` : `${n}`);
const abilLabel = (key) => ABILITIES.find((a) => a.key === key)?.label || key;
const scoreOf = (ch, key) => Number(ch?.abilities?.[key]) || 10;
// Bônus de proficiência pelo nível — tabela padrão do 5e (1-4 → +2, 5-8 → +3, ...).
const profBonus = (level) => Math.floor((Math.max(1, Number(level) || 1) - 1) / 4) + 2;

// Total de um teste de resistência: modificador do atributo + proficiência, se treinado.
const saveTotal = (ch, key) => abilityMod(scoreOf(ch, key)) + (ch.saveProf?.[key] ? profBonus(ch.level) : 0);
// Idem para perícias, sobre o atributo a que a perícia responde.
const skillTotal = (ch, skill) => abilityMod(scoreOf(ch, skill.ability)) + (ch.skillProf?.[skill.key] ? profBonus(ch.level) : 0);
// Percepção passiva: 10 + o total de Percepção (a proficiência já entra por ali).
const passivePerception = (ch) => 10 + abilityMod(scoreOf(ch, 'wis')) + (ch.skillProf?.perception ? profBonus(ch.level) : 0);

const sheetFeatureHtml = (item, kind) => {
  const tag = kind === 'spell' ? (item.level ? `Nível ${item.level}` : 'Truque') : (item.source || '');
  const carta = kind === 'spell' && item.imageUrl
    ? `<a href="${esc(item.imageUrl)}" target="_blank" title="Ver carta em tamanho maior"><img class="sheet-feature-card" src="${esc(item.imageUrl)}" alt="Carta de ${esc(item.name)}" /></a>` : '';
  return `<div class="sheet-feature">${carta}<div class="sheet-feature-body"><b>${esc(item.name)}</b>${tag ? ` <span class="sheet-feature-tag">${esc(tag)}</span>` : ''}${item.description ? `<div class="sheet-feature-desc">${esc(item.description).replace(/\n/g, '<br>')}</div>` : ''}</div></div>`;
};

// Bloco de interpretação (traços/ideais/vínculos/defeitos) — só entra se tiver pelo menos
// um campo preenchido, pra não poluir fichas sem isso.
function sheetRoleplayHtml(ch) {
  const rows = [
    ['Traços de personalidade', ch.personalityTraits],
    ['Ideais', ch.ideals],
    ['Vínculos', ch.bonds],
    ['Defeitos', ch.flaws],
  ].filter(([, v]) => v);
  if (!ch.alignment && !rows.length) return '';
  return `
    <div class="sheet-col-title" style="margin-top:14px;">Interpretação${ch.alignment ? ` <span class="sheet-feature-tag">${esc(ALIGNMENT_LABELS[ch.alignment] || ch.alignment)}</span>` : ''}</div>
    ${rows.map(([label, v]) => `<div class="sheet-feature"><div class="sheet-feature-body"><b>${label}</b><div class="sheet-feature-desc">${esc(v).replace(/\n/g, '<br>')}</div></div></div>`).join('')}`;
}

// A ficha inteira em HTML. `opts.inventory` só faz sentido onde as linhas da mochila já
// vêm resolvidas com nome (a tela dos jogadores) — no painel do Mestre elas são só
// {itemId, qty} e sairiam em branco.
function characterSheetHtml(ch, opts = {}) {
  const isPc = ch.type === 'pc';
  const pb = profBonus(ch.level || 1);
  const dexMod = abilityMod(scoreOf(ch, 'dex'));

  const saveLines = ABILITIES.map((a) => {
    const prof = Boolean(ch.saveProf?.[a.key]);
    return `<div class="sheet-row${prof ? ' on' : ''}"><span class="dot"></span><span class="val">${fmtSigned(saveTotal(ch, a.key))}</span> ${a.label}</div>`;
  }).join('');

  const skillLines = SKILLS.map((s) => {
    const prof = Boolean(ch.skillProf?.[s.key]);
    return `<div class="sheet-row${prof ? ' on' : ''}"><span class="dot"></span><span class="val">${fmtSigned(skillTotal(ch, s))}</span> ${esc(s.label)} <span class="abbr">(${abilLabel(s.ability)})</span></div>`;
  }).join('');

  const hpFrac = ch.maxHp > 0 ? Math.max(0, Math.min(1, (ch.hp ?? 0) / ch.maxHp)) : null;
  const initials = (ch.name || '?').trim().slice(0, 1).toUpperCase();
  const temPv = ch.maxHp != null || ch.hp != null;
  const inventario = opts.inventory ? (ch.inventory || []) : [];

  return `
    <div class="sheet-header">
      ${ch.imageUrl
        ? `<img class="sheet-portrait" src="${esc(ch.imageUrl)}" alt="${esc(ch.name)}" onerror="this.classList.add('placeholder');this.removeAttribute('src');this.textContent='${esc(initials)}';" />`
        : `<div class="sheet-portrait placeholder">${esc(initials)}</div>`}
      <div class="sheet-title">
        <h4>${esc(ch.name)}</h4>
        <div class="sheet-subtitle">${esc([ch.race, ch.klass, ch.subclass, ch.level ? `nível ${ch.level}` : ''].filter(Boolean).join(' · ')) || '—'}${isPc && ch.player ? ` · joga ${esc(ch.player)}` : ''}</div>
      </div>
    </div>
    <div class="sheet-stats">
      <div class="sheet-stat ac"><div class="sheet-stat-label">CA</div><div class="sheet-stat-val">${esc(ch.ac ?? '—')}</div></div>
      ${temPv ? `<div class="sheet-stat hp">
        <div class="sheet-stat-label">PV</div>
        <div class="sheet-stat-val">${esc(ch.hp ?? '?')}/${esc(ch.maxHp ?? '?')}</div>
        ${hpFrac !== null ? `<div class="hp-bar"><span style="width:${hpFrac * 100}%;background:${hpFrac > 0.5 ? '#4a9d6f' : hpFrac > 0.25 ? '#b8925a' : '#c05650'}"></span></div>` : ''}
      </div>` : ''}
      <div class="sheet-stat"><div class="sheet-stat-label">Iniciativa</div><div class="sheet-stat-val">${fmtSigned(dexMod)}</div></div>
      <div class="sheet-stat"><div class="sheet-stat-label">Prof.</div><div class="sheet-stat-val">${fmtSigned(pb)}</div></div>
      <div class="sheet-stat"><div class="sheet-stat-label">Perc. passiva</div><div class="sheet-stat-val">${passivePerception(ch)}</div></div>
    </div>
    <div class="sheet-abilities">
      ${ABILITIES.map((a) => `
        <div class="sheet-abil">
          <div class="sheet-abil-label">${a.label}</div>
          <div class="sheet-abil-mod">${fmtSigned(abilityMod(scoreOf(ch, a.key)))}</div>
          <div class="sheet-abil-score">${scoreOf(ch, a.key)}</div>
        </div>`).join('')}
    </div>
    <div class="sheet-cols">
      <div class="sheet-col">
        <div class="sheet-col-title">Testes de resistência</div>
        ${saveLines}
      </div>
      <div class="sheet-col">
        <div class="sheet-col-title">Perícias</div>
        ${skillLines}
      </div>
    </div>
    ${(ch.features || []).length ? `
      <div class="sheet-col-title" style="margin-top:14px;">Habilidades e Características</div>
      ${ch.features.map((f) => sheetFeatureHtml(f, 'feature')).join('')}` : ''}
    ${(ch.spells || []).length ? `
      <div class="sheet-col-title" style="margin-top:14px;">Magias</div>
      ${ch.spells.map((s) => sheetFeatureHtml(s, 'spell')).join('')}` : ''}
    ${inventario.length ? `
      <div class="sheet-col-title" style="margin-top:14px;">Mochila</div>
      ${inventario.map((l) => sheetFeatureHtml({ name: `${l.name} ×${l.qty}`, source: l.rarity || l.type || '', description: l.description }, 'feature')).join('')}` : ''}
    ${sheetRoleplayHtml(ch)}
    ${ch.description ? `<div class="sheet-desc">${esc(ch.description).replace(/\n/g, '<br>')}</div>` : ''}`;
}
