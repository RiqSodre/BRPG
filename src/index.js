import 'dotenv/config';
import { initStore } from './store.js';
import { startBot } from './bot.js';
import { startServer } from './server.js';

// ffmpeg empacotado — o @discordjs/voice o encontra pelo PATH do processo
import ffmpegPath from 'ffmpeg-static';
import path from 'path';
if (ffmpegPath) {
  process.env.PATH = `${path.dirname(ffmpegPath)}${path.delimiter}${process.env.PATH}`;
  process.env.FFMPEG_PATH = ffmpegPath;
}

// Rede de segurança: uma promise rejeitada sem dono (ex: a API do Discord
// recusando uma resposta atrasada) derrubaria o processo inteiro no Node —
// e com ele o painel, a tela dos jogadores e o bot, no meio da sessão.
// Aqui a falha é registrada e a mesa continua de pé.
process.on('unhandledRejection', (err) => {
  console.error('[aviso] Promise rejeitada sem tratamento:', err?.message || err);
});

initStore();
startServer();
startBot().catch((err) => {
  console.error('[bot] Falha ao iniciar o bot do Discord:', err.message);
  console.error('[bot] O painel continua funcionando sem o bot.');
});
