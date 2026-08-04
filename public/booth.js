// Cabine do Mestre — captura o microfone no navegador, aplica efeitos
// (pitch, reverb, distorção) e transmite PCM ao bot via WebSocket.
// Carregado antes de app.js, que monta a interface da aba.

const WORKLET_CODE = `
// Pitch shifter por linha de atraso modulada (duas leituras com janelas
// senoidais cruzadas — o clássico "doppler shifter").
class PitchShifter extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{ name: 'pitch', defaultValue: 0, minValue: -12, maxValue: 12 }];
  }
  constructor() {
    super();
    this.N = 1 << 15;
    this.buf = new Float32Array(this.N);
    this.w = 0;
    this.phase = 0;
    this.W = 2400; // janela de ~50ms @48kHz
  }
  read(pos) {
    pos = ((pos % this.N) + this.N) % this.N;
    const i0 = Math.floor(pos);
    const i1 = (i0 + 1) % this.N;
    const f = pos - i0;
    return this.buf[i0] * (1 - f) + this.buf[i1] * f;
  }
  process(inputs, outputs, parameters) {
    const inp = inputs[0][0];
    const out = outputs[0][0];
    if (!inp || !out) return true;
    const semi = parameters.pitch[0];
    if (Math.abs(semi) < 0.01) { out.set(inp); for (let i = 0; i < inp.length; i++) { this.buf[this.w] = inp[i]; this.w = (this.w + 1) % this.N; } return true; }
    const rate = Math.pow(2, semi / 12);
    for (let i = 0; i < inp.length; i++) {
      this.buf[this.w] = inp[i];
      this.phase = (((this.phase + (1 - rate)) % this.W) + this.W) % this.W;
      const d1 = this.phase;
      const d2 = (this.phase + this.W / 2) % this.W;
      const g1 = Math.sin(Math.PI * d1 / this.W);
      const g2 = Math.sin(Math.PI * d2 / this.W);
      out[i] = this.read(this.w - d1) * g1 + this.read(this.w - d2) * g2;
      this.w = (this.w + 1) % this.N;
    }
    return true;
  }
}
registerProcessor('pitch-shifter', PitchShifter);

// Captura o áudio processado e envia ao main thread em blocos de 128 amostras
class BoothCapture extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0][0];
    if (ch) this.port.postMessage(ch.slice(0));
    return true;
  }
}
registerProcessor('booth-capture', BoothCapture);
`;

const booth = {
  ctx: null,
  stream: null,
  nodes: {},
  ws: null,
  onAir: false,
  micReady: false,
  fx: { pitch: 0, reverb: 0, distortion: 0, gain: 2, robot: 0, radio: 0, echo: 0 },
  sendBuf: new Float32Array(960), // 20ms mono @48kHz
  sendLen: 0,
  onStatus: null, // callback da UI
};

function boothNotify(msg, isError = false) {
  booth.onStatus?.(msg, isError);
}

// Impulso de reverb procedural: ruído com decaimento exponencial (~1.8s)
function makeImpulse(ctx) {
  const len = Math.floor(ctx.sampleRate * 1.8);
  const impulse = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const data = impulse.getChannelData(c);
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-3.5 * (i / len));
    }
  }
  return impulse;
}

function distortionCurve(amount) {
  const n = 1024;
  const curve = new Float32Array(n);
  const k = amount * 60;
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    curve[i] = k > 0 ? Math.atan(k * x) / Math.atan(k) : x;
  }
  return curve;
}

async function boothInitMic() {
  if (booth.micReady) return true;
  try {
    booth.ctx = new AudioContext({ sampleRate: 48000 });
    const blob = new Blob([WORKLET_CODE], { type: 'application/javascript' });
    await booth.ctx.audioWorklet.addModule(URL.createObjectURL(blob));
    booth.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });

    const n = booth.nodes;
    n.source = booth.ctx.createMediaStreamSource(booth.stream);
    n.pitch = new AudioWorkletNode(booth.ctx, 'pitch-shifter');
    n.shaper = booth.ctx.createWaveShaper();
    n.shaper.curve = distortionCurve(0);
    n.dry = booth.ctx.createGain();
    n.wet = booth.ctx.createGain();
    n.wet.gain.value = 0;
    n.convolver = booth.ctx.createConvolver();
    n.convolver.buffer = makeImpulse(booth.ctx);
    n.bus = booth.ctx.createGain();
    n.capture = new AudioWorkletNode(booth.ctx, 'booth-capture');
    n.monitor = booth.ctx.createGain();
    n.monitor.gain.value = 0;

    // Robô: modulação em anel — um osciladorzinho conectado no AudioParam de ganho faz
    // o sinal seguir sin(2πft), que é a definição de ring modulation. Nativo, sem
    // precisar de worklet: a base do gain fica sempre em 0, e um gain intermediário
    // (robotDepth) controla o quanto o osc "empurra" esse ganho — a intensidade do slider.
    n.robotOsc = booth.ctx.createOscillator();
    n.robotOsc.frequency.value = 45;
    n.robotDepth = booth.ctx.createGain();
    n.robotDepth.gain.value = 0;
    n.robotGain = booth.ctx.createGain();
    n.robotGain.gain.value = 0;
    n.robotOsc.connect(n.robotDepth).connect(n.robotGain.gain);
    n.robotOsc.start();
    n.robotWet = booth.ctx.createGain();
    n.robotWet.gain.value = 0;

    // Rádio/comunicador: corta graves e agudos (banda estreita = "voz de rádio").
    n.radioFilter = booth.ctx.createBiquadFilter();
    n.radioFilter.type = 'bandpass';
    n.radioFilter.frequency.value = 1500;
    n.radioFilter.Q.value = 1.6;
    n.radioWet = booth.ctx.createGain();
    n.radioWet.gain.value = 0;

    // Eco: delay curto com realimentação — repetições que vão sumindo.
    n.echoDelay = booth.ctx.createDelay(1.0);
    n.echoDelay.delayTime.value = 0.18;
    n.echoFeedback = booth.ctx.createGain();
    n.echoFeedback.gain.value = 0.35;
    n.echoWet = booth.ctx.createGain();
    n.echoWet.gain.value = 0;

    n.source.connect(n.pitch);
    n.pitch.connect(n.shaper);
    n.shaper.connect(n.dry).connect(n.bus);
    n.shaper.connect(n.convolver).connect(n.wet).connect(n.bus);
    n.shaper.connect(n.robotGain).connect(n.robotWet).connect(n.bus);
    n.shaper.connect(n.radioFilter).connect(n.radioWet).connect(n.bus);
    n.shaper.connect(n.echoDelay);
    n.echoDelay.connect(n.echoFeedback).connect(n.echoDelay);
    n.echoDelay.connect(n.echoWet).connect(n.bus);
    n.bus.connect(n.capture);
    n.bus.connect(n.monitor).connect(booth.ctx.destination);

    n.capture.port.onmessage = (e) => boothOnAudio(e.data);
    booth.micReady = true;
    boothApplyFx();
    return true;
  } catch (err) {
    boothNotify(`Não consegui acessar o microfone: ${err.message}`, true);
    return false;
  }
}

