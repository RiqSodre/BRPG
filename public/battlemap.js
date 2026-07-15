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

// Ícone de cada condição do 5e — aparece no token, na lista e na tela dos jogadores.
const CONDITION_ICON = {
  Agarrado: '🤼', Amedrontado: '😱', Atordoado: '💫', Caído: '🔻', Cego: '🙈',
  Contido: '🕸️', Enfeitiçado: '💖', Envenenado: '🤢', Exausto: '🥱', Incapacitado: '🚫',
  Inconsciente: '😵', Invisível: '👻', Paralisado: '🧊', Petrificado: '🗿', Surdo: '🔇',
};
const condIcon = (c) => CONDITION_ICON[c] || '✨';

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

  // Anima só enquanto existe ping na tela; fora disso o canvas fica parado.
  _animate() {
    if (this._anim) return;
    const frame = () => {
      this.pings = this.pings.filter((p) => performance.now() - p.t < 2000);
      this.draw();
      if (this.pings.length) {
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

    this._drawFog(gw, gh);
    this._drawAoe();
    this._drawTokens();
    this._drawMoveRuler();
    this._drawRuler();
    this._drawPings();

    ctx.restore();
  }

  // Área de efeito: círculo + os quadrados que ela pega + quem está dentro
  _drawAoe() {
    if (!this.aoe) return;
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

    const alvos = this.tokensInAoe().length;
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

  _drawFog(gw, gh) {
    const fog = this.map.fog;
    if (!fog?.enabled) return;
    const { ctx } = this;
    const revealed = new Set(fog.revealed || []);
    // Para o Mestre a névoa é translúcida (ele enxerga através); para o jogador é opaca.
    ctx.fillStyle = this.isDm ? 'rgba(10,8,16,0.6)' : '#0a0810';
    for (let c = 0; c < this.map.cols; c++) {
      for (let r = 0; r < this.map.rows; r++) {
        if (!revealed.has(`${c},${r}`)) ctx.fillRect(c * CELL, r * CELL, CELL, CELL);
      }
    }
  }

  _isVisible(t) {
    // Token em célula não revelada não aparece para o jogador
    if (this.isDm) return true;
    const fog = this.map.fog;
    if (!fog?.enabled) return true;
    const revealed = new Set(fog.revealed || []);
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

      // Barra de vida
      const frac = hpFraction(t);
      if (frac !== null) {
        const bw = d - 12;
        ctx.fillStyle = 'rgba(0,0,0,0.65)';
        ctx.fillRect(px + 6, py + d - 10, bw, 6);
        ctx.fillStyle = frac > 0.5 ? '#4ade80' : frac > 0.25 ? '#c4a747' : '#e05252';
        ctx.fillRect(px + 6, py + d - 10, bw * frac, 6);
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

      // Condições: fileira de ícones logo acima do token
      const conds = t.conditions || [];
      if (conds.length) {
        const s = Math.round(d * 0.26);
        ctx.font = `${s}px Segoe UI, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        const icons = conds.map(condIcon).join(' ');
        const iw = ctx.measureText(icons).width;
        ctx.fillStyle = 'rgba(10,8,16,0.8)';
        ctx.fillRect(cx - iw / 2 - 4, py - s - 6, iw + 8, s + 5);
        ctx.fillStyle = '#e8e2f5';
        ctx.fillText(icons, cx, py - 3);
      }

      // Nome e vida embaixo: "Theo · 22/30" para os PC, "Goblin · Ferido" para o que os
      // jogadores só conseguem estimar no olho.
      const vida = t.hp != null && t.maxHp > 0 ? `${t.hp}/${t.maxHp}`
        : t.hpLabel ? t.hpLabel : '';
      const label = vida ? `${t.name || ''} · ${vida}` : (t.name || '');
      ctx.font = '12px Segoe UI, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = 'rgba(10,8,16,0.75)';
      ctx.fillRect(cx - tw / 2 - 4, py + d + 2, tw + 8, 16);
      ctx.fillStyle = '#e8e2f5';
      ctx.fillText(label, cx, py + d + 4);
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
}

window.BattleMap = BattleMap;
window.MAP_CELL = CELL;
window.CONDITION_ICON = CONDITION_ICON;
window.condIcon = condIcon;
window.hpFraction = hpFraction;
