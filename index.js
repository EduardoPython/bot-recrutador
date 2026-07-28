const { 
  Client, 
  GatewayIntentBits, 
  SlashCommandBuilder, 
  PermissionFlagsBits, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle, 
  EmbedBuilder 
} = require('discord.js');
const express = require('express');
const cors = require('cors');

// 🌐 COLOQUE AQUI A URL BASE DO SEU SITE NO GITHUB PAGES:
const SITE_URL = 'https://seu-usuario.github.io/seu-repositorio';

const app = express();
app.use(cors());
app.use(express.json());

// Banco de dados em memória para armazenar o canal de cada guilda (guildId -> channelId)
const recruitmentChannels = new Map();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers
  ]
});

// Função auxiliar para padronizar nomes de cargos
function cleanText(text) {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

// ------------------------------------------------------------------
// 1. REGISTRO DO COMANDO SLASH
// ------------------------------------------------------------------
client.once('ready', async () => {
  console.log(`🤖 Bot conectado como ${client.user.tag}!`);

  const setChannelCommand = new SlashCommandBuilder()
    .setName('setar-canal')
    .setDescription('Define o canal onde as fichas de recrutamento serão enviadas')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addChannelOption(option =>
      option
        .setName('canal')
        .setDescription('O canal privado para os recrutadores')
        .setRequired(true)
    );

  try {
    await client.application.commands.create(setChannelCommand);
    console.log('✅ Comando /setar-canal registrado com sucesso no Discord!');
  } catch (error) {
    console.error('❌ Erro ao registrar comando slash:', error);
  }
});

// ------------------------------------------------------------------
// 2. MANIPULAÇÃO DE INTERAÇÕES (COMANDOS E BOTÕES)
// ------------------------------------------------------------------
client.on('interactionCreate', async (interaction) => {
  // Trata o Comando /setar-canal
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === 'setar-canal') {
      const channel = interaction.options.getChannel('canal');
      
      recruitmentChannels.set(interaction.guildId, channel.id);

      const generatedLink = `${SITE_URL}/?guild=${interaction.guildId}`;

      await interaction.reply({
        content: `✅ **Canal de recrutamento configurado para:** ${channel.toString()}\n` +
                 `🆔 **ID deste Servidor:** \`${interaction.guildId}\`\n\n` +
                 `🔗 **Link exclusivo do formulário para esta guilda:**\n` +
                 `${generatedLink}`,
        ephemeral: true
      });
    }
    return;
  }

  // Trata o clique nos Botões (Aprovar / Recusar)
  if (interaction.isButton()) {
    const { customId, guild, member } = interaction;

    // Verificar permissão de quem clicou no botão
    if (!member.permissions.has(PermissionFlagsBits.ManageRoles) && !member.permissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({
        content: '❌ Você não tem permissão para gerenciar recrutamentos.',
        ephemeral: true
      });
    }

    const [action, targetDiscordTag] = customId.split(':');

    // Extrair dados da Embed original
    const embed = interaction.message.embeds[0];
    const rolesField = embed.fields.find(f => f.name === '🎯 Atividades de Interesse');
    const selectedRoles = rolesField ? rolesField.value.split(', ').map(r => r.trim()) : [];

    // Tenta encontrar o membro no servidor pelo username/tag informado
    const members = await guild.members.fetch();
    const targetMember = members.find(m => 
      m.user.username.toLowerCase() === targetDiscordTag.toLowerCase() ||
      m.user.tag.toLowerCase() === targetDiscordTag.toLowerCase() ||
      m.id === targetDiscordTag
    );

    if (action === 'approve') {
      if (!targetMember) {
        return interaction.reply({
          content: `⚠️ Não foi possível encontrar o usuário **${targetDiscordTag}** no servidor para atribuir os cargos automaticamente. A ficha foi aprovada, mas atribua os cargos manualmente.`,
          ephemeral: true
        });
      }

      await interaction.deferReply({ ephemeral: true });

      const assignedRoles = [];
      const missingRoles = [];

      // Procura e atribui o cargo padrão "Membro" (se existir)
      const defaultRole = guild.roles.cache.find(r => cleanText(r.name) === 'membro');
      if (defaultRole) {
        try {
          await targetMember.roles.add(defaultRole);
          assignedRoles.push(defaultRole.name);
        } catch (e) {
          console.error(`Erro ao dar o cargo padrão ${defaultRole.name}:`, e);
        }
      }

      // Procura e atribui os cargos das opções selecionadas no formulário
      for (const roleName of selectedRoles) {
        const role = guild.roles.cache.find(r => cleanText(r.name) === cleanText(roleName));
        if (role) {
          try {
            await targetMember.roles.add(role);
            assignedRoles.push(role.name);
          } catch (e) {
            console.error(`Erro ao dar o cargo ${roleName}:`, e);
          }
        } else {
          missingRoles.push(roleName);
        }
      }

      // Atualiza a mensagem no canal desativando os botões
      const updatedEmbed = EmbedBuilder.from(embed)
        .setColor(0x2ecc71)
        .setTitle('✅ Aplicação Aprovada')
        .setFooter({ text: `Aprovado por: ${interaction.user.tag}` });

      await interaction.message.edit({ embeds: [updatedEmbed], components: [] });

      let responseText = `✅ **${targetMember.user.tag}** foi aprovado com sucesso!`;
      if (assignedRoles.length > 0) responseText += `\nCargos entregues: **${assignedRoles.join(', ')}**`;
      if (missingRoles.length > 0) responseText += `\n⚠️ Cargos não encontrados no servidor: ${missingRoles.join(', ')}`;

      await interaction.editReply({ content: responseText });

    } else if (action === 'reject') {
      const updatedEmbed = EmbedBuilder.from(embed)
        .setColor(0xe74c3c)
        .setTitle('❌ Aplicação Recusada')
        .setFooter({ text: `Recusado por: ${interaction.user.tag}` });

      await interaction.message.edit({ embeds: [updatedEmbed], components: [] });

      await interaction.reply({
        content: `❌ A aplicação de **${targetDiscordTag}** foi recusada.`,
        ephemeral: true
      });
    }
  }
});

