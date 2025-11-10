// index.js
const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, NoSubscriberBehavior, getVoiceConnection } = require('@discordjs/voice');
const play = require('play-dl');
require('dotenv').config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const PREFIX = '&';
const queues = new Map(); // guildId => { voiceChannel, textChannel, connection, player, songs }

async function ensureSoundCloud() {
  try {
    const id = await play.getFreeClientID();
    play.setToken({ soundcloud: { client_id: id } });
    console.log('🎶 SoundCloud client id set');
  } catch (e) {
    console.log('⚠️ Could not set SoundCloud client id:', e?.message || e);
  }
}

client.once('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  await ensureSoundCloud();
});

// Connect helper
function connectToChannel(voiceChannel) {
  return joinVoiceChannel({
    channelId: voiceChannel.id,
    guildId: voiceChannel.guild.id,
    adapterCreator: voiceChannel.guild.voiceAdapterCreator,
    selfDeaf: false,
  });
}

// Play the current song for a guild
async function playSong(guildId) {
  const serverQueue = queues.get(guildId);
  if (!serverQueue) return;

  const song = serverQueue.songs[0];
  if (!song) {
    // queue empty -> destroy connection
    try {
      const conn = getVoiceConnection(guildId);
      if (conn) conn.destroy();
    } catch {}
    queues.delete(guildId);
    serverQueue.textChannel?.send('✅ انتهت قائمة التشغيل.');
    return;
  }

  try {
    const stream = await play.stream(song.url, { quality: 2 }).catch(async () => {
      // fallback: try without options
      return play.stream(song.url);
    });

    const resource = createAudioResource(stream.stream, { inputType: stream.type });
    serverQueue.player.play(resource);

    // build embed + buttons
    const embed = new EmbedBuilder()
      .setColor('#00b0f4')
      .setTitle('🎶 الآن يشغل')
      .setDescription(`[${song.title}](${song.url})`)
      .setFooter({ text: `طلب من: ${song.requester}` })
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('pause').setLabel('⏸️').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('resume').setLabel('▶️').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('skip').setLabel('⏭️').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('stop').setLabel('⏹️').setStyle(ButtonStyle.Danger)
    );

    await serverQueue.textChannel.send({ embeds: [embed], components: [row] });

  } catch (err) {
    console.error('❌ playSong error:', err);
    serverQueue.textChannel?.send('⚠️ حدث خطأ أثناء التشغيل، سيتم الانتقال للأغنية التالية...');
    serverQueue.songs.shift();
    playSong(guildId);
  }
}

// Add song to queue (search if needed)
async function addSongToQueue(message, query) {
  const voiceChannel = message.member.voice.channel;
  if (!voiceChannel) return message.reply('🚫 يجب أن تكون في قناة صوتية أولاً!');

  let connection = getVoiceConnection(message.guild.id);
  if (!connection) {
    connection = connectToChannel(voiceChannel);
  }

  let serverQueue = queues.get(message.guild.id);
  if (!serverQueue) {
    const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Pause } });
    connection.subscribe(player);

    serverQueue = {
      voiceChannel,
      textChannel: message.channel,
      connection,
      player,
      songs: [],
    };

    // events
    player.on(AudioPlayerStatus.Idle, () => {
      serverQueue.songs.shift();
      playSong(message.guild.id);
    });
    player.on('error', (err) => {
      console.error('Player error:', err);
      serverQueue.textChannel?.send('⚠️ خطأ في مشغل الصوت، الانتقال للأغنية التالية...');
      serverQueue.songs.shift();
      playSong(message.guild.id);
    });

    queues.set(message.guild.id, serverQueue);
  }

  // Resolve URL or search
  try {
    let url = query;
    let title = query;

    if (!query.startsWith('http')) {
      // search
      const search = await play.search(query, { limit: 1 });
      if (!search || !search.length) return message.reply('🚫 لم أجد نتائج لهذا البحث.');
      url = search[0].url;
      title = search[0].title || search[0].name || url;
    } else {
      // if direct url and is YouTube link, try to fetch info
      try {
        const info = await play.video_info(url);
        title = info?.video_details?.title || title;
      } catch {}
    }

    const song = { title, url, requester: message.author.username };
    serverQueue.songs.push(song);

    if (serverQueue.songs.length === 1) {
      // start playing
      playSong(message.guild.id);
      return message.reply(`▶️ جاري تشغيل: **${song.title}**`);
    } else {
      return message.reply(`➕ تمت إضافة **${song.title}** إلى قائمة الانتظار.`);
    }
  } catch (err) {
    console.error('addSongToQueue error:', err);
    return message.reply('❌ حدث خطأ أثناء البحث أو إضافة الأغنية.');
  }
}

// Message commands
client.on('messageCreate', async (message) => {
  if (!message.guild || message.author.bot) return;
  if (!message.content.startsWith(PREFIX)) return;

  const args = message.content.slice(PREFIX.length).trim().split(/ +/);
  const cmd = args.shift().toLowerCase();

  if (cmd === 'join') {
    const vc = message.member.voice.channel;
    if (!vc) return message.reply('🚫 يجب أن تكون في قناة صوتية أولاً!');
    const existing = getVoiceConnection(message.guild.id);
    if (existing) return message.reply('✅ أنا بالفعل في القناة الصوتية!');
    connectToChannel(vc);
    return message.reply('✅ دخلت القناة الصوتية!');
  }

  if (cmd === 'p' || cmd === 'play') {
    const query = args.join(' ');
    if (!query) return message.reply('🎵 اكتب اسم الأغنية أو الرابط بعد &p');
    return addSongToQueue(message, query);
  }

  if (cmd === 'skip') {
    const serverQueue = queues.get(message.guild.id);
    if (!serverQueue) return message.reply('🚫 لا توجد أغاني للتخطي.');
    serverQueue.player.stop();
    return message.reply('⏭️ تم التخطي.');
  }

  if (cmd === 'pause') {
    const serverQueue = queues.get(message.guild.id);
    if (!serverQueue) return message.reply('🚫 لا يوجد مشغل الآن.');
    serverQueue.player.pause();
    return message.reply('⏸️ تم الإيقاف المؤقت.');
  }

  if (cmd === 'resume') {
    const serverQueue = queues.get(message.guild.id);
    if (!serverQueue) return message.reply('🚫 لا يوجد مشغل الآن.');
    serverQueue.player.unpause();
