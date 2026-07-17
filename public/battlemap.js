// Renderizador do mapa de batalha — usado pelo painel do Mestre e pela tela dos jogadores.
// O mapa vive num "espaço de grid": cada quadrado tem CELL pixels. A câmera (pan/zoom) é só visual.
const CELL = 64;

const imgCache = new Map();
function loadImg(src, onLoad) {
  if (!src) return null;
  if (imgCache.has(src)) return imgCache.get(src);
  const img = new Image();
  img.onload = onLoad;
  img.onerror = () => imgCache.set(src, null);
  img.src = src;
  imgCache.set(src, img);
  return img;
}

const KIND_COLOR = { pc: '#4ade80', npc: '#c4a747', enemy: '#e05252' };

// ---------- Efeitos visuais de combate (elementais) ----------
// Cada preset define cor, quantas partículas, se sobem (up) ou explodem (burst),
// o emoji que "estoura" no centro e adornos (anel de choque, raio).
const FX_PRESETS = {
  fire:      { emoji: '🔥', color: '#ff6a1a', color2: '#ffd21a', dur: 900,  n: 22, spread: 'up',    ring: false, glow: true },
  ice:       { emoji: '❄️', color: '#7fd8ff', color2: '#eaffff', dur: 1000, n: 16, spread: 'burst', ring: true },
  lightning: { emoji: '⚡', color: '#fff45e', color2: '#bcd0ff', dur: 700,  n: 8,  spread: 'burst', bolt: true },
  holy:      { emoji: '✨', color: '#ffe58a', color2: '#fffbe0', dur: 1100, n: 18, spread: 'up',    ring: true, glow: true },
  poison:    { emoji: '☠️', color: '#8fd14f', color2: '#d6f5a0', dur: 1100, n: 16, spread: 'up',    glow: true },
  impact:    { emoji: '💥', color: '#ff5252', color2: '#ffffff', dur: 650,  n: 14, spread: 'burst', ring: true },
  heal:      { emoji: '💚', color: '#4ade80', color2: '#eaffea', dur: 1000, n: 14, spread: 'up',    ring: true, glow: true },
};

// Sons sintetizados no navegador (Web Audio) — tocam na tela do Mestre e na dos jogadores,
// sem precisar de arquivos. O contexto só "acorda" após um gesto do usuário (regra dos browsers).
const FxAudio = (() => {
  let ac = null;
  const ctx = () => {
    if (!ac) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try { ac = new AC(); } catch { return null; }
    }
    if (ac.state === 'suspended') ac.resume().catch(() => {});
    return ac;
  };
  // Desbloqueia o áudio no primeiro toque/tecla de quem estiver assistindo.
  const unlock = () => ctx();
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);

  const tone = (freq, t0, dur, { type = 'sine', gain = 0.2, slideTo = null } = {}) => {
    const a = ctx(); if (!a) return;
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(a.destination);
    o.start(t0); o.stop(t0 + dur + 0.03);
  };
  const noise = (t0, dur, { gain = 0.2, lp = 2000, hp = 100, slideLp = null } = {}) => {
    const a = ctx(); if (!a) return;
    const n = Math.floor(a.sampleRate * dur);
    const buf = a.createBuffer(1, n, a.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    const src = a.createBufferSource(); src.buffer = buf;
    const g = a.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    const lpf = a.createBiquadFilter(); lpf.type = 'lowpass'; lpf.frequency.setValueAtTime(lp, t0);
    if (slideLp) lpf.frequency.exponentialRampToValueAtTime(slideLp, t0 + dur);
    const hpf = a.createBiquadFilter(); hpf.type = 'highpass'; hpf.frequency.value = hp;
    src.connect(hpf).connect(lpf).connect(g).connect(a.destination);
    src.start(t0); src.stop(t0 + dur + 0.03);
  };

  const play = (kind) => {
    const a = ctx(); if (!a) return;
    const t = a.currentTime;
    switch (kind) {
      case 'fire':
        noise(t, 0.5, { gain: 0.16, lp: 1600, slideLp: 380, hp: 150 });
        tone(180, t, 0.4, { type: 'sawtooth', gain: 0.05, slideTo: 70 });
        break;
      case 'ice':
        tone(1400, t, 0.5, { type: 'triangle', gain: 0.1, slideTo: 2300 });
        tone(1950, t + 0.05, 0.4, { type: 'sine', gain: 0.07 });
        noise(t, 0.14, { gain: 0.05, hp: 4200, lp: 9000 });
        break;
      case 'lightning':
        noise(t, 0.18, { gain: 0.24, lp: 9000, hp: 1500, slideLp: 3000 });
        tone(880, t, 0.12, { type: 'square', gain: 0.07, slideTo: 180 });
        break;
      case 'holy':
        [523, 659, 784, 1046].forEach((f, i) => tone(f, t + i * 0.06, 0.7 - i * 0.05, { type: 'sine', gain: 0.11 }));
        break;
      case 'poison':
        [230, 185, 150].forEach((f, i) => tone(f, t + i * 0.12, 0.2, { type: 'sine', gain: 0.13, slideTo: f * 1.7 }));
        break;
      case 'heal':
        [523, 784].forEach((f, i) => tone(f, t + i * 0.09, 0.6, { type: 'sine', gain: 0.12, slideTo: f * 1.5 }));
        break;
      case 'impact':
      default:
        noise(t, 0.18, { gain: 0.26, lp: 800, hp: 60 });
        tone(120, t, 0.22, { type: 'sine', gain: 0.17, slideTo: 45 });
        break;
    }
  };
  return { play };
})();
window.playFxSound = (kind) => FxAudio.play(kind);
window.FX_KINDS = Object.keys(FX_PRESETS);

