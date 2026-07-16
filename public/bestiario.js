// Utilitários
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// Estado
let allMonsters = [];
let filteredMonsters = [];
let currentPage = 1;
const monstersPerPage = 12;
let searchQuery = '';

async function loadMonsters() {
  try {
    const response = await fetch('/api/srd/monsters');
    if (!response.ok) throw new Error(`Erro: ${response.status}`);
    const monsters = await response.json();
    allMonsters = monsters.sort((a, b) => a.name.localeCompare(b.name));
    filteredMonsters = allMonsters;
    currentPage = 1;
    render();
  } catch (error) {
    console.error('Erro ao carregar monstros:', error);
    showError('Erro ao carregar o bestiário. Tente recarregar a página.');
  }
}

function showError(message) {
  $('#bestiario-content').innerHTML = `<div class="error">${message}</div>`;
}

function search() {
  searchQuery = $('#search-input').value.trim().toLowerCase();

  if (searchQuery) {
    filteredMonsters = allMonsters.filter(m =>
      m.name.toLowerCase().includes(searchQuery) ||
      (m.type && m.type.toLowerCase().includes(searchQuery)) ||
      (m.alignment && m.alignment.toLowerCase().includes(searchQuery))
    );
  } else {
    filteredMonsters = allMonsters;
  }

  currentPage = 1;
  render();
}

function render() {
  if (filteredMonsters.length === 0 && searchQuery) {
    $('#bestiario-content').innerHTML = `
      <div class="empty-state">
        <p>Nenhum monstro encontrado para "${searchQuery}"</p>
      </div>
    `;
    return;
  }

  if (filteredMonsters.length === 0) {
    $('#bestiario-content').innerHTML = `
      <div class="empty-state">
        <p>Carregando monstros...</p>
      </div>
    `;
    return;
  }

  const totalPages = Math.ceil(filteredMonsters.length / monstersPerPage);
  const startIdx = (currentPage - 1) * monstersPerPage;
  const endIdx = Math.min(startIdx + monstersPerPage, filteredMonsters.length);
  const paginatedMonsters = filteredMonsters.slice(startIdx, endIdx);

  const html = `
    <div class="bestiario-list">
      ${paginatedMonsters.map(monster => `
        <div class="monster-card" onclick="showMonsterDetail('${encodeURIComponent(monster.index)}')">
          <div class="monster-header">
            <div class="monster-name">${escapeHtml(monster.name)}</div>
            <div class="monster-size">${formatSize(monster.size)}</div>
          </div>
          <div class="monster-type">${escapeHtml(monster.type)}</div>
          ${monster.armor_class ? `
            <div class="monster-ac-hp">
              <div class="monster-stat">
                <span class="monster-stat-label">CA:</span>
                <span class="monster-stat-value">${monster.armor_class}</span>
              </div>
              ${monster.hit_points ? `
                <div class="monster-stat">
                  <span class="monster-stat-label">PV:</span>
                  <span class="monster-stat-value">${monster.hit_points}</span>
                </div>
              ` : ''}
            </div>
          ` : ''}
          ${monster.alignment ? `
            <div class="monster-alignment">${escapeHtml(monster.alignment)}</div>
          ` : ''}
        </div>
      `).join('')}
    </div>

    <div class="pagination-container">
      <div class="pagination-info">
        Mostrando ${startIdx + 1}-${endIdx} de ${filteredMonsters.length} monstros
      </div>
      <div class="bestiario-pagination">
        <button class="pagination-btn" onclick="goToPage(1)" ${currentPage === 1 ? 'disabled' : ''}>« Primeira</button>
        <button class="pagination-btn" onclick="previousPage()" ${currentPage === 1 ? 'disabled' : ''}>‹ Anterior</button>

        ${renderPageNumbers(totalPages)}

        <button class="pagination-btn" onclick="nextPage()" ${currentPage === totalPages ? 'disabled' : ''}>Próxima ›</button>
        <button class="pagination-btn" onclick="goToPage(${totalPages})" ${currentPage === totalPages ? 'disabled' : ''}>Última »</button>
      </div>
    </div>
  `;

  $('#bestiario-content').innerHTML = html;
}

function renderPageNumbers(totalPages) {
  const maxButtons = 5;
  let startPage = Math.max(1, currentPage - Math.floor(maxButtons / 2));
  let endPage = Math.min(totalPages, startPage + maxButtons - 1);

  if (endPage - startPage + 1 < maxButtons) {
    startPage = Math.max(1, endPage - maxButtons + 1);
  }

  let html = '';
  if (startPage > 1) {
    html += '<span class="pagination-info">...</span>';
  }

  for (let i = startPage; i <= endPage; i++) {
    html += `
      <button class="pagination-btn ${i === currentPage ? 'active' : ''}" onclick="goToPage(${i})">
        ${i}
      </button>
    `;
  }

  if (endPage < totalPages) {
    html += '<span class="pagination-info">...</span>';
  }

  return html;
}

