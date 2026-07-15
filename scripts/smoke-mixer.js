// Teste de fumaça do mixer: gera tons com ffmpeg, mixa e confere o resultado.
// Uso: node scripts/smoke-mixer.js
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import ffmpegPath from 'ffmpeg-static';
import { Mixer } from '../src/mixer.js';

process.env.FFMPEG_PATH = ffmpegPath;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mixer-test-'));
const toneA = path.join(tmp, 'toneA.wav');
const toneB = path.join(tmp, 'toneB.wav');
spawnSync(ffmpegPath, ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-ar', '48000', '-ac', '2', toneA]);
spawnSync(ffmpegPath, ['-f', 'lavfi', '-i', 'sine=frequency=880:duration=1', '-ar', '48000', '-ac', '2', toneB]);

const FRAME_BYTES = 3840;
const mixer = new Mixer();
const rms = (buf) => {
  const s = new Int16Array(buf.buffer, buf.byteOffset, buf.length / 2);
  let sum = 0;
  for (const v of s) sum += v * v;
  return Math.sqrt(sum / s.length);
};
const readFrames = (n) => {
  const out = [];
  for (let i = 0; i < n; i++) {
    let chunk = mixer.read(FRAME_BYTES);
    if (!chunk) { mixer._read(); chunk = mixer.read(FRAME_BYTES); }
    out.push(chunk ?? Buffer.alloc(FRAME_BYTES));
  }
  return out;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const assert = (cond, msg) => { if (!cond) { console.error(`FALHOU: ${msg}`); process.exit(1); } console.log(`ok: ${msg}`); };

// 1. Sem faixas → silêncio
let frames = readFrames(5);
assert(frames.every((f) => rms(f) === 0), 'sem faixas, o mixer emite silêncio');

// 2. Ambiente sozinho
mixer.playAmbient(toneA, { meta: { id: 'a', name: 'Tom A' } });
await sleep(400); // ffmpeg decodifica
readFrames(30);
const ambientRms = rms(readFrames(1)[0]);
assert(ambientRms > 500, `ambiente audível (RMS ${ambientRms.toFixed(0)})`);
assert(mixer.playing?.id === 'a', 'nowPlaying aponta para o ambiente');

// 3. Efeito por cima do ambiente → energia maior que o ambiente sozinho
mixer.playOneShot(toneB);
await sleep(400);
readFrames(10);
const mixedRms = rms(readFrames(1)[0]);
assert(mixedRms > ambientRms * 1.2, `efeito soma por cima do ambiente (RMS ${mixedRms.toFixed(0)} > ${ambientRms.toFixed(0)})`);

// 4. Crossfade: trocar ambiente não derruba o som para zero no meio
mixer.playAmbient(toneB, { fadeMs: 200, meta: { id: 'b', name: 'Tom B' } });
await sleep(400);
const during = readFrames(10).map(rms);
assert(during.some((v) => v > 300), 'som contínuo durante o crossfade');
assert(mixer.playing?.id === 'b', 'nowPlaying atualizado após crossfade');

// 5. stopAll esvazia as faixas após o fade
mixer.stopAll(100);
readFrames(30);
await sleep(200);
readFrames(30);
assert(mixer.tracks.size === 0, 'stopAll remove todas as faixas após o fade');
assert(rms(readFrames(1)[0]) === 0, 'silêncio após stopAll');

// 6. Loop: ambiente de 1s continua tocando depois de >1s de leitura
mixer.playAmbient(toneB, { meta: { id: 'loop', name: 'Loop' } });
await sleep(300);
readFrames(60); // ~1.2s
await sleep(300);
readFrames(10);
const loopRms = rms(readFrames(1)[0]);
assert(loopRms > 300, `loop reinicia o áudio (RMS ${loopRms.toFixed(0)})`);

// 7. Faixa ao vivo: push de PCM aparece na saída e "parar som" não a derruba
mixer.stopAll(50);
readFrames(20);
await sleep(100);
readFrames(20);
const live = mixer.addLiveTrack({ volume: 1 });
const tone = new Int16Array(1920 * 20);
for (let i = 0; i < tone.length; i++) tone[i] = Math.round(8000 * Math.sin(i / 10));
live.push(Buffer.from(tone.buffer));
readFrames(8); // consome o fade-in de 100ms
const liveRms = rms(readFrames(1)[0]);
assert(liveRms > 1000, `faixa ao vivo audível (RMS ${liveRms.toFixed(0)})`);
mixer.playAmbient(toneA, { meta: { id: 'amb2', name: 'Ambiente' } });
mixer.stopAll(50);
assert(mixer.tracks.has(live.id), 'stopAll não derruba a cabine ao vivo');
live.close();
readFrames(40);
assert(!mixer.tracks.has(live.id), 'faixa ao vivo sai do mixer ao fechar');

console.log('\nTodos os testes do mixer passaram!');
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(0);
