const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, REST, Routes, SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const express = require('express');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

const DISCORD_TOKEN = (process.env.DISCORD_TOKEN || '').trim();

if (!DISCORD_TOKEN) {
  console.error("❌ ERRO CRÍTICO: A variável DISCORD_TOKEN não foi configurada!");
}

// Memória temporária para guardar o canal configurado de cada guilda (Guild ID -> Channel ID)
const guildChannels = new Map();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds, 
    GatewayIntentBits.GuildMembers
  ]
});

// Comando Slash /setar-canal
const commands = [
  new SlashCommandBuilder()
    .setName('setar-canal')
    .setDescription('Define o canal onde as fichas de recrutamento serão enviadas')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addChannelOption(option => 
      option.setName('canal')
        .setDescription('Selecione o canal privado de recrutamento')
        .setRequired(true)
    )
];

client.once('ready', async () => {
  console.log(`🤖 Bot conectado como ${client.user.tag}`);
  
  // Registra o comando /setar-canal globalmente para todos os servidores
  try {
    const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: commands }
    );
    console.log('✅ Comando /setar-canal registrado no Discord!');
  } catch (error) {
    console.error('Erro ao registrar comando slash:', error);
  }
});

// Manipula a execução do comando /setar-canal
client.on('interactionCreate', async (interaction) => {
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === 'setar-canal') {
      const channel = interaction.options.getChannel('canal');
      
      guildChannels.set(interaction.guildId, channel.id);

      await interaction.reply({
        content: `✅ Canal de recrutamento configurado para ${channel}!\n**ID deste Servidor:** \`${interaction.guildId}\``,
        flags: MessageFlags.Ephemeral
      });
    }
  }
});

// Função para limpar textos de cargos
function cleanText(str) {
  return str.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
}

// Rota de recebimento do formulário do site
app.post('/api/apply', async (req, res) => {
  try {
    const { gameNick, discordTag, roles, mainWeapon, weaponSpec, guildId } = req.body;

    if (!guildId) {
      return res.status(400).json({ error: 'ID do servidor (guildId) não fornecido.' });
    }

    const channelId = guildChannels.get(guildId);

    const targetGuild = await client.guilds.fetch(guildId).catch(() => null);
    if (!targetGuild) {
      return res.status(404).json({ error: 'O bot não está presente neste servidor do Discord.' });
    }

    if (!channelId) {
      return res.status(400).json({ error: 'O canal de recrutamento deste servidor ainda não foi configurado com /setar-canal.' });
    }

    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel) return res.status(500).json({ error: 'Canal configurado não encontrado no Discord.' });

    const rolesArray = Array.isArray(roles) ? roles : (roles ? [roles] : []);
    const rolesListText = rolesArray.length > 0 ? rolesArray.join(', ') : 'Nenhum';
    const cleanTag = (discordTag || '').trim().replace(/^@/, '');
    const compactRoles = rolesArray.join('|');

    const embed = new EmbedBuilder()
      .setTitle(`🛡️ Nova Aplicação: ${gameNick}`)
      .setColor(0xD4AF37)
      .addFields(
        { name: '👤 Nick no Jogo', value: gameNick || 'Não informado', inline: true },
        { name: '💬 Discord Informado', value: `${cleanTag}`, inline: true },
        { name: '⚔️ Arma & Spec', value: `${mainWeapon} (${weaponSpec})`, inline: false },
        { name: '🏷️ Cargos Solicitados', value: rolesListText, inline: false }
      )
      .setFooter({ text: 'Apenas admins: escolha uma opção abaixo.' })
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`approve_${encodeURIComponent(cleanTag)}_${encodeURIComponent(compactRoles)}`)
        .setLabel('✅ Aprovar & Dar Cargos')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`reject_${encodeURIComponent(cleanTag)}`)
        .setLabel('❌ Recusar')
        .setStyle(ButtonStyle.Danger)
    );

    await channel.send({ embeds: [embed], components: [row] });
    return res.status(200).json({ success: true, message: 'Aplicação enviada com sucesso!' });

  } catch (error) {
    console.error('Erro ao processar requisição:', error);
    return res.status(500).json({ error: 'Erro interno no servidor do bot.' });
  }
});

// Tratamento dos Botões Aprovar/Recusar
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return;

  const parts = interaction.customId.split('_');
  const action = parts[0];
  const rawDiscordTag = decodeURIComponent(parts[1] || '');
  const searchString = rawDiscordTag.toLowerCase().trim();

  if (action === 'approve') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const rawRoles = decodeURIComponent(parts[2] || '');
    const rolesRequested = rawRoles ? rawRoles.split('|').filter(Boolean) : [];
    const guild = interaction.guild;

    try {
      const members = await guild.members.fetch();

      let member = 
        members.get(searchString) ||
        members.find(m => m.user.username.toLowerCase() === searchString) ||
        members.find(m => m.user.displayName.toLowerCase() === searchString) ||
        members.find(m => m.nickname && m.nickname.toLowerCase() === searchString) ||
        members.find(m => 
          m.user.username.toLowerCase().includes(searchString) ||
          m.user.displayName.toLowerCase().includes(searchString) ||
          (m.nickname && m.nickname.toLowerCase().includes(searchString))
        );

      if (!member) {
        return interaction.editReply({ 
          content: `⚠️ Não encontrei o usuário **"${rawDiscordTag}"** no servidor.`
        });
      }

      await guild.roles.fetch();

      let addedRoles = [];
      let missingRoles = [];

      for (const roleReq of rolesRequested) {
        const cleanReq = cleanText(roleReq);
        const role = guild.roles.cache.find(r => cleanText(r.name) === cleanReq || cleanText(r.name).includes(cleanReq));
        
        if (role) {
          await member.roles.add(role);
          addedRoles.push(role.name);
        } else {
          missingRoles.push(roleReq);
        }
      }

      const defaultRole = guild.roles.cache.find(r => cleanText(r.name) === 'membro');
      if (defaultRole) {
        await member.roles.add(defaultRole);
        if (!addedRoles.includes(defaultRole.name)) {
          addedRoles.push(defaultRole.name);
        }
      }

      let responseMsg = `✅ **Sucesso!** Cargos entregues para <@${member.id}>:\n👉 ${addedRoles.length > 0 ? addedRoles.join(', ') : 'Nenhum cargo adicionado'}`;
      
      if (missingRoles.length > 0) {
        responseMsg += `\n\n⚠️ **Não encontrados no servidor:** ${missingRoles.join(', ')}`;
      }

      await interaction.editReply({ content: responseMsg });

      await interaction.message.edit({
        content: `✅ **APROVADO!** O jogador <@${member.id}> foi aprovado por <@${interaction.user.id}>!`,
        embeds: interaction.message.embeds,
        components: []
      });

    } catch (err) {
      console.error('Erro ao adicionar cargos:', err);
      await interaction.editReply({ 
        content: '❌ **Erro ao atribuir cargos!**\nVerifique se o cargo do Bot está no **TOPO da lista** em *Configurações do Servidor > Cargos*.'
      });
    }
  }

  if (action === 'reject') {
    await interaction.update({
      content: `❌ **RECUSADO.** Aplicação rejeitada por <@${interaction.user.id}>.`,
      embeds: interaction.message.embeds,
      components: []
    });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));

if (DISCORD_TOKEN) {
  client.login(DISCORD_TOKEN).catch(err => {
    console.error("❌ Erro ao conectar ao Discord:", err.message);
  });
}
