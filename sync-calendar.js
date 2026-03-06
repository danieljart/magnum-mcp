import { google } from 'googleapis';
import pg from 'pg';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import readline from 'readline';

dotenv.config();

const { Pool } = pg;

const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID || 'primary';
const TOKEN_PATH = path.join(process.cwd(), 'token.json');
const CREDENTIALS_PATH = path.join(process.cwd(), 'credentials.json');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

function formatToISO(dateStr) {
    const parts = dateStr.split('/');
    if (parts.length === 3) {
        return `${parts[2]}-${parts[1]}-${parts[0]}`;
    }
    return dateStr;
}

function parseDescription(description) {
    if (!description) return null;
    const data = {};
    const lines = description.split('\n');
    lines.forEach(line => {
        const [key, ...valueParts] = line.split(':');
        if (key && valueParts.length > 0) {
            const cleanKey = key.trim().toUpperCase();
            const cleanValue = valueParts.join(':').trim();
            data[cleanKey] = cleanValue;
        }
    });

    const dataSaida = data['DATA_SAIDA'] ? formatToISO(data['DATA_SAIDA']) : null;
    if (!dataSaida) return null;

    let finalOrigem = data['ORIGEM'];
    let finalDestino = data['DESTINO'];

    if (finalOrigem && finalOrigem.toLowerCase() === 'origem') finalOrigem = null;
    if (finalDestino && finalDestino.toLowerCase() === 'destino') finalDestino = null;

    if (!finalOrigem || !finalDestino) {
        if (data['ROTA']) {
            if (/ x /i.test(data['ROTA'])) {
                finalOrigem = finalOrigem || data['ROTA'].split(/ x /i)[0].trim();
                finalDestino = finalDestino || data['ROTA'].split(/ x /i)[1].trim();
            } else if (data['ROTA'].toLowerCase().includes('x')) {
                finalOrigem = finalOrigem || data['ROTA'].toLowerCase().split('x')[0].trim();
                finalDestino = finalDestino || data['ROTA'].toLowerCase().split('x')[1].trim();
            }
        }
    }

    // Se após todo o parse (incluindo da string ROTA) os valores ainda forem literalmente 'origem' ou 'destino', anular:
    if (finalOrigem && finalOrigem.toLowerCase() === 'origem') finalOrigem = null;
    if (finalDestino && finalDestino.toLowerCase() === 'destino') finalDestino = null;

    finalOrigem = (finalOrigem || 'Belém').replace(/-PA$/i, '').trim();
    // Use Santa Catarina as a fallback if unknown destination
    finalDestino = (finalDestino || 'Santa Catarina').replace(/-PA$/i, '').trim();

    return {
        status: data['STATUS'] || 'ATIVO',
        origem: finalOrigem,
        destino: finalDestino,
        data_saida: dataSaida,
        tipo_onibus: data['ONIBUS'] || null,
        vagas_total: parseInt(data['LUGARES_TOTAIS']) || 0,
        vagas_disponiveis: parseInt(data['LUGARES_DISPONIVEIS']) || 0,
        valor_base: parseFloat(data['VALOR_PASSAGEM']) || 0,
        tempo_viagem: data['TEMPO_VIAGEM'] || null,
        horario_saida: data['HORARIO_SAIDA'] || null,
        local_embarque: data['LOCAL_EMBARQUE'] || null,
    };
}

async function authorize() {
    let credentials;
    if (process.env.GOOGLE_CREDENTIALS_JSON) {
        credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
    } else if (fs.existsSync(CREDENTIALS_PATH)) {
        const content = fs.readFileSync(CREDENTIALS_PATH);
        credentials = JSON.parse(content);
    } else {
        throw new Error("Missing credentials.json or GOOGLE_CREDENTIALS_JSON env var");
    }

    const { client_secret, client_id, redirect_uris } = credentials.installed || credentials.web;
    const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

    if (process.env.GOOGLE_TOKEN_JSON) {
        oAuth2Client.setCredentials(JSON.parse(process.env.GOOGLE_TOKEN_JSON));
        return oAuth2Client;
    } else if (fs.existsSync(TOKEN_PATH)) {
        const token = fs.readFileSync(TOKEN_PATH);
        oAuth2Client.setCredentials(JSON.parse(token));
        return oAuth2Client;
    }
    return getAccessToken(oAuth2Client);
}

