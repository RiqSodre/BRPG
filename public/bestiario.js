// Bestiário integrado ao painel do Mestre
let bestiariumState = {
  allMonsters: [],
  filteredMonsters: [],
  currentPage: 1,
  monstersPerPage: 12,
  searchQuery: '',
  initialized: false,
};

async function initBestiario() {
  if (bestiariumState.initialized) return;

  const tabContent = $('#tab-bestiario');
  if (!tabContent) return;

  try {
    const response = await fetch('/api/srd/monsters');
    if (!response.ok) throw new Error(`Erro: ${response.status}`);
    const monsters = await response.json();

    bestiariumState.allMonsters = monsters.sort((a, b) => a.name.localeCompare(b.name));
    bestiariumState.filteredMonsters = bestiariumState.allMonsters;
    bestiariumState.initialized = true;

    renderBestiario();
  } catch (error) {
    console.error('Erro ao carregar bestiário:', error);
    $('#tab-bestiario').innerHTML = `<div class="error">Erro ao carregar o bestiário. Tente recarregar a página.</div>`;
  }
}

function renderBestiario() {
  const tabContent = $('#tab-bestiario');
  if (!tabContent) return;

  const { filteredMonsters, currentPage, monstersPerPage, searchQuery } = bestiariumState;

  if (filteredMonsters.length === 0 && searchQuery) {
    tabContent.innerHTML = `
      <div style="padding: 20px; text-align: center; color: var(--muted);">
        Nenhum monstro encontrado para "${escapeHtml(searchQuery)}"
      </div>
    `;
    return;
  }

  if (filteredMonsters.length === 0) {
    tabContent.innerHTML = `
      <div style="padding: 20px; text-align: center; color: var(--muted);">
        Carregando monstros...
      </div>
    `;
    return;
  }

  const totalPages = Math.ceil(filteredMonsters.length / monstersPerPage);
  const startIdx = (currentPage - 1) * monstersPerPage;
  const endIdx = Math.min(startIdx + monstersPerPage, filteredMonsters.length);
  const paginatedMonsters = filteredMonsters.slice(startIdx, endIdx);

  const html = `
    <div style="display: flex; flex-direction: column; gap: 20px; height: 100%;">
      <div style="display: flex; gap: 16px; align-items: center; flex-wrap: wrap;">
        <h3 style="margin: 0; color: var(--accent2); font-size: 18px;">Bestiário D&D 5e</h3>
        <div style="display: flex; gap: 8px; flex: 1; min-width: 250px;">
          <input
            type="text"
            id="bestiario-search"
            placeholder="Procurar monstro..."
            style="flex: 1; padding: 8px 12px; background: var(--bg3); border: 1px solid var(--border); border-radius: 6px; color: var(--text); font-size: 14px;"
            value="${escapeHtml(searchQuery)}"
          />
          <button id="bestiario-btn-search" class="btn small" style="padding: 8px 14px;">🔍</button>
        </div>
      </div>

      <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; flex: 1; overflow-y: auto; padding-right: 8px;">
        ${paginatedMonsters.map(monster => `
          <div onclick="openBestiariumMonsterDetail('${encodeURIComponent(monster.index)}')" style="background: var(--bg2); border: 1px solid var(--border); border-radius: 8px; padding: 16px; cursor: pointer; transition: all 0.2s; display: flex; flex-direction: column; gap: 12px;" onmouseover="this.style.borderColor='var(--accent)'; this.style.background='var(--bg3)'" onmouseout="this.style.borderColor='var(--border)'; this.style.background='var(--bg2)'">
            <div style="display: flex; justify-content: space-between; align-items: start; gap: 8px;">
              <div style="font-size: 16px; font-weight: 600; color: var(--accent2); flex: 1;">${escapeHtml(monster.name)}</div>
              <div style="font-size: 12px; color: var(--muted); background: var(--bg3); padding: 2px 8px; border-radius: 4px; white-space: nowrap;">${formatSize(monster.size)}</div>
            </div>
            <div style="font-size: 13px; color: var(--muted);">${escapeHtml(monster.type)}</div>
            ${monster.armor_class ? `
              <div style="display: flex; gap: 16px; font-size: 13px;">
                <div><span style="color: var(--muted);">CA:</span> <span style="color: var(--accent); font-weight: 600;">${monster.armor_class}</span></div>
                ${monster.hit_points ? `<div><span style="color: var(--muted);">PV:</span> <span style="color: var(--accent); font-weight: 600;">${monster.hit_points}</span></div>` : ''}
              </div>
            ` : ''}
            ${monster.alignment ? `<div style="font-size: 12px; color: var(--muted); padding-top: 8px; border-top: 1px solid var(--border);">${escapeHtml(monster.alignment)}</div>` : ''}
          </div>
        `).join('')}
      </div>

      <div style="display: flex; justify-content: space-between; align-items: center; padding-top: 16px; border-top: 1px solid var(--border); flex-wrap: wrap; gap: 16px;">
        <div style="color: var(--muted); font-size: 13px;">Mostrando ${startIdx + 1}-${endIdx} de ${filteredMonsters.length} monstros</div>
        <div style="display: flex; justify-content: center; align-items: center; gap: 8px; flex-wrap: wrap;">
          <button onclick="bestiariumGoToPage(1)" class="btn small" ${currentPage === 1 ? 'disabled' : ''}>« Primeira</button>
          <button onclick="bestiariumPreviousPage()" class="btn small" ${currentPage === 1 ? 'disabled' : ''}>‹ Anterior</button>

          ${renderBestiariumPageNumbers(totalPages)}

          <button onclick="bestiariumNextPage()" class="btn small" ${currentPage === totalPages ? 'disabled' : ''}>Próxima ›</button>
          <button onclick="bestiariumGoToPage(${totalPages})" class="btn small" ${currentPage === totalPages ? 'disabled' : ''}>Última »</button>
        </div>
      </div>
    </div>
  `;

  tabContent.innerHTML = html;

  // Adiciona event listeners
  const searchInput = $('#bestiario-search');
  const searchBtn = $('#bestiario-btn-search');

  if (searchInput && searchBtn) {
    searchInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') bestiariumSearch();
    });
    searchBtn.addEventListener('click', bestiariumSearch);
  }
}

