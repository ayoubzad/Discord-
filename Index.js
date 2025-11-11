const { Client, GatewayIntentBits } = require("discord.js");
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus } = require("@discordjs/voice");
const ytSearch = require("yt-search");
const ytdl = require("ytdl-core");
require("dotenv").config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

client.once("ready", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

client.on("messageCreate", async message => {
  if (!message.content.startsWith("&p") || message.author.bot) return;

  const args = message.content.slice(2).trim();
  if (!args) return message.reply("🎵 اكتب اسم الأغنية بعد الأمر!");

  const voiceChannel = message.member?.voice.channel;
  if (!voiceChannel) return message.reply("⚠️ ادخل إلى قناة صوتية أولاً!");

  const search = await ytSearch(args);
  const video = search.videos[0];
  if (!video) return message.reply("❌ لم أجد أي نتيجة!");

  const connection = joinVoiceChannel({
    channelId: voiceChannel.id,
    guildId: message.guild.id,
    adapterCreator: message.guild.voiceAdapterCreator
  });

  const stream = ytdl(video.url, { filter: "audioonly", highWaterMark: 1 << 25 });
  const resource = createAudioResource(stream);
  const player = createAudioPlayer();

  player.play(resource);
  connection.subscribe(player);

  player.on(AudioPlayerStatus.Idle, () => connection.destroy());
  message.reply(`🎶 يتم الآن تشغيل: **${video.title}**`);
});

client.login(process.env.TOKEN);
