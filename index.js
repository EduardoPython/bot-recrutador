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
    const cleanTag = (discordTag || '').trim().replace(/^@/, '');

    const embed = new EmbedBuilder()
      .setTitle(`🛡️ Nova Aplicação: ${gameNick}`)
      .setColor(0xD4AF37)
      .addFields(
        { name: '👤 Nick no Jogo', value: gameNick || 'Não informado', inline: true },
        { name: '💬 Discord Informado', value: `${cleanTag}`, inline: true },
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
  const searchString = rawDiscordTag.toLowerCase().trim();

  if (action === 'approve') {
    await interaction.deferReply({ ephemeral: true });

    const rolesString = decodeURIComponent(parts[2] || '');
    const guild = interaction.guild;

    try {
      // 1. Atualiza membros no cache
      const members = await guild.members.fetch();

      // 2. Busca o jogador
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

      // 3. Força o download atualizado de TODOS os cargos do servidor
      await guild.roles.fetch();

      const rolesToAddNames = rolesString.split(', ').map(r => r.trim()).filter(Boolean);
      let addedRoles = [];
      let missingRoles = [];

      for (const roleName of rolesToAddNames) {
        const role = guild.roles.cache.find(r => r.name.toLowerCase() === roleName.toLowerCase());
        if (role) {
          await member.roles.add(role);
          addedRoles.push(role.name);
        } else {
          missingRoles.push(roleName);
        }
      }

      // Adiciona o cargo padrão 'membro' se existir
      const defaultRole = guild.roles.cache.find(r => r.name.toLowerCase() === 'membro');
      if (defaultRole) {
        await member.roles.add(defaultRole);
        addedRoles.push(defaultRole.name);
      }

      let responseMsg = `✅ **Sucesso!** Cargos entregues para <@${member.id}>:\n👉 ${addedRoles.length > 0 ? addedRoles.join(', ') : 'Nenhum cargo encontrado'}`;
      
      if (missingRoles.length > 0) {
        responseMsg += `\n\n⚠️ **Atenção:** Os seguintes cargos não existem no servidor com este nome exato: *${missingRoles.join(', ')}*`;
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
        content: '❌ **Erro de Permissão do Discord!**\nVerifique se o cargo do **bot-recrutador** está no TOPO da lista de cargos em *Configurações do Servidor > Cargos*.'
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