function renderBestiariumPageNumbers(totalPages) {
  const { currentPage } = bestiariumState;
  const maxButtons = 5;
  let startPage = Math.max(1, currentPage - Math.floor(maxButtons / 2));
  let endPage = Math.min(totalPages, startPage + maxButtons - 1);

  if (endPage - startPage + 1 < maxButtons) {
    startPage = Math.max(1, endPage - maxButtons + 1);
  }

  let html = '';
  if (startPage > 1) {
    html += '<span style="color: var(--muted); font-size: 13px;">...</span>';
  }

  for (let i = startPage; i <= endPage; i++) {
    const isActive = i === currentPage;
    html += `
      <button onclick="bestiariumGoToPage(${i})" class="btn small" style="${isActive ? 'background: var(--accent); color: #fff; font-weight: 600;' : ''}">
        ${i}
      </button>
    `;
  }

  if (endPage < totalPages) {
    html += '<span style="color: var(--muted); font-size: 13px;">...</span>';
  }

  return html;
}

function bestiariumSearch() {
  bestiariumState.searchQuery = ($('#bestiario-search')?.value || '').trim().toLowerCase();

  if (bestiariumState.searchQuery) {
    bestiariumState.filteredMonsters = bestiariumState.allMonsters.filter(m =>
      m.name.toLowerCase().includes(bestiariumState.searchQuery) ||
      (m.type && m.type.toLowerCase().includes(bestiariumState.searchQuery)) ||
      (m.alignment && m.alignment.toLowerCase().includes(bestiariumState.searchQuery))
    );
  } else {
    bestiariumState.filteredMonsters = bestiariumState.allMonsters;
  }

  bestiariumState.currentPage = 1;
  renderBestiario();
}

function bestiariumGoToPage(page) {
  bestiariumState.currentPage = page;
  renderBestiario();
}

function bestiariumNextPage() {
  const totalPages = Math.ceil(bestiariumState.filteredMonsters.length / bestiariumState.monstersPerPage);
  if (bestiariumState.currentPage < totalPages) {
    bestiariumGoToPage(bestiariumState.currentPage + 1);
  }
}

function bestiariumPreviousPage() {
  if (bestiariumState.currentPage > 1) {
    bestiariumGoToPage(bestiariumState.currentPage - 1);
  }
}