// Condições do 5e: ícone (game-icons.net, via diogoan.github.io/dnd5e-quickref) + descrição
// completa — aparece no token, na lista, no seletor e na tela dos jogadores.
const CONDITION_INFO = {
  Agarrado: {
    icon: 'grab', subtitle: 'Seu deslocamento vira 0',
    bullets: [
      'Seu deslocamento se torna 0, e você não pode se beneficiar de qualquer bônus em seu deslocamento.',
      'A condição encerra caso a criatura que a agarrou fique incapacitada.',
      'A condição se encerra se um efeito remover a criatura agarrada do alcance da criatura que a agarrou ou do efeito que causa a condição.',
    ], reference: 'PHB, pg. 291.',
  },
  Amedrontado: {
    icon: 'sharp-smile', subtitle: 'Desvantagem enquanto a fonte do medo estiver visível',
    bullets: [
      'Você sofre desvantagem em testes de habilidade e jogadas de ataque enquanto a fonte do seu medo estiver em sua linha de visão.',
      'Você não pode se mover voluntariamente para uma posição que a faça terminar o turno mais próxima da sua fonte de medo do que sua posição inicial.',
    ], reference: 'PHB, pg. 291.',
  },
  Atordoado: {
    icon: 'internal-injury', subtitle: 'Incapacitado, não se move, só fala hesitante',
    bullets: [
      'Você está incapacitado, não pode se mover e somente pode falar hesitantemente.',
      'Jogadas de ataque contra você possuem vantagem.',
      'Você falha automaticamente em testes de resistência de Força e Destreza.',
    ], reference: 'PHB, pg. 291.',
  },
  Caído: {
    icon: 'crawl', subtitle: 'Só pode rastejar, a menos que se levante',
    bullets: [
      'Sua única opção de movimento é rastejar, a menos que se levante.',
      'Você possui desvantagem em jogadas de ataque.',
      'Jogadas de ataque contra você possuem vantagem se o atacante estiver a 1,5 metro de você. De outra maneira, a jogada de ataque possui desvantagem.',
    ], reference: 'PHB, pg. 291.',
  },
  Cego: {
    icon: 'one-eyed', subtitle: 'Não pode ver',
    bullets: [
      'Você falha automaticamente em qualquer teste de habilidade que requeira o uso da visão.',
      'Você tem desvantagem em rolagens de ataque.',
      'Rolagens de ataque contra você possuem vantagem.',
    ], reference: 'PHB, pg. 291.',
  },
  Contido: {
    icon: 'imprisoned', subtitle: 'Deslocamento vira 0, desvantagem em ataques',
    bullets: [
      'Seu deslocamento se torna 0, e você não pode se beneficiar de qualquer bônus em seu deslocamento.',
      'Jogadas de ataque contra você possuem vantagem.',
      'Você sofre desvantagem em jogadas de ataque.',
      'Você sofre desvantagem em testes de resistência de Destreza.',
    ], reference: 'PHB, pg. 292.',
  },
  Enfeitiçado: {
    icon: 'smitten', subtitle: 'Enfeitiçado por outra criatura',
    bullets: [
      'Você não pode atacar quem te enfeitiçou ou tê-lo como alvo de habilidades ou efeitos mágicos nocivos.',
      'Quem o enfeitiçou possui vantagem em testes de habilidade feitos para interagir socialmente com a criatura.',
    ], reference: 'PHB, pg. 292.',
  },
  Envenenado: {
    icon: 'deathcab', subtitle: 'Afetado por um veneno',
    bullets: ['Você possui desvantagem em jogadas de ataque e testes de habilidade.'],
    reference: 'PHB, pg. 292.',
  },
  Exausto: {
    icon: 'crawl', subtitle: 'Medido em 6 níveis — acumula os efeitos de todos os anteriores',
    bullets: [
      'Nível 1: desvantagem em testes de habilidade.',
      'Nível 2: deslocamento reduzido à metade.',
      'Nível 3: desvantagem nas jogadas de ataque e testes de resistência.',
      'Nível 4: máximo de pontos de vida reduzido à metade.',
      'Nível 5: deslocamento reduzido a 0.',
      'Nível 6: morte.',
      'Você sofre os efeitos do seu nível atual e de todos os níveis anteriores.',
      'Terminar um descanso longo reduz a exaustão em 1 nível, desde que a criatura também tenha ingerido água e comida.',
    ], reference: 'PHB, pg. 292.',
  },
  Incapacitado: {
    icon: 'internal-injury', subtitle: 'Não pode agir ou reagir',
    bullets: ['Você não pode realizar ações ou reações.'],
    reference: 'PHB, pg. 292.',
  },
  Inconsciente: {
    icon: 'coma', subtitle: 'Desacordado, sem ciência dos arredores',
    bullets: [
      'Você está incapacitado, não pode se mover ou falar e não tem ciência de seus arredores.',
      'Você larga tudo que estiver segurando e fica caído.',
      'Você falha automaticamente em testes de resistência de Força ou Destreza.',
      'Jogadas de ataque contra você possuem vantagem.',
      'Qualquer ataque que o atinja é um acerto crítico, se o atacante estiver a 1,5 metro de você.',
    ], reference: 'PHB, pg. 292.',
  },
  Invisível: {
    icon: 'invisible', subtitle: 'Não pode ser visto sem magia ou sentido especial',
    bullets: [
      'Para o propósito de se esconder, você é considerado em área de escuridão densa.',
      'Você ainda pode ser detectado por algum barulho que faça ou rastros que deixe.',
      'Jogadas de ataque contra você sofrem desvantagem.',
      'Você possui vantagem em jogadas de ataque.',
    ], reference: 'PHB, pg. 293.',
  },
  Paralisado: {
    icon: 'internal-injury', subtitle: 'Incapacitado, não se move nem fala',
    bullets: [
      'Você está incapacitado e não pode se mover ou falar.',
      'Você falha automaticamente em testes de resistência de Força e Destreza.',
      'Jogadas de ataque contra você possuem vantagem.',
      'Qualquer ataque que atinja você é um acerto crítico, se o atacante estiver a 1,5 metro de você.',
    ], reference: 'PHB, pg. 293.',
  },
  Petrificado: {
    icon: 'stone-pile', subtitle: 'Transformado em pedra',
    bullets: [
      'Seu peso é multiplicado por dez, e você para de envelhecer.',
      'Você está incapacitado, não pode se mover ou falar, e não tem ciência de seus arredores.',
      'Jogadas de ataque contra você possuem vantagem.',
      'Você falha automaticamente em testes de resistência de Força e Destreza.',
      'Você tem resistência a todos os tipos de dano.',
      'Você fica imune a veneno e doenças (veneno/doença prévios ficam suspensos, não neutralizados).',
    ], reference: 'PHB, pg. 293.',
  },
  Surdo: {
    icon: 'elf-ear', subtitle: 'Não pode ouvir',
    bullets: ['Você falha automaticamente em qualquer teste de habilidade que requeira o uso da audição.'],
    reference: 'PHB, pg. 293.',
  },
};
// Ícones: game-icons.net, via github.com/diogoan/dnd5e-quickref (CC BY 3.0 / MIT).
const condIconUrl = (c) => CONDITION_INFO[c] ? `/icons/conditions/${CONDITION_INFO[c].icon}.png` : '';
const condTitle = (c) => {
  const info = CONDITION_INFO[c];
  if (!info) return c;
  return [`${c} — ${info.subtitle}`, '', ...info.bullets.map((b) => `• ${b}`), '', info.reference].join('\n');
};
// Compat: código antigo que só queria "um ícone" pro emoji — agora devolve a URL da imagem.
const condIcon = condIconUrl;
window.condTitle = condTitle;

