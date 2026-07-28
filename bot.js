const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const express = require('express');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors()); // Permite que o GitHub Pages envie dados para este servidor

// CONFIGURAÇÕES DO SEU DISCORD
const DISCORD_TOKEN = process.env.DISCORD_TOKEN; // Pegaremos das variáveis de ambiente na hospedagem
const CHANNEL_ID = "1531673006064275739"; // ID do canal privado onde os admins aprovam

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

// Endpoint que recebe os dados do site
app.post('/api/apply', async (req, res) => {
  try {
    const { gameNick, discordTag, roles, mainWeapon, weaponSpec } = req.body;

    const channel = await client.channels.fetch(CHANNEL_ID);
    if (!channel) return res.status(500).json({ error: 'Canal não encontrado' });

    const rolesList = Array.isArray(roles) ? roles.join(', ') : roles;

    // Embed visual com os dados do jogador
    const embed = new EmbedBuilder()
      .setTitle(`🛡️ Nova Aplicação: ${gameNick}`)
      .setColor(0xD4AF37)
      .addFields(
        { name: '👤 Nick no Jogo', value: gameNick || 'Não informado', inline: true },
        { name: '💬 Discord', value: `@${discordTag}`, inline: true },
        { name: '⚔️ Arma & Espec', value: `${mainWeapon} (${weaponSpec})`, inline: false },
        { name: '🏷️ Cargos Solicitados', value: rolesList || 'Nenhum', inline: false }
      )
      .setFooter({ text: 'Clique abaixo para aprovar ou recusar o candidato.' })
      .setTimestamp();

    // Botões de ação rápida para a staff
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`approve_${discordTag}_${encodeURIComponent(rolesList)}`)
        .setLabel('✅ Aprovar & Dar Cargos')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`reject_${discordTag}`)
        .setLabel('❌ Recusar')
        .setStyle(ButtonStyle.Danger)
    );

    await channel.send({ embeds: [embed], components: [row] });
    res.status(200).json({ success: true, message: 'Aplicação enviada!' });
  } catch (error) {
    console.error('Erro no processamento:', error);
    res.status(500).json({ error: 'Erro interno no bot' });
  }
});

// Ação ao clicar no botão do Discord
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return;

  const parts = interaction.customId.split('_');
  const action = parts[0];
  const discordTag = parts[1];

  if (action === 'approve') {
    const rolesString = decodeURIComponent(parts[2] || '');
    const guild = interaction.guild;

    // Procura o membro no servidor pelo username do Discord
    const member = guild.members.cache.find(m => m.user.username.toLowerCase() === discordTag.toLowerCase().replace('@', ''));

    if (!member) {
      return interaction.reply({ content: `⚠️ Não encontrei o usuário **@${discordTag}** no servidor. Ele precisa estar no servidor do Discord!`, ephemeral: true });
    }

    try {
      // Cargos para adicionar baseados nas escolhas
      const rolesToAddNames = rolesString.split(', ').filter(Boolean);
      
      for (const roleName of rolesToAddNames) {
        const role = guild.roles.cache.find(r => r.name.toLowerCase() === roleName.toLowerCase());
        if (role) await member.roles.add(role);
      }

      // Adiciona um cargo padrão de Membro da guilda (se existir)
      const defaultRole = guild.roles.cache.find(r => r.name.toLowerCase() === 'membro');
      if (defaultRole) await member.roles.add(defaultRole);

      await interaction.update({
        content: `✅ **APROVADO!** O candidato <@${member.id}> foi aprovado por <@${interaction.user.id}> e recebeu seus cargos automaticamente!`,
        embeds: interaction.message.embeds,
        components: []
      });
    } catch (err) {
      console.error(err);
      await interaction.reply({ content: '❌ Erro ao atribuir cargos. Verifique as permissões da hierarquia do Bot.', ephemeral: true });
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));

client.login(DISCORD_TOKEN);