async function openBestiariumMonsterDetail(index) {
  try {
    const encodedIndex = decodeURIComponent(index);
    const response = await fetch(`/api/srd/monsters/${encodedIndex}`);
    if (!response.ok) throw new Error(`Erro: ${response.status}`);
    const monster = await response.json();

    let translation = null;
    try {
      const translationResponse = await fetch(`/api/srd/monsters/${encodedIndex}/translate`);
      if (translationResponse.ok) {
        translation = await translationResponse.json();
      }
    } catch (e) {
      // Ignora erro de tradução
    }

    showModal(formatBestiariumMonsterDetail(monster, translation));
  } catch (error) {
    console.error('Erro ao carregar detalhe do monstro:', error);
    showModal('<div class="error" style="text-align: center; padding: 20px;">Erro ao carregar os detalhes do monstro.</div>');
  }
}

function formatBestiariumMonsterDetail(monster, translation) {
  const blocks = translation?.blocks || {};

  const getAbilityMod = (score) => Math.floor((score - 10) / 2);
  const formatAbility = (score) => {
    if (score === undefined || score === null) return '-';
    const mod = getAbilityMod(score);
    const sign = mod > 0 ? '+' : '';
    return `${score} (${sign}${mod})`;
  };

  const getAbilityScore = (name) => {
    const abilityMap = {
      'STR': monster.strength,
      'DEX': monster.dexterity,
      'CON': monster.constitution,
      'INT': monster.intelligence,
      'WIS': monster.wisdom,
      'CHA': monster.charisma,
    };
    return abilityMap[name] || 10;
  };

  const renderAction = (action, label) => {
    if (!action) return '';
    const name = escapeHtml(action.name || '');
    const desc = escapeHtml(action.desc || '');
    return `
      <div style="margin-bottom: 8px;">
        <div style="font-weight: 600; color: var(--accent);">${name}${label ? ` ${label}` : ''}</div>
        <div>${desc}</div>
      </div>
    `;
  };

  return `
    <div style="max-height: 80vh; overflow-y: auto; padding: 20px;">
      <div style="display: flex; justify-content: space-between; align-items: start; gap: 16px; margin-bottom: 16px; padding-bottom: 16px; border-bottom: 1px solid var(--border);">
        <div>
          <div style="font-size: 24px; font-weight: 700; color: var(--accent2);">${escapeHtml(monster.name)}</div>
          <div style="font-size: 14px; color: var(--muted);">${escapeHtml(monster.size)} ${escapeHtml(monster.type)}, ${escapeHtml(monster.alignment)}</div>
        </div>
      </div>

      <div style="margin: 16px 0;">
        <div style="font-size: 14px; font-weight: 600; color: var(--accent2); margin-bottom: 8px;">Atributos</div>
        <div style="display: flex; gap: 16px; font-size: 13px;">
          <div><span style="color: var(--muted);">CA:</span> <span style="color: var(--accent); font-weight: 600;">${monster.armor_class}</span></div>
          <div><span style="color: var(--muted);">PV:</span> <span style="color: var(--accent); font-weight: 600;">${monster.hit_points}</span></div>
          ${monster.speed ? `
            <div><span style="color: var(--muted);">Deslocamento:</span> <span style="color: var(--accent); font-weight: 600;">${escapeHtml(typeof monster.speed === 'string' ? monster.speed : formatSpeed(monster.speed))}</span></div>
          ` : ''}
        </div>
      </div>

      <div style="margin: 16px 0;">
        <div style="display: grid; grid-template-columns: repeat(6, 1fr); gap: 12px;">
          ${['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'].map(ab => `
            <div style="background: var(--bg3); padding: 8px 12px; border-radius: 6px; text-align: center;">
              <div style="font-size: 18px; font-weight: 700; color: var(--accent);">${formatAbility(getAbilityScore(ab))}</div>
              <div style="font-size: 11px; color: var(--muted); margin-top: 4px;">${ab}</div>
            </div>
          `).join('')}
        </div>
      </div>

      ${monster.saving_throws ? `
        <div style="margin: 16px 0;">
          <div style="font-size: 14px; font-weight: 600; color: var(--accent2); margin-bottom: 8px;">Testes de Resistência</div>
          <div style="font-size: 13px; color: var(--text);">${escapeHtml(formatSavingThrows(monster.saving_throws))}</div>
        </div>
      ` : ''}

      ${monster.skills ? `
        <div style="margin: 16px 0;">
          <div style="font-size: 14px; font-weight: 600; color: var(--accent2); margin-bottom: 8px;">Perícias</div>
          <div style="font-size: 13px; color: var(--text);">${escapeHtml(formatSkills(monster.skills))}</div>
        </div>
      ` : ''}

      ${monster.damage_resistances ? `
        <div style="margin: 16px 0;">
          <div style="font-size: 14px; font-weight: 600; color: var(--accent2); margin-bottom: 8px;">Resistências de Dano</div>
          <div style="font-size: 13px; color: var(--text);">${escapeHtml(monster.damage_resistances)}</div>
        </div>
      ` : ''}

      ${monster.condition_immunities ? `
        <div style="margin: 16px 0;">
          <div style="font-size: 14px; font-weight: 600; color: var(--accent2); margin-bottom: 8px;">Imunidades a Condições</div>
          <div style="font-size: 13px; color: var(--text);">${escapeHtml(monster.condition_immunities)}</div>
        </div>
      ` : ''}

      ${monster.senses ? `
        <div style="margin: 16px 0;">
          <div style="font-size: 14px; font-weight: 600; color: var(--accent2); margin-bottom: 8px;">Sentidos</div>
          <div style="font-size: 13px; color: var(--text);">${escapeHtml(monster.senses)}</div>
        </div>
      ` : ''}

      ${monster.languages ? `
        <div style="margin: 16px 0;">
          <div style="font-size: 14px; font-weight: 600; color: var(--accent2); margin-bottom: 8px;">Idiomas</div>
          <div style="font-size: 13px; color: var(--text);">${escapeHtml(monster.languages)}</div>
        </div>
      ` : ''}

      ${monster.challenge ? `
        <div style="margin: 16px 0;">
          <div style="font-size: 14px; font-weight: 600; color: var(--accent2); margin-bottom: 8px;">Desafio</div>
          <div style="font-size: 13px; color: var(--text);">${monster.challenge} (${monster.experience_points} XP)</div>
        </div>
      ` : ''}

      ${(blocks.special_abilities && blocks.special_abilities.length > 0) ? `
        <div style="margin: 16px 0;">
          <div style="font-size: 14px; font-weight: 600; color: var(--accent2); margin-bottom: 8px;">Habilidades Especiais</div>
          <div style="font-size: 13px; color: var(--text);">
            ${blocks.special_abilities.map(a => renderAction(a)).join('')}
          </div>
        </div>
      ` : ''}

      ${(blocks.actions && blocks.actions.length > 0) ? `
        <div style="margin: 16px 0;">
          <div style="font-size: 14px; font-weight: 600; color: var(--accent2); margin-bottom: 8px;">Ações</div>
          <div style="font-size: 13px; color: var(--text);">
            ${blocks.actions.map(a => renderAction(a)).join('')}
          </div>
        </div>
      ` : ''}

      ${(blocks.reactions && blocks.reactions.length > 0) ? `
        <div style="margin: 16px 0;">
          <div style="font-size: 14px; font-weight: 600; color: var(--accent2); margin-bottom: 8px;">Reações</div>
          <div style="font-size: 13px; color: var(--text);">
            ${blocks.reactions.map(a => renderAction(a)).join('')}
          </div>
        </div>
      ` : ''}

      ${(blocks.legendary_actions && blocks.legendary_actions.length > 0) ? `
        <div style="margin: 16px 0;">
          <div style="font-size: 14px; font-weight: 600; color: var(--accent2); margin-bottom: 8px;">Ações Lendárias</div>
          <div style="font-size: 13px; color: var(--text);">
            ${blocks.legendary_actions.map(a => renderAction(a)).join('')}
          </div>
        </div>
      ` : ''}
    </div>
  `;
}

function formatSpeed(speedObj) {
  if (typeof speedObj === 'string') return speedObj;
  const parts = [];
  for (const [key, val] of Object.entries(speedObj)) {
    if (key !== 'walk') parts.push(`${key}: ${val}`);
    else parts.unshift(`${val}`);
  }
  return parts.join(', ') + ' pés';
}

function formatSize(size) {
  const sizeMap = {
    'tiny': 'Ínfimo',
    'small': 'Pequeno',
    'medium': 'Médio',
    'large': 'Grande',
    'huge': 'Imenso',
    'gargantuan': 'Colossal',
  };
  return sizeMap[size?.toLowerCase()] || size;
}

function formatSavingThrows(st) {
  return Object.entries(st)
    .map(([k, v]) => `${k.toUpperCase()} +${v}`)
    .join(', ');
}

function formatSkills(skills) {
  return Object.entries(skills)
    .map(([k, v]) => `${k} +${v}`)
    .join(', ');
}

function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return String(text).replace(/[&<>"']/g, (m) => map[m]);
}