// Fração de vida a partir do que o cliente recebeu: número exato (PC / Mestre)
// ou só a porcentagem (inimigo, quando o Mestre não liberou os números).
function hpFraction(t) {
  if (t.hpPct != null) return t.hpPct;
  if (t.maxHp > 0) return Math.max(0, Math.min(1, (t.hp ?? 0) / t.maxHp));
  return null;
}

class BattleMap {
  constructor(canvas, { isDm = false } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.isDm = isDm;
    this.map = null;
    this.battle = { tokens: [] };
    this.combat = { entries: [], turn: 0 };
    this.cam = { x: 0, y: 0, zoom: 1 };
    this.tool = 'select';
    this.pings = [];
    this.fx = [];           // efeitos de combate transitórios (fogo, impacto, cura...)
    this.ruler = null;      // { from: {col,row}, to: {col,row} }
    this.drag = null;
    this.selectedId = null; // token em foco no painel de ação
    this.aoe = null;        // { col, row, radius } — área de efeito em metros
    this.onTokenMove = null;  // (tokenId, col, row) => void
    this.onFogPaint = null;   // (cells: ['c,r'], reveal: bool) => void
    this.onPing = null;       // (col, row) => void
    this.onTokenClick = null; // (token) => void  (clique direito no painel)
    this.onSelect = null;     // (token|null) => void
    this.onAoe = null;        // (aoe|null) => void

    this._bindEvents();
    this._resize();
    window.addEventListener('resize', () => { this._resize(); this.draw(); });
  }

  // Os tokens já chegam prontos do servidor: PV e condições vindos da iniciativa, retrato do
  // personagem, e — para os jogadores — sem os números de PV dos inimigos.
  setData({ map, battle, combat }) {
    this.map = map || null;
    this.battle = battle || { tokens: [] };
    this.combat = combat || { entries: [], turn: 0 };
    this.draw();
  }

  // O canvas nasce com tamanho 0 quando a aba está escondida — rechame ao exibi-la.
  resize() {
    this._resize();
    this.draw();
  }

  // Enquadra o mapa inteiro na tela
  fit() {
    if (!this.map) return;
    const { width, height } = this.canvas;
    const dpr = window.devicePixelRatio || 1;
    const w = width / dpr;
    const h = height / dpr;
    const zoom = Math.min(w / (this.map.cols * CELL), h / (this.map.rows * CELL)) * 0.95;
    this.cam.zoom = zoom;
    this.cam.x = (w - this.map.cols * CELL * zoom) / 2;
    this.cam.y = (h - this.map.rows * CELL * zoom) / 2;
    this.draw();
  }

  addPing(col, row) {
    this.pings.push({ col, row, t: performance.now() });
    this._animate();
  }

  // Dispara um efeito de combate numa célula. Também toca o som correspondente.
  // { type: 'fire'|'ice'|'lightning'|'holy'|'poison'|'impact'|'heal', col, row, size, text }
  playFx({ type = 'impact', col = 0, row = 0, size = 1, text = '', textCol = '' } = {}) {
    const preset = FX_PRESETS[type] || FX_PRESETS.impact;
    const cx = col * CELL + CELL * size / 2;
    const cy = row * CELL + CELL * size / 2;
    const spread = CELL * (0.4 + size * 0.25);
    const particles = [];
    for (let i = 0; i < (preset.n || 0); i++) {
      const up = preset.spread === 'up';
      const a = up ? (-Math.PI / 2) + (Math.random() - 0.5) * 1.1 : Math.random() * Math.PI * 2;
      particles.push({ a, sp: (0.5 + Math.random() * 1.0) * spread, r0: 3 + Math.random() * 5, ph: Math.random() });
    }
    const bolts = preset.bolt ? [Math.random(), Math.random(), Math.random()] : null;
    this.fx.push({ type, cx, cy, size, t: performance.now(), dur: preset.dur, preset, particles, bolts, text, textCol });
    if (window.playFxSound) window.playFxSound(type);
    this._animate();
  }

  // Traz uma célula para o centro da tela (usado ao virar o turno)
  centerOn(col, row) {
    if (!this.map) return;
    const dpr = window.devicePixelRatio || 1;
    const w = this.canvas.width / dpr;
    const h = this.canvas.height / dpr;
    this.cam.x = w / 2 - (col * CELL + CELL / 2) * this.cam.zoom;
    this.cam.y = h / 2 - (row * CELL + CELL / 2) * this.cam.zoom;
    this.draw();
  }

  // Centraliza a câmera num ponto do grid (px), opcionalmente com deslize suave.
  focusPx(tx, ty, { smooth = true } = {}) {
    if (!this.map) return;
    const dpr = window.devicePixelRatio || 1;
    const w = this.canvas.width / dpr;
    const h = this.canvas.height / dpr;
    const target = { x: w / 2 - tx * this.cam.zoom, y: h / 2 - ty * this.cam.zoom };
    if (!smooth) { this.cam.x = target.x; this.cam.y = target.y; this.draw(); return; }
    this._camTarget = target;
    this._camAnimate();
  }

