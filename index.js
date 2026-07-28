const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const express = require('express');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

// Trata o Token limpando espaços acidentais e quebras de linha
const DISCORD_TOKEN = (process.env.DISCORD_TOKEN || '').trim();
const CHANNEL_ID = "1531673006064275739"; // Certifique-se de colocar o ID do seu canal aqui!

if (!DISCORD_TOKEN) {
  console.error("❌ ERRO CRÍTICO: A variável DISCORD_TOKEN não foi encontrada no ambiente!");
}
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));

client.login(DISCORD_TOKEN).catch(err => {
  console.error("❌ Erro ao tentar logar o Bot no Discord:", err.message);
});