function getAccessToken(oAuth2Client) {
    const authUrl = oAuth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: ['https://www.googleapis.com/auth/calendar.readonly'],
    });
    console.log('Authorize this app by visiting this url:', authUrl);
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    return new Promise((resolve) => {
        rl.question('Enter the code from that page here: ', (code) => {
            rl.close();
            oAuth2Client.getToken(code, (err, token) => {
                if (err) return console.error('Error retrieving access token', err);
                oAuth2Client.setCredentials(token);
                fs.writeFileSync(TOKEN_PATH, JSON.stringify(token));
                resolve(oAuth2Client);
            });
        });
    });
}

export async function syncCalendarToNeon() {
    console.log(`[SYNC] Iniciando sincronização Calendar → Neon em ${new Date().toISOString()}`);

    let auth;
    try {
        auth = await authorize();
    } catch (err) {
        console.error('[SYNC] Falha na autorização do Google Calendar:', err.message);
        return { success: false, error: err.message };
    }

    const calendar = google.calendar({ version: 'v3', auth });
    let events;
    try {
        const res = await calendar.events.list({
            calendarId: CALENDAR_ID,
            timeMin: new Date().toISOString(),
            maxResults: 100,
            singleEvents: true,
            orderBy: 'startTime',
        });
        events = res.data.items;
    } catch (err) {
        console.error('[SYNC] Erro ao listar eventos do Calendar:', err.message);
        return { success: false, error: err.message };
    }

    if (!events || events.length === 0) {
        console.log('[SYNC] Nenhum evento futuro encontrado no Calendar.');
        return { success: true, synced: 0, skipped: 0 };
    }

    console.log(`[SYNC] Encontrados ${events.length} eventos. Sincronizando com Neon...`);

    let synced = 0;
    let skipped = 0;

    for (const event of events) {
        const tripData = parseDescription(event.description);
        if (!tripData) {
            console.log(`[SYNC] Pulando "${event.summary}" - formato de descrição inválido.`);
            skipped++;
            continue;
        }

        try {
            await pool.query(
                `INSERT INTO viagens 
                    (status, origem, destino, data_saida, tipo_onibus, vagas_total, vagas_disponiveis, valor_base, tempo_viagem, horario_saida, local_embarque)
                 VALUES 
                    ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                 ON CONFLICT (data_saida, origem, destino) 
                 DO UPDATE SET
                    status = EXCLUDED.status,
                    tipo_onibus = EXCLUDED.tipo_onibus,
                    vagas_total = EXCLUDED.vagas_total,
                    vagas_disponiveis = EXCLUDED.vagas_disponiveis,
                    valor_base = EXCLUDED.valor_base,
                    tempo_viagem = EXCLUDED.tempo_viagem,
                    horario_saida = EXCLUDED.horario_saida,
                    local_embarque = EXCLUDED.local_embarque`,
                [
                    tripData.status,
                    tripData.origem,
                    tripData.destino,
                    tripData.data_saida,
                    tripData.tipo_onibus,
                    tripData.vagas_total,
                    tripData.vagas_disponiveis,
                    tripData.valor_base,
                    tripData.tempo_viagem,
                    tripData.horario_saida,
                    tripData.local_embarque,
                ]
            );
            console.log(`[SYNC] ✅ Sincronizado: ${event.summary}`);
            synced++;
        } catch (err) {
            console.error(`[SYNC] ❌ Erro ao sincronizar "${event.summary}":`, err.message);
            skipped++;
        }
    }

    console.log(`[SYNC] Concluído. Sincronizados: ${synced} | Pulados: ${skipped}`);
    return { success: true, synced, skipped };
}

// Permite rodar diretamente: node sync-calendar.js
if (process.argv[1] && process.argv[1].endsWith('sync-calendar.js')) {
    syncCalendarToNeon()
        .then(result => {
            console.log('[SYNC] Resultado final:', result);
            process.exit(0);
        })
        .catch(err => {
            console.error('[SYNC] Erro fatal:', err);
            process.exit(1);
        });
}
