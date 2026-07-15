// Mixer PCM: decodifica cada fonte com ffmpeg (s16le 48kHz estéreo) e soma
// as amostras em um único stream contínuo. Permite efeitos POR CIMA do
// ambiente, crossfade entre cenas, volume master ao vivo e uma faixa "ao
// vivo" alimentada por WebSocket (a Cabine do Mestre).
import { spawn } from 'child_process';
import { Readable } from 'stream';

const SAMPLE_RATE = 48000;
const CHANNELS = 2;
const FRAME_MS = 20;
const FRAME_SAMPLES = (SAMPLE_RATE * FRAME_MS) / 1000 * CHANNELS; // 1920 amostras int16
const FRAME_BYTES = FRAME_SAMPLES * 2; // 3840 bytes
const MAX_BUFFER_BYTES = SAMPLE_RATE * CHANNELS * 2 * 2; // ~2s por faixa de arquivo
const LIVE_MAX_BUFFER = FRAME_BYTES * 10; // ~200ms: teto de latência da voz ao vivo

let trackSeq = 0;

class BaseTrack {
  constructor({ volume = 1, fadeInMs = 0, meta = null } = {}) {
    this.id = `t${++trackSeq}`;
    this.volume = volume;
    this.meta = meta;
    this.chunks = [];
    this.buffered = 0;
    this.ended = false;   // sem mais dados, sair do mixer
    this.removed = false; // marcado para remoção imediata
    // Envelope de fade: ganho atual caminha até o alvo em passos por frame
    this.gain = fadeInMs > 0 ? 0 : 1;
    this.gainTarget = 1;
    this.gainStep = fadeInMs > 0 ? FRAME_MS / fadeInMs : 1;
    this.removeWhenSilent = false;
  }

  fadeOutAndRemove(fadeMs = 800) {
    this.gainTarget = 0;
    this.gainStep = fadeMs > 0 ? FRAME_MS / fadeMs : 1;
    this.removeWhenSilent = true;
  }

  destroy() {
    this.removed = true;
    this.chunks = [];
    this.buffered = 0;
  }

  _stepGain() {
    if (this.gain < this.gainTarget) this.gain = Math.min(this.gainTarget, this.gain + this.gainStep);
    else if (this.gain > this.gainTarget) this.gain = Math.max(this.gainTarget, this.gain - this.gainStep);
    if (this.removeWhenSilent && this.gain <= 0) this.destroy();
  }

  // Tira FRAME_BYTES do buffer (assume buffered >= FRAME_BYTES)
  _sliceFrame() {
    let frame;
    if (this.chunks[0].length >= FRAME_BYTES) {
      frame = this.chunks[0].subarray(0, FRAME_BYTES);
      this.chunks[0] = this.chunks[0].subarray(FRAME_BYTES);
      if (this.chunks[0].length === 0) this.chunks.shift();
    } else {
      const buf = Buffer.concat(this.chunks);
      frame = buf.subarray(0, FRAME_BYTES);
      this.chunks = [buf.subarray(FRAME_BYTES)];
    }
    this.buffered -= FRAME_BYTES;
    return frame;
  }
}

// Faixa de arquivo: decodificada por ffmpeg, com loop opcional
class FileTrack extends BaseTrack {
  constructor(filePath, { loop = false, ...opts } = {}) {
    super(opts);
    this.filePath = filePath;
    this.loop = loop;
    this._spawn();
  }

  _spawn() {
    this.ffmpegDone = false;
    this.proc = spawn(process.env.FFMPEG_PATH || 'ffmpeg', [
      '-loglevel', 'quiet',
      '-i', this.filePath,
      '-f', 's16le', '-ar', String(SAMPLE_RATE), '-ac', String(CHANNELS),
      'pipe:1',
    ], { stdio: ['ignore', 'pipe', 'ignore'] });

    this.proc.stdout.on('data', (chunk) => {
      this.chunks.push(chunk);
      this.buffered += chunk.length;
      if (this.buffered > MAX_BUFFER_BYTES) this.proc.stdout.pause();
    });
    this.proc.on('close', () => { this.ffmpegDone = true; });
    this.proc.on('error', () => { this.ffmpegDone = true; });
  }

  destroy() {
    try { this.proc.kill(); } catch { /* já encerrado */ }
    super.destroy();
  }

