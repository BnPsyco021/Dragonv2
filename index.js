const { Client, RichPresence } = require('discord.js-selfbot-v13');
const { joinVoiceChannel, getVoiceConnection } = require('@discordjs/voice');
const admin = require('firebase-admin');

// 1. CONFIGURAÇÃO FIREBASE
const serviceAccount = require("./serviceAccountKey.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://contas-b30ba-default-rtdb.firebaseio.com"
});

const db = admin.database();
const selfbotsAtivos = new Map();

console.log("🐲 DRAGON V2 | MULTI-SELFBOT SYSTEM ONLINE");

// Escuta o nó principal de operadores
db.ref('operadores_ativos').on('value', (snapshot) => {
    const operadores = snapshot.val();
    if (!operadores) return;

    Object.keys(operadores).forEach(async (opKey) => {
        const data = operadores[opKey];
        
        // Verifica se tem os dados mínimos para rodar
        if (!data.bot_token || !data.owner_id || !data.liberado) return;

        // Inicia o Selfbot se não estiver rodando no Map
        if (!selfbotsAtivos.has(opKey)) {
            const client = new Client({ checkUpdate: false });

            client.on('ready', async () => {
                console.log(`✅ [${opKey.toUpperCase()}] Logado: ${client.user.tag}`);
                selfbotsAtivos.set(opKey, client);

                // Aplica o status personalizado inicial
                atualizarStatusIndividual(client, data, opKey);
            });

            // --- LÓGICA DE COLEIRA (PUXAR VÍTIMAS) & ANTI-FUGA ---
            client.on('voiceStateUpdate', async (oldState, newState) => {
                const donoId = data.owner_id;
                const guild = newState.guild;

                // Se o DONO mudar de canal, puxa todas as vítimas da lista dele
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

                // LÓGICA ANTI-FUGA: Se a VÍTIMA tentar sair do canal do dono
                const snapVitim = await db.ref(`operadores_ativos/${opKey}/coleira/${newState.id}`).get();
                if (snapVitim.exists()) {
                    const donoMembro = guild.members.cache.get(donoId);
                    if (donoMembro && donoMembro.voice.channelId && newState.channelId !== donoMembro.voice.channelId) {
                        newState.setChannel(donoMembro.voice.channelId).catch(() => null);
                    }
                }
            });

            client.login(data.bot_token).catch(() => {
                console.log(`❌ Erro no token de ${opKey}`);
            });
        }

        // --- LÓGICA DE ATUALIZAÇÃO EM TEMPO REAL (BOTS LOGADOS) ---
        const bot = selfbotsAtivos.get(opKey);
        if (bot && bot.readyAt) {

            // Atualiza o Rich Presence caso tenha mudado algo no Firebase
            atualizarStatusIndividual(bot, data, opKey);

            // 1. LÓGICA DO FARM (V-MOVE / JOIN CALL)
            if (data.vmove) {
                if (data.vmove.active === true && data.vmove.channel) {
                    const channel = await bot.channels.fetch(data.vmove.channel).catch(() => null);
                    if (channel && channel.isVoice()) {
                        const existingConn = getVoiceConnection(channel.guild.id);
                        if (!existingConn) {
                            joinVoiceChannel({
                                channelId: channel.id,
                                guildId: channel.guild.id,
                                adapterCreator: channel.guild.voiceAdapterCreator,
                                selfDeaf: true,
                                selfMute: false
                            });
                        }
                    }
                } else {
                    // Desconecta se o farm for desativado
                    bot.guilds.cache.forEach(g => {
                        const conn = getVoiceConnection(g.id);
                        if (conn) conn.destroy();
                    });
                }
            }

            // 2. LÓGICA MUTE GERAL (Executa e limpa a ação)
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

// FUNÇÃO PARA ATUALIZAR O RICH PRESENCE COM DADOS DO FIREBASE
function atualizarStatusIndividual(client, data, opKey) {
    try {
        // Busca a nova categoria 'rpc_custom' ou usa valores padrão
        const custom = data.rpc_custom || {};

        const r = new RichPresence(client)
            .setApplicationId('1374024580536209458') 
            .setType('PLAYING') 
            .setName(custom.name || 'Dragon v2') 
            .setDetails(custom.details || 'Painel Online') 
            .setState(custom.state || 'SEGUE LA') 
            .setStartTimestamp(Date.now() - (492671 * 3600000)) // Timestamp longo padrão
            .setAssetsLargeImage(custom.image || 'https://media.discordapp.net/attachments/1480034102181892200/1490348844876038314/wallpaper.png?ex=69d3bb05&is=69d26985&hm=d086c6157f80f5a076501b1a45b134c5d44bab073e064662f2d29d09dd19503c&=&format=webp&quality=lossless&width=1502&height=845') 
            .setAssetsLargeText('Dragon Multi-Account')
            .addButton('Acessar Painel', 'https://discord.gg/XdeEyW7W');

        client.user.setPresence({ activities: [r] });
    } catch (err) {
        console.log(`❌ Erro no RPC de ${opKey}: Verifique se o link da imagem é direto (PNG/JPG).`);
    }
}

// Limpeza: Se um operador for removido do banco, desloga o bot
db.ref('operadores_ativos').on('child_removed', (snapshot) => {
    const opKey = snapshot.key;
    if (selfbotsAtivos.has(opKey)) {
        console.log(`🔌 [${opKey.toUpperCase()}] Removido do sistema.`);
        selfbotsAtivos.get(opKey).destroy();
        selfbotsAtivos.delete(opKey);
    }
});