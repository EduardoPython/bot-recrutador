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
const admin = require('firebase-admin');

// 🌐 URL BASE DO SEU SITE NO GITHUB PAGES:
const SITE_URL = 'https://eduardopython.github.io/recrutamento-albion';

// ------------------------------------------------------------------
// INICIALIZAÇÃO DO FIREBASE (FIRESTORE)
// ------------------------------------------------------------------
let serviceAccount;

if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  // Se estiver rodando no Render, usa a Variável de Ambiente
  serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
} else {
  // Se estiver rodando localmente no seu PC, tenta carregar o arquivo firebase-key.json
  try {
    serviceAccount = require('./firebase-key.json');
  } catch (e) {
    console.error("❌ Nem a variável FIREBASE_SERVICE_ACCOUNT nem o arquivo firebase-key.json foram encontrados.");
  }
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

// ------------------------------------------------------------------
// CONFIGURAÇÃO DO SERVIDOR EXPRESS
// ------------------------------------------------------------------
const app = express();
app.use(cors());
app.use(express.json());

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
      
      try {
        // Salva ou atualiza a guilda permanentemente no Firebase
        await db.collection('guilds').doc(interaction.guildId).set({
          channelId: channel.id,
          guildName: interaction.guild.name,
          plan: 'free',
          subscriptionActive: true,
          updatedAt: new Date().toISOString()
        }, { merge: true });

        const generatedLink = `${SITE_URL}/?guild=${interaction.guildId}`;

        await interaction.reply({
          content: `✅ **Canal de recrutamento salvo no banco de dados!**\n` +
                   `📍 **Canal:** ${channel.toString()}\n` +
                   `🆔 **ID da Guilda:** \`${interaction.guildId}\`\n\n` +
                   `🔗 **Link exclusivo do formulário para esta guilda:**\n` +
                   `${generatedLink}`,
          ephemeral: true
        });
      } catch (err) {
        console.error('Erro ao salvar no Firebase:', err);
        await interaction.reply({
          content: '❌ Ocorreu um erro ao salvar as configurações no banco de dados.',
          ephemeral: true
        });
      }
    }
    return;
  }

  // Trata o clique nos Botões (Aprovar / Recusar)
  if (interaction.isButton()) {
    const { customId, guild, member } = interaction;

    if (!member.permissions.has(PermissionFlagsBits.ManageRoles) && !member.permissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({
        content: '❌ Você não tem permissão para gerenciar recrutamentos.',
        ephemeral: true
      });
    }

    const [action, targetDiscordTag] = customId.split(':');

    const embed = interaction.message.embeds[0];
    const rolesField = embed.fields.find(f => f.name === '🎯 Atividades de Interesse');
    const selectedRoles = rolesField ? rolesField.value.split(', ').map(r => r.trim()) : [];

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

      const defaultRole = guild.roles.cache.find(r => cleanText(r.name) === 'membro');
      if (defaultRole) {
        try {
          await targetMember.roles.add(defaultRole);
          assignedRoles.push(defaultRole.name);
        } catch (e) {
          console.error(`Erro ao dar o cargo padrão ${defaultRole.name}:`, e);
        }
      }

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

    // Busca as informações da guilda no Firebase Firestore
    const guildDoc = await db.collection('guilds').doc(guildId).get();

    if (!guildDoc.exists) {
      return res.status(400).json({ 
        error: 'Esta guilda ainda não configurou o bot com o /setar-canal.' 
      });
    }

    const guildData = guildDoc.data();

    // Trava SaaS: Bloqueio caso a assinatura esteja cancelada
    if (guildData.subscriptionActive === false) {
      return res.status(403).json({ error: 'A assinatura desta guilda está inativa.' });
    }

    const channel = await client.channels.fetch(guildData.channelId);
    if (!channel) {
      return res.status(404).json({ error: 'Canal de recrutamento não encontrado.' });
    }

    // Montar a ficha no Discord (Embed)
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

app.get('/', (req, res) => {
  res.send('Bot Recrutador Albion rodando com suporte ao Firebase!');
});

// ------------------------------------------------------------------
// 4. INICIALIZAÇÃO
// ------------------------------------------------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor Web rodando na porta ${PORT}`);
});

client.login(process.env.DISCORD_TOKEN);
