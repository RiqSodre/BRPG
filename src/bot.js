// Bot do Discord: presença no canal de voz, reprodução automática de áudio
// das cenas (ambiente em loop), soundboard de efeitos e postagem de cenas.
import fs from 'fs';
import path from 'path';
import {
  Client, GatewayIntentBits, EmbedBuilder, ChannelType, AttachmentBuilder,
  REST, Routes, SlashCommandBuilder,
} from 'discord.js';
import {
  joinVoiceChannel, getVoiceConnection, createAudioPlayer, createAudioResource,
  AudioPlayerStatus, NoSubscriberBehavior, StreamType, VoiceConnectionStatus, entersState,
} from '@discordjs/voice';
import { Mixer } from './mixer.js';
import { getDb, getItem, updateItem, save, AUDIO_DIR, IMAGES_DIR } from './store.js';

// Cores de raridade no embed — a mesma linguagem visual de loot que os jogadores conhecem.
const RARITY_COLOR = {
  'Comum': 0x9d9d9d,
  'Incomum': 0x1eff00,
  'Raro': 0x0070dd,
  'Muito raro': 0xa335ee,
  'Lendário': 0xff8000,
  'Artefato': 0xe6cc80,
};

const GUILD_ID = process.env.DISCORD_GUILD_ID;

let client = null;

// Um único player alimentado pelo mixer: ambiente em loop + efeitos por cima,
// com crossfade entre cenas e volume master ao vivo.
const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Play } });
let mixer = null;

player.on('error', (err) => {
  console.error('[bot] Erro no player de áudio:', err.message);
  mixer = null; // próximo som recria o stream
});

function audioPath(audio) {
  return path.join(AUDIO_DIR, audio.filename);
}

function masterVolume() {
  return getDb().settings.volume ?? 0.4;
}

function ensureMixer() {
  if (!mixer) {
    mixer = new Mixer();
    mixer.setMaster(masterVolume());
  }
  if (player.state.status !== AudioPlayerStatus.Playing) {
    player.play(createAudioResource(mixer, { inputType: StreamType.Raw }));
  }
  return mixer;
}

export async function startBot() {
  if (!process.env.DISCORD_TOKEN) {
    console.warn('[bot] DISCORD_TOKEN não definido — o painel funciona, mas o bot fica desligado.');
    return null;
  }
  client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
  });

  // onInteraction é async: sem este .catch, qualquer erro dela viraria uma
  // promise rejeitada sem dono — que no Node derruba o processo inteiro.
  client.on('interactionCreate', (i) => onInteraction(i).catch((err) =>
    console.error('[bot] Falha não tratada na interação:', err)));

  await client.login(process.env.DISCORD_TOKEN);
  await new Promise((res) => client.once('clientReady', res));
  console.log(`[bot] Conectado como ${client.user.tag}`);

  await registerCommands();
  return client;
}

async function registerCommands() {
  if (!GUILD_ID) return;
  const commands = [
    new SlashCommandBuilder().setName('entrar').setDescription('O bot entra no seu canal de voz para tocar os sons da campanha'),
    new SlashCommandBuilder().setName('sair').setDescription('O bot sai do canal de voz'),
    new SlashCommandBuilder().setName('rolar').setDescription('Rola dados (ex: 1d20+5, 2d6)')
      .addStringOption((o) => o.setName('dados').setDescription('Expressão, ex: 1d20+5').setRequired(true)),
    new SlashCommandBuilder().setName('vincular').setDescription('Vincula seu usuário do Discord ao seu personagem da campanha')
      .addStringOption((o) => o.setName('personagem').setDescription('Seu personagem').setRequired(true).setAutocomplete(true)),
    new SlashCommandBuilder().setName('inventario').setDescription('Abre a mochila do seu personagem'),
  ].map((c) => c.toJSON());
  const rest = new REST().setToken(process.env.DISCORD_TOKEN);
  await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), { body: commands });
  console.log('[bot] Comandos /entrar, /sair, /rolar, /vincular e /inventario registrados.');
}