function goToPage(page) {
  currentPage = page;
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function nextPage() {
  const totalPages = Math.ceil(filteredMonsters.length / monstersPerPage);
  if (currentPage < totalPages) {
    goToPage(currentPage + 1);
  }
}

function previousPage() {
  if (currentPage > 1) {
    goToPage(currentPage - 1);
  }
}

async function showMonsterDetail(index) {
  try {
    const encodedIndex = decodeURIComponent(index);
    const response = await fetch(`/api/srd/monsters/${encodedIndex}`);
    if (!response.ok) throw new Error(`Erro: ${response.status}`);
    const monster = await response.json();

    // Tenta carregar a tradução
    let translation = null;
    try {
      const translationResponse = await fetch(`/api/srd/monsters/${encodedIndex}/translate`);
      if (translationResponse.ok) {
        translation = await translationResponse.json();
      }
    } catch (e) {
      // Ignora erro de tradução
    }

    showModal(formatMonsterDetail(monster, translation));
  } catch (error) {
    console.error('Erro ao carregar detalhe do monstro:', error);
    showModal('<div class="error">Erro ao carregar os detalhes do monstro.</div>');
  }
}

function formatMonsterDetail(monster, translation) {
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
      <div class="monster-trait">
        <div class="monster-trait-name">${name}${label ? ` ${label}` : ''}</div>
        <div>${desc}</div>
      </div>
    `;
  };

  return `
    <div class="monster-modal">
      <div class="monster-detail-header">
        <div>
          <div class="monster-detail-name">${escapeHtml(monster.name)}</div>
          <div class="monster-detail-type">${escapeHtml(monster.size)} ${escapeHtml(monster.type)}, ${escapeHtml(monster.alignment)}</div>
        </div>
      </div>

      <div class="monster-section">
        <div class="monster-section-title">Atributos</div>
        <div class="monster-ac-hp">
          <div class="monster-stat">
            <span class="monster-stat-label">CA:</span>
            <span class="monster-stat-value">${monster.armor_class}</span>
          </div>
          <div class="monster-stat">
            <span class="monster-stat-label">PV:</span>
            <span class="monster-stat-value">${monster.hit_points}</span>
          </div>
          ${monster.speed ? `
            <div class="monster-stat">
              <span class="monster-stat-label">Deslocamento:</span>
              <span class="monster-stat-value">${escapeHtml(typeof monster.speed === 'string' ? monster.speed : formatSpeed(monster.speed))}</span>
            </div>
          ` : ''}
        </div>
      </div>

      <div class="monster-section">
        <div class="monster-stats-grid">
          ${['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'].map(ab => `
            <div class="monster-ability">
              <div class="monster-ability-value">${formatAbility(getAbilityScore(ab))}</div>
              <div class="monster-ability-label">${ab}</div>
            </div>
          `).join('')}
        </div>
      </div>

      ${monster.saving_throws ? `
        <div class="monster-section">
          <div class="monster-section-title">Testes de Resistência</div>
          <div class="monster-section-content">${escapeHtml(formatSavingThrows(monster.saving_throws))}</div>
        </div>
      ` : ''}

      ${monster.skills ? `
        <div class="monster-section">
          <div class="monster-section-title">Perícias</div>
          <div class="monster-section-content">${escapeHtml(formatSkills(monster.skills))}</div>
        </div>
      ` : ''}

      ${monster.damage_resistances ? `
        <div class="monster-section">
          <div class="monster-section-title">Resistências de Dano</div>
          <div class="monster-section-content">${escapeHtml(monster.damage_resistances)}</div>
        </div>
      ` : ''}

      ${monster.condition_immunities ? `
        <div class="monster-section">
          <div class="monster-section-title">Imunidades a Condições</div>
          <div class="monster-section-content">${escapeHtml(monster.condition_immunities)}</div>
        </div>
      ` : ''}

      ${monster.senses ? `
        <div class="monster-section">
          <div class="monster-section-title">Sentidos</div>
          <div class="monster-section-content">${escapeHtml(monster.senses)}</div>
        </div>
      ` : ''}

      ${monster.languages ? `
        <div class="monster-section">
          <div class="monster-section-title">Idiomas</div>
          <div class="monster-section-content">${escapeHtml(monster.languages)}</div>
        </div>
      ` : ''}

      ${monster.challenge ? `
        <div class="monster-section">
          <div class="monster-section-title">Desafio</div>
          <div class="monster-section-content">${monster.challenge} (${monster.experience_points} XP)</div>
        </div>
      ` : ''}

      ${(blocks.special_abilities && blocks.special_abilities.length > 0) ? `
        <div class="monster-section">
          <div class="monster-section-title">Habilidades Especiais</div>
          <div class="monster-section-content">
            ${blocks.special_abilities.map(a => renderAction(a)).join('')}
          </div>
        </div>
      ` : ''}

      ${(blocks.actions && blocks.actions.length > 0) ? `
        <div class="monster-section">
          <div class="monster-section-title">Ações</div>
          <div class="monster-section-content">
            ${blocks.actions.map(a => renderAction(a)).join('')}
          </div>
        </div>
      ` : ''}

      ${(blocks.reactions && blocks.reactions.length > 0) ? `
        <div class="monster-section">
          <div class="monster-section-title">Reações</div>
          <div class="monster-section-content">
            ${blocks.reactions.map(a => renderAction(a)).join('')}
          </div>
        </div>
      ` : ''}

      ${(blocks.legendary_actions && blocks.legendary_actions.length > 0) ? `
        <div class="monster-section">
          <div class="monster-section-title">Ações Lendárias</div>
          <div class="monster-section-content">
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

function showModal(content) {
  const modal = $('#modal');
  modal.innerHTML = content;
  $('#modal-backdrop').classList.remove('hidden');

  $('#modal-backdrop').onclick = (e) => {
    if (e.target === $('#modal-backdrop')) {
      closeModal();
    }
  };
}

function closeModal() {
  $('#modal-backdrop').classList.add('hidden');
  $('#modal').innerHTML = '';
}

// Event Listeners
document.addEventListener('DOMContentLoaded', () => {
  loadMonsters();

  $('#search-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') search();
  });

  $('#btn-search').addEventListener('click', search);

  // Fechar modal ao pressionar Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('#modal-backdrop').classList.contains('hidden')) {
      closeModal();
    }
  });
});
