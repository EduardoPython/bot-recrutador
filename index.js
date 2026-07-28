const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const express = require('express');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

const DISCORD_TOKEN = (process.env.DISCORD_TOKEN || '').trim();

// COLOQUE AQUI O ID DO SEU CANAL PRIVADO:
const CHANNEL_ID = "1531673006064275739"; 

if (!DISCORD_TOKEN) {
  console.error("❌ ERRO CRÍTICO: A variável DISCORD_TOKEN não foi configurada na Render!");
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds, 
    GatewayIntentBits.GuildMembers
  ]
});

app.post('/api/apply', async (req, res) => {
  try {
    const { gameNick, discordTag, roles, mainWeapon, weaponSpec } = req.body;

    const channel = await client.channels.fetch(CHANNEL_ID);
    if (!channel) return res.status(500).json({ error: 'Canal não encontrado no Discord.' });

    const rolesList = Array.isArray(roles) ? roles.join(', ') : (roles || 'Nenhum');
    const cleanTag = discordTag.replace('@', '').trim();

    const embed = new EmbedBuilder()
      .setTitle(`🛡️ Nova Aplicação: ${gameNick}`)
      .setColor(0xD4AF37)
      .addFields(
        { name: '👤 Nick no Jogo', value: gameNick || 'Não informado', inline: true },
        { name: '💬 Discord Informado', value: `@${cleanTag}`, inline: true },
        { name: '⚔️ Arma & Spec', value: `${mainWeapon} (${weaponSpec})`, inline: false },
        { name: '🏷️ Cargos Solicitados', value: rolesList, inline: false }
      )
      .setFooter({ text: 'Apenas admins: escolha uma opção abaixo.' })
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`approve_${encodeURIComponent(cleanTag)}_${encodeURIComponent(rolesList)}`)
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

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return;

  const parts = interaction.customId.split('_');
  const action = parts[0];
  const rawDiscordTag = decodeURIComponent(parts[1] || '');
  const cleanTag = rawDiscordTag.replace('@', '').trim().toLowerCase();

  if (action === 'approve') {
    await interaction.deferReply({ ephemeral: true });

    const rolesString = decodeURIComponent(parts[2] || '');
    const guild = interaction.guild;

    try {
      // 1. Força a busca completa de todos os membros do servidor
      const members = await guild.members.fetch();

      // 2. Tenta encontrar por ID, Username, Nickname do Servidor ou Display Name
      let member = members.find(m => 
        m.id === cleanTag ||
        m.user.username.toLowerCase() === cleanTag || 
        (m.nickname && m.nickname.toLowerCase() === cleanTag) ||
        m.user.displayName.toLowerCase() === cleanTag
      );

      // Se ainda não achou, tenta busca parcial no nome
      if (!member) {
        member = members.find(m => 
          m.user.username.toLowerCase().includes(cleanTag) ||
          (m.nickname && m.nickname.toLowerCase().includes(cleanTag))
        );
      }

      if (!member) {
        return interaction.editReply({ 
          content: `⚠️ Não encontrei o usuário **"${rawDiscordTag}"** no servidor.\n\n` +
                   `**Como resolver:**\n` +
                   `1. Verifique se o jogador **já entrou neste servidor do Discord**.\n` +
                   `2. Diga para ele preencher com o **Username exato do Discord** (o nome de login em minúsculas) ou o **ID Numérico do perfil**.\n\n` +
                   `*Seus membros atuais no servidor:* ${members.map(m => m.user.username).slice(0, 10).join(', ')}...`
        });
      }

      // Adiciona os cargos selecionados
      const rolesToAddNames = rolesString.split(', ').filter(Boolean);
      for (const roleName of rolesToAddNames) {
        const role = guild.roles.cache.find(r => r.name.toLowerCase() === roleName.toLowerCase());
        if (role) await member.roles.add(role);
      }

      // Adiciona o cargo 'membro' se existir
      const defaultRole = guild.roles.cache.find(r => r.name.toLowerCase() === 'membro');
      if (defaultRole) await member.roles.add(defaultRole);

      await interaction.editReply({ content: `✅ Cargos entregues com sucesso para <@${member.id}>!` });

      await interaction.message.edit({
        content: `✅ **APROVADO!** O jogador <@${member.id}> foi aprovado por <@${interaction.user.id}> e recebeu os cargos automaticamente!`,
        embeds: interaction.message.embeds,
        components: []
      });

    } catch (err) {
      console.error('Erro ao adicionar cargos:', err);
      await interaction.editReply({ 
        content: '❌ Erro ao atribuir cargos. Verifique se o cargo do Bot está no TOPO da lista de cargos nas configurações do servidor.'
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
