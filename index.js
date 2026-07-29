const { 
  Client, 
  GatewayIntentBits, 
  SlashCommandBuilder, 
  PermissionFlagsBits, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle, 
  EmbedBuilder,
  AttachmentBuilder
} = require('discord.js');
const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
const { MercadoPagoConfig, Payment } = require('mercadopago');

// 🌐 CONFIGURAÇÕES DO SAAS (Apontando diretamente para o form.html)
const SITE_URL = 'https://eduardopython.github.io/recrutamento-albion/form.html';
const FREE_LIMIT = 15; // Limite de fichas mensais do plano gratuito
const PRO_PLAN_PRICE = 19.90; // Valor da assinatura mensal em R$

// ------------------------------------------------------------------
// INICIALIZAÇÃO DO MERCADO PAGO
// ------------------------------------------------------------------
const mpClient = new MercadoPagoConfig({ 
  accessToken: process.env.MP_ACCESS_TOKEN || '' 
});
const payment = new Payment(mpClient);

// ------------------------------------------------------------------
// INICIALIZAÇÃO DO FIREBASE (FIRESTORE)
// ------------------------------------------------------------------
let serviceAccount;

if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
} else {
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

function cleanText(text) {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

// ------------------------------------------------------------------
// 1. REGISTRO DOS COMANDOS SLASH
// ------------------------------------------------------------------
client.once('ready', async () => {
  console.log(`🤖 Bot conectado como ${client.user.tag}!`);

  const commands = [
    new SlashCommandBuilder()
      .setName('setar-canal')
      .setDescription('Define o canal onde as fichas de recrutamento serão enviadas')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addChannelOption(option =>
        option
          .setName('canal')
          .setDescription('O canal privado para os recrutadores')
          .setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName('status-plano')
      .setDescription('Verifica o plano atual e o limite de recrutamentos da guilda')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    new SlashCommandBuilder()
      .setName('assinar')
      .setDescription('Gera o QR Code Pix para assinar o Plano PRO da guilda')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  ];

  try {
    await client.application.commands.set(commands);
    console.log('✅ Comandos globais atualizados com sucesso!');
  } catch (error) {
    console.error('❌ Erro ao registrar comandos slash:', error);
  }
});

// ------------------------------------------------------------------
// 2. MANIPULAÇÃO DE INTERAÇÕES (COMANDOS E BOTÕES)
// ------------------------------------------------------------------
client.on('interactionCreate', async (interaction) => {
  if (interaction.isChatInputCommand()) {
    
    // Comando /setar-canal
    if (interaction.commandName === 'setar-canal') {
      await interaction.deferReply({ ephemeral: true });

      const channel = interaction.options.getChannel('canal');
      
      try {
        const guildRef = db.collection('guilds').doc(interaction.guildId);
        const doc = await guildRef.get();

        if (!doc.exists) {
          await guildRef.set({
            channelId: channel.id,
            guildName: interaction.guild.name,
            plan: 'free',
            applicationsCount: 0,
            lastResetMonth: new Date().getMonth(),
            subscriptionActive: true,
            createdAt: new Date().toISOString()
          });
        } else {
          await guildRef.update({
            channelId: channel.id,
            guildName: interaction.guild.name,
            updatedAt: new Date().toISOString()
          });
        }

        const generatedLink = `${SITE_URL}?guild=${interaction.guildId}`;

        await interaction.editReply({
          content: `✅ **Canal de recrutamento salvo no banco de dados!**\n` +
                   `📍 **Canal:** ${channel.toString()}\n` +
                   `🆔 **ID da Guilda:** \`${interaction.guildId}\`\n\n` +
                   `🔗 **Link exclusivo do formulário:**\n` +
                   `${generatedLink}`
        });
      } catch (err) {
        console.error('Erro ao salvar no Firebase:', err);
        await interaction.editReply({
          content: '❌ Ocorreu um erro ao salvar as configurações no banco de dados.'
        });
      }
      return;
    }

    // Comando /status-plano
    if (interaction.commandName === 'status-plano') {
      await interaction.deferReply({ ephemeral: true });

      try {
        const guildDoc = await db.collection('guilds').doc(interaction.guildId).get();
        
        if (!guildDoc.exists) {
          return interaction.editReply({
            content: '⚠️ Esta guilda ainda não foi configurada. Use `/setar-canal` primeiro.'
          });
        }

        const data = guildDoc.data();
        const isPro = data.plan === 'pro';
        const count = data.applicationsCount || 0;

        const embed = new EmbedBuilder()
          .setTitle(`📊 Status da Guilda - ${interaction.guild.name}`)
          .setColor(isPro ? 0x2ecc71 : 0xf1c40f)
          .addFields(
            { name: '💎 Plano Atual', value: isPro ? '⭐ **PRO (Ilimitado)**' : '🆓 **Gratuito**', inline: true },
            { name: '📋 Fichas no Mês', value: isPro ? `${count} (Sem limite)` : `${count}/${FREE_LIMIT}`, inline: true }
          )
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
      } catch (err) {
        console.error('Erro ao buscar status:', err);
        await interaction.editReply({ content: '❌ Erro ao consultar status do plano.' });
      }
      return;
    }

    // Comando /assinar
    if (interaction.commandName === 'assinar') {
      await interaction.deferReply({ ephemeral: true });

      try {
        const guildDoc = await db.collection('guilds').doc(interaction.guildId).get();
        if (!guildDoc.exists) {
          return interaction.editReply({
            content: '⚠️ Configure a guilda com `/setar-canal` antes de assinar.'
          });
        }

        const data = guildDoc.data();
        if (data.plan === 'pro') {
          return interaction.editReply({
            content: '⭐ Sua guilda já possui o **Plano PRO** ativo com fichas ilimitadas!'
          });
        }

        // Gera a cobrança Pix no Mercado Pago
        const response = await payment.create({
          body: {
            transaction_amount: PRO_PLAN_PRICE,
            description: `Plano PRO - Guilda ${interaction.guild.name}`,
            payment_method_id: 'pix',
            payer: {
              email: 'cliente@recrutadoralbion.com'
            },
            external_reference: interaction.guildId
          }
        });

        const qrCodeText = response.point_of_interaction.transaction_data.qr_code;
        const qrCodeBase64 = response.point_of_interaction.transaction_data.qr_code_base64;

        const buffer = Buffer.from(qrCodeBase64, 'base64');
        const attachment = new AttachmentBuilder(buffer, { name: 'qrcode.png' });

        const embed = new EmbedBuilder()
          .setTitle('💎 Assinatura Plano PRO - Bot Recrutador')
          .setDescription(`Escaneie o QR Code abaixo ou copie a chave Pix para ativar recrutamentos **ILIMITADOS** para a guilda **${interaction.guild.name}**.`)
          .setColor(0x2ecc71)
          .addFields(
            { name: '💰 Valor', value: `R$ ${PRO_PLAN_PRICE.toFixed(2).replace('.', ',')} / mês`, inline: true },
            { name: '⏳ Validade do Pix', value: '30 Minutos', inline: true },
            { name: '📋 Pix Copia e Cola', value: `\`\`\`\n${qrCodeText}\n\`\`\`` }
          )
          .setImage('attachment://qrcode.png')
          .setFooter({ text: 'A aprovação é instantânea assim que o pagamento for realizado no banco!' });

        await interaction.editReply({
          embeds: [embed],
          files: [attachment]
        });

      } catch (err) {
        console.error('Erro ao gerar Pix no Discord:', err);
        await interaction.editReply({
          content: '❌ Ocorreu um erro ao gerar o Pix. Tente novamente em alguns instantes.'
        });
      }
      return;
    }
  }

  // Trata Botões de Aprovação/Recusa
  if (interaction.isButton()) {
    const { customId, guild, member } = interaction;

    if (!member.permissions.has(PermissionFlagsBits.ManageRoles) && !member.permissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({
        content: '❌ Você não tem permissão para gerenciar recrutamentos.',
        ephemeral: true
      });
    }

    await interaction.deferReply({ ephemeral: true });

    const [action, targetIdentifier] = customId.split(':');
    const embed = interaction.message.embeds[0];
    const rolesField = embed.fields ? embed.fields.find(f => f.name === '🎯 Atividades de Interesse') : null;
    const selectedRoles = rolesField ? rolesField.value.split(', ').map(r => r.trim()) : [];

    // Busca o membro no servidor por ID ou username
    const members = await guild.members.fetch().catch(() => null);
    const targetMember = members ? members.find(m => 
      m.id === targetIdentifier ||
      m.user.username.toLowerCase() === targetIdentifier.toLowerCase() ||
      m.user.tag.toLowerCase() === targetIdentifier.toLowerCase()
    ) : null;

    if (action === 'approve') {
      if (!targetMember) {
        const updatedEmbed = EmbedBuilder.from(embed)
          .setColor(0x2ecc71)
          .setTitle('✅ Aplicação Aprovada (Sem Cargos Automáticos)')
          .setFooter({ text: `Aprovado por: ${interaction.user.tag}` });

        await interaction.message.edit({ embeds: [updatedEmbed], components: [] });

        return interaction.editReply({
          content: `⚠️ A ficha foi aprovada, mas o membro **${targetIdentifier}** não foi encontrado no servidor para receber os cargos.`
        });
      }

      const assignedRoles = [];
      const missingRoles = [];

      // Atribui cargo padrão 'Membro' se existir
      const defaultRole = guild.roles.cache.find(r => cleanText(r.name) === 'membro');
      if (defaultRole) {
        try {
          await targetMember.roles.add(defaultRole);
          assignedRoles.push(defaultRole.name);
        } catch (e) {
          console.error(`Erro ao dar cargo padrão:`, e);
        }
      }

      // Atribui cargos por atividades selecionadas
      for (const roleName of selectedRoles) {
        const role = guild.roles.cache.find(r => cleanText(r.name) === cleanText(roleName));
        if (role) {
          try {
            await targetMember.roles.add(role);
            assignedRoles.push(role.name);
          } catch (e) {
            console.error(`Erro ao dar cargo ${roleName}:`, e);
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

      await interaction.editReply({
        content: `❌ A aplicação de **${targetIdentifier}** foi recusada.`
      });
    }
  }
});

// ------------------------------------------------------------------
// 3. ROTAS DA API HTTP
// ------------------------------------------------------------------

// Rota para receber a ficha do formulário web
app.post('/api/apply', async (req, res) => {
  try {
    const { gameNick, discordTag, discordUserId, roles, mainWeapon, weaponSpec, guildId } = req.body;

    if (!guildId) {
      return res.status(400).json({ error: 'ID da guilda não informado.' });
    }

    const guildRef = db.collection('guilds').doc(guildId);
    const guildDoc = await guildRef.get();

    if (!guildDoc.exists) {
      return res.status(400).json({ error: 'Esta guilda ainda não configurou o bot com o /setar-canal.' });
    }

    const guildData = guildDoc.data();

    if (guildData.subscriptionActive === false) {
      return res.status(403).json({ error: 'A assinatura desta guilda está inativa.' });
    }

    const currentMonth = new Date().getMonth();
    let currentCount = guildData.applicationsCount || 0;

    if (guildData.lastResetMonth !== currentMonth) {
      currentCount = 0;
      await guildRef.update({ applicationsCount: 0, lastResetMonth: currentMonth });
    }

    const isFreePlan = (guildData.plan || 'free') === 'free';
    if (isFreePlan && currentCount >= FREE_LIMIT) {
      return res.status(402).json({ 
        error: `Esta guilda atingiu o limite mensal de ${FREE_LIMIT} recrutamentos do Plano Gratuito. Peça aos líderes para usarem o comando /assinar no Discord!` 
      });
    }

    const channel = await client.channels.fetch(guildData.channelId);
    if (!channel) {
      return res.status(404).json({ error: 'Canal de recrutamento não encontrado.' });
    }

    const buttonTarget = discordUserId || discordTag;

    const embed = new EmbedBuilder()
      .setTitle('⚔️ Nova Ficha de Recrutamento')
      .setColor(0xf1c40f)
      .addFields(
        { name: '👤 Nick no Albion', value: gameNick || 'Não informado', inline: true },
        { name: '💬 Discord', value: discordTag ? (discordUserId ? `<@${discordUserId}> (${discordTag})` : discordTag) : 'Não informado', inline: true },
        { name: '🗡️ Arma Principal', value: mainWeapon || 'Não informada', inline: true },
        { name: '⭐ Spec da Arma', value: String(weaponSpec || 0), inline: true },
        { name: '🎯 Atividades de Interesse', value: roles && roles.length > 0 ? roles.join(', ') : 'Nenhuma selecionada' }
      )
      .setFooter({ text: `Fichas este mês: ${currentCount + 1}${isFreePlan ? `/${FREE_LIMIT}` : ' (Plano PRO)'}` })
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`approve:${buttonTarget}`)
        .setLabel('Aprovar & Dar Cargos')
        .setStyle(ButtonStyle.Success)
        .setEmoji('✅'),
      new ButtonBuilder()
        .setCustomId(`reject:${buttonTarget}`)
        .setLabel('Recusar')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('❌')
    );

    await channel.send({ embeds: [embed], components: [row] });

    await guildRef.update({
      applicationsCount: admin.firestore.FieldValue.increment(1)
    });

    return res.status(200).json({ message: 'Aplicação enviada com sucesso!' });
  } catch (error) {
    console.error('Erro ao processar aplicação:', error);
    return res.status(500).json({ error: 'Erro interno no servidor ao processar aplicação.' });
  }
});

// ------------------------------------------------------------------
// 4. ROTAS DE PAGAMENTO AUTOMÁTICO (MERCADO PAGO)
// ------------------------------------------------------------------

app.post('/api/create-pix', async (req, res) => {
  try {
    const { guildId, email } = req.body;

    if (!guildId) {
      return res.status(400).json({ error: 'ID da guilda é obrigatório.' });
    }

    const response = await payment.create({
      body: {
        transaction_amount: PRO_PLAN_PRICE,
        description: `Plano PRO Recrutador Albion - Guilda ${guildId}`,
        payment_method_id: 'pix',
        payer: {
          email: email || 'cliente@recrutadoralbion.com'
        },
        external_reference: guildId
      }
    });

    return res.status(200).json({
      paymentId: response.id,
      qrCode: response.point_of_interaction.transaction_data.qr_code,
      qrCodeBase64: response.point_of_interaction.transaction_data.qr_code_base64
    });
  } catch (error) {
    console.error('Erro ao gerar Pix:', error);
    return res.status(500).json({ error: 'Erro ao gerar cobrança Pix.' });
  }
});

// Webhook acionado pelo Mercado Pago após o pagamento
app.post('/api/webhook', async (req, res) => {
  try {
    const { type, data } = req.body;

    if (type === 'payment' && data && data.id) {
      const paymentInfo = await payment.get({ id: data.id });

      if (paymentInfo.status === 'approved') {
        const guildId = paymentInfo.external_reference;

        if (guildId) {
          await db.collection('guilds').doc(guildId).set({
            plan: 'pro',
            subscriptionActive: true,
            applicationsCount: 0,
            lastPaymentDate: new Date().toISOString()
          }, { merge: true });

          console.log(`🎉 Pagamento aprovado! Guilda ${guildId} atualizada para o Plano PRO.`);
        }
      }
    }

    return res.status(200).send('OK');
  } catch (error) {
    console.error('Erro no Webhook:', error);
    return res.status(500).send('Webhook Error');
  }
});

app.get('/', (req, res) => {
  res.send('Bot Recrutador SaaS + Mercado Pago rodando com sucesso!');
});

// ------------------------------------------------------------------
// 5. INICIALIZAÇÃO
// ------------------------------------------------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor Web rodando na porta ${PORT}`);
});

client.login(process.env.DISCORD_TOKEN);