  readFrame() {
    this._stepGain();
    if (this.removed) return null;

    if (this.buffered < FRAME_BYTES) {
      if (this.ffmpegDone) {
        if (this.loop) { this._spawn(); return null; } // recomeça; silêncio neste frame
        if (this.buffered === 0) { this.ended = true; return null; }
        // resto final menor que um frame: completa com silêncio
        const tail = Buffer.concat(this.chunks, this.buffered);
        this.chunks = []; this.buffered = 0;
        const frame = Buffer.alloc(FRAME_BYTES);
        tail.copy(frame);
        return frame;
      }
      return null; // ffmpeg ainda enchendo o buffer — silêncio momentâneo
    }

    const frame = this._sliceFrame();
    if (this.buffered <= MAX_BUFFER_BYTES / 2 && !this.ffmpegDone) this.proc.stdout.resume();
    return frame;
  }
}

// Faixa ao vivo: recebe PCM por push() (s16le 48kHz estéreo). Silêncio em
// underrun; buffer limitado para a latência da voz não crescer.
class LiveTrack extends BaseTrack {
  constructor(opts = {}) {
    super(opts);
    this.closed = false;
  }

  push(buf) {
    if (this.closed || this.removed) return;
    this.chunks.push(buf);
    this.buffered += buf.length;
    while (this.buffered > LIVE_MAX_BUFFER && this.chunks.length > 1) {
      this.buffered -= this.chunks.shift().length; // descarta o mais antigo
    }
  }

  close() { this.closed = true; }

  readFrame() {
    this._stepGain();
    if (this.removed) return null;
    if (this.buffered < FRAME_BYTES) {
      if (this.closed && this.buffered === 0) this.ended = true;
      return null;
    }
    return this._sliceFrame();
  }
}

export class Mixer extends Readable {
  constructor() {
    super({ highWaterMark: FRAME_BYTES * 4 });
    this.tracks = new Map();
    this.master = 1;
    this.ambientTrackId = null;
    this.ambientMeta = null;
  }

  setMaster(v) { this.master = Math.max(0, Math.min(1, v)); }

  // Troca o som de fundo com crossfade; meta identifica o áudio (id/nome)
  playAmbient(filePath, { volume = 1, fadeMs = 1500, meta = null } = {}) {
    const old = this.tracks.get(this.ambientTrackId);
    if (old) old.fadeOutAndRemove(fadeMs);
    const track = new FileTrack(filePath, { loop: true, volume, fadeInMs: old ? fadeMs : 300, meta });
    this.tracks.set(track.id, track);
    this.ambientTrackId = track.id;
    this.ambientMeta = meta;
    return track.id;
  }

  // Efeito tocado por cima de tudo, removido sozinho ao terminar
  playOneShot(filePath, { volume = 1 } = {}) {
    const track = new FileTrack(filePath, { loop: false, volume });
    this.tracks.set(track.id, track);
    return track.id;
  }

  // Faixa ao vivo (Cabine do Mestre): o chamador faz track.push(pcm)
  addLiveTrack({ volume = 1 } = {}) {
    const track = new LiveTrack({ volume, fadeInMs: 100 });
    this.tracks.set(track.id, track);
    return track;
  }

  stopAll(fadeMs = 600) {
    for (const t of this.tracks.values()) {
      if (t instanceof LiveTrack) continue; // a cabine não é derrubada pelo "parar som"
      t.fadeOutAndRemove(fadeMs);
    }
    this.ambientTrackId = null;
    this.ambientMeta = null;
  }

  get playing() { return this.ambientMeta; }

  _read() {
    const out = new Int16Array(FRAME_SAMPLES);
    for (const [id, track] of this.tracks) {
      const frame = track.readFrame();
      if (track.removed || track.ended) {
        track.destroy();
        this.tracks.delete(id);
        if (id === this.ambientTrackId) { this.ambientTrackId = null; this.ambientMeta = null; }
        continue;
      }
      if (!frame) continue;
      const gain = track.gain * track.volume * this.master;
      if (gain <= 0) continue;
      const samples = new Int16Array(frame.buffer, frame.byteOffset, FRAME_SAMPLES);
      for (let i = 0; i < FRAME_SAMPLES; i++) {
        const mixed = out[i] + samples[i] * gain;
        out[i] = mixed > 32767 ? 32767 : mixed < -32768 ? -32768 : mixed;
      }
    }
    this.push(Buffer.from(out.buffer));
  }
}