// Acumula 20ms, converte para s16le estéreo e envia
function boothOnAudio(chunk) {
  if (!booth.onAir || !booth.ws || booth.ws.readyState !== 1) return;
  let data = chunk;
  // Se o navegador não honrou 48kHz, reamostra linearmente
  if (booth.ctx.sampleRate !== 48000) {
    const ratio = 48000 / booth.ctx.sampleRate;
    const out = new Float32Array(Math.floor(chunk.length * ratio));
    for (let i = 0; i < out.length; i++) {
      const pos = i / ratio;
      const i0 = Math.floor(pos);
      const f = pos - i0;
      out[i] = chunk[i0] * (1 - f) + (chunk[i0 + 1] ?? chunk[i0]) * f;
    }
    data = out;
  }
  for (const sample of data) {
    booth.sendBuf[booth.sendLen++] = sample;
    if (booth.sendLen === booth.sendBuf.length) {
      const pcm = new Int16Array(booth.sendBuf.length * 2); // mono -> estéreo
      for (let i = 0; i < booth.sendBuf.length; i++) {
        const v = Math.max(-1, Math.min(1, booth.sendBuf[i]));
        const s = Math.round(v * 32767);
        pcm[i * 2] = s;
        pcm[i * 2 + 1] = s;
      }
      booth.ws.send(pcm.buffer);
      booth.sendLen = 0;
    }
  }
}

function boothApplyFx() {
  if (!booth.micReady) return;
  const n = booth.nodes;
  const t = booth.ctx.currentTime;
  n.pitch.parameters.get('pitch').setValueAtTime(booth.fx.pitch, t);
  n.shaper.curve = distortionCurve(booth.fx.distortion);
  n.wet.gain.setTargetAtTime(booth.fx.reverb * 1.2, t, 0.05);
  n.dry.gain.setTargetAtTime(1 - booth.fx.reverb * 0.4, t, 0.05);
  n.robotDepth.gain.setTargetAtTime(booth.fx.robot, t, 0.02); // profundidade da modulação em anel
  n.robotWet.gain.setTargetAtTime(booth.fx.robot, t, 0.05);
  n.radioWet.gain.setTargetAtTime(booth.fx.radio * 1.4, t, 0.05);
  n.echoFeedback.gain.setTargetAtTime(0.2 + booth.fx.echo * 0.3, t, 0.05); // mais eco = repete mais vezes
  n.echoWet.gain.setTargetAtTime(booth.fx.echo, t, 0.05);
  if (booth.onAir && booth.ws?.readyState === 1) {
    booth.ws.send(JSON.stringify({ type: 'gain', gain: booth.fx.gain }));
  }
}

function boothSetMonitor(on) {
  if (booth.micReady) booth.nodes.monitor.gain.value = on ? 1 : 0;
}

async function boothGoOnAir() {
  if (!(await boothInitMic())) return false;
  await booth.ctx.resume();
  return new Promise((resolve) => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    booth.ws = new WebSocket(`${proto}://${location.host}/booth`);
    booth.ws.binaryType = 'arraybuffer';
    booth.ws.onopen = () => booth.ws.send(JSON.stringify({ type: 'start', gain: booth.fx.gain }));
    booth.ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'started') {
          booth.onAir = true;
          boothNotify('NO AR — sua voz está saindo pelo bot!');
          resolve(true);
        } else if (msg.type === 'error') {
          boothNotify(msg.error, true);
          booth.ws.close();
          resolve(false);
        }
      } catch { /* binário, ignora */ }
    };
    booth.ws.onclose = () => {
      booth.onAir = false;
      boothNotify('Fora do ar.');
    };
    booth.ws.onerror = () => {
      boothNotify('Falha na conexão com o servidor.', true);
      resolve(false);
    };
  });
}

function boothOffAir() {
  if (booth.ws?.readyState === 1) booth.ws.send(JSON.stringify({ type: 'stop' }));
  booth.ws?.close();
  booth.onAir = false;
}
