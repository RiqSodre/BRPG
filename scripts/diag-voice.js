// Diagnóstico da conexão de voz: mostra cada transição de estado e erro.
// Uso: node scripts/diag-voice.js <id-do-canal-de-voz>
import 'dotenv/config';
import { Client, GatewayIntentBits } from 'discord.js';
import { joinVoiceChannel, VoiceConnectionStatus, generateDependencyReport } from '@discordjs/voice';

console.log(generateDependencyReport());

const channelId = process.argv[2];
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });

client.once('clientReady', async () => {
  console.log(`[diag] logado como ${client.user.tag}`);
  const guild = await client.guilds.fetch(process.env.DISCORD_GUILD_ID);
  const conn = joinVoiceChannel({
    channelId,
    guildId: guild.id,
    adapterCreator: guild.voiceAdapterCreator,
    debug: true,
  });
  conn.on('stateChange', (oldS, newS) => console.log(`[estado] ${oldS.status} -> ${newS.status}`));
  conn.on('error', (e) => console.log(`[erro] ${e.message}`));
  conn.on('debug', (m) => console.log(`[debug] ${m.slice(0, 200)}`));
  conn.on(VoiceConnectionStatus.Ready, () => {
    console.log('[diag] CONEXÃO PRONTA! Voz funcionando.');
    setTimeout(() => process.exit(0), 1000);
  });
  setTimeout(() => {
    console.log(`[diag] TIMEOUT — estado final: ${conn.state.status}`);
    process.exit(1);
  }, 20000);
});

client.login(process.env.DISCORD_TOKEN);