async function onInteraction(interaction) {
  if (interaction.isAutocomplete() && interaction.commandName === 'vincular') {
    try {
      const typed = interaction.options.getFocused().toLowerCase();
      const pcs = getDb().characters.filter((c) => c.type === 'pc' && c.name.toLowerCase().includes(typed));
      await interaction.respond(pcs.slice(0, 25).map((c) => ({ name: c.name, value: c.id })));
    } catch (err) {
      console.error('[bot] Falha no autocomplete de /vincular:', err.message);
    }
    return;
  }
  if (!interaction.isChatInputCommand()) return;
  try {
    if (interaction.commandName === 'entrar') {
      const channel = interaction.member?.voice?.channel;
      if (!channel) {
        await interaction.reply({ content: 'Entre em um canal de voz primeiro!', ephemeral: true });
        return;
      }
      // Conectar na voz pode levar até 15s, mas o Discord invalida a interação
      // em 3s. Avisa que estamos processando antes de tentar entrar.
      await interaction.deferReply();
      await joinChannel(channel.id);
      await interaction.editReply(`🎵 Entrei em **${channel.name}**. A trilha da campanha está nas mãos do Mestre...`);
    } else if (interaction.commandName === 'sair') {
      leaveVoice();
      await interaction.reply('👋 Saí do canal de voz.');
    } else if (interaction.commandName === 'vincular') {
      const charId = interaction.options.getString('personagem');
      const character = getItem('characters', charId);
      if (!character || character.type !== 'pc') {
        await interaction.reply({ content: 'Personagem não encontrado — peça ao Mestre para criar sua ficha no painel.', ephemeral: true });
        return;
      }
      updateItem('characters', charId, { discordUserId: interaction.user.id, discordTag: interaction.user.username });
      await interaction.reply({ content: `🔗 Pronto! Você agora é **${character.name}**. O Mestre pode te enviar segredos por DM... 👀`, ephemeral: true });
    } else if (interaction.commandName === 'rolar') {
      const expr = interaction.options.getString('dados');
      const result = rollDice(expr);
      await interaction.reply(result.error
        ? `❌ ${result.error}`
        : `🎲 **${interaction.member?.displayName ?? interaction.user.username}** rolou \`${expr}\`:\n${result.detail} = **${result.total}**`);
    } else if (interaction.commandName === 'inventario') {
      const db = getDb();
      const ch = db.characters.find((c) => c.discordUserId === interaction.user.id);
      if (!ch) {
        await interaction.reply({ content: 'Você ainda não vinculou seu personagem. Use `/vincular` primeiro.', ephemeral: true });
        return;
      }
      const inv = (ch.inventory || []).filter((l) => getItem('items', l.itemId));
      if (!inv.length) {
        await interaction.reply({ content: `🎒 A mochila de **${ch.name}** está vazia.`, ephemeral: true });
        return;
      }
      const linhas = inv.map((l) => {
        const it = getItem('items', l.itemId);
        const meta = [it.type, it.rarity].filter(Boolean).join(' · ');
        const desc = it.description ? `\n${it.description.slice(0, 140)}${it.description.length > 140 ? '…' : ''}` : '';
        return `**${l.qty}× ${it.name}**${meta ? ` — _${meta}_` : ''}${desc}`;
      });
      const embed = new EmbedBuilder()
        .setTitle(`🎒 Mochila de ${ch.name}`)
        .setColor(0xc4a747)
        .setDescription(linhas.join('\n\n').slice(0, 4000))
        .setFooter({ text: `${inv.length} item(ns) · ${db.settings.campaignName}` });
      if (/^https?:\/\//i.test(ch.imageUrl || '')) embed.setThumbnail(ch.imageUrl);
      await interaction.reply({ embeds: [embed], ephemeral: true });
    }
  } catch (err) {
    console.error('[bot] Erro na interação:', err);
    // Mostra o motivo real ao jogador, respeitando o estado da interação:
    // se já foi adiada (deferReply), reply() falharia com "already acknowledged".
    const texto = `❌ ${err.message || 'Algo deu errado.'}`;
    try {
      if (interaction.deferred) await interaction.editReply({ content: texto });
      else if (!interaction.replied) await interaction.reply({ content: texto, ephemeral: true });
    } catch { /* a interação expirou (>3s) — não há o que responder */ }
  }
}

export function rollDice(expr) {
  const clean = String(expr).toLowerCase().replace(/\s/g, '');
  const m = clean.match(/^(\d*)d(\d+)(?:([+-])(\d+))?$/);
  if (!m) return { error: 'Formato inválido. Use algo como 1d20+5 ou 2d6.' };
  const count = Math.min(parseInt(m[1] || '1', 10), 100);
  const sides = Math.min(parseInt(m[2], 10), 1000);
  const mod = m[3] ? (m[3] === '-' ? -1 : 1) * parseInt(m[4], 10) : 0;
  if (count < 1 || sides < 2) return { error: 'Dados inválidos.' };
  const rolls = Array.from({ length: count }, () => 1 + Math.floor(Math.random() * sides));
  const total = rolls.reduce((a, b) => a + b, 0) + mod;
  const detail = `[${rolls.join(', ')}]${mod ? (mod > 0 ? ` + ${mod}` : ` - ${-mod}`) : ''}`;
  return { rolls, mod, total, detail };
}

// ---------- Voz ----------

export async function joinChannel(channelId) {
  if (!client) throw new Error('Bot não está conectado (verifique o DISCORD_TOKEN).');
  const guild = await client.guilds.fetch(GUILD_ID);
  const channel = await guild.channels.fetch(channelId);
  if (!channel || channel.type !== ChannelType.GuildVoice) throw new Error('Canal de voz não encontrado.');
  const conn = joinVoiceChannel({
    channelId: channel.id,
    guildId: guild.id,
    adapterCreator: guild.voiceAdapterCreator,
  });
  await entersState(conn, VoiceConnectionStatus.Ready, 15_000);
  ensureMixer();
  conn.subscribe(player);
  getDb().settings.voiceChannelId = channelId;
  save();
  return channel.name;
}

export function leaveVoice() {
  stopAll();
  const conn = GUILD_ID ? getVoiceConnection(GUILD_ID) : null;
  conn?.destroy();
}

export function isInVoice() {
  return Boolean(GUILD_ID && getVoiceConnection(GUILD_ID));
}

function requireVoice() {
  const conn = GUILD_ID ? getVoiceConnection(GUILD_ID) : null;
  if (!conn) throw new Error('O bot não está em um canal de voz. Use /entrar no Discord ou o botão no painel.');
  return conn;
}

export function playAmbient(audio) {
  requireVoice();
  ensureMixer().playAmbient(audioPath(audio), {
    volume: audio.volume ?? 1,
    meta: { id: audio.id, name: audio.name },
  });
}

export function playSfx(audio) {
  requireVoice();
  ensureMixer().playOneShot(audioPath(audio), { volume: audio.volume ?? 1 });
}

// Toca um arquivo arbitrário (ex: fala TTS de NPC) por cima do ambiente
export function playFile(filePath, volume = 1) {
  requireVoice();
  ensureMixer().playOneShot(filePath, { volume });
}

export function stopAll() {
  mixer?.stopAll();
}

// ---------- Cabine do Mestre (voz ao vivo) ----------
let boothTrack = null;

export function boothStart(gain = 2) {
  requireVoice();
  if (boothTrack) boothStop();
  boothTrack = ensureMixer().addLiveTrack({ volume: gain });
}

export function boothPush(pcm) {
  boothTrack?.push(pcm);
}

export function boothSetGain(gain) {
  if (boothTrack) boothTrack.volume = Math.max(0, Math.min(4, Number(gain) || 0));
}

export function boothStop() {
  boothTrack?.fadeOutAndRemove(150);
  boothTrack?.close();
  boothTrack = null;
}

export function boothActive() {
  return Boolean(boothTrack);
}

export function setVolume(v) {
  getDb().settings.volume = v;
  save();
  mixer?.setMaster(v); // ao vivo, sem reiniciar a faixa
}

export function nowPlaying() {
  return mixer?.playing ?? null;
}

// ---------- Canais e postagem de cenas ----------

export async function listChannels() {
  if (!client || !GUILD_ID) return { text: [], voice: [] };
  const guild = await client.guilds.fetch(GUILD_ID);
  const channels = await guild.channels.fetch();
  const text = [];
  const voice = [];
  for (const ch of channels.values()) {
    if (!ch) continue;
    if (ch.type === ChannelType.GuildText) text.push({ id: ch.id, name: ch.name });
    if (ch.type === ChannelType.GuildVoice) voice.push({ id: ch.id, name: ch.name });
  }
  return { text, voice };
}

export async function postScene(scene) {
  const db = getDb();
  if (!client || !db.settings.textChannelId) return false;
  const guild = await client.guilds.fetch(GUILD_ID);
  const channel = await guild.channels.fetch(db.settings.textChannelId);
  if (!channel) return false;

  const embed = new EmbedBuilder()
    .setTitle(`🎭 ${scene.title}`)
    .setDescription(scene.readAloud || '*...*')
    .setColor(0x7c3aed)
    .setFooter({ text: db.settings.campaignName });
  if (scene.imageUrl) embed.setImage(scene.imageUrl);
  await channel.send({ embeds: [embed] });
  return true;
}

// Explica por que uma postagem no Discord não sairia (bot desligado ou canal não
// definido). Devolve null quando está tudo pronto para postar.
export function postBlockedReason() {
  const db = getDb();
  if (!client) return 'O bot do Discord está desconectado — confira o DISCORD_TOKEN no arquivo .env e reinicie o servidor.';
  if (!db.settings.textChannelId) return 'Nenhum canal de texto definido. Vá em ⚙️ Config → "Canal de texto para cenas e recaps", escolha um canal e clique em Salvar.';
  return null;
}

export async function postMessage(content) {
  const db = getDb();
  if (!client || !db.settings.textChannelId) return false;
  const guild = await client.guilds.fetch(GUILD_ID);
  const channel = await guild.channels.fetch(db.settings.textChannelId);
  if (!channel) return false;
  await channel.send(content);
  return true;
}

// Monta o embed de um item. Imagens locais (upload) o Discord não consegue baixar,
// então o arquivo vai anexado e o embed aponta para o anexo.
function itemEmbed(item, qty = 1, header = '🎒 Você recebeu um item') {
  const meta = [item.type, item.rarity].filter(Boolean).join(' · ');
  const embed = new EmbedBuilder()
    .setAuthor({ name: header })
    .setTitle(`${qty > 1 ? `${qty}× ` : ''}${item.name}`)
    .setColor(RARITY_COLOR[item.rarity] ?? 0x9d9d9d)
    .setFooter({ text: getDb().settings.campaignName });
  const desc = [meta ? `_${meta}_` : '', item.description || ''].filter(Boolean).join('\n\n');
  if (desc) embed.setDescription(desc);

  const files = [];
  const url = item.imageUrl || '';
  if (url.startsWith('/images/')) {
    const p = path.join(IMAGES_DIR, path.basename(url));
    if (fs.existsSync(p)) {
      const nome = path.basename(p);
      files.push(new AttachmentBuilder(p, { name: nome }));
      embed.setThumbnail(`attachment://${nome}`);
    }
  } else if (/^https?:\/\//i.test(url)) {
    embed.setThumbnail(url);
  }
  return { embed, files };
}

// Entrega um item ao jogador vinculado ao personagem, por DM.
export async function sendItemToPlayer(character, item, qty = 1) {
  if (!client) throw new Error('O bot do Discord está desconectado — confira o DISCORD_TOKEN no .env.');
  if (!character?.discordUserId) {
    throw new Error(`${character?.name ?? 'Esse personagem'} não está vinculado a um jogador. Peça para ele usar /vincular no Discord.`);
  }
  const { embed, files } = itemEmbed(item, qty);
  try {
    const user = await client.users.fetch(character.discordUserId);
    await user.send({ embeds: [embed], files });
  } catch {
    throw new Error(`Não consegui mandar DM para ${character.name} — o jogador precisa aceitar mensagens diretas do servidor.`);
  }
  return true;
}

// Envia um handout: por DM a jogadores específicos ou no canal de texto para todos.
export async function sendHandout({ characterIds = [], toChannel = false, title, content, imageUrl }) {
  if (!client) throw new Error('Bot não está conectado.');
  const embed = new EmbedBuilder()
    .setTitle(`📜 ${title || 'Handout'}`)
    .setColor(0xc4a747)
    .setFooter({ text: getDb().settings.campaignName });
  if (content) embed.setDescription(content);
  if (imageUrl) embed.setImage(imageUrl);

  if (toChannel) {
    const ok = await postMessage({ embeds: [embed] });
    if (!ok) throw new Error('Defina o canal de texto nas configurações.');
    return { sent: ['canal'] };
  }

  const sent = [];
  const failed = [];
  for (const id of characterIds) {
    const character = getItem('characters', id);
    if (!character?.discordUserId) {
      failed.push(`${character?.name ?? id} (sem vínculo — o jogador precisa usar /vincular)`);
      continue;
    }
    try {
      const user = await client.users.fetch(character.discordUserId);
      await user.send({ embeds: [embed] });
      sent.push(character.name);
    } catch {
      failed.push(`${character.name} (DM bloqueada nas configurações de privacidade do jogador)`);
    }
  }
  return { sent, failed };
}

export function botStatus() {
  return {
    connected: Boolean(client),
    tag: client?.user?.tag ?? null,
    inVoice: isInVoice(),
    nowPlaying: nowPlaying(),
  };
}
