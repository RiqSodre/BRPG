// Gera 3 mapas de exemplo simples (arte 100% original, geométrica) pra galeria de
// "Exemplos" da demo — não usa nenhuma arte de terceiros. Roda uma vez, offline.
// Uso: node scripts/gen-sample-maps.mjs
import { PNG } from 'pngjs';
import fs from 'fs';
import path from 'path';

const OUT_DIR = path.join(process.cwd(), 'data-demo', 'sample-maps');
fs.mkdirSync(OUT_DIR, { recursive: true });

function canvas(w, h) {
  const png = new PNG({ width: w, height: h });
  return png;
}
function setPx(png, x, y, [r, g, b]) {
  if (x < 0 || y < 0 || x >= png.width || y >= png.height) return;
  const i = (png.width * y + x) << 2;
  png.data[i] = r; png.data[i + 1] = g; png.data[i + 2] = b; png.data[i + 3] = 255;
}
function fillRect(png, x, y, w, h, color, jitter = 0) {
  for (let yy = y; yy < y + h; yy++) {
    for (let xx = x; xx < x + w; xx++) {
      const c = jitter ? color.map((v) => clamp(v + (Math.random() * 2 - 1) * jitter)) : color;
      setPx(png, xx, yy, c);
    }
  }
}
function fillCircle(png, cx, cy, r, color, jitter = 0) {
  // cx/cy/r PRECISAM ser inteiros: um raio fracionário deixa yy/xx fracionários no
  // loop, e somar isso em coordenadas de pixel corrompe o índice (o círculo "pula"
  // pra bordas erradas da imagem em vez de ficar centrado).
  cx = Math.round(cx); cy = Math.round(cy); r = Math.round(r);
  for (let yy = -r; yy <= r; yy++) {
    for (let xx = -r; xx <= r; xx++) {
      if (xx * xx + yy * yy <= r * r) {
        const c = jitter ? color.map((v) => clamp(v + (Math.random() * 2 - 1) * jitter)) : color;
        setPx(png, cx + xx, cy + yy, c);
      }
    }
  }
}
function clamp(v) { return Math.max(0, Math.min(255, Math.round(v))); }
function save(png, name) {
  const buf = PNG.sync.write(png);
  fs.writeFileSync(path.join(OUT_DIR, name), buf);
  console.log('gerado:', name);
}

const CELL = 48;

// ---------- 1) Taverna do Polvo Encalhado — 20x15 ----------
{
  const cols = 20, rows = 15;
  const w = cols * CELL, h = rows * CELL;
  const png = canvas(w, h);
  const WOOD = [107, 74, 53];
  const WALL = [43, 31, 24];
  const COUNTER = [74, 50, 34];
  const TABLE = [90, 62, 42];
  const FIRE = [214, 96, 40];
  fillRect(png, 0, 0, w, h, WOOD, 6);
  // paredes externas
  fillRect(png, 0, 0, w, CELL, WALL);
  fillRect(png, 0, h - CELL, w, CELL, WALL);
  fillRect(png, 0, 0, CELL, h, WALL);
  fillRect(png, w - CELL, 0, CELL, h, WALL);
  // porta (vão mais claro na parede de baixo)
  fillRect(png, 9 * CELL, h - CELL, 2 * CELL, CELL, [120, 96, 70]);
  // balcão ao longo da parede esquerda
  fillRect(png, CELL, CELL, CELL * 1.4, CELL * 8, COUNTER);
  fillRect(png, 0.6 * CELL, CELL, CELL * 0.4, CELL * 8, WALL); // prateleira atrás
  // lareira no canto superior direito — só a marca de fogo, sem bloco de parede extra
  fillCircle(png, w - 1.8 * CELL, 1.8 * CELL, CELL * 0.5, [58, 42, 32], 10);
  fillCircle(png, w - 1.8 * CELL, 1.8 * CELL, CELL * 0.32, FIRE, 20);
  // mesas espalhadas
  const tables = [[6, 4], [9, 3], [12, 6], [7, 9], [14, 10], [11, 9]];
  for (const [tc, tr] of tables) fillRect(png, tc * CELL + 8, tr * CELL + 8, CELL - 16, CELL - 16, TABLE, 8);
  save(png, 'Taverna do Polvo Encalhado [20x15].png');
}

// ---------- 2) Becos do Porto Baixo — 24x18 ----------
{
  const cols = 24, rows = 18;
  const w = cols * CELL, h = rows * CELL;
  const png = canvas(w, h);
  const STONE = [90, 90, 87];
  const BUILDING = [38, 36, 34];
  const WATER = [44, 74, 94];
  const CRATE = [96, 68, 40];
  fillRect(png, 0, 0, w, h, STONE, 8);
  // faixa de doca/água na borda direita
  fillRect(png, w - 3 * CELL, 0, 3 * CELL, h, WATER, 10);
  // prédios formando um beco sinuoso pelo meio-esquerda
  fillRect(png, 0, 0, 6 * CELL, 5 * CELL, BUILDING);
  fillRect(png, 0, 7 * CELL, 5 * CELL, 6 * CELL, BUILDING);
  fillRect(png, 0, 14 * CELL, 7 * CELL, 4 * CELL, BUILDING);
  fillRect(png, 7 * CELL, 0, 5 * CELL, 3 * CELL, BUILDING);
  fillRect(png, 9 * CELL, 4 * CELL, 6 * CELL, 4 * CELL, BUILDING);
  fillRect(png, 8 * CELL, 10 * CELL, 6 * CELL, 5 * CELL, BUILDING);
  fillRect(png, 14 * CELL, 0, 6 * CELL, 6 * CELL, BUILDING);
  fillRect(png, 16 * CELL, 8 * CELL, 5 * CELL, 6 * CELL, BUILDING);
  // caixotes no beco
  const crates = [[7, 6], [8, 8], [13, 9], [15, 15], [6, 15]];
  for (const [tc, tr] of crates) fillRect(png, tc * CELL + 10, tr * CELL + 10, CELL - 20, CELL - 20, CRATE, 10);
  save(png, 'Becos do Porto Baixo [24x18].png');
}

// ---------- 3) Covil da Maré Cinzenta — 22x22 ----------
{
  const cols = 22, rows = 22;
  const w = cols * CELL, h = rows * CELL;
  const png = canvas(w, h);
  const ROCK = [26, 24, 22];
  const FLOOR = [31, 36, 33];
  const GLOW = [74, 110, 96];
  const RELIC = [58, 52, 40];
  fillRect(png, 0, 0, w, h, ROCK, 6);
  // caverna orgânica: união de vários círculos abertos no chão
  const blobs = [
    [11, 11, 8.5], [7, 9, 4.5], [15, 8, 4], [8, 15, 4.5], [15, 15, 4.5], [11, 6, 4], [11, 17, 4],
  ];
  for (const [bc, br, rad] of blobs) {
    fillCircle(png, Math.round(bc * CELL), Math.round(br * CELL), Math.round(rad * CELL), FLOOR, 6);
  }
  // poça brilhante no centro
  fillCircle(png, 11 * CELL, 11 * CELL, CELL * 2.2, GLOW, 12);
  fillCircle(png, 11 * CELL, 11 * CELL, CELL * 1.3, [102, 150, 132], 10);
  // prateleiras de relíquias ao redor
  const relics = [[7, 7], [15, 7], [7, 15], [15, 15], [11, 4]];
  for (const [tc, tr] of relics) fillRect(png, tc * CELL - 12, tr * CELL - 8, 24, 16, RELIC, 10);
  save(png, 'Covil da Maré Cinzenta [22x22].png');
}

console.log('pronto —', OUT_DIR);
