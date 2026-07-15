// Vozes de NPC via Edge TTS (gratuito): gera MP3 que o bot toca no canal
// de voz por cima do ambiente. Cada NPC pode ter voz, tom e ritmo próprios.
import fs from 'fs';
import path from 'path';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import { DATA_DIR } from './store.js';

export const TTS_DIR = path.join(DATA_DIR, 'tts');

export const VOICES = [
  { id: 'pt-BR-AntonioNeural', label: 'Antônio — masculina (BR)' },
  { id: 'pt-BR-FranciscaNeural', label: 'Francisca — feminina (BR)' },
  { id: 'pt-BR-ThalitaNeural', label: 'Thalita — feminina jovem (BR)' },
  { id: 'pt-PT-DuarteNeural', label: 'Duarte — masculina (PT, soa "estrangeiro")' },
  { id: 'pt-PT-RaquelNeural', label: 'Raquel — feminina (PT, soa "estrangeira")' },
];

const MAX_CACHED_FILES = 30;

export async function synthesize(text, { voice = 'pt-BR-AntonioNeural', rate = 0, pitch = 0 } = {}) {
  if (!text?.trim()) throw new Error('Nada para falar.');
  fs.mkdirSync(TTS_DIR, { recursive: true });

  const tts = new MsEdgeTTS();
  await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
  const { audioStream } = await tts.toStream(text.slice(0, 1500), {
    rate: `${rate >= 0 ? '+' : ''}${Number(rate)}%`,
    pitch: `${pitch >= 0 ? '+' : ''}${Number(pitch)}Hz`,
  });

  const filename = `fala-${Date.now()}.mp3`;
  const filePath = path.join(TTS_DIR, filename);
  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(filePath);
    audioStream.pipe(out);
    out.on('finish', resolve);
    out.on('error', reject);
    audioStream.on('error', reject);
  });

  cleanup();
  return { filePath, url: `/tts-files/${filename}` };
}

// Mantém só os MP3 mais recentes para a pasta não crescer sem limite
function cleanup() {
  const files = fs.readdirSync(TTS_DIR)
    .filter((f) => f.endsWith('.mp3'))
    .map((f) => ({ f, t: fs.statSync(path.join(TTS_DIR, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  for (const { f } of files.slice(MAX_CACHED_FILES)) {
    try { fs.unlinkSync(path.join(TTS_DIR, f)); } catch { /* em uso */ }
  }
}
