const { Client, RichPresence } = require('discord.js-selfbot-v13');
const { joinVoiceChannel, getVoiceConnection } = require('@discordjs/voice');
const admin = require('firebase-admin');

// 1. CONFIGURAÇÃO FIREBASE
// Use o novo arquivo serviceAccountKey.json para resolver o erro de JWT Signature
const serviceAccount = require("./serviceAccountKey.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://contas-b30ba-default-rtdb.firebaseio.com"
});

const db = admin.database();
const selfbotsAtivos = new Map();

// CONFIGURAÇÕES FIXAS PARA EVITAR CRASH (INVALID_URL)
const NOME_FIXO = "Dragon V2";
const IMAGEM_PADRAO = "https://i.imgur.com/8n9vS9Y.png"; 

console.log("🐲 DRAGON V2 | MULTI-SELFBOT SYSTEM ONLINE");

db.ref('operadores_ativos').on('value', (snapshot) => {
    const operadores = snapshot.val();
    if (!operadores) return;

    Object.keys(operadores).forEach(async (opKey) => {
        const data = operadores[opKey];
        if (!data.bot_token || !data.owner_id || !data.liberado) return;

        if (!selfbotsAtivos.has(opKey)) {
            const client = new Client({ checkUpdate: false });

            client.on('ready', async () => {
                console.log(`✅ [${opKey.toUpperCase()}] Logado: ${client.user.tag}`);
                selfbotsAtivos.set(opKey, client);
                atualizarStatusIndividual(client, data, opKey);
            });

            // --- LÓGICA DE COLEIRA (PUXAR VÍTIMAS) & ANTI-FUGA ---
            client.on('voiceStateUpdate', async (oldState, newState) => {
                const donoId = data.owner_id;
                const guild = newState.guild;

                // PUXAR VÍTIMAS: Se o DONO mudar de canal
                if (newState.id === donoId && newState.channelId && newState.channelId !== oldState.channelId) {
                    const snapColeira = await db.ref(`operadores_ativos/${opKey}/coleira`).get();
                    if (snapColeira.exists()) {
                        const vitimas = Object.keys(snapColeira.val());
                        vitimas.forEach(async (vId) => {
                            const member = await guild.members.fetch(vId).catch(() => null);
                            if (member && member.voice.channelId) {
                                member.voice.setChannel(newState.channelId).catch(() => null);
                            }
                        });
                    }
                }

                // ANTI-FUGA: Se a VÍTIMA tentar sair do canal do dono
                const snapVitim = await db.ref(`operadores_ativos/${opKey}/coleira/${newState.id}`).get();
                if (snapVitim.exists()) {
                    const donoMembro = await guild.members.fetch(donoId).catch(() => null);
                    if (donoMembro && donoMembro.voice.channelId && newState.channelId !== donoMembro.voice.channelId) {
                        newState.setChannel(donoMembro.voice.channelId).catch(() => null);
                    }
                }
            });

            client.login(data.bot_token).catch(() => console.log(`❌ Erro no token de ${opKey}`));
        }

        const bot = selfbotsAtivos.get(opKey);
        if (bot && bot.readyAt) {
            // Atualiza o RPC (Detalhes/Estado) em tempo real
            atualizarStatusIndividual(bot, data, opKey);

            // --- LÓGICA DO FARM (V-MOVE / JOIN CALL) ---
            if (data.vmove && data.vmove.active && data.vmove.channel) {
                const channel = await bot.channels.fetch(data.vmove.channel).catch(() => null);
                if (channel && channel.isVoice()) {
                    const existingConn = getVoiceConnection(channel.guild.id);
                    if (!existingConn) {
                        joinVoiceChannel({
                            channelId: channel.id,
                            guildId: channel.guild.id,
                            adapterCreator: channel.guild.voiceAdapterCreator,
                            selfDeaf: true
                        });
                    }
                }
            }

            // --- LÓGICA MUTE GERAL ---
            if (data.voice_control && data.voice_control.action) {
                const action = data.voice_control.action;
                bot.guilds.cache.forEach(async (guild) => {
                    const owner = await guild.members.fetch(data.owner_id).catch(() => null);
                    if (owner && owner.voice.channel) {
                        owner.voice.channel.members.forEach(m => {
                            if (m.id !== data.owner_id) {
                                m.voice.setMute(action === "MUTE_ALL").catch(() => null);
                            }
                        });
                    }
                });
                db.ref(`operadores_ativos/${opKey}/voice_control`).update({ action: null });
            }
        }
    });
});

// FUNÇÃO RPC - SINCRONIZADA COM SEUS INPUTS DO SITE
function atualizarStatusIndividual(client, data, opKey) {
    try {
        const custom = data.rpc_custom || {};
        
        // Se o link da imagem no painel for inválido ou vazio, usa a padrão pra não crashar
        const imagemFinal = (custom.image && custom.image.startsWith('http')) ? custom.image : IMAGEM_PADRAO;

        const r = new RichPresence(client)
            .setApplicationId('1374024580536209458') 
            .setType('PLAYING') 
            .setName(NOME_FIXO) 
            .setDetails(custom.details || 'Painel Ativo') 
            .setState(custom.state || 'SEGUE LA') 
            .setStartTimestamp(Date.now())
            .setAssetsLargeImage(imagemFinal) 
            .setAssetsLargeText('Dragon Multi-Account')
            .addButton('Acessar Painel', 'https://discord.gg/XdeEyW7W');

        client.user.setPresence({ activities: [r] });
    } catch (err) {
        console.log(`❌ Erro no RPC de ${opKey}: ${err.message}`);
    }
}

// REMOÇÃO DE OPERADOR
db.ref('operadores_ativos').on('child_removed', (snapshot) => {
    const opKey = snapshot.key;
    if (selfbotsAtivos.has(opKey)) {
        selfbotsAtivos.get(opKey).destroy();
        selfbotsAtivos.delete(opKey);
    }
});
