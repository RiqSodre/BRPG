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

initStore();
startServer();
startBot().catch((err) => {
  console.error('[bot] Falha ao iniciar o bot do Discord:', err.message);
  console.error('[bot] O painel continua funcionando sem o bot.');
});
