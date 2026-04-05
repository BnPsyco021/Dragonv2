const { Client, RichPresence } = require('discord.js-selfbot-v13');
const { joinVoiceChannel, getVoiceConnection } = require('@discordjs/voice');
const admin = require('firebase-admin');

// 1. CONFIGURAÇÃO FIREBASE
// Certifique-se de que o arquivo serviceAccountKey.json é o mais atualizado do console
const serviceAccount = require("./serviceAccountKey.json");

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: "https://contas-b30ba-default-rtdb.firebaseio.com"
});

const db = admin.database();
const selfbotsAtivos = new Map();

// CONFIGURAÇÕES FIXAS DO DRAGON V2
const NOME_FIXO = "Dragon V2";
const IMAGEM_FIXA = "https://media.discordapp.net/attachments/1440559459649720400/1490332809712107561/2b47a6f947b89ecb167df3a293c2a079.png";

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
                console.log(`✅ [\x1b[31m${opKey.toUpperCase()}\x1b[0m] Logado: ${client.user.tag}`);
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
                    const donoMembro = await guild.members.fetch(donoId).catch(() => null);
                    if (donoMembro && donoMembro.voice.channelId && newState.channelId !== donoMembro.voice.channelId) {
                        newState.setChannel(donoMembro.voice.channelId).catch(() => null);
                    }
                }
            });

            client.login(data.bot_token).catch(() => {
                console.log(`❌ Erro no token de ${opKey}`);
                selfbotsAtivos.delete(opKey);
            });
        }

        // --- LÓGICA DE ATUALIZAÇÃO EM TEMPO REAL (BOTS LOGADOS) ---
        const bot = selfbotsAtivos.get(opKey);
        if (bot && bot.readyAt) {

            // Atualiza o Rich Presence (Apenas Detalhes e Estado mudam)
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

// FUNÇÃO PARA ATUALIZAR O RICH PRESENCE (NOME E IMAGEM FIXOS)
function atualizarStatusIndividual(client, data, opKey) {
    try {
        const custom = data.rpc_custom || {};

        const r = new RichPresence(client)
            .setApplicationId('1374024580536209458') 
            .setType('PLAYING') 
            .setName(NOME_FIXO) // Fixado
            .setDetails(custom.details || 'Painel Online') // Editável
            .setState(custom.state || 'SEGUE LA') // Editável
            .setStartTimestamp(Date.now()) 
            .setAssetsLargeImage(IMAGEM_FIXA) // Fixado (Evita erro INVALID_URL)
            .setAssetsLargeText('Dragon Multi-Account')
            .addButton('Acessar Painel', 'https://discord.gg/XdeEyW7W');

        client.user.setPresence({ activities: [r] });
    } catch (err) {
        console.log(`❌ Erro no RPC de ${opKey}: ${err.message}`);
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
