const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const express = require('express');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors()); // Libera o acesso para o seu site no GitHub Pages

// CONFIGURAÇÕES DO DISCORD
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
// SUBSTiTUA ABAIXO PELO ID DO SEU CANAL PRIVADO DE RECRUTAMENTO
const CHANNEL_ID = "1531673006064275739"; 

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds, 
    GatewayIntentBits.GuildMembers
  ]
});

// Endpoint que recebe as informações enviadas pelo site
app.post('/api/apply', async (req, res) => {
  try {
    const { gameNick, discordTag, roles, mainWeapon, weaponSpec } = req.body;

    const channel = await client.channels.fetch(CHANNEL_ID);
    if (!channel) return res.status(500).json({ error: 'Canal não encontrado no Discord.' });

    const rolesList = Array.isArray(roles) ? roles.join(', ') : (roles || 'Nenhum');

    // Embed visual com os dados do jogador
    const embed = new EmbedBuilder()
      .setTitle(`🛡️ Nova Aplicação: ${gameNick}`)
      .setColor(0xD4AF37) // Dourado
      .addFields(
        { name: '👤 Nick no Jogo', value: gameNick || 'Não informado', inline: true },
        { name: '💬 Discord', value: `@${discordTag.replace('@', '')}`, inline: true },
        { name: '⚔️ Arma & Spec', value: `${mainWeapon} (${weaponSpec})`, inline: false },
        { name: '🏷️ Cargos Solicitados', value: rolesList, inline: false }
      )
      .setFooter({ text: 'Apenas admins: escolha uma opção abaixo.' })
      .setTimestamp();

    // Botões de Ação para a Staff
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
    return res.status(200).json({ success: true, message: 'Aplicação enviada com sucesso!' });

  } catch (error) {
    console.error('Erro ao processar requisição:', error);
    return res.status(500).json({ error: 'Erro interno no servidor do bot.' });
  }
});

// Manipulação do clique nos Botões pelo Admin no Discord
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return;

  const parts = interaction.customId.split('_');
  const action = parts[0];
  const rawDiscordTag = parts[1];
  const cleanTag = rawDiscordTag.replace('@', '').toLowerCase();

  if (action === 'approve') {
    const rolesString = decodeURIComponent(parts[2] || '');
    const guild = interaction.guild;

    // Busca o membro no servidor pelo nickname/tag do Discord
    const member = guild.members.cache.find(m => m.user.username.toLowerCase() === cleanTag);

    if (!member) {
      return interaction.reply({ 
        content: `⚠️ Não encontrei o usuário **@${cleanTag}** no servidor. Ele precisa ter entrado no Discord da guilda!`, 
        ephemeral: true 
      });
    }

    try {
      // 1. Atribui os cargos dos conteúdos selecionados
      const rolesToAddNames = rolesString.split(', ').filter(Boolean);
      
      for (const roleName of rolesToAddNames) {
        const role = guild.roles.cache.find(r => r.name.toLowerCase() === roleName.toLowerCase());
        if (role) await member.roles.add(role);
      }

      // 2. Opcional: Atribui cargo base de "Membro"
      const defaultRole = guild.roles.cache.find(r => r.name.toLowerCase() === 'membro');
      if (defaultRole) await member.roles.add(defaultRole);

      await interaction.update({
        content: `✅ **APROVADO!** O jogador <@${member.id}> foi aprovado por <@${interaction.user.id}> e recebeu os cargos automaticamente!`,
        embeds: interaction.message.embeds,
        components: []
      });

    } catch (err) {
      console.error('Erro ao adicionar cargos:', err);
      await interaction.reply({ 
        content: '❌ Erro ao atribuir cargos. Verifique se o cargo do Bot está ACIMA dos outros cargos na hierarquia do servidor.', 
        ephemeral: true 
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

// Inicialização da porta e login no Discord
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));

client.login(DISCORD_TOKEN);