  // Centraliza a câmera num token (usa o centro dele, respeitando o tamanho).
  focusToken(t, opts) {
    if (!t) return;
    const size = t.size || 1;
    this.focusPx(t.col * CELL + size * CELL / 2, t.row * CELL + size * CELL / 2, opts);
  }

  _camAnimate() {
    if (this._camAnim) return;
    const step = () => {
      const t = this._camTarget;
      if (!t) { this._camAnim = null; return; }
      this.cam.x += (t.x - this.cam.x) * 0.2;
      this.cam.y += (t.y - this.cam.y) * 0.2;
      if (Math.abs(t.x - this.cam.x) < 0.5 && Math.abs(t.y - this.cam.y) < 0.5) {
        this.cam.x = t.x; this.cam.y = t.y;
        this._camTarget = null; this._camAnim = null;
        this.draw();
        return;
      }
      this.draw();
      this._camAnim = requestAnimationFrame(step);
    };
    this._camAnim = requestAnimationFrame(step);
  }

  select(id) {
    this.selectedId = id;
    this.draw();
    if (this.onSelect) this.onSelect(this.tokenById(id));
  }

  tokenById(id) {
    return this.battle.tokens.find((t) => t.id === id) || null;
  }

  setAoe(aoe) {
    this.aoe = aoe;
    this.draw();
    if (this.onAoe) this.onAoe(aoe);
  }

  // Quem está dentro da área: mede do centro da área ao centro do token, em metros.
  tokensInAoe(aoe = this.aoe) {
    if (!aoe || !this.map) return [];
    const m = this.map.cellSize || 1.5;
    return this.battle.tokens.filter((t) => {
      const size = t.size || 1;
      const tc = t.col + size / 2;
      const tr = t.row + size / 2;
      const dist = Math.hypot(tc - (aoe.col + 0.5), tr - (aoe.row + 0.5)) * m;
      return dist <= aoe.radius + (size - 1) * m / 2;
    });
  }

  // Distância percorrida no arrasto: no 5e a diagonal custa um quadrado.
  _dragDistance() {
    const d = this.drag;
    if (!d || d.mode !== 'token') return null;
    const squares = Math.max(
      Math.abs(d.ghost.col - d.from.col),
      Math.abs(d.ghost.row - d.from.row),
    );
    const meters = squares * (this.map.cellSize || 1.5);
    const speed = d.token.speed ?? 9;
    return { squares, meters, speed, over: meters > speed };
  }

  // ---------- Coordenadas ----------
  _toGrid(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    return {
      x: (clientX - r.left - this.cam.x) / this.cam.zoom,
      y: (clientY - r.top - this.cam.y) / this.cam.zoom,
    };
  }
  _toCell(clientX, clientY) {
    const g = this._toGrid(clientX, clientY);
    return { col: Math.floor(g.x / CELL), row: Math.floor(g.y / CELL) };
  }
  _tokenAt(clientX, clientY) {
    const g = this._toGrid(clientX, clientY);
    // De trás para frente: o token desenhado por cima ganha o clique
    for (let i = this.battle.tokens.length - 1; i >= 0; i--) {
      const t = this.battle.tokens[i];
      const size = t.size || 1;
      const x = t.col * CELL;
      const y = t.row * CELL;
      if (g.x >= x && g.x < x + size * CELL && g.y >= y && g.y < y + size * CELL) return t;
    }
    return null;
  }