// ------------------------------------------------------------------
// 3. ENDPOINT DA API HTTP (RECEBE O FORMULÁRIO DO SITE)
// ------------------------------------------------------------------
app.post('/api/apply', async (req, res) => {
  try {
    const { gameNick, discordTag, roles, mainWeapon, weaponSpec, guildId } = req.body;

    if (!guildId) {
      return res.status(400).json({ error: 'ID da guilda não informado.' });
    }

    const channelId = recruitmentChannels.get(guildId);
    if (!channelId) {
      return res.status(400).json({ 
        error: 'O canal de recrutamento deste servidor ainda não foi configurado com /setar-canal.' 
      });
    }

    const channel = await client.channels.fetch(channelId);
    if (!channel) {
      return res.status(404).json({ error: 'Canal de recrutamento não encontrado.' });
    }

    // Montar a ficha bonita no Discord (Embed)
    const embed = new EmbedBuilder()
      .setTitle('⚔️ Nova Ficha de Recrutamento')
      .setColor(0xf1c40f)
      .addFields(
        { name: '👤 Nick no Albion', value: gameNick || 'Não informado', inline: true },
        { name: '💬 Discord', value: discordTag || 'Não informado', inline: true },
        { name: '🗡️ Arma Principal', value: mainWeapon || 'Não informada', inline: true },
        { name: '⭐ Spec da Arma', value: String(weaponSpec || 0), inline: true },
        { name: '🎯 Atividades de Interesse', value: roles && roles.length > 0 ? roles.join(', ') : 'Nenhuma selecionada' }
      )
      .setTimestamp();

    // Botões de Ação
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`approve:${discordTag}`)
        .setLabel('Aprovar & Dar Cargos')
        .setStyle(ButtonStyle.Success)
        .setEmoji('✅'),
      new ButtonBuilder()
        .setCustomId(`reject:${discordTag}`)
        .setLabel('Recusar')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('❌')
    );

    await channel.send({ embeds: [embed], components: [row] });

    return res.status(200).json({ message: 'Aplicação enviada com sucesso!' });
  } catch (error) {
    console.error('Erro ao processar aplicação:', error);
    return res.status(500).json({ error: 'Erro interno no servidor ao processar aplicação.' });
  }
});

// Endpoint de teste/health check
app.get('/', (req, res) => {
  res.send('Bot Recrutador Albion rodando perfeitamente!');
});

// ------------------------------------------------------------------
// 4. INICIALIZAÇÃO DO SERVIDOR E LOGIN DO BOT
// ------------------------------------------------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor Web rodando na porta ${PORT}`);
});

client.login(process.env.DISCORD_TOKEN);