  // ---------- Interação ----------
  _bindEvents() {
    const c = this.canvas;

    c.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (!this.isDm) return;
      const t = this._tokenAt(e.clientX, e.clientY);
      if (t && this.onTokenClick) this.onTokenClick(t);
    });

    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      const next = Math.max(0.15, Math.min(4, this.cam.zoom * factor));
      const r = c.getBoundingClientRect();
      const mx = e.clientX - r.left;
      const my = e.clientY - r.top;
      // Zoom ancorado no cursor
      this.cam.x = mx - (mx - this.cam.x) * (next / this.cam.zoom);
      this.cam.y = my - (my - this.cam.y) * (next / this.cam.zoom);
      this.cam.zoom = next;
      this.draw();
    }, { passive: false });

    c.addEventListener('pointerdown', (e) => {
      if (!this.map) return;
      c.setPointerCapture(e.pointerId);
      const panning = e.button === 1 || e.button === 2 || e.shiftKey || (!this.isDm && e.button === 0);

      if (panning) {
        this.drag = { mode: 'pan', sx: e.clientX, sy: e.clientY, cx: this.cam.x, cy: this.cam.y };
        return;
      }
      if (e.button !== 0) return;

      if (this.isDm && (this.tool === 'reveal' || this.tool === 'hide')) {
        this.drag = { mode: 'fog', cells: new Set() };
        this._paintFog(e.clientX, e.clientY);
        return;
      }
      if (this.isDm && this.tool === 'ping') {
        const { col, row } = this._toCell(e.clientX, e.clientY);
        this.addPing(col, row);
        if (this.onPing) this.onPing(col, row);
        return;
      }
      if (this.tool === 'ruler') {
        const cell = this._toCell(e.clientX, e.clientY);
        this.ruler = { from: cell, to: cell };
        this.drag = { mode: 'ruler' };
        this.draw();
        return;
      }
      if (this.isDm && this.tool === 'aoe') {
        const cell = this._toCell(e.clientX, e.clientY);
        this.aoe = { col: cell.col, row: cell.row, radius: 0 };
        this.drag = { mode: 'aoe' };
        this.draw();
        return;
      }
      if (this.isDm && this.tool === 'select') {
        const t = this._tokenAt(e.clientX, e.clientY);
        if (t) {
          this.select(t.id);
          this.drag = { mode: 'token', token: t, ghost: { col: t.col, row: t.row }, from: { col: t.col, row: t.row } };
          return;
        }
        this.select(null); // clique no vazio tira o foco
      }
      this.drag = { mode: 'pan', sx: e.clientX, sy: e.clientY, cx: this.cam.x, cy: this.cam.y };
    });

    c.addEventListener('pointermove', (e) => {
      if (!this.drag) return;
      const d = this.drag;
      if (d.mode === 'pan') {
        this.cam.x = d.cx + (e.clientX - d.sx);
        this.cam.y = d.cy + (e.clientY - d.sy);
      } else if (d.mode === 'token') {
        d.ghost = this._toCell(e.clientX, e.clientY);
      } else if (d.mode === 'fog') {
        this._paintFog(e.clientX, e.clientY);
      } else if (d.mode === 'ruler') {
        this.ruler.to = this._toCell(e.clientX, e.clientY);
      } else if (d.mode === 'aoe') {
        const g = this._toGrid(e.clientX, e.clientY);
        const dx = g.x / CELL - (this.aoe.col + 0.5);
        const dy = g.y / CELL - (this.aoe.row + 0.5);
        this.aoe.radius = Math.hypot(dx, dy) * (this.map.cellSize || 1.5);
      }
      this.draw();
    });

    const endDrag = () => {
      const d = this.drag;
      this.drag = null;
      if (!d) return;
      if (d.mode === 'token') {
        const { col, row } = d.ghost;
        const maxC = this.map.cols - (d.token.size || 1);
        const maxR = this.map.rows - (d.token.size || 1);
        const nc = Math.max(0, Math.min(maxC, col));
        const nr = Math.max(0, Math.min(maxR, row));
        if (nc !== d.from.col || nr !== d.from.row) {
          d.token.col = nc;
          d.token.row = nr;
          if (this.onTokenMove) this.onTokenMove(d.token.id, nc, nr);
        }
      } else if (d.mode === 'fog' && this.onFogPaint) {
        this.onFogPaint([...d.cells], this.tool === 'reveal');
      } else if (d.mode === 'aoe') {
        // Área pequena demais = clique errado; some em vez de virar uma área de 0 m
        if (this.aoe.radius < 0.5) this.aoe = null;
        if (this.onAoe) this.onAoe(this.aoe);
      } else if (d.mode === 'ruler') {
        // A régua some ao soltar
        setTimeout(() => { this.ruler = null; this.draw(); }, 1200);
      }
      this.draw();
    };
    c.addEventListener('pointerup', endDrag);
    c.addEventListener('pointercancel', endDrag);
  }

  _paintFog(clientX, clientY) {
    const { col, row } = this._toCell(clientX, clientY);
    if (col < 0 || row < 0 || col >= this.map.cols || row >= this.map.rows) return;
    const key = `${col},${row}`;
    this.drag.cells.add(key);
    // Feedback imediato: aplica local; o servidor confirma no soltar
    const fog = this.map.fog || (this.map.fog = { enabled: true, revealed: [] });
    const set = new Set(fog.revealed);
    if (this.tool === 'reveal') set.add(key); else set.delete(key);
    fog.revealed = [...set];
  }

  // ---------- Desenho ----------
  _resize() {
    const dpr = window.devicePixelRatio || 1;
    const r = this.canvas.getBoundingClientRect();
    this.canvas.width = r.width * dpr;
    this.canvas.height = r.height * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // Anima só enquanto existe ping ou efeito na tela; fora disso o canvas fica parado.
  _animate() {
    if (this._anim) return;
    const frame = () => {
      const now = performance.now();
      this.pings = this.pings.filter((p) => now - p.t < 2000);
      this.fx = this.fx.filter((f) => now - f.t < f.dur);
      this.draw();
      // Mantém o loop enquanto houver ping, efeito ou área com alvos (aro pulsante).
      const areaComAlvo = this.aoe && this.tokensInAoe().length > 0;
      if (this.pings.length || this.fx.length || areaComAlvo) {
        this._anim = requestAnimationFrame(frame);
      } else {
        this._anim = null;
      }
    };
    this._anim = requestAnimationFrame(frame);
  }

  draw() {
    const { ctx, canvas } = this;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#0d0b13';
    ctx.fillRect(0, 0, w, h);

    if (!this.map) {
      ctx.fillStyle = '#9a8fc0';
      ctx.font = '16px Segoe UI, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(this.isDm ? 'Nenhum mapa em jogo — crie ou ative um mapa.' : 'Aguardando o Mestre abrir o mapa...', w / 2, h / 2);
      ctx.textAlign = 'left';
      return;
    }

    ctx.save();
    ctx.translate(this.cam.x, this.cam.y);
    ctx.scale(this.cam.zoom, this.cam.zoom);

    const gw = this.map.cols * CELL;
    const gh = this.map.rows * CELL;

    // Fundo do tabuleiro
    ctx.fillStyle = '#1c1828';
    ctx.fillRect(0, 0, gw, gh);

    // Imagem do mapa (upload ou URL), posicionada e escalada para casar com o grid
    const src = this.map.filename ? `/map-files/${this.map.filename}` : this.map.imageUrl;
    const img = loadImg(src, () => this.draw());
    if (img && img.complete && img.naturalWidth) {
      const s = this.map.img?.scale || 1;
      ctx.drawImage(img, this.map.img?.x || 0, this.map.img?.y || 0, img.naturalWidth * s, img.naturalHeight * s);
    }

    // Grid
    ctx.strokeStyle = 'rgba(196,167,71,0.35)';
    ctx.lineWidth = 1 / this.cam.zoom;
    ctx.beginPath();
    for (let c = 0; c <= this.map.cols; c++) { ctx.moveTo(c * CELL, 0); ctx.lineTo(c * CELL, gh); }
    for (let r = 0; r <= this.map.rows; r++) { ctx.moveTo(0, r * CELL); ctx.lineTo(gw, r * CELL); }
    ctx.stroke();

    this._reveal = this._computeReveal(); // reaproveitado por _drawFog e _isVisible
    this._drawFog(gw, gh);
    this._drawAoe();
    this._drawTokens();
    this._drawMoveRuler();
    this._drawRuler();
    this._drawPings();
    this._drawFx();

    ctx.restore();
  }

  // Área de efeito: círculo + os quadrados que ela pega + quem está dentro
  _drawAoe() {
    if (!this.aoe || !this.map) return;
    const { ctx } = this;
    const m = this.map.cellSize || 1.5;
    const rCells = this.aoe.radius / m;
    const cx = (this.aoe.col + 0.5) * CELL;
    const cy = (this.aoe.row + 0.5) * CELL;

    ctx.save();
    // Quadrados afetados: o centro do quadrado dentro do círculo
    ctx.fillStyle = 'rgba(224,82,82,0.22)';
    for (let c = 0; c < this.map.cols; c++) {
      for (let r = 0; r < this.map.rows; r++) {
        if (Math.hypot(c + 0.5 - (this.aoe.col + 0.5), r + 0.5 - (this.aoe.row + 0.5)) <= rCells) {
          ctx.fillRect(c * CELL, r * CELL, CELL, CELL);
        }
      }
    }
    ctx.beginPath();
    ctx.arc(cx, cy, rCells * CELL, 0, Math.PI * 2);
    ctx.strokeStyle = '#e05252';
    ctx.lineWidth = 3 / this.cam.zoom;
    ctx.stroke();

    // Destaca quem está dentro (os atingidos): aro vermelho pulsante ao redor do token
    const dentro = this.tokensInAoe();
    const pulse = 0.55 + 0.45 * Math.abs(Math.sin(performance.now() / 300));
    for (const t of dentro) {
      const size = t.size || 1;
      const tcx = t.col * CELL + size * CELL / 2;
      const tcy = t.row * CELL + size * CELL / 2;
      const rr = size * CELL / 2 + 2;
      ctx.save();
      ctx.globalAlpha = pulse;
      ctx.beginPath();
      ctx.arc(tcx, tcy, rr, 0, Math.PI * 2);
      ctx.strokeStyle = '#ff4d4d';
      ctx.lineWidth = 4 / this.cam.zoom;
      ctx.stroke();
      ctx.restore();
    }
    if (dentro.length) this._animate(); // mantém o pulso vivo enquanto há alvos

    const alvos = dentro.length;
    const text = `${this.aoe.radius.toFixed(1)} m · ${alvos} alvo(s)`;
    ctx.font = `bold ${14 / this.cam.zoom}px Segoe UI, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const tw = ctx.measureText(text).width;
    ctx.fillStyle = 'rgba(10,8,16,0.85)';
    ctx.fillRect(cx - tw / 2 - 6 / this.cam.zoom, cy - 12 / this.cam.zoom, tw + 12 / this.cam.zoom, 24 / this.cam.zoom);
    ctx.fillStyle = '#e05252';
    ctx.fillText(text, cx, cy);
    ctx.restore();
  }

  // Enquanto arrasta um token: quanto ele já andou e se estourou o deslocamento
  _drawMoveRuler() {
    const info = this._dragDistance();
    if (!info || info.squares === 0) return;
    const { ctx } = this;
    const d = this.drag;
    const ax = d.from.col * CELL + CELL / 2;
    const ay = d.from.row * CELL + CELL / 2;
    const bx = d.ghost.col * CELL + CELL / 2;
    const by = d.ghost.row * CELL + CELL / 2;
    const cor = info.over ? '#e05252' : '#4ade80';

    ctx.save();
    ctx.strokeStyle = cor;
    ctx.lineWidth = 3 / this.cam.zoom;
    ctx.setLineDash([8 / this.cam.zoom, 6 / this.cam.zoom]);
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
    ctx.setLineDash([]);

    const text = `${info.squares} qd · ${info.meters.toFixed(1)}/${info.speed} m${info.over ? ' ⚠️' : ''}`;
    ctx.font = `bold ${13 / this.cam.zoom}px Segoe UI, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const tw = ctx.measureText(text).width;
    const mx = (ax + bx) / 2;
    const my = (ay + by) / 2;
    ctx.fillStyle = 'rgba(10,8,16,0.85)';
    ctx.fillRect(mx - tw / 2 - 6 / this.cam.zoom, my - 11 / this.cam.zoom, tw + 12 / this.cam.zoom, 22 / this.cam.zoom);
    ctx.fillStyle = cor;
    ctx.fillText(text, mx, my);
    ctx.restore();
  }

  // Conjunto de células reveladas: névoa pintada à mão (map.fog) unida com o campo de
  // visão automático (raio ao redor de cada PC). Devolve null quando nada esconde nada.
  _computeReveal() {
    const visionOn = this.battle?.vision?.enabled;
    const manualOn = this.map?.fog?.enabled;
    if (!visionOn && !manualOn) return null;
    const set = new Set();
    if (manualOn) for (const cell of this.map.fog.revealed || []) set.add(cell);
    if (visionOn) {
      const rCells = Math.max(1, (this.battle.vision.radius || 12) / (this.map.cellSize || 1.5));
      for (const t of this.battle.tokens) {
        if (t.kind !== 'pc' || t.hidden) continue; // só personagens dos jogadores enxergam
        const size = t.size || 1;
        const cc = t.col + size / 2;
        const cr = t.row + size / 2;
        const R = rCells + (size - 1) / 2;
        const minC = Math.max(0, Math.floor(cc - R));
        const maxC = Math.min(this.map.cols - 1, Math.ceil(cc + R));
        const minR = Math.max(0, Math.floor(cr - R));
        const maxR = Math.min(this.map.rows - 1, Math.ceil(cr + R));
        for (let c = minC; c <= maxC; c++) {
          for (let r = minR; r <= maxR; r++) {
            const dc = (c + 0.5) - cc;
            const dr = (r + 0.5) - cr;
            if (Math.hypot(dc, dr) <= R) set.add(`${c},${r}`);
          }
        }
      }
    }
    return set;
  }

  _drawFog(gw, gh) {
    const revealed = this._reveal;
    if (!revealed) return;
    const { ctx } = this;
    // Para o Mestre a névoa é translúcida (ele vê tudo e sabe o que os jogadores enxergam);
    // para o jogador é opaca — só aparece o que está dentro do campo de visão.
    ctx.fillStyle = this.isDm ? 'rgba(10,8,16,0.55)' : '#0a0810';
    for (let c = 0; c < this.map.cols; c++) {
      for (let r = 0; r < this.map.rows; r++) {
        if (!revealed.has(`${c},${r}`)) ctx.fillRect(c * CELL, r * CELL, CELL, CELL);
      }
    }
  }

  _isVisible(t) {
    // Token em célula não revelada não aparece para o jogador
    if (this.isDm) return true;
    const revealed = this._reveal;
    if (!revealed) return true;
    const size = t.size || 1;
    for (let c = t.col; c < t.col + size; c++) {
      for (let r = t.row; r < t.row + size; r++) {
        if (revealed.has(`${c},${r}`)) return true;
      }
    }
    return false;
  }

  _currentTurnName() {
    const e = this.combat?.entries?.[this.combat.turn];
    return e ? e.name : null;
  }

  _drawTokens() {
    const { ctx } = this;
    const turnName = this._currentTurnName();
    const dragging = this.drag?.mode === 'token' ? this.drag : null;

    for (const t of this.battle.tokens) {
      if (!this._isVisible(t)) continue;
      const isDragged = dragging && dragging.token.id === t.id;
      const col = isDragged ? dragging.ghost.col : t.col;
      const row = isDragged ? dragging.ghost.row : t.row;
      const size = t.size || 1;
      const px = col * CELL;
      const py = row * CELL;
      const d = size * CELL;
      const cx = px + d / 2;
      const cy = py + d / 2;
      const radius = d / 2 - 4;
      const isPlayer = !this.isDm; // na tela dos jogadores, HUD maior e legível

      ctx.save();
      if (t.hidden) ctx.globalAlpha = 0.45; // só o Mestre chega aqui com hidden

      // Corpo do token: imagem recortada em círculo, ou cor sólida com a inicial
      const color = t.color || KIND_COLOR[t.kind] || '#8b5cf6';
      const tImg = loadImg(t.imageUrl, () => this.draw());
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      if (tImg && tImg.complete && tImg.naturalWidth) {
        // Retrato recortado em círculo, cobrindo sem distorcer (o retrato manda no enquadramento)
        ctx.save();
        ctx.clip();
        const side = Math.min(tImg.naturalWidth, tImg.naturalHeight);
        const sx = (tImg.naturalWidth - side) / 2;
        const sy = (tImg.naturalHeight - side) / 2;
        ctx.drawImage(tImg, sx, sy, side, side, px + 4, py + 4, d - 8, d - 8);
        ctx.restore();
      } else {
        ctx.fillStyle = color;
        ctx.fill();
        ctx.fillStyle = '#14111c';
        ctx.font = `bold ${Math.round(radius)}px Segoe UI, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText((t.name || '?').slice(0, 1).toUpperCase(), cx, cy + 1);
      }

      // Aro: dourado grosso para quem está no turno
      const isTurn = turnName && (t.combatName || t.name) === turnName;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.lineWidth = isTurn ? 5 : 3;
      ctx.strokeStyle = isTurn ? '#ffd75e' : color;
      if (t.hidden) ctx.setLineDash([6, 4]);
      ctx.stroke();
      ctx.setLineDash([]);

      // Token em foco no painel de ação: aro tracejado por fora
      if (t.id === this.selectedId) {
        ctx.beginPath();
        ctx.arc(cx, cy, radius + 5, 0, Math.PI * 2);
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#8b5cf6';
        ctx.setLineDash([5, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Barra de vida (mais grossa e sempre legível na tela dos jogadores)
      const frac = hpFraction(t);
      if (frac !== null) {
        const barH = isPlayer ? Math.max(8, 9 / this.cam.zoom) : 6;
        const bw = d - 12;
        const barY = py + d - barH - 4;
        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        ctx.fillRect(px + 6, barY, bw, barH);
        ctx.fillStyle = frac > 0.5 ? '#4ade80' : frac > 0.25 ? '#c4a747' : '#e05252';
        ctx.fillRect(px + 6, barY, bw * frac, barH);
        if (frac === 0) {
          ctx.fillStyle = '#e05252';
          ctx.font = `bold ${Math.round(d * 0.5)}px Segoe UI, sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('✕', cx, cy);
        }
      }

      // Concentração: quem está mantendo uma magia leva um selo no canto
      if (t.concentration) {
        ctx.font = `${Math.round(d * 0.22)}px Segoe UI, sans-serif`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText('🧠', px + 3, py + 3);
      }

      // Condições: fileira de ícones (arte real, não emoji) logo acima do token
      const conds = t.conditions || [];
      if (conds.length) {
        const s = isPlayer ? Math.max(Math.round(d * 0.26), 20 / this.cam.zoom) : Math.round(d * 0.26);
        const gap = Math.max(2, Math.round(s * 0.15));
        const iw = conds.length * s + (conds.length - 1) * gap;
        const rowX = cx - iw / 2;
        const rowY = py - s - 6;
        ctx.fillStyle = 'rgba(10,8,16,0.8)';
        ctx.fillRect(rowX - 4, rowY, iw + 8, s + 5);
        conds.forEach((cd, i) => {
          const icon = loadImg(condIconUrl(cd), () => this.draw());
          if (icon && icon.complete && icon.naturalWidth) {
            ctx.drawImage(icon, rowX + i * (s + gap), rowY + 2, s, s);
          }
        });
      }

      // Nome e vida embaixo: "Theo · 22/30" para os PC, "Goblin · Ferido" para o que os
      // jogadores só conseguem estimar no olho. Na tela dos jogadores fica bem maior.
      const vida = t.hp != null && t.maxHp > 0 ? `${t.hp}/${t.maxHp}`
        : t.hpLabel ? t.hpLabel : '';
      const label = vida ? `${t.name || ''} · ${vida}` : (t.name || '');
      const fontPx = isPlayer ? Math.max(16, 14 / this.cam.zoom) : 12;
      ctx.font = `${isPlayer ? '600 ' : ''}${fontPx}px Segoe UI, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const tw = ctx.measureText(label).width;
      const padX = fontPx * 0.45;
      const boxH = fontPx * 1.3;
      const ly = py + d + Math.max(2, 4 / this.cam.zoom);
      ctx.fillStyle = 'rgba(10,8,16,0.82)';
      ctx.fillRect(cx - tw / 2 - padX, ly, tw + padX * 2, boxH);
      ctx.fillStyle = '#f0ecff';
      ctx.fillText(label, cx, ly + boxH * 0.14);
      ctx.restore();
    }
  }

  _drawRuler() {
    if (!this.ruler) return;
    const { ctx } = this;
    const a = this.ruler.from;
    const b = this.ruler.to;
    const ax = a.col * CELL + CELL / 2;
    const ay = a.row * CELL + CELL / 2;
    const bx = b.col * CELL + CELL / 2;
    const by = b.row * CELL + CELL / 2;
    // D&D 5e: a diagonal conta como 1 quadrado (distância de Chebyshev)
    const squares = Math.max(Math.abs(b.col - a.col), Math.abs(b.row - a.row));
    const meters = squares * (this.map.cellSize || 1.5);

    ctx.save();
    ctx.strokeStyle = '#ffd75e';
    ctx.lineWidth = 3 / this.cam.zoom;
    ctx.setLineDash([8 / this.cam.zoom, 6 / this.cam.zoom]);
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
    ctx.setLineDash([]);

    const text = `${squares} qd · ${meters.toFixed(1)} m`;
    ctx.font = `bold ${14 / this.cam.zoom}px Segoe UI, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const tw = ctx.measureText(text).width;
    const mx = (ax + bx) / 2;
    const my = (ay + by) / 2;
    ctx.fillStyle = 'rgba(10,8,16,0.85)';
    ctx.fillRect(mx - tw / 2 - 6 / this.cam.zoom, my - 12 / this.cam.zoom, tw + 12 / this.cam.zoom, 24 / this.cam.zoom);
    ctx.fillStyle = '#ffd75e';
    ctx.fillText(text, mx, my);
    ctx.restore();
  }

  _drawPings() {
    const { ctx } = this;
    for (const p of this.pings) {
      const age = (performance.now() - p.t) / 2000; // 0 → 1
      const cx = p.col * CELL + CELL / 2;
      const cy = p.row * CELL + CELL / 2;
      ctx.save();
      ctx.globalAlpha = 1 - age;
      ctx.strokeStyle = '#ffd75e';
      ctx.lineWidth = 4 / this.cam.zoom;
      for (const delay of [0, 0.33]) {
        const t = age - delay;
        if (t < 0) continue;
        ctx.beginPath();
        ctx.arc(cx, cy, CELL * 0.3 + t * CELL * 1.4, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  _drawFx() {
    const { ctx } = this;
    const now = performance.now();
    const z = this.cam.zoom;
    for (const fx of this.fx) {
      const age = (now - fx.t) / fx.dur; // 0 → 1
      if (age < 0 || age > 1) continue;
      const p = fx.preset;
      const fade = 1 - age;
      ctx.save();

      // Anel de choque
      if (p.ring) {
        ctx.globalAlpha = fade * 0.9;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 3.5 / z;
        ctx.beginPath();
        ctx.arc(fx.cx, fx.cy, CELL * 0.15 + age * CELL * (0.7 + fx.size * 0.4), 0, Math.PI * 2);
        ctx.stroke();
      }

      // Raios (relâmpago): riscos irregulares de cima até a célula, piscando no começo
      if (fx.bolts && age < 0.5) {
        ctx.globalAlpha = (1 - age * 2);
        ctx.strokeStyle = p.color2;
        ctx.lineWidth = 2.5 / z;
        for (const seed of fx.bolts) {
          ctx.beginPath();
          const x0 = fx.cx + (seed - 0.5) * CELL * 1.2;
          let y = fx.cy - CELL * 1.8;
          ctx.moveTo(x0, y);
          let x = x0;
          while (y < fx.cy) {
            y += CELL * 0.3;
            x += (Math.random() - 0.5) * CELL * 0.5;
            ctx.lineTo(x, y);
          }
          ctx.lineTo(fx.cx, fx.cy);
          ctx.stroke();
        }
      }

      // Brilho central (glow)
      if (p.glow) {
        const gr = CELL * (0.2 + age * 0.6) * fx.size;
        const grd = ctx.createRadialGradient(fx.cx, fx.cy, 0, fx.cx, fx.cy, gr);
        grd.addColorStop(0, p.color2);
        grd.addColorStop(1, 'transparent');
        ctx.globalAlpha = fade * 0.5;
        ctx.fillStyle = grd;
        ctx.beginPath();
        ctx.arc(fx.cx, fx.cy, gr, 0, Math.PI * 2);
        ctx.fill();
      }

      // Partículas
      for (const pt of fx.particles) {
        const dist = pt.sp * age;
        const gx = fx.cx + Math.cos(pt.a) * dist;
        // 'up' ganha um empurrãozinho extra pra cima e alarga
        const gy = fx.cy + Math.sin(pt.a) * dist - (p.spread === 'up' ? age * CELL * 0.3 : 0);
        const rad = Math.max(0.5, pt.r0 * (1 - age * 0.75)) / z;
        ctx.globalAlpha = fade * (0.7 + pt.ph * 0.3);
        ctx.fillStyle = age < 0.45 ? p.color2 : p.color;
        ctx.beginPath();
        ctx.arc(gx, gy, rad, 0, Math.PI * 2);
        ctx.fill();
      }

      // Emoji que "estoura" no centro
      const pop = age < 0.28 ? age / 0.28 : 1;
      const scale = 0.55 + pop * 0.75;
      ctx.globalAlpha = Math.max(0, 1 - Math.max(0, (age - 0.35) / 0.65));
      ctx.font = `${CELL * 0.62 * scale * fx.size}px serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(p.emoji, fx.cx, fx.cy - age * CELL * 0.15);

      // Número flutuante de dano/cura (tamanho constante na tela)
      if (fx.text) {
        const rise = age * CELL * 0.9;
        ctx.globalAlpha = 1 - age * age;
        ctx.font = `900 ${22 / z}px Segoe UI, Arial, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const tx = fx.cx;
        const ty = fx.cy - CELL * 0.35 - rise;
        ctx.lineWidth = 4 / z;
        ctx.strokeStyle = 'rgba(0,0,0,0.85)';
        ctx.strokeText(fx.text, tx, ty);
        ctx.fillStyle = fx.textCol || p.color2;
        ctx.fillText(fx.text, tx, ty);
      }

      ctx.restore();
    }
  }
}

window.BattleMap = BattleMap;
window.MAP_CELL = CELL;
window.CONDITION_ICON = CONDITION_ICON;
window.condIcon = condIcon;
window.hpFraction = hpFraction;